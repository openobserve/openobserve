/**
 * SLO — burn-rate alerts (#13704, #13761, restyled in #13784)
 *
 * Plan: docs/test_generator/features/slos-test-plan.md (tests 23-30)
 *
 * Alerts live on the SLO detail page's "alerts" tab, and the preview needs a
 * measured SLO behind it, so this spec seeds and measures one fixture in
 * beforeAll and shares it — hence serial mode.
 *
 * Preset cards report `aria-pressed`, which is the only assertable signal that
 * a preset is in effect; selection is otherwise conveyed by colour alone.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedSloStream,
  seedNotificationDestination,
  createSloViaApi,
  waitForSloMeasured,
  timeSliceDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
  LATENCY_THRESHOLD_MS,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_alert';
const ORG = process.env['ORGNAME'];
const WINDOW_SECS = 7 * 86400;
const SLICE_SECS = 300;

const shared = { stream: null, slo: null, destination: null };

test.describe.configure({ mode: 'serial' });

test.describe('SLO burn-rate alerts', { tag: ['@slo', '@sloAlerts', '@all'] }, () => {
  let pm;

  test.beforeAll(async ({ browser }) => {
    // See the note in slo-timeslice.spec.js: seeding plus a backfill wait
    // exceeds the config's 3-minute test timeout, which also bounds hooks.
    // One backfill wait (capped at 10 min by waitForSloMeasured) plus seeding.
    // See the note in slo-timeslice.spec.js on why this is not 25 minutes.
    test.setTimeout(12 * 60 * 1000);

    const context = await browser.newContext();
    const page = await context.newPage();

    shared.stream = uniqueName(`${PREFIX}_stream`);
    await seedSloStream(page, shared.stream);

    // A burn-rate alert cannot be saved without a destination.
    shared.destination = await seedNotificationDestination(page, uniqueName(PREFIX));

    shared.slo = await createSloViaApi(page, timeSliceDefinition({
      name: uniqueName(PREFIX),
      stream: shared.stream,
      comparator: '<',
      threshold: LATENCY_THRESHOLD_MS,
      windowSecs: WINDOW_SECS,
      sliceIntervalSecs: SLICE_SECS,
    }));

    // The alert preview scores real burn against real measurement, so the SLO
    // must be measured before the preview tests can mean anything.
    await waitForSloMeasured(page, shared.slo.id);

    testLogger.info('Alert fixture measured', { slo: shared.slo.id });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.sloDetailPage.goto(ORG, shared.slo.id);
    await pm.sloDetailPage.openTab('alerts');
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Trailing separator matters: `deleteSlosByPrefix` matches with startsWith,
    // and this PREFIX is a strict prefix of slo-alert-sli's ('e2e_slo_alertsli').
    // Without it this sweep deletes that spec's SLOs whenever both run on one
    // instance — which is exactly what `npx playwright test playwright-tests/SLO`
    // does locally.
    await deleteSlosByPrefix(page, `${PREFIX}_`).catch(() => {});
    // SLOs first (they may reference the destination), then everything else.
    await deleteFixturesByPrefix(page, `${PREFIX}_`).catch(() => {});
    await context.close();
  });

  // ------------------------------------------------------------------- P0

  test('alerts panel shows an empty state with an add affordance', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    await pm.sloAlertsPage.expectPanelVisible();
    await pm.sloAlertsPage.expectEmptyState();
  });

  test('creates a burn-rate alert from the SLO detail page', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    const name = uniqueName(`${PREFIX}_burn`);
    await pm.sloAlertsPage.createBurnRateAlert({
      name, preset: 'fast', destination: shared.destination,
    });
    await pm.sloAlertsPage.expectAlertListed(name);
  });

  // ------------------------------------------------------------------- P1

  test('applying a preset marks that card as pressed', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.applyPreset('mid');
    await pm.sloAlertsPage.expectPresetActive('mid');
  });

  /**
   * #13784 dropped the `?? 3600` / `?? 300` fallbacks behind these fields, so
   * the windows are now assumed present. A payload missing them would render
   * NaN rather than a default — this asserts a preset actually populates them
   * with usable numbers.
   */
  test('a preset populates the long and short burn windows with usable values', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.applyPreset('fast');

    const longHours = await pm.sloAlertsPage.readLongHours();
    const shortMinutes = await pm.sloAlertsPage.readShortMinutes();
    const critical = await pm.sloAlertsPage.readCritical();

    expect(Number.isFinite(longHours), 'long window must be a number, not NaN').toBe(true);
    expect(Number.isFinite(shortMinutes), 'short window must be a number, not NaN').toBe(true);
    expect(longHours).toBeGreaterThan(0);
    expect(shortMinutes).toBeGreaterThan(0);

    // The short window must stay strictly inside the long one, or the pair is
    // not a burn-rate condition at all.
    expect(shortMinutes * 60).toBeLessThan(longHours * 3600);

    // Every offered card must be savable: the backend caps burn rate at
    // 100/(100 - target), and the presets clamp to it rather than offering a trap.
    expect(critical).toBeGreaterThan(0);

    // And the comparison itself must be set: a burn-rate rule fires when the
    // measured rate goes ABOVE the threshold, so an unset or inverted operator
    // would make the alert either silent or permanently firing.
    const operator = await pm.sloAlertsPage.readOperator();
    expect(['>', '>='], `unexpected burn-rate operator: ${operator}`).toContain(operator);
  });

  /**
   * The burndown is the trend view's payload, and on a MEASURED SLO it must
   * carry data rather than an empty state.
   *
   * This replaces a planned "alert preview renders a band" test: `SloAlertPreview`
   * is mounted in exactly two places — AddSlo's alert-SLI branch and SloDetail's
   * ribbon (`v-if="slo && sourceAlertId"`). The burn-rate alert FORM contains no
   * preview at all, and this fixture is a time-slice SLO with no source alert,
   * so no ribbon renders either. Asserting one would have been asserting nothing.
   */
  test('the trend tab renders a burndown with data for a measured SLO', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloDetailPage.openTab('trend');
    await pm.sloDetailPage.expectBurndownHasData();
  });

  /**
   * A blank name is refused BEFORE any request, and says so on the field.
   *
   * `submit()` returns early on `nameError` without setting `saveError`, so the
   * error banner never appears — the inline field error is the whole of the
   * feedback. The form must also stay open rather than closing on a no-op,
   * which would look like success.
   */
  test('submitting without a name is refused with an inline field error', {
    tag: ['@P1', '@validation'],
  }, async () => {
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.setName('');
    await pm.sloAlertsPage.submit();

    await pm.sloAlertsPage.expectNameError();
    await pm.sloAlertsPage.expectFormStillOpen();
  });

  /**
   * Alert names reject whitespace and "/" — both are rejected server-side, and
   * the form checks first so a natural-language name never reaches save.
   */
  test('rejects an alert name containing unsupported characters', {
    tag: ['@P2', '@validation'],
  }, async () => {
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.setName('bad name/with slash');
    await pm.sloAlertsPage.submit();

    await pm.sloAlertsPage.expectNameError();
    await pm.sloAlertsPage.expectFormStillOpen();
  });

  /**
   * Coverage under ZO_SLO_MIN_COVERAGE means an alert on this source would
   * report no data rather than the SLI shown beside it — the preview says so
   * explicitly rather than letting the number be read as a verdict.
   *
   * Driven from a deliberately under-covered SLO: a 90-day window over 8 days
   * of seed is ~9% covered, far below the 0.9 floor.
   */
  test('an under-covered SLO reports that its alert would freeze', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const starved = await createSloViaApi(page, timeSliceDefinition({
      name: uniqueName(`${PREFIX}_starved`),
      stream: shared.stream,
      comparator: '<',
      threshold: LATENCY_THRESHOLD_MS,
      windowSecs: 90 * 86400,
      sliceIntervalSecs: SLICE_SECS,
    }));

    await pm.sloDetailPage.goto(ORG, starved.id);
    // The freeze is visible on the SLO itself before any alert exists.
    await pm.sloDetailPage.expectFrozenBanner();

    const sli = await pm.sloDetailPage.readSli();
    expect(sli, 'a frozen SLO must report an em dash, never 0 — unmeasured time is not downtime')
      .toBeNull();
  });

  /**
   * The other alert kind. Burn-rate watches the RATE the budget is being spent;
   * error-budget watches how much is LEFT — different question, different
   * condition shape, and only the burn-rate one was covered.
   */
  test('switching to the error-budget kind is accepted and savable', {
    tag: ['@P1'],
  }, async () => {
    const name = uniqueName(`${PREFIX}_budget`);
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.setName(name);
    await pm.sloAlertsPage.selectKind('error_budget');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.submit();

    await pm.sloAlertsPage.expectAlertListed(name);
  });

  /**
   * An existing alert can be reopened and changed.
   *
   * The panel row's Edit button is the only way in, and the form is shared with
   * create — so this also proves it hydrates rather than opening blank.
   */
  test('an existing burn-rate alert can be edited', {
    tag: ['@P1'],
  }, async () => {
    const name = uniqueName(`${PREFIX}_edit`);
    await pm.sloAlertsPage.createBurnRateAlert({
      name, preset: 'mid', destination: shared.destination,
    });
    await pm.sloAlertsPage.expectAlertListed(name);

    await pm.sloAlertsPage.openEditForListedAlert(name);
    // Hydrated, not blank: the stored name is already in the field.
    expect(await pm.sloAlertsPage.readInput(pm.sloAlertsPage.locators.name)).toBe(name);

    await pm.sloAlertsPage.setDescription('edited by e2e');
    await pm.sloAlertsPage.submit();
    await pm.sloAlertsPage.expectAlertListed(name);
  });

  // -------------------------------------------------------- negative / edge

  /**
   * A destination is mandatory: an alert nobody hears about is not an alert.
   * The server says so, and the form must surface that rather than appearing
   * to succeed.
   */
  test('submitting without a destination is refused with the reason', {
    tag: ['@P1', '@validation', '@negative'],
  }, async () => {
    const name = uniqueName(`${PREFIX}_nodest`);
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.setName(name);
    await pm.sloAlertsPage.applyPreset('fast');
    // No destination selected.
    await pm.sloAlertsPage.submit();

    await pm.sloAlertsPage.expectFormError(/destination|workflow/i);
    await pm.sloAlertsPage.expectFormStillOpen();
  });

  /** Cancel must not create anything. */
  test('cancelling the alert form creates nothing', {
    tag: ['@P1', '@negative'],
  }, async ({ page }) => {
    const name = uniqueName(`${PREFIX}_cancelled`);
    await pm.sloAlertsPage.clickAdd();
    await pm.sloAlertsPage.setName(name);
    await pm.sloAlertsPage.applyPreset('fast');
    await pm.sloAlertsPage.selectDestination(shared.destination);
    await pm.sloAlertsPage.cancel();

    await expect(
      page.locator(pm.sloAlertsPage.locators.list).getByText(name, { exact: false }),
    ).toHaveCount(0);
  });

  /**
   * Every preset must produce a savable condition.
   *
   * The published burn-rate rows assume a fine slice grid and a tight target,
   * neither of which is guaranteed here — the component clamps and snaps them
   * for that reason, and a card that cannot be saved would be a trap.
   */
  test('every burn-rate preset yields a savable alert', {
    tag: ['@P1', '@edge'],
  }, async () => {
    for (const preset of ['fast', 'mid', 'slow']) {
      const name = uniqueName(`${PREFIX}_${preset}`);
      await pm.sloAlertsPage.createBurnRateAlert({
        name, preset, destination: shared.destination,
      });
      await pm.sloAlertsPage.expectAlertListed(name);
    }
  });

  /**
   * The short window must stay strictly inside the long one for every preset —
   * a burn-rate condition compares a fast signal against a slow one, and an
   * inverted pair is not a burn-rate rule at all.
   */
  test('each preset keeps the short window inside the long one', {
    tag: ['@P2', '@edge'],
  }, async () => {
    for (const preset of ['fast', 'mid', 'slow']) {
      await pm.sloAlertsPage.clickAdd();
      await pm.sloAlertsPage.applyPreset(preset);

      const longHours = await pm.sloAlertsPage.readLongHours();
      const shortMinutes = await pm.sloAlertsPage.readShortMinutes();
      expect(Number.isFinite(longHours), `${preset}: long window must be a number`).toBe(true);
      expect(Number.isFinite(shortMinutes), `${preset}: short window must be a number`).toBe(true);
      expect(shortMinutes * 60, `${preset}: short must be inside long`)
        .toBeLessThan(longHours * 3600);

      await pm.sloAlertsPage.cancel();
    }
  });

  /**
   * FINDING — duplicate alert names on one SLO are ACCEPTED.
   *
   * Probed live: two POSTs with the same name both return 200, where a
   * duplicate SLO name returns 409. The panel lists alerts by name, so two
   * identically-named alerts are indistinguishable there, and the Edit control
   * is keyed by `alert_id` — meaning a user cannot tell which one they are
   * editing.
   *
   * This pins the CURRENT behaviour rather than asserting the rejection the
   * server does not perform. If alert naming gains a uniqueness rule, this
   * test fails loudly and should become a rejection assertion.
   */
  test('duplicate alert names are currently accepted on one SLO', {
    tag: ['@P2', '@edge'],
  }, async ({ page }) => {
    const name = uniqueName(`${PREFIX}_dup`);
    await pm.sloAlertsPage.createBurnRateAlert({
      name, preset: 'fast', destination: shared.destination,
    });
    await pm.sloAlertsPage.expectAlertListed(name);

    // Same name again — accepted today.
    await pm.sloAlertsPage.createBurnRateAlert({
      name, preset: 'mid', destination: shared.destination,
    });

    // Both rows exist, which is exactly what makes them indistinguishable.
    const rows = page.locator(`${pm.sloAlertsPage.locators.list} li`)
      .filter({ hasText: name });
    await expect(rows).toHaveCount(2, { timeout: 20000 });
  });

  // ------------------------------------------------------------------- P2
  //
  // The planned "disabled alert shows its disabled tag" test is NOT implemented.
  // `slo-alerts-disabled-tag` renders on `!a.enabled`, but there is no way to
  // reach that state: the panel row offers only Edit, and SloAlertForm carries
  // `enabled` in its model without exposing any control for it. Driving it
  // through a guessed alerts endpoint behind a conditional skip would report
  // green while asserting nothing, so the gap is reported rather than faked.
  // See docs/test_generator/audit-reports/slos-audit-2026-08-15.md.
});
