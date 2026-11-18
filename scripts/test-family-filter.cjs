// Browser checks for the Family-friendly filter: which events it keeps, the filter sheet, the badge and summary, and reset.
// Requires Playwright and Chromium; no production services are contacted.
// Run: node scripts/test-family-filter.cjs (optional CHROMIUM_PATH).
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
  try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
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
   Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',nb:'Silver Lake',loc:{lat:34.0869,lng:-118.2702},rsvp:[],checked:[],places:{},interests:[],lastPicksDay:new Date().toDateString()});
   const day=n=>{ const d=eventNow(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return d; };
   const base={venue:'Somewhere',category:'arts',sub:'',kind:'niche',lat:34.0869,lng:-118.2702,area:'Silver Lake',time:'',desc:'',host:'',tags:[],vibes:[],age:'',price:'Free',rec:'One-off',recDetail:'',end:null,t0:'10:00',t1:'12:00',mi:0};
   window.mk=(id,o)=>({...base,id,eid:'EVT-'+id,title:'Event '+id,start:day(1),...o});
   window.FAM=['family-friendly'];
   events=[
    mk(1,{vibes:FAM,age:'All ages'}),                              // family: shown
    mk(2,{vibes:FAM,age:''}),                                       // family, age not stated: shown
    mk(3,{vibes:FAM,age:'21+'}),                                    // tagged family but 21+: never shown
    mk(4,{vibes:['chill'],age:'All ages'}),                         // all ages but not tagged family: not shown
    mk(5,{vibes:FAM,age:'18+'}),                                    // tagged family but 18+: never shown
    mk(6,{vibes:FAM,age:'All ages',category:'food',price:'Paid'}),  // family, another category, paid: shown
    mk(7,{vibes:FAM,age:'All ages',start:day(-30)}),                // finished: never shown or counted
    mk(8,{vibes:[]}),                                               // no vibes at all
   ];
   eventsState='live';filter='All';tier='any';when='any';price='any';go('home',false);renderHome();
  });
  const ids=()=>page.evaluate(()=>picks().map(ev=>ev.id).sort((a,b)=>a-b));

  // Off by default: nothing is hidden.
  assert.equal(await page.evaluate(()=>kids),'any');
  assert.deepEqual(await ids(),[1,2,3,4,5,6,8]);

  // The rule on its own, including the age edge cases.
  assert.deepEqual(await page.evaluate(()=>[
    familyOK(mk(90,{vibes:FAM,age:'All ages'}),'family'), familyOK(mk(91,{vibes:FAM,age:''}),'family'),
    familyOK(mk(92,{vibes:FAM,age:'18+'}),'family'), familyOK(mk(93,{vibes:FAM,age:'21+'}),'family'), familyOK(mk(94,{vibes:FAM,age:' 21 + '}),'family'),
    familyOK(mk(95,{vibes:[],age:'All ages'}),'family'), familyOK(mk(96,{vibes:undefined,age:'All ages'}),'family'),
    familyOK(mk(97,{vibes:[],age:'21+'}),'any')
  ]),[true,true,false,false,false,false,false,true]);

  // The filter sheet has a "Good for" row with both choices and a count-aware Family-friendly button.
  await page.evaluate(()=>{ closeSugg(); clearSearch(); openFilters(); });
  assert.deepEqual(await page.locator('[data-kids]').allTextContents(),['Anyone','Family-friendly']);
  assert.equal(await page.isEnabled('[data-kids="family"]'),true);
  assert.equal(await page.getAttribute('[data-kids="any"]','aria-pressed'),'true');
  assert.equal(await page.isEnabled('#fClear'),false);

  await page.click('[data-kids="family"]');
  assert.equal(await page.evaluate(()=>kids),'family');
  assert.deepEqual(await ids(),[1,2,6]);
  assert.equal(await page.getAttribute('[data-kids="family"]','aria-pressed'),'true');
  assert.equal(await page.textContent('#filtCount'),'1');
  assert.equal(await page.getAttribute('#filtBtn','aria-label'),'Filters: Anytime · Everything · Family-friendly');
  assert.equal(await page.textContent('#fShow'),'Show 3 events');
  assert.equal(await page.isEnabled('#fClear'),true);

  // It combines with the other filters, and the other filters' counts follow it.
  await page.evaluate(()=>{ price='free'; renderHome(); });
  assert.deepEqual(await ids(),[1,2]);
  await page.evaluate(()=>{ price='any'; filter='food'; renderHome(); });
  assert.deepEqual(await ids(),[6]);
  assert.equal(await page.evaluate(()=>countWith('any','All','any','any','family')),3);
  assert.equal(await page.evaluate(()=>countWith('any','All','any','any','any')),7);
  await page.evaluate(()=>{ filter='All'; renderHome(); });

  // Clear all puts it back.
  await page.click('#fClear');
  assert.equal(await page.evaluate(()=>kids),'any');
  assert.deepEqual(await ids(),[1,2,3,4,5,6,8]);
  assert.equal(await page.isVisible('#filtCount'),false);

  // With no family-friendly events the choice is disabled, not a dead end.
  await page.evaluate(()=>{ events=events.filter(ev=>!(ev.vibes||[]).includes('family-friendly')); renderHome(); openFilters(); });
  assert.equal(await page.isDisabled('[data-kids="family"]'),true);
  assert.equal(await page.isEnabled('[data-kids="any"]'),true);

  assert.deepEqual(errors,[],'no JavaScript errors');
  await page.close();await context.close();
  console.log('Family-friendly filter checks passed: rule and age edge cases, filter sheet, badge and summary, combining, disabled when empty, and reset.');
 } finally {await browser.close();}
})().then(()=>server.close()).catch(e=>{console.error(e);server.close();process.exitCode=1;});
