// Browser regression check: events still load before the newer column SQL has run (price_detail.sql, just_dropped.sql),
// and created_at becomes "added" once it is readable. No production services are contacted (the Supabase client is a stub).
// Run: node scripts/test-event-columns.cjs (optional CHROMIUM_PATH).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(process.env.COMPARE_HTML||path.join(root,'index.html'),'utf8');
const TOTAL=20, CAP=1000;
// The stub below stands in for supabase-js, so drop the CDN integrity check that would refuse it.
const instrument=h=>{h=h.replace(/ integrity="[^"]*"/g,'');const end=h.lastIndexOf('})();\n</script>');return h.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+h.slice(end);};
// A stand-in for supabase-js: every call chains and resolves empty, except reads of `events`, which return
// TOTAL rows in event_id order, honor .range() and never send more than CAP rows (like PostgREST's max_rows).
const stubFor=mode=>`(()=>{
  const MODE=${JSON.stringify(mode)};
  const rows=Array.from({length:${TOTAL}},(_,i)=>{ const n=i+1; return { event_id:'EVT-'+String(n).padStart(4,'0'), name:'Event '+n,
    category:'Arts & Entertainment', tier:'Staple', tags:[], vibes:[], description:'', start_date:null, end_date:null, start_time:null, end_time:null,
    recurrence:'Weekly', recurrence_detail:'Every Saturday', venue:'Venue '+n, street_address:n+' Ocean Ave', city:'Santa Monica', zip:'90401',
    neighborhood:'Santa Monica', status:'Needs verification', verified:true, lat:34.01+n/1e5, lng:-118.49 }; });
  window.__eventRequests=[];
  const chain=state=>new Proxy(function(){}, {
    get(_,k){
      if(k==='then'){ const r=state.table==='events'
          ? (()=>{ const cols=state.cols||''; window.__eventRequests.push(cols);
              if(/price_detail/.test(cols) && MODE!=='all') return { data:null, error:{ code:'42703', message:'column events.price_detail does not exist' } };
              if(/created_at/.test(cols) && MODE==='none') return { data:null, error:{ code:'42501', message:'permission denied for table events' } };
              const from=state.from??0, to=Math.min(state.to??Infinity, from+${CAP}-1);
              return { data:rows.slice(from,to+1).map(r=>/created_at/.test(cols)? {...r,created_at:new Date(Date.now()-36e5).toISOString()} : r), error:null }; })()
          : { data:null, error:null };
        return (ok,bad)=>Promise.resolve(r).then(ok,bad); }
      return (...a)=>chain(k==='from'? {table:a[0]} : k==='range'? {...state,from:a[0],to:a[1]} : k==='select'&&state.table==='events'&&!state.cols? {...state,cols:a[0]} : state);
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
  // none: neither column readable yet; created: just_dropped.sql ran, price_detail.sql didn't; all: both ran
  for(const mode of ['none','created','all']){
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   await context.route('**/*',route=>{
    const u=route.request().url();
    if(/supabase-js@[^/]+\/dist\/umd\/supabase\.min\.js/.test(u)) return route.fulfill({contentType:'text/javascript',body:stubFor(mode)});
    return new URL(u).origin===origin ? route.continue() : route.abort();
   });
   const page=await context.newPage();
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/',{waitUntil:'load'});
   await page.waitForFunction(()=>typeof window.__comunaTestEval==='function');
   const run=code=>page.evaluate(c=>window.__comunaTestEval(c),code);
   await page.waitForFunction(()=>window.__comunaTestEval('eventsState')!=='loading',null,{timeout:10000});
   const got=await run(`({ state:eventsState, count:events.length, added:events.filter(e=>e.added).length })`);
   assert.equal(got.state,'live',`${mode}: events should load`);
   assert.equal(got.count,TOTAL,`${mode}: all events load`);
   assert.equal(got.added, mode==='none'? 0 : TOTAL, `${mode}: added comes from created_at when it's readable`);
   assert.deepEqual(errors,[],'page should load without JavaScript errors');
   await context.close();
  }
  console.log('Event column checks passed: loads before and after price_detail.sql and just_dropped.sql.');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
