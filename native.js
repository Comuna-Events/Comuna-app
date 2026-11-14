/* The iPhone and Android apps only: scripts/build-ios.mjs adds this to the copy of index.html it packages, after
   Capacitor's own script. It swaps the browser's location and share for the native ones, so the app code stays the
   same on the web and on the phone: the phone asks for location with Comuna's own prompt, and shares open the phone's
   share sheet. Where Android differs (sign-in, reminders, the back button) it says so. */
(function(){
  const cap=window.Capacitor;
  if(!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const android=cap.getPlatform()==='android';
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

  /* share: the phone's share sheet (closing it rejects, as navigator.share does) */
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
     on. window.comunaApp is the app's Supabase client and screens, from index.html (the rest of it is out of reach).
     Android: reminders go through Firebase, which needs android/app/google-services.json (ANDROID.md). Without it
     registering would close the app, so the build script says whether it's there and reminders stay hidden if not.
     Phones before Android 13 allow notifications without asking, so Android also remembers who said yes. */
  const Push=cap.registerPlugin('PushNotifications');
  const pushReady=!android || !!window.comunaBuild?.androidPush;
  const OFF='comuna_reminders_off';
  const isOff=()=>{ try{ return localStorage.getItem(OFF)==='1'; }catch(e){ return false; } };
  const setOff=v=>{ try{ v? localStorage.setItem(OFF,'1') : localStorage.removeItem(OFF); }catch(e){} };
  const ON='comuna_reminders_on';   // Android only: they said yes in the app
  const optedIn=()=>{ if(!android) return true; try{ return localStorage.getItem(ON)==='1'; }catch(e){ return false; } };
  const setOptedIn=()=>{ try{ localStorage.setItem(ON,'1'); }catch(e){} };
  // Android shows a notification only in a channel, which people can mute in the phone's settings
  if(android && pushReady) Push.createChannel({ id:'reminders', name:'Reminders', description:'Heads-ups before your plans, and new events for you', importance:4, visibility:1 }).catch(()=>{});
  let token='';
  Push.addListener('registration',t=>{ token=t.value; saveToken(); });
  Push.addListener('registrationError',e=>console.warn('Push registration failed',e));
  const db=()=>window.comunaApp?.sb;
  const signedIn=async()=>!!(db() && (await db().auth.getSession()).data.session);
  async function saveToken(){
    if(!token || isOff() || !(await signedIn())) return;
    const { error }=await db().rpc('save_push_token',{ p_token:token, p_platform:android? 'android' : 'ios' });
    if(error) console.warn('Saving the push token failed',error);
  }
  // 'granted', 'denied', or 'prompt' when the phone hasn't asked yet ('prompt-with-rationale' on Android: it can ask again)
  const pushPermission=async()=>(await Push.checkPermissions().catch(()=>({}))).receive||'prompt';
  async function register(){
    if(pushReady && !isOff() && optedIn() && (await pushPermission())==='granted') Push.register().catch(()=>{});
  }
  addEventListener('load',async()=>{
    if(!db()) return;
    db().auth.onAuthStateChange(e=>{ if(e==='SIGNED_IN') setTimeout(register); });   // outside the callback, as Supabase asks
    if(await signedIn()) register();
  });
  // back from the iPhone's Settings, where they may have just allowed notifications
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') register(); });
  if(pushReady) window.comunaReminders={
    // 'on', 'off' (turned off in the app), 'unasked' (iOS hasn't asked yet) or 'blocked' (off in iPhone Settings)
    async status(){
      const p=await pushPermission();
      return p==='denied'? 'blocked' : p!=='granted' || !optedIn()? 'unasked' : isOff()? 'off' : 'on';
    },
    // shows Apple's prompt the first time; resolves the new status
    async turnOn(){
      setOff(false); setOptedIn();
      let p=await pushPermission();
      if(p!=='granted' && p!=='denied') p=(await Push.requestPermissions().catch(()=>({}))).receive;
      if(p==='granted') await Push.register().catch(()=>{});
      return window.comunaReminders.status();
    },
    async turnOff(){
      setOff(true);
      if(token && await signedIn()){ const { error }=await db().rpc('forget_push_token',{ p_token:token }); if(error) console.warn('Forgetting the push token failed',error); }
    },
    // Capacitor hands app-settings: to iOS, which opens Comuna's page in Settings; on Android, MainActivity's
    // ComunaSettings plugin opens Comuna's notification settings
    openSettings(){ if(android) cap.registerPlugin('ComunaSettings').openNotifications().catch(()=>{}); else location.href='app-settings:'; }
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
     if its URL scheme (the reversed client ID, in ios/App/App/Info.plist) is missing. Setup steps are in IOS.md.
     Android: Google only (Apple's rule that apps with Google sign-in also offer Apple applies to the App Store), using
     the phone's Google account picker. It needs the web client ID below plus an Android client in Google Cloud that
     names the app's signing key (ANDROID.md), and takes no extra scopes: email and profile come by default. */
  const GOOGLE_IOS_CLIENT_ID='200536928634-4138ggmg4baq14698p2a7bk8tkl1qv1v.apps.googleusercontent.com';   // Google Cloud > Google Auth Platform > Clients > Comuna iPhone
  const GOOGLE_WEB_CLIENT_ID='200536928634-treibndjl9m1nqajs3ca5ep838uno2te.apps.googleusercontent.com';   // Clients > Comuna Supabase, the same one in Supabase > Authentication > Providers > Google
  const Social=cap.registerPlugin('SocialLogin');
  const providers=android? (GOOGLE_WEB_CLIENT_ID? ['google'] : [])
    : ['apple'].concat(GOOGLE_IOS_CLIENT_ID && GOOGLE_WEB_CLIENT_ID? ['google'] : []);
  const ready=Social.initialize(android? { google:{ webClientId:GOOGLE_WEB_CLIENT_ID, mode:'online' } }
    : { apple:{}, ...(providers.includes('google')? { google:{ iOSClientId:GOOGLE_IOS_CLIENT_ID, iOSServerClientId:GOOGLE_WEB_CLIENT_ID, mode:'online' } } : {}) })
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
        const scopes=android? undefined : provider==='apple'? ['name','email'] : ['email','profile'];
        const { result:r }=await Social.login({ provider, options:{ ...(scopes? { scopes } : {}), nonce:n.hashed } });
        const p=r.profile||{}, name=[p.givenName,p.familyName].filter(Boolean).join(' ') || p.name || '';
        if(!r.idToken) throw new Error('No identity token came back');
        return { token:r.idToken, nonce:n.raw, name };   // Apple sends the name only the first time someone signs in
      }catch(e){
        if(e?.code==='USER_CANCELLED' || /cancel/i.test(String(e?.message||e))) return null;
        throw e;
      }
    }
  };

  const App=cap.registerPlugin('App');
  /* Android's back button and back gesture: close what's open or go back a screen (index.html decides), and on the
     first screen send the app to the background like other Android apps, rather than closing it */
  if(android){
    App.addListener('backButton',()=>{ if(!window.comunaApp?.back?.()) App.minimizeApp().catch(()=>{}); });
  }

  /* friend invite links (https://www.wearecomuna.com/i/?c=CODE) open the app when it's installed: universal links,
     set up in ios/App/App/App.entitlements and the website's .well-known/apple-app-site-association (IOS.md). Whether
     the link started the app or arrived while it was open, the invite opens; straight after launch the app may still
     be loading, so keep trying for a few seconds. */
  const openLink=url=>{ const m=String(url||'').match(/wearecomuna\.com\/i\/?\?(?:.*&)?c=([0-9a-f]{12})/i); if(!m) return;
    const code=m[1].toLowerCase(), go=()=>!!window.comunaApp?.openInviteCode?.(code);
    if(!go()){ let n=0; const t=setInterval(()=>{ if(go() || ++n>20) clearInterval(t); },500); } };
  App.addListener('appUrlOpen',e=>openLink(e?.url));
  App.getLaunchUrl?.().then(r=>openLink(r?.url)).catch(()=>{});

  // tapping a notification opens its event (or Plans, for a rundown of several, or the list of Monday / Friday picks);
  // straight after launch the events may
  // still be loading, so keep trying for a few seconds
  // A friend invite opens the invite instead; its iPhone buttons (I'm in, Maybe, Can't: AppDelegate.swift) answer it too.
  Push.addListener('pushNotificationActionPerformed',a=>{
    const d=a.notification?.data||{}, app=()=>window.comunaApp, act=['in','maybe','out'].includes(a.actionId)? a.actionId : null;
    const open=()=>!!app() && (d.invite? app().openInvite(d.invite,act) : d.event_id? app().openEvent(d.event_id,d.date||null) : d.screen==='plans'? app().openPlans()
      : d.screen==='picks'? (app().openPicks? app().openPicks(d.picks,d.range) : true) : true);
    if(!open()){ let n=0; const t=setInterval(()=>{ if(open() || ++n>20) clearInterval(t); },500); }
  });
})();
