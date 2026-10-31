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
  assert.equal(await page.getAttribute('#srchQ','placeholder'),'Ask Comuna');
  const ids=()=>page.evaluate(()=>[...document.querySelectorAll('#picks [data-ev]')].map(b=>+b.dataset.ev));
  assert.deepEqual(await ids(),[3,1],'before searching: This week + Your interests (Arts)');

  // typing shows suggestions; finished events are not counted
  await page.click('#srchQ');await page.fill('#srchQ','spooky');
  assert.equal(await page.isVisible('#srchSugg'),true);
  assert.match(await page.textContent('#srchSugg .sopt.go'),/Search “spooky”\s*2 events/);
  assert.equal(await page.locator('#srchSugg [data-sev]').count(),2);
  assert.equal(await page.isVisible('#srchCancel'),true);

  // running it resets filters to Anytime / Everything, keeps the words in the box, and finds matches outside the old filters
  await page.press('#srchQ','Enter');
  assert.equal(await page.isVisible('#srchSugg'),false);
  assert.deepEqual(await ids(),[1,2],'title/tag match ranks above a description match');
  assert.equal(await page.getAttribute('#filtBtn','aria-label'),'Filters: Anytime · Everything');
  assert.equal(await page.isVisible('#filtCount'),false,'no filters narrowing the search');
  assert.equal(await page.inputValue('#srchQ'),'spooky');
  assert.equal(await page.isVisible('#srchBack'),true);
  assert.equal(await page.evaluate(()=>document.getElementById('homeScreen').classList.contains('searching')),true);
  assert.equal(await page.textContent('#mapNote'),'2 matches');
  if(process.env.SEARCH_SCREENSHOT) await page.screenshot({path:process.env.SEARCH_SCREENSHOT});

  // filters keep narrowing the search, and their counts respect it
  await page.evaluate(()=>{ when='week'; renderHome(); });
  assert.deepEqual(await ids(),[1]);
  assert.equal(await page.evaluate(()=>countWith('any','All')),2);

  // every word must match; if nothing has them all, close matches show
  await page.evaluate(()=>applySearch('jazz echo park'));
  assert.deepEqual(await ids(),[3]);
  await page.evaluate(()=>applySearch('jazz maze'));
  assert.deepEqual((await ids()).sort(),[2,3]);
  assert.match(await page.textContent('#mapNote'),/no exact match/);
  // time words set When instead of matching text; stop words are ignored
  await page.evaluate(()=>applySearch("what's cool tonight"));
  assert.equal(await page.evaluate(()=>when),'tonight');
  assert.deepEqual(await ids(),[4]);
  // "art" is a word start, so it doesn't match "party"; plurals match
  assert.equal(await page.evaluate(()=>termScore(mk(9,{title:'Party',category:'food'}),'art')),0);
  assert.equal(await page.evaluate(()=>termScore(mk(9,{title:'Jazz night'}),'nights')),3);

  // clearing puts the earlier filters back
  await page.click('[data-clear-search]');
  assert.deepEqual(await page.evaluate(()=>[when,filter,tier,searchQ]),['week','mine','any','']);
  assert.deepEqual(await ids(),[3,1]);
  assert.equal(await page.isVisible('#srchBack'),false);

  // picking a category suggestion sets the Type filter; picking an event opens it, tracked as from search
  await page.click('#srchQ');await page.fill('#srchQ','food');
  await page.click('#srchSugg [data-scat="food"]');
  assert.deepEqual(await page.evaluate(()=>[filter,searchQ]),['food','']);
  await page.click('#srchQ');await page.fill('#srchQ','maze');
  await page.click('#srchSugg [data-sev="2"]');
  assert.equal(await page.evaluate(()=>document.getElementById('overlay').classList.contains('on')),true);
  assert.equal(await page.evaluate(()=>sheetCtx.placement),'search_suggestion');
  await page.evaluate(()=>{ overlay.classList.remove('on'); applySearch('spooky'); openSheet(1); });
  assert.deepEqual(await page.evaluate(()=>sheetCtx),{placement:'search',query:'spooky'});

  // vibes: found by their other words, offered as suggestions, shown on the event
  await page.evaluate(()=>{ overlay.classList.remove('on'); clearSearch(); const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+3);
   events=[...events, mk(6,{title:'Pumpkin Patch',category:'community',vibes:['spooky','family-friendly'],start:d})]; });
  await page.evaluate(()=>applySearch('halloween'));
  assert.deepEqual(await ids(),[6]);
  await page.evaluate(()=>applySearch('kids'));
  assert.deepEqual(await ids(),[6]);
  await page.evaluate(()=>clearSearch());
  await page.click('#srchQ');
  assert.deepEqual(await page.locator('#srchSugg .tagpick button').allTextContents(),['Spooky','Family-friendly']);
  await page.click('#srchSugg .tagpick button:has-text("Spooky")');
  assert.equal(await page.evaluate(()=>searchQ),'spooky');
  assert.deepEqual((await ids()).sort(),[1,2,6]);
  await page.click('#srchQ');await page.fill('#srchQ','hallo');
  assert.equal(await page.locator('#srchSugg [data-sq="spooky"]').count(),1);
  await page.evaluate(()=>{ closeSugg(); openSheet(6); });
  assert.match(await page.textContent('#sheet .badges'),/Spooky[\s\S]*Family-friendly/);

  // typed text is escaped everywhere it shows
  await page.evaluate(()=>{ overlay.classList.remove('on'); window.__injected=0; applySearch('<img src=x onerror="window.__injected=1">'); });
  await page.click('#srchQ');
  assert.equal(await page.locator('#srchSugg img, #picks img').count(),0);
  assert.equal(await page.evaluate(()=>window.__injected),0);

  assert.deepEqual(errors,[],'no JavaScript errors');
  await page.close();await context.close();
  console.log('Search browser checks passed: suggestions, matching, ranking, filters, clearing, tracking context and escaping.');
 } finally {await browser.close();}
})().then(()=>server.close()).catch(e=>{console.error(e);server.close();process.exitCode=1;});
