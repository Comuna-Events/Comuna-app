// Browser checks for guest tracking: a guest is counted, and their views and searches are saved by device_id.
// Requires Playwright and Chromium; every Supabase request is answered locally, so no production services are contacted.
// Run: node scripts/test-guests.cjs (optional CHROMIUM_PATH; SUPABASE_JS=path to a saved supabase-js UMD build when the browser can't reach the CDN).
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
  // the Supabase library loads from its CDN; the database itself is answered here and every write is recorded
  const writes=[];
  await context.route('**/*',route=>{
   const req=route.request(), url=new URL(req.url());
   if(url.hostname==='cdn.jsdelivr.net' && process.env.SUPABASE_JS) return route.fulfill({contentType:'text/javascript', body:fs.readFileSync(process.env.SUPABASE_JS,'utf8')});
   if(url.origin===origin || url.hostname==='cdn.jsdelivr.net') return route.continue();
   if(url.hostname.endsWith('.supabase.co')){
    if(req.method()==='POST') writes.push({path:url.pathname, body:JSON.parse(req.postData()||'null')});
    return route.fulfill({status:req.method()==='POST'?201:200, contentType:'application/json', body:req.method()==='POST'?'':'[]'});
   }
   return route.abort();
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{
   await page.goto(origin+'/index.html',{waitUntil:'load'});
   await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  };
  const run=(fn,arg)=>page.evaluate(([code,a])=>window.__comunaTestEval(`(${code})(${JSON.stringify(a)||'undefined'})`),[fn.toString(),arg]);
  const rpcs=()=>writes.filter(w=>w.path==='/rest/v1/rpc/guest_seen');
  await open();
  assert.equal(await run(()=>!!sb),true,'Supabase library loaded');

  // every install gets a random id, kept across launches
  const device=await run(()=>S.deviceId);
  assert.match(device,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(rpcs().length,0,'not counted before choosing to look around');

  // Start exploring -> where you are (location or a neighborhood) -> straight to the events, no interests, name or email
  await page.click('#startGuest');
  assert.equal(await run(()=>current),'onb2','everyone starts with where they are');
  assert.equal(await page.isVisible('[data-s="onb2"] .steps'),false,'no sign-up step dots for guests');
  await run(()=>setHood('Echo Park'));
  await page.click('#locNext');
  await page.waitForFunction(()=>window.__comunaTestEval('S.guest'));
  await page.waitForTimeout(300);
  assert.equal(await run(()=>current),'home','guests land on the events');
  assert.equal(rpcs().length,1,'guest counted when they start');
  assert.deepEqual(rpcs()[0].body,{p_device:device,p_neighborhood:'Echo Park',p_interests:[]});

  // Create account still goes location -> interests -> name and email
  await page.waitForSelector('#kitModal.on');   // the welcome card opens just after landing
  await run(()=>{ closeKit(); S.guest=false; go('onb1'); });
  await page.click('#startSignup');
  assert.equal(await page.isVisible('[data-s="onb2"] .steps'),true);
  await page.click('#locNext');
  assert.equal(await run(()=>current),'onb3');
  await page.click('#interestList [data-int]');
  await page.click('#intNext');
  assert.equal(await run(()=>current),'onb4');
  await run(()=>{ S.guest=true; save(); go('home'); });
  writes.length=0;

  // views and searches are saved with the device_id and no user_id
  await run(()=>{ const ev={id:1,eid:'EVT-1',title:'Jazz on the Lawn',area:'Echo Park',category:'arts'}; track(ev,'view'); return flushTrack(); });
  await run(()=>logSearch('jazz',3,null));
  const action=writes.find(w=>w.path==='/rest/v1/event_actions'), search=writes.find(w=>w.path==='/rest/v1/search_queries');
  assert.ok(action,'guest view saved');
  assert.equal(action.body[0].user_id,null); assert.equal(action.body[0].device_id,device); assert.equal(action.body[0].event_id,'EVT-1');
  assert.ok(search,'guest search saved');
  assert.equal(search.body.user_id,null); assert.equal(search.body.device_id,device); assert.equal(search.body.query,'jazz');

  // reopening the app counts another visit from the same install
  await open();
  await page.waitForTimeout(300);
  assert.equal(rpcs().length,1,'guest counted again on launch');
  assert.equal(rpcs()[0].body.p_device,device,'same device_id after reopening');

  // not signed in and not a guest: nothing is sent
  writes.length=0;
  await run(()=>{ S.guest=false; save(); track({id:2,eid:'EVT-2',title:'x'},'view'); return Promise.all([flushTrack(),logSearch('x',0,null),guestSeen()]); });
  assert.equal(writes.length,0,'nothing sent for someone who is neither signed in nor a guest');

  assert.deepEqual(errors,[]);
  console.log('guest tracking checks passed');
 }finally{ await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
