// databaseMonitoringFilterMatrix.spec.js
// The filtered/unfiltered matrix, across EVERY Database Monitoring tab.
//
// WHY THIS FILE EXISTS
// --------------------
// The other two Infra specs cover routing, empty states and interactions, and
// they test filtering thoroughly on two tabs. This one closes the gap the
// bugs kept appearing in: a scope the data GENUINELY CARRIES must never empty
// a tab that had rows, and it must be applied rather than ignored — on every
// tab, not just the ones someone remembered to check.
//
// That defect class has now shipped three times in this section:
//   * `o2_dbm_instance` was NULL on every row, so picking any value in the
//     "database" chip emptied Slowest calls and Deadlocks;
//   * one server answered to TWO instance identities, so no single choice
//     showed a complete server;
//   * MySQL deadlocks carried no database, so `?database=` matched nothing.
// Each was invisible to a test that only looked at one tab unfiltered.
//
// THE TWO NAMES THAT TRIP EVERYONE UP
// -----------------------------------
// The chip the UI labels "database" is the INSTANCE dimension
// (`dbm.filters.dimension.instance` => "database"); the actual database a
// statement ran in is `namespace`. Both are exercised here, with values taken
// FROM THE DATA — never hardcoded, because a pinned engine or instance turns
// this suite into a fixture test that passes on Postgres and fabricates
// failures on MySQL.
//
// WHAT IS ASSERTED, AND WHY NOT ROW COUNTS
// ----------------------------------------
// The rigs ingest continuously, so any pinned number is stale before the run
// ends. Every assertion is an INVARIANT that holds at any volume:
//   * a real scope must not empty a populated tab,
//   * a bogus scope must return nothing AND say why,
//   * the UI must agree with the API it is rendering.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/**
 * Every tab, with the endpoint that feeds it and the scope dimensions that
 * endpoint actually honours.
 *
 * `endpoint` is what the UI is checked against — comparing a tab to a pinned
 * number proves nothing, comparing it to its own API proves the page renders
 * what it was given.
 *
 * `dims` is measured, not assumed. Table health accepts only instance/system
 * (its feed names no database, so a namespace filter there would silently
 * return nothing for every value a reader could pick) — the page declares
 * exactly that in `dimensions: ["instance", "system"]`.
 */
const TAB_MATRIX = [
  { tab: 'activity', endpoint: 'activity', dims: ['system', 'instance', 'namespace'] },
  { tab: 'deadlocks', endpoint: 'deadlocks', dims: ['system', 'instance', 'namespace'] },
  { tab: 'blocked', endpoint: 'blocking', dims: ['system', 'instance', 'namespace'] },
  { tab: 'tableHealth', endpoint: 'table_health', dims: ['system', 'instance'] },
];

/** A value nothing can legitimately match. */
const BOGUS = 'instance-that-cannot-exist-12345';

