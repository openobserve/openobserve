/**
 * SLO — time-slice and PromQL SLIs, including the P0 measurement regression
 *
 * Plan: docs/test_generator/features/slos-test-plan.md (tests 13-22)
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * Time-slice SLOs once reported 100% (or 0%) regardless of the data. Both the
 * Count and TimeSlice plans mapped to `SliQueryPlan::Single`, and the ingest job
 * hardcoded `to_row(h, group_by, true)` — reading `zo_slo_good`, a column the
 * time-slice SQL never projects. `good` fell back to 0.0 and the classifier
 * compared 0.0 against the threshold, so the answer depended only on the
 * comparator's sign. Fixed in #13761.
 *
 * The form PREVIEW was correct throughout: it classifies client-side in JS
 * (`classifyPreviewSlices`) over points it fetches itself, and never touches
 * the backend measurement path. That is exactly why the bug shipped, and it is
 * why the P0 assertions below read the MEASURED SLI from the detail page rather
 * than the preview.
 *
 * MODE: serial. The backfill wait is paid once in beforeAll and shared. Running
 * parallel would make every worker seed its own 11k-row stream and wait again.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedSloStream,
  waitForSeedSearchable,
  createSloViaApi,
  waitForSloMeasured,
  timeSliceDefinition,
  timeSliceGroundTruth,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
  LATENCY_THRESHOLD_MS,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_ts';
const ORG = process.env['ORGNAME'];
const WINDOW_SECS = 7 * 86400;
const SLICE_SECS = 300;

/** Shared across the serial spec — built once in beforeAll. */
const shared = {
  stream: null,
  nowSecs: null,
  sloLt: null,   // comparator "<"
  sloGt: null,   // comparator ">"
};

test.describe.configure({ mode: 'serial' });

