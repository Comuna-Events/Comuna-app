// Browser checks for the map's search bar. Requires Playwright and Chromium; no production services are contacted.
// Run: node scripts/test-search.cjs (optional CHROMIUM_PATH, SEARCH_SCREENSHOT=path.png).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
// Expose an eval hook only in the local test response, inside the app's private closure.
const instrument=html=>{const end=html.lastIndexOf('})();\n</script>');return html.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+html.slice(end);};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch(e){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const systemChromium=process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath:systemChromium,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/index.html',{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  const evaluate=page.evaluate.bind(page);
  page.evaluate=(fn,arg)=>evaluate(code=>window.__comunaTestEval(code),`(${fn.toString()})(${JSON.stringify(arg)||'undefined'})`);
  await page.evaluate(()=>{
   Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',nb:'Silver Lake',loc:{lat:34.0869,lng:-118.2702},rsvp:[],checked:[],places:{},interests:['Arts & Entertainment'],lastPicksDay:new Date().toDateString()});
   const day=n=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return d; };
   const base={venue:'Somewhere',category:'arts',sub:'',kind:'niche',lat:34.0869,lng:-118.2702,area:'Silver Lake',time:'',desc:'',host:'',tags:[],rec:'One-off',recDetail:'',end:null,t0:'19:00',t1:'22:00',mi:0};
   window.mk=(id,o)=>({...base,id,eid:'EVT-'+id,title:'Event '+id,start:day(1),...o});
   events=[
    mk(1,{title:'Midnight Horror Double Feature',tags:['spooky','film'],area:'Echo Park',lat:34.0969,start:day(2)}),
    mk(2,{title:'Haunted Hollow Maze',desc:'A spooky walk-through maze.',venue:'Atwater Lot',area:'Atwater Village',category:'community',start:day(20)}),
    mk(3,{title:'Jazz on the Lawn',tags:['jazz'],area:'Echo Park',start:day(1)}),
    mk(4,{title:'Night Market',category:'food',area:'Silver Lake',start:day(0)}),
    mk(5,{title:'Old Spooky Party',tags:['spooky'],start:day(-30)}),                 // finished: never shown or counted
   ];
   eventsState='live';filter='mine';tier='any';when='week';go('home',false);renderHome();
  });
  // Custom opens a compact calendar, applies inclusive ranges, and can be cancelled/reset.
  await page.evaluate(()=>{ closeSugg(); clearSearch(); when='any'; filter='All'; openFilters(); });
  assert.equal(await page.locator('[data-when="any"]').count(),0);
  await page.click('[data-when="custom"]');
  assert.equal(await page.isVisible('.fcalendar'),true);
  assert.equal(await page.isEnabled('#fCalApply'),false);
  await page.locator('[data-date]:not([disabled])').first().click();
  await page.click('#fCalApply');
  assert.equal(await page.evaluate(()=>when),'custom');
  assert.equal(await page.evaluate(()=>+customStart===+customEnd),true);
  assert.equal(await page.isVisible('.fcalendar'),false);
  assert.match(await page.getAttribute('#filtBtn','aria-label'),/Filters: [A-Z][a-z]+ \d/);
  await page.click('[data-when="custom"]');
  await page.click('#fCalCancel');
  assert.equal(await page.evaluate(()=>when),'custom');
  await page.evaluate(()=>{
    const day=n=>{const d=eventNow();d.setHours(0,0,0,0);d.setDate(d.getDate()+n);return d;};
    customStart=day(10);customEnd=day(12);
    window.rangeResults=[inWindow(mk(20,{start:day(9)})),inWindow(mk(21,{start:day(10)})),inWindow(mk(22,{start:day(12)})),inWindow(mk(23,{start:day(13)})),inWindow(mk(24,{start:day(0),rec:'Daily'}))];
  });
  assert.deepEqual(await page.evaluate(()=>window.rangeResults),[false,true,true,false,true]);
  await page.click('#fClear');
  assert.deepEqual(await page.evaluate(()=>[when,customStart,customEnd]),['any',null,null]);

  assert.deepEqual(errors,[],'no JavaScript errors');
  await page.close();await context.close();
  console.log('Custom date browser checks passed: calendar, apply, cancel, range boundaries, recurrence and reset.');
 } finally {await browser.close();}
})().then(()=>server.close()).catch(e=>{console.error(e);server.close();process.exitCode=1;});
