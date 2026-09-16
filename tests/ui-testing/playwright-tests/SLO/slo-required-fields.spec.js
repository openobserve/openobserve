/**
 * SLO forms — required-field validation, client side
 *
 * Plan: docs/test_generator/features/slos-test-plan.md
 *
 * A companion to `slo-form-validation.spec.js`, which covers the messages the
 * SERVER produces. This spec covers the checks the form makes on its own, and
 * it exists because those checks were absent: every required field reached the
 * API empty, and the user was shown "Request failed with status code 422" —
 * a message naming no field at all.
 *
 * Two properties are asserted for every field, and both matter:
 *
 *   - the message lands ON THE FIELD (`<field>-error`), not only in the page
 *     banner, so the user is told where to look; and
 *   - NO request is issued (`saveExpectingClientRejection`). Without that, a
 *     check that merely re-labels the server's 422 passes identically.
 *
 * Coverage is per SLI SHAPE rather than per field, because the required set is
 * a function of `sli_type` × query language: a PromQL count needs two queries
 * and no stream, while a PromQL time-slice needs the stream after all. Each
 * shape gets its own test so a regression names the shape it broke.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedMinimalStream,
  seedSloMetric,
  seedNotificationDestination,
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_req';
const ORG = process.env['ORGNAME'];
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

test.describe.configure({ mode: 'parallel' });

test.describe('SLO required fields', { tag: ['@slo', '@sloForm', '@all'] }, () => {
  let pm;
  const shared = {};

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    shared.stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    shared.metric = uniqueName(`${workerPrefix(testInfo)}_metric`);
    await seedMinimalStream(page, shared.stream, { records: 50 });
    // The PromQL toggles are `v-if="isMetricsStream"`, so a metrics stream is
    // the only way to reach the PromQL required set at all.
    await seedSloMetric(page, shared.metric, { minutes: 30 });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.sloFormPage.gotoNew(ORG);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await deleteFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  // ------------------------------------------------------ nothing filled in

  /**
   * The empty-form case, which is what a user hits by clicking Save to find out
   * what is needed. Every required field for the default shape must be marked
   * at once — marking only the first would make this a guessing game, one save
   * per field.
   */
  test('an untouched form marks every required field at once', {
    tag: ['@P0', '@validation'],
  }, async () => {
    await pm.sloFormPage.saveExpectingClientRejection();

    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.expectFieldError(f.name, /name is required/i);
    await pm.sloFormPage.expectFieldError(f.stream, /stream is required/i);
    await pm.sloFormPage.expectFieldError(f.goodExpr, /required/i);
  });

  /**
   * The toast is the "something is wrong" cue for a field scrolled out of view;
   * the field markers are the detail. Both are needed — a toast alone repeats
   * the old, useless experience, and a marker alone is invisible from the
   * bottom of a long form.
   */
  test('a blocked save also raises the error toast', {
    tag: ['@P1', '@validation'],
  }, async () => {
    await pm.sloFormPage.saveExpectingClientRejection();
    await pm.sloFormPage.expectError(/highlighted fields/i);
  });

  /**
   * Errors must not appear before the user has done anything.
   *
   * A form that is red on arrival trains people to ignore the colour, which
   * costs the marker its only job. Hence the `attemptedSave` gate.
   */
  test('a freshly opened form shows no errors', {
    tag: ['@P0', '@validation'],
  }, async ({ page }) => {
    await expect(
      page.locator('[data-test^="slos-addslo-"][data-test$="-error"]'),
      'a form nobody has submitted must not be pre-marked',
    ).toHaveCount(0);
  });

  /** Correcting the field clears its marker without another save attempt. */
  test('filling a marked field clears its error', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    await pm.sloFormPage.saveExpectingClientRejection();
    await pm.sloFormPage.expectFieldError(pm.sloFormPage.locators.name);

    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.expectNoFieldError(pm.sloFormPage.locators.name);
    // The others are still outstanding — clearing one must not clear the rest.
    await pm.sloFormPage.expectFieldError(pm.sloFormPage.locators.stream);
  });

  // --------------------------------------------------------- count SLI, SQL

  test('a SQL count SLO requires stream type, stream and the good expression', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.stream, /stream is required/i);
    await pm.sloFormPage.expectFieldError(f.goodExpr, /required/i);
    // The name was supplied, so it must NOT be marked.
    await pm.sloFormPage.expectNoFieldError(f.name);
  });

  test('a SQL count SLO with a stream still requires the good expression', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(shared.stream);
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.goodExpr, /required/i);
    await pm.sloFormPage.expectNoFieldError(f.stream);
  });

  // ------------------------------------------------------ count SLI, PromQL

  /**
   * `CountSource::PromQl` is exactly two expressions, and the stream is NOT part
   * of it — so requiring the stream here would block a legitimate definition.
   * Both halves are asserted for that reason.
   */
  test('a PromQL count SLO requires both queries and not the stream', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStreamType('metrics');
    await pm.sloFormPage.selectCountLanguage('prom_ql');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.promqlGood, /good query is required/i);
    await pm.sloFormPage.expectFieldError(f.promqlTotal, /total query is required/i);
    await pm.sloFormPage.expectNoFieldError(f.stream);
  });

  test('a PromQL count SLO with only the good query still requires the total', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStreamType('metrics');
    await pm.sloFormPage.selectCountLanguage('prom_ql');
    await pm.sloFormPage.setExpression(f.promqlGood, `sum(${shared.metric})`);
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.promqlTotal, /total query is required/i);
    await pm.sloFormPage.expectNoFieldError(f.promqlGood);
  });

  // ---------------------------------------------------- time-slice SLI, SQL

  /**
   * The comparator is deliberately absent from this list: switching to
   * `time_slice` seeds it with "<", so it is never blank through the UI. The
   * schema still carries the rule for a stored SLO that has none — asserting it
   * here would only pin the default.
   */
  test('a time-slice SLO requires stream, aggregate and threshold', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.timesliceStream, /stream is required/i);
    await pm.sloFormPage.expectFieldError(f.aggregate, /aggregate expression is required/i);
    await pm.sloFormPage.expectFieldError(f.threshold, /threshold is required/i);
    // Seeded, so it must NOT be marked.
    await pm.sloFormPage.expectNoFieldError(f.comparator);
  });

  /**
   * Zero is a legitimate threshold — "error count < 1" is an ordinary slice
   * rule — so a falsy-value check here would reject a valid SLO. Pinned because
   * `if (!threshold)` is the natural mistake.
   */
  test('a threshold of zero is accepted, not treated as missing', {
    tag: ['@P1', '@edge', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(shared.stream);
    await pm.sloFormPage.setExpression(f.aggregate, 'count(*)');
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(0);
    // Saving is the assertion: a `!threshold` check would block this outright.
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
  });

  // ------------------------------------------------- time-slice SLI, PromQL

  /**
   * A PromQL time-slice keeps the stream, unlike a PromQL count — the aggregate
   * is evaluated against a named metrics stream. Asserting the stream marker
   * here is what stops the two PromQL shapes being collapsed into one rule.
   */
  test('a PromQL time-slice SLO still requires the stream', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStreamType('metrics');
    await pm.sloFormPage.selectTimeSliceLanguage('prom_ql');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.timesliceStream, /stream is required/i);
    await pm.sloFormPage.expectFieldError(f.aggregate, /required/i);
  });

  // ----------------------------------------------------------- alert SLI

  test('an alert-based SLO requires a source alert', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('alert');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.alertSource, /source alert is required/i);
    // An alert SLI carries no stream or expression, so nothing else may be marked.
    await pm.sloFormPage.expectNoFieldError(f.name);
  });

  // -------------------------------------------------------------- objective

  test('a blank target is marked on the target field', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(shared.stream);
    await pm.sloFormPage.setExpression(f.goodExpr, 'status_code < 500');
    await pm.sloFormPage.setTarget('');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.target, /target is required/i);
  });

  /**
   * The server stores the target to 3 decimals. A 4th is silently truncated,
   * which changes the error budget without saying so — worth refusing.
   */
  test('a target with too many decimals is refused', {
    tag: ['@P2', '@validation', '@edge'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(shared.stream);
    await pm.sloFormPage.setExpression(f.goodExpr, 'status_code < 500');
    await pm.sloFormPage.setTarget(99.99999);
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.target, /3 decimal/i);
  });

  /** A target of 0 has no error budget at all, the same as 100. */
  test('a target of zero is refused at the lower boundary', {
    tag: ['@P2', '@validation', '@edge'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(shared.stream);
    await pm.sloFormPage.setExpression(f.goodExpr, 'status_code < 500');
    await pm.sloFormPage.setTarget(0);
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(f.target, /greater than 0 and below 100/i);
  });

  // --------------------------------------------------------------- grouping

  /**
   * D30: a grouped SLO must be on the 5-minute grid.
   *
   * The form does not wait for a save to say so — picking a group-by snaps the
   * slice to 5 minutes and DISABLES the 1-minute option, so the rejected pair
   * cannot be assembled at all. That is the behaviour worth pinning; the schema
   * still carries the rule for a stored SLO that predates it, which is why
   * `AddSlo.schema.spec.ts` asserts the rejection directly.
   */
  test('grouping snaps the slice to 5 minutes and locks the 1-minute option', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const f = pm.sloFormPage.locators;
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(shared.stream);
    await pm.sloFormPage.setExpression(f.goodExpr, 'status_code < 500');
    await pm.sloFormPage.setTarget(99);
    await pm.sloFormPage.selectSlice(60);
    await pm.sloFormPage.selectGroupBy('service');

    await pm.sloFormPage.expectSliceSelected(300);
    await pm.sloFormPage.expectSliceOptionDisabled(60);
  });

  /** An alert-based SLI cannot be grouped at all, so the control is locked. */
  test('the group-by control is disabled for an alert-based SLI', {
    tag: ['@P1', '@validation'],
  }, async ({ page }, testInfo) => {
    await pm.sloFormPage.setName(uniqueName(workerPrefix(testInfo)));
    await pm.sloFormPage.selectSliType('alert');

    await expect(
      page.locator('[data-test="slos-addslo-group-by-locked"]'),
      'the reason grouping is unavailable must be stated',
    ).toBeVisible({ timeout: 15000 });
  });

  // -------------------------------------------------- the edit form as well

  /**
   * Edit shares the component with create, but hydration writes over the form
   * AFTER mount — so a check keyed to mount would not survive the round trip.
   * Emptying a hydrated field must still be refused.
   */
  test('clearing a required field on the edit form is refused', {
    tag: ['@P1', '@validation'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const created = await createSloViaApi(
      page, countDefinition({ name, stream: shared.stream }),
    );

    await pm.sloFormPage.gotoEdit(ORG, created.id);
    await pm.sloFormPage.setName('');
    await pm.sloFormPage.saveExpectingClientRejection();

    await pm.sloFormPage.expectFieldError(pm.sloFormPage.locators.name, /name is required/i);
  });
});

