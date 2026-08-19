// databaseMonitoringScopeIntegrity.spec.js
//
// WHY THIS FILE EXISTS
// --------------------
// Two defects shipped together and neither existing spec could see them,
// because both specs apply scope by URL and assert against row counts only.
//
//   1. THE BADGE DID NOT BELONG TO THE SCOPE. A page publishes the count it
//      measured into the SHARED badge snapshot, and nothing retracted that
//      when the scope changed. Reported symptom: an Activity badge reading
//      466 beside a table showing "0 sessions" — the API returned 0 for that
//      scope, and 466 was the previous scope's measurement still painted.
//      No test compared a badge to its own tab's rows, so it was invisible.
//
//   2. THE FILTER COULD ONLY OFFER WHAT WAS ALREADY ON SCREEN. Every tab
//      derived its instance picker from its own loaded rows, so an engine
//      with no rows on that tab was UNSELECTABLE — Activity's picker omitted
//      `mssql-prod-1` while a chip set on Deadlocks still displayed it,
//      leaving a scope the reader could neither choose nor clear. Every test
//      navigated by URL, so no test ever opened the picker.
//
// Both assertions below are INVARIANTS, engine-agnostic and volume-agnostic:
// the rigs ingest continuously, so any pinned number is stale before the run
// ends.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/** Tabs whose badge counts the same population their table renders. */
const BADGE_TABS = [
  { tab: 'activity', endpoint: 'activity' },
  { tab: 'deadlocks', endpoint: 'deadlocks' },
  { tab: 'blocked', endpoint: 'blocking' },
  { tab: 'tableHealth', endpoint: 'table_health' },
];

test.describe('Database Monitoring — scope integrity', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let dbm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    dbm = pm.databaseMonitoringPage;
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // BUG 1: a badge must describe the scope its tab is showing
  // =========================================================================

  for (const { tab, endpoint } of BADGE_TABS) {
    test(`P0: ${tab}'s badge agrees with its own table after a scope change`, {
      tag: ['@dbm', '@infra', '@P0', '@filters', '@all'],
    }, async () => {
      const fleet = await dbm.fleetInstances();
      test.skip(!fleet || fleet.length < 1, 'org holds no instances');

      // Start UNSCOPED so any page-published badge is measured over the whole
      // org — the state the stale number came from. This tab is loaded on its
      // OWN, not by clicking through the strip: `<keep-alive>` holds the
      // previous tab's table mounted, and `settleTab` can return while those
      // rows are still on screen, which reports one tab's rows beside
      // another's badge.
      await dbm.navigate(tab);
      await dbm.expectLoaded();
      expect(await dbm.settleTab(tab), `${tab} never resolved unfiltered`).not.toBe('timeout');

      // Then narrow to ONE instance and let the tab settle again.
      const target = fleet[0];
      await dbm.navigateWithScope(tab, {
        instance: target.instance,
        system: target.system,
      });
      await dbm.expectLoaded();
      expect(await dbm.settleTab(tab), `${tab} hung under a real scope`).not.toBe('timeout');
      // The chip proves the NEW scope is the one on screen. Without this the
      // read can land on the kept-alive previous render and report the old
      // scope's rows beside the new scope's badge — a false result that looks
      // exactly like the bug under test.
      await expect(dbm.scopeChip).toBeVisible({ timeout: 15000 });

      // Read the API FIRST, then wait for the table to agree with it. A bare
      // `rowsOn` here races the re-render: the chip is applied the moment the
      // URL changes, but the kept-alive table still holds the previous
      // scope's rows for a beat, and reading then reports a mismatch the
      // product never showed.
      const api = await dbm.apiCount(endpoint, {
        instance: target.instance,
        system: target.system,
      });
      if (api === 0) {
        await expect
          .poll(async () => dbm.rowsOn(tab), { timeout: 20000 })
          .toBe(0);
      }
      const rows = await dbm.rowsOn(tab);
      const badge = await dbm.badgeNumber(tab);
      testLogger.info(
        `${tab} scoped to ${target.system}/${target.instance}: ` +
          `rows=${rows} badge=${badge} api=${api} url=${await dbm.page.url()}`,
      );

      // THE INVARIANT. A badge is a claim about the tab beside it. It may be
      // WITHHELD (null) when the slice cannot be counted — that is honest —
      // but it must never assert a population the table contradicts.
      if (badge !== null && rows === 0 && api === 0) {
        expect(
          badge,
          `${tab} badge reads ${badge} while its table shows 0 rows and the API ` +
            `returns 0 for this scope — a count from a previous scope is still painted`,
        ).toBe(0);
      }
    });
  }

  // =========================================================================
  // BUG 2: the picker must offer the org's fleet, not this tab's rows
  // =========================================================================

  for (const { tab } of BADGE_TABS) {
    test(`P0: ${tab}'s instance picker offers every instance the org has`, {
      tag: ['@dbm', '@infra', '@P0', '@filters', '@all'],
    }, async () => {
      const fleet = await dbm.fleetInstances();
      test.skip(!fleet || fleet.length < 2, 'needs a multi-instance org to be meaningful');

      await dbm.navigate(tab);
      await dbm.expectLoaded();
      expect(await dbm.settleTab(tab), `${tab} never resolved`).not.toBe('timeout');

      const offered = await dbm.instanceOptions();
      testLogger.info(`${tab} picker offers: ${JSON.stringify(offered)}`);

      // THE INVARIANT. An instance the org HAS must be selectable from every
      // tab — including a tab that has no rows for it. That is precisely when
      // a reader needs the filter: to find out whether this tab has anything
      // for that database. A picker built from the rows on screen can only
      // ever confirm what the reader can already see.
      const missing = fleet
        .map((f) => f.instance)
        .filter(Boolean)
        .filter((name) => !offered.some((o) => o.includes(name)));

      expect(
        missing,
        `${tab}'s picker cannot offer ${JSON.stringify(missing)} — the org has ` +
          `these instances, so a reader cannot scope this tab to them (nor clear ` +
          `back to them once a sibling tab set the chip)`,
      ).toEqual([]);
    });
  }
});
