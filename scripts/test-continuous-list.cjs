// Local browser regression: map viewport cards must not cap the scrollable list.
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
  await run(()=>{
   Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',loc:{lat:34.0869,lng:-118.2702},rsvp:[],checked:[],places:{},interests:[],lastPicksDay:new Date().toDateString()});
   const tomorrow=new Date();tomorrow.setHours(0,0,0,0);tomorrow.setDate(tomorrow.getDate()+1);
   const base={venue:'Test venue',category:'food',sub:'food',kind:'popup',area:'Silver Lake',time:'',desc:'',host:'',tags:[],vibes:[],rec:'One-off',recDetail:'',start:tomorrow,end:null,t0:'10:00',t1:'12:00',lng:S.loc.lng};
   events=Array.from({length:125},(_,i)=>({...base,id:i+1,eid:'EVT-'+(i+1),title:'Tasting '+(i+1),lat:S.loc.lat+(i+1)*.01})).reverse();
   events.push({...base,id:126,eid:'EVT-126',title:'Comedy',category:'arts',lat:S.loc.lat+.005});
   const yesterday=new Date(tomorrow);yesterday.setDate(yesterday.getDate()-2);
   events.push({...base,id:127,eid:'EVT-127',title:'Finished tasting',start:yesterday,lat:S.loc.lat});
   eventsState='live';filter='All';tier='any';when='week';searchQ='';go('home',false);
   placePins=P=>{lastPins=P;};
   map={getBounds:()=>({contains:([lng,lat])=>lat<S.loc.lat+.025}),getCenter:()=>({lng:S.loc.lng,lat:S.loc.lat}),resize:()=>{}};
   userMoved=true;renderHome();cardsForView();
   openSheet=id=>{window.selectedListEvent=id;};
  });
  const ids=()=>run(()=>[...document.querySelectorAll('#picks [data-ev]')].map(el=>+el.dataset.ev));
  assert.deepEqual(await ids(),[126,1,2],'map cards are limited to the panned viewport');
  await page.click('#tList');
  assert.equal((await ids()).length,30,'list starts with one lightweight page');
  assert.match(await page.textContent('#picks'),/Closest to you.*estimated drive times/);
  assert.ok(!(await ids()).includes(127),'finished events remain filtered');
  assert.ok((await ids()).includes(29),'list immediately includes events outside the map');
  for(const target of [60,90,120,126]){
   await page.locator('#picks').evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await page.waitForFunction(n=>document.querySelectorAll('#picks [data-ev]').length>=n,target);
  }
  assert.deepEqual(await ids(),[126,...Array.from({length:125},(_,i)=>i+1)],'automatic scrolling reaches every matching event in increasing travel-time order');
  assert.equal(await page.locator('#loadMoreEvents').count(),0);
  assert.match(await page.textContent('#eventListTail'),/all events matching your filters/);
  await page.locator('#picks [data-ev="125"]').click();
  assert.equal(await page.evaluate(()=>window.selectedListEvent),125,'farther results retain event click behavior');
  await run(()=>{map.getBounds=()=>({contains:()=>false});});
  await page.click('#tMap');assert.equal((await ids()).length,0,'the selected map area can have no events');
  await page.click('#tList');assert.equal((await ids()).length,126,'an empty map area does not hide list results');
  await run(()=>{map.getBounds=()=>({contains:([lng,lat])=>lat<S.loc.lat+.025});});
  await run(()=>{filter='food';renderHome();});
  assert.equal((await ids()).length,30,'changing filters resets pagination');
  assert.ok(!(await ids()).includes(126));
  assert.equal(await page.locator('#picks').evaluate(el=>el.scrollTop),0);
  // Keyboard/click fallback works even when the browser has no IntersectionObserver.
  await run(()=>{if(eventListObserver)eventListObserver.disconnect();window.IntersectionObserver=undefined;renderHome();});
  await page.locator('#loadMoreEvents').focus();await page.keyboard.press('Enter');
  assert.equal((await ids()).length,60);
  assert.equal(await page.locator(':focus').getAttribute('data-ev'),'31','keyboard focus advances into the newly loaded events');
  await run(()=>renderHome());
  assert.equal((await ids()).length,60,'ordinary RSVP/data refreshes keep the expanded list');
  await page.click('#tMap');assert.deepEqual(await ids(),[1,2]);
  await page.click('#tList');assert.equal((await ids()).length,60,'switching back restores the extended result set');
  await run(()=>{searchQ='doesnotexist';searchHits=null;renderHome();});
  assert.equal((await ids()).length,0);assert.equal(await page.locator('#loadMoreEvents').count(),0,'empty results cannot append stale events');
  await run(()=>{searchQ='';searchHits=null;S.loc={lat:35.3369,lng:-118.2702};renderHome();});
  assert.equal((await ids())[0],125,'changing location reorders and resets the list');
  assert.equal((await ids()).length,30);
  assert.deepEqual(errors,[],'no browser errors');
  if(process.env.LIST_SCREENSHOT)await page.screenshot({path:process.env.LIST_SCREENSHOT});
  console.log('Continuous list browser checks passed: viewport independence, all 126 results, ordering, filters, location, fallback, switching and event selection.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exit(1);});
