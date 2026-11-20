// The Kubernetes explorer reads events whose body.object is one JSON column, as a flatten level below 3 stores it (#16200, fixed by #16300).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { streamFieldNames } = require('../../utils/traces-api.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { k8sEventRow, ingestK8sEvents } = require('../../utils/k8s-events-seed.js');

// k8s_events is a fixed stream name, so an own org keeps other specs' events and schema out of it.
const K8S_ORG = 'e2e16300k8s';

test.describe('Kubernetes explorer below flatten level 3 (#16200)', () => {
  test('the Events view lists an event stored as one body_object JSON column', {
    tag: ['@bug-16200', '@P1', '@regression', '@infraRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pm = new PageManager(page);
    const id = generateHexId(6);
    const note = `Back-off restarting failed container e2e-16300-${id}`;
    // body_object arrives as a string, so every flatten level stores the level-2 schema the fix resolves: no body_object_* leaves.
    await ingestK8sEvents(page.request, K8S_ORG, [k8sEventRow({ id, note })]);
    const fields = await streamFieldNames(page.request, 'k8s_events', { type: 'logs', org: K8S_ORG });
    expect(fields, 'Precondition: the stream must hold body_object as one column').toContain('body_object');
    expect(fields, 'Precondition: the stream must have no level-3 leaves').not.toContain('body_object_kind');

    // An events-only org lands on the Events view by itself.
    await pm.kubernetesPage.open({ org: K8S_ORG });
    await pm.kubernetesPage.expectView('events');
    await pm.kubernetesPage.expectEventsTableContains(note);
    testLogger.testEnd(testInfo.title, 'passed');
  });
});
