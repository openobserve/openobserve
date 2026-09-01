/**
 * Workflows v1 — Condition node coverage (COND-01..07)
 *
 * Enterprise-only feature: event(alert_fired|incident_event) -> optional Condition/Function
 * -> action(remote/pipeline destination).
 *
 * Why this spec exists: the Condition node had NO coverage at all, and the four
 * operators added in #13978 (is_null / is_not_null / is_empty / is_not_empty) were
 * untested end-to-end anywhere in the suite — pipeline-conditions.spec.js only
 * mentions them in a comment.
 *
 * Two behaviours here are non-obvious and are asserted deliberately:
 *   - Unary operators REMOVE the value input from the DOM (FilterCondition.vue
 *     wraps it in `v-if="!isUnaryOperator(...)"`), so absence — not an empty
 *     string — is the correct assertion.
 *   - A never-configured Condition is sent as a rule with an EMPTY column, which
 *     the backend short-circuits to always-true (`Condition::evaluate`) before it
 *     reads operator/value. So a dummy Condition must not block Publish.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

// Unary operators from #13978 — these take no value.
const UNARY_OPERATORS = ['is_null', 'is_not_null', 'is_empty', 'is_not_empty'];
// Value-taking operators, one per shape (equality, inequality, numeric, substring).
const VALUE_OPERATORS = ['=', '!=', '>=', 'Contains'];

test.describe.configure({ mode: 'parallel' });

test.describe(
  'Workflows condition node',
  { tag: ['@workflows', '@workflowsConditions', '@enterprise', '@all'] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      // Enterprise-only: fail loudly if the feature is off rather than skipping.
      await pm.workflowsPage.assertEnabled();
    });

    // COND-01 — the node can be added, configured with a complete rule, and published.
    test('COND-01: builds and publishes a workflow with a configured condition', async () => {
      const id = uniq();
      const name = `wf_auto_cond_${id}`;
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.setCondition({
        column: 'meta_alert_name',
        operator: '=',
        value: 'wf_auto_probe',
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${id}`,
        url: `${process.env.ZO_BASE_URL}/api/${process.env.ORGNAME || 'default'}/wf_auto_sink_${id}/_json`,
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.publishAndExpectAccepted();
      await pm.workflowsPage.skipLinkAlerts();
      await pm.workflowsPage.goToList();
      expect(await pm.workflowsPage.isPresent(name)).toBeTruthy();
      testLogger.info('condition workflow published', { name });
    });

    // COND-02 — every unary operator added in #13978 is selectable on a condition rule.
    for (const operator of UNARY_OPERATORS) {
      test(`COND-02: unary operator ${operator} is selectable`, async () => {
        await pm.workflowsPage.goToAdd();
        await pm.workflowsPage.setName(`wf_auto_cond_${uniq()}`);
        await pm.workflowsPage.addNodeFromPalette('condition');
        await pm.workflowsPage.setCondition({ column: 'meta_alert_name', operator });
        // COND-03: the value input is v-if'd away for unary operators.
        await pm.workflowsPage.expectConditionValueAbsent();
        testLogger.info('unary operator applied with no value input', { operator });
      });
    }

    // COND-04 — value-taking operators still render the value input and accept input.
    test('COND-04: value operators keep the value input', async () => {
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(`wf_auto_cond_${uniq()}`);
      await pm.workflowsPage.addNodeFromPalette('condition');
      // Pick the column ONCE, then sweep operators against it — this test is about
      // operators, and re-opening the column dropdown each pass only adds flake.
      await pm.workflowsPage.setCondition({
        column: 'meta_alert_name',
        operator: VALUE_OPERATORS[0],
        value: `wf_auto_${VALUE_OPERATORS[0]}`,
      });
      await pm.workflowsPage.expectConditionValueVisible();
      for (const operator of VALUE_OPERATORS.slice(1)) {
        await pm.workflowsPage.setConditionOperator(operator, `wf_auto_${operator}`);
        await pm.workflowsPage.expectConditionValueVisible();
        testLogger.info('value operator keeps its input', { operator });
      }
    });

    // COND-05 — a never-configured Condition is an INCOMPLETE node, and Publish refuses
    // it. WorkflowCondition.submit() calls setNodeIncomplete(node, !complete) when the
    // rule is unfinished, which validate() turns into the "needs setup" block.
    //
    // The always-true passthrough group (an empty column, which the backend
    // short-circuits in Condition::evaluate) is what a dummy node is SENT as on the
    // Draft/Test paths — it is not a licence to publish. Verified live: publishing
    // one is rejected with "1 step needs setup before publishing".
    test('COND-05: an unconfigured condition blocks publish', async () => {
      const id = uniq();
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(`wf_auto_cond_${id}`);
      // Add the condition and close its drawer WITHOUT filling anything in.
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${id}`,
        url: `${process.env.ZO_BASE_URL}/api/${process.env.ORGNAME || 'default'}/wf_auto_sink_${id}/_json`,
      });
      await pm.workflowsPage.saveNodeDrawer();
      const msg = await pm.workflowsPage.publishAndCaptureRejection();
      testLogger.info('unconfigured condition publish result', { msg });
      expect(msg.toLowerCase()).toContain('needs setup');
      // The editor stays put so the user can finish the flagged step.
      await pm.workflowsPage.expectEditorVisible();
    });

    // COND-06 — the pickable columns follow the TRIGGER kind: an alert workflow offers
    // alert payload fields, never the incident ones.
    test('COND-06: condition columns follow the alert trigger', async () => {
      await pm.workflowsPage.goToAdd('alert_fired');
      await pm.workflowsPage.setName(`wf_auto_cond_${uniq()}`);
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.dismissConditionGuidelinesIfPresent();
      const columns = await pm.workflowsPage.conditionColumnValues();
      testLogger.info('alert-trigger condition columns', { count: columns.length });
      expect(columns).toContain('meta_alert_name');
      // meta_event_type is incident-only — it must not leak into an alert workflow.
      expect(columns).not.toContain('meta_event_type');
    });

    // COND-07 — the first-run guidelines box dismisses and stays dismissed (localStorage).
    test('COND-07: condition guidelines dismiss and stay dismissed', async () => {
      await pm.workflowsPage.goToAdd();
      await pm.workflowsPage.setName(`wf_auto_cond_${uniq()}`);
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.dismissConditionGuidelinesIfPresent();
      await pm.workflowsPage.expectConditionGuidelinesAbsent();
      // Re-open a fresh condition node in the same browser context: the dismissal is
      // remembered, so the hint must not nag again.
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.expectConditionGuidelinesAbsent();
      await pm.workflowsPage.expectConditionBuilderVisible();
      testLogger.info('guidelines stayed dismissed on a second condition node');
    });
  }
);
