const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const { waitForStreamData } = require('../../utils/data-ingestion.js');

const API_BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080').replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || 'default';
// Self-hosted has no org delete, so one stable second org is reused instead of a new one per run.
const OTHER_ORG_NAME = 'e2e_live_mode_org_switch';
const STREAM = `ovn_b2_live_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function ensureOtherOrg() {
  const list = await api('GET', '/organizations');
  const found = (list.data || []).find((o) => o.name === OTHER_ORG_NAME);
  if (found) return found.identifier;
  const created = await api('POST', '/organizations', { name: OTHER_ORG_NAME });
  return created.identifier;
}

function trackSearches(page) {
  const log = [];
  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && /\/_search(_stream)?\?/.test(url) && (req.postData() || '').includes(STREAM)) {
      log.push({ org: url.split('/api/')[1].split('/')[0], histogram: url.includes('is_ui_histogram=true') });
    }
  });
  return log;
}

test.describe('Logs live mode survives an org switch and back (ENT#730)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let otherOrg;

  test.beforeAll(async () => {
    otherOrg = await ensureOtherOrg();
    const now = Date.now();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      _timestamp: (now - i * 20_000) * 1000,
      level: i % 3 === 0 ? 'error' : 'info',
      message: `ovn-b2 live mode row ${i}`,
    }));
    await api('POST', `/${ORG()}/${STREAM}/_json`, rows);
    testLogger.info(`Ingested ${rows.length} rows into ${STREAM}; second org ${otherOrg}`);
  });

  test.afterAll(async () => {
    await api('DELETE', `/${ORG()}/streams/${STREAM}?type=logs&delete_all=true`).catch((e) => testLogger.warn(`Stream cleanup failed: ${e.message}`));
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('after live mode, a switch to another org and back, search and histogram both run and the histogram renders', {
    tag: ['@bug-730', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    await waitForStreamData(page, STREAM, 30);
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${ORG()}&stream_type=logs&stream=${STREAM}&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true`);
    const refresh = pm.logsAutoRefreshPage;
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await refresh.expectHistogramRendered();

    await refresh.openPopover();
    await refresh.pickInterval(60);
    await expect(page).toHaveURL(/[?&]refresh=60(&|$)/);
    await refresh.closePopover();
    await refresh.expectTriggerLabel(/1\s*m|60/i);

    await refresh.switchOrg(otherOrg);
    testLogger.info(`Refresh trigger in the other org: ${await refresh.getTriggerLabel()}`);

    const searches = trackSearches(page);
    await refresh.switchOrg(ORG());
    testLogger.info(`Refresh trigger back in the first org: ${await refresh.getTriggerLabel()}`);
    await pm.logsPage.selectStream(STREAM, 3, 0, true);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    await expect.poll(() => searches.filter((s) => s.org === ORG() && !s.histogram).length, {
      timeout: 30000, message: 'the results search must fire after returning to the org',
    }).toBeGreaterThan(0);
    await expect.poll(() => searches.filter((s) => s.org === ORG() && s.histogram).length, {
      timeout: 30000, message: 'the histogram search must fire after returning to the org',
    }).toBeGreaterThan(0);
    await refresh.expectHistogramRendered();
    await refresh.expectHistogramHasData();
  });
});
