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
  // no fade: index.html's launch overlay shows the same picture underneath, then animates it
  addEventListener('load',()=>SplashScreen.hide({ fadeOutDuration:0 }).catch(()=>{}));

  /* haptics: index.html calls window.comunaHaptic(kind) at moments like a check-in, a save or a badge */
  const Haptics=cap.registerPlugin('Haptics');
  const IMPACT={ light:'LIGHT', medium:'MEDIUM', heavy:'HEAVY' }, NOTICE={ success:'SUCCESS', warning:'WARNING', error:'ERROR' };
  window.comunaHaptic=kind=>{
    const done=kind==='selection'? Haptics.selectionStart().then(()=>Haptics.selectionChanged()).then(()=>Haptics.selectionEnd())
      : NOTICE[kind]? Haptics.notification({ type:NOTICE[kind] }) : Haptics.impact({ style:IMPACT[kind]||'LIGHT' });
    done.catch(()=>{});
  };

  /* reminders ("starts in an hour", sent by supabase/functions/send-reminders). iOS shows its permission prompt only
     once, so the app asks first in its own words (the "RSVP saved" card and Profile > Reminders in index.html) and
     only shows Apple's prompt to someone who said yes. Every launch re-sends the phone's token, since iOS can change
     it. Turning reminders off in the app forgets this phone's token and stays off on this phone until turned back
     on. window.comunaApp is the app's Supabase client and screens, from index.html (the rest of it is out of reach). */
  const Push=cap.registerPlugin('PushNotifications');
  const OFF='comuna_reminders_off';
  const isOff=()=>{ try{ return localStorage.getItem(OFF)==='1'; }catch(e){ return false; } };
  const setOff=v=>{ try{ v? localStorage.setItem(OFF,'1') : localStorage.removeItem(OFF); }catch(e){} };
  let token='';
  Push.addListener('registration',t=>{ token=t.value; saveToken(); });
  Push.addListener('registrationError',e=>console.warn('Push registration failed',e));
  const db=()=>window.comunaApp?.sb;
  const signedIn=async()=>!!(db() && (await db().auth.getSession()).data.session);
  async function saveToken(){
    if(!token || isOff() || !(await signedIn())) return;
    const { error }=await db().rpc('save_push_token',{ p_token:token });
    if(error) console.warn('Saving the push token failed',error);
  }
  // 'granted', 'denied', or 'prompt' when iOS hasn't asked yet
  const pushPermission=async()=>(await Push.checkPermissions().catch(()=>({}))).receive||'prompt';
  async function register(){
    if(!isOff() && (await pushPermission())==='granted') Push.register().catch(()=>{});
  }
  addEventListener('load',async()=>{
    if(!db()) return;
    db().auth.onAuthStateChange(e=>{ if(e==='SIGNED_IN') setTimeout(register); });   // outside the callback, as Supabase asks
    if(await signedIn()) register();
  });
  // back from the iPhone's Settings, where they may have just allowed notifications
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') register(); });
  window.comunaReminders={
    // 'on', 'off' (turned off in the app), 'unasked' (iOS hasn't asked yet) or 'blocked' (off in iPhone Settings)
    async status(){
      const p=await pushPermission();
      return p==='denied'? 'blocked' : p!=='granted'? 'unasked' : isOff()? 'off' : 'on';
    },
    // shows Apple's prompt the first time; resolves the new status
    async turnOn(){
      setOff(false);
      let p=await pushPermission();
      if(p!=='granted' && p!=='denied') p=(await Push.requestPermissions().catch(()=>({}))).receive;
      if(p==='granted') await Push.register().catch(()=>{});
      return window.comunaReminders.status();
    },
    async turnOff(){
      setOff(true);
      if(token && await signedIn()){ const { error }=await db().rpc('forget_push_token',{ p_token:token }); if(error) console.warn('Forgetting the push token failed',error); }
    },
    // Capacitor hands app-settings: to iOS, which opens Comuna's page in Settings
    openSettings(){ location.href='app-settings:'; }
  };
  window.comunaSigningOut=async()=>{
    if(token && await signedIn()) await db().rpc('forget_push_token',{ p_token:token });
    // Google remembers the account on the phone; forget it so the next person to sign in here gets the account picker
    if(window.comunaSocial?.providers.includes('google')) await cap.Plugins.SocialLogin?.logout({ provider:'google' }).catch(()=>{});
  };

  /* sign in with Apple or Google: the phone's own sign-in sheet (Face ID for Apple, Google's account picker), no
     browser trip. index.html shows the buttons when window.comunaSocial exists and hands the ID token to Supabase
     (signInWithIdToken). The provider gets a SHA-256 of a one-time nonce and Supabase the nonce itself, so a token
     can't be replayed. Google stays hidden until GOOGLE_IOS_CLIENT_ID is filled in: the Google SDK closes the app
     if its URL scheme (the reversed client ID, in ios/App/App/Info.plist) is missing. Setup steps are in IOS.md. */
  const GOOGLE_IOS_CLIENT_ID='200536928634-4138ggmg4baq14698p2a7bk8tkl1qv1v.apps.googleusercontent.com';   // Google Cloud > Google Auth Platform > Clients > Comuna iPhone
  const GOOGLE_WEB_CLIENT_ID='200536928634-treibndjl9m1nqajs3ca5ep838uno2te.apps.googleusercontent.com';   // Clients > Comuna Supabase, the same one in Supabase > Authentication > Providers > Google
  const Social=cap.registerPlugin('SocialLogin');
  const providers=['apple'].concat(GOOGLE_IOS_CLIENT_ID && GOOGLE_WEB_CLIENT_ID? ['google'] : []);
  const ready=Social.initialize({ apple:{}, ...(providers.includes('google')? { google:{ iOSClientId:GOOGLE_IOS_CLIENT_ID, iOSServerClientId:GOOGLE_WEB_CLIENT_ID, mode:'online' } } : {}) })
    .catch(e=>console.warn('Social sign-in setup failed',e));
  async function nonces(){
    const raw=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
    if(!crypto.subtle) return { raw:undefined, hashed:undefined };   // no nonce at all is still accepted; a mismatched one isn't
    const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    return { raw, hashed:Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,'0')).join('') };
  }
  window.comunaSocial={
    providers,
    // resolves { token, nonce, name } or null if they closed the sheet; throws on a real failure
    async signIn(provider){
      await ready;
      const n=await nonces();
      try{
        const { result:r }=await Social.login({ provider, options:{ scopes: provider==='apple'? ['name','email'] : ['email','profile'], nonce:n.hashed } });
        const p=r.profile||{}, name=[p.givenName,p.familyName].filter(Boolean).join(' ') || p.name || '';
        if(!r.idToken) throw new Error('No identity token came back');
        return { token:r.idToken, nonce:n.raw, name };   // Apple sends the name only the first time someone signs in
      }catch(e){
        if(e?.code==='USER_CANCELLED' || /cancel/i.test(String(e?.message||e))) return null;
        throw e;
      }
    }
  };

  // tapping a notification opens its event (or Plans, for a rundown of several); straight after launch the events may
  // still be loading, so keep trying for a few seconds
  Push.addListener('pushNotificationActionPerformed',a=>{
    const d=a.notification?.data||{}, app=()=>window.comunaApp;
    const open=()=>!!app() && (d.event_id? app().openEvent(d.event_id,d.date||null) : d.screen==='plans'? app().openPlans() : true);
    if(!open()){ let n=0; const t=setInterval(()=>{ if(open() || ++n>20) clearInterval(t); },500); }
  });
})();
