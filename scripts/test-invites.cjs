// Local browser regression: friend invites (supabase/invites.sql). A fake backend in the page plays the invite
// functions, so this checks the app side: picking friends, the plan with names on it, nudging, sharing a link,
// answering from Plans (and "I'm in" saving the plan), pasting a link, and a link opened before signing in.
// Run: node scripts/test-invites.cjs   (CHROMIUM_PATH=/path/to/chromium if it isn't at /usr/bin/chromium)
// SHOTS=dir also saves screenshots of each screen.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'), shots=process.env.SHOTS;
const instrument=html=>{const end=html.lastIndexOf('})();\n</script>');return html.slice(0,end)+'window.__comunaTestEval=code=>eval(code);\n'+html.slice(end);};
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 try{res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(file.endsWith('.html')?instrument(fs.readFileSync(file,'utf8')):fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
// the fake backend: a signed-in user (window.__uid), the invite functions in memory, everything else resolves empty
const stub=`(()=>{
  const db=window.__db={ invites:window.__seed?.invites||[], calls:[], names:{ jess:'Jess Chen', maya:'Maya Rios', sam:'Sam Kim', dani:'Dani Torres' } };
  const nm=u=>{ const p=(db.names[u]||'A friend').split(' '); return p[0]+(p[1]?' '+p[1][0]+'.':''); };
  const friendsOf=u=>{ const c={}; db.invites.forEach(i=>{ const me=i.members.find(m=>m.user_id===u&&m.answer!=='pending'); if(!me) return;
    i.members.forEach(m=>{ if(m.user_id!==u&&m.answer!=='pending') c[m.user_id]=(c[m.user_id]||0)+1; }); });
    return Object.entries(c).map(([user_id,plans])=>({user_id,name:nm(user_id),plans})); };
  const view=(i,u)=>({ id:i.id, code:i.code, event_id:i.event_id, date:i.date, created_at:i.created_at, host_id:i.host,
    host_name:nm(i.host), is_host:i.host===u, my_answer:i.members.find(m=>m.user_id===u).answer, invited_at:i.members.find(m=>m.user_id===u).invited_at,
    members:i.members.map(m=>({...m, name:nm(m.user_id), host:m.user_id===i.host, me:m.user_id===u})) });
  const ok=data=>Promise.resolve({data,error:null}), bad=message=>Promise.resolve({data:null,error:{message}});
  const rpc=(fn,a={})=>{ const u=window.__uid; db.calls.push([fn,a,u]);
    const inv=id=>db.invites.find(i=>i.id===id);
    switch(fn){
      case 'my_friends': return ok(db.friends?.[u] ?? friendsOf(u));
      case 'my_invites': return ok(db.invites.filter(i=>i.members.some(m=>m.user_id===u)).map(i=>view(i,u)));
      case 'create_invite': { let i=db.invites.find(x=>x.host===u&&x.event_id===a.p_event_id&&x.date===a.p_date);
        if(!i){ i={ id:'inv'+(db.invites.length+1), code:'abcdef12345'+db.invites.length, event_id:a.p_event_id, date:a.p_date, host:u,
          created_at:new Date().toISOString(), members:[{user_id:u,answer:'in',via:'host',invited_at:new Date().toISOString(),answered_at:new Date().toISOString(),nudged:false}] }; db.invites.push(i); }
        let added=0; (a.p_friends||[]).forEach(f=>{ if(!i.members.some(m=>m.user_id===f)){ i.members.push({user_id:f,answer:'pending',via:'direct',invited_at:new Date().toISOString(),answered_at:null,nudged:false}); added++; } });
        return ok([{id:i.id,code:i.code,added}]); }
      case 'answer_invite': { const m=inv(a.p_invite)?.members.find(m=>m.user_id===u); if(!m) return bad('not in this invite'); m.answer=a.p_answer; m.answered_at=new Date().toISOString(); return ok(null); }
      case 'nudge_invite': { const m=inv(a.p_invite).members.find(m=>m.user_id===a.p_user); m.nudged=true; return ok(null); }
      case 'join_invite': { const i=db.invites.find(x=>x.code===a.p_code); if(!i) return bad('invite not found');
        if(!i.members.some(m=>m.user_id===u)) i.members.push({user_id:u,answer:'pending',via:'link',invited_at:new Date().toISOString(),answered_at:null,nudged:false}); return ok(i.id); }
      case 'invite_preview': { const i=db.invites.find(x=>x.code===a.p_code); return ok(i? [{event_id:i.event_id,occurrence_date:i.date,host_name:nm(i.host),going:i.members.filter(m=>m.answer==='in').length}] : []); }
    } return ok(null); };
  const chain=st=>new Proxy(function(){},{
     get(_,k){ if(k==='then'){ if(st.table==='events') return ()=>{}; return (ok,bad)=>Promise.resolve({data:null,error:null}).then(ok,bad); }
       return (...a)=>chain(k==='from'? {table:a[0]} : st); },
     apply(){ return chain(st); } });
  const auth={ getSession:async()=>({ data:{ session: window.__uid? { user:{ id:window.__uid, is_anonymous:false, email:'qa@example.com' } } : null }, error:null }),
    getUser:async()=>({ data:{ user:{ id:window.__uid } }, error:null }), onAuthStateChange:()=>({ data:{ subscription:{ unsubscribe(){} } } }),
    signOut:async()=>({ error:null }) };
  window.supabase={ createClient:()=>new Proxy({}, { get(_,k){ if(k==='rpc') return rpc; if(k==='auth') return auth; return chain({})[k]; } }) };
})();`;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles'});
  await context.route('**/*',route=>{ const u=route.request().url();
   if(/supabase-js@[^/]+\/dist\/umd\/supabase\.min\.js/.test(u)) return route.fulfill({contentType:'text/javascript',body:stub});
   if(shots && /fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue();
   return new URL(u).origin===url?route.continue():route.abort(); });
  const errors=[];
  const open=async(query='')=>{ const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{ window.__uid=sessionStorage.getItem('uid')||null; });
   await page.goto(url+'/'+query,{waitUntil:'load'}); await page.waitForFunction(()=>typeof window.__comunaTestEval==='function'); return page; };
  const page=await open();
  const run=(fn,arg)=>page.evaluate(code=>window.__comunaTestEval(code),`(${fn.toString()})(${JSON.stringify(arg)||'undefined'})`);
  const shot=async name=>{ if(shots){ await page.waitForTimeout(350); await page.screenshot({path:path.join(shots,name+'.png')}); } };
  const as=async(uid,friends)=>run(([uid,friends])=>{ window.__uid=uid; if(friends) window.__db.friends={[uid]:friends};
   Object.assign(S,{signedUp:true,guest:false,accountId:uid,name:window.__db.names[uid],kitSeen:true,rsvp:[],rsvpDates:{},checked:[],lastPicksDay:new Date().toDateString()});
   invitesAt=0; invites=[]; overlay.classList.remove('on'); document.getElementById('stampModal').classList.remove('on'); return loadInvites(true); },[uid,friends]);
  await run(()=>{
   Object.assign(S,{kitSeen:true,nb:'Silver Lake',loc:{lat:34.0869,lng:-118.2702},places:{},interests:[],lastPicksDay:new Date().toDateString()});
   const t=new Date(); t.setHours(0,0,0,0);
   events=[{id:1,eid:'EVT-1',title:'Trivia Night at The Black Cat',venue:'The Black Cat',area:'Silver Lake',hood:'Silver Lake',time:'',desc:'Teams of up to six.',host:'',tags:[],vibes:[],recDetail:'',end:null,t0:'23:00',t1:'23:59',lat:34.0905,lng:-118.2775,kind:'popup',category:'nightlife',sub:'',rec:'One-off',start:t,price:'Free',priceAmt:'',going:0}];
   eventsState='live'; go('home');
  });
  const today=await run(()=>planDayKey(today0()));

  // 1. Jess picks two friends and sends: it's saved to her Plans and the sheet shows the plan with names
  await as('jess',[{user_id:'maya',name:'Maya R.',plans:3},{user_id:'sam',name:'Sam K.',plans:1},{user_id:'dani',name:'Dani T.',plans:1}]);
  await run(()=>openSheet(1)); await page.click('#shareBtn');
  await page.waitForSelector('.invrow .invchk');
  assert.equal(await page.locator('.invrow .invchk').count(),3,'three friends to pick from');
  assert.equal(await page.isDisabled('#invSend'),true,'Send waits for a pick');
  await page.locator('.invchk[value="maya"]').check(); await page.locator('.invchk[value="sam"]').check();
  assert.equal(await page.textContent('#invSend'),'Send to 2 friends');
  await shot('1-pick-friends');
  await page.click('#invSend');
  await page.waitForSelector('[data-invblock]');
  const made=await run(()=>window.__db.calls.find(c=>c[0]==='create_invite')[1]);
  assert.deepEqual(made,{p_event_id:'EVT-1',p_date:today,p_friends:['maya','sam']});
  assert.equal(await page.locator('#invNote').count(),0,'no note');
  assert.equal(await run(()=>hasPlan(events[0],today0())),true,'inviting saves it to your Plans');
  assert.match(await page.textContent('[data-invblock] .invtop'),/Your plan/);
  assert.equal(await page.locator('[data-invblock] [data-nudge]').count(),2,'Nudge on each friend who has not answered');
  assert.equal(await page.locator('[data-invblock] .invseg').count(),0,'no answer buttons for the person who invited');

  // 2. Nudge: once, then it says Nudged
  await page.click('[data-invblock] [data-nudge="sam"]');
  await page.waitForFunction(()=>!document.querySelector('[data-nudge="sam"]'));
  assert.deepEqual(await run(()=>window.__db.calls.filter(c=>c[0]==='nudge_invite').map(c=>c[1])),[{p_invite:'inv1',p_user:'sam'}]);
  assert.match(await page.textContent('[data-invblock]'),/Nudged/);
  await shot('4-plan-names');

  // 3. Invite more -> Share invite link: the link goes to the share sheet with the invite's code
  await run(()=>{ window.__shared=null; navigator.share=d=>{ window.__shared=d; return Promise.resolve(); }; });
  await page.click('[data-inv-more]'); await page.waitForSelector('#invLink');
  assert.equal(await page.locator('.invrow .invchk').count(),1,'only friends not already in it');
  await page.click('#invLink'); await page.waitForFunction(()=>window.__shared);
  const shared=await run(()=>window.__shared);
  assert.equal(shared.url,'https://www.wearecomuna.com/i/?c=abcdef123450');
  assert.match(shared.text,/invited you to Trivia Night at The Black Cat, Today/);

  // 4. Maya gets it in Plans (with a badge on the Plans tab) and taps I'm in: answered, and saved to her Plans
  await as('maya');
  assert.equal(await page.textContent('.nav [data-nav="plans"] .navbadge'),'1','badge for an invite to answer');
  await run(()=>go('plans')); await page.waitForSelector('[data-invcard]');
  const card=await page.textContent('[data-invcard]');
  assert.match(card,/Jess invited you/); assert.match(card,/Jess is in/); assert.match(card,/Maya|Sam/);
  await shot('3-invites-in-plans');
  await page.click('[data-invcard] [data-inv-ans="in"]');
  await page.waitForFunction(()=>document.querySelector('[data-invcard] [data-inv-ans="in"]')?.classList.contains('on'));
  assert.deepEqual(await run(()=>window.__db.calls.filter(c=>c[0]==='answer_invite').map(c=>[c[1].p_answer,c[2]])),[['in','maya']]);
  assert.equal(await run(()=>hasPlan(events[0],today0())),true,"I'm in saves it to her Plans");
  assert.equal(await page.locator('.nav [data-nav="plans"] .navbadge').count(),0,'badge clears');
  // in the event sheet she sees everyone, and can change her answer; Can't takes it back out of Plans
  await page.click('[data-invcard] [data-inv-open]'); await page.waitForSelector('[data-invblock] .invseg');
  assert.match(await page.textContent('[data-invblock] .invtop'),/Jess invited you/);
  await page.click('[data-invblock] [data-inv-ans="out"]');
  await page.waitForFunction(()=>document.querySelector('[data-invblock] [data-inv-ans="out"]')?.classList.contains('on'));
  assert.equal(await run(()=>hasPlan(events[0],today0())),false,"Can't takes it out of Plans");

  // 5. Dani pastes the link in Plans: joins, and the event opens with the answer buttons
  await as('dani');
  await run(()=>go('plans')); await page.waitForSelector('#invPaste input');
  await page.fill('#invPaste input','https://www.wearecomuna.com/i/?c=abcdef123450');
  await page.click('#invPaste button');
  await page.waitForSelector('[data-invblock] .invseg');
  assert.deepEqual(await run(()=>window.__db.calls.filter(c=>c[0]==='join_invite').map(c=>c[1])),[{p_code:'abcdef123450'}]);
  await page.fill('#invPaste input','not a link').catch(()=>{});

  // 6. A link opened in the web app before signing in: says who invited, how many are going, and asks for an account
  const db=await run(()=>window.__db);
  const context2=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',timezoneId:'America/Los_Angeles'});
  await context2.route('**/*',route=>{ const u=route.request().url();
   if(/supabase-js@[^/]+\/dist\/umd\/supabase\.min\.js/.test(u)) return route.fulfill({contentType:'text/javascript',body:stub});
   if(shots && /fonts\.(googleapis|gstatic)\.com/.test(u)) return route.continue();
   return new URL(u).origin===url?route.continue():route.abort(); });
  const page2=await context2.newPage(); page2.on('pageerror',e=>errors.push(e.message));
  await page2.addInitScript(d=>{ window.__seed=d; },db);
  await page2.goto(url+'/?invite=abcdef123450',{waitUntil:'load'});
  await page2.waitForFunction(()=>typeof window.__comunaTestEval==='function');
  await page2.waitForFunction(()=>window.__comunaTestEval('current'));   // boot has run (it starts the events load)
  await page2.evaluate(()=>window.__comunaTestEval(`(()=>{ const t=new Date(); t.setHours(0,0,0,0);
    events=[{id:1,eid:'EVT-1',title:'Trivia Night at The Black Cat',venue:'The Black Cat',area:'Silver Lake',time:'',desc:'',host:'',tags:[],vibes:[],recDetail:'',end:null,t0:'23:00',t1:'23:59',lat:34.09,lng:-118.27,kind:'popup',category:'nightlife',sub:'',rec:'One-off',start:t,price:'Free',going:0}];
    eventsState='live'; })()`));
  await page2.waitForSelector('#invJoin',{timeout:15000});
  assert.match(await page2.textContent('#stampModal'),/Jess invited you to Trivia Night at The Black Cat/);
  assert.match(await page2.textContent('#stampModal'),/1 going/);
  assert.equal(new URL(page2.url()).search,'','the code is taken out of the address');
  assert.equal(await page2.evaluate(()=>window.__comunaTestEval('S.pendingInvite')),'abcdef123450','kept for after sign-up');
  if(shots){ await page2.waitForTimeout(300); await page2.screenshot({path:path.join(shots,'5-link-before-signup.png')}); }

  // 7. no account: Invite opens the share menu as before
  await run(()=>{ window.__uid=null; S.signedUp=false; S.guest=true; invites=[]; window.__shared=null; openSheet(1); });
  await page.click('#shareBtn'); await page.waitForFunction(()=>window.__shared);
  assert.equal(await page.locator('#invSend').count(),0);

  assert.deepEqual(errors,[]);
  console.log('invites: ok');
 }finally{ await browser.close(); server.close(); }
})().catch(e=>{ console.error(e); process.exit(1); });
