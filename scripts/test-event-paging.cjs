// Browser regression check: the app must load the whole events catalogue even though Supabase caps each response.
// Requires Playwright and Chromium; no production services are contacted (the Supabase client is a local stub).
// Run: node scripts/test-event-paging.cjs (optional CHROMIUM_PATH and COMPARE_HTML to run an older index.html).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(process.env.COMPARE_HTML||path.join(root,'index.html'),'utf8');
const TOTAL=1235, CAP=1000;
const instrument=h=>{const end=h.lastIndexOf('})();\n</script>');return h.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+h.slice(end);};
// A stand-in for supabase-js: every call chains and resolves empty, except reads of `events`, which return
// TOTAL rows in event_id order, honor .range() and never send more than CAP rows (like PostgREST's max_rows).
const stub=`(()=>{
  const rows=Array.from({length:${TOTAL}},(_,i)=>{ const n=i+1; return { event_id:'EVT-'+String(n).padStart(4,'0'), name:'Event '+n,
    category:'Arts & Entertainment', tier:'Staple', tags:[], vibes:[], description:'', start_date:null, end_date:null, start_time:null, end_time:null,
    recurrence:'Weekly', recurrence_detail:'Every Saturday', venue:'Venue '+n, street_address:n+' Ocean Ave', city:'Santa Monica', zip:'90401',
    neighborhood:'Santa Monica', status:'Needs verification', verified:true, lat:34.01+n/1e5, lng:-118.49 }; });
  window.__eventRequests=[];
  const chain=state=>new Proxy(function(){}, {
    get(_,k){
      if(k==='then'){ const r=state.table==='events'
          ? (()=>{ const from=state.from??0, to=Math.min(state.to??Infinity, from+${CAP}-1); window.__eventRequests.push([from,to]); return { data:rows.slice(from,to+1), error:null }; })()
          : { data:null, error:null };
        return (ok,bad)=>Promise.resolve(r).then(ok,bad); }
      return (...a)=>chain(k==='from'? {table:a[0]} : k==='range'? {...state,from:a[0],to:a[1]} : state);
    },
    apply(){ return chain(state); }
  });
  window.supabase={ createClient:()=>chain({}) };
})();`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'||url.pathname==='/index.html'){res.setHeader('content-type','text/html');return res.end(instrument(html));}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  try{res.setHeader('content-type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}catch(e){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const systemChromium=process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
 const browser=await chromium.launch({headless:true,executablePath:systemChromium,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const u=route.request().url();
   if(/supabase-js@[^/]+\/dist\/umd\/supabase\.min\.js/.test(u)) return route.fulfill({contentType:'text/javascript',body:stub});
   return new URL(u).origin===origin ? route.continue() : route.abort();
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/',{waitUntil:'load'});
  await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  const run=code=>page.evaluate(c=>window.__comunaTestEval(c),code);
  await page.waitForFunction(()=>window.__comunaTestEval('eventsState')!=='loading',null,{timeout:10000});
  const got=await run(`({ state:eventsState, count:events.length, last:events.length? events[events.length-1].eid : '', requests:window.__eventRequests })`);
  assert.equal(got.state,'live','events should load');
  assert.equal(got.count,TOTAL,`all ${TOTAL} events should load, got ${got.count} (requests ${JSON.stringify(got.requests)})`);
  assert.equal(got.last,'EVT-'+String(TOTAL).padStart(4,'0'),'the newest event should be included');
  assert.deepEqual(errors,[],'page should load without JavaScript errors');
  console.log(`ok: ${got.count} events loaded in ${got.requests.length} requests ${JSON.stringify(got.requests)}`);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
