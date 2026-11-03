// Local browser regression: a location outside LA (the iPhone Simulator and App Review are in Cupertino) still shows
// LA events: the map, distances and today's picks start from your neighborhood, and there's no "you are here" dot.
// Run: node scripts/test-outside-la.cjs   (CHROMIUM_PATH=/path/to/chromium if it isn't at /usr/bin/chromium)
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
const CUPERTINO={latitude:37.3349,longitude:-122.009};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles',geolocation:CUPERTINO,permissions:['geolocation']});
  await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  const run=(fn,arg)=>page.evaluate(code=>window.__comunaTestEval(code),`(${fn.toString()})(${JSON.stringify(arg)||'undefined'})`);
  // someone signed up in Echo Park whose phone now says Cupertino
  const r=await run(()=>{
   Object.assign(S,{signedUp:true,kitSeen:true,nb:'Echo Park',loc:{lat:37.3349,lng:-122.009},rsvp:[],rsvpDates:{},checked:[],places:{},interests:[],pickShown:{},pickTapped:{},pickNope:{}});
   const t=new Date();t.setHours(0,0,0,0); const h=hoodByName('Echo Park');
   events=[{id:1,eid:'EVT-1',title:'Echo Park thing',venue:'V',area:'',time:'',desc:'',host:'',tags:[],vibes:[],recDetail:'',end:null,t0:'20:00',t1:'23:00',kind:'regular',category:'food',sub:'',rec:'One-off',start:t,lat:h.lat+0.003,lng:h.lng}];
   eventsState='live';
   return { inLA:inLA(S.loc), echo:inLA(h), santaMonica:inLA(hoodByName('Santa Monica')), origin:origin(), hood:{lat:h.lat,lng:h.lng}, picks:dailyPicks().map(e=>e.id), mi:events[0].mi };
  });
  assert.equal(r.inLA,false,'Cupertino is not LA');
  assert.equal(r.echo,true); assert.equal(r.santaMonica,true,'a city in the county counts');
  assert.deepEqual(r.origin,r.hood,'distances start from your neighborhood');
  assert.deepEqual(r.picks,[1],'today\'s picks still find LA events');
  assert.ok(r.mi<1,'the event is under a mile from your neighborhood');
  // inside LA, your real location is used
  assert.deepEqual(await run(()=>{ S.loc={lat:34.0195,lng:-118.4912}; return origin(); }),{lat:34.0195,lng:-118.4912});
  // the location button outside LA keeps your neighborhood and says so
  await run(()=>{ S.loc=null; window.__toasts=[]; const t=toast; toast=m=>{ window.__toasts.push(m); t(m); }; });
  await run(()=>{ go('home',false); });
  const btn=await page.$('#locBtn, [aria-label="Center map on my location"]');
  if(btn){ await btn.click(); await page.waitForFunction(()=>window.__comunaTestEval('window.__toasts.length')>0,null,{timeout:10000});
   assert.match((await run(()=>window.__toasts)).join(' '),/outside LA, so the map stays on Echo Park/);
   assert.equal(await run(()=>S.loc),null,'Cupertino isn\'t saved as your location'); }
  else console.warn('no location button found; skipped that check');
  assert.deepEqual(errors,[],errors.join('\n'));
  console.log('Outside-LA checks passed: neighborhood fallback for the map, distances and picks; location button keeps the neighborhood.');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
