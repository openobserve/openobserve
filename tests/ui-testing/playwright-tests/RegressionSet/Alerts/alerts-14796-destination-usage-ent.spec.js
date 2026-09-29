// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — enterprise consumers of the destination delete guard (#14796)
 *
 * ENTERPRISE ONLY. This file is deliberately absent from OSS `ci_matrix_regression.json`
 * and is switched on by `append` in the enterprise `ci_matrix_regression.ent.json`,
 * the same way `incidents-status-filter.spec.js` is. Three of the guard's nine
 * consumers are `#[cfg(feature = "enterprise")]` and simply do not exist in an OSS
 * build, so an OSS run would fail on fixture creation rather than skip.
 *
 * `alerts-14796-destination-usage.spec.js` covers the OSS consumers. This covers the
 * enterprise ones, each of which was an unguarded store before #14796:
 *   - anomaly detection  (`anomaly_detection_config.alert_destinations`)
 *   - incident integrations (`incident_integrations.destinations`)
 *   - workflows (a `destination` node's `destination_id`)
 *
 * Two surfaces, not one. Anomaly and incident integrations reference ALERT-module
 * destinations, so they appear on the alerts destinations list and carry a per-kind
 * "Used by" badge. A workflow references a PIPELINE-module destination — the alerts
 * list never shows it (`destinationsQuery(org, "alert")`), so only the refusal is
 * assertable there, from the Settings -> Pipeline Destinations tab.
 *
 * Requires `O2_WORKFLOWS_ENABLED` and `O2_INCIDENTS_ENABLED` on the server under test.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const { uniq, urls, api, seedAlertFixtures } = require('../../utils/alerts-api-helpers.js');

test.describe('Enterprise consumers of the destination delete guard testcases', {
  tag: ['@alerts', '@alert-destination-usage', '@enterprise'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let createdTemplates = [];
  let createdDestinations = [];
  // Each entry is a { url } the afterEach DELETEs before the destinations it holds.
  let createdConsumers = [];
  // Streams ingested as anomaly-detection fixtures; deleted in afterEach.
  let createdStreams = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    createdTemplates = [];
    createdDestinations = [];
    createdConsumers = [];
    createdStreams = [];
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    const { v1 } = urls();
    // Consumers first: while one still names a destination, the guard under test
    // refuses that destination's delete and the fixture would leak.
    for (const url of [...createdConsumers].reverse()) {
      await api(page, 'delete', url).catch(() => {});
    }
    for (const name of createdDestinations) {
      await api(page, 'delete', `${v1}/alerts/destinations/${name}`).catch(() => {});
    }
    for (const name of createdTemplates) {
      await api(page, 'delete', `${v1}/alerts/templates/${name}`).catch(() => {});
    }
    for (const name of createdStreams) {
      await pm.apiCleanup.deleteStream(name, 'logs').catch(() => {});
    }
  });

  /**
   * A destination owned by this test alone. `module` picks the surface: "alert"
   * destinations carry a template and show on the alerts list; "pipeline" ones carry
   * none and are what a workflow node can point at.
   */
  async function seedDestination(page, prefix, module = 'alert') {
    const { v1 } = urls();
    const destinationName = uniq(`${prefix}_dest`);
    const body = {
      name: destinationName, url: 'http://127.0.0.1:1/never-called',
      method: 'post', type: 'http',
    };
    if (module === 'alert') {
      const templateName = uniq(`${prefix}_tmpl`);
      const tplRes = await api(page, 'post', `${v1}/alerts/templates`, {
        name: templateName, body: '{"text":"{alert_name}"}', type: 'http', title: '',
      });
      expect(tplRes.status(), await tplRes.text()).toBe(200);
      createdTemplates.push(templateName);
      body.template = templateName;
    }
    const query = module === 'pipeline' ? '?module=pipeline' : '';
    const res = await api(page, 'post', `${v1}/alerts/destinations${query}`, body);
    expect(res.status(), await res.text()).toBe(200);
    createdDestinations.push(destinationName);
    return destinationName;
  }

  async function openDestinationsScopedTo(name) {
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.searchDestinations(name);
  }

  test('should count an anomaly detection config and refuse its destination delete', {
    tag: ['@alert-destination-anomaly-consumer', '@enterprise', '@alerts', '@P0'],
  }, async ({ page }) => {
    const { v1 } = urls();
    testLogger.info('Seeding a destination referenced only by an anomaly detection config');
    const destinationName = await seedDestination(page, 'e2e_14796_anom');
    const stream = uniq('e2e_14796_anom_stream');
    createdStreams.push(stream);
    await api(page, 'post', `${v1}/${stream}/_json`, [{ level: 'error', latency: 10 }]);

    const configName = uniq('e2e_14796_anom_cfg');
    const res = await api(page, 'post', `${v1}/anomaly_detection`, {
      name: configName, description: '', stream_name: stream, stream_type: 'logs',
      query_mode: 'filters', filters: [], detection_function: 'count',
      histogram_interval: '1h', schedule_interval: '1h',
      // Server floor: schedule_interval + histogram_interval. 1h + 1h = 7200s.
      detection_window_seconds: 7200,
      alert_enabled: true, alert_destinations: [destinationName], enabled: true,
    });
    expect(res.status(), await res.text()).toBe(200);
    createdConsumers.push(`${v1}/anomaly_detection/${(await res.json()).anomaly_id}`);

    await openDestinationsScopedTo(destinationName);

    testLogger.info('Asserting the anomaly_detection badge and the refusal');
    await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, 'anomaly_detection', 1);
    await pm.alertDestinationsPage.expectUnusedChipAbsent(destinationName);
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining([
      'anomaly detection config', configName,
    ]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });

  test('should count an incident integration and refuse its destination delete', {
    tag: ['@alert-destination-incident-consumer', '@enterprise', '@alerts', '@P0'],
  }, async ({ page }) => {
    const { v2 } = urls();
    testLogger.info('Seeding a destination referenced only by an incident integration');
    const destinationName = await seedDestination(page, 'e2e_14796_inc');

    const integrationName = uniq('e2e_14796_inc_src');
    const res = await api(page, 'post', `${v2}/incidents/integrations`, {
      // Closed set: auto | grafana | alertmanager | generic.
      name: integrationName, source_type: 'generic', enabled: true,
      config: {}, destinations: [destinationName],
    });
    expect(res.status(), await res.text()).toBe(200);
    createdConsumers.push(`${v2}/incidents/integrations/${(await res.json()).id}`);

    await openDestinationsScopedTo(destinationName);

    testLogger.info('Asserting the incident_integration badge and the refusal');
    await pm.alertDestinationsPage.expectUsedByBadgeCount(
      destinationName, 'incident_integration', 1,
    );
    await pm.alertDestinationsPage.expectUnusedChipAbsent(destinationName);
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining([
      'incident integration', integrationName,
    ]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });

  test('should refuse deleting a destination a workflow still delivers to', {
    tag: ['@alert-destination-workflow-consumer', '@enterprise', '@alerts', '@P0'],
  }, async ({ page }) => {
    const { v1, org } = urls();
    testLogger.info('Seeding a pipeline-module destination and a workflow that delivers to it');
    // A workflow destination node rejects an alert-module destination outright:
    // "destination <name> is not a workflow compatible destination".
    const destinationName = await seedDestination(page, 'e2e_14796_wf', 'pipeline');

    const workflowName = uniq('e2e_14796_wf');
    const res = await api(page, 'post', `${v1}/workflows`, {
      trigger_type: 'alert',
      workflow: {
        id: '', org_id: org, folder_id: '', created_at: 0, updated_at: 0,
        created_by: 'root@example.com', enabled: true,
        name: workflowName, description: '',
        nodes: [
          {
            id: 'n1', type: 'input', io_type: 'input', position: { x: 0, y: 0 },
            data: { node_type: 'workflow_trigger' },
          },
          {
            id: 'n2', type: 'output', io_type: 'output', position: { x: 200, y: 100 },
            data: {
              node_type: 'destination',
              destination_id: destinationName,
              template_override: null,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    createdConsumers.push(`${v1}/workflows/${(await res.json()).id}`);

    // Pipeline-module destinations are not on the alerts list, so there is no
    // "Used by" cell to assert here — only the refusal.
    await pm.pipelinesPage.openPipelineDestinationsAt(destinationName);

    testLogger.info('Asserting the delete is refused and names the workflow');
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining(['workflow', workflowName]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });
});
