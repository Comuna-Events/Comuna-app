// Builds the passport-page security pattern: fine wavy lines (guilloche) and a rosette emblem around the Comuna mark,
// in faint dusty blue, plus a paper grain. Run: node scripts/build-guilloche.mjs  (writes stamps/passport-*.svg)
// The pattern tiles vertically, so it covers a page of any length; the app sets how faint it is with these opacities.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = name => fileURLToPath(new URL(`../stamps/${name}`, import.meta.url));
const BLUE = '#7895A0', OCHRE = '#D5AE64';
const f = n => n.toFixed(1);

// Two families of waves at different wavelengths cross each other, like the moiré on a real passport page.
// Each wave's height swells and shrinks down the tile (one full cycle per tile), so the tile repeats seamlessly.
const W = 390, H = 360, GAP = 7;
function family(lambda, amp, phaseStep, dir) {
  let d = '';
  for (let y0 = -GAP * 4; y0 < H + GAP * 4; y0 += GAP) {
    const a = amp * (0.55 + 0.45 * Math.sin(2 * Math.PI * y0 / H)), ph = phaseStep * y0 / H * 2 * Math.PI;
    let p = '';
    for (let x = 0; x <= W; x += 6) p += `${p ? 'L' : 'M'}${x} ${f(y0 + dir * a * Math.sin(2 * Math.PI * x / lambda + ph))}`;
    d += p;
  }
  return d;
}
const waves = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<g fill="none" stroke="${BLUE}" stroke-width=".5" stroke-opacity=".12">
<path d="${family(260, 16, 1, 1)}"/>
<path d="${family(170, 11, 2, -1)}" stroke-opacity=".08"/>
</g></svg>`;
writeFileSync(out('passport-waves.svg'), waves);

// Rosette: rings whose radius ripples (r = R + a·sin(nθ + k)), around the Comuna mark's two circles.
const S = 300, c = S / 2;
let rings = '';
for (let k = 0; k < 22; k++) {
  const R = 46 + k * 4.6, a = 3.2 + (k % 3), n = 18 + (k % 4) * 2;
  let p = '';
  for (let i = 0; i <= 360; i += 2) {
    const t = i / 180 * Math.PI, r = R + a * Math.sin(n * t + k * 0.55);
    p += `${i ? 'L' : 'M'}${f(c + r * Math.cos(t))} ${f(c + r * Math.sin(t))}`;
  }
  rings += `<path d="${p}Z"/>`;
}
const emblem = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<g fill="none" stroke="${BLUE}" stroke-width=".55" stroke-opacity=".13">${rings}</g>
<g fill="none" stroke="${OCHRE}" stroke-opacity=".16"><circle cx="${c}" cy="${c}" r="34" stroke-width="5"/><circle cx="${c}" cy="${c}" r="15" stroke-width="4"/></g>
<circle cx="${c}" cy="${c}" r="5" fill="${OCHRE}" fill-opacity=".16"/></svg>`;
writeFileSync(out('passport-emblem.svg'), emblem);

// Paper grain: fine speckle, warm brown, faint enough to read through.
const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .42  0 0 0 0 .34  0 0 0 0 .22  0 0 0 .14 0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
writeFileSync(out('paper-grain.svg'), grain);
console.log('wrote stamps/passport-waves.svg, stamps/passport-emblem.svg, stamps/paper-grain.svg');
