// Run: node scripts/test-report-event.cjs. Reporting community events; no network.
// The database side (hiding after 2 signed-in reports, blocking) is checked by scripts/test-event-reports.sql.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from);return source.slice(a,source.indexOf(to,a));};
(async()=>{
 // sending: signed in reports as the account, guests by install id, a repeat report counts as sent
 const sent=[];let reply={error:null};
 const c={console:{warn(){}},S:{guest:false,deviceId:'phone-1'},dbUser:async()=>({id:'joe'}),sb:{from:t=>({insert:async row=>{sent.push({t,row:JSON.parse(JSON.stringify(row))});return reply;}})}};
 vm.createContext(c);vm.runInContext(slice('async function dbReport(','\n// approved community events'),c);
 assert.equal(await c.dbReport({eid:'SUB-7'},'Spam or a scam'),true);
 assert.deepEqual(sent[0],{t:'event_reports',row:{event_id:'SUB-7',reason:'Spam or a scam',user_id:'joe',device_id:null}},'signed-in reports count toward hiding');
 c.S.guest=true;await c.dbReport({eid:'SUB-7'},'Something else');
 assert.deepEqual(sent[1].row,{event_id:'SUB-7',reason:'Something else',user_id:null,device_id:'phone-1'},'guests report by install id');
 reply={error:{code:'23505',message:'duplicate key'}};assert.equal(await c.dbReport({eid:'SUB-7'},'Something else'),true,'reporting again is not an error');
 reply={error:{message:'TypeError: Failed to fetch'}};assert.equal(await c.dbReport({eid:'SUB-7'},'Something else'),false,'a failed send is reported as failed');
 c.sb=null;assert.equal(await c.dbReport({eid:'SUB-7'},'x'),false);
 // loading: hidden events and ones you reported stay off the map
 const rows=[{id:1,lat:34,link:'https://a.test'},{id:2,lat:34,link:'https://b.test',hidden_at:'2026-10-22T00:00:00Z'},{id:3,lat:34,link:'https://c.test'}];
 const l={console:{warn(){}},S:{reported:['SUB-3']},events:[],okLink:x=>x,SUBCATS:{},catKey:x=>x,parseDay:()=>null,
  sb:{from:()=>({select:()=>({eq:async()=>({data:rows,error:null})})}),auth:{getSession:async()=>({data:{session:null}})}}};
 vm.createContext(l);vm.runInContext(slice('let communityEvents=','\n\n\n')+'\nthis.shown=()=>communityEvents;',l);await l.loadSubmissions();
 assert.deepEqual(l.shown().map(e=>e.eid),['SUB-1'],'hidden and self-reported events are not shown');
 assert.match(source,/\$\{ev\.community\?'<button class="reportlink" id="reportBtn">Report this event<\/button>':''\}/,'every community event page has a Report link');
 console.log('Report checks passed: signed-in and guest reports, repeats, failures, hidden and self-reported events stay off the map, report link on community events.');
})().catch(e=>{console.error(e);process.exitCode=1;});
