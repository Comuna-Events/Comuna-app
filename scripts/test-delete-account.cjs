// Run: node scripts/test-delete-account.cjs. The Delete account button in Profile; no network.
// The database side is checked by scripts/test-delete-account.sql.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const markup=source.slice(source.indexOf('<button class="linkrow" id="signOut">'),source.indexOf('</section>',source.indexOf('<button class="linkrow" id="signOut">')));
assert.match(markup,/id="deleteAccount" hidden/,'Delete account starts hidden, until we know someone is signed in');
const start=source.indexOf("document.getElementById('deleteAccount').onclick="),handler=source.slice(start,source.indexOf('\n};',start)+3);
function setup({confirmed=true,user={id:'joe'},error=null}={}){
 const button={disabled:false},calls={rpc:[],wiped:0,toasts:[]};
 const c={S:{signedUp:true},console:{warn(){}},confirm:()=>confirmed,dbUser:async()=>user,toast:m=>calls.toasts.push(m),
  wipePhone:async()=>{calls.wiped++;},sb:{rpc:async fn=>{calls.rpc.push(fn);assert.equal(button.disabled,true,'the button is disabled while deleting');return {error};}},
  document:{getElementById:()=>new Proxy({},{set(o,k,v){if(k==='onclick')c.click=()=>v({currentTarget:button});return true;}})}};
 vm.createContext(c);vm.runInContext(handler,c);return {c,calls,button};
}
(async()=>{
 let t=setup({confirmed:false});await t.c.click();
 assert.deepEqual(t.calls.rpc,[],'cancelling the confirmation deletes nothing');assert.equal(t.calls.wiped,0);
 t=setup();await t.c.click();
 assert.deepEqual(t.calls.rpc,['delete_my_account']);assert.equal(t.calls.wiped,1,'a deleted account leaves nothing on the phone');
 assert.equal(t.calls.toasts.at(-1),'Your account was deleted');
 t=setup({error:{message:'TypeError: Failed to fetch'}});await t.c.click();
 assert.equal(t.calls.wiped,0,'a failed delete keeps the account and the passport on the phone');assert.equal(t.button.disabled,false,'the button can be tried again');
 assert.match(t.calls.toasts.at(-1),/Couldn't delete your account/);
 t=setup({user:null});await t.c.click();
 assert.deepEqual(t.calls.rpc,[],'no session: nothing is sent');assert.match(t.calls.toasts.at(-1),/Sign in again/);
 t=setup();t.c.S.signedUp=false;await t.c.click();assert.deepEqual(t.calls.rpc,[],'guests have no account to delete');
 console.log('Delete account checks passed: hidden until signed in, confirmation, success wipes the phone, failures keep everything, no session, guests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
