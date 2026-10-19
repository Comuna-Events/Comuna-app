// Run: node scripts/test-points.cjs. Executes app award paths without network writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',classList:{add(){},remove(){}}});return elements.get(id);};
const toasts=[],sent=[];
const c={console,Date,Set,Map,passportRevision:0,S:{places:{},rsvp:[],checked:[],visits:0,points:0,rated:[]},
 document:{getElementById:get},overlay:{classList:{add(){},remove(){}}},sheet:get('sheet'),
 hoodByName:()=>({name:'Test',city:'Test'}),cityOf:()=> 'Test',visitedHoods:()=>({}),visitedCities:()=>({}),catKey:x=>x,kindOf:()=> 'regular',
 CATS:{arts:{short:'Arts'}},save(){},dbCheckin(){},track(){},placeStamp:()=>'',escH:x=>x,renderHome(){},
 toast:x=>toasts.push(x),eidOf:ev=>ev.eid,sendFeedback:async r=>sent.push(r),dbProfile(){},current:'test',events:[],SUBCATS:{},okLink:x=>x,parseDay:x=>x};
vm.createContext(c);
vm.runInContext(source.slice(source.indexOf('const PTS='),source.indexOf('// Most events are free')),c);
const reviewStart=source.indexOf('function askHowWasIt(ev){');
vm.runInContext(source.slice(reviewStart,source.indexOf('\n}',reviewStart)+2),c);
const ev={id:1,eid:'EVT-1',venue:'Venue',title:'Event',category:'arts'};
(async()=>{
 for(const saved of [false,true]){
  c.S.places={};c.S.rsvp=saved?[1]:[];c.S.points=0;
  c.checkIn(ev,20);assert.equal(c.S.points,100,'first visit has no bonus, saved or unsaved');
  c.checkIn({...ev,id:2,eid:'EVT-2'},20);assert.equal(c.S.points,200,'repeat visit earns the same amount');
 }
 c.S.points=0;c.askHowWasIt(ev);assert.match(c.sheet.innerHTML,/review · \+100 points/);
 get('fbText').value='';await get('fbSend').onclick();assert.equal(c.S.points,0,'empty review earns nothing');
 c.askHowWasIt(ev);get('fbText').value='Great experience';await get('fbSend').onclick();assert.equal(c.S.points,100);
 c.askHowWasIt(ev);await get('fbSend').onclick();assert.equal(c.S.points,100,'repeat review earns no second reward');
 assert.equal(sent.length,2);
 const rows=Array.from({length:4},(_,i)=>({id:i+1,user_id:'user',created_at:`2026-10-19T0${i}:00:00Z`,title:'Event',link:'https://example.com',lat:34}));
 c.sb={from:()=>({select:()=>({eq:async()=>({data:rows,error:null})})}),auth:{getSession:async()=>({data:{session:{user:{id:'user'}}}})}};
 vm.runInContext(source.slice(source.indexOf('let communityEvents='),source.indexOf('\n\n\n',source.indexOf('let communityEvents='))),c);
 c.S.points=0;await c.loadSubmissions();assert.equal(c.S.points,300,'first three approvals earn 100 each');
 await c.loadSubmissions();assert.equal(c.S.points,300,'reloading approvals never credits twice');
 console.log('Points checks passed: equal visit rewards, empty/repeat reviews, 100-point reviews, approval rewards and weekly cap.');
})().catch(e=>{console.error(e);process.exitCode=1;});
