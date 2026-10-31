// Run: node scripts/test-leaderboard.cjs. Points, leaderboard and "N interested" read through Supabase functions; no network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const fn=name=>{const a=source.indexOf('async function '+name+'(');return source.slice(a,source.indexOf('\n}',a)+2);};
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:''});return els.get(id);};
(async()=>{
 const calls=[];const replies={my_points_this_month:440,
  leaderboard_top:[{display_name:'Ana R.',points:420,is_me:false},{display_name:'Joe P.',points:30,is_me:true}],going_counts:[{event_id:'EVT-1',going:3}],checkin_counts:[{event_id:'EVT-2',checked_in:4}],review_summary:[{event_id:'EVT-1',reviews:5,liked_pct:80,top_tags:['Great vibe','Good for groups','Kid-friendly']}]};
 const c={console:{warn(){}},S:{nb:'Santa Monica',guest:false},myPtsAt:0,document:{getElementById:el},save(){},escH:s=>s,shortName:()=>'Joe P.',ordinal:n=>n+'th',
  current:'passport',renderHome(){},events:[{eid:'EVT-1',going:0},{eid:'EVT-2',going:5}],
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'joe'}}}})},rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args||{}))});return {data:replies[name],error:null};},
   from:()=>{throw new Error('the views are no longer read directly');}}};
 vm.createContext(c);for(const n of ['loadMyPoints','loadLeaderboard','loadGoing','loadCheckedIn','loadReviews']) vm.runInContext(fn(n).replace('async function '+n,'this.'+n+'=async function'),c);
 await c.loadMyPoints();
 assert.equal(c.S.monthPts,440,'points this month are the total across boards');assert.equal(el('psPts').textContent,'440');
 await c.loadLeaderboard();
 assert.deepEqual(calls.find(x=>x.name==='leaderboard_top').args,{p_board:'Santa Monica',p_limit:5});
 assert.match(el('lbList').innerHTML,/class="lbrow "><div class="r">1<\/div><div>Ana R\./);
 assert.match(el('lbList').innerHTML,/class="lbrow me"><div class="r">2<\/div><div>Joe P\. \(you\)/,'your own row is marked by the database, not by matching user ids');
 await c.loadGoing();
 assert.deepEqual(c.events.map(e=>e.going),[3,0],'"N interested" counts come from going_counts');
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(c.events.map(e=>e.checkedIn),[0,4],'"N checked in" counts come from checkin_counts');
 assert.deepEqual(JSON.parse(JSON.stringify(c.events.map(e=>e.rev))),[{n:5,pct:80,tags:['Great vibe','Good for groups']},null],'reviews come from review_summary, two tags at most');
 // before supabase/checkin_counts.sql is run: the call fails quietly and the counts already shown stay
 const rpc=c.sb.rpc; c.sb.rpc=async(name,args)=>name==='checkin_counts'||name==='review_summary'? {data:null,error:{message:'function public.checkin_counts() does not exist'}} : rpc(name,args);
 await c.loadGoing(); await new Promise(r=>setImmediate(r));
 assert.deepEqual(c.events.map(e=>[e.going,e.checkedIn]),[[3,0],[0,4]],'a missing checkin_counts() changes nothing');
 assert.equal(c.events[0].rev.pct,80,'nor does a missing review_summary()');
 console.log('Leaderboard checks passed: points total across boards, top list marks you without user ids, interested and checked-in counts, review summaries.');
})().catch(e=>{console.error(e);process.exitCode=1;});
