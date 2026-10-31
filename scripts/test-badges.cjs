// Run: node scripts/test-badges.cjs. Badges come from my_achievements(); titles are saved on the profile. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const start=source.indexOf('const BADGE_SECTIONS='),end=source.indexOf('/* ---------- neighborhood leaderboard');
const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{id,innerHTML:'',textContent:'',hidden:false,classList:{contains:()=>false},addEventListener(){},querySelector:()=>({}),before(){}});return els.get(id);};
const badge=(key,section,name,title,goal,progress,earned,extra={})=>({key,section,name,title,blurb:'Rule for '+name,goal,hidden:false,progress,earned_at:earned||null,is_new:false,metric:key.replace(/_\d$/,''),...extra});
const plain=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 const calls=[],toasts=[],updates=[],went=[];let reply={data:[],error:null},updateError=null,boards=0;
 const overlay={on:false,classList:{add(){overlay.on=true;},remove(){overlay.on=false;}}};
 const c={console:{warn(){}},C:{red:'#C9533D',blue:'#4B66A8',green:'#244D3A',sun:'#D6A638',ink:'#26251F',muted:'#6B675A'},S:{signedUp:true,accountId:'joe',badges:null,titleKey:null},
  current:'badges',document:{getElementById:el},save(){},escH:s=>String(s),loaderHtml:()=>'<div class="cloader"></div>',haptic(){},toast:m=>toasts.push(m),
  renderNames(){},renderProfile(){},loadLeaderboard(){boards++;},go:id=>went.push(id),openAuth(){},
  overlay,sheet:{innerHTML:'',querySelector:()=>({})},kitModal:{classList:{contains:()=>false}},dbUser:async()=>({id:'joe'}),
  sb:{auth:{getSession:async()=>({data:{session:{user:{id:'joe'}}}})},rpc:async(name)=>{calls.push(name);return reply;},
   from:t=>({update:v=>({eq:async(col,id)=>{updates.push(plain({t,v,col,id}));return {error:updateError};}})})}};
 vm.createContext(c);vm.runInContext(source.slice(start,end).replace(/^const |^let /gm,'var '),c);

 c.renderBadges();assert.match(el('badgeScreen').innerHTML,/Loading your badges/,'before the first load the screen says it is loading');
 reply={data:[badge('coffee_1','everyday','Bean Counter','Bean Counter',3,3,'2026-10-12T10:00:00Z',{is_new:true,metric:'coffee'}),badge('coffee_2','everyday','Bean Counter II',"Barista's Favorite",10,3,null,{metric:'coffee'}),
  badge('market_1','everyday','Market Day','Market Regular',3,2,null),badge('double','habits','Double Booked','Double Booked',2,2,'2026-10-03T10:00:00Z'),
  badge('streak_4','habits','On a Roll','On a Roll',4,1,null),badge('full_send','hidden','Full Send','Full Send',4,2,null,{hidden:true})],error:null};
 const fresh=await c.loadBadges(true);
 assert.ok(calls.includes('my_achievements'));assert.deepEqual(plain(fresh.map(b=>b.key)),['coffee_1'],'newly earned badges are returned to celebrate');
 const n=calls.length;assert.equal((await c.loadBadges()).length,0);assert.equal(calls.length,n,'a second open within a minute does not call the database again');

 // the Passport shelf: newest badges and the closest one to earn
 c.renderShelf();const shelf=el('badgeShelf').innerHTML;
 assert.match(shelf,/2 badges/);assert.match(shelf,/Next: <b>Market Day<\/b>, 2 of 3/,'the shelf names the closest badge');
 assert.ok(shelf.indexOf('Bean Counter, earned')<shelf.indexOf('Double Booked, earned'),'newest badge first');

 // keys that aren't safe file names go straight to the blank patch; locked badges are their shape's outline
 assert.match(c.badgeIcon({key:'x/../y',section:'kinds',name:'X',earned_at:'2026-01-01',progress:1,goal:1},40),/src="badges\/section-kinds\.webp\?v=[\w-]+"/);
 assert.match(c.badgeIcon(reply.data[2],80),/stroke-dasharray="67 100"/,'progress is stitched around the edge');

 // the Badges screen
 c.renderBadges();const page=el('badgeScreen').innerHTML;
 assert.match(page,/2 of 5 earned/,'the count leaves out hidden badges you have not found');
 assert.match(page,/Almost there/);assert.match(page,/Market Day, 2 of 3/,'locked badges show progress');
 assert.doesNotMatch(page,/Full Send/,'hidden badges stay secret until earned');assert.match(page,/1 hidden badge left to find/);

 // a badge's sheet, and the next tier of the same rule
 c.openBadge('coffee_1');assert.ok(overlay.on);
 assert.match(c.sheet.innerHTML,/<img class="patch" src="badges\/coffee_1\.webp\?v=[\w-]+"[^>]*onerror="[^"]*badges\/section-everyday\.webp\?v=/,'an earned badge shows its patch, with its category\'s blank patch if the art is missing');
 assert.match(c.sheet.innerHTML,/Wear this title/);assert.match(c.sheet.innerHTML,/Next up: <b>Barista's Favorite<\/b>/,'the next tier comes from the same rule');
 c.openBadge('market_1');assert.match(c.sheet.innerHTML,/Earn it to wear the title <b>Market Regular<\/b>/);assert.doesNotMatch(c.sheet.innerHTML,/bWear/,'locked badges cannot be worn');

 // titles
 c.openTitlePicker();assert.match(c.sheet.innerHTML,/value="coffee_1"/);assert.match(c.sheet.innerHTML,/value="double"/);assert.doesNotMatch(c.sheet.innerHTML,/value="market_1"/,'only earned titles can be picked');
 assert.equal(await c.wearTitle('coffee_1'),true);
 assert.deepEqual(updates[0],{t:'profiles',v:{title_key:'coffee_1',title_chosen:true},col:'id',id:'joe'},'picking a title ends the default');
 assert.equal(c.myTitle(),'Bean Counter');assert.match(toasts.at(-1),/Bean Counter/);
 c.renderBadges();assert.match(el('badgeScreen').innerHTML,/<i>Wearing<\/i>/);
 assert.equal(await c.wearTitle(null),true);assert.deepEqual(updates[1].v,{title_key:null,title_chosen:true},'"No title" clears it and sticks');assert.equal(c.myTitle(),'');
 updateError={message:'You haven\'t earned that title yet.'};
 assert.equal(await c.wearTitle('coffee_2'),false);
 assert.equal(c.S.titleKey,null,'a refused title is not kept on the phone');assert.match(toasts.at(-1),/Couldn't change your title/);

 // celebrating when the stamp screen is closed: a toast
 c.celebrateBadges([reply.data[2]]);assert.match(toasts.at(-1),/New badge: Market Day/);

 // the first badge: the server's default title arrives as worn; a sheet explains it once, or the starter kit does
 reply={data:[badge('founding','contributing','Founding Local','OG',1,1,'2026-10-26T10:00:00Z',{is_new:true,worn:true}),badge('welcome','explore','New in Town','Day One',1,1,'2026-10-26T10:00:00Z',{is_new:true}),
  badge('first_checkin','explore','Fresh Ink','First Stamp',1,0,null,{blurb:'Check in to your first event'})],error:null};
 c.S.titleKey=null;c.S.kitSeen=true;overlay.on=false;
 const first=await c.loadBadges(true);assert.equal(c.S.titleKey,'founding','the default title the server gave is worn');
 c.celebrateBadges(first);assert.ok(overlay.on,'the welcome sheet opens');
 assert.match(c.sheet.innerHTML,/your first badge/);assert.match(c.sheet.innerHTML,/wearing the title <b>OG<\/b>/);
 assert.match(c.sheet.innerHTML,/You also earned <b>New in Town<\/b>/);assert.match(c.sheet.innerHTML,/Next up: <b>Fresh Ink<\/b>, check in to your first event/);
 c.S.kitSeen=false;overlay.on=false;c.celebrateBadges(first);assert.equal(overlay.on,false,'a new account sees it in the starter kit, not another sheet');
 assert.match(el('kitBadge').innerHTML,/Your first badge: Founding Local/);assert.equal(el('kitBadge').hidden,false);

 // guests and failures
 c.S.signedUp=false;c.renderShelf();assert.match(el('badgeShelf').innerHTML,/Create an account/,'guests are asked to make an account');
 reply={data:null,error:{message:'Failed to fetch'}};c.S.signedUp=true;c.S.badges=null;
 assert.equal((await c.loadBadges(true)).length,0);assert.match(el('badgeScreen').innerHTML,/Couldn't load your badges/,'a failed load says so');
 console.log('Badge checks passed: loads once a minute, shelf, Badges screen, hidden stay secret, badge sheet and next tier, title picker, wear and remove, refusals, toasts, guests, offline, first badge and default title.');
})().catch(e=>{console.error(e);process.exitCode=1;});
