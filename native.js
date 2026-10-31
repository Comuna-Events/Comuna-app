/* The iPhone app only: scripts/build-ios.mjs adds this to the copy of index.html it packages, after Capacitor's own
   script. It swaps the browser's location and share for the native ones, so the app code stays the same on the web
   and on the phone: iOS asks for location with Comuna's own prompt, and shares open the iOS share sheet. */
(function(){
  const cap=window.Capacitor;
  if(!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const Geolocation=cap.registerPlugin('Geolocation'), Share=cap.registerPlugin('Share'),
        SplashScreen=cap.registerPlugin('SplashScreen'), StatusBar=cap.registerPlugin('StatusBar');

  /* location: same calls and error codes as navigator.geolocation (1 denied, 2 unavailable, 3 timed out) */
  const fail=(code,message)=>({ code, message, PERMISSION_DENIED:1, POSITION_UNAVAILABLE:2, TIMEOUT:3 });
  const permission=()=>Geolocation.checkPermissions().then(p=>p.location, ()=>'prompt');
  const geo={
    getCurrentPosition(ok, bad, options={}){
      const opts={ enableHighAccuracy:!!options.enableHighAccuracy, timeout:options.timeout??15000, maximumAge:options.maximumAge??0 };
      Geolocation.getCurrentPosition(opts).then(
        p=>ok({ coords:p.coords, timestamp:p.timestamp }),
        async e=>{ if(!bad) return;
          const msg=String(e?.message||e||'');
          // the plugin's timeout is code OS-PLUG-GLOC-0010
          bad((await permission())==='denied'? fail(1,msg) : e?.code==='OS-PLUG-GLOC-0010'? fail(3,msg) : fail(2,msg)); });
    },
    watchPosition(){ return 0; },
    clearWatch(){}
  };
  Object.defineProperty(navigator,'geolocation',{ configurable:true, get:()=>geo });

  // the app checks for a refusal before re-reading your location in the background
  const query=navigator.permissions?.query?.bind(navigator.permissions);
  if(query) navigator.permissions.query=d=>d?.name==='geolocation'
    ? permission().then(s=>({ state:s==='granted'?'granted':s==='denied'?'denied':'prompt' }))
    : query(d);

  /* share: the iOS share sheet (closing it rejects, as navigator.share does) */
  navigator.share=d=>Share.share({ title:d?.title, text:d?.text, url:d?.url });

  /* status bar: light text over the dark Profile screen, dark text over the paper ones */
  const DARK=['profile'];
  let style='';
  const fitBar=()=>{ const on=document.querySelector('.screen.on'), next=on && DARK.includes(on.dataset.s)? 'DARK' : 'LIGHT';
    if(next!==style){ style=next; StatusBar.setStyle({ style }).catch(()=>{}); } };
  addEventListener('DOMContentLoaded',()=>{
    fitBar();
    const watch=new MutationObserver(fitBar);
    document.querySelectorAll('.screen').forEach(s=>watch.observe(s,{ attributes:true, attributeFilter:['class'] }));
  });
  addEventListener('load',()=>SplashScreen.hide({ fadeOutDuration:250 }).catch(()=>{}));

  /* reminders ("starts in an hour", sent by supabase/functions/send-reminders): iOS asks for permission after
     someone saves their first plan, when a reminder obviously helps. Every launch re-sends the phone's token,
     since iOS can change it. `sb` and `openSheet` are the app's own, from index.html. */
  const Push=cap.registerPlugin('PushNotifications');
  let token='';
  Push.addListener('registration',t=>{ token=t.value; saveToken(); });
  Push.addListener('registrationError',e=>console.warn('Push registration failed',e));
  const signedIn=async()=>!!(typeof sb!=='undefined' && sb && (await sb.auth.getSession()).data.session);
  async function saveToken(){
    if(!token || !(await signedIn())) return;
    const { error }=await sb.rpc('save_push_token',{ p_token:token });
    if(error) console.warn('Saving the push token failed',error);
  }
  async function register(ask){
    let p=(await Push.checkPermissions().catch(()=>({}))).receive;
    if(p!=='granted' && ask && p!=='denied') p=(await Push.requestPermissions().catch(()=>({}))).receive;
    if(p==='granted') Push.register().catch(()=>{});
  }
  // after the "You're in" message has had a moment on screen
  addEventListener('comuna:plan-saved',()=>setTimeout(()=>register(true),1500));
  addEventListener('load',async()=>{
    if(typeof sb==='undefined' || !sb) return;
    sb.auth.onAuthStateChange(e=>{ if(e==='SIGNED_IN') setTimeout(()=>register(false)); });   // outside the callback, as Supabase asks
    if(await signedIn()) register(false);
  });
  window.comunaSigningOut=async()=>{ if(token && await signedIn()) await sb.rpc('forget_push_token',{ p_token:token }); };

  // tapping a reminder opens its event
  Push.addListener('pushNotificationActionPerformed',a=>{
    const d=a.notification?.data||{}, open=()=>{ const ev=typeof events!=='undefined' && events.find(e=>e.eid===d.event_id);
      if(ev){ openSheet(ev.id,null,'Top 4',d.date||null); return true; } };
    // straight after launch the events may still be loading
    if(!open()){ let n=0; const t=setInterval(()=>{ if(open() || ++n>20) clearInterval(t); },500); }
  });
})();
