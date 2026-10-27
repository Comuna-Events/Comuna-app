// Copies the web app into ios-web/, the folder Capacitor packages into the iPhone app (run it with `npm run ios`).
// The copy of index.html also loads Capacitor and native.js, which switch location and sharing to the native versions;
// the web app itself is unchanged. Nothing in ios-web/ is committed: it's rebuilt every time.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'ios-web');
// The service worker is left out: iOS apps can't run one, and the app's files are already on the phone.
const files = ['places.js', 'manifest.json', 'native.js', 'badges', 'stamps'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of files) cpSync(join(root, f), join(out, f), { recursive: true });
cpSync(join(root, 'node_modules/@capacitor/core/dist/capacitor.js'), join(out, 'capacitor.js'));

const html = readFileSync(join(root, 'index.html'), 'utf8');
const hook = '<meta name="mobile-web-app-capable" content="yes" />';
if (!html.includes(hook)) throw new Error(`index.html no longer has ${hook}; update scripts/build-ios.mjs to add the scripts elsewhere in <head>`);
writeFileSync(join(out, 'index.html'),
  html.replace(hook, `${hook}\n<script src="capacitor.js"></script>\n<script src="native.js"></script>`));

console.log(`Copied the app into ios-web/ (${files.length + 2} items)`);
