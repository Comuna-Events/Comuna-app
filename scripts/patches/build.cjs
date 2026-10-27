// Builds the stitched badge patches (badges/<key>.webp) from the icon sets in this folder.
//   node scripts/patches/build.cjs              every badge in the sets, plus each category's blank patch
//   node scripts/patches/build.cjs coffee_1     just the badges named
// patch.cjs holds the patch itself (fabric, rim, running stitch, ribbon, lettering) with a shape and colorway per
// category; icons-<category>.cjs hold each badge's ribbon text and its icon as SVG drawn in the -60..30 area above
// the ribbon. After a rebuild, bump BADGE_ART in index.html so phones fetch the new images.
// Needs Playwright with Chromium (the same setup as the browser tests) and Google Fonts for Oswald.
const fs = require('node:fs'), path = require('node:path'), { chromium } = require('playwright');
const { patch } = require('./patch.cjs');
const SIZE = 320; // drawn at 512 and scaled down: sharp at the largest place the app shows a badge (170px) on 2x screens
const sets = Object.assign({}, ...['everyday', 'habits', 'explore', 'kinds', 'contributing', 'seasonal', 'hidden'].map(n => require(`./icons-${n}.cjs`)));
// each category's blank patch (badges/section-<name>.webp), shown when a badge has no art of its own yet
const SECTIONS = { everyday: ['circle', 'red'], habits: ['circle', 'blue'], explore: ['hex', 'green'], kinds: ['diamond', 'gold'],
  contributing: ['hex', 'coral'], seasonal: ['scallop', 'black'], hidden: ['circle', 'charcoal'] };
for (const [name, [shape, palette]] of Object.entries(SECTIONS)) sets[`section-${name}`] = { shape, palette };
const only = process.argv.slice(2), out = path.join(__dirname, '../../badges');
for (const k of only) if (!sets[k]) throw new Error(`${k} is not in any icons-*.cjs set`);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent('<html><head><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@600&display=swap" rel="stylesheet"></head><body style="margin:0;background:transparent"><div id="p" style="font-family:Oswald">.</div></body></html>');
  await page.evaluate(() => document.fonts.load('600 17px Oswald'));
  let n = 0;
  for (const [key, cfg] of Object.entries(sets)) {
    if (only.length && !only.includes(key)) continue;
    await page.evaluate(s => { document.getElementById('p').innerHTML = s; }, patch(cfg));
    const png = await page.locator('#p svg').screenshot({ omitBackground: true });
    const webp = await page.evaluate(async ([b64, size]) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/webp', .88).split(',')[1];
    }, [png.toString('base64'), SIZE]);
    fs.writeFileSync(path.join(out, `${key}.webp`), Buffer.from(webp, 'base64')); n++;
  }
  await browser.close();
  console.log(`Built ${n} stitched badge${n === 1 ? '' : 's'} into badges/. Bump BADGE_ART in index.html so phones fetch the new art.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