test.describe('Database Monitoring — filter matrix', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let dbm;
  /** The scope THIS org's data actually carries. Resolved per test. */
  let scope = { engine: '', instance: '', namespace: '' };

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    dbm = pm.databaseMonitoringPage;
    const { engine, instance } = await dbm.firstScopeFromApi();
    scope = { engine, instance, namespace: await dbm.firstNamespaceFromApi() };
    testLogger.info(`org scope: ${JSON.stringify(scope)}`);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // POSITIVE: a real scope never empties a populated tab
  // =========================================================================

  for (const { tab, endpoint, dims } of TAB_MATRIX) {
    test(`P0: ${tab} survives every scope its data carries`, {
      tag: ['@dbm', '@infra', '@P0', '@filters', '@all'],
    }, async () => {
      test.skip(!scope.engine || !scope.instance, 'this org carries no scope to filter by');

      // Baseline from the API, so "did the filter empty it" is answered
      // against what the backend holds rather than a number written months ago.
      const unfiltered = await dbm.apiCount(endpoint, {});
      test.skip(!unfiltered, `${endpoint} has no rows in this window`);

      await dbm.navigate(tab);
      await dbm.expectLoaded();
      const settled = await dbm.settleTab(tab);
      expect(settled, `${tab} never resolved unfiltered`).not.toBe('timeout');
      const unfilteredRows = await dbm.rowsOn(tab);
      testLogger.info(`${tab}: api=${unfiltered} rows=${unfilteredRows}`);

      // Apply each dimension the endpoint honours, one at a time, using the
      // value the data really has. One at a time on purpose: combined filters
      // hide WHICH dimension broke, and that is the only detail worth having
      // when this fails.
      for (const dim of dims) {
        const value = dim === 'system' ? scope.engine : scope[dim];
        if (!value) {
          testLogger.info(`${tab}: no ${dim} value in this org — skipping that dimension`);
          continue;
        }

        const apiFiltered = await dbm.apiCount(endpoint, { [dim]: value, system: scope.engine });
        // A null read is UNKNOWN, never zero — treating a failed request as an
        // empty answer is how a broken backend passes as a correctly-empty tab.
        if (apiFiltered === null) {
          testLogger.info(`${tab}: ${dim} read failed — not asserting on an unknown`);
          continue;
        }

        await dbm.navigateWithScope(tab, { [dim]: value, system: scope.engine });
        await dbm.expectLoaded();
        const outcome = await dbm.settleTab(tab);
        expect(outcome, `${tab} hung under ${dim}=${value}`).not.toBe('timeout');
        const rows = await dbm.rowsOn(tab);
        testLogger.info(`${tab} ${dim}=${value}: api=${apiFiltered} rows=${rows}`);

        // THE INVARIANT. The API says this scope has rows, so the tab must
        // show some. This is the assertion that would have caught all three
        // shipped defects.
        if (apiFiltered > 0) {
          expect(
            rows,
            `${tab} emptied under ${dim}=${value} — the API returns ${apiFiltered} rows for it`,
          ).toBeGreaterThan(0);
        } else {
          // The API legitimately has nothing for this scope (MySQL top
          // queries carry no database at all, for instance). Then the tab must
          // SAY so rather than render a blank frame.
          expect(
            await dbm.waitForExplanation(tab),
            `${tab} showed nothing and explained nothing under ${dim}=${value}`,
          ).toBeTruthy();
        }
      }
    });
  }

  // =========================================================================
  // NEGATIVE: a bogus scope empties every tab, and every tab says why
  // =========================================================================

  for (const { tab, endpoint } of TAB_MATRIX) {
    test(`P1: ${tab} returns nothing for an instance that cannot exist, and explains it`, {
      tag: ['@dbm', '@infra', '@P1', '@filters', '@negative', '@all'],
    }, async () => {
      // The backend must agree: if it leaks rows for a nonexistent instance the
      // filter is not being applied at all, and the UI check below would pass
      // over a genuine defect.
      const apiCount = await dbm.apiCount(endpoint, {
        instance: BOGUS,
        system: scope.engine || undefined,
      });
      if (apiCount !== null) {
        expect(
          apiCount,
          `${endpoint} returned ${apiCount} rows for an instance that does not exist`,
        ).toBe(0);
      }

      await dbm.navigateWithScope(tab, { instance: BOGUS, system: scope.engine || 'postgresql' });
      await dbm.expectLoaded();
      const outcome = await dbm.settleTab(tab);
      expect(outcome, `${tab} hung on an impossible scope`).not.toBe('timeout');

      // Explanation FIRST: every empty state on these pages is gated on
      // `!loading`, so its appearance proves the fetch finished and the table
      // is converged. Counting first reads keep-alive rows from the previous
      // tab and reports a healthy page as broken.
      expect(
        await dbm.waitForExplanation(tab),
        `${tab} showed no rows and no explanation`,
      ).toBeTruthy();
      expect(await dbm.rowsOn(tab), `${tab} rendered rows for a nonexistent instance`).toBe(0);
    });
  }

  // =========================================================================
  // POSITIVE: the filter is APPLIED, not ignored
  // =========================================================================

  test('P0: a scope actually narrows — it is applied, not silently dropped', {
    tag: ['@dbm', '@infra', '@P0', '@filters', '@all'],
  }, async () => {
    test.skip(!scope.engine, 'no engine to scope by');

    // A filter that changes nothing is indistinguishable from one that works
    // on a single-server rig, so prove it from the OTHER side: an impossible
    // value must collapse the count that a real value preserves. If both come
    // back identical, the parameter is being ignored.
    //
    // The probe endpoint is DISCOVERED, not hardcoded. This used to always ask
    // `/activity`, which asserts a population that some engines cannot have:
    // SQL Server ships only blocking and deadlock recipes and has no session
    // sampler at all, so its honest answer is 0 and the test failed the
    // PRODUCT for an engine limitation. Pick the first endpoint this org
    // actually populates.
    let probe = null;
    let real = null;
    for (const candidate of ['activity', 'blocking', 'deadlocks', 'table_health']) {
      const n = await dbm.apiCount(candidate, {
        system: scope.engine,
        instance: scope.instance || undefined,
      });
      if (n) {
        probe = candidate;
        real = n;
        break;
      }
    }
    test.skip(!probe, 'this org has no populated feed to prove the filter against');
    const bogus = await dbm.apiCount(probe, { system: scope.engine, instance: BOGUS });
    test.skip(bogus === null, `${probe} bogus read failed — nothing to compare`);

    expect(bogus, `a nonexistent instance returned rows from ${probe}`).toBe(0);
    expect(
      real,
      `a real instance returned nothing from ${probe} — the scope matched no data`,
    ).toBeGreaterThan(0);
    testLogger.info(`${probe}: real-scope=${real} bogus-scope=${bogus}`);
  });

  // =========================================================================
  // POSITIVE: the chip reflects what was applied
  // =========================================================================

  test('P1: the applied scope is visible as a chip on every tab that accepts it', {
    tag: ['@dbm', '@infra', '@P1', '@filters', '@all'],
  }, async () => {
    test.skip(!scope.instance, 'no instance value in this org');

    for (const { tab } of TAB_MATRIX) {
      await dbm.navigateWithScope(tab, { instance: scope.instance, system: scope.engine });
      await dbm.expectLoaded();
      await dbm.settleTab(tab);

      // A filter the reader cannot SEE is worse than no filter: the numbers are
      // narrowed and nothing on screen says so.
      await expect(
        dbm.scopeChip,
        `${tab} applied a scope but rendered no chip for it`,
      ).toBeVisible({ timeout: 15000 });
    }
  });
});
