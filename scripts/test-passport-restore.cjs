// Run: node scripts/test-passport-restore.cjs. No live account reads or writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const block=source.slice(source.indexOf('let passportRestoreId='),source.indexOf('async function finishAuth(){'));
const user={id:'joe',email:'joe@example.test',is_anonymous:false};
const profile={name:'Joe',neighborhood:'Santa Monica',interests:[],lat:34,lng:-118,points:665,created_at:'2026-10-01T00:00:00Z'};
function fixture(){return {
 checkins:[{id:1,user_id:'joe',event_id:'EVT-1',venue:'Venue A',neighborhood:'Santa Monica',category:'arts'}, {id:2,user_id:'joe',event_id:'EVT-1',venue:'Venue A',neighborhood:'Santa Monica',category:'arts'}, {id:3,user_id:'joe',event_id:'EVT-2',venue:'Archived venue',neighborhood:'Santa Monica',category:'arts'}, {id:4,user_id:'joe',event_id:'SUB-7',venue:'Community & Arts',neighborhood:'Unknown area',category:'community'}, {id:5,user_id:'other',event_id:'EVT-9',venue:'Other account',category:'arts'}],
 rsvps:[{user_id:'joe',event_id:'EVT-1'},{user_id:'joe',event_id:'SUB-7'},{user_id:'joe',event_id:'88'},{user_id:'other',event_id:'EVT-9'}],
 events:[{event_id:'EVT-1',lat:34.01,lng:-118.49,tier:'Hidden Gem'}],event_submissions:[]
};}
function setup(data=fixture()){
 const log=[],calls={save:0,profileWrite:0},flags={fail:null,gate:null};
 const sb={auth:{getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user},error:null})},async rpc(fn,args){log.push({rpc:fn,args});
  if(fn==='check_in'){ if(flags.refuse===args.p_event_id) return {error:{code:'P0001',message:'This event isn\'t happening today, so check-in isn\'t open.'}};
   (data.checkins=data.checkins||[]).push({id:data.checkins.length+100,user_id:'joe',event_id:args.p_event_id,venue:'Guest venue '+args.p_event_id,category:'arts',distance_m:args.p_lat==null?null:20}); }
  return {error:null};},from(table){
  const filters=[];
  const result=()=>({data:(data[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v)),error:flags.fail===table?{message:'offline'}:null});
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},async range(start,end){log.push({table,filters:[...filters],start,end});if(flags.gate && table==='checkins')await flags.gate;const r=result();return {...r,data:r.data.slice(start,end+1)};},async in(k,keys){log.push({table,keys});return {data:(data[table]||[]).filter(r=>keys.includes(r[k])),error:flags.fail===table?{message:'unavailable'}:null};},async maybeSingle(){return {data:profile,error:flags.fail===table?{message:'offline'}:null};},async insert(rows){(data[table]=data[table]||[]).push(...rows.map((r,i)=>({id:100+i,...r})));return {error:null};},async upsert(rows){return q.insert(rows);}};return q;
 }};
 const context={planDayKey:d=>d.toISOString().slice(0,10),today0:()=>new Date(2026,9,20),sb,console:{warn(){}},S:{accountId:'joe',places:{old:{n:1}},rsvp:[],checked:[],visits:0,points:665,monthPts:665},authed:user,myPtsAt:0,current:'passport',HOODS:[{name:'Santa Monica',city:'Santa Monica'}],HOOD_RENAMED:{},Date,Number,Map,Set,Promise,
 save(){calls.save++;},dbStatus(){},rebuildMap(){},renderNames(){},updateDot(){},renderPassport(){},renderProfile(){},renderPlans(){},renderHome(){},
 hoodByName:name=>({name}),fixInterests:x=>x,catKey:x=>x,tierKey:t=>t==='Hidden Gem'?'niche':'popup',toast(){},flushFeedback(){},myCats:()=>[],go(){},shortName:()=> 'Joe',dbProfile(){calls.profileWrite++;},history:[],authMode:'signin',filter:'All'};
 vm.createContext(context);vm.runInContext(block+'\nthis.freshPassport=freshPassport;',context);
 for(const name of ['finishAuth','checkAccount','dbUser']){
  const start=source.indexOf(`async function ${name}(){`),end=source.indexOf('\n}',start)+2;
  vm.runInContext(source.slice(start,end),context);
 }
 vm.runInContext(source.slice(source.indexOf('const checkinArgs='),source.indexOf('\n',source.indexOf('const checkinArgs='))),context);
 vm.runInContext(source.slice(source.indexOf('function logGuest('),source.indexOf('// real "N going"')),context);
 return {c:context,log,calls,flags};
}
(async()=>{
 const {c,log,calls}=setup();
 assert.equal((await c.dbUser()).id,'joe');c.S.accountId='other';assert.equal(await c.dbUser(),null,'writes must wait until the cache belongs to the session user');c.S.accountId='joe';
 c.applyAccountProfile(user,profile);
 assert.equal(await c.restorePassport(user),true);
 assert.equal(c.S.visits,4);assert.equal(Object.keys(c.S.places).length,3);assert.equal(c.S.places['Venue A'].n,2);
 assert.equal(c.S.places['Venue A'].lat,34.01);assert.equal(c.S.places['Archived venue'].hood,'Santa Monica');
 assert.equal(c.S.places['Archived venue'].lat,null);assert.equal(c.S.places['Community & Arts'].lat,null);
 assert.deepEqual(Array.from(c.S.checked),[100001,100002,200007]);assert.deepEqual(Array.from(c.S.rsvp),[100001,200007,88]);
 assert.equal(c.S.points,665);assert.equal(c.S.monthPts,665);assert.equal(calls.profileWrite,0);
 assert.ok(log.filter(x=>x.table==='checkins'||x.table==='rsvps').every(x=>x.filters.some(([k,v])=>k==='user_id'&&v==='joe')));
 assert.equal(await c.restorePassport(user),true);assert.equal(c.S.visits,4);assert.equal(c.S.places['Venue A'].n,2,'restoring twice must not award or duplicate attendance');
 for(const bad of ['EVT-NaN','SUB-7<script>','foo','-3','9007199254740992'])assert.equal(c.historyEventId(bad),null);
 const failure=setup();failure.flags.fail='rsvps';const old=failure.c.S.places;
 assert.equal(await failure.c.restorePassport(user),false);assert.equal(failure.c.S.places,old,'failed reads keep cached stamps');
 const metadata=setup();metadata.flags.fail='events';assert.equal(await metadata.c.restorePassport(user),true);assert.equal(metadata.c.S.places['Venue A'].hood,'Santa Monica');
 const empty=setup({checkins:[],rsvps:[],events:[],event_submissions:[]});assert.equal(await empty.c.restorePassport(user),true);assert.equal(empty.c.S.visits,0);assert.equal(Object.keys(empty.c.S.places).length,0,'successful empty history is authoritative');
 const stale=setup();let release;stale.flags.gate=new Promise(resolve=>release=resolve);const pending=stale.c.restorePassport(user);
 stale.c.freshPassport();stale.c.authed={id:'other'};stale.c.S.accountId='other';release();assert.equal(await pending,false);assert.equal(stale.c.S.accountId,'other');assert.equal(Object.keys(stale.c.S.places).length,0);
 const local=setup();let resume;local.flags.gate=new Promise(resolve=>resume=resolve);const waiting=local.c.restorePassport(user);vm.runInContext('passportRevision++',local.c);local.c.S.visits=1;resume();assert.equal(await waiting,false);assert.equal(local.c.S.visits,1,'late reads must not overwrite a fresh local action');
 const paginated=fixture();paginated.checkins=Array.from({length:1001},(_,i)=>({id:i,user_id:'joe',event_id:'EVT-1',venue:'Venue A',category:'arts'}));const pages=setup(paginated);await pages.c.restorePassport(user);assert.equal(pages.c.S.visits,1001);assert.equal(pages.log.filter(x=>x.table==='checkins').length,3);
 const login=setup();login.c.S.accountId=null;await login.c.finishAuth();assert.equal(login.c.S.visits,4);assert.equal(login.c.S.points,665);assert.equal(login.calls.profileWrite,0);
 const reopen=setup();reopen.c.S.signedUp=false;reopen.c.S.accountId=null;await reopen.c.checkAccount();assert.equal(reopen.c.S.signedUp,true);assert.equal(reopen.c.S.visits,4);assert.equal(reopen.calls.profileWrite,0,'opening must read profile before any write');
 const guest=setup();Object.assign(guest.c.S,{accountId:null,guest:true,deviceId:'phone-1',points:200,feedbackQueue:[],guestLog:[{t:'checkin',event_id:'EVT-5',venue:'Guest venue',category:'arts',distance_m:20},{t:'checkin',event_id:'EVT-7',venue:'Guest venue',category:'arts',distance_m:30,lat:34.02,lng:-118.48,accuracy:15,at:'2026-10-19T19:00:00Z'},{t:'checkin',event_id:'EVT-8',lat:34,lng:-118,at:'2026-10-19T19:00:00Z'},{t:'rsvp',event_id:'EVT-6',kind:'interested'}]});
 guest.flags.refuse='EVT-8';
 await guest.c.finishAuth();assert.equal(guest.c.S.guest,false);assert.equal(guest.c.S.points,865,'a guest signing in keeps the points earned on this phone');
 assert.equal(guest.c.S.visits,6);assert.ok(guest.c.S.places['Guest venue EVT-5'],'guest stamps upload to the account');assert.equal(guest.c.S.guestLog.length,0,'refused check-ins are dropped, not retried forever');
 const checks=guest.log.filter(x=>x.rpc==='check_in').map(x=>JSON.parse(JSON.stringify(x.args)));
 assert.deepEqual(checks[0],{p_event_id:'EVT-5',p_lat:null,p_lng:null,p_accuracy:null,p_at:null},'a guest stamp from before locations were kept goes up unverified');
 assert.deepEqual(checks[1],{p_event_id:'EVT-7',p_lat:34.02,p_lng:-118.48,p_accuracy:15,p_at:'2026-10-19T19:00:00Z'},'the database gets where and when the guest checked in');
 assert.ok(!guest.c.S.places['Guest venue EVT-8'],'a check-in the database refuses earns no stamp on the account');
 const offline=setup();Object.assign(offline.c.S,{accountId:null,guest:true,deviceId:'phone-2',points:0,feedbackQueue:[],guestLog:[{t:'checkin',event_id:'EVT-5',lat:34,lng:-118,at:'2026-10-19T19:00:00Z'}]});
 offline.c.sb.rpc=async fn=>fn==='check_in'?{error:{message:'Failed to fetch'}}:{error:null};
 await offline.c.finishAuth();assert.equal(offline.c.S.guestLog.length,1,'check-ins that could not reach the database wait for the next launch');
 assert.ok(guest.c.S.rsvp.includes(100006),'guest saves upload to the account');
 assert.equal(JSON.stringify(guest.log.filter(x=>x.rpc&&x.rpc!=='check_in')),JSON.stringify([{rpc:'guest_converted',args:{p_device:'phone-1'}}]),'a guest signing in links this phone\'s guest activity to the account');
 console.log('Passport restoration checks passed: sign-in, session reopen, history pagination, archived/deleted venues, Plans, repeat loads, account isolation, stale responses and read failures.');
})().catch(e=>{console.error(e);process.exitCode=1;});
