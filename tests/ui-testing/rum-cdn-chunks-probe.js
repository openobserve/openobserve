// Probe: which browsersdk.openobserve.ai assets does the SDK load at runtime,
// do recorder/profiler chunks load, and does replay data land?
// Run from tests/ui-testing: set -a && source .env && set +a && node rum-cdn-chunks-probe.js
const { chromium, request: pwRequest } = require('@playwright/test');
const { startFixtureServer } = require('./fixtures/rum/serve.js');

const ORG = process.env.ORGNAME || 'default';
const BASE = process.env.ZO_BASE_URL || 'http://localhost:5080';
const SITE = BASE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const SERVICE = `probe-rum-chunks-${Date.now()}`;

async function main() {
  const auth = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');
  const api = await pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Basic ${auth}` } });
  const token = (await (await api.get(`${BASE}/api/${ORG}/rumtoken`)).json())?.data?.rum_token;

  const server = await startFixtureServer({
    clientToken: token, org: ORG, site: SITE, insecureHTTP: true,
    service: SERVICE, env: 'e2e', version: '1.0.0', applicationId: 'probe-chunks',
    sdkVersion: '0.3.4',
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('response', (res) => {
    if (res.url().includes('browsersdk.openobserve.ai')) {
      console.log('CDN RES', res.status(), res.url().replace('https://browsersdk.openobserve.ai', ''),
        '| content-type:', res.headers()['content-type'], '| nosniff:', res.headers()['x-content-type-options'] || '-');
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('browsersdk.openobserve.ai')) {
      console.log('CDN FAILED', req.url().replace('https://browsersdk.openobserve.ai', ''), '-', (req.failure() || {}).errorText);
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /recorder|profiler|replay|Openobserve/i.test(msg.text())) {
      console.log('[console]', msg.type(), msg.text().slice(0, 300));
    }
  });

  await page.goto(server.url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  // give replay recorder time to lazy-load + emit a segment
  await page.mouse.move(100, 100);
  await page.locator('[data-test="rum-sample-track-action-btn"]').click().catch(() => {});
  await page.waitForTimeout(12000);

  // replay segments flush on unload too
  await page.goto('about:blank').catch(() => {});
  await page.waitForTimeout(2000);
  await page.close(); await browser.close(); await server.close();

  await new Promise((r) => setTimeout(r, 6000));
  const end = Date.now() * 1000, start = end - 15 * 60 * 1e6;
  const q = await api.post(`${BASE}/api/${ORG}/_search?type=logs`, {
    data: { query: { sql: `SELECT session_id FROM "_rumdata" WHERE service = '${SERVICE}' LIMIT 1`, start_time: start, end_time: end, from: 0, size: 1 } },
  });
  const sid = (await q.json())?.hits?.[0]?.session_id;
  console.log('session_id:', sid || 'NONE');
  if (sid) {
    const q2 = await api.post(`${BASE}/api/${ORG}/_search?type=logs`, {
      data: { query: { sql: `SELECT count(*) as cnt FROM "_sessionreplay" WHERE session_id = '${sid}'`, start_time: start, end_time: end, from: 0, size: 1 } },
    });
    console.log('_sessionreplay segments for session:', JSON.stringify((await q2.json())?.hits));
  }
  await api.dispose();
}

main().catch((e) => { console.error('PROBE ERROR:', e); process.exit(1); });
