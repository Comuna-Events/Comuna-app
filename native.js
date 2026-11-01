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
  window.comunaSigningOut=async()=>{
    if(token && await signedIn()) await sb.rpc('forget_push_token',{ p_token:token });
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

  // tapping a reminder opens its event
  Push.addListener('pushNotificationActionPerformed',a=>{
    const d=a.notification?.data||{}, open=()=>{ const ev=typeof events!=='undefined' && events.find(e=>e.eid===d.event_id);
      if(ev){ openSheet(ev.id,null,'Top 4',d.date||null); return true; } };
    // straight after launch the events may still be loading
    if(!open()){ let n=0; const t=setInterval(()=>{ if(open() || ++n>20) clearInterval(t); },500); }
  });
})();
