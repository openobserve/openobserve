const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

/**
 * Alerts Stream Switching Regression Tests
 *
 * Covers 6 regression bugs related to the alert canvas/graph UI breaking
 * when switching between stream types (logs <-> metrics) and query modes
 * (Builder <-> SQL <-> PromQL).
 *
 *    #11580 - Metrics+PromQL -> Logs, PromQL editor persists
 *    #11572 - Logs -> Metrics -> Logs, chart error "No field named value"
 *    #11571 - Builder -> SQL, chart blank table instead of line
 *    #11573 - Full editor open/close blanks the graph
 *    #11578 - Agg functions don't filter to integer fields
 *    #11577 - Preview chart y-axis shows raw numbers instead of formatted
 *
 * NOTE: v3 UI uses a flat tab layout - there is NO Continue button.
 * After selecting stream+type, the query config section appears automatically.
 * For SQL/PromQL modes, click "View Editor" to open the editor dialog.
 */
test.describe("Alerts Stream Switching Regression", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const TEST_LOG_STREAM = 'e2e_automate';
  const METRICS_STREAM = 'e2e_test_cpu_usage';
  const DESTINATION_NAME = 'e2e_stream_sw_dest';
  const TEMPLATE_NAME = 'e2e_stream_sw_template';
  const ORG_ID = getOrgIdentifier() || 'default';

  // ============================================================================
  // beforeAll - Ingest metrics data + create template/destination for save flows
  // ============================================================================
  test.beforeAll(async ({ browser }) => {
    testLogger.info('Setting up prerequisites for stream switching regression tests');
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    try {
      const baseUrl = process.env.ZO_BASE_URL || 'http://localhost:5080';
      await page.goto(`${baseUrl}?org_identifier=${ORG_ID}`);
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      await ingestMetricsData(page, ORG_ID);

      // Create template + destination via API for alert save flows
      const org = ORG_ID;
      const authToken = Buffer.from(`${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`).toString('base64');

      const templatePayload = {
        name: TEMPLATE_NAME,
        body: JSON.stringify({ text: "Alert: {alert_name}" }),
        isDefault: false
      };

      const templateResponse = await page.evaluate(async ({ baseUrl, org, authToken, templatePayload }) => {
        const response = await fetch(`${baseUrl}/api/${org}/alerts/templates`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(templatePayload)
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      }, { baseUrl, org, authToken, templatePayload });

      if (templateResponse.status === 200 || templateResponse.status === 409) {
        testLogger.info('Template ready via API', { templateName: TEMPLATE_NAME, status: templateResponse.status });
      } else {
        testLogger.warn('Template creation response', { status: templateResponse.status, data: templateResponse.data });
      }

      const destinationPayload = {
        name: DESTINATION_NAME,
        url: "https://httpbin.org/post",
        method: "post",
        skip_tls_verify: false,
        template: TEMPLATE_NAME,
        headers: {}
      };

      const destResponse = await page.evaluate(async ({ baseUrl, org, authToken, destinationPayload }) => {
        const response = await fetch(`${baseUrl}/api/${org}/alerts/destinations`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(destinationPayload)
        });
        return { status: response.status, data: await response.json().catch(() => ({})) };
      }, { baseUrl, org, authToken, destinationPayload });

      if (destResponse.status === 200 || destResponse.status === 409) {
        testLogger.info('Destination ready via API', { destinationName: DESTINATION_NAME, status: destResponse.status });
      } else {
        testLogger.warn('Destination creation response', { status: destResponse.status, data: destResponse.data });
      }

      testLogger.info('Prerequisites setup completed');
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  });

  // ============================================================================
  // Helper: Switch stream type + stream, waiting for dropdown repopulation.
  // Clicks the stream option in a single dropdown session — no Escape+reopen
  // that could race with async option-set repopulation.
  // ============================================================================
  async function switchStreamAndReconfirm(streamType, streamName) {
    await pm.alertsPage.switchStreamAndReconfirm(streamType, streamName);
  }

  // ============================================================================
  // Helper: Setup wizard to query config step (v3 flat layout, no Continue btn)
  // ============================================================================
  async function setupToQueryConfig(streamType, streamName) {
    await pm.alertsPage.clickAddAlertButton();
    await pm.alertsPage.fillAlertName(`auto_sw_${Date.now()}`);
    await switchStreamAndReconfirm(streamType, streamName);
    testLogger.info('Wizard setup complete - query config visible (v3 flat layout)');
  }

  // ============================================================================
  // Bug #11580: Metrics+PromQL -> switch to Logs, query editor still shows PromQL
  // https://github.com/openobserve/openobserve/issues/11580
  // ============================================================================
  test("Bug #11580: Stream type switch from Metrics/PromQL to Logs resets query editor", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11580', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11580: Verify PromQL editor clears when switching from metrics to logs');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Start with metrics - PromQL tab must be visible
    await setupToQueryConfig('metrics', METRICS_STREAM);

    // Assert PromQL is available on the metrics stream — missing PromQL on a
    // metrics stream is a real regression and should fail, not skip silently.
    await pm.alertsPage.expectPromqlTabVisible();
    await pm.alertsPage.clickPromqlTab();
    testLogger.info('PromQL tab selected on metrics stream');

    // Switch to logs: change stream type + stream directly (v3 flat layout keeps dropdowns visible)
    await switchStreamAndReconfirm('logs', TEST_LOG_STREAM);

    // Verify PromQL is gone for logs
    await pm.alertsPage.expectPromqlTabNotVisible();
    // Also verify the editor doesn't retain PromQL content from the metrics phase
    await pm.alertsPage.expectEditorContentDoesNotContain('rate(');
    testLogger.info('PromQL tab NOT visible for logs stream and editor is clean (fix confirmed)');
    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11580 test passed');
  });

  // ============================================================================
  // Bug #11572: Logs -> Metrics -> Logs shows chart error
  // https://github.com/openobserve/openobserve/issues/11572
  // ============================================================================
  test("Bug #11572: Logs -> Metrics -> Logs switch does not show chart error", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11572', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11572: Verify no chart error when switching logs <-> metrics <-> logs');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Phase 1: Logs - chart OK
    await setupToQueryConfig('logs', TEST_LOG_STREAM);
    await page.waitForTimeout(2000);
    testLogger.info('Logs stream: setup complete');

    // Phase 2: Switch to metrics directly (v3 flat layout keeps dropdowns visible)
    await switchStreamAndReconfirm('metrics', METRICS_STREAM);
    await pm.alertsPage.clickPromqlTab();
    testLogger.info('Metrics stream: PromQL selected');

    // Phase 3: Switch BACK to logs directly - verify NO chart error
    await switchStreamAndReconfirm('logs', TEST_LOG_STREAM);

    await pm.alertsPage.expectPreviewChartVisible();
    await pm.alertsPage.expectNoChartError();

    const chartError = await pm.alertsPage.getChartErrorMessage();
    expect(chartError, `Bug #11572: Chart should not show schema error, got: "${chartError}"`).toBeNull();
    testLogger.info('Back to logs: no chart error (fix confirmed)');
    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11572 test passed');
  });

  // ============================================================================
  // Bug #11571: Builder -> SQL mode switch shows blank table instead of chart
  // https://github.com/openobserve/openobserve/issues/11571
  // ============================================================================
  test("Bug #11571: Builder to SQL mode switch renders chart correctly", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11571', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11571: Verify chart renders when switching from Builder to SQL');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig('logs', TEST_LOG_STREAM);

    // Switch to SQL tab and open the query editor dialog
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickOpenFullEditor();

    // Type SQL query into the editor and run it
    await pm.alertsPage.typeInQueryEditor(`SELECT histogram(_timestamp, interval '1 minute') as zo_sql_ts, COUNT(*) as zo_sql_value FROM "${TEST_LOG_STREAM}" GROUP BY zo_sql_ts ORDER BY zo_sql_ts`);
    await pm.alertsPage.clickRunQueryButton();

    // Close editor dialog (scoped to dialog to avoid ambiguity with wizard back button)
    await pm.alertsPage.closeEditorDialog();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // PRIMARY: Chart is not blank after SQL mode (Bug #11571: "blank table instead of line")
    await pm.alertsPage.expectPreviewChartNotBlank();

    // SECONDARY: No "preview not available" message
    const notAvailableMsg = pm.alertsPage.getPreviewNotAvailableMessage();
    const msgVisible = await notAvailableMsg.isVisible({ timeout: 3000 }).catch(() => false);
    expect(msgVisible).toBe(false);

    // TERTIARY: No chart error
    await pm.alertsPage.expectNoChartError();
    testLogger.info('SQL mode: chart renders with canvas (fix confirmed)');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11571 test passed');
  });

  // ============================================================================
  // Bug #11573: Full editor open/close blanks the graph
  // https://github.com/openobserve/openobserve/issues/11573
  //
  // In v3, the "View Editor" button opens the query editor dialog.
  // The bug: closing the editor blanks the preview chart.
  // This test opens the editor, runs a query, closes, and verifies chart survives.
  // ============================================================================
  test("Bug #11573: Full editor open/close preserves graph", {
    tag: ['@alerts', '@regressionBugs', '@P1', '@bug-11573', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11573: Verify chart re-renders after editor open/close');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig('logs', TEST_LOG_STREAM);

    // Switch to SQL mode, open editor, type query, run
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.clickOpenFullEditor();
    await pm.alertsPage.typeInQueryEditor(`SELECT histogram(_timestamp, interval '1 minute') as zo_sql_ts, COUNT(*) as zo_sql_value FROM "${TEST_LOG_STREAM}" GROUP BY zo_sql_ts ORDER BY zo_sql_ts`);
    await pm.alertsPage.clickRunQueryButton();

    // PRIMARY: Close the editor dialog and verify chart survives (the core of Bug #11573)
    await pm.alertsPage.closeEditorDialog();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Bug #11573: editor close was blanking the graph — assert canvas exists, not just container
    await pm.alertsPage.expectPreviewChartNotBlank();
    testLogger.info('Chart preserved (canvas intact) after editor close (fix confirmed)');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11573 test passed');
  });

  // ============================================================================
  // Bug #11578: Agg functions (avg/sum) show all fields instead of only integers
  // https://github.com/openobserve/openobserve/issues/11578
  // ============================================================================
  test("Bug #11578: Agg functions filter to integer fields only", {
    tag: ['@alerts', '@regressionBugs', '@P2', '@bug-11578', '@stream-switching']
  }, async ({ page }) => {
    testLogger.info('Bug #11578: Verify aggregation functions filter field types');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;
    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await setupToQueryConfig('logs', TEST_LOG_STREAM);

    // Bug #11578 is about the aggregation field dropdown. After selecting an
    // aggregation function (avg/sum), the field dropdown next to it must only
    // show numeric fields (a proper subset of all fields).

    // Capture the full field list with count (baseline)
    await pm.alertsPage.selectAggregationFunction('count');
    const allFields = await pm.alertsPage.getAvailableFields();
    expect(allFields.length, 'Baseline field list should not be empty').toBeGreaterThan(0);

    // avg: identify numeric vs non-numeric fields from the stream's actual data
    await pm.alertsPage.selectAggregationFunction('avg');
    const avgFields = await pm.alertsPage.expectOnlyNumericFieldsVisible(allFields);
    const numericFields = avgFields; // fields kept by avg = numeric
    const stringFields = allFields.filter(f => !avgFields.includes(f)); // fields dropped = string

    // sum: verify same filtering, plus cross-check with known types
    await pm.alertsPage.selectAggregationFunction('sum');
    const sumFields = await pm.alertsPage.expectOnlyNumericFieldsVisible(allFields, {
        knownNumeric: numericFields,
        knownString: stringFields,
    });
    expect(avgFields.sort(), 'avg and sum should filter to the same numeric-only field set').toEqual(sumFields.sort());

    // count: all fields available (no filtering)
    await pm.alertsPage.selectAggregationFunction('count');
    await pm.alertsPage.expectAllFieldsVisible(allFields);
    testLogger.info('Bug #11578: aggregation field filtering verified');

    await pm.alertsPage.clickBackButton();
    testLogger.info('Bug #11578 test passed');
  });

  // ============================================================================
  // Bug #11577: Preview alert y-axis should show numeric values (e.g. "10K")
  // https://github.com/openobserve/openobserve/issues/11577
  // The fix sets config.unit = "numbers" in PreviewAlert.vue, enabling SI-prefix
  // axis label formatting. We validate the fix by:
  //   1. Walking the Vue component tree to verify config.unit = "numbers"
  //   2. Verifying the chart renders (not blank, no errors)
  //   3. Performing a full save/verify/delete flow
  // ============================================================================
  test("Bug #11577: Alert preview chart y-axis displays numeric values", {
    tag: ['@bug-11577', '@P1', '@regression', '@alertsRegression', '@alertsRegressionAlertPreview']
  }, async ({ page }) => {
    testLogger.info('Bug #11577: Verify preview chart y-axis shows numeric values');
    const alertsUrl = `${logData.alertUrl}?org_identifier=${ORG_ID}`;

    // Ingest fresh log data so the preview chart has data to render
    await ingestTestData(page);
    testLogger.info('Fresh log data ingested for preview chart');

    await page.goto(alertsUrl);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Use the standard setup helper to create an alert with logs stream
    await setupToQueryConfig('logs', TEST_LOG_STREAM);
    await page.waitForTimeout(3000);

    // The chart should appear automatically with data — validate it rendered
    await pm.alertsPage.expectPreviewChartNotBlank();
    await pm.alertsPage.expectNoChartError();

    const chartError = await pm.alertsPage.getChartErrorMessage();
    expect(chartError,
      `Bug #11577: Chart should render without error, got: "${chartError}"`
    ).toBeNull();

    testLogger.info('Bug #11577: Preview chart renders with data and no errors');

    // === VERIFY config.unit = "numbers" ===
    // The fix (PreviewAlert.vue:240) sets config.unit = "numbers" which tells the
    // y-axis formatter (axisBuilder.ts buildYAxis) to use SI-prefix labels like
    // "10K" instead of "10000". We walk the Vue 3 component tree to read this
    // config directly from the PanelSchemaRenderer's panelSchema prop.
    const unitConfig = await page.evaluate(() => {
      try {
        const appEl = document.getElementById('app');
        const vueApp = appEl?.__vue_app__;
        if (!vueApp) return { error: 'Vue app not found' };
        // In Vue 3.5+ production builds, app._instance is null but
        // container._vnode.component holds the root component instance.
        const rootInstance = vueApp._instance || vueApp._container?._vnode?.component;
        if (!rootInstance) return { error: 'Root instance not found' };

        // Recursively walk the VNode tree to find a component by predicate
        function findComponent(root, predicate) {
          const queue = [root];
          const seen = new Set();
          while (queue.length) {
            const inst = queue.shift();
            if (!inst || seen.has(inst)) continue;
            seen.add(inst);
            if (predicate(inst)) return inst;
            const subTree = inst.subTree;
            if (!subTree) continue;
            const walk = (vnode) => {
              if (!vnode) return;
              if (vnode.component) queue.push(vnode.component);
              if (vnode.children && Array.isArray(vnode.children))
                vnode.children.forEach(walk);
              if (vnode.dynamicChildren)
                vnode.dynamicChildren.forEach(walk);
            };
            walk(subTree);
          }
          return null;
        }

        const renderer = findComponent(rootInstance, (comp) => {
          const name = comp.type?.name || comp.type?.__name || '';
          if (name === 'PanelSchemaRenderer') return true;
          // Fallback: match by prop shape (works even if name is minified).
          // PreviewAlert passes chartData = dashboardPanelData.data, so
          // config is at the root level (not nested under .data).
          if (comp.props && 'panelSchema' in comp.props &&
              comp.props.panelSchema?.config) return true;
          return false;
        });

        if (!renderer) return { error: 'PanelSchemaRenderer not found' };
        const schema = renderer.props?.panelSchema;
        // chartData = cloneDeep(dashboardPanelData.data), so config is at
        // the root level, not nested under .data (PreviewAlert.vue:555-556).
        if (!schema?.config) return { error: 'panelSchema config not found' };
        return {
          unit: schema.config.unit,
          unit_custom: schema.config.unit_custom,
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });

    expect(unitConfig.error,
      `Bug #11577: Vue tree walk should find panelSchema config (${unitConfig.error})`
    ).toBeUndefined();
    expect(unitConfig.unit,
      'Bug #11577: config.unit must be "numbers" (SI-prefix y-axis formatting)'
    ).toBe('numbers');
    testLogger.info(`Bug #11577: config.unit = "${unitConfig.unit}" (fix confirmed via Vue component tree)`);

    // === SAVE + VERIFY: Full alert creation flow ===

    // Capture the alert name that setupToQueryConfig filled
    const alertNameInput = page.locator(pm.alertsPage.alertNameInput);
    const alertName = await alertNameInput.inputValue();
    testLogger.info(`Saving alert: ${alertName}`);

    // Select destination using POM locator
    const destDropdown = page.locator(pm.alertsPage.alertDestinationsSelect);
    await destDropdown.waitFor({ state: 'visible', timeout: 10000 });
    await destDropdown.click();
    await page.waitForTimeout(1000);

    const destMenu = page.locator('.q-menu:visible');
    await expect(destMenu.locator('.q-item').first()).toBeVisible({ timeout: 5000 });
    const firstDest = destMenu.locator('.q-item').first();
    await firstDest.click();
    testLogger.info(`Selected destination`);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');

    // Remove interfering q-portal elements
    await page.evaluate(() => {
      document.querySelectorAll('div[id^="q-portal"]').forEach(el => {
        if (el.getAttribute('aria-hidden') === 'true') el.style.display = 'none';
      });
    }).catch(e => testLogger.warn('Failed to remove q-portal elements', { error: e.message }));
    await page.waitForTimeout(300);

    // Submit — button is clipped in scroll container, use evaluate() same as createScheduledAlertWithSQL
    await page.locator(pm.alertsPage.alertSubmitButton).waitFor({ state: 'attached', timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector(`[data-test="add-alert-submit-btn"]`);
      if (btn) btn.click();
    });
    testLogger.info('Clicked Save button via evaluate()');
    await expect(page.getByText('Alert saved successfully.')).toBeVisible({ timeout: 30000 });
    testLogger.info('Alert saved successfully');

    // Verify the alert appears in the list
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Bug #11577: Alert saved and verified in list (full save flow confirmed)');

    // Cleanup: delete the created alert
    await pm.alertsPage.searchAndDeleteAlert(alertName);
    testLogger.info('Bug #11577: Cleaned up test alert');
  });

  test.afterEach(async () => {
    testLogger.info('Stream switching regression test completed');
  });
});

// ============================================================================
// Helper: Ingest metrics data
// ============================================================================
async function ingestMetricsData(page, orgId) {
  const streamName = 'e2e_test_cpu_usage';
  const baseUrl = process.env.INGESTION_URL || process.env.ZO_BASE_URL || 'http://localhost:5080';
  const ingestionUrl = `${baseUrl}/api/${orgId}/ingest/metrics/_json`;

  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const nowMicros = Date.now() * 1000;
  const metricsData = [];
  for (let i = 0; i < 10; i++) {
    metricsData.push({
      "__name__": streamName,
      "__type__": "gauge",
      "host_name": `server-${i % 3 + 1}`,
      "env": "test",
      "region": ["us-east-1", "us-west-2", "eu-west-1"][i % 3],
      "_timestamp": nowMicros - (i * 60 * 1_000_000),
      "value": 20 + Math.random() * 60
    });
  }

  try {
    const response = await page.evaluate(async ({ url, authToken, data }) => {
      const fetchResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      return {
        status: fetchResponse.status,
        data: await fetchResponse.json().catch(() => ({}))
      };
    }, { url: ingestionUrl, authToken: basicAuthCredentials, data: metricsData });
    testLogger.info('Metrics data ingested', { response, streamName });
  } catch (e) {
    testLogger.warn('Metrics ingestion may have failed', { error: e.message });
  }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}
