const http = require('http');
const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const NETWORK_IDLE_TIMEOUT_MS = 30000;
const EXTENDED_TIMEOUT_MS = 180000;

/**
 * Chart-image visual verification for notification templates v2 (PR #13640).
 *
 * The chart PNG rendering itself is unit-tested in Rust (`chart::render::render_png`).
 * This spec asserts the PAYLOAD CONTRACT that the alert send path produces —
 * i.e. that an image block reaches Slack, a chart_url reaches the webhook
 * envelope, and content-spec placeholders resolve to expected values.
 *
 * Approach: for each test, POST the template + destination + alert via API
 * (no UI — this is a wire-shape test, not a flow test), trigger via API,
 * assert against the in-test HTTP receiver's captured payload.
 *
 * Cross-references:
 * - Positive multi-channel E2E flow: alerts-content-templates.spec.js
 * - Manual test artifacts + full test matrix: tests/ui-testing/test-artifacts/chart-templates/TEST-REFERENCE.md
 */
test.describe('Content Templates - Chart Visual Contract', () => {
  let pm;
  let sharedRandomValue;
  let receiverServer;
  let receiverPort;
  let received;

  test.beforeAll(async () => {
    received = { slack: [], hook: [] };
    receiverServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const bucket = req.url.startsWith('/slack') ? 'slack' : req.url.startsWith('/hook') ? 'hook' : null;
        if (bucket) received[bucket].push({ url: req.url, body });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
    });
    await new Promise((resolve) => receiverServer.listen(0, '127.0.0.1', resolve));
    receiverPort = receiverServer.address().port;
    testLogger.info('Chart-visual test receiver started', { receiverPort });
  });

  test.afterAll(async () => {
    if (receiverServer) {
      await new Promise((resolve) => receiverServer.close(resolve));
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString().toLowerCase();
    }
    received.slack = [];
    received.hook = [];
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // Shared helpers — API-only creation for template/destination/alert.
  const buildContentTemplate = (contentSpec) => ({
    kind: 'content',
    type: 'http',
    title: '',
    body: JSON.stringify(contentSpec),
    isDefault: null,
    isPrebuilt: false,
  });

  // Poll the v2 alerts list until an alert with the given name appears, then
  // return its id. The v1 GET /api/{org}/alerts endpoint sometimes returns an
  // empty body immediately after createAlert; v2 with folder=default is the
  // reliable path.
  const findAlertIdByName = async (page, baseUrl, org, alertName) => {
    let alertId = null;
    await expect.poll(async () => {
      const resp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts?folder=default&page_size=200`);
      if (!resp.ok()) return null;
      const bodyText = await resp.text();
      if (!bodyText || bodyText.trim().length === 0) return null;
      let j;
      try { j = JSON.parse(bodyText); } catch { return null; }
      const list = Array.isArray(j) ? j : (j.list || j.data || []);
      const found = list.find((a) => a.name === alertName);
      if (found) alertId = found.alert_id || found.id;
      return alertId;
    }, { timeout: 30000, intervals: [1000, 2000, 3000] }).toBeTruthy();
    return alertId;
  };

  // API model expects FLAT fields (url, method, type, destination_type_name) —
  // NOT a nested `destination_type` object. Confirmed against
  // src/api/management/src/models/destinations.rs Destination::into (flat url,
  // method, destination_type_name).
  const createDestination = async (page, baseUrl, org, name, path, destinationType, templateName) => {
    const resp = await page.request.post(`${baseUrl}/api/${org}/alerts/destinations`, {
      data: {
        name,
        url: `http://127.0.0.1:${receiverPort}${path}`,
        method: 'post',
        type: 'http',
        template: templateName,
        destination_type_name: destinationType,
        skip_tls_verify: false,
        metadata: {},
      },
    });
    if (!resp.ok()) {
      throw new Error(`Failed to create destination ${name}: ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
    return resp;
  };

  test('T1: Multi-severity alert emits Slack image block AND alert config carries warning_threshold', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `alert_chart_multi_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_multi_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_multi_slack_${sharedRandomValue}`;

    testLogger.info('T1 setup: multi-severity chart template + Slack destination');

    // Template — chart enabled, minimal body.
    const spec = {
      title: 'multi severity chart',
      body: 'level={alert_level} value={alert_agg_value}',
      title_overrides: {}, fields: [], links: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      chart: { enabled: true },
    };
    const tplResp = await page.request.post(`${baseUrl}/api/${org}/alerts/templates`, {
      data: { name: templateName, ...buildContentTemplate(spec) },
    });
    expect(tplResp.ok(), 'template save should succeed').toBeTruthy();

    await createDestination(page, baseUrl, org, slackDestName, '/slack', 'slack', templateName);

    // Alert via UI wizard then API PUT to attach warning_threshold — the wizard
    // doesn't expose multi-severity config, so we patch it in.
    await pm.commonActions.initializeAlertTestStream(streamName);
    await page.goto(`${baseUrl}/web/alerts?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    const alertName = await pm.alertsPage.createAlert(streamName, 'city', 'bangalore', slackDestName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);

    // Patch alert to add warning_threshold (critical threshold stays; warning
    // is what makes this multi-severity).
    const alertId = await findAlertIdByName(page, baseUrl, org, alertName);
    const detailResp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts/${alertId}`);
    expect(detailResp.ok()).toBeTruthy();
    const alertDetail = await detailResp.json();
    alertDetail.trigger_condition = {
      ...alertDetail.trigger_condition,
      threshold: 5,
      warning_threshold: 1,
    };
    const putResp = await page.request.put(`${baseUrl}/api/v2/${org}/alerts/${alertId}`, { data: alertDetail });
    expect(putResp.ok(), 'PUT with warning_threshold should succeed').toBeTruthy();

    // Verify the config round-tripped — the alert has both thresholds set.
    const roundtripResp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts/${alertId}`);
    expect(roundtripResp.ok()).toBeTruthy();
    const roundtrip = await roundtripResp.json();
    expect(roundtrip.trigger_condition.threshold, 'critical threshold persisted').toBe(5);
    expect(roundtrip.trigger_condition.warning_threshold, 'warning threshold persisted (this is what makes it multi-severity)').toBe(1);

    // Fire and assert Slack payload has an image block.
    await pm.alertsPage.triggerAlertManually(alertName);
    await expect.poll(() => received.slack.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const slackPayload = JSON.parse(received.slack[0].body);
    const walk = (obj, out = []) => {
      if (obj && typeof obj === 'object') {
        if (obj.type === 'image' && (obj.image_url || obj.slack_file)) out.push(obj);
        for (const v of Array.isArray(obj) ? obj : Object.values(obj)) walk(v, out);
      }
      return out;
    };
    const imageBlocks = walk(slackPayload);
    expect(imageBlocks.length, 'Slack payload should contain at least one image block (the chart)').toBeGreaterThan(0);

    // ===== CLEANUP =====
    await pm.alertsPage.deleteImportedAlert(alertName).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  test('T2: Aggregation avg(value) alert substitutes decimal alert_agg_value in Slack body', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `alert_chart_agg_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_agg_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_agg_slack_${sharedRandomValue}`;

    const spec = {
      title: 'aggregation avg',
      body: 'avg value: {alert_agg_value}',
      title_overrides: {}, fields: [], links: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      chart: { enabled: true },
    };
    const tplResp = await page.request.post(`${baseUrl}/api/${org}/alerts/templates`, {
      data: { name: templateName, ...buildContentTemplate(spec) },
    });
    expect(tplResp.ok()).toBeTruthy();

    await createDestination(page, baseUrl, org, slackDestName, '/slack', 'slack', templateName);

    // Stream + ingest data with varying numeric values so aggregation has substance.
    await pm.commonActions.initializeAlertTestStream(streamName);
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push({
        _timestamp: now - (30 - i) * 10 * 1000,
        city: 'bangalore',
        value: [25, 45, 60, 75, 88, 92, 95, 98][i % 8],
      });
    }
    const ingestResp = await page.request.post(`${baseUrl}/api/${org}/${streamName}/_json`, { data: rows });
    expect(ingestResp.ok(), 'ingest of varying-value rows should succeed').toBeTruthy();

    await page.goto(`${baseUrl}/web/alerts?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    const alertName = await pm.alertsPage.createAlert(streamName, 'city', 'bangalore', slackDestName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);

    // Patch alert to be an aggregation: avg(value) >= 50.
    const alertId = await findAlertIdByName(page, baseUrl, org, alertName);
    const detailResp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts/${alertId}`);
    expect(detailResp.ok()).toBeTruthy();
    const alertDetail = await detailResp.json();
    alertDetail.query_condition = {
      ...alertDetail.query_condition,
      aggregation: { group_by: null, function: 'avg', having: { column: 'value', operator: '>=', value: 50 } },
    };
    const putResp = await page.request.put(`${baseUrl}/api/v2/${org}/alerts/${alertId}`, { data: alertDetail });
    expect(putResp.ok()).toBeTruthy();

    await pm.alertsPage.triggerAlertManually(alertName);
    await expect.poll(() => received.slack.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const slackPayload = JSON.parse(received.slack[0].body);
    const asString = JSON.stringify(slackPayload);
    // Aggregate value should be a decimal (avg of ints), not a bare integer or empty.
    expect(asString, 'body should contain a decimal aggregate value from {alert_agg_value} substitution').toMatch(/\b\d+\.\d+\b/);

    await pm.alertsPage.deleteImportedAlert(alertName).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  test('T3: Template with rows.enabled=true produces Slack payload containing row values', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `alert_chart_rows_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_rows_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_rows_slack_${sharedRandomValue}`;
    const sentinelValue = `rows_sentinel_${sharedRandomValue}`;

    const spec = {
      title: 'rows enabled',
      body: 'sample rows follow',
      title_overrides: {}, fields: [], links: [],
      rows: { enabled: true, max: 3, columns: null, format: null },
      chart: { enabled: false },
    };
    const tplResp = await page.request.post(`${baseUrl}/api/${org}/alerts/templates`, {
      data: { name: templateName, ...buildContentTemplate(spec) },
    });
    expect(tplResp.ok()).toBeTruthy();

    await createDestination(page, baseUrl, org, slackDestName, '/slack', 'slack', templateName);
    await pm.commonActions.initializeAlertTestStream(streamName);

    // Ingest rows with a sentinel value so we can grep for it in the payload.
    // Note: use timestamps well in the past (2 minutes) so the alert's query
    // window sees settled/indexed data on first fire — freshly-ingested rows
    // may not be queryable for a few seconds in CI.
    const now = Date.now();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      _timestamp: (now - 120000) - (5 - i) * 10 * 1000,
      city: 'bangalore',
      log: sentinelValue,
    }));
    const ingestResp = await page.request.post(`${baseUrl}/api/${org}/${streamName}/_json`, { data: rows });
    expect(ingestResp.ok()).toBeTruthy();

    // Wait until the ingested rows are queryable via search — otherwise the
    // alert fires with 0 matches and the rows section is empty.
    await expect.poll(async () => {
      const searchResp = await page.request.post(`${baseUrl}/api/${org}/_search?type=logs`, {
        data: {
          query: {
            sql: `SELECT COUNT(*) as c FROM "${streamName}" WHERE city = 'bangalore'`,
            start_time: (now - 15 * 60 * 1000) * 1000,
            end_time: now * 1000,
          },
        },
      });
      if (!searchResp.ok()) return 0;
      const body = await searchResp.text();
      if (!body) return 0;
      try {
        const j = JSON.parse(body);
        const hits = j.hits || [];
        return hits[0]?.c || 0;
      } catch { return 0; }
    }, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    await page.goto(`${baseUrl}/web/alerts?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    const alertName = await pm.alertsPage.createAlert(streamName, 'city', 'bangalore', slackDestName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    await pm.alertsPage.triggerAlertManually(alertName);

    await expect.poll(() => received.slack.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);
    const slackPayload = received.slack[0].body;
    // Rows section is populated with actual ingested log values; the sentinel must appear.
    expect(slackPayload, 'Slack payload should include the sentinel value from ingested rows').toContain(sentinelValue);

    await pm.alertsPage.deleteImportedAlert(alertName).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  test('T4: Chart delivery — webhook envelope has non-null chart_url; email destination accepts test_send', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `alert_chart_multichan_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_multichan_tpl_${sharedRandomValue}`;
    const hookDestName = `chart_visual_multichan_hook_${sharedRandomValue}`;
    const emailDestName = `chart_visual_multichan_email_${sharedRandomValue}`;

    const spec = {
      title: 'multi channel chart delivery',
      body: 'fired',
      title_overrides: {}, fields: [], links: [],
      rows: { enabled: false, max: 5, columns: null, format: null },
      chart: { enabled: true },
    };
    const tplResp = await page.request.post(`${baseUrl}/api/${org}/alerts/templates`, {
      data: { name: templateName, ...buildContentTemplate(spec) },
    });
    expect(tplResp.ok()).toBeTruthy();

    // Webhook destination — the payload contract we assert against.
    await createDestination(page, baseUrl, org, hookDestName, '/hook', 'custom', templateName);

    // Email destination — recipient must be an existing org member. Pull the
    // current authenticated user's email so this works on any test env.
    const meResp = await page.request.get(`${baseUrl}/api/${org}/users`);
    const users = await meResp.json();
    const usersArr = Array.isArray(users) ? users : (users.data || users.list || []);
    const currentUserEmail = process.env['ZO_ROOT_USER_EMAIL'] || usersArr[0]?.email;
    expect(currentUserEmail, 'must resolve a recipient email that belongs to the org').toBeTruthy();

    const emailDestResp = await page.request.post(`${baseUrl}/api/${org}/alerts/destinations`, {
      data: { name: emailDestName, type: 'email', emails: [currentUserEmail], template: templateName },
    });
    expect(emailDestResp.ok(), 'email destination should save').toBeTruthy();

    await pm.commonActions.initializeAlertTestStream(streamName);
    await page.goto(`${baseUrl}/web/alerts?org_identifier=${org}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    const alertName = await pm.alertsPage.createAlert(streamName, 'city', 'bangalore', hookDestName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);

    // Bind email destination alongside the webhook one.
    const alertId = await findAlertIdByName(page, baseUrl, org, alertName);
    const detailResp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts/${alertId}`);
    expect(detailResp.ok()).toBeTruthy();
    const alertDetail = await detailResp.json();
    alertDetail.destinations = Array.from(new Set([...(alertDetail.destinations || []), emailDestName]));
    const putResp = await page.request.put(`${baseUrl}/api/v2/${org}/alerts/${alertId}`, { data: alertDetail });
    expect(putResp.ok()).toBeTruthy();

    await pm.alertsPage.triggerAlertManually(alertName);

    // Assert webhook envelope: chart_url must be set (proves chart was built).
    // Note: this requires ZO_ALERT_CHART_ENABLED=true on the server; if the
    // env has charts disabled the assertion will fail with a clear message
    // rather than silently pass.
    await expect.poll(() => received.hook.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);
    const hookPayload = JSON.parse(received.hook[0].body);
    expect(hookPayload).toHaveProperty('chart_url');
    expect(hookPayload.chart_url, 'chart_url must be non-null when template.chart.enabled=true AND ZO_ALERT_CHART_ENABLED=true').toBeTruthy();
    expect(hookPayload.chart_url).toMatch(/\/alerts\/charts\/render\?d=[^&]+&s=[^&]+/);

    // Email CID inline is untestable from Playwright without an SMTP mock —
    // manual verification is the source of truth for that path (see
    // tests/ui-testing/test-artifacts/chart-templates/TEST-REFERENCE.md).
    // Here we assert only that the email destination accepts a test_send;
    // if the fire above included the email destination in the trigger, the
    // triggers stream would show its status, but we can't inspect message
    // bytes without SMTP infra.
    const emailTestSendResp = await page.request.post(
      `${baseUrl}/api/${org}/alerts/destinations/${emailDestName}/test_send`,
      { data: { template_name: templateName } }
    );
    expect(emailTestSendResp.ok(), 'email test_send should succeed (CID payload validity untestable without SMTP mock)').toBeTruthy();

    await pm.alertsPage.deleteImportedAlert(alertName).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${hookDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${emailDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });
});
