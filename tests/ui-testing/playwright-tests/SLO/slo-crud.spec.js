/**
 * SLO — core CRUD lifecycle (list, create, detail, edit, pause, delete)
 *
 * Plan: docs/test_generator/features/slos-test-plan.md (tests 1-12)
 * Feature: docs/test_generator/features/slos-feature.md
 *
 * OSS feature — the SLO routes carry no license gate, so these are @all and
 * NOT @enterprise.
 *
 * Self-cleaning: every SLO is named `e2e_slo_crud_*` and swept by prefix in
 * afterAll. Row selectors interpolate the SLO NAME, so names must be unique —
 * the app does not enforce that itself.
 *
 * These tests deliberately do NOT assert SLI values. A brand-new SLO over an
 * unseeded stream is legitimately unmeasured, and its stats render an em dash.
 * SLI correctness is spec `slo-timeslice.spec.js`, which pays for seeded data.
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

const PREFIX = 'e2e_slo_crud';
const ORG = process.env['ORGNAME'];

/**
 * Names are scoped to the WORKER, not just the spec.
 *
 * `afterAll` runs once per worker in parallel mode, so a worker that finishes
 * early would sweep the shared `e2e_slo_crud` prefix and delete fixtures the
 * other workers are still using — which shows up as a different test failing on
 * every run. Every name therefore carries `_w<index>_`, and each worker only
 * ever deletes its own.
 */
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

test.describe.configure({ mode: 'parallel' });

test.describe('SLO CRUD lifecycle', { tag: ['@slo', '@sloCrud', '@all'] }, () => {
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    // A fresh context: the per-test pages are already closed by here.
    // Scoped to THIS worker's prefix — see workerPrefix above.
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  // ---------------------------------------------------------------- P0 smoke

  test('SLO list page loads with title, table and New button', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }) => {
    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectListVisible();
  });

  test('creates a count SLO through the form and it appears in the list', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.fillCountSlo({
      name,
      stream,
      goodExpr: 'status_code < 500',
      target: 99,
    });
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
  });

  test('SLO detail renders title, stats and tabs', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    const slo = await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloDetailPage.goto(ORG, slo.id);
    await pm.sloDetailPage.expectDetailVisible();
    await pm.sloDetailPage.expectTitle(name);
  });

  /**
   * The definition must survive the round-trip.
   *
   * This is the UI-visible form of the class of bug that made editing a
   * time-slice SLO impossible (a GET whose body the following PUT rejected).
   * SloConfigSummary renders the STORED definition, so comparing it against
   * what was submitted catches silent mutation on the way in or out.
   */
  test('stored definition round-trips into the config summary', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    const definition = countDefinition({ name, stream, goodExpr: 'status_code < 500', target: 99 });
    const slo = await createSloViaApi(page, definition);

    await pm.sloDetailPage.goto(ORG, slo.id);
    await pm.sloDetailPage.openTab('config');

    const stored = await pm.sloDetailPage.readConfigJson();
    expect(stored, 'stored config must expose the good expression').toBeTruthy();
    const asText = JSON.stringify(stored);
    expect(asText).toContain('status_code < 500');
    expect(asText).toContain(stream);
  });

  // ------------------------------------------------------------- P1 functional

  test('edits an SLO description and the change persists', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    const slo = await createSloViaApi(page, countDefinition({ name, stream }));

    const updated = 'edited by e2e';
    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    await pm.sloFormPage.setDescription(updated);
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    const readBack = await pm.sloFormPage.readDescription();
    expect(readBack).toBe(updated);
  });

  /**
   * Changing the DEFINITION resets measurement, so the form warns first — the
   * warning is the user's only signal that history is about to be discarded.
   *
   * `definitionKey()` covers sli_type, config, group_by, window_secs and
   * slice_interval_secs. It deliberately does NOT include `target`, so the
   * companion test below pins that a retarget stays silent.
   */
  test('changing the window raises the regeneration warning', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    const slo = await createSloViaApi(page, countDefinition({ name, stream, windowSecs: 604800 }));

    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    await pm.sloFormPage.selectWindow(2592000); // 7d -> 30d
    await pm.sloFormPage.expectRegenWarningVisible();
  });

  /**
   * The other half of the contract: moving the TARGET re-scores an existing
   * measurement rather than invalidating it, so no history is discarded and no
   * warning is due. A warning here would train people to ignore it.
   */
  test('changing only the target does not raise the regeneration warning', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    const slo = await createSloViaApi(page, countDefinition({ name, stream, target: 99 }));

    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    await pm.sloFormPage.setTarget(95);
    await pm.sloFormPage.expectRegenWarningAbsent();
  });

  test('pauses and resumes an SLO from the list row', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);

    // The pressed state must actually flip, otherwise a silent API failure
    // reads as success.
    await pm.sloListPage.expectToggleFlips(name);
  });

  /**
   * The delete dialog resolves its dependent-alert check before offering to
   * confirm, and stays QUIET when there is nothing to warn about.
   *
   * The count banner renders only on `alertCount > 0`; an SLO with no alerts
   * correctly shows neither it nor the "unknown" banner. Asserting a banner
   * here would have demanded a warning about zero dependents.
   */
  test('delete dialog resolves its alert check and warns only when warranted', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
    await pm.sloListPage.openDeleteDialog(name);
    await pm.sloListPage.expectAlertCheckResolved();
    await pm.sloListPage.expectNoAlertCountWarning();
    await pm.sloListPage.closeDialogIfOpen();
  });

  test('deletes an SLO and it leaves the list', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
    await pm.sloListPage.deleteSlo(name);
    await pm.sloListPage.expectRowDeleted(name);
  });

  test('search filters the list by name', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const kept = uniqueName(`${workerPrefix(testInfo)}_kept`);
    const other = uniqueName(`${workerPrefix(testInfo)}_other`);
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name: kept, stream }));
    await createSloViaApi(page, countDefinition({ name: other, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(kept);
    await pm.sloListPage.search(kept);
    await pm.sloListPage.expectRowVisible(kept);
    await pm.sloListPage.expectRowAbsent(other);
  });

  test('type filter narrows the list to a single SLI type', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const countName = uniqueName(`${workerPrefix(testInfo)}_count`);
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name: countName, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(countName);
    await pm.sloListPage.filterByType('count');
    await pm.sloListPage.expectRowVisible(countName);

    await pm.sloListPage.filterByType('time_slice');
    await pm.sloListPage.expectRowAbsent(countName);
  });

  // -------------------------------------------------------------- P2 edge cases

  test('an unknown SLO id renders the not-found state', {
    tag: ['@P2'],
  }, async ({ page }) => {
    await pm.sloDetailPage.goto(ORG, 'definitely-not-a-real-slo-id');
    await pm.sloDetailPage.expectNotFound();
  });

  test('the total stat tile is selectable and clears the health filter', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    const name = uniqueName(workerPrefix(testInfo));
    await seedMinimalStream(page, stream);
    await createSloViaApi(page, countDefinition({ name, stream }));

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);

    // A brand-new SLO is unmeasured, so it sits under no_data. Filtering there
    // keeps it; clicking total must clear the filter and keep it too.
    await pm.sloListPage.clickStat('no_data');
    await pm.sloListPage.expectRowVisible(name);
    await pm.sloListPage.clickStat('total');
    await pm.sloListPage.expectRowVisible(name);
  });
});
