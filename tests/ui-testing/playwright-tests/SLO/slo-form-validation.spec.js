/**
 * SLO form — validation surfacing and conditional fields
 *
 * Plan: docs/test_generator/features/slos-test-plan.md
 *
 * The form performs NO client-side validation: there is no zod schema and the
 * Save button carries only `:loading`, never `:disabled`. Every rejection
 * therefore comes from the server, and `save()` renders
 * `e.response.data.message` **verbatim** into `slos-addslo-error`.
 *
 * That makes this spec the join between the API contract and what a user
 * actually sees. `slo-api-validation.spec.js` proves the server rejects the
 * input; these tests prove the reason reaches the screen instead of being
 * flattened into a generic "save failed".
 *
 * The exact messages are asserted deliberately — they are user-facing copy, and
 * the backend's budget/target rejections carry arithmetic the user needs.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedMinimalStream,
  seedSloMetric,
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_form';
const ORG = process.env['ORGNAME'];
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

test.describe.configure({ mode: 'parallel' });

test.describe('SLO form validation', { tag: ['@slo', '@sloForm', '@all'] }, () => {
  let pm;
  /** One stream per worker — see the note in slo-api-validation.spec.js. */
  let stream;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedMinimalStream(page, stream, { records: 50 });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    // SLOs first (they may reference the destination), then everything else.
    await deleteFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  // ------------------------------------------------- server errors reach the UI

  test('an empty name surfaces the server’s name constraint in the form', {
    tag: ['@P0', '@validation'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    // Everything else valid, so the name is unambiguously the rejected field.
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(stream);
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.goodExpr, 'status_code < 500',
    );
    await pm.sloFormPage.save();

    await pm.sloFormPage.expectError(/name must be non empty/i);
  });

  test('an out-of-range target surfaces the reason, not a generic failure', {
    tag: ['@P0', '@validation'],
  }, async ({}, testInfo) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name: uniqueName(workerPrefix(testInfo)),
      stream,
      goodExpr: 'status_code < 500',
      target: 150,
    });
    await pm.sloFormPage.save();

    // The server explains WHY 100 is excluded; that explanation must survive.
    await pm.sloFormPage.expectError(/greater than 0 and strictly below 100/i);
  });

  test('a duplicate name surfaces the conflict', {
    tag: ['@P1', '@validation'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name, stream, goodExpr: 'status_code < 500', target: 99,
    });
    await pm.sloFormPage.save();

    await pm.sloFormPage.expectError(/already exists/i);
  });

  /**
   * FINDING — a blank "good when" produces an unusable error message.
   *
   * The API has a clear message for an empty predicate
   * ("good_expr must be exactly one boolean expression", HTTP 400), but the form
   * never reaches it: `wireConfig()` runs the field through `pruned()`, which
   * DROPS empty strings, so the request omits `good_expr` entirely and fails
   * deserialization with HTTP 422. `save()` then finds no `response.data.message`
   * on that body and falls back to `e.message` — so the user is told
   * "Request failed with status code 422" about a field they left blank.
   *
   * This pins the CURRENT behaviour (an error is shown; the form stays open and
   * nothing is created) rather than asserting the friendly message the app does
   * not produce. If the form gains a required-field check, or `pruned()` stops
   * swallowing this one, the assertion below should be tightened to the 400 text.
   * Reported in docs/test_generator/audit-reports/slos-audit-2026-08-15.md.
   */
  test('a blank good expression is rejected and the form stays open', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(stream);
    // good_expr deliberately left empty: "" is a malformed predicate, not "all rows".
    await pm.sloFormPage.save();

    // An error IS surfaced — that much the user gets.
    await pm.sloFormPage.expectError();
    // And nothing was created behind it.
    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowAbsent(name);
  });

  /**
   * A rejected save must not strand the user.
   *
   * `save()` clears `error` on entry, so correcting the input and saving again
   * has to succeed and navigate away — otherwise a stale banner would make a
   * successful save look like it failed.
   */
  test('correcting a rejected save succeeds and clears the error', {
    tag: ['@P1', '@validation'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name, stream, goodExpr: 'status_code < 500', target: 150,
    });
    await pm.sloFormPage.save();
    await pm.sloFormPage.expectError(/strictly below 100/i);

    // Fix the one bad field and retry. Waiting for the navigation is what
    // proves the create completed rather than merely being dispatched.
    await pm.sloFormPage.setTarget(99);
    await pm.sloFormPage.saveExpectingSuccess();

    // Success navigates back to the list, where the new SLO is present.
    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
  });

  // ------------------------------------------------------- conditional fields

  /**
   * The three SLI types share one form, so switching type must swap the fields
   * rather than merely relabel them — a leftover field is how a stale fragment
   * rides into the payload.
   */
  test('switching SLI type swaps the visible fields', {
    tag: ['@P1'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);

    await pm.sloFormPage.selectSliType('count');
    await expect(page.locator(pm.sloFormPage.locators.goodExpr)).toBeVisible();
    await expect(page.locator(pm.sloFormPage.locators.aggregate)).toHaveCount(0);

    await pm.sloFormPage.selectSliType('time_slice');
    await expect(page.locator(pm.sloFormPage.locators.aggregate)).toBeVisible();
    await expect(page.locator(pm.sloFormPage.locators.comparator)).toBeVisible();
    await expect(page.locator(pm.sloFormPage.locators.threshold)).toBeVisible();
    await expect(page.locator(pm.sloFormPage.locators.goodExpr)).toHaveCount(0);

    await pm.sloFormPage.selectSliType('alert');
    await expect(page.locator(pm.sloFormPage.locators.alertSource)).toBeVisible();
    await expect(page.locator(pm.sloFormPage.locators.aggregate)).toHaveCount(0);
  });

  test('the SLI type description changes with the selected type', {
    tag: ['@P2'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    const description = page.locator(pm.sloFormPage.locators.sliTypeDescription);

    await pm.sloFormPage.selectSliType('count');
    const countText = await description.textContent();

    await pm.sloFormPage.selectSliType('time_slice');
    const sliceText = await description.textContent();

    expect((countText ?? '').trim().length, 'count type must be described').toBeGreaterThan(0);
    expect(
      (sliceText ?? '').trim(),
      'each SLI type needs its own description, not one shared blurb',
    ).not.toBe((countText ?? '').trim());
  });

  /**
   * The slice note explains what the width BUYS, and that differs by SLI type:
   * for a count SLI a finer slice changes nothing (the window SLI is Σgood/Σtotal),
   * while for a time-slice SLI the width IS the definition.
   */
  test('the slice note differs between count and time-slice', {
    tag: ['@P2'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    const note = page.locator(pm.sloFormPage.locators.sliceNote);

    await pm.sloFormPage.selectSliType('count');
    const countNote = (await note.textContent() ?? '').trim();

    await pm.sloFormPage.selectSliType('time_slice');
    const sliceNote = (await note.textContent() ?? '').trim();

    expect(countNote.length).toBeGreaterThan(0);
    expect(sliceNote).not.toBe(countNote);
  });

  test('the alert SLI picker explains itself when no eligible alert exists', {
    tag: ['@P2'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');

    // Either a populated picker or an explicit empty state — never a bare,
    // unexplained control the user cannot act on.
    const picker = page.locator(pm.sloFormPage.locators.alertSource);
    const empty = page.locator(pm.sloFormPage.locators.alertSourceEmpty);
    const hint = page.locator(pm.sloFormPage.locators.alertSourceHint);

    const shown = (await picker.count()) + (await empty.count()) + (await hint.count());
    expect(shown, 'the alert SLI must present a picker, an empty state, or a hint')
      .toBeGreaterThan(0);
  });

  // ------------------------------------------------------------ previews

  /**
   * The COUNT preview, which is a different component from the time-slice one
   * and was previously untested.
   *
   * Asserts a panel renders a CHART: every preview here has distinct empty and
   * error states, so a root-exists assertion passes against an empty chart.
   */
  test('the count preview renders a chart for a valid definition', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(stream);
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.goodExpr, 'status_code < 500',
    );

    await pm.sloFormPage.waitForCountPreview();
    await pm.sloFormPage.expectCountPreviewPanelHasData('good');
  });

  // ------------------------------------------------------------ PromQL

  /**
   * A PromQL COUNT SLO, created end to end.
   *
   * PromQL is only offered for metrics streams — both language toggles are
   * `v-if="isMetricsStream"` — and `CountSource::PromQl` is two expressions with
   * no stream and no scope, so this exercises a genuinely different arm of
   * `wireConfig()` from the SQL count path.
   */
  test('creates a PromQL count SLO and it round-trips', {
    tag: ['@P1', '@promql'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const metric = uniqueName(`${workerPrefix(testInfo)}_metric`).toLowerCase();
    await seedSloMetric(page, metric);
    const name = uniqueName(workerPrefix(testInfo));

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStreamType('metrics');
    // Metrics default to PromQL, but select it explicitly so the test does not
    // silently depend on that default.
    await pm.sloFormPage.selectCountLanguage('prom_ql');

    // BOTH expressions are required: a missing one fails deserialization.
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.promqlGood, `sum(${metric})`,
    );
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.promqlTotal, `count(${metric})`,
    );
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);

    await pm.sloListPage.openRow(name);
    await pm.sloDetailPage.openTab('config');
    const stored = JSON.stringify(await pm.sloDetailPage.readConfigJson());
    expect(stored).toContain('prom_ql');
    expect(stored).toContain(metric);
  });

  /**
   * A PromQL TIME-SLICE SLO, created end to end.
   *
   * The scope field is removed rather than ignored in this mode — a PromQL plan
   * is a bare expression with nowhere to put a `WHERE` fragment — so this also
   * pins that the form does not submit one.
   */
  test('creates a PromQL time-slice SLO and it round-trips', {
    tag: ['@P1', '@promql'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(3 * 60 * 1000);
    const metric = uniqueName(`${workerPrefix(testInfo)}_metric`).toLowerCase();
    await seedSloMetric(page, metric);
    const name = uniqueName(workerPrefix(testInfo));

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStreamType('metrics');
    await pm.sloFormPage.selectTimeSliceLanguage('prom_ql');
    await pm.sloFormPage.expectScopeHidden();
    // A PromQL TIME-SLICE still carries stream/stream_type — unlike a PromQL
    // COUNT, whose source is two bare expressions. Omitting it is a 422 on
    // `missing field \`stream\``, verified against the API.
    await pm.sloFormPage.selectTimeSliceStream(metric);

    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.aggregate, `max(${metric})`,
    );
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(500);
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);

    await pm.sloListPage.openRow(name);
    await pm.sloDetailPage.openTab('config');
    const stored = JSON.stringify(await pm.sloDetailPage.readConfigJson());
    expect(stored).toContain('prom_ql');
    expect(stored).toContain(metric);
  });

  // ------------------------------------------------------- negative / edge

  /**
   * A definition with no stream cannot measure anything, and the form must say
   * so rather than saving something inert.
   */
  test('saving without a stream is refused', {
    tag: ['@P1', '@validation', '@negative'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('count');
    // No stream picked at all.
    await pm.sloFormPage.save();

    await pm.sloFormPage.expectError();
    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowAbsent(name);
  });

  /**
   * A malformed aggregate is only discovered when the query runs, so the preview
   * is where the user finds out. It must show its ERROR state rather than an
   * empty chart, which would read as "no data" and send them looking at the
   * stream instead of the expression.
   */
  test('an invalid aggregate surfaces the preview error state', {
    tag: ['@P1', '@negative'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(stream);
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.aggregate, 'this_is_not_a_function(((',
    );
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(500);

    await expect(
      page.locator(pm.sloFormPage.locators.tsPreviewError),
      'a broken expression must report an error, not an empty chart',
    ).toBeVisible({ timeout: 60000 });
  });

  test('an over-long name is refused with the length constraint', {
    tag: ['@P2', '@validation', '@negative'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName('z'.repeat(300));
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.selectStream(stream);
    await pm.sloFormPage.setExpression(
      pm.sloFormPage.locators.goodExpr, 'status_code < 500',
    );
    await pm.sloFormPage.save();

    await pm.sloFormPage.expectError(/less than 256 characters/i);
  });

  /**
   * Cancel must discard, not save. A cancel that quietly persisted would be the
   * worst kind of bug: invisible until someone wonders where the SLO came from.
   */
  test('cancelling the form creates nothing', {
    tag: ['@P1', '@negative'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({ name, stream, goodExpr: 'status_code < 500' });
    await pm.sloFormPage.cancel();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowAbsent(name);
  });

  /**
   * Targets sit strictly inside (0, 100) — 100 exactly is refused because a
   * zero error budget makes every burn rate 0 or infinite. The boundary is
   * worth its own test: an off-by-one here silently permits an unusable SLO.
   */
  test('a target of exactly 100 is refused at the boundary', {
    tag: ['@P2', '@validation', '@negative'],
  }, async ({}, testInfo) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name: uniqueName(workerPrefix(testInfo)),
      stream,
      goodExpr: 'status_code < 500',
      target: 100,
    });
    await pm.sloFormPage.save();
    await pm.sloFormPage.expectError(/strictly below 100/i);
  });

  test('a fractional target just inside the range is accepted', {
    tag: ['@P2', '@edge'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name, stream, goodExpr: 'status_code < 500', target: 99.999,
    });
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
  });

  // ------------------------------------------------------------ window / slice

  test('all three rolling windows are selectable', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    for (const secs of [604800, 2592000, 7776000]) {
      await pm.sloFormPage.selectWindow(secs);
    }
  });

  test('both slice intervals are selectable while ungrouped', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.expectSliceOptionEnabled(60);
    await pm.sloFormPage.expectSliceOptionEnabled(300);
  });
});
