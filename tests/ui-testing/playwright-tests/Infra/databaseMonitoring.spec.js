// databaseMonitoring.spec.js
// E2E tests for Database Monitoring (Infra -> Databases).
//
// WHAT THESE COVER, AND WHY THESE
// -------------------------------
// Every test here is a regression net under a defect that actually shipped and
// was found by hand against the tests/dbm-server-vantage rig. None of them are
// speculative:
//
//   P0 route      DBM moved from /traces/databases to /infra/databases. The old
//                 path must keep resolving — permalinks and bookmarks exist.
//   P0 badge/tab  Table health's badge read 5 while its own table rendered
//                 "No table statistics yet". A badge that disagrees with the
//                 tab it labels is the highest-value invariant on this page:
//                 the two come from different reads, so nothing but a test
//                 keeps them honest.
//   P0 instance   The chip the UI labels "database" is the INSTANCE dimension.
//                 It matched nothing while o2_dbm_instance was null on every
//                 row, silently emptying Slowest calls and Deadlocks. Picking
//                 a real value must not empty a tab that had data.
//   P1 fallback   Slowest calls is trace-fed. On a no-traces deployment its
//                 client list is legitimately empty and the DATABASE-reported
//                 fallback is the whole answer. A page showing neither list
//                 nor a stated reason is the failure this catches.
//
// DATA DEPENDENCY
// ---------------
// These read whatever the target org already holds; they ingest nothing. Point
// ORGNAME at an org a collector actually feeds (the dev rig uses `pg_server`),
// or the data-bearing assertions skip rather than fail — an empty org must not
// be reported as a passing DBM suite.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DBM_TABS } = require('../../pages/dbmPages/databaseMonitoringPage.js');

/** Tabs whose badge counts rows in a table this suite can locate. */
const COUNTED_TABS = [
  { key: DBM_TABS.tableHealth, tab: 'tableHealth' },
  { key: DBM_TABS.activity, tab: 'activity' },
];

