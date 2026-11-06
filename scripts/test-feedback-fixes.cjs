// Browser checks for the fixes from tester feedback (Nov 2026). Requires Playwright and Chromium; no production services are contacted.
// Run: node scripts/test-feedback-fixes.cjs (optional CHROMIUM_PATH; SHOTS=dir saves screenshots).
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

  // a free event that needs an RSVP on Eventbrite (Busby's trivia), and a "free" one whose description names a price
  await page.evaluate(()=>{
   Object.assign(S,{signedUp:false,guest:true,kitSeen:true,name:'QA',nb:'Santa Monica',loc:{lat:34.02,lng:-118.49},rsvp:[],rsvpDates:{},checked:[],places:{},interests:[],lastPicksDay:new Date().toDateString()});
   const day=n=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return d; };
   const base={venue:'Busby\'s West',category:'community',sub:'',kind:'regular',lat:34.02,lng:-118.49,area:'Santa Monica',time:'',desc:'',host:'',tags:[],rec:'One-off',recDetail:'',end:null,t0:'19:00',t1:'21:00',mi:0.5,start:day(1)};
   events=[
    {...base,id:1,eid:'EVT-1',title:'Wednesday Trivia Night at Busby\'s',price:'Free',rsvpReq:true,ticket:'https://www.eventbrite.com/e/wednesday-trivia-night-1'},
    {...base,id:2,eid:'EVT-2',title:'Uninstructed Figure Workshop',price:'Free',desc:'Every Wednesday. $20 cash fee walk in.',ticket:'https://www.meetup.com/x/events/1/'},
    {...base,id:3,eid:'EVT-3',title:'Jazz Tonight',price:'Free',start:day(0),t0:'23:00',t1:'23:59',tags:['jazz']},
   ];
   eventsState='live';go('home',false);renderHome();
  });

  // 1. "Ask Comuna" is a search box: says so, and question-style searches find events instead of nothing
  assert.equal(await page.getAttribute('#srchQ','placeholder'),'Search events, places, vibes');
  const parsed=await page.evaluate(()=>parseSearch('What do you suggest for tonight?'));
  assert.deepEqual(parsed,{when:'tonight',terms:[]},'only the time word is left');
  await page.evaluate(()=>applySearch('what do you suggest for tonight'));
  assert.ok((await page.evaluate(()=>picks().map(e=>e.id))).includes(3),'tonight\'s event is found');
  await page.evaluate(()=>clearSearch());

  // 2. the host's RSVP is spelled out, and Save only saves
  await page.evaluate(()=>openSheet(1));
  assert.equal((await page.textContent('#rsvpBtn')).trim(),'Save');
  assert.match(await page.textContent('#sheet .hoststep'),/Needs a free RSVP from the host[\s\S]*host isn't told[\s\S]*RSVP on Eventbrite/);
  assert.equal(await page.getAttribute('#sheet [data-hostgo]','href'),'https://www.eventbrite.com/e/wednesday-trivia-night-1');
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/sheet.png'});
  await page.click('#rsvpBtn');
  await page.waitForSelector('#stampModal.on .hoststep');
  assert.match(await page.textContent('#stampModal h3'),/Saved\. Now RSVP with the host/);
  assert.match(await page.textContent('#stampModal'),/host isn't told/);
  assert.match(await page.textContent('#stampModal p'),/^In your Plans for .* · \+\d+ points\.$/,'one short line');
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/saved.png'});
  await page.click('#stampModal [data-hostgot]');
  assert.match(await page.textContent('#stampModal .hoststep'),/RSVP'd with host/);
  await page.click('#closeStamp');
  await page.evaluate(()=>{ calSel=new Date(events[0].start); calView=new Date(calSel.getFullYear(),calSel.getMonth(),1); go('plans'); });
  assert.match(await page.textContent('#planList'),/Saved · RSVP'd with host ✓/);
  await page.click('#planList [data-ticket]');
  assert.match(await page.textContent('#planList'),/Host RSVP needed/);
  assert.match(await page.textContent('#planList'),/Remove from Plans/);
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/plans.png'});
  await page.evaluate(()=>go('home',false));

  // 3. an event without an RSVP: just a note that the host isn't notified
  await page.evaluate(()=>openSheet(3));
  assert.equal(await page.locator('#sheet .hoststep').count(),0);
  assert.match(await page.textContent('#sheet .savenote'),/host isn't notified/);

  // 4. "Free" with a price in the description isn't shown as Free
  await page.evaluate(()=>openSheet(2));
  assert.match(await page.textContent('#sheet .evprice'),/Check price[\s\S]*\$20/);
  assert.equal(await page.evaluate(()=>priceOK(events[1],'free')),false);
  await page.evaluate(()=>overlay.classList.remove('on'));

  // 5. feedback: a long note survives closing the sheet, and the box grows then scrolls inside
  await page.evaluate(()=>openFeedback());
  const note='Line one of a long note.\n'.repeat(40);
  await page.fill('#fbText',note);
  const box=await page.evaluate(()=>{ const t=document.getElementById('fbText'); return {h:t.clientHeight, sh:t.scrollHeight, max:Math.round(innerHeight*0.45)}; });
  assert.ok(box.h<=box.max+4 && box.sh>box.h,'grows to about half the screen, then scrolls inside');
  // a downward drag that starts in the text box scrolls the text and leaves the sheet open
  await page.evaluate(()=>{ const t=document.getElementById('fbText'), r=t.getBoundingClientRect(), x=r.left+20, y=r.top+20;
    const touch=(type,yy)=>t.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'?[]:[new Touch({identifier:1,target:t,clientX:x,clientY:yy})]}));
    touch('touchstart',y); touch('touchmove',y+200); touch('touchend',y+200); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>overlay.classList.contains('on')),true,'still open after a drag in the text box');
  await page.evaluate(()=>overlay.classList.remove('on'));
  await page.evaluate(()=>openFeedback());
  assert.equal(await page.inputValue('#fbText'),note,'the draft comes back');
  await page.evaluate(()=>overlay.classList.remove('on'));

  // 6. Badges never spin forever: guests are asked to make an account; a lost sign-in says so
  await page.evaluate(()=>go('badges'));
  assert.match(await page.textContent('#badgeScreen'),/earned with an account/);
  const hasSb=await page.evaluate(()=>!!sb);
  await page.evaluate(()=>{ S.signedUp=true; S.badges=null; if(sb) sb.auth.getSession=async()=>({data:{session:null}}); renderBadges(); });
  await page.waitForFunction(hasSb? ()=>/Sign in again/.test(document.getElementById('badgeScreen').textContent) : ()=>/Couldn't load your badges/.test(document.getElementById('badgeScreen').textContent));
  if(hasSb){
    await page.evaluate(()=>{ badgesFailed=false; sb.auth.getSession=()=>new Promise(()=>{}); });
    const t0=Date.now(); await page.evaluate(()=>loadBadges(true).then(()=>0));   // a request that never answers gives up
    assert.ok(Date.now()-t0<12000); assert.match(await page.textContent('#badgeScreen'),/Couldn't load your badges/);
  }
  await page.click('#badgeRetry');   // Try again / Sign in never leaves a dead spinner
  await page.evaluate(()=>go('home',false));

  // 7. shared events: risky links are refused, multi-day and more repeat options
  const risks=await page.evaluate(()=>['https://www.eventbrite.com/e/x','http://example.com','https://bit.ly/x','https://site.example/Event.apk','https://1.2.3.4/x','https://xn--evntbrite.com/e'].map(u=>!!linkRisk(u)));
  assert.deepEqual(risks,[false,true,true,true,true,true]);
  await page.evaluate(()=>{ S.signedUp=true; go('home',false); openSubmit(); });
  assert.deepEqual(await page.$$eval('#subForm [name=recurrence] option',o=>o.map(x=>x.value)),['One-time','Daily','Weekly','Biweekly','Monthly']);
  assert.equal(await page.textContent('#subEndL'),'Last day');
  await page.selectOption('#subForm [name=recurrence]','Weekly');
  assert.equal(await page.textContent('#subEndL'),'Repeats until');
  if(process.env.SHOTS) await page.screenshot({path:process.env.SHOTS+'/submit.png',fullPage:false});
  // an approved multi-day submission runs every day from its first to its last day
  const md=await page.evaluate(()=>{ const ev={start:new Date(2026,10,7),end:new Date(2026,10,9),rec:'One-off'};
    return [6,7,8,9,10].map(d=>occursOn(ev,new Date(2026,10,d))); });
  assert.deepEqual(md,[false,true,true,true,false]);

  assert.deepEqual(errors,[],'no page errors');
  console.log('Feedback fixes checked: search wording and question searches, host RSVP/ticket step and "got it" marker, price clash, feedback draft and scrolling, badges never spin, link checks, multi-day and repeat options.');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
