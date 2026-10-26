// Run: node scripts/test-badges.cjs. Badges come from my_achievements(); titles are saved on the profile. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=source.indexOf('const BADGE_SECTIONS='),end=source.indexOf('/* ---------- neighborhood leaderboard');
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',classList:{contains:()=>false}});return els.get(id);};
const badge=(key,section,name,title,goal,progress,earned,extra={})=>({key,section,name,title,blurb:'Rule for '+name,goal,hidden:false,progress,earned_at:earned?'2026-10-20T10:00:00Z':null,is_new:false,...extra});
(async()=>{
 const calls=[],toasts=[],updates=[];let reply={data:[],error:null},updateError=null,renders=0;
 const c={console:{warn(){}},C:{red:'#C9533D',blue:'#4B66A8',green:'#244D3A',sun:'#D6A638',ink:'#26251F'},S:{signedUp:true,accountId:'joe',badges:null,titleKey:null},
  current:'passport',passTab:'badges',document:{getElementById:el},save(){},escH:s=>String(s),toast:m=>toasts.push(m),
  stampSVG:(top,bottom)=>`<svg>${top}|${bottom}</svg>`,renderPassport(){renders++;},renderProfile(){},renderNames(){},dbUser:async()=>({id:'joe'}),
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'joe'}}}})},rpc:async(name)=>{calls.push(name);return reply;},
   from:t=>({update:v=>({eq:async(col,id)=>{updates.push({t,v,col,id});return {error:updateError};}})})}};
 vm.createContext(c);vm.runInContext(source.slice(start,end).replace(/^const |^let |^async function |^function /gm,m=>m.startsWith('async')?'this.x=1;async function ':m.startsWith('function')?'function ':'var '),c);

 assert.match(c.badgePage(),/Loading your badges/,'before the first load the page says it is loading');
 reply={data:[badge('coffee_1','everyday','Bean Counter','Bean Counter',3,3,true,{is_new:true}),badge('coffee_2','everyday','Bean Counter II',"Barista's Favorite",10,3,false),
  badge('streak_4','habits','On a Roll','On a Roll',4,1,false),badge('full_send','hidden','Full Send','Full Send',4,2,false,{hidden:true})],error:null};
 const fresh=await c.loadBadges(true);
 assert.deepEqual([...calls],['my_achievements']);assert.deepEqual([...fresh.map(b=>b.key)],['coffee_1'],'newly earned badges are returned to celebrate');
 assert.equal(renders,1,'the Passport redraws when badges first arrive');
 assert.equal((await c.loadBadges()).length,0,'a second open within a minute does not call the database again');assert.equal(calls.length,1);

 let page=c.badgePage();
 assert.match(page,/BEAN COUNTER\|COMUNA · 2026/,'earned badges are drawn as stamps; a title matching the name is not repeated');
 assert.match(page,/data-wear="coffee_1"/,'earned badges can be worn');
 assert.match(page,/3 of 10/,'locked badges show progress');
 assert.doesNotMatch(page,/Full Send/,'hidden badges stay secret until earned');
 assert.match(page,/1 hidden badge left to find/);
 assert.match(page,/1 of 3 earned/,'the count leaves out hidden badges you have not found');

 await c.wearTitle('coffee_1');
 assert.deepEqual(JSON.parse(JSON.stringify(updates[0])),{t:'profiles',v:{title_key:'coffee_1'},col:'id',id:'joe'});
 assert.equal(c.S.titleKey,'coffee_1');assert.equal(c.myTitle(),'Bean Counter');assert.match(toasts.at(-1),/Bean Counter/);
 assert.match(c.badgePage(),/You're wearing <b>Bean Counter<\/b>/);
 await c.wearTitle('coffee_1');
 assert.deepEqual(JSON.parse(JSON.stringify(updates[1].v)),{title_key:null},'tapping the title you wear takes it off');assert.equal(c.myTitle(),'');
 updateError={message:'You haven\'t earned that title yet.'};
 await c.wearTitle('coffee_2');
 assert.equal(c.S.titleKey,null,'a refused title is not kept on the phone');assert.match(toasts.at(-1),/Couldn't change your title/);

 c.S.signedUp=false;
 assert.match(c.badgePage(),/data-badge-signup/,'guests are asked to make an account');
 reply={data:null,error:{message:'Failed to fetch'}};c.S.signedUp=true;c.S.badges=null;
 assert.equal((await c.loadBadges(true)).length,0);assert.match(c.badgePage(),/Couldn't load your badges/,'a failed load says so');
 console.log('Badge checks passed: loads once a minute, celebrates new ones, stamps and progress, hidden stay secret, wear and remove titles, refusals, guests, offline.');
})().catch(e=>{console.error(e);process.exitCode=1;});
