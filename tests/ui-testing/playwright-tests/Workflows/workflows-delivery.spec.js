/**
 * Workflows v1 — destination DELIVERY (DEL-01..02)
 *
 * Everything else in the suite proves the workflow was BUILT. These prove data
 * actually reached the destination.
 *
 * How it works — the "self-ingest sink". The destination POST is made server-side
 * (which is why NEG-06's 127.0.0.1:1 yields connection-refused), so pointing a
 * destination at OpenObserve's OWN ingest endpoint makes the app deliver into a
 * stream we control. Two facts make that assertable without polling:
 *
 *   1. batch_execution.rs applies `endpoint.headers` to every outbound request, so
 *      an Authorization header lets the workflow post into an authenticated endpoint.
 *   2. On a 2xx it calls send_output(body) — the destination node's OUTPUT *is* the
 *      sink's response. For an ingest sink that response is OpenObserve's own
 *      receipt, e.g. {"code":200,"status":[{"name":"...","successful":1,"failed":0}]}.
 *
 * So `successful: 1` is delivery confirmed by the receiving side, synchronously.
 *
 * Self-cleaning: `wf_auto_*` names and `wf_auto_sink_*` streams are both already
 * swept by cleanup.spec.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

const orgId = () => process.env.ORGNAME || 'default';
const sinkStream = (id) => `wf_auto_sink_${id}`;
const sinkUrl = (id) => `${process.env.ZO_BASE_URL}/api/${orgId()}/${sinkStream(id)}/_json`;
// Ingest requires auth; the destination forwards whatever headers it carries.
const basicAuth = () =>
  'Basic ' +
  Buffer.from(
    `${process.env.ZO_ROOT_USER_EMAIL}:${process.env.ZO_ROOT_USER_PASSWORD}`
  ).toString('base64');

test.describe.configure({ mode: 'parallel' });

test.describe(
  'Workflows destination delivery',
  { tag: ['@workflows', '@workflowsDelivery', '@enterprise', '@all'] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      await pm.workflowsPage.assertEnabled();
    });

    // DEL-01 — a reachable destination paints the SUCCESS badge. This is the missing
    // twin of NEG-06, which only ever asserted the error badge: without it, a change
    // that made every send fail would still satisfy the negative test.
    test('DEL-01: a live destination reports a successful send', async () => {
      const id = uniq();
      const name = `wf_auto_del_${id}`;
      await pm.workflowsPage.buildTriggerToDestinationAndSave({
        name,
        destName: `wf_auto_dest_${id}`,
        url: sinkUrl(id),
        headers: { Authorization: basicAuth() },
      });
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(name);
      await pm.workflowsPage.testRunFromEditor({ liveSend: true });
      await pm.workflowsPage.expectNodeTestPassed('destination');
      await pm.workflowsPage.expectNodeTestPassed('workflow_trigger');
      testLogger.info('destination reported a successful send', { name });
    });

    // DEL-02 — the payload actually landed. The destination node's output is the
    // sink's response body, so for an ingest sink it is OpenObserve's own receipt.
    test('DEL-02: the delivered payload is ingested by the sink', async () => {
      const id = uniq();
      const name = `wf_auto_del_${id}`;
      await pm.workflowsPage.buildTriggerToDestinationAndSave({
        name,
        destName: `wf_auto_dest_${id}`,
        url: sinkUrl(id),
        headers: { Authorization: basicAuth() },
      });
      await pm.workflowsPage.goToList();
      await pm.workflowsPage.openEdit(name);
      await pm.workflowsPage.testRunFromEditor({ liveSend: true });
      await pm.workflowsPage.expectNodeTestPassed('destination');

      // The receiving side confirms it stored the record. Verified live:
      // {"code":200,"status":[{"name":"wf_auto_sink_...","successful":1,"failed":0}]}
      const receipt = await pm.workflowsPage.destinationIngestReceipt();
      testLogger.info('destination node output (ingest receipt)', { receipt });
      const status = (receipt.status || [])[0] || {};
      expect(status.name).toBe(sinkStream(id));
      expect(status.successful).toBeGreaterThan(0);
      expect(status.failed).toBe(0);
    });
  }
);