test.describe('SLO time-slice measurement', { tag: ['@slo', '@sloTimeSlice', '@all'] }, () => {
  let pm;

  test.beforeAll(async ({ browser }) => {
    // The config's 3-minute test timeout also bounds hooks, and this one
    // legitimately needs longer: ~11.5k rows of seed, two SLO creations, then a
    // backfill wait for each. Exceeding it tears the context down mid-wait and
    // surfaces as "Target page, context or browser has been closed", which
    // looks like a crash rather than a timeout.
    // Budget: two backfill waits capped at 10 min each by waitForSloMeasured,
    // plus seeding. 25 minutes only ever bought time for a stalled job to burn
    // the whole shard before failing — and in mode:'serial' that takes every
    // test with it. Sized to the waits it actually contains.
    test.setTimeout(20 * 60 * 1000);

    const context = await browser.newContext();
    const page = await context.newPage();

    shared.stream = uniqueName(`${PREFIX}_stream`);
    const seeded = await seedSloStream(page, shared.stream);
    shared.nowSecs = seeded.nowSecs;

    // Two SLOs over identical data differing ONLY in comparator. Their measured
    // SLIs must partition the slices — see the complementarity test below.
    shared.sloLt = await createSloViaApi(page, timeSliceDefinition({
      name: uniqueName(`${PREFIX}_lt`),
      stream: shared.stream,
      comparator: '<',
      threshold: LATENCY_THRESHOLD_MS,
      windowSecs: WINDOW_SECS,
      sliceIntervalSecs: SLICE_SECS,
    }));
    shared.sloGt = await createSloViaApi(page, timeSliceDefinition({
      name: uniqueName(`${PREFIX}_gt`),
      stream: shared.stream,
      comparator: '>',
      threshold: LATENCY_THRESHOLD_MS,
      windowSecs: WINDOW_SECS,
      sliceIntervalSecs: SLICE_SECS,
    }));

    // Pay the backfill wait ONCE, over the API. A 7-day window fills one
    // day-chunk at a time (~40s each here), and backfill concurrency defaults
    // to 1 — so these two fill one after the other, not together.
    await waitForSloMeasured(page, shared.sloLt.id);
    await waitForSloMeasured(page, shared.sloGt.id);

    testLogger.info('Time-slice fixtures measured', {
      stream: shared.stream, lt: shared.sloLt.id, gt: shared.sloGt.id,
    });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Trailing separator for the same reason as the other specs: startsWith
    // matching makes a bare prefix greedy.
    await deleteSlosByPrefix(page, `${PREFIX}_`).catch(() => {});
    // SLOs first (they may reference the destination), then everything else.
    await deleteFixturesByPrefix(page, `${PREFIX}_`).catch(() => {});
    await context.close();
  });

  // =========================================================== P0 REGRESSIONS

  /**
   * The direct form of the P0: a real SLI, not a rail.
   *
   * The seed is 8 days of good latency with a deliberate 3-hour bad patch, so
   * the true SLI is high but strictly under 100. Both rails are wrong answers:
   *   100 -> the `<` shape of the old bug
   *     0 -> the `>` shape of it
   *  null -> frozen, which means the seed failed rather than the app
   */
  test('time-slice SLO reports a measured SLI strictly between 0 and 100', {
    tag: ['@P0', '@regression'],
  }, async () => {
    await pm.sloDetailPage.goto(ORG, shared.sloLt.id);
    const sli = await pm.sloDetailPage.readSli();

    expect(sli, 'SLI must be measured, not frozen — an em dash here means the seed did not fill the window')
      .not.toBeNull();
    expect(sli, 'SLI pinned at 100 is the always-good shape of the time-slice regression')
      .toBeLessThan(100);
    expect(sli, 'SLI pinned at 0 is the always-bad shape of the time-slice regression')
      .toBeGreaterThan(0);

    testLogger.info('Measured time-slice SLI', { sli });
  });

  /**
   * The oracle. `avg < T` and `avg > T` partition the slices, so their SLIs sum
   * to ~100 for the same data.
   *
   * The sum ALONE would not catch the bug — under it the values were 100 and 0,
   * which also sums to 100. Requiring both to be off the rails as well is what
   * makes this decisive, and it never hardcodes an expected percentage, so a
   * change to the seed cannot silently invalidate it.
   */
  test('complementary comparators produce complementary SLIs, neither at a rail', {
    tag: ['@P0', '@regression'],
  }, async () => {
    await pm.sloDetailPage.goto(ORG, shared.sloLt.id);
    const sliLt = await pm.sloDetailPage.readSli();

    await pm.sloDetailPage.goto(ORG, shared.sloGt.id);
    const sliGt = await pm.sloDetailPage.readSli();

    expect(sliLt, 'the "<" SLO must be measured').not.toBeNull();
    expect(sliGt, 'the ">" SLO must be measured').not.toBeNull();

    // Off the rails: this is the half the bug cannot satisfy.
    expect(sliLt).toBeGreaterThan(0);
    expect(sliLt).toBeLessThan(100);
    expect(sliGt).toBeGreaterThan(0);
    expect(sliGt).toBeLessThan(100);

    // Complementary: slices equal to the threshold fall to neither side, so a
    // small tolerance is correct rather than sloppy.
    expect(
      Math.abs(sliLt + sliGt - 100),
      `"<" (${sliLt}%) and ">" (${sliGt}%) must partition the slices`,
    ).toBeLessThanOrEqual(2);

    testLogger.info('Complementarity verified', { sliLt, sliGt, sum: sliLt + sliGt });
  });

  /**
   * Absolute accuracy against the same data the backend read.
   *
   * Ground truth is a live `_search` bucketed exactly as the SLO is, never a
   * hardcoded number — so this asserts agreement, not a magic constant.
   */
  test('measured SLI matches the ground truth computed from the same data', {
    tag: ['@P0', '@regression'],
  }, async ({ page }) => {
    const truth = await timeSliceGroundTruth(page, {
      streamName: shared.stream,
      nowSecs: shared.nowSecs,
      windowSecs: WINDOW_SECS,
      sliceIntervalSecs: SLICE_SECS,
      comparator: '<',
      threshold: LATENCY_THRESHOLD_MS,
    });

    await pm.sloDetailPage.goto(ORG, shared.sloLt.id);
    const sli = await pm.sloDetailPage.readSli();

    expect(sli).not.toBeNull();
    expect(truth.total, 'ground-truth query returned no slices — the seed or the window is wrong')
      .toBeGreaterThan(0);

    // Tolerance covers the window edge: the SLO measures to its own watermark,
    // which trails "now" by ZO_SLO_INGEST_DELAY_SECS, so the two ranges differ
    // by a slice or two out of ~2000.
    expect(
      Math.abs(sli - truth.sli),
      `UI reported ${sli}%, ground truth ${truth.sli.toFixed(3)}% (${truth.good}/${truth.total} slices)`,
    ).toBeLessThanOrEqual(2);

    testLogger.info('SLI matches ground truth', { ui: sli, truth: truth.sli });
  });

  // ============================================================ P1 FUNCTIONAL

  /**
   * A float threshold once returned HTTP 422 on save, and GET returned `500.0`
   * so the GET->PUT round-trip failed — editing any time-slice SLO was
   * impossible. Fixed in #13761; this pins it.
   */
  test('a float threshold saves and survives an edit round-trip', {
    tag: ['@P1', '@regression'],
  }, async ({ page }) => {
    const name = uniqueName(`${PREFIX}_float`);
    const slo = await createSloViaApi(page, timeSliceDefinition({
      name,
      stream: shared.stream,
      comparator: '<',
      threshold: 499.5,
      windowSecs: WINDOW_SECS,
      sliceIntervalSecs: SLICE_SECS,
    }));

    // The round-trip is the regression: open the stored SLO and save it back
    // unchanged. The old failure was a GET whose body the PUT then rejected.
    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    const shown = await pm.sloFormPage.getThreshold();
    expect(Number(shown)).toBeCloseTo(499.5, 1);

    await pm.sloFormPage.setDescription('float threshold round-trip');
    await pm.sloFormPage.save();

    await pm.sloFormPage.gotoEdit(ORG, slo.id);
    expect(Number(await pm.sloFormPage.getThreshold())).toBeCloseTo(499.5, 1);
  });

  test('preview tally reports good, measured and SLI for a valid aggregate', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(shared.stream);
    await pm.sloFormPage.setExpression(pm.sloFormPage.locators.aggregate, 'avg(latency_ms)');
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(LATENCY_THRESHOLD_MS);

    await pm.sloFormPage.waitForTimeSlicePreview();
    const tally = await pm.sloFormPage.readTimeSliceTally();

    expect(tally.total, 'preview measured no slices').toBeGreaterThan(0);
    expect(tally.good).toBeLessThanOrEqual(tally.total);
    expect(tally.sli).toBeGreaterThanOrEqual(0);
    expect(tally.sli).toBeLessThanOrEqual(100);
  });

  /**
   * The threshold is deliberately excluded from the preview's debounced watcher:
   * "it never reaches SQL, so moving it reclassifies the slices already in hand,
   * and dragging it re-scores instantly with no query at all."
   *
   * Asserting that no search fires is what proves the reclassification is local
   * rather than a coincidental refetch.
   */
  test('changing the threshold re-scores the preview without issuing a new search', {
    tag: ['@P1'],
  }, async ({ page }) => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(shared.stream);
    await pm.sloFormPage.setExpression(pm.sloFormPage.locators.aggregate, 'avg(latency_ms)');
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(LATENCY_THRESHOLD_MS);
    await pm.sloFormPage.waitForTimeSlicePreview();

    const before = await pm.sloFormPage.readTimeSliceTally();

    // Count searches only from here, after the preview has settled.
    let searches = 0;
    const countSearch = (req) => {
      if (req.url().includes('/_search')) searches += 1;
    };
    page.on('request', countSearch);

    // A threshold below every observed value flips the classification wholesale.
    await pm.sloFormPage.setThreshold(1);
    await expect
      .poll(async () => (await pm.sloFormPage.readTimeSliceTally()).good, { timeout: 15000 })
      .not.toBe(before.good);

    page.off('request', countSearch);

    const after = await pm.sloFormPage.readTimeSliceTally();
    expect(after.total, 'the slice set must be unchanged — only the scoring moved')
      .toBe(before.total);
    expect(searches, 'moving the threshold must not issue a search').toBe(0);
  });

  /**
   * A gap is not a zero.
   *
   * `GROUP BY histogram(...)` emits nothing at all for a slot with no rows, so
   * the result set is the MEASURED part of the range, not the range. Reporting
   * a percentage over that without saying so is the mistake the whole feature
   * avoids: on a sparse stream the tally can be four slices out of twelve while
   * reading like a verdict on the hour.
   *
   * Seeded with deliberate holes rather than reusing the dense fixture, which
   * by construction has none.
   */
  test('sparse data surfaces the gap count instead of scoring gaps as failures', {
    tag: ['@P1'],
  }, async ({ page }) => {
    test.setTimeout(6 * 60 * 1000); // own seed + index wait
    const sparseStream = uniqueName(`${PREFIX}_sparse`);
    const nowSecs = Math.floor(Date.now() / 1000);
    const records = [];
    // One point every 15 minutes across the last 6 hours.
    //
    // The preview defaults to a 1h range and a 5-minute slice, so that window
    // holds 12 slots and this seed fills roughly 4 of them — measured slices
    // plus plenty of genuine gaps. Points must land INSIDE the default range:
    // seeding only older data leaves `points` empty, which renders the
    // `-empty` state instead of a tally and tests nothing about gaps.
    for (let ts = nowSecs - 6 * 3600; ts < nowSecs - 120; ts += 900) {
      records.push({
        _timestamp: ts * 1_000_000,
        latency_ms: 120,
        status_code: 200,
        service: 'checkout',
      });
    }
    const { ingestCustomData } = require('../utils/data-ingestion.js');
    const res = await ingestCustomData(page, sparseStream, records);
    expect(res.status, 'sparse seed ingest failed').toBeLessThan(300);

    // Block until the rows are queryable, so the preview cannot race the index
    // and report an empty state that looks like a gap finding.
    await waitForSeedSearchable(page, sparseStream, nowSecs, records.length);

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(sparseStream);
    await pm.sloFormPage.setExpression(pm.sloFormPage.locators.aggregate, 'avg(latency_ms)');
    await pm.sloFormPage.selectComparator('<');
    await pm.sloFormPage.setThreshold(LATENCY_THRESHOLD_MS);
    // 5-minute slices over the 1h default range = 12 slots.
    await pm.sloFormPage.selectSlice(300);
    await pm.sloFormPage.waitForTimeSlicePreview();

    await pm.sloFormPage.expectPreviewGapsVisible();

    // The measured slices that DID land are all good, so the tally must read
    // 100% over what it measured — the gaps must not drag it down.
    const tally = await pm.sloFormPage.readTimeSliceTally();
    expect(tally.total, 'no slices measured at all').toBeGreaterThan(0);
    expect(tally.good).toBe(tally.total);
  });

  test('PromQL time-slice hides the scope field and shows the absent-metric note', {
    tag: ['@P1'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    // The language toggle is `v-if="isMetricsStream"` — PromQL is only offered
    // for metrics, so the stream type has to move first or the toggle does not
    // exist to click.
    await pm.sloFormPage.selectTimeSliceStreamType('metrics');
    await pm.sloFormPage.selectTimeSliceLanguage('prom_ql');

    // A PromQL plan is a bare expression, so there is nowhere to put a scope —
    // the field is removed rather than ignored.
    await pm.sloFormPage.expectScopeHidden();
    await pm.sloFormPage.expectPromqlAbsentNoteVisible();
  });

  // ============================================================ P2 EDGE CASES

  /**
   * The two query shapes share one flat `config`, and `CountSource` ignores a
   * spare key rather than rejecting it — so a fragment left behind by the other
   * shape would ride into the payload in silence. The watcher clears the model,
   * not just the rendered field.
   */
  test('switching query language clears the other shape\'s fields', {
    tag: ['@P2'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('count');
    // Metrics: the only stream type that offers the language toggle at all.
    // No stream is selected — the assertion is about the MODEL being cleared,
    // and a metrics stream is irrelevant to that.
    await pm.sloFormPage.selectStreamType('metrics');
    // `metricsLanguage` defaults to PromQL, which HIDES good_expr — SQL has to
    // be chosen explicitly before the field exists to type into.
    await pm.sloFormPage.selectCountLanguage('sql');
    await pm.sloFormPage.setExpression(pm.sloFormPage.locators.goodExpr, 'status_code < 500');

    // SQL -> PromQL -> SQL. The SQL expression must not survive the excursion.
    await pm.sloFormPage.selectCountLanguage('prom_ql');
    await pm.sloFormPage.selectCountLanguage('sql');

    const goodExpr = await pm.sloFormPage.getExpression(pm.sloFormPage.locators.goodExpr);
    expect(
      (goodExpr ?? '').trim(),
      'the SQL predicate must be cleared by the language flip, not carried back',
    ).toBe('');
  });

  test('the 1-minute slice is disabled once the SLO is grouped', {
    tag: ['@P2'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('time_slice');
    await pm.sloFormPage.selectTimeSliceStream(shared.stream);

    // Ungrouped, 1m is available.
    await pm.sloFormPage.expectSliceOptionEnabled(60);

    // Grouped SLOs are pinned to 5-minute slices (D30), enforced at the form as
    // well as the API so the UI cannot offer a rejected combination.
    await pm.sloFormPage.selectGroupBy('service');
    await pm.sloFormPage.expectSliceOptionDisabled(60);
  });
});
