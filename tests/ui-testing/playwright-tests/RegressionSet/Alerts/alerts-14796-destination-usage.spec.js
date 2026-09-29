// Copyright 2026 OpenObserve Inc.

/**
 * Alerts Regression — destination delete guard across consumers (#14796)
 *
 * Before #14796 the delete guard consulted three consumers (the ALERTS cache,
 * pipelines, enterprise workflows). Six other stores reference a destination by
 * NAME and were never asked, so a destination a composite alert or a synthetic
 * check depended on deleted cleanly and its owner stopped being paged. The list
 * made that easy to do: "Used by" counted alerts only, so such a destination
 * read Unused, and the screen that says "safe to delete" is what causes it.
 *
 * `Alerts/alerts-destinations-usage.spec.js` covers the alert consumer. This file
 * covers the parts of the fix that spec does not:
 *   - a COMPOSITE-alert-only destination is counted and blocks its own delete
 *     (composites live in `alert_composites`, outside the `alerts` table, which is
 *     exactly why the old cache-walking guard could not see them);
 *   - a destination held by two different KINDS is refused once, naming both —
 *     the old guard returned on its first match, so a destination used by several
 *     things was removed one complaint at a time;
 *   - a genuinely unused destination still deletes, so proving nine tables clean
 *     never turns into over-blocking.
 *
 * Not covered here, deliberately: the synthetic-check consumer, the arm that
 * produced the original report. Synthetics is off in CI (neither workflow sets
 * `ZO_SYNTHETICS_ENABLED`) and its locations have no env-based seeding, so a check
 * cannot be created. Enabling it is a workflow change, not a spec change.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const PageManager = require('../../../pages/page-manager.js');
const testLogger = require('../../utils/test-logger.js');
const {
  uniq, urls, api, DEST, simpleAlert, compositeAlert,
  createAlert, findAlertId, deleteAlertInFolder, seedAlertFixtures,
} = require('../../utils/alerts-api-helpers.js');

test.describe('Alert destination delete guard across consumers testcases', {
  tag: ['@alerts', '@alert-destination-usage'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  // Alert ids in creation order; torn down newest-first so a composite goes before
  // the child it names.
  let createdAlerts = [];
  let createdDestinations = [];
  let createdTemplates = [];
  let createdPipelines = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    createdAlerts = [];
    createdDestinations = [];
    createdTemplates = [];
    createdPipelines = [];
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    const { v1 } = urls();
    // Consumers first — while one still names a destination, the guard under test
    // refuses that destination's delete and the fixture would leak.
    for (const id of [...createdAlerts].reverse()) {
      await deleteAlertInFolder(page, id, 'default');
    }
    for (const id of createdPipelines) {
      await api(page, 'delete', `${v1}/pipelines/${id}`).catch(() => {});
    }
    for (const name of createdDestinations) {
      await api(page, 'delete', `${v1}/alerts/destinations/${name}`).catch(() => {});
    }
    for (const name of createdTemplates) {
      await api(page, 'delete', `${v1}/alerts/templates/${name}`).catch(() => {});
    }
  });

  /** A template + destination owned by this test alone, so its counts are unambiguous. */
  async function seedDestination(page, prefix) {
    const { v1 } = urls();
    const templateName = uniq(`${prefix}_tmpl`);
    const destinationName = uniq(`${prefix}_dest`);
    const tplRes = await api(page, 'post', `${v1}/alerts/templates`, {
      name: templateName, body: '{"text":"{alert_name}"}', type: 'http', title: '',
    });
    expect(tplRes.status(), await tplRes.text()).toBe(200);
    createdTemplates.push(templateName);
    // Unroutable on purpose: these alerts are never meant to fire, and a real
    // host would turn a notification attempt into flaky wall-clock.
    const destRes = await api(page, 'post', `${v1}/alerts/destinations`, {
      name: destinationName, url: 'http://127.0.0.1:1/never-called',
      method: 'post', template: templateName, type: 'http',
    });
    expect(destRes.status(), await destRes.text()).toBe(200);
    createdDestinations.push(destinationName);
    return destinationName;
  }

  async function createSimpleAlertOn(page, destinationName, prefix) {
    const name = uniq(prefix);
    const res = await createAlert(page, { ...simpleAlert(name), destinations: [destinationName] });
    expect(res.status(), await res.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id, 'seeded alert must exist').toBeTruthy();
    createdAlerts.push(id);
    return { id, name };
  }

  // `childIds` is a list because the server rejects a composite with fewer than
  // two children ("composite needs at least 2 children").
  async function createCompositeAlertOn(page, destinationName, childIds, prefix) {
    const name = uniq(prefix);
    const res = await createAlert(
      page,
      compositeAlert(name, childIds, { destinations: [destinationName] }),
    );
    expect(res.status(), await res.text()).toBe(200);
    const id = await findAlertId(page, name);
    expect(id, 'seeded composite must exist').toBeTruthy();
    createdAlerts.push(id);
    return { id, name };
  }

  /**
   * A pipeline-module destination (`?module=pipeline`) plus a realtime pipeline whose
   * `remote_stream` node names it. Pipeline destinations carry no template and never
   * appear on the alert destinations list, so this is the only way to reach that arm.
   */
  async function seedPipelineOnDestination(page, prefix) {
    const { v1, org } = urls();
    const destinationName = uniq(`${prefix}_dest`);
    const destRes = await api(page, 'post', `${v1}/alerts/destinations?module=pipeline`, {
      name: destinationName, url: 'http://127.0.0.1:1/never-called', method: 'post', type: 'http',
    });
    expect(destRes.status(), await destRes.text()).toBe(200);
    createdDestinations.push(destinationName);

    const pipelineName = uniq(`${prefix}_pipeline`);
    const stream = 'alerts_p0_stream';
    const pipeRes = await api(page, 'post', `${v1}/pipelines`, {
      name: pipelineName, description: '', org, enabled: true,
      source: { source_type: 'realtime', org_id: org, stream_name: stream, stream_type: 'logs' },
      nodes: [
        {
          id: 'n1', type: 'input', io_type: 'input', position: { x: 0, y: 0 },
          data: { node_type: 'stream', org_id: org, stream_name: stream, stream_type: 'logs' },
        },
        {
          id: 'n2', type: 'output', io_type: 'output', position: { x: 200, y: 200 },
          data: { node_type: 'remote_stream', org_id: org, destination_name: destinationName },
        },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    });
    expect(pipeRes.status(), await pipeRes.text()).toBe(200);
    createdPipelines.push((await pipeRes.json()).id);
    return { destinationName, pipelineName };
  }

  async function openDestinationsScopedTo(name) {
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.searchDestinations(name);
  }

  test('should count a composite-alert-only destination and refuse its delete', {
    tag: ['@alert-destination-composite-consumer', '@all', '@alerts', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding a destination referenced only by a composite alert');
    const destinationName = await seedDestination(page, 'e2e_14796_comp');
    // Both children keep the shared fixture destination (DEST), so the seeded
    // destination is reachable through the composite and through nothing else.
    const childA = await createSimpleAlertOn(page, DEST, 'e2e_14796_child_a');
    const childB = await createSimpleAlertOn(page, DEST, 'e2e_14796_child_b');
    const composite = await createCompositeAlertOn(
      page, destinationName, [childA.id, childB.id], 'e2e_14796_composite',
    );

    await openDestinationsScopedTo(destinationName);

    testLogger.info('Asserting the composite_alert badge and the absence of the Unused chip');
    await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, 'composite_alert', 1);
    await pm.alertDestinationsPage.expectUnusedChipAbsent(destinationName);

    testLogger.info('Asserting the delete is refused and names the composite');
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining([
      'composite alert', composite.name,
    ]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });

  test('should name every blocking kind in one refusal, not just the first', {
    tag: ['@alert-destination-multi-consumer', '@all', '@alerts', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding one destination held by both a simple and a composite alert');
    const destinationName = await seedDestination(page, 'e2e_14796_multi');
    const plain = await createSimpleAlertOn(page, destinationName, 'e2e_14796_multi_alert');
    // The second child stays on the shared fixture destination so the seeded one
    // is held by exactly one alert and one composite — the counts under test.
    const filler = await createSimpleAlertOn(page, DEST, 'e2e_14796_multi_filler');
    const composite = await createCompositeAlertOn(
      page, destinationName, [plain.id, filler.id], 'e2e_14796_multi_composite',
    );

    await openDestinationsScopedTo(destinationName);

    testLogger.info('Both kinds must carry their own badge');
    await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, 'alert', 1);
    await pm.alertDestinationsPage.expectUsedByBadgeCount(destinationName, 'composite_alert', 1);

    testLogger.info('One refusal must name both kinds and both alerts');
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining([
      plain.name, 'composite alert', composite.name,
    ]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });

  test('should refuse deleting a pipeline destination a pipeline still routes to', {
    tag: ['@alert-destination-pipeline-consumer', '@all', '@alerts', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding a pipeline destination and a pipeline that routes to it');
    const { destinationName, pipelineName } = await seedPipelineOnDestination(page, 'e2e_14796_pipe');

    // Pipeline destinations live on their own Settings tab, not the alerts list.
    await pm.pipelinesPage.openPipelineDestinationsAt(destinationName);

    testLogger.info('Asserting the delete is refused and names the pipeline');
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectInUseErrorToastContaining(['pipeline', pipelineName]);
    await pm.alertDestinationsPage.expectDestinationRowStillVisible(destinationName);
    testLogger.info('Test completed');
  });

  test('should still delete a destination no consumer references', {
    tag: ['@alert-destination-unused-delete', '@all', '@alerts', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding a destination nothing references');
    const destinationName = await seedDestination(page, 'e2e_14796_free');

    await openDestinationsScopedTo(destinationName);

    testLogger.info('Asserting the Unused chip, then a delete that actually succeeds');
    await pm.alertDestinationsPage.expectUnusedChipVisible(destinationName);
    await pm.alertDestinationsPage.attemptDeleteDestination(destinationName);
    await pm.alertDestinationsPage.expectDestinationNotInList(destinationName);
    // Already gone — afterEach must not delete it again and log a spurious 404.
    createdDestinations = createdDestinations.filter((n) => n !== destinationName);
    testLogger.info('Test completed');
  });
});
