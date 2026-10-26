// Builds the badge patches (badges/<key>.webp) from badges/patches.json.
//   node scripts/build-badges.mjs                     every drawn badge, plus a blank patch per category (badges/section-<name>.webp)
//   node scripts/build-badges.mjs coffee_1            just the badges named
//   node scripts/build-badges.mjs --redraw coffee_1   replace a badge's illustrated art with a drawn patch
// Badges marked "art": "illustrated" have hand-made images in badges/, and badges marked "art": "stitched" are built by
// scripts/patches/build.cjs; neither is redrawn here unless named with --redraw.
// To add illustrated art, save it as badges/<key>.webp (a square, transparent background) and mark the badge illustrated.
// Each badge's key matches its row in the achievements table (supabase/achievements.sql). A badge the team adds in
// Supabase before it has art here shows its category's blank patch in the app.
// patches.json: "sections" set each category's shape and colors; "tiers" 2 and 3 swap the edge for silver or gold and
// add chevrons; each badge has a section, the ribbon text, and its icon as SVG path data in a -30..30 box centered a
// little above the middle: s (stitched lines), f (filled shapes), g (gold fill), gs (gold lines), gr (green lines).
// Needs Playwright with Chromium (the same setup as the browser tests) and Google Fonts for Big Shoulders Display.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const data = JSON.parse(readFileSync(new URL('../badges/patches.json', import.meta.url)));
const out = name => new URL(`../badges/${name}.webp`, import.meta.url);
const SIZE = 160;   // CSS px; rendered at 2x, so 320 px images

const SHAPES = {
  circle: 'M0 -56 A56 56 0 1 1 0 56 A56 56 0 1 1 0 -56 Z',
  shield: 'M0 -58 L50 -44 L50 4 C50 34 27 50 0 60 C-27 50 -50 34 -50 4 L-50 -44 Z',
  peak: 'M0 -60 L56 -14 L56 54 L-56 54 L-56 -14 Z',
  diamond: 'M0 -62 L62 0 L0 62 L-62 0 Z',
  hex: 'M0 -60 L52 -30 L52 30 L0 60 L-52 30 L-52 -30 Z',
  scallop: 'M0 -56 A12.5 12.5 0 0 1 24.3 -50.5 A12.5 12.5 0 0 1 43.8 -34.9 A12.5 12.5 0 0 1 54.6 -12.5 A12.5 12.5 0 0 1 54.6 12.5 A12.5 12.5 0 0 1 43.8 34.9 A12.5 12.5 0 0 1 24.3 50.5 A12.5 12.5 0 0 1 0 56 A12.5 12.5 0 0 1 -24.3 50.5 A12.5 12.5 0 0 1 -43.8 34.9 A12.5 12.5 0 0 1 -54.6 12.5 A12.5 12.5 0 0 1 -54.6 -12.5 A12.5 12.5 0 0 1 -43.8 -34.9 A12.5 12.5 0 0 1 -24.3 -50.5 A12.5 12.5 0 0 1 0 -56 Z'
};

// fabric: a twill weave lit from the top left, a raised edge and a drop shadow; thread: satin stitches that sit on top
const DEFS = `<defs>
<filter id="emb" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="2.4 0.7" numOctaves="1" seed="4" result="noise"/>
 <feDiffuseLighting in="noise" surfaceScale="0.7" lighting-color="#fff" result="light"><feDistantLight azimuth="225" elevation="62"/></feDiffuseLighting>
 <feComposite in="SourceGraphic" in2="light" operator="arithmetic" k1="1.12" k2="0" k3="0" k4="0" result="tex"/>
 <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="ab"/>
 <feSpecularLighting in="ab" surfaceScale="3" specularConstant=".55" specularExponent="18" lighting-color="#fff" result="spec"><feDistantLight azimuth="225" elevation="45"/></feSpecularLighting>
 <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
 <feComposite in="tex" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".35" k4="0" result="lit"/>
 <feComposite in="lit" in2="SourceAlpha" operator="in" result="patch"/>
 <feGaussianBlur in="SourceAlpha" stdDeviation="2.6" result="sb"/><feOffset in="sb" dx="1" dy="3.5" result="so"/>
 <feFlood flood-color="#26251F" flood-opacity=".38"/><feComposite in2="so" operator="in" result="shadow"/>
 <feMerge><feMergeNode in="shadow"/><feMergeNode in="patch"/></feMerge>
</filter>
<filter id="thread" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
 <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="9" result="n"/>
 <feDisplacementMap in="SourceGraphic" in2="n" scale="1.1" xChannelSelector="R" yChannelSelector="G" result="fz"/>
 <feGaussianBlur in="fz" stdDeviation="1.1" result="b"/>
 <feSpecularLighting in="b" surfaceScale="2.4" specularConstant=".9" specularExponent="22" lighting-color="#fff" result="sp"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>
 <feComposite in="sp" in2="fz" operator="in" result="spi"/>
 <feComposite in="fz" in2="spi" operator="arithmetic" k1="0" k2="1" k3=".45" k4="0" result="lit"/>
 <feColorMatrix in="fz" type="matrix" values="0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0 0.08  0 0 0 .55 0" result="dark"/>
 <feGaussianBlur in="dark" stdDeviation=".9"/><feOffset dx=".8" dy="1.6" result="sh"/>
 <feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>
</filter>
<pattern id="twill" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="1.4" height="4" fill="rgba(0,0,0,.08)"/></pattern>
<pattern id="satin" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="2.2" height="2.2" fill="#F3E7D1"/><rect width="2.2" height=".7" fill="#D9CCB2"/></pattern>
<pattern id="satinInk" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="2.2" height="2.2" fill="#26251F"/><rect width="2.2" height=".7" fill="#45433A"/></pattern>
<pattern id="satinGold" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="2.2" height="2.2" fill="#D6A638"/><rect width="2.2" height=".7" fill="#BE9128"/></pattern>
<pattern id="satinFill" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)"><rect width="2" height="2" fill="#F3E7D1"/><rect width="2" height=".8" fill="#CFC1A4"/></pattern>
<pattern id="satinInkFill" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)"><rect width="2" height="2" fill="#26251F"/><rect width="2" height=".8" fill="#4A473D"/></pattern>
<pattern id="satinGoldFill" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)"><rect width="2" height="2" fill="#D6A638"/><rect width="2" height=".8" fill="#B88A23"/></pattern>
</defs>`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const path = (d, attrs) => d ? `<path d="${esc(d)}" ${attrs}/>` : '';

