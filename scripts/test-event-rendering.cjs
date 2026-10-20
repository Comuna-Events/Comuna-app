// Browser regression checks. Requires Playwright and Chromium; no production services are contacted.
// Run: node scripts/test-event-rendering.cjs (optional CHROMIUM_PATH and COMPARE_HTML).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const before=process.env.COMPARE_HTML ? fs.readFileSync(process.env.COMPARE_HTML,'utf8') : null;
// Expose an eval hook only in the local test response, inside the app's private closure.
const instrument=html=>{const end=html.lastIndexOf('})();\n</script>');return html.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+html.slice(end);};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/before.html' && before){res.setHeader('content-type','text/html');return res.end(instrument(before));}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch(e){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const systemChromium=process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath:systemChromium,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  // No auth, API writes, external images, fonts or Mapbox traffic in this test.
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  async function setup(file='/index.html'){
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+file,{waitUntil:'load'});
   await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
   const evaluate=page.evaluate.bind(page);
   page.evaluate=(fn,arg)=>evaluate(code=>window.__comunaTestEval(code),`(${fn.toString()})(${JSON.stringify(arg)||'undefined'})`);
   await page.evaluate(()=>{
    Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',nb:'Silver Lake',loc:{lat:34.0869,lng:-118.2702},rsvp:[],checked:[],places:{},interests:[]});
    window.makeTestEvent=overrides=>({id:100001,eid:'EVT-1',title:"A Summer's Night & Music",venue:'Rhythm & Bleu',category:'community',sub:'',kind:'popup',lat:34.0869,lng:-118.2702,area:'Silver Lake',time:'Today · 7 PM',desc:'Music, food & friends.',host:'Arts & Culture',parking:'Street parking & nearby lots.',price:'Paid',age:'All ages',setting:'Indoor',rsvpReq:true,ticket:'https://example.com/tickets?a=1&b=2',source:'https://example.com/event',rec:'Daily',recDetail:'Every day',start:new Date(new Date().setHours(0,0,0,0)),end:null,t0:'00:00',t1:'23:59',verified:true,mi:0,...overrides});
    events=[makeTestEvent()];eventsState='live';filter='All';tier='any';when='any';go('home',false);renderHome();
   });
   assert.deepEqual(errors,[],'page should boot without JavaScript errors');
   return page;
  }
  const page=await setup();
  async function normalSnapshot(p){return p.evaluate(()=>{
   renderHome();const card=document.querySelector('#picks .pick'),rect=card.getBoundingClientRect();
   openSheet(100001);
   return {cardText:card.textContent,title:document.querySelector('#sheet h2').textContent,desc:document.querySelector('#sheet .desc').textContent,venue:document.querySelector('#sheet .evwhere').textContent,link:document.getElementById('rsvpBtn').getAttribute('href'),width:rect.width,height:rect.height,badges:document.querySelector('#sheet .badges').textContent};
  });}
  if(before){const baseline=await setup('/before.html');assert.deepEqual(await normalSnapshot(page),await normalSnapshot(baseline),'normal event layout/text/links must be unchanged');await baseline.close();}
  assert.equal((await normalSnapshot(page)).title,"A Summer's Night & Music");
  if(process.env.RENDER_SCREENSHOT) await page.screenshot({path:process.env.RENDER_SCREENSHOT});
  const payload='<img src=x onerror="window.__injected=1"><svg onload="window.__injected=1"></svg> & "quotes"';
  await page.evaluate(payload=>{
   window.__injected=0;
   const ev=makeTestEvent({title:payload,venue:payload,desc:payload+'\nSecond line',host:payload,parking:payload,recDetail:payload,area:payload,age:payload});
   events=[ev];S.rsvp=[ev.id];enrich();openSheet(ev.id,()=>{},payload);
  },payload);
  async function harmless(selector){
   assert.equal(await page.locator(selector+' img,'+selector+' script,'+selector+' iframe,'+selector+' [onload],'+selector+' [onerror],'+selector+' [onclick]').count(),0,'untrusted markup must not create elements or handlers');
   assert.equal(await page.evaluate(()=>window.__injected),0,'no injected script may run');
  }
  await harmless('#sheet');
  assert.equal(await page.locator('#sheet h2').textContent(),payload);
  assert.equal(await page.locator('#sheet .desc').innerText(),payload+'\nSecond line');
  assert.equal(await page.locator('#sheetBack').textContent(),'','back is icon-only; its destination is in the aria-label');
  assert.equal(await page.locator('#sheetBack').getAttribute('aria-label'),'Back to '+payload);
  for(const verified of [false,true]){
   await page.evaluate(verified=>{events[0].verified=verified;openSheet(events[0].id);},verified);
   await harmless('#sheet');assert.equal(await page.locator('#sheet h2').textContent(),payload);
  }
  await page.evaluate(()=>{renderHome();showPicks(events);});
  await harmless('#picks');await harmless('#recList');
  assert.equal(await page.locator('#picks .t').textContent(),payload);
  await page.evaluate(()=>openVenue(events));await harmless('#sheet');
  assert.equal(await page.locator('#sheet .vrow .t').textContent(),payload);
  await page.evaluate(()=>{calSel=new Date(new Date().setHours(0,0,0,0));renderPlans();renderAlerts();});
  await harmless('#planList');await harmless('#alertList');
  assert.equal(await page.locator('#planList .t').textContent(),payload);
  assert.ok((await page.locator('#alertList .t').textContent()).endsWith(': '+payload),'alert should display the original title without double escaping');
  await page.evaluate(()=>showRsvp(events[0],10));await harmless('#stampModal');
  assert.equal(await page.locator('#stampModal svg').getAttribute('aria-label'),'RSVP stamp for '+payload);
  await page.evaluate(()=>{checkIn(events[0],0);renderPassport();});
  await harmless('#stampModal');await harmless('#passPage');
  assert.equal(await page.locator('#passPage .slot svg').first().getAttribute('aria-label'),payload+' stamp');
  for(const url of ['javascript:alert(1)','data:text/html,<svg onload=alert(1)>','vbscript:msgbox(1)','//evil.example/test']){
   await page.evaluate(url=>{S.rsvp=[];S.checked=[];events=[makeTestEvent({ticket:url,source:url})];openSheet(events[0].id);},url);
   assert.equal(await page.locator('#sheet a.evlink,#sheet a#rsvpBtn').count(),0,'unsafe URLs must not become event links');
  }
  await page.evaluate(()=>{events=[makeTestEvent({ticket:'https://example.com/?q=" onmouseover="alert(1)&b=2'})];S.rsvp=[];openSheet(events[0].id);});
  await harmless('#sheet');
  assert.equal(await page.locator('#rsvpBtn').getAttribute('target'),'_blank');
  assert.match(await page.locator('#rsvpBtn').getAttribute('rel'),/noopener/);
  const raw=await page.evaluate(()=>{
   const ev=makeTestEvent({venue:'Rhythm & Bleu',address:''});
   return {direction:new URL(directionsUrl(ev)).searchParams.get('destination')||new URL(directionsUrl(ev)).searchParams.get('daddr'),title:ev.title,lines:escLines('A & B\nC < D'),safe:okLink('https://example.com/?a=1&b=2')};
  });
  assert.equal(raw.direction,'Rhythm & Bleu, Los Angeles, CA');
  assert.equal(raw.lines,'A &amp; B<br>C &lt; D');
  assert.equal(raw.safe,'https://example.com/?a=1&b=2');
  await page.close();await context.close();
  console.log('Event rendering browser checks passed: normal layout, cards, venue/details, Plans, alerts, stamps, hostile text, URL schemes and attributes.');
 } finally {await browser.close();}
})().then(()=>server.close()).catch(e=>{console.error(e);server.close();process.exitCode=1;});
