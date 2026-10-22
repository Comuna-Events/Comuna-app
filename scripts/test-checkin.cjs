// Run: node scripts/test-checkin.cjs. Check-ins go through Supabase's check_in(); no network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=source.indexOf('const checkinArgs='),end=source.indexOf('\n}',source.indexOf('async function dbCheckin('))+2;
let reply={error:null};const calls=[];let profiles=0;
const c={console:{warn(){}},eidOf:ev=>ev.eid,dbProfile(){profiles++;},sb:{async rpc(fn,args){calls.push({fn,args:JSON.parse(JSON.stringify(args))});return reply;}}};
vm.createContext(c);vm.runInContext(source.slice(start,end),c);
const ev={eid:'EVT-1'},pos={lat:34.01,lng:-118.49,accuracy:12,at:'2026-10-22T19:00:00Z'};
(async()=>{
 let r=await c.dbCheckin(ev,pos);
 assert.equal(r.ok,true);assert.equal(profiles,1,'a saved check-in refreshes the profile');
 assert.deepEqual(calls[0],{fn:'check_in',args:{p_event_id:'EVT-1',p_lat:34.01,p_lng:-118.49,p_accuracy:12,p_at:null}},'a live check-in sends where the phone is and lets the database pick the time');
 reply={error:{code:'P0001',message:'You\'ve already checked in here today.'}};
 r=await c.dbCheckin(ev,pos);assert.equal(r.ok,false);assert.equal(r.msg,'You\'ve already checked in here today.','the database\'s reason is shown as-is');assert.equal(profiles,1);
 reply={error:{message:'TypeError: Failed to fetch'}};
 r=await c.dbCheckin(ev,pos);assert.equal(r.ok,false);assert.match(r.msg,/Couldn't reach Comuna/,'connection problems ask to try again, without technical detail');
 console.log('Check-in checks passed: verified call arguments, refusals shown as-is, connection failures, no profile write on refusal.');
})().catch(e=>{console.error(e);process.exitCode=1;});