function patchSVG(look, icon = {}, ribbon = '') {
  const shape = SHAPES[look.shape] || SHAPES.circle, dark = !!look.dark;
  const y = look.shape === 'circle' ? 24 : look.shape === 'scallop' ? 22 : 20;
  const text = ribbon.toUpperCase(), size = text.length > 12 ? 12.5 * 12 / text.length : 12.5;
  const banner = { ink: 'url(#satinInk)', gold: 'url(#satinGold)' }[look.banner] || 'url(#satin)';
  const chev = look.chevrons >= 2 ? 'M-8 -36 L0 -42 L8 -36 M-8 -30 L0 -36 L8 -30' : look.chevrons === 1 ? 'M-8 -36 L0 -42 L8 -36' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="-72 -72 144 144">${DEFS}
<g filter="url(#emb)">
 <path d="${shape}" fill="${look.fill}"/><path d="${shape}" fill="url(#twill)"/>
 <path d="${shape}" fill="none" stroke="${look.edge}" stroke-width="9" stroke-linejoin="round"/>
 <path d="${shape}" fill="none" stroke="${look.thread}" stroke-width="9" stroke-dasharray="1.3 0.9" stroke-linejoin="round"/>
 <path d="${shape}" transform="scale(.82)" fill="none" stroke="${dark ? '#26251F' : '#F3E7D1'}" stroke-width="1.8" stroke-dasharray="3.9 2.9" opacity="${dark ? .5 : .85}"/>
 ${ribbon ? `<path d="M-60 ${y} H60 L54 ${y + 10} L60 ${y + 20} H-60 L-54 ${y + 10} Z" fill="${banner}" stroke="${look.edge}" stroke-width="3"/>` : ''}
</g>
<g filter="url(#thread)">
 ${path(icon.f, `fill="${dark ? 'url(#satinInkFill)' : 'url(#satinFill)'}"`)}
 ${path(icon.f, `fill="none" stroke="${dark ? '#4A473D' : '#DCCFB4'}" stroke-width="1.6" stroke-dasharray="1.4 0.6" stroke-linejoin="round"`)}
 ${path(icon.s, `fill="none" stroke="${dark ? '#26251F' : '#F3E7D1'}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"`)}
 ${path(icon.s, `fill="none" stroke="${dark ? '#4A473D' : '#C9BA9C'}" stroke-width="5.6" stroke-dasharray="0.6 0.7" stroke-linejoin="round"`)}
 ${path(icon.g, 'fill="url(#satinGoldFill)"')}
 ${path(icon.gs, 'fill="none" stroke="#D6A638" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"')}
 ${path(icon.gr, 'fill="none" stroke="#9BBF8A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"')}
 ${path(chev, `fill="none" stroke="${look.thread}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`)}
</g>
${ribbon ? `<text y="${y + 14.5}" text-anchor="middle" font-family="Big Shoulders Display" font-weight="800" font-size="${size.toFixed(1)}" letter-spacing="1" fill="${look.ink}">${esc(text)}</text>` : ''}
</svg>`;
}

const redraw = process.argv.includes('--redraw'), only = process.argv.slice(2).filter(a => a !== '--redraw');
const jobs = [];
for (const [key, b] of Object.entries(data.badges)) {
  if (only.length && !only.includes(key)) continue;
  if (b.art && !(redraw && only.includes(key))) { if (only.length) console.log(`${key} has ${b.art} art; add --redraw to replace it.`); continue; }
  if (!data.sections[b.section]) throw new Error(`${key}: unknown section "${b.section}"`);
  jobs.push([key, patchSVG({ ...data.sections[b.section], ...(data.tiers[b.tier] || {}) }, b, b.ribbon)]);
}
if (!only.length) for (const [name, look] of Object.entries(data.sections)) jobs.push([`section-${name}`, patchSVG(look)]);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: SIZE, height: SIZE } });
await page.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800&display=swap" rel="stylesheet"></head>
  <body style="margin:0;background:transparent"><div id="p" style="font-family:'Big Shoulders Display'">.</div></body></html>`);
await page.evaluate(() => document.fonts.load('800 12px "Big Shoulders Display"'));
for (const [name, svg] of jobs) {
  await page.evaluate(s => { document.getElementById('p').innerHTML = s; }, svg);
  const png = await page.locator('#p svg').screenshot({ omitBackground: true });
  // Playwright saves PNG; the page's canvas re-encodes it as WebP (about a fifth of the size)
  const webp = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/webp', 0.86).split(',')[1];
  }, png.toString('base64'));
  writeFileSync(out(name), Buffer.from(webp, 'base64'));
}
await browser.close();
console.log(`Built ${jobs.length} badge patch${jobs.length === 1 ? '' : 'es'} in badges/.`);