test.describe('Database Monitoring', () => {
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
  // P0: ROUTING
  // =========================================================================

  test('P0: DBM lives under /infra/databases and the tab strip renders', {
    tag: ['@dbm', '@infra', '@smoke', '@P0', '@all'],
  }, async ({ page }) => {
    await dbm.navigate('overview');
    await dbm.expectLoaded();
    expect(page.url()).toContain('/infra/databases');
    testLogger.info(`Landed on ${page.url()}`);
  });

  test('P0: the old /traces/databases path still resolves, preserving query', {
    tag: ['@dbm', '@infra', '@P0', '@all'],
  }, async ({ page }) => {
    // The move must not break links already pasted into tickets and chats.
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await page.goto(
      `${baseUrl}/web/traces/databases/table-health?org_identifier=${org}&period=1h`,
      { timeout: 60000 },
    );
    await page.waitForLoadState('load', { timeout: 20000 });

    await expect(page).toHaveURL(/\/infra\/databases\/table-health/, { timeout: 20000 });
    // The tab segment AND the query must survive — a redirect that drops the
    // scope silently changes what the reader is looking at.
    expect(page.url()).toContain('period=1h');
    testLogger.info(`Redirected to ${page.url()}`);
  });

  // =========================================================================
  // P0: BADGE / TABLE AGREEMENT
  // =========================================================================

  for (const { key, tab } of COUNTED_TABS) {
    test(`P0: ${tab} badge agrees with the rows its own tab renders`, {
      tag: ['@dbm', '@infra', '@P0', '@all'],
    }, async () => {
      await dbm.navigate(tab);
      await dbm.expectLoaded();

      const tableLocator = tab === 'tableHealth' ? dbm.tableHealthTable : dbm.activityTable;
      const emptyLocators =
        tab === 'tableHealth'
          ? [dbm.tableHealthNotCollecting, dbm.tableHealthNoMatches]
          : [dbm.activityNotCollecting, dbm.activityHealthy];

      // Badge and rows are captured together, after the table settles — see
      // readBadgeAndRows. Sampling them separately compared a fresh badge
      // against a stale row count and produced `badge=5 rows=0`, a
      // disagreement the UI never showed.
      const { outcome, badge, rows, truncated } = await dbm.readBadgeAndRows(
        key,
        tableLocator,
        emptyLocators,
      );
      expect(outcome, `${tab} never settled — neither rows nor an empty state`).not.toBe('timeout');
      testLogger.info(`${tab}: badge=${badge} rows=${rows} outcome=${outcome}`);

      // A badge is expected only where the ENGINE can fill that tab.
      //
      // The strip renders a badge when the count is non-null (`v-if="section.count != null"`),
      // and a count is null when the feed never answered — which is the honest
      // state for a tab this engine has no recipe for. SQL Server ships only
      // blocking and deadlock recipes: no activity source exists, so Activity
      // renders `dbm-activity-not-collecting` and NO badge, and demanding one
      // there fails a page that is behaving correctly.
      //
      // A missing badge is still a failure where the tab HAS data, which is
      // what this originally caught: treating "no badge" as "nothing to
      // reconcile" let the test pass while comparing nothing at all.
      const apiRows = await dbm.apiCount(tab === 'tableHealth' ? 'table_health' : 'activity', {});
      if (apiRows) {
        expect(
          badge,
          `${tab} has ${apiRows} rows in the API but rendered no badge — the strip's fan-out never resolved`,
        ).not.toBeNull();
      } else if (badge === null) {
        testLogger.info(`${tab}: no data and no badge — this engine has no feed for it`);
        return;
      }

      // The defect this pins: badge 5, table "No table statistics yet".
      // A non-zero badge over an empty table is always wrong — the badge
      // claims the tab has that many rows to show.
      if (badge > 0) {
        expect(
          rows,
          `${tab} badge claims ${badge} but the table rendered no rows`,
        ).toBeGreaterThan(0);
      }

      // Exact equality ONLY where the badge and the table count the same
      // thing, which is not universal:
      //
      //   Table health — badge counts the rows the tab lists. Comparable.
      //   Activity     — badge counts the SESSION POPULATION, from the
      //                  response's `by_state` (useDbmTabCounts.ts:356, "From
      //                  `by_state`, the population"), while the table lists
      //                  sampled activity ROWS. Measured on MySQL: by_state
      //                  sums to 7 live sessions over 223 sampled rows, so
      //                  badge 7 beside 20 rendered rows is both numbers being
      //                  right about different questions. Postgres hid this —
      //                  its by_state sums to 195, comfortably over the 20-row
      //                  page, so the branch below never fired.
      //
      // The invariant that DOES hold everywhere is the one asserted above: a
      // non-zero badge must never sit over an empty table.
      const badgeCountsRows = tab === 'tableHealth';
      if (badgeCountsRows && !truncated && badge > 0 && badge <= 20) {
        expect(rows, `${tab} badge ${badge} != ${rows} rendered rows`).toBe(badge);
      }
    });
  }

  // =========================================================================
  // P0: THE INSTANCE ("database") FILTER
  // =========================================================================

  test('P0: filtering by a real instance keeps the tab populated', {
    tag: ['@dbm', '@infra', '@P0', '@all'],
  }, async () => {
    // Table health is the cleanest probe: it accepts only instance/system, so
    // nothing else can explain a change in row count.
    await dbm.navigate('tableHealth');
    await dbm.expectLoaded();
    await dbm.waitForSettled(dbm.tableHealthTable, [
      dbm.tableHealthNotCollecting,
      dbm.tableHealthNoMatches,
    ]);

    const unfilteredRows = await dbm.getRowCount(dbm.tableHealthTable);
    test.skip(
      unfilteredRows === 0,
      'no table-health data in this org — point ORGNAME at a collector-fed org',
    );

    // Take the instance from the API rather than the DOM. The Instance column
    // renders no data-test of its own (only the three size-bar columns do), and
    // the strict selector policy rules out reading it by text or nth-child. The
    // API is also the better source: it gives the value the FILTER is matched
    // against, not the string the cell happens to display.
    const { instance, engine } = await dbm.firstScopeFromApi();
    test.skip(!instance, 'table-health rows carry no instance value to filter on');

    // The ENGINE comes from the data too, never hardcoded. Pinning
    // `system: 'postgresql'` here passed against the Postgres rig and failed
    // against the MySQL one for a reason that looked exactly like the original
    // defect — `instance=my-prod-1` AND `system=postgresql` correctly matches
    // nothing, so a healthy page reported "filtering emptied a populated
    // table". A suite that only runs green against one engine is not testing
    // the filter, it is testing the fixture.
    testLogger.info(`Filtering table health by instance=${instance} system=${engine}`);
    await dbm.navigateWithScope('tableHealth', { instance, system: engine });
    await dbm.waitForSettled(dbm.tableHealthTable, [
      dbm.tableHealthNotCollecting,
      dbm.tableHealthNoMatches,
    ]);

    const filteredRows = await dbm.getRowCount(dbm.tableHealthTable);
    testLogger.info(`unfiltered=${unfilteredRows} filtered=${filteredRows}`);

    // The regression: selecting an instance the data DOES carry emptied the
    // table, because the dimension was null on every row.
    expect(
      filteredRows,
      `filtering by instance=${instance} emptied a table that had ${unfilteredRows} rows`,
    ).toBeGreaterThan(0);
    expect(filteredRows).toBeLessThanOrEqual(unfilteredRows);
  });

  test('P1: an instance that matches nothing shows an empty STATE, not a blank page', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async () => {
    await dbm.navigateWithScope('tableHealth', {
      instance: 'no-such-instance-exists',
      system: 'postgresql',
    });
    await dbm.expectLoaded();

    const outcome = await dbm.waitForSettled(dbm.tableHealthTable, [
      dbm.tableHealthNoMatches,
      dbm.tableHealthNotCollecting,
    ]);
    expect(outcome, 'an unmatched filter left the page in limbo').not.toBe('timeout');

    // Zero rows is the CORRECT answer here; what matters is that the page says
    // so rather than rendering an empty frame with no explanation.
    const rows = await dbm.getRowCount(dbm.tableHealthTable);
    if (rows === 0) {
      const explained =
        (await dbm.tableHealthNoMatches.isVisible().catch(() => false)) ||
        (await dbm.tableHealthNotCollecting.isVisible().catch(() => false));
      expect(explained, 'no rows and no empty state — the reader is told nothing').toBeTruthy();
    }
  });

  // =========================================================================
  // P1: SLOWEST CALLS — THE TRACE-FED TAB
  // =========================================================================

  test('P1: Slowest calls shows the client list, the database fallback, or a stated reason', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async () => {
    await dbm.navigate('samples');
    await dbm.expectLoaded();

    const outcome = await dbm.waitForSettled(dbm.samplesTable, [
      dbm.samplesNoMatches,
      dbm.samplesLogOff,
      dbm.serverSamplesSection,
    ]);
    expect(outcome, 'Slowest calls never settled').not.toBe('timeout');

    const clientRows = await dbm.getRowCount(dbm.samplesTable);
    const fallbackShown = await dbm.serverSamplesSection.isVisible().catch(() => false);
    const logOff = await dbm.samplesLogOff.isVisible().catch(() => false);
    const noMatches = await dbm.samplesNoMatches.isVisible().catch(() => false);
    testLogger.info(
      `samples: clientRows=${clientRows} fallback=${fallbackShown} logOff=${logOff}`,
    );

    // On a no-traces deployment the client list is EMPTY BY DESIGN. Exactly one
    // of these must hold, and "none of them" is the bug: a page that shows an
    // empty table while the databases are reporting their own slowest
    // statements is hiding the only answer it has.
    expect(
      clientRows > 0 || fallbackShown || logOff || noMatches,
      'Slowest calls rendered neither a list nor an explanation',
    ).toBeTruthy();

    // If the fallback list is up, it must actually carry rows — an empty
    // fallback section is worse than none, since its heading claims the
    // databases answered.
    if (fallbackShown) {
      const serverRows = await dbm.getRowCount(dbm.serverSamplesTable);
      expect(serverRows, 'fallback section rendered with no rows').toBeGreaterThan(0);
      testLogger.info(`database-reported fallback rows: ${serverRows}`);
    }
  });

  // =========================================================================
  // P1: SCOPE SURVIVES A TAB SWITCH
  // =========================================================================

  test('P1: the scope chip survives moving between tabs', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async ({ page }) => {
    await dbm.navigateWithScope('tableHealth', { system: 'postgresql' });
    await dbm.expectLoaded();

    const before = await dbm.getInstanceChipText();
    await dbm.openTab(DBM_TABS.activity);
    await expect(page).toHaveURL(/\/infra\/databases\/activity/, { timeout: 20000 });

    // The tabs are views of ONE dataset over ONE scope; a filter that silently
    // resets on tab switch makes the numbers across tabs incomparable.
    const after = await dbm.getInstanceChipText();
    expect(after, 'the instance chip changed across a tab switch').toBe(before);
    expect(page.url(), 'the system scope was dropped from the URL').toContain('postgresql');
  });
});
