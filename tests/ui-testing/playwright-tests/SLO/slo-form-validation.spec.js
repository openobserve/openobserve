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
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
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
    await context.close();
  });

  // ------------------------------------------------- server errors reach the UI

  test('an empty name surfaces the server’s name constraint in the form', {
    tag: ['@P0', '@validation'],
  }, async ({ page }) => {
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
  }, async ({ page }, testInfo) => {
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
  }, async ({ page }, testInfo) => {
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
  }, async ({ page }, testInfo) => {
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

  // ------------------------------------------------------------ window / slice

  test('all three rolling windows are selectable', {
    tag: ['@P1'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    for (const secs of [604800, 2592000, 7776000]) {
      await pm.sloFormPage.selectWindow(secs);
    }
  });

  test('both slice intervals are selectable while ungrouped', {
    tag: ['@P1'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('count');
    await pm.sloFormPage.expectSliceOptionEnabled(60);
    await pm.sloFormPage.expectSliceOptionEnabled(300);
  });
});
