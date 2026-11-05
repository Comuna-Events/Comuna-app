// Copies the web app into ios-web/, the folder Capacitor packages into the iPhone and Android apps (run it with
// `npm run ios` or `npm run android`; despite the folder's name, both apps use it).
// The copy of index.html also loads Capacitor and native.js, which switch location and sharing to the native versions;
// the web app itself is unchanged. Nothing in ios-web/ is committed: it's rebuilt every time.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The web token only works on the team's site (Mapbox > Tokens > URL restrictions), and the app's pages come from
// capacitor://localhost, so the app has its own public token with no URL restrictions.
const MAPBOX_IOS_TOKEN = 'pk.eyJ1IjoiY3BpY2tlMjEiLCJhIjoiY212cjhjMTViMDZ4OTM1b3N0YnZuODB1ZyJ9.U5boDNR9DKaoEzK4IwP1Cg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ios-web');
// The service worker is left out: iOS apps can't run one, and the app's files are already on the phone.
const files = ['places.js', 'manifest.json', 'native.js', 'badges', 'stamps'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of files) cpSync(join(root, f), join(out, f), { recursive: true });
cpSync(join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), join(out, 'capacitor.js'));

let html = readFileSync(join(root, 'index.html'), 'utf8');
const hook = '<meta name="mobile-web-app-capable" content="yes" />';
if (!html.includes(hook)) throw new Error(`index.html no longer has ${hook}; update scripts/build-ios.mjs to add the scripts elsewhere in <head>`);
// Android reminders need Firebase's settings file (ANDROID.md); without it, native.js keeps reminders hidden there
const androidPush = existsSync(join(root, 'android/app/google-services.json'));
html = html.replace(hook, `${hook}\n<script>window.comunaBuild={ androidPush:${androidPush} };</script>`
  + `\n<script src="capacitor.js"></script>\n<script src="native.js"></script>`);

// Notches and the gesture bar: the page pads itself with env(safe-area-inset-*). Android WebViews older than
// version 140 leave those at 0, so Capacitor sets --safe-area-inset-* instead; use it when it's there (iOS never sets
// it, so the iPhone keeps using env()).
const before = html;
html = html.replace(/env\(safe-area-inset-(top|right|bottom|left)(,[^)]*)?\)/g, (m, side) => `var(--safe-area-inset-${side},${m})`);
if (html === before) throw new Error('index.html no longer uses env(safe-area-inset-*); update scripts/build-ios.mjs to match');

// An app doesn't zoom or rubber-band like a web page: no pinch or double-tap zoom, and the page itself doesn't slide
// when dragged (lists and the map still scroll). The website keeps zoom for people who need it.
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
if (!html.includes(viewport)) throw new Error('index.html no longer has its viewport meta tag; update scripts/build-ios.mjs to match');
html = html.replace(viewport, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n'
  + '<style>html, body { overscroll-behavior: none }</style>');

const token = /^const MAPBOX_TOKEN = ".*";$/m;
if (!token.test(html)) throw new Error('index.html no longer has its MAPBOX_TOKEN line; update scripts/build-ios.mjs to match');
if (MAPBOX_IOS_TOKEN) html = html.replace(token, `const MAPBOX_TOKEN = "${MAPBOX_IOS_TOKEN}";`);
else console.warn('No MAPBOX_IOS_TOKEN in scripts/build-ios.mjs: the app will show the Paper map instead of Mapbox');
// The website loads the Supabase library and the fonts from the internet. The app carries its own copies, so it
// starts with sign-in, syncing and the right fonts even when the phone has no signal at launch (a basement venue, a
// festival crowd). Same versions as the website: keep package.json in step with the links in index.html.
const supabaseCdn = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@([\d.]+)\/dist\/umd\/supabase\.min\.js"><\/script>/;
const cdnVersion = html.match(supabaseCdn)?.[1];
if (!cdnVersion) throw new Error('index.html no longer loads supabase-js from jsDelivr; update scripts/build-ios.mjs to match');
const localVersion = JSON.parse(readFileSync(join(root, 'node_modules/@supabase/supabase-js/package.json'), 'utf8')).version;
if (localVersion !== cdnVersion) throw new Error(`index.html uses supabase-js ${cdnVersion} but package.json has ${localVersion}; make them match`);
cpSync(join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), join(out, 'supabase.js'));
html = html.replace(supabaseCdn, '<script src="supabase.js"></script>');

// Fonts: the same families and weights as the Google Fonts link, Latin and Latin Extended (accents like "Día")
// patrick-hand-sc: the map's hand-lettered neighborhood names (the website loads it from Google Fonts when the map draws)
const FONTS = { 'big-shoulders-display': [700, 800, 900], 'dm-sans': [400, 500, 700], caveat: [600, 700], 'patrick-hand-sc': [400] };
const googleFonts = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet">/;
if (!googleFonts.test(html)) throw new Error('index.html no longer has its Google Fonts link; update scripts/build-ios.mjs to match');
mkdirSync(join(out, 'fonts'));
let css = '';
for (const [family, weights] of Object.entries(FONTS)) {
  const pkg = join(root, 'node_modules/@fontsource', family);
  for (const w of weights) {
    // each block in @fontsource's CSS is one subset; keep latin and latin-ext, point them at our copies, woff2 only
    for (const block of readFileSync(join(pkg, `${w}.css`), 'utf8').split(/(?=\/\* )/)) {
      const file = block.match(/url\(\.\/files\/([\w-]+-latin(?:-ext)?-\d+-normal\.woff2)\)/)?.[1];
      if (!file) continue;
      cpSync(join(pkg, 'files', file), join(out, 'fonts', file));
      css += block.replace(/src:[^;]+;/, `src: url(fonts/${file}) format('woff2');`).trim() + '\n';
    }
  }
}
const fontFiles = readdirSync(join(out, 'fonts')).length;
if (fontFiles !== 2 * Object.values(FONTS).flat().length) throw new Error(`Expected ${2 * Object.values(FONTS).flat().length} font files, copied ${fontFiles}`);
writeFileSync(join(out, 'fonts.css'), css);
html = html.replace(googleFonts, '<link href="fonts.css" rel="stylesheet">');
writeFileSync(join(out, 'index.html'), html);

console.log(`Copied the app into ios-web/ (${files.length + 2} items, plus supabase.js and ${fontFiles} font files)`);
