const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
let now=new Date(2026,9,20,12), storedICS;
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',hidden:false});return els.get(id);};
const c={Date,Math,Intl,Set,Object,console,S:{rsvp:[],rsvpDates:{},checked:[]},events:[],eventNow:()=>new Date(now),save(){},enrich(){},document:{getElementById:el,body:{appendChild(){}},createElement:()=>({click(){},remove(){}})},Blob,URL:{createObjectURL(blob){storedICS=blob;return 'test:';},revokeObjectURL(){}},setTimeout(){},toast(){},catDot:()=>'',escH:s=>s||'',vCheck:()=>'',mins:()=>1,goingText:()=>'',needsRsvp:()=>false,FULL_WD:['sunday','monday','tuesday','wednesday','thursday','friday','saturday']};
vm.createContext(c);
for(const name of ['hm','occurrenceEnd','occursOn','nextDate','fmtTime','ordinal','addToCalendar']){
 const start=source.indexOf('function '+name+'('),end=['hm','ordinal'].includes(name)?source.indexOf('\n',start):source.indexOf('\n}',start)+2;
 vm.runInContext(source.slice(start,end),c);
}
vm.runInContext(source.slice(source.indexOf('// Plans belong to individual'),source.indexOf('/* ---------- daily Top 4:')),c);
vm.runInContext(source.slice(source.indexOf("const WD=['Sun'"),source.indexOf('function occursOn(')).replace("const FULL_WD=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];",''),c);
vm.runInContext(source.slice(source.indexOf('function renderPlans(){'),source.indexOf("document.querySelector('[data-s=\"plans\"]')")),c);
const day=n=>new Date(2026,9,n),ev=(id,rec)=>({id,title:rec,rec,start:day(20),end:day(31),t0:'19:00',t1:'21:00',venue:'Venue'});
const weekly=ev(1,'Weekly'),daily=ev(2,'Daily');c.events.push(weekly,daily);
c.rememberPlan(weekly,day(20));c.rememberPlan(daily,day(21));
assert.deepEqual(Array.from(c.S.rsvp),[1,2]);
assert.equal(c.hasPlan(weekly,day(20)),true);assert.equal(c.hasPlan(weekly,day(27)),false);
assert.equal(c.hasPlan(daily,day(21)),true);assert.equal(c.hasPlan(daily,day(22)),false);
c.rememberPlan(weekly,day(27));c.rememberPlan(weekly,day(27));assert.equal(c.savedPlanDates(weekly).length,2);
c.forgetPlan(weekly,day(20));assert.equal(c.hasPlan(weekly,day(27)),true);assert.equal(c.hasPlan(weekly,day(20)),false);
c.renderPlans();assert.ok(el('calGrid').innerHTML.includes('mine" data-day="21"'));assert.ok(!el('calGrid').innerHTML.includes('mine" data-day="22"'));
assert.ok(!el('planList').innerHTML.includes('Weekly'),'other occurrences must not be saved on the selected day');
vm.runInContext('calSel=new Date(2026,9,27);renderPlans();',c);assert.ok(el('planList').innerHTML.includes('Weekly'));assert.ok(!el('planList').innerHTML.includes('Daily'));
// Old device-only saves acquire exactly one fixed date on upgrade.
c.S.rsvp.push(3);const legacy=ev(3,'Weekly');c.events.push(legacy);assert.equal(c.hasPlan(legacy,day(20)),true);
now=new Date(2026,9,27,12);assert.equal(c.hasPlan(legacy,day(27)),false);
// Calendar download uses the selected future occurrence and has no recurrence rule.
c.addToCalendar({...weekly,occurrenceDate:'2026-10-27'});
(async()=>{
 const ics=await storedICS.text();assert.ok(ics.includes('DTSTART:20261027T190000'));assert.ok(!ics.includes('RRULE:'));
 // Exercise actual persistence and cancellation paths, not only date helpers.
 const filters=[],writes=[];c.eidOf=e=>String(e.id);c.dbUser=async()=>({id:'user'});c.dbProfile=()=>{};c.loadGoing=()=>{};c.dbStatus=()=>{};c.renderHome=()=>{};c.passportRevision=0;c.S.signedUp=true;
 c.sb={from:()=>({upsert:async(row,options)=>{writes.push({row,options});return {error:null};},delete(){return this;},eq(k,v){filters.push([k,v]);return this;},select:async()=>({error:null})})};
 for(const name of ['dbRsvp','cancelPlan']){const start=source.indexOf('async function '+name+'(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);}
 await c.dbRsvp({...weekly,occurrenceDate:'2026-10-27'});assert.equal(writes[0].row.occurrence_date,'2026-10-27');assert.equal(writes[0].options.onConflict,'user_id,event_id,occurrence_date');
 c.rememberPlan(weekly,day(20));vm.runInContext('calSel=new Date(2026,9,20)',c);await c.cancelPlan(1,{textContent:'Cancel RSVP',disabled:false});
 assert.ok(filters.some(([k,v])=>k==='occurrence_date'&&v==='2026-10-20'));assert.equal(c.hasPlan(weekly,day(27)),true);assert.equal(c.hasPlan(weekly,day(20)),false);
 // Free events, including free registration links, never use the ticket arrow.
 c.okLink=u=>/^https:\/\//.test(u||'')?u:'';
 vm.runInContext(source.slice(source.indexOf('const ROUNDUP='),source.indexOf('function needsRsvp(')),c);
 vm.runInContext(source.slice(source.indexOf('function needsRsvp('),source.indexOf('function showRsvp(')),c);
 for(const price of ['Free','Donation / Pay-what-you-can','']) assert.equal(c.needsRsvp({price,rsvpReq:true,ticket:'https://example.com/register'}),false);
 assert.equal(c.needsRsvp({price:'Paid',ticket:'https://example.com/tickets'}),true);
 assert.equal(c.needsRsvp({price:'Paid'}),false);
 assert.equal(c.needsRsvp({price:'Paid',source:'https://example.com/register'}),true);
 assert.equal(c.needsRsvp({price:'Paid',ticket:'https://www.timeout.com/los-angeles/things-to-do'}),false);
 assert.equal(writes[0].row.kind,'rsvp');
 // Former Interested saves and checked-in events use the same cancellation path.
 c.S.checked.push(2);vm.runInContext('calSel=new Date(2026,9,21);renderPlans()',c);
 assert.ok(el('planList').innerHTML.includes('Cancel RSVP'));
 await c.cancelPlan(2,{textContent:'Cancel RSVP',disabled:false});
 assert.equal(c.hasPlan(daily,day(21)),false);assert.ok(c.S.checked.includes(2),'earned stamp survives RSVP cancellation');
 c.S.signedUp=false;c.rememberPlan(daily,day(22));c.S.guestLog=[{t:'rsvp',event_id:'2',kind:'interested',occurrence_date:'2026-10-22'}];
 vm.runInContext('calSel=new Date(2026,9,22)',c);await c.cancelPlan(2,{textContent:'Cancel RSVP',disabled:false});
 assert.equal(c.hasPlan(daily,day(22)),false);assert.equal(c.S.guestLog.length,0);
 assert.ok(!/Interested|INTERESTED|interested/.test(source),'all event actions use RSVP');
 console.log('Occurrence RSVP checks passed: daily/weekly isolation, multiple saves, date-scoped DB writes/cancellation, calendar markings, legacy pinning, selected-date calendar export.');
})().catch(e=>{console.error(e);process.exitCode=1;});
