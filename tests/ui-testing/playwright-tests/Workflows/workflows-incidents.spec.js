/**
 * Workflows v1 — Incident Event trigger coverage (INC-01..06)
 *
 * Enterprise-only. The `incident_event` trigger kind shipped in #13472 and has had
 * no UI coverage: every existing spec builds an `alert_fired` workflow.
 *
 * What makes this kind different (plugins/workflows/triggers.ts):
 *   - It defines `sampleVariants`, one per incident lifecycle event_type, so the
 *     trigger drawer renders a variant picker rather than a single payload.
 *   - It defines `commonMetaKeys`, so the payload is SPLIT into a stable common
 *     block plus an event-specific block. An event_type whose `extras` are {} —
 *     `created` — shows a "no extra fields" note instead of the specific block.
 *   - It does NOT set `linksAlerts`, so the post-save link-alerts prompt must be
 *     skipped entirely. Alert workflows must still show it. Asserting both halves
 *     is what actually proves the flag is honoured.
 *   - Its Condition columns are the incident payload fields, not the alert ones.
 *
 * Self-cleaning: every artifact is namespaced `wf_auto_*`; cleanup.spec.js sweeps by prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const uniq = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

// The incident lifecycle, in registry order (plugins/workflows/incidentSample.ts).
// All 14 — the three ai_analysis_* phases are separate event types.
const INCIDENT_EVENT_TYPES = [
  'created',
  'alert',
  'severity_upgrade',
  'severity_override',
  'acknowledged',
  'resolved',
  'reopened',
  'dimension_upgraded',
  'title_changed',
  'assignment_changed',
  'comment',
  'ai_analysis_begin',
  'ai_analysis_complete',
  'ai_analysis_failed',
];

const sinkUrl = (id) =>
  `${process.env.ZO_BASE_URL}/api/${process.env.ORGNAME || 'default'}/wf_auto_sink_${id}/_json`;

test.describe.configure({ mode: 'parallel' });

test.describe(
  'Workflows incident trigger',
  { tag: ['@workflows', '@workflowsIncidents', '@enterprise', '@all'] },
  () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
      testLogger.testStart(testInfo.title, testInfo.file);
      await navigateToBase(page);
      pm = new PageManager(page);
      // Enterprise-only: fail loudly if the feature is off rather than skipping.
      await pm.workflowsPage.assertEnabled();
    });

    // INC-01 — an incident-triggered workflow builds, publishes and lands in the list.
    test('INC-01: builds and publishes an incident-triggered workflow', async () => {
      const id = uniq();
      const name = `wf_auto_inc_${id}`;
      await pm.workflowsPage.goToAdd('incident_event');
      await pm.workflowsPage.setName(name);
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${id}`,
        url: sinkUrl(id),
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.publishAndExpectAccepted();
      await pm.workflowsPage.skipLinkAlerts();
      await pm.workflowsPage.goToList();
      expect(await pm.workflowsPage.isPresent(name)).toBeTruthy();
      testLogger.info('incident workflow published', { name });
    });

    // INC-02 — the variant picker offers every lifecycle event_type. The dropdown value
    // IS the event_type, so it doubles as the reference for `meta_event_type == "..."`.
    test('INC-02: sample variant picker lists every incident event type', async () => {
      await pm.workflowsPage.goToAdd('incident_event');
      await pm.workflowsPage.openTriggerConfig();
      const variants = await pm.workflowsPage.triggerVariantValues();
      testLogger.info('incident sample variants', { count: variants.length, variants });
      for (const type of INCIDENT_EVENT_TYPES) {
        expect(variants).toContain(type);
      }
      expect(variants.length).toBe(INCIDENT_EVENT_TYPES.length);
    });

    // INC-03 — the previewed payload reflects the SELECTED event_type: an event with
    // extras shows them, one without does not, and the common baseline is always there.
    //
    // Deliberately asserts payload CONTENT, not layout. main renders a common +
    // event-specific pair; an in-flight UX branch merges them into one block ("common
    // and event-specific fields merged in one `meta`"). Both designs must satisfy this
    // test — pinning it to the two-block markup would break it the moment that lands,
    // for a presentation change rather than a real regression.
    test('INC-03: previewed payload reflects the selected event type', async () => {
      await pm.workflowsPage.goToAdd('incident_event');
      await pm.workflowsPage.openTriggerConfig();

      // severity_upgrade carries old/new severity on top of the common fields.
      await pm.workflowsPage.selectTriggerVariant('severity_upgrade');
      const upgrade = await pm.workflowsPage.triggerPayloadText();
      expect(upgrade).toContain('old_severity');
      expect(upgrade).toContain('new_severity');

      // created adds nothing, so those event-specific fields must disappear.
      await pm.workflowsPage.selectTriggerVariant('created');
      const created = await pm.workflowsPage.triggerPayloadText();
      expect(created).not.toContain('old_severity');

      // The common baseline is present for every event type.
      expect(created).toContain('incident_id');
      expect(created).toContain('event_type');
      testLogger.info('payload tracked the selected event type', {
        upgradeLen: upgrade.length,
        createdLen: created.length,
      });
    });

    // INC-04 — incident kinds do NOT associate with alerts, so no link prompt appears.
    test('INC-04: incident workflow does not prompt to link alerts', async () => {
      const id = uniq();
      await pm.workflowsPage.goToAdd('incident_event');
      await pm.workflowsPage.setName(`wf_auto_inc_${id}`);
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${id}`,
        url: sinkUrl(id),
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.publishAndExpectAccepted();
      await pm.workflowsPage.expectNoLinkAlertsPrompt();
      testLogger.info('no link-alerts prompt for incident trigger');
    });

    // INC-05 — the other half: alert_fired DOES prompt. Without this, INC-04 would
    // pass even if the prompt were broken for every kind.
    test('INC-05: alert workflow does prompt to link alerts', async () => {
      const id = uniq();
      await pm.workflowsPage.goToAdd('alert_fired');
      await pm.workflowsPage.setName(`wf_auto_inc_${id}`);
      await pm.workflowsPage.addNodeFromPalette('destination');
      await pm.workflowsPage.createDestinationInline({
        name: `wf_auto_dest_${id}`,
        url: sinkUrl(id),
      });
      await pm.workflowsPage.saveNodeDrawer();
      await pm.workflowsPage.publishAndExpectAccepted();
      await pm.workflowsPage.expectLinkAlertsPrompt();
      await pm.workflowsPage.skipLinkAlerts();
      testLogger.info('link-alerts prompt shown for alert trigger');
    });

    // INC-06 — a Condition inside an incident workflow offers the INCIDENT fields.
    // Pairs with COND-06 (the alert half) to prove the field set is trigger-driven.
    test('INC-06: condition columns follow the incident trigger', async () => {
      await pm.workflowsPage.goToAdd('incident_event');
      await pm.workflowsPage.setName(`wf_auto_inc_${uniq()}`);
      await pm.workflowsPage.addNodeFromPalette('condition');
      await pm.workflowsPage.dismissConditionGuidelinesIfPresent();
      const columns = await pm.workflowsPage.conditionColumnValues();
      testLogger.info('incident-trigger condition columns', { count: columns.length });
      expect(columns).toContain('meta_event_type');
      expect(columns).toContain('meta_incident_id');
      // meta_alert_type is alert-only — it must not leak into an incident workflow.
      expect(columns).not.toContain('meta_alert_type');
    });
  }
);
