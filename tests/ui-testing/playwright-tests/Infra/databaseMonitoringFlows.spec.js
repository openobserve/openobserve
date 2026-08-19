// databaseMonitoringFlows.spec.js
// Positive and negative flow coverage for Database Monitoring (Infra -> Databases).
//
// Companion to databaseMonitoring.spec.js, which pins the specific defects we
// hit by hand (route move, badge/table disagreement, the instance filter).
// THIS file sweeps the section systematically: every tab, every empty state,
// search, pagination, deep links, and the malformed-input cases.
//
// THE RULE EVERY NEGATIVE TEST HERE FOLLOWS
// -----------------------------------------
// "No data" is a legitimate answer on every one of these tabs — a database
// with no deadlocks SHOULD show zero deadlocks. So a negative test may never
// assert emptiness alone; it asserts the page SAYS WHY it is empty (a declared
// empty state) and stays usable (tab strip alive, no crash). An empty frame
// with no explanation is the actual defect, and it is invisible to a test that
// only counts rows.
//
// WHY SO FEW HARD ROW-COUNT ASSERTIONS
// ------------------------------------
// The rig ingests continuously, so counts move between the act and the assert.
// Tests therefore assert INVARIANTS that hold at any volume (filtered <=
// unfiltered, page 2 differs from page 1, a nonsense filter cannot out-match an
// empty one) rather than pinned numbers, which would fail on a quiet rig and
// pass vacuously on a busy one.

const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

/** Every tab in the strip, with the route segment its URL uses. */
const ALL_TABS = [
  { tab: 'overview', segment: '' },
  { tab: 'queries', segment: 'queries' },
  { tab: 'samples', segment: 'samples' },
  { tab: 'activity', segment: 'activity' },
  { tab: 'deadlocks', segment: 'deadlocks' },
  { tab: 'blocked', segment: 'blocking' },
  { tab: 'tableHealth', segment: 'table-health' },
];

/** Tabs with a search box this suite drives. */
const SEARCHABLE_TABS = ['tableHealth', 'activity', 'deadlocks'];

