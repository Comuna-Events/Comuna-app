// Local browser regression: today's Top 4 changes from day to day.
// Run: node scripts/test-daily-picks.cjs   (CHROMIUM_PATH=/path/to/chromium if it isn't at /usr/bin/chromium)
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const instrument=html=>{const end=html.lastIndexOf('})();\n</script>');return html.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+html.slice(end);};
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  const run=(fn,arg)=>page.evaluate(code=>window.__comunaTestEval(code),`(${fn.toString()})(${JSON.stringify(arg)||'undefined'})`);
  // a neighborhood with lots of close weekly events and a few one-time / last-chance / farther ones
  await run(()=>{
   Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',loc:{lat:34.0869,lng:-118.2702},rsvp:[],rsvpDates:{},checked:[],places:{},interests:['Food & Drink'],pickShown:{},pickTapped:{}});
   const t=new Date();t.setHours(0,0,0,0);const at=n=>{const d=new Date(t);d.setDate(d.getDate()+n);return d;};
   const base={venue:'V',area:'Silver Lake',time:'',desc:'',host:'',tags:[],vibes:[],recDetail:'',end:null,t0:'10:00',t1:'23:59',lng:S.loc.lng,kind:'regular',category:'food',sub:'',rec:'Daily',start:at(-30)};
   const cats=Object.keys(CATS);
   events=[];
   for(let i=0;i<24;i++) events.push({...base,id:1+i,eid:'EVT-'+(1+i),title:'Daily '+i,category:cats[i%cats.length],kind:['regular','niche','cornerstone'][i%3],lat:S.loc.lat+0.002*(i+1)});
   events.push({...base,id:50,eid:'EVT-50',title:'One night only',kind:'popup',rec:'One-off',start:at(2),category:cats[1],lat:S.loc.lat+0.03});
   events.push({...base,id:51,eid:'EVT-51',title:'Closing weekend',kind:'regular',rec:'',start:at(-20),end:at(1),category:cats[2],lat:S.loc.lat+0.035});
   events.push({...base,id:52,eid:'EVT-52',title:'Far festival',kind:'cornerstone',rec:'One-off',start:at(3),category:cats[0],lat:S.loc.lat+0.12});
   eventsState='live';
  });
  const noon=new Date();noon.setHours(12,0,0,0);
  const pick=async dayOffset=>{ await page.clock.setFixedTime(new Date(+noon+dayOffset*864e5));
   return run(()=>{ const p=dailyPicks(); logPicks(p); return p.map(ev=>({id:ev.id,cat:ev.category,why:ev.pickWhy||'',mi:ev.mi})); }); };
  const days=[];
  for(let d=0;d<7;d++) days.push(await pick(d));
  for(const p of days) assert.equal(p.length,4,'four picks a day');
  const ids=days.map(p=>p.map(x=>x.id));
  // rare beats close
  assert.ok(ids[0].includes(50),'a one-time event makes the first day');
  assert.ok(ids[0].includes(51),'a run ending in the next few days makes the first day');
  assert.match(days[0].find(x=>x.id===51).why,/Last chance|Out of your lane/,'labelled Last chance (or as the wildcard)');
  // one wildcard a day, last, labelled
  for(const p of days) assert.match(p[3].why,/Worth the drive|Out of your lane/,'slot 4 is the wildcard');
  // no two of the same category among the nearby three
  for(const p of days){ const c=p.slice(0,3).map(x=>x.cat); assert.equal(new Set(c).size,c.length,'nearby picks differ in category'); }
  // consecutive days barely overlap; a daily event untapped isn't back within the week
  for(let d=1;d<7;d++){ const same=ids[d].filter(id=>ids[d-1].includes(id)); assert.ok(same.length<=1,`day ${d} repeats ${same} from day ${d-1}`); }
  const daily=ids.slice(0,5).flat().filter(id=>id<50), seen=new Set(daily);
  assert.equal(seen.size,daily.length,'a daily event shows at most once a week while there are fresh ones');
  // a pick you tapped yesterday isn't pushed down; one you ignored is
  await run(()=>{ S.pickShown={}; S.pickTapped={}; });
  const d20=await pick(20), tapped=d20.find(x=>x.id===50)?.id ?? d20[0].id;
  await run(id=>{ S.pickTapped[id]=pickDayNum(); },tapped);
  const scoreNext=await run(([t,o])=>{ const want=myCats(), d=pickDayNum()+1; return [pickScore(events.find(e=>e.id===t),d,want),pickScore(events.find(e=>e.id===o),d,want)]; },[tapped,51]);
  const fresh=await run(id=>{ const ev=events.find(e=>e.id===id); delete S.pickShown[id]; const s=pickScore(ev,pickDayNum()+1,myCats()); return s; },tapped);
  assert.equal(scoreNext[0],fresh,'tapping a pick removes the repeat penalty');
  // a quiet neighborhood: once the fresh ones run out, last week's come back (oldest first) rather than showing fewer
  await run(()=>{ S.pickShown={}; events=events.filter(e=>e.id<=5).map(e=>({...e,category:'food'})); });
  const q0=(await pick(30)).map(x=>x.id), q1=(await pick(31)).map(x=>x.id);
  assert.equal(q0.length,4); assert.equal(q1.length,4,'still four picks when there are only five events');
  assert.ok(q1.includes([1,2,3,4,5].find(id=>!q0.includes(id))),'the one not shown yesterday leads');
  assert.ok(!errors.length,errors.join('\n'));
  console.log('daily picks: ok');
  console.log(ids.map((p,d)=>`day ${d}: ${p.join(', ')}`).join('\n'));
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