// ---------------------------------------------------------------------------

test.describe('SLO alert required fields', { tag: ['@slo', '@sloAlerts', '@all'] }, () => {
  let pm;
  const shared = {};

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const prefix = `${workerPrefix(testInfo)}_alert`;
    shared.stream = uniqueName(`${prefix}_stream`);
    await seedMinimalStream(page, shared.stream, { records: 50 });
    shared.destination = await seedNotificationDestination(page, prefix);
    const slo = await createSloViaApi(
      page,
      countDefinition({ name: uniqueName(prefix), stream: shared.stream }),
    );
    shared.sloId = slo.id;
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.sloDetailPage.goto(ORG, shared.sloId);
    await pm.sloDetailPage.openTab('alerts');
    await pm.sloAlertsPage.clickAdd();
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await deleteFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  /**
   * A missing destination used to reach the server, which answered "Alert
   * destination or workflows is required" in a banner attached to nothing.
   * The field is where that belongs.
   */
  test('a missing destination is marked on the destinations field', {
    tag: ['@P0', '@validation'],
  }, async ({ page }) => {
    await pm.sloAlertsPage.setName(uniqueName(`${PREFIX}_nodest`));
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.submitExpectingClientRejection();

    // The field's own error node, shared with the generic alert form.
    await expect(
      page.locator('[data-test="alert-settings-destinations-error"]'),
      'the destinations field must carry the reason',
    ).toContainText(/at least one destination or workflow/i);
  });

  test('a blank frequency is marked on the frequency field', {
    tag: ['@P1', '@validation'],
  }, async ({ page }) => {
    await pm.sloAlertsPage.setName(uniqueName(`${PREFIX}_nofreq`));
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.setFrequency('');
    await pm.sloAlertsPage.submitExpectingClientRejection();

    await pm.sloAlertsPage.expectFieldError(
      pm.sloAlertsPage.locators.frequency, /frequency is required/i,
    );
  });

  /**
   * Zero silence means "re-notify every evaluation", which is a real choice —
   * so it must be accepted while a NEGATIVE value is refused. The pair is the
   * point: a single `> 0` check would pass one and fail the other.
   */
  test('a negative silence period is refused and zero is not', {
    tag: ['@P1', '@validation', '@edge'],
  }, async ({ page }) => {
    await pm.sloAlertsPage.setName(uniqueName(`${PREFIX}_silence`));
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.setSilence(-5);
    await pm.sloAlertsPage.submitExpectingClientRejection();
    await pm.sloAlertsPage.expectFieldError(
      pm.sloAlertsPage.locators.silence, /cannot be negative/i,
    );

    await pm.sloAlertsPage.setSilence(0);
    await pm.sloAlertsPage.expectNoFieldError(pm.sloAlertsPage.locators.silence);
  });

  /**
   * A burn-rate rule compares a fast window against a slow one. Inverted
   * windows are not a burn-rate rule at all, and the backend rejects them — the
   * form says so at the short-window field, which is the one to change.
   */
  test('a short window longer than the long window is refused', {
    tag: ['@P1', '@validation', '@edge'],
  }, async ({ page }) => {
    await pm.sloAlertsPage.setName(uniqueName(`${PREFIX}_windows`));
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    // The preset is 1h long / 5m short; 120 minutes inverts it.
    await pm.sloAlertsPage.setShortWindowMinutes(120);
    await pm.sloAlertsPage.submitExpectingClientRejection();

    await pm.sloAlertsPage.expectFieldError(
      pm.sloAlertsPage.locators.conditionShort, /shorter than the long window/i,
    );
  });

  test('a non-positive burn-rate threshold is refused', {
    tag: ['@P1', '@validation'],
  }, async ({ page }) => {
    await pm.sloAlertsPage.setName(uniqueName(`${PREFIX}_burn`));
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.setCritical(0);
    await pm.sloAlertsPage.submitExpectingClientRejection();

    await pm.sloAlertsPage.expectFieldError(
      pm.sloAlertsPage.locators.conditionCritical, /greater than 0/i,
    );
  });

  /**
   * An error-budget alert deliberately NULLS both windows, so a blanket
   * "windows are required" rule would make the whole kind unsubmittable. This
   * is the test that catches that.
   */
  test('an error-budget alert saves without any windows', {
    tag: ['@P0', '@validation'],
  }, async ({ page }) => {
    const name = uniqueName(`${PREFIX}_budget`);
    await pm.sloAlertsPage.setName(name);
    await pm.sloAlertsPage.selectKind('error_budget');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.submit();

    await expect(pm.sloAlertsPage.getListItemByName(name)).toHaveCount(1, { timeout: 20000 });
  });
});
