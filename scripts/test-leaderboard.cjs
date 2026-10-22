// Run: node scripts/test-leaderboard.cjs. Points, leaderboard and "N interested" read through Supabase functions; no network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const fn=name=>{const a=source.indexOf('async function '+name+'(');return source.slice(a,source.indexOf('\n}',a)+2);};
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:''});return els.get(id);};
(async()=>{
 const calls=[];const replies={my_points_this_month:440,
  leaderboard_top:[{display_name:'Ana R.',points:420,is_me:false},{display_name:'Joe P.',points:30,is_me:true}],going_counts:[{event_id:'EVT-1',going:3}]};
 const c={console:{warn(){}},S:{nb:'Santa Monica',guest:false},myPtsAt:0,document:{getElementById:el},save(){},escH:s=>s,shortName:()=>'Joe P.',ordinal:n=>n+'th',
  current:'passport',renderHome(){},events:[{eid:'EVT-1',going:0},{eid:'EVT-2',going:5}],
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'joe'}}}})},rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args||{}))});return {data:replies[name],error:null};},
   from:()=>{throw new Error('the views are no longer read directly');}}};
 vm.createContext(c);for(const n of ['loadMyPoints','loadLeaderboard','loadGoing']) vm.runInContext(fn(n).replace('async function '+n,'this.'+n+'=async function'),c);
 await c.loadMyPoints();
 assert.equal(c.S.monthPts,440,'points this month are the total across boards');assert.equal(el('psPts').textContent,'440');
 await c.loadLeaderboard();
 assert.deepEqual(calls.find(x=>x.name==='leaderboard_top').args,{p_board:'Santa Monica',p_limit:5});
 assert.match(el('lbList').innerHTML,/class="lbrow "><div class="r">1<\/div><div>Ana R\./);
 assert.match(el('lbList').innerHTML,/class="lbrow me"><div class="r">2<\/div><div>Joe P\. \(you\)/,'your own row is marked by the database, not by matching user ids');
 await c.loadGoing();
 assert.deepEqual(c.events.map(e=>e.going),[3,0],'"N interested" counts come from going_counts');
 console.log('Leaderboard checks passed: points total across boards, top list marks you without user ids, interested counts.');
})().catch(e=>{console.error(e);process.exitCode=1;});
