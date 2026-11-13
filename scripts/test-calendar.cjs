// Local browser regression: "Add to calendar" asks Apple or Google; Google opens a filled-in event, Apple gets an .ics
// for the planned date with a 2-hour reminder.
// Run: node scripts/test-calendar.cjs   (CHROMIUM_PATH=/path/to/chromium if it isn't at /usr/bin/chromium)
const fs=require('fs'),path=require('path'),http=require('http');const {chromium}=require('playwright');const assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const instrument=html=>{const end=html.lastIndexOf('})();\n</script>');return html.slice(0,end)+'window.__t=code=>eval(code);\n'+html.slice(end);};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://x').pathname.replace(/\/$/,'/index.html'));
 try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const ctx=await b.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles',acceptDownloads:true});
 const stub=`(()=>{const chain=st=>new Proxy(function(){},{get(_,k){if(k==='then'){if(st.table==='events')return()=>{};return(ok,bad)=>Promise.resolve({data:null,error:null}).then(ok,bad);}return(...a)=>chain(k==='from'?{table:a[0]}:st);},apply(){return chain(st);}});window.supabase={createClient:()=>chain({})};})();`;
 await ctx.route('**/*',r=>{const u=r.request().url();if(/supabase\.min\.js/.test(u))return r.fulfill({contentType:'text/javascript',body:stub});return new URL(u).origin===url?r.continue():r.abort();});
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(url,{waitUntil:'load'});await p.waitForFunction(()=>typeof window.__t==='function');
 const run=fn=>p.evaluate(c=>window.__t(c),`(${fn})()`);
 await run(()=>{Object.assign(S,{signedUp:true,kitSeen:true,name:'QA',nb:'Silver Lake',loc:{lat:34.0869,lng:-118.2702},rsvp:[],rsvpDates:{},checked:[],places:{},interests:[],lastPicksDay:new Date().toDateString()});
  const t=new Date();t.setHours(0,0,0,0);
  events=[{id:1,eid:'EVT-1',title:'Trivia Night at The Black Cat',venue:'The Black Cat',address:'3909 W Sunset Blvd',area:'Silver Lake',hood:'Silver Lake',time:'',desc:'Teams of up to six.',host:'',tags:[],vibes:[],recDetail:'',end:null,t0:'19:30',t1:'22:00',lat:34.0905,lng:-118.2775,kind:'popup',category:'nightlife',sub:'',rec:'One-off',start:new Date(2026,10,20),price:'Free',priceAmt:'',going:0}];
  eventsState='live';});
 await run(()=>openSheet(1)); await p.waitForTimeout(600);
 await p.click('#calBtn'); await p.waitForTimeout(400);
 assert.ok(await p.isVisible('#calModal .box'),'picker opens');
 const href=await p.getAttribute('#calGoogle','href');
 const g=new URL(href); assert.equal(g.searchParams.get('dates'),'20261120T193000/20261120T220000'); assert.equal(g.searchParams.get('ctz'),'America/Los_Angeles');
 assert.equal(g.searchParams.get('location'),'The Black Cat, 3909 W Sunset Blvd');
 const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#calApple')]);
 const ics=fs.readFileSync(await dl.path(),'utf8'); assert.match(ics,/DTSTART:20261120T193000/); assert.match(ics,/TRIGGER:-PT2H/); assert.match(ics,/\r\n/);
 assert.ok(!(await p.isVisible('#calModal .box')),'picker closes');
 assert.deepEqual(errs,[]); console.log('calendar picker: ok');
 await b.close();server.close();})();
