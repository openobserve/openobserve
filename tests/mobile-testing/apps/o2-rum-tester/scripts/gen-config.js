// Regenerates rum.config.json from environment variables (used by CI to retarget the app at a
// locally-built OpenObserve). With no env set it rewrites the SAME committed defaults, so running
// it locally is a no-op. See docs/CI-NOTES.md.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'rum.config.json');
const current = JSON.parse(fs.readFileSync(out, 'utf8'));

const cfg = {
  host: process.env.O2_RUM_HOST || current.host,
  org: process.env.O2_RUM_ORG || current.org,
  token: process.env.O2_RUM_TOKEN || current.token,
  env: process.env.O2_RUM_ENV || current.env,
};

fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
console.log('rum.config.json ->', cfg.host, cfg.org);
