// Copies the web app into ios-web/, the folder Capacitor packages into the iPhone app (run it with `npm run ios`).
// The copy of index.html also loads Capacitor and native.js, which switch location and sharing to the native versions;
// the web app itself is unchanged. Nothing in ios-web/ is committed: it's rebuilt every time.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
html = html.replace(hook, `${hook}\n<script src="capacitor.js"></script>\n<script src="native.js"></script>`);

const token = /^const MAPBOX_TOKEN = ".*";$/m;
if (!token.test(html)) throw new Error('index.html no longer has its MAPBOX_TOKEN line; update scripts/build-ios.mjs to match');
if (MAPBOX_IOS_TOKEN) html = html.replace(token, `const MAPBOX_TOKEN = "${MAPBOX_IOS_TOKEN}";`);
else console.warn('No MAPBOX_IOS_TOKEN in scripts/build-ios.mjs: the app will show the Paper map instead of Mapbox');
writeFileSync(join(out, 'index.html'), html);

console.log(`Copied the app into ios-web/ (${files.length + 2} items)`);
