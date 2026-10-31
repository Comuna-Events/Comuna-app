// Run: node scripts/test-event-cards.cjs. The price, end time, photo credit and review line on event cards and pages; no browser.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const line=start=>source.slice(source.indexOf(start),source.indexOf('\n',source.indexOf(start)));
const block=start=>{const a=source.indexOf(start);return source.slice(a,source.indexOf('\n}',a)+2);};
const c={URL,escH:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),okLink:u=>{try{const x=new URL(u);return /^https?:$/.test(x.protocol)?x.href:'';}catch(e){return '';}},
 nextWhen:ev=>ev._w,goingText:()=>'',SOCIAL_MIN:3};
vm.createContext(c);
const between=(a,b)=>{const i=source.indexOf(a);return source.slice(i,source.indexOf(b,i));};
const vars=code=>code.replace(/^const /gm,'var ');
vm.runInContext(block('function fmtTime('),c);
vm.runInContext(vars(line('const crowdText=')),c);
vm.runInContext(vars(between('// reviews (review_summary()','\n/* ')),c);   // socialText, priceTag, cardWhen, cardMeta
vm.runInContext(vars(between("// the event's own photo",'// Free / paid stated')),c);   // photoHtml, reviewLine

// price: the amount when the listing gives one, else the Free / Paid label
assert.equal(c.priceTag({price:'Free',priceAmt:'$0'}),'Free');
assert.equal(c.priceTag({price:'Paid',priceAmt:'$20–40'}),'$20–40');
assert.equal(c.priceTag({price:'Paid',priceAmt:''}),'Paid');
assert.equal(c.priceTag({price:'Donation / Pay-what-you-can'}),'Pay what you can');
assert.equal(c.priceTag({price:''}),'','no label when the listing doesn\'t say');

// end times only when there's a start time to attach them to
assert.equal(c.cardWhen({start:1,t0:'09:00',t1:'14:00',_w:'Sun, Nov 2 · 9 AM'}),'Sun, Nov 2 · 9 AM–2 PM');
assert.equal(c.cardWhen({start:1,t0:'09:00',t1:'',_w:'Sun, Nov 2 · 9 AM'}),'Sun, Nov 2 · 9 AM');
assert.equal(c.cardWhen({start:1,t0:'09:00',t1:'14:00',_w:'Happening now'}),'Happening now');
assert.equal(c.cardWhen({start:null,time:'Every Tuesday · 7 PM',t0:'19:00',t1:'21:00'}),'Every Tuesday · 7 PM');

// card line: venue · price · reviews beat counts; "Saved" replaces the counts
assert.equal(c.cardMeta({venue:'The Smell',price:'Paid',priceAmt:'$15',checkedIn:5},false),'The Smell · <b class="cprice">$15</b> · 5 checked in');
assert.equal(c.cardMeta({venue:'Park',price:'Free',rev:{pct:90,n:4,tags:[]},checkedIn:5},false),'Park · <b class="cprice">Free</b> · 90% liked it');
assert.equal(c.cardMeta({venue:'Park',price:''},true),'Park · Saved');

// photo: credited to the event's page, escaped; none without a photo
const ph=c.photoHtml({photo:'https://img.example.com/a.jpg',source:'https://www.thevenue.com/events/1'});
assert.match(ph,/Photo: <a href="https:\/\/www\.thevenue\.com\/events\/1"[^>]*>thevenue\.com<\/a>/);
assert.equal(c.photoHtml({photo:''}),'');
assert.equal(c.reviewLine({rev:{pct:80,n:5,tags:['Great vibe']}}),'<div class="evrev"><b>80% liked it</b> · 5 reviews · Great vibe</div>');
console.log('Event card checks passed: price labels and amounts, end times, card line order, photo credit, review line.');
