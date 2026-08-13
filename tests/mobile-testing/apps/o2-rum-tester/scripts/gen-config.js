// Injects the RUM target into App.tsx by TEXT-SUBSTITUTING the inline `@gen:*` constants from
// environment variables (used by CI to retarget the app at a local/alpha OpenObserve). With no env
// set it's a no-op, so the committed defaults (dev cluster) stay — running it locally changes nothing.
//
// Why sed-the-source instead of importing a JSON config: a `import cfg from './rum.config.json'` in
// App.tsx silently breaks RUM upload in the Hermes release build. Inline constants work; we just
// rewrite them at build time. See docs/CI-NOTES.md.
const fs = require('fs');
const path = require('path');

const appTsx = path.join(__dirname, '..', 'App.tsx');
const map = {
  host: process.env.O2_RUM_HOST,
  org: process.env.O2_RUM_ORG,
  token: process.env.O2_RUM_TOKEN,
  env: process.env.O2_RUM_ENV,
};

let src = fs.readFileSync(appTsx, 'utf8');
let changed = [];
for (const [key, val] of Object.entries(map)) {
  if (!val) continue; // unset → leave the committed default
  const re = new RegExp(`(const RUM_[A-Z]+ = ')[^']*('; // @gen:${key})`);
  if (re.test(src)) {
    // Function replacer, NOT a `$1${val}$2` string — a literal `$` in val would otherwise be read
    // as a replacement directive and corrupt App.tsx.
    src = src.replace(re, (_m, p1, p2) => p1 + val + p2);
    changed.push(`${key}=${val}`);
  }
}
fs.writeFileSync(appTsx, src);
console.log('gen-config:', changed.length ? changed.join(' ') : 'no env override (committed defaults)');
