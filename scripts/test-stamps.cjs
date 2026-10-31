// Run: node scripts/test-stamps.cjs. Place stamps: area codes, the visit date and time, weekly days, and what each shape shows.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const between=(a,b)=>{const i=source.indexOf(a);return source.slice(i,source.indexOf(b,i));};
const c={Date,Math,String,Set,parseInt,isNaN,escH:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 catKey:k=>k,CATS:{}};
vm.createContext(c);
vm.runInContext(between('// Place stamps: passport entry stamps','function cityLabel(').replace(/^(const|let) /gm,'var '),c);
vm.runInContext(between('// "THURSDAYS" or "WED & SAT"','// Before anyone').replace(/^(const|let) /gm,'var '),c);

// area codes from zips across LA County
for(const [zip,code] of [['90401','310'],['90012','213'],['90026','213'],['90042','323'],['90033','323'],['90025','310'],['91601','818'],['91101','626'],['90802','562'],['91767','909'],['93534','661'],['', ''],['10001','']])
  assert.equal(c.areaCode(zip),code,`area code for "${zip}"`);
assert.equal(c.areaCode('123 Main St, Los Angeles, 90042'),'323','reads the zip out of an address');

// visit date and time, in LA time, month first
assert.deepEqual(JSON.parse(JSON.stringify(c.stampDate('2026-11-02T02:15:00Z'))),{date:'11.01.26',time:'18:15'});
assert.deepEqual(JSON.parse(JSON.stringify(c.stampDate(null))),{});

// weekly days for the welcome stamps
assert.equal(c.weeklyDays({recDetail:'Every Thursday'}),'THURSDAYS');
assert.equal(c.weeklyDays({recDetail:'Every Saturday 8am-1:30pm and every Tuesday 1:30-7pm'}),'TUE & SAT');
assert.equal(c.weeklyDays({recDetail:'',start:new Date(2026,10,4)}),'WEDNESDAYS');

// every kind of place gets its own shape, with the place, neighborhood, area code, visit number and date
const shapes=new Set();
for(const kind of ['food','arts','classes','active','markets','community']){
  const html=c.placeStamp('The <Echo> & Co','Echo Park',kind,3,0,150,null,null,{date:'11.01.26',time:'20:10',area:'213'});
  assert.doesNotMatch(html,/<ECHO/i,`${kind}: the name is escaped`); assert.match(html,/THE &lt;ECHO/,`${kind}: name shown`);
  assert.match(html,/ECHO PARK/,`${kind}: neighborhood`); assert.match(html,/213/,`${kind}: area code`);
  assert.match(html,/№ 03/,`${kind}: visit number`); assert.match(html,/11\.01\.26/,`${kind}: date`); assert.match(html,/20:10/,`${kind}: time`);
  shapes.add(html.match(/<(rect|polygon|path|circle) [^>]*fill="none"[^>]*>/)[0]);   // each outline is its own
}
assert.equal(shapes.size,6,'six different shapes');
// on the welcome screen: days instead of a date, no visit number or time
const w=c.placeStamp('Sawtelle Run Club','Sawtelle','active',0,0,150,null,'#F3E7D1',{days:'THURSDAYS',area:'310'});
assert.match(w,/THURSDAYS/); assert.doesNotMatch(w,/№/); assert.match(w,/fill="#F3E7D1"/,'pale ink on the dark welcome screen');
// two stamps on one page never share a filter id
const ids=[c.placeStamp('A','B','arts',1,0),c.placeStamp('A','B','arts',1,0)].map(h=>h.match(/filter id="([^"]+)"/)[1]);
assert.notEqual(ids[0],ids[1]);
console.log('Stamp checks passed: area codes, visit date and time, weekly days, six shapes with name, neighborhood, area code, visit number and date, welcome stamps, unique filters.');
