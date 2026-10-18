// Run with: node scripts/test-event-schedule.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const context = { Date, Intl, Math, FULL_WD: ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'], evDate: () => null };
vm.createContext(context);
for (const name of ['hm','occurrenceEnd','occursOn','nextDate','inWindow']) {
  const start = source.indexOf('function ' + name + '(');
  const end = name === 'hm' ? source.indexOf('\n', start) : source.indexOf('\n}', start) + 2;
  vm.runInContext(source.slice(start, end), context);
}
const day = (date, hour = 0) => new Date(2026, 9, date, hour);
const event = (rec = 'One-off', start = day(17), end = null, t0 = '10:00', t1 = '12:00') => ({ rec, start, end, t0, t1 });
assert.equal(context.nextDate(event(), day(17, 12)), null);
assert.equal(+context.nextDate(event(), day(17, 11)), +day(17));
for (const [rec, next] of [['Daily', day(18)], ['Weekly', day(24)], ['Biweekly', day(31)], ['Monthly', new Date(2026, 10, 21)]]) {
  assert.equal(+context.nextDate(event(rec), day(17, 13)), +next);
}
assert.equal(context.nextDate(event('Weekly', day(17), day(17)), day(17, 13)), null);
for (const end of [null, day(16), day(17)]) {
  const overnight = event('One-off', day(16), end, '22:00', '02:00');
  assert.equal(+context.nextDate(overnight, day(17, 1)), +day(16));
  assert.equal(context.nextDate(overnight, day(17, 2)), null);
  assert.equal(context.nextDate(overnight, day(18, 1)), null);
}
assert.equal(+context.nextDate(event('Weekly', day(16), null, '22:00', '02:00'), day(17, 3)), +day(23));
assert.equal(+context.nextDate(event('One-off', day(17), null, '10:00', ''), day(17, 23)), +day(17));
assert.equal(+context.nextDate(event('One-off', day(16), day(19)), day(17, 13)), +day(18));
assert.equal(context.occursOn(event(), day(17)), true); // History keeps finished occurrences.
context.eventNow = () => day(17, 13);
context.when = 'tonight'; // Internal key retained for compatibility; UI label is Today.
assert.equal(context.inWindow(event()), false);
assert.equal(context.inWindow(event('Weekly')), false);
context.when = 'week';
assert.equal(context.inWindow(event('Daily')), true);
context.when = 'any';
assert.equal(context.inWindow(event()), false);
assert.equal(context.inWindow({}), true);
context.eventNow = () => day(17, 1);
context.when = 'tonight';
assert.equal(context.inWindow(event('One-off', day(16), null, '22:00', '02:00')), true);
console.log('Event schedule checks passed.');
