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
 * Approach: API-only creation of template + destination + alert with the FULL
 * desired shape from the start (no UI wizard, no GET-then-PUT round-trip).
 * This eliminates payload-shape drift between wizard defaults and the fields
 * the v2 alert PUT/POST endpoint accepts.
 *
 * Receiver: an in-test HTTP server captures raw POST bodies on /slack and
 * /hook paths — same pattern as alerts-content-templates.spec.js.
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

  // ==========================================================================
  // Helpers — API-only creation. All shapes verified against the code path
  // in src/api/management/src/models/destinations.rs and the manual test suite
  // in tests/ui-testing/test-artifacts/chart-templates/TEST-REFERENCE.md.
  // ==========================================================================

  const buildContentTemplate = (contentSpec) => ({
    kind: 'content',
    type: 'http',
    title: '',
    body: JSON.stringify(contentSpec),
    isDefault: null,
    isPrebuilt: false,
  });

  // Destination create: FLAT fields at the top level. Confirmed against
  // src/api/management/src/models/destinations.rs Destination::into
  // (uses self.url, self.method, self.destination_type_name directly).
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

  const createEmailDestination = async (page, baseUrl, org, name, email, templateName) => {
    const resp = await page.request.post(`${baseUrl}/api/${org}/alerts/destinations`, {
      data: { name, type: 'email', emails: [email], template: templateName },
    });
    if (!resp.ok()) {
      throw new Error(`Failed to create email destination ${name}: ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
    return resp;
  };

  // Alert create via POST /api/v2/{org}/alerts — takes the full alert shape
  // so no GET-then-PUT round-trip is needed. Returns the alert_id.
  const createAlertAPI = async (page, baseUrl, org, alertPayload) => {
    const resp = await page.request.post(`${baseUrl}/api/v2/${org}/alerts`, { data: alertPayload });
    if (!resp.ok()) {
      throw new Error(`Failed to create alert ${alertPayload.name}: ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
    const body = await resp.json();
    return body.id || body.alert_id;
  };

  const triggerAlert = async (page, baseUrl, org, alertId) => {
    const resp = await page.request.patch(`${baseUrl}/api/v2/${org}/alerts/${alertId}/trigger`);
    if (!resp.ok()) {
      throw new Error(`Failed to trigger alert ${alertId}: ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
  };

  // Build a count-based alert config (no aggregation). Ready to POST to
  // /api/v2/{org}/alerts. Caller can override trigger_condition fields.
  const buildCountAlert = (org, name, streamName, destinations, triggerOverrides = {}) => ({
    org_id: org,
    stream_type: 'logs',
    stream_name: streamName,
    is_real_time: false,
    destinations,
    context_attributes: {},
    row_template: '',
    description: name,
    enabled: true,
    name,
    query_condition: {
      type: 'custom',
      conditions: {
        version: 2,
        conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
      },
      sql: null, promql: null, promql_condition: null, aggregation: null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 15, operator: '>=', threshold: 1,
      frequency: 1, cron: '', frequency_type: 'minutes',
      silence: 1, timezone: 'UTC', align_time: true,
      ...triggerOverrides,
    },
  });

  const ingest = async (page, baseUrl, org, streamName, rows) => {
    const resp = await page.request.post(`${baseUrl}/api/${org}/${streamName}/_json`, { data: rows });
    if (!resp.ok()) {
      throw new Error(`Ingest failed: ${resp.status()} ${await resp.text().catch(() => '')}`);
    }
  };

  // Poll _search until at least `min` rows are queryable — CI ingest lag guard.
  const waitForRowsQueryable = async (page, baseUrl, org, streamName, min = 1) => {
    const now = Date.now();
    await expect.poll(async () => {
      const searchResp = await page.request.post(`${baseUrl}/api/${org}/_search?type=logs`, {
        data: {
          query: {
            sql: `SELECT COUNT(*) as c FROM "${streamName}"`,
            start_time: (now - 30 * 60 * 1000) * 1000,
            end_time: now * 1000,
          },
        },
      });
      if (!searchResp.ok()) return 0;
      const text = await searchResp.text();
      if (!text) return 0;
      try {
        const j = JSON.parse(text);
        return j.hits?.[0]?.c || 0;
      } catch { return 0; }
    }, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThanOrEqual(min);
  };

  // Wait for the SCHEDULER to have evaluated this alert ≥minRows times, so
  // the triggers stream has actual_value rows queryable by fetch_series
  // ([chart/mod.rs:130-201]). Manual triggers do NOT publish to the triggers
  // stream — only the scheduler does — so build_chart_asset's series.len()
  // >= 2 gate is only satisfiable after the scheduler has run at least once
  // (giving 1 history row + the appended current-fire value = 2). This
  // mirrors fetch_series's exact SQL so it's deterministic, not timing-based.
  const waitForTriggerHistory = async (page, baseUrl, org, alertId, minRows = 1) => {
    await expect.poll(async () => {
      const resp = await page.request.post(`${baseUrl}/api/${org}/_search?type=logs`, {
        data: {
          query: {
            sql: `SELECT COUNT(*) as c FROM "triggers" WHERE module = 'alert' AND key LIKE '%${alertId}' AND actual_value IS NOT NULL`,
            start_time: (Date.now() - 300000) * 1000,
            end_time: Date.now() * 1000,
            from: 0, size: 1,
          },
        },
      });
      if (!resp.ok()) return 0;
      try {
        const j = await resp.json();
        return j.hits?.[0]?.c || 0;
      } catch { return 0; }
    }, { timeout: 90000, intervals: [3000, 5000, 5000, 10000] }).toBeGreaterThanOrEqual(minRows);
  };

  // ==========================================================================
  // T1: Multi-severity alert emits Slack image block + carries warning_threshold
  // ==========================================================================

  test('T1: Multi-severity alert emits Slack image block AND alert config carries warning_threshold', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `chart_visual_multi_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_multi_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_multi_slack_${sharedRandomValue}`;
    const alertName = `chart_visual_multi_alert_${sharedRandomValue}`;

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

    // Ingest ≥5 rows so the count-based multi-severity alert (crit=5, warn=1)
    // trips the critical threshold on manual trigger.
    const now = Date.now();
    const rows = Array.from({ length: 10 }, (_, i) => ({
      _timestamp: (now - 120000) - (10 - i) * 10 * 1000,
      marker: 'chart_visual_multi',
    }));
    await ingest(page, baseUrl, org, streamName, rows);
    await waitForRowsQueryable(page, baseUrl, org, streamName, 10);

    // Create the alert with multi-severity thresholds set from the start.
    const alertId = await createAlertAPI(page, baseUrl, org, buildCountAlert(
      org, alertName, streamName, [slackDestName],
      { threshold: 5, warning_threshold: 1 }
    ));

    // Verify the multi-severity config persisted.
    const roundtripResp = await page.request.get(`${baseUrl}/api/v2/${org}/alerts/${alertId}`);
    expect(roundtripResp.ok()).toBeTruthy();
    const roundtrip = await roundtripResp.json();
    expect(roundtrip.trigger_condition.threshold, 'critical threshold persisted').toBe(5);
    expect(roundtrip.trigger_condition.warning_threshold, 'warning threshold persisted (this is what makes it multi-severity)').toBe(1);

    // Wait for the scheduler to have written ≥1 evaluation to the triggers
    // stream — manual trigger alone cannot produce a chart (see helper doc).
    await waitForTriggerHistory(page, baseUrl, org, alertId, 1);

    // Now the manual trigger fire has enough history for build_chart_asset
    // to satisfy series.len() >= 2 and render the chart.
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
    await page.request.delete(`${baseUrl}/api/v2/${org}/alerts/${alertId}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  // ==========================================================================
  // T2: Aggregation avg(value) alert substitutes decimal alert_agg_value
  // ==========================================================================

  test('T2: Aggregation avg(value) alert substitutes decimal alert_agg_value in Slack body', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `chart_visual_agg_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_agg_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_agg_slack_${sharedRandomValue}`;
    const alertName = `chart_visual_agg_alert_${sharedRandomValue}`;

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

    // Ingest rows with varying numeric values so the avg is a decimal.
    // Backdate 2 min so the query window has settled data on first fire.
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 30; i++) {
      rows.push({
        _timestamp: (now - 120000) - (30 - i) * 10 * 1000,
        value: [25, 45, 60, 75, 88, 92, 95, 98][i % 8],
      });
    }
    await ingest(page, baseUrl, org, streamName, rows);
    await waitForRowsQueryable(page, baseUrl, org, streamName, 30);

    // Alert with aggregation baked in from the start.
    const alert = buildCountAlert(org, alertName, streamName, [slackDestName]);
    alert.query_condition.aggregation = {
      group_by: null, function: 'avg',
      having: { column: 'value', operator: '>=', value: 50 },
    };
    const alertId = await createAlertAPI(page, baseUrl, org, alert);

    await pm.alertsPage.triggerAlertManually(alertName);
    await expect.poll(() => received.slack.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const asString = received.slack[0].body;
    // Aggregate avg of integers → decimal (e.g. 71.75). Assert body has a decimal number.
    expect(asString, 'body should contain a decimal aggregate value from {alert_agg_value} substitution').toMatch(/\b\d+\.\d+\b/);

    await page.request.delete(`${baseUrl}/api/v2/${org}/alerts/${alertId}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  // ==========================================================================
  // T3: Template with rows.enabled=true produces Slack payload with row values
  // ==========================================================================

  test('T3: Template with rows.enabled=true produces Slack payload containing row values', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `chart_visual_rows_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_rows_tpl_${sharedRandomValue}`;
    const slackDestName = `chart_visual_rows_slack_${sharedRandomValue}`;
    const alertName = `chart_visual_rows_alert_${sharedRandomValue}`;
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

    // Ingest sentinel rows, backdated to settle before the alert's window.
    const now = Date.now();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      _timestamp: (now - 120000) - (5 - i) * 10 * 1000,
      log: sentinelValue,
    }));
    await ingest(page, baseUrl, org, streamName, rows);
    await waitForRowsQueryable(page, baseUrl, org, streamName, 5);

    // Alert with the same shape as T2 minus aggregation — just fires on any
    // row in the window.
    const alertId = await createAlertAPI(page, baseUrl, org,
      buildCountAlert(org, alertName, streamName, [slackDestName])
    );

    await pm.alertsPage.triggerAlertManually(alertName);
    await expect.poll(() => received.slack.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const slackPayload = received.slack[0].body;
    expect(slackPayload, 'Slack payload should include the sentinel value from ingested rows').toContain(sentinelValue);

    await page.request.delete(`${baseUrl}/api/v2/${org}/alerts/${alertId}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${slackDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });

  // ==========================================================================
  // T4: Webhook envelope has non-null chart_url; email destination accepts test_send
  // ==========================================================================

  test('T4: Chart delivery — webhook envelope has non-null chart_url; email destination accepts test_send', {
    tag: ['@contentTemplates', '@chartVisual', '@P0', '@all'],
    timeout: EXTENDED_TIMEOUT_MS,
  }, async ({ page }) => {
    const baseUrl = process.env['ZO_BASE_URL'];
    const org = process.env['ORGNAME'] || getOrgIdentifier();
    const streamName = `chart_visual_mchan_${sharedRandomValue}`.toLowerCase();
    const templateName = `chart_visual_mchan_tpl_${sharedRandomValue}`;
    const hookDestName = `chart_visual_mchan_hook_${sharedRandomValue}`;
    const emailDestName = `chart_visual_mchan_email_${sharedRandomValue}`;
    const alertName = `chart_visual_mchan_alert_${sharedRandomValue}`;

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

    // Webhook (custom) destination → we assert its envelope shape.
    await createDestination(page, baseUrl, org, hookDestName, '/hook', 'custom', templateName);

    // Ingest at least one row so the alert has something to match on first fire.
    const now = Date.now();
    await ingest(page, baseUrl, org, streamName, [
      { _timestamp: now - 120000, marker: 'chart_visual_t4' },
    ]);
    await waitForRowsQueryable(page, baseUrl, org, streamName, 1);

    // Email destination — recipient must be an org member. Use the same
    // ZO_ROOT_USER_EMAIL that global-setup logs in with.
    const currentUserEmail = process.env['ZO_ROOT_USER_EMAIL'];
    expect(currentUserEmail, 'ZO_ROOT_USER_EMAIL must be set in the CI env').toBeTruthy();
    await createEmailDestination(page, baseUrl, org, emailDestName, currentUserEmail, templateName);

    const alertId = await createAlertAPI(page, baseUrl, org,
      buildCountAlert(org, alertName, streamName, [hookDestName, emailDestName])
    );

    // Webhook envelope assertion — chart_url is included when
    // template.chart.enabled=true AND ZO_ALERT_CHART_ENABLED=true (defaults to true
    // per src/config/src/config.rs:2060) AND the alert eval returned at least one row
    // AND the triggers stream has ≥1 prior evaluation (needed for series.len() >= 2
    // in build_chart_asset). Wait for the scheduler to seed the history before firing.
    await waitForTriggerHistory(page, baseUrl, org, alertId, 1);
    await pm.alertsPage.triggerAlertManually(alertName);
    await expect.poll(() => received.hook.length, { timeout: 60000, intervals: [1000, 2000, 3000] }).toBeGreaterThan(0);

    const hookPayload = JSON.parse(received.hook[0].body);
    expect(hookPayload).toHaveProperty('chart_url');
    expect(hookPayload.chart_url, 'chart_url must be non-null when template.chart.enabled=true AND ZO_ALERT_CHART_ENABLED=true AND alert has matching rows').toBeTruthy();
    expect(hookPayload.chart_url).toMatch(/\/alerts\/charts\/render\?d=[^&]+&s=[^&]+/);

    // Fetch the chart URL and verify the render endpoint actually produces a
    // valid PNG. This proves the full pipeline end-to-end: URL signing +
    // signature verification + payload inflate + plotters rendering.
    const chartResp = await page.request.get(hookPayload.chart_url);
    expect(chartResp.ok(), 'chart render endpoint should return 200 for a freshly-signed URL').toBeTruthy();
    expect(chartResp.headers()['content-type'], 'chart response must be image/png').toBe('image/png');
    const bytes = await chartResp.body();
    expect(bytes.length, 'PNG must be non-trivial (>1KB) — rules out empty or error PNGs').toBeGreaterThan(1024);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A (\x89 + "PNG" + CR LF SUB LF).
    expect(bytes[0], 'first byte must be 0x89 (PNG magic)').toBe(0x89);
    expect(bytes.slice(1, 4).toString('ascii'), 'bytes 1-3 must be "PNG"').toBe('PNG');

    // Email CID inline is untestable from Playwright without an SMTP mock —
    // manual verification is the source of truth for CID rendering. Here we
    // only assert the email destination accepts a test_send call. Gate on
    // ZO_SMTP_ENABLED — CI often runs with SMTP off (see test env), in which
    // case test_send will always non-2xx and the assertion is meaningless.
    // TODO: promote to a real mock-SMTP assertion (MailHog / smtp-server)
    // when we're ready to spend the CI-infra cost.
    const emailTestSendResp = await page.request.post(
      `${baseUrl}/api/${org}/alerts/destinations/${emailDestName}/test_send`,
      { data: { template_name: templateName } }
    );
    const smtpEnabled = (process.env['ZO_SMTP_ENABLED'] || '').toLowerCase() === 'true';
    if (smtpEnabled) {
      expect(emailTestSendResp.ok(), 'email test_send should succeed when SMTP is enabled').toBeTruthy();
    } else {
      testLogger.warn('ZO_SMTP_ENABLED is not "true" — skipping email test_send success assertion (endpoint was hit but delivery is unverifiable without SMTP)');
    }

    await page.request.delete(`${baseUrl}/api/v2/${org}/alerts/${alertId}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${hookDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/destinations/${emailDestName}`).catch(() => {});
    await page.request.delete(`${baseUrl}/api/${org}/alerts/templates/${encodeURIComponent(templateName)}`).catch(() => {});
  });
});