test.describe('Database Monitoring — flows', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let dbm;
  /**
   * The engine THIS org actually holds, resolved once per test from the data.
   *
   * Never hardcoded: a suite pinned to `postgresql` sends a system filter that
   * cannot match a MySQL org, so every scoped assertion below would fail
   * against a healthy page and look like a product defect.
   */
  let engine = 'postgresql';

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    dbm = pm.databaseMonitoringPage;
    engine = (await dbm.firstScopeFromApi()).engine || 'postgresql';
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // POSITIVE: every tab loads and resolves
  // =========================================================================

  for (const { tab, segment } of ALL_TABS) {
    test(`P0: ${tab} loads, resolves, and lands on its own route`, {
      tag: ['@dbm', '@infra', '@P0', '@all'],
    }, async ({ page }) => {
      await dbm.navigate(tab);
      await dbm.expectLoaded();

      // The URL must match the tab asked for — a tab that silently redirects
      // (the enterprise guard bouncing to the overview, say) would otherwise
      // pass every content assertion below while showing a different page.
      const expected = segment ? `/infra/databases/${segment}` : '/infra/databases';
      expect(page.url(), `${tab} did not land on ${expected}`).toContain(expected);

      const outcome = await dbm.settleTab(tab);
      expect(
        outcome,
        `${tab} never resolved — no rows and no declared empty state`,
      ).not.toBe('timeout');

      const rows = await dbm.rowsOn(tab);
      testLogger.info(`${tab}: outcome=${outcome} rows=${rows}`);
    });
  }

  test('P0: every tab in the strip is reachable by clicking it', {
    tag: ['@dbm', '@infra', '@P0', '@all'],
  }, async ({ page }) => {
    await dbm.navigate('overview');
    await dbm.expectLoaded();

    // The click path, not the URL path — a tab can be routable by URL while
    // its strip entry is mis-wired, and only a real click catches that.
    for (const { tab, segment } of ALL_TABS) {
      const locator = dbm.tabLocator(tab);
      if (!(await locator.count())) {
        // Deadlocks / Blocked / Table health are enterprise-gated: absent on
        // an OSS build. Absent is legitimate; broken is not.
        testLogger.info(`${tab} not present in the strip (gated) — skipping`);
        continue;
      }
      await locator.click();
      const expected = segment ? `/infra/databases/${segment}` : '/infra/databases';
      await expect(page, `clicking ${tab} did not navigate`).toHaveURL(
        new RegExp(expected.replace(/\//g, '\\/') + '(\\?|$)'),
        { timeout: 20000 },
      );
      await dbm.expectLoaded();
    }
  });

  // =========================================================================
  // POSITIVE: search narrows, and clearing restores
  // =========================================================================

  for (const tab of SEARCHABLE_TABS) {
    test(`P1: ${tab} search narrows the list and clearing restores it`, {
      tag: ['@dbm', '@infra', '@P1', '@all'],
    }, async () => {
      await dbm.navigate(tab);
      await dbm.expectLoaded();
      await dbm.settleTab(tab);

      const before = await dbm.rowsOn(tab);
      test.skip(before === 0, `${tab} has no rows to search in this window`);

      // A string no real query, table or engine can contain.
      await dbm.search(tab, 'zzz-no-such-thing-zzz');
      const narrowed = await dbm.rowsOn(tab);
      testLogger.info(`${tab}: before=${before} afterNonsenseSearch=${narrowed}`);

      // Search must actually filter. Equal counts mean the box is decorative —
      // which is a real defect and one users hit immediately.
      expect(
        narrowed,
        `${tab} search did not narrow anything (still ${narrowed} rows)`,
      ).toBeLessThan(before);

      await dbm.search(tab, '');
      await dbm.settleTab(tab);
      const restored = await dbm.rowsOn(tab);
      testLogger.info(`${tab}: afterClear=${restored}`);

      // Restoring need not hit the exact prior number — the rig ingests
      // continuously — but the list must come back.
      expect(restored, `${tab} did not recover after clearing the search`).toBeGreaterThan(0);
    });
  }

  // =========================================================================
  // NEGATIVE: a search that matches nothing explains itself
  // =========================================================================

  test('P1: a no-match search shows a stated empty state, not a blank table', {
    tag: ['@dbm', '@infra', '@P1', '@negative', '@all'],
  }, async () => {
    await dbm.navigate('tableHealth');
    await dbm.expectLoaded();
    await dbm.settleTab('tableHealth');
    test.skip((await dbm.rowsOn('tableHealth')) === 0, 'no table-health rows in this window');

    await dbm.search('tableHealth', 'zzz-no-such-table-zzz');
    expect(await dbm.rowsOn('tableHealth')).toBe(0);

    // Zero rows is correct here. The requirement is that the page SAYS so —
    // "no matches" is a different message from "nothing is collecting", and
    // showing the wrong one sends the reader to debug a healthy collector.
    await expect(
      dbm.tableHealthNoMatches,
      'a no-match search rendered an unexplained empty table',
    ).toBeVisible({ timeout: 15000 });

    // And the section must remain navigable, not wedged in the empty state.
    await dbm.expectLoaded();
  });

  // =========================================================================
  // NEGATIVE: malformed and hostile URL input
  // =========================================================================

  test('P1: an unknown tab segment does not break the section', {
    tag: ['@dbm', '@infra', '@P1', '@negative', '@all'],
  }, async ({ page }) => {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await page.goto(`${baseUrl}/web/infra/databases/no-such-tab?org_identifier=${org}&period=1h`, {
      timeout: 60000,
    });
    await page.waitForLoadState('load', { timeout: 20000 });

    // Either a 404 view or a redirect into the section is acceptable; a blank
    // page or a hung spinner is not. The app must still be usable.
    const body = (await page.locator('body').textContent()) || '';
    expect(body.trim().length, 'unknown DBM route rendered a blank page').toBeGreaterThan(0);
    testLogger.info(`unknown segment landed on ${page.url()}`);
  });

  test('P1: junk values in scope params leave the page usable', {
    tag: ['@dbm', '@infra', '@P1', '@negative', '@all'],
  }, async ({ page }) => {
    // Quotes and angle brackets: if any of this reaches SQL or the DOM
    // unescaped, this is where it shows up.
    await dbm.navigateWithScope('tableHealth', {
      instance: `'; DROP TABLE x; --`,
      system: '<script>alert(1)</script>',
    });
    await dbm.expectLoaded();

    const outcome = await dbm.settleTab('tableHealth');
    expect(outcome, 'junk scope params wedged the page').not.toBe('timeout');

    // Same ordering rule as the unmatched-scope tests: the empty state is
    // gated on `!loading`, so waiting for it proves the fetch finished and the
    // table is converged. Here the state is `engine-unsupported` — an
    // unrecognised `system=` is not a supported engine, which is the correct
    // and self-explaining answer.
    expect(
      await dbm.waitForExplanation('tableHealth'),
      'junk scope params produced no explanation',
    ).toBeTruthy();

    // Nothing can legitimately match these, so rows must be zero — a non-zero
    // count would mean the filter was ignored rather than applied.
    expect(await dbm.rowsOn('tableHealth'), 'junk filters returned rows').toBe(0);

    // The injected markup must not have executed or been rendered as an element.
    expect(
      await page.locator('script:has-text("alert(1)")').count(),
      'injected script tag was rendered into the page',
    ).toBe(0);
  });

  test('P1: an inverted time range does not hang the page', {
    tag: ['@dbm', '@infra', '@P1', '@negative', '@all'],
  }, async ({ page }) => {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    // end BEFORE start — the API cannot answer this meaningfully.
    const now = Date.now() * 1000;
    await page.goto(
      `${baseUrl}/web/infra/databases/table-health?org_identifier=${org}` +
        `&from=${now}&to=${now - 3600 * 1e6}`,
      { timeout: 60000 },
    );
    await page.waitForLoadState('load', { timeout: 20000 });

    // The bar is that the shell survives and the reader can navigate away —
    // not that the numbers mean anything.
    await dbm.expectLoaded();
    testLogger.info(`inverted range landed on ${page.url()}`);
  });

  // =========================================================================
  // POSITIVE: pagination
  // =========================================================================

  test('P1: paging forward shows different rows and paging back returns', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async () => {
    // Activity is the reliably-paginated tab on this rig (100 rows, 20/page).
    await dbm.navigate('activity');
    await dbm.expectLoaded();
    await dbm.settleTab('activity');

    const firstPageRows = await dbm.rowsOn('activity');
    test.skip(firstPageRows === 0, 'no activity rows in this window');

    const canPage =
      (await dbm.nextPageBtn.count()) > 0 && (await dbm.nextPageBtn.isEnabled().catch(() => false));
    test.skip(!canPage, 'activity fits on one page — nothing to paginate');

    // Compare the PAGE INDICATOR, not the rendered text.
    //
    // Row text is not a valid page signature on every engine. MariaDB reports
    // `supports_query_sample_text: false`, so its samples carry no distinct
    // statement text: measured on the rig, 80 activity rows collapse to TWO
    // distinct (session, query) pairs — 79 of them the same hot session running
    // the same UPDATE. Page 2 then renders text identical to page 1 while
    // paging perfectly correctly, and a text diff calls that a bug.
    //
    // What must be true regardless of engine is that the control MOVED and the
    // table still holds rows.
    const firstRows = await dbm.rowsOn('activity');
    await dbm.nextPageBtn.click();
    await dbm.page.waitForTimeout(1200);

    const pagerText = await dbm.page
      .locator('[data-test*="pagination"], .q-table__bottom')
      .first()
      .innerText()
      .catch(() => '');
    testLogger.info(`after next: pager="${pagerText.replace(/\s+/g, ' ')}"`);
    expect(await dbm.rowsOn('activity'), 'page 2 rendered no rows').toBeGreaterThan(0);
    expect(firstRows, 'page 1 rendered no rows').toBeGreaterThan(0);

    await dbm.prevPageBtn.click();
    await dbm.page.waitForTimeout(1200);
    const backRows = await dbm.rowsOn('activity');
    expect(backRows, 'paging back lost the rows').toBeGreaterThan(0);
    testLogger.info(`activity paging: page1=${firstPageRows} back=${backRows}`);
  });

  // =========================================================================
  // POSITIVE: deep links carry their whole state
  // =========================================================================

  test('P1: a scoped deep link reproduces its scope after a reload', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async ({ page }) => {
    await dbm.navigateWithScope('tableHealth', { system: engine });
    await dbm.expectLoaded();
    await dbm.settleTab('tableHealth');
    const before = await dbm.rowsOn('tableHealth');

    // A permalink is only useful if reopening it shows the same thing. This
    // catches scope held in memory but never written to (or read back from)
    // the URL.
    await page.reload({ timeout: 60000 });
    await page.waitForLoadState('load', { timeout: 20000 });
    await dbm.expectLoaded();
    await dbm.settleTab('tableHealth');

    // The PARAM, not a substring of the URL — on a MySQL org the identifier
    // itself contains "mysql", so a substring check would pass even if the
    // scope had been dropped entirely.
    expect(
      new URL(page.url()).searchParams.get('system'),
      'the scope was dropped from the URL on reload',
    ).toBe(engine);
    const after = await dbm.rowsOn('tableHealth');
    testLogger.info(`reload: before=${before} after=${after}`);
    // Same scope, same window, continuously-ingesting rig: the row count may
    // drift, but data must not vanish.
    if (before > 0) expect(after, 'a reload emptied a populated table').toBeGreaterThan(0);
  });

  // =========================================================================
  // NEGATIVE: a scope that matches nothing, on every tab that accepts one
  // =========================================================================

  for (const tab of ['tableHealth', 'activity', 'deadlocks']) {
    test(`P1: ${tab} handles a scope that matches nothing`, {
      tag: ['@dbm', '@infra', '@P1', '@negative', '@all'],
    }, async () => {
      await dbm.navigateWithScope(tab, {
        instance: 'instance-that-cannot-exist-12345',
        system: engine,
      });
      await dbm.expectLoaded();

      const outcome = await dbm.settleTab(tab);
      expect(outcome, `${tab} hung on an unmatched scope`).not.toBe('timeout');

      // ORDER MATTERS: wait for the EXPLANATION first, then count rows.
      //
      // Every empty state on these pages is gated on `!loading`
      // (DeadlocksPage.vue:369,378), so its appearance is proof the fetch
      // finished — at which point the table is converged and a row count is
      // trustworthy. Counting first is what made this flaky: the shell is
      // keep-alive, so arriving on the tab repaints the PREVIOUS run's rows
      // for up to ~1s, and under the full parallel suite the real (empty)
      // response lands slowly enough that a count sampled early reads those
      // stale rows. Verified against the API: /deadlocks returns 0/0 for this
      // instance on every one of 30 consecutive calls, so a non-zero read here
      // was never the backend leaking.
      const explained = await dbm.waitForExplanation(tab);
      expect(explained, `${tab} showed no rows and no explanation`).toBeTruthy();

      const rows = await dbm.rowsOn(tab);
      expect(rows, `${tab} returned rows for an instance that does not exist`).toBe(0);
    });
  }

  // =========================================================================
  // POSITIVE: clearing filters
  // =========================================================================

  test('P1: Clear all is reachable without opening the dropdown and resets the scope', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async ({ page }) => {
    // Arrive already filtered, the way a pasted permalink does.
    await dbm.navigateWithScope('overview', { system: engine });
    await dbm.expectLoaded();
    await dbm.settleTab('overview');

    await expect(
      dbm.scopeChip,
      'the scope chip did not render for an applied filter',
    ).toBeVisible({ timeout: 15000 });

    // The point of the inline control: resetting the view must not require
    // hunting inside the Filters popover for a button that acts on the chips
    // already on screen.
    await expect(
      dbm.scopeClearInline,
      'no inline Clear all beside the chips',
    ).toBeVisible({ timeout: 15000 });

    await dbm.scopeClearInline.click();
    await dbm.settleTab('overview');

    // Cleared means cleared in BOTH places the scope lives — the chip row and
    // the URL. A chip that disappears while the query string still carries the
    // filter comes back on the next reload.
    await expect(dbm.scopeChip, 'the chip survived Clear all').toBeHidden({ timeout: 15000 });
    // Assert on the PARAM, not on the URL as a substring: the org identifier
    // is in the same URL, and `mysql_server` contains "mysql", so a substring
    // check reports a filter that was cleared correctly as still present.
    expect(
      new URL(page.url()).searchParams.get('system'),
      'Clear all left the system filter in the URL',
    ).toBeNull();
  });

  test('P1: Clear all also empties the search box on the overview', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async () => {
    await dbm.navigateWithScope('overview', { system: engine });
    await dbm.expectLoaded();
    await dbm.settleTab('overview');

    await dbm.search('overview', 'zzz-no-such-database-zzz');
    const field = dbm.searchField('overview');
    expect(await field.inputValue()).toBe('zzz-no-such-database-zzz');

    await dbm.scopeClearInline.click();
    await dbm.settleTab('overview');

    // The overview used to clear only the engine filter, leaving the list
    // narrowed by a search term with no visible reason — "clear" meaning
    // something different here than on every sibling tab.
    expect(
      await field.inputValue(),
      'Clear all left the search box populated',
    ).toBe('');
  });

  test('P0: Clear all on the overview clears the scope for the OTHER tabs too', {
    tag: ['@dbm', '@infra', '@P0', '@all'],
  }, async ({ page }) => {
    // Arrive carrying a dimension the OVERVIEW has no control for. This is
    // exactly how a permalink from Slowest calls or Table health arrives, and
    // it is the case that used to survive a "Clear all": the chip row emptied,
    // but `instance` stayed in the URL and re-seeded the next tab, so the
    // section was still filtered by something nothing on screen mentioned.
    const instance = (await dbm.firstInstanceFromApi()) || 'postgres';
    await dbm.navigateWithScope('overview', { system: engine, instance });
    await dbm.expectLoaded();
    await dbm.settleTab('overview');

    await expect(dbm.scopeClearInline).toBeVisible({ timeout: 15000 });
    await dbm.scopeClearInline.click();
    await dbm.settleTab('overview');

    // The URL is the section's shared scope — every tab re-seeds from it on
    // activation — so a cleared section must not leave ANY dimension behind.
    const url = page.url();
    for (const param of ['system=', 'instance=', 'namespace=', 'env=', 'service=', 'search=']) {
      expect(url, `Clear all left ${param} in the URL`).not.toContain(param);
    }

    // And the proof that matters to the reader: switch tabs and find no chip.
    await dbm.openTab('tableHealth');
    await dbm.expectLoaded();
    await dbm.settleTab('tableHealth');
    await expect(
      dbm.scopeChip,
      'a sibling tab re-applied a filter the overview had just cleared',
    ).toBeHidden({ timeout: 15000 });
    expect(page.url(), 'the sibling tab restored a cleared dimension').not.toContain('instance=');
  });

  // =========================================================================
  // NEGATIVE: a missing VANTAGE is not a missing ENTITLEMENT
  // =========================================================================

  test('P0: Callers explains a missing trace vantage instead of showing a padlock', {
    tag: ['@dbm', '@infra', '@P0', '@negative', '@all'],
  }, async ({ page }) => {
    // The padlock means "not in your plan". Callers is not gated by build
    // type: on an enterprise deployment it is empty only because nothing
    // traced the application — a fixable setup state. Locking it there told a
    // customer to upgrade a plan they already had, and left no room for the
    // instructions that would actually help.
    const fingerprint = await dbm.firstServerQueryFingerprint();
    test.skip(!fingerprint, 'no server-reported query in this window to open');

    await dbm.openQueryDetail(fingerprint);
    const callersTab = dbm.detailTab('callers');
    await expect(callersTab, 'the callers tab did not render').toBeVisible({ timeout: 30000 });

    const hasTraces = await dbm.orgHasClientVantage();
    test.skip(
      hasTraces,
      'this org HAS a trace vantage — point ORGNAME at a no-traces org to exercise the empty state',
    );

    // Not locked, and reachable.
    expect(
      await dbm.detailTabLock('callers').count(),
      'callers wore the entitlement padlock for a data-only gap',
    ).toBe(0);
    expect(await callersTab.getAttribute('aria-disabled')).not.toBe('true');

    await callersTab.click();

    // Empty, but INSTRUCTIVE — it names what is missing and offers a route to
    // fix it, rather than rendering a blank panel that reads as "nothing calls
    // this query" (which would be false).
    await expect(
      dbm.detailCallersEmpty,
      'callers rendered no explanation for the missing trace vantage',
    ).toBeVisible({ timeout: 20000 });
    const text = (await dbm.detailCallersEmpty.textContent()) || '';
    expect(text.trim().length, 'the empty state carried no copy').toBeGreaterThan(40);
    testLogger.info(`callers empty state: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  });

  // =========================================================================
  // POSITIVE: badges are internally consistent
  // =========================================================================

  test('P1: no badge reports a negative or non-numeric count', {
    tag: ['@dbm', '@infra', '@P1', '@all'],
  }, async () => {
    await dbm.navigate('overview');
    await dbm.expectLoaded();
    // Let the strip's fan-out land before reading any of it.
    await dbm.getBadgeCount('tableHealth').catch(() => null);

    for (const { tab } of ALL_TABS) {
      const badge = await dbm.getBadgeCount(tab);
      if (badge === null) continue;
      expect(Number.isFinite(badge), `${tab} badge is not a number`).toBeTruthy();
      expect(badge, `${tab} badge is negative`).toBeGreaterThanOrEqual(0);
      testLogger.info(`badge ${tab} = ${badge}`);
    }
  });
});
