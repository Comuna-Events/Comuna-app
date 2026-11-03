// Local browser regression: today's picks ("Tonight in <neighborhood>") change from day to day, and the card shows them.
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
   events.push({...base,id:50,eid:'EVT-50',title:'One night only',kind:'popup',rec:'One-off',start:at(0),category:cats[1],lat:S.loc.lat+0.03});
   events.push({...base,id:51,eid:'EVT-51',title:'Closing weekend',kind:'regular',rec:'',start:at(-20),end:at(1),category:cats[2],lat:S.loc.lat+0.035});
   events.push({...base,id:52,eid:'EVT-52',title:'Far festival',kind:'cornerstone',rec:'One-off',start:at(3),category:cats[0],lat:S.loc.lat+0.12});
   eventsState='live';
  });
  const noon=await run(()=>{ const d=new Date(); d.setHours(12,0,0,0); return +d; });   // the phone's noon (Los Angeles)
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
  for(const p of days) assert.match(p[3].why,/Worth the drive|Out of your lane|Last chance|Just dropped/,'slot 4 is the wildcard');
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
  // the card: "Today/Tonight/This week in <neighborhood>", reasons, no category icons, no buttons but the ×, mood row
  await run(()=>{ S.pickShown={}; S.pickTapped={}; S.nb='Silver Lake'; S.places={};
   const t=new Date();t.setHours(0,0,0,0);
   const base={venue:'Bar',area:'',time:'',desc:'',host:'',tags:[],recDetail:'',end:null,t0:'21:00',t1:'23:30',lng:S.loc.lng,kind:'regular',sub:'',rec:'One-off',start:t,price:'Free'};
   events=[
    {...base,id:201,eid:'EVT-201',title:'Late jazz',category:'arts',vibes:['live music','late night'],lat:S.loc.lat+0.004},
    {...base,id:202,eid:'EVT-202',title:'Supper club',category:'food',vibes:['date night'],price:'Paid',lat:S.loc.lat+0.006},
    {...base,id:203,eid:'EVT-203',title:'Pottery hour',category:'classes',vibes:['chill','creative'],t0:'18:00',lat:S.loc.lat+0.008},
    {...base,id:204,eid:'EVT-204',title:'Far fair',category:'markets',vibes:['festive'],lat:S.loc.lat+0.11}];
  });
  await page.clock.setFixedTime(noon+40*864e5+7*36e5);   // 7 PM
  await run(()=>{ const t=new Date();t.setHours(0,0,0,0); events.forEach(e=>{e.start=t;}); showPicks(dailyPicks()); });
  await page.waitForSelector('#recModal.on');
  assert.equal(await page.textContent('#recTitle'),'Tonight in Silver Lake');
  assert.equal(await page.textContent('#recSum'),'4 picks for tonight.');
  assert.equal(await page.locator('#recList .pick .n').count(),0,'no category icons');
  assert.equal(await page.locator('#recModal .btn').count(),0,'no buttons under the picks');
  assert.match(await page.textContent('#recList'),/One night only/);
  assert.match(await page.textContent('#recList'),/Worth the drive|Out of your lane/);
  assert.match(await page.textContent('#recList'),/Live music · Late night/,'vibes as the signal line');
  assert.doesNotMatch(await page.textContent('#recList'),/going|liked|checked in/i,'nothing that needs other users');
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT});
  const moods=await page.locator('#recMoods .chip').allTextContents();
  assert.deepEqual(moods,['Anything','Chill','Social','Out late','Cheap']);
  await page.click('#recMoods [data-mood="chill"]');
  assert.deepEqual(await run(()=>[...document.querySelectorAll('#recList [data-rec]')].map(b=>+b.dataset.rec)),[203],'Chill keeps the chill ones');
  await page.click('#recMoods [data-mood=""]');
  assert.equal(await page.locator('#recList .pick').count(),4);
  // once you have a stamp, an unstamped neighborhood is a "New stamp for you"
  await run(()=>{ S.places={'Somewhere':{n:1,lat:34.2,lng:-118.6}}; renderPicks(dailyPicks()); });
  assert.match(await page.textContent('#recList'),/New stamp for you/);
  assert.match(await page.textContent('#recList'),/Your first .+ stamp/);
  // Just dropped: added in the last two days, labelled with when
  await run(()=>{ S.places={}; const e=events.find(x=>x.id===203); e.added=Date.now()-6*36e5; renderPicks(dailyPicks()); });
  assert.match(await page.textContent('#recList'),/Just dropped/);
  assert.match(await page.textContent('#recList'),/Added 6 hours ago/);
  await run(()=>{ events.find(x=>x.id===203).added=Date.now()-3*864e5; renderPicks(dailyPicks()); });
  assert.doesNotMatch(await page.textContent('#recList'),/Just dropped/,'three days old is not new');
  // Not for me: the pick goes, a different one takes its place, and it never comes back
  await run(()=>{ const t=new Date();t.setHours(0,0,0,0);
   events.push({...events[0],id:205,eid:'EVT-205',title:'Spare comedy',category:'community',vibes:['late night'],lat:S.loc.lat+0.01,added:0});
   S.pickNope={}; S.pickTaste=null; renderPicks(dailyPicks()); });
  const before=await run(()=>[...document.querySelectorAll('#recList [data-rec]')].map(b=>+b.dataset.rec));
  await page.click(`#recList [data-nope="${before[0]}"]`);
  await page.waitForFunction(id=>!document.querySelector(`#recList [data-rec="${id}"]`),before[0]);
  const after=await run(()=>[...document.querySelectorAll('#recList [data-rec]')].map(b=>+b.dataset.rec));
  assert.ok(!after.includes(before[0]),'the dismissed pick is gone');
  assert.equal(after.length,4,'another pick takes its place');
  assert.ok(await run(id=>!dailyPicks().some(e=>e.id===id) && S.pickNope[id]!=null,before[0]),'it stays gone');
  assert.ok(await run(id=>{ const ev=events.find(e=>e.id===id); return tastePenalty(ev)>0; },before[0]),'its category and vibes count against similar ones');
  assert.ok(await run(()=>JSON.parse(localStorage.getItem('comuna_v3')).pickNope),'saved on the phone');
  await page.click('#recClose');
  assert.equal(await page.locator('#recModal.on').count(),0,'× goes back to the map');
  assert.ok(!errors.length,errors.join('\n'));
  console.log('daily picks: ok');
  console.log(ids.map((p,d)=>`day ${d}: ${p.join(', ')}`).join('\n'));
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
