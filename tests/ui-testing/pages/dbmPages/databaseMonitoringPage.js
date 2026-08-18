// databaseMonitoringPage.js
// Page object for the Database Monitoring (DBM) section under Infra.
//
// Selectors verified against:
//   web/src/components/dbm/DbmSectionTabs.vue     (tab strip + badges)
//   web/src/components/dbm/DbmScopeFilters.vue    (scope chips — see note below)
//   web/src/views/DatabaseMonitoring/*.vue        (per-tab tables/empty states)
//
// Strict selector policy:
//   - data-test only (no element/class/text/role/label locators)
//   - All locators live in the constructor as class members
//
// TWO NAMING TRAPS this object exists to hide from the specs:
//
//   1. The scope-filter data-tests are hardcoded `dbm-queries-*` in
//      DbmScopeFilters.vue, on EVERY tab — Table health's instance chip is
//      still `dbm-queries-scope-chip-instance`. Not a bug, just a shared
//      component that never parameterised its prefix.
//
//   2. The chip the UI LABELS "database" is the `instance` dimension
//      (`dbm.filters.dimension.instance` => "database" in en-US.json). The
//      database a statement ran in is `namespace`. Specs use the dimension
//      keys; only the rendered label says "database".

import { expect } from '@playwright/test';

/** Section keys used by DbmSectionTabs for tab + badge data-tests. */
export const DBM_TABS = {
  overview: 'overview',
  queries: 'queries',
  samples: 'samples',
  activity: 'activity',
  deadlocks: 'deadlocks',
  blocked: 'blocked',
  tableHealth: 'tableHealth',
};

/** Route segments under /web/infra/databases (overview is the index route). */
const TAB_PATHS = {
  overview: '',
  queries: 'queries',
  samples: 'samples',
  activity: 'activity',
  deadlocks: 'deadlocks',
  blocked: 'blocking',
  tableHealth: 'table-health',
};

export class DatabaseMonitoringPage {
  constructor(page) {
    this.page = page;

    // =====================================================================
    // Tab strip
    // =====================================================================
    this.sectionTabs = page.locator('[data-test="dbm-section-tabs"]');

    // =====================================================================
    // Scope filters (shared component -> `dbm-queries-*` on every tab)
    // =====================================================================
    this.scope = page.locator('[data-test="dbm-queries-scope"]');
    this.scopeTrigger = page.locator('[data-test="dbm-queries-scope-trigger"]');
    this.scopeCount = page.locator('[data-test="dbm-queries-scope-count"]');
    // Inside the Filters popover (only reachable once it is open).
    this.scopeClear = page.locator('[data-test="dbm-queries-scope-clear"]');
    // Beside the chips, always visible while a filter is set.
    this.scopeClearInline = page.locator('[data-test="dbm-queries-scope-clear-inline"]');
    // Any active scope chip, whichever dimension it is for.
    this.scopeChip = page.locator('[data-test^="dbm-queries-scope-chip-"]').first();
    this.instanceChip = page.locator('[data-test="dbm-queries-scope-chip-instance"]');
    this.instanceChipRemove = page.locator(
      '[data-test="dbm-queries-scope-chip-instance-remove"]',
    );
    this.systemChip = page.locator('[data-test="dbm-queries-scope-chip-system"]');

    // =====================================================================
    // Per-tab tables and empty states
    // =====================================================================
    this.samplesTable = page.locator('[data-test="dbm-samples-table"]');
    this.samplesNoMatches = page.locator('[data-test="dbm-samples-no-matches"]');
    this.samplesLogOff = page.locator('[data-test="dbm-samples-log-off"]');
    // The database-reported fallback list, rendered under its own heading when
    // the client (trace) list is empty. On a no-traces rig this is the ONLY
    // thing Slowest calls can show, so a spec that only checked the client
    // table would call a healthy page broken.
    this.serverSamplesSection = page.locator('[data-test="dbm-server-samples-section"]');
    this.serverSamplesTable = page.locator('[data-test="dbm-server-samples-table"]');

    this.tableHealthTable = page.locator('[data-test="dbm-table-health-table"]');
    this.tableHealthNotCollecting = page.locator('[data-test="dbm-table-health-not-collecting"]');
    this.tableHealthNoMatches = page.locator('[data-test="dbm-table-health-no-matches"]');
    // "This engine does not report table stats" — the state an unrecognised
    // `system=` lands in. A legitimate, self-explaining empty result, so it
    // belongs in the settle set: omitting it made the junk-params test read a
    // correctly-behaving page as wedged.
    this.tableHealthEngineUnsupported = page.locator(
      '[data-test="dbm-table-health-engine-unsupported"]',
    );
    this.tableHealthSearch = page.locator('[data-test="dbm-table-health-search"]');

    this.activityTable = page.locator('[data-test="dbm-activity-table"]');
    this.activityNotCollecting = page.locator('[data-test="dbm-activity-not-collecting"]');
    this.activityHealthy = page.locator('[data-test="dbm-activity-healthy"]');
    this.activityNoMatches = page.locator('[data-test="dbm-activity-no-matches"]');

    this.deadlocksTable = page.locator('[data-test="dbm-deadlocks-table"]');
    this.deadlocksNotCollecting = page.locator('[data-test="dbm-deadlocks-not-collecting"]');
    this.deadlocksHealthy = page.locator('[data-test="dbm-deadlocks-healthy"]');
    this.deadlocksSearch = page.locator('[data-test="dbm-deadlocks-search"]');

    this.blockedTable = page.locator('[data-test="dbm-blocked-table"]');
    this.blockedNotCollecting = page.locator('[data-test="dbm-blocked-not-collecting"]');
    this.blockedHealthy = page.locator('[data-test="dbm-blocked-healthy"]');

    // Query detail — the Callers panel's instructive empty state.
    this.detailCallersEmpty = page.locator('[data-test="dbm-detail-callers-empty"]');

    this.queriesTable = page.locator('[data-test="dbm-queries-table"]');
    this.serverQueriesTable = page.locator('[data-test="dbm-server-queries-table"]');

    this.databasesTable = page.locator('[data-test="dbm-databases-table"]');
    this.databasesNoTraffic = page.locator('[data-test="dbm-databases-no-traffic"]');

    // =====================================================================
    // OTable pagination — shared by every DBM table
    // =====================================================================
    this.nextPageBtn = page.locator('[data-test="o2-table-next-page-btn"]');
    this.prevPageBtn = page.locator('[data-test="o2-table-prev-page-btn"]');
    this.firstPageBtn = page.locator('[data-test="o2-table-first-page-btn"]');
    this.paginationInfo = page.locator('[data-test="o2-table-pagination-info"]');
  }

  /**
   * A page's search box. OInput forwards the consumer's data-test to its
   * wrapper and puts `-field` on the real <input>, so typing must target the
   * inner one — filling the wrapper silently does nothing.
   */
  searchField(tab) {
    const map = {
      samples: 'dbm-samples-search',
      tableHealth: 'dbm-table-health-search',
      activity: 'dbm-activity-search',
      deadlocks: 'dbm-deadlocks-search',
      blocked: 'dbm-blocked-search',
      queries: 'dbm-queries-search',
      overview: 'dbm-databases-search',
    };
    return this.page.locator(`[data-test="${map[tab]}-field"]`);
  }

  /**
   * Type into a tab's search box and wait for the result to actually land.
   *
   * Two different mechanisms hide behind one box, and a fixed sleep is wrong
   * for the slower one:
   *   - table health / activity filter the LOADED rows in the browser, so the
   *     400ms input debounce is the whole wait;
   *   - deadlocks and blocked re-QUERY the server (`@search="load"`), so the
   *     debounce is followed by a round trip.
   * Sleeping ~900ms covered the first and raced the second, which surfaced as
   * "deadlocks search did not narrow anything" — a test artefact, not a
   * product defect (the API filters 50 -> 0 correctly). So: wait for the row
   * count to stop changing, with a floor for the debounce.
   */
  async search(tab, text) {
    const field = this.searchField(tab);
    await field.fill(text);
    // Cover the input debounce before sampling anything.
    await this.page.waitForTimeout(600);

    const table = this.tabSpec(tab).table;
    let last = -1;
    let stable = 0;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const rows = await this.getRowCount(table);
      if (rows === last) {
        if (++stable >= 3) return rows;
      } else {
        stable = 0;
      }
      last = rows;
      await this.page.waitForTimeout(300);
    }
    return last;
  }

  // =======================================================================
  // Navigation
  // =======================================================================

  /**
   * Go straight to a DBM tab by URL.
   *
   * `org` defaults to ORGNAME so the suite can point at whichever org actually
   * holds collector data — on the dev rig that is `pg_server`, not `default`,
   * and against an empty org every assertion here would pass vacuously.
   */
  async navigate(tab = 'overview', { period = '1h', org, query = {} } = {}) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const segment = TAB_PATHS[tab] ?? '';
    const params = new URLSearchParams({ org_identifier: orgId, period, ...query });
    await this.page.goto(
      `${baseUrl}/web/infra/databases${segment ? `/${segment}` : ''}?${params}`,
      { timeout: 60000 },
    );
    // `load`, never `networkidle` — the SPA holds sockets open and networkidle
    // simply times out (same reason the traces page objects avoid it).
    await this.page.waitForLoadState('load', { timeout: 20000 });
    await this.sectionTabs.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  }

  /** Click a tab in the strip — the path a reader actually takes. */
  async openTab(key) {
    await this.tabLocator(key).click();
    await this.page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  }

  tabLocator(key) {
    return this.page.locator(`[data-test="dbm-section-tab-${key}"]`);
  }

  badgeLocator(key) {
    return this.page.locator(`[data-test="dbm-section-tab-badge-${key}"]`);
  }

  // =======================================================================
  // Badges
  // =======================================================================

  /**
   * The numeric badge on a tab, or null when the tab genuinely carries none.
   *
   * Returns a NUMBER so a spec can compare it against rendered row counts.
   * The badge text carries a truncation marker ("50+") and a vantage qualifier
   * ("50+server count"), so the DIGITS are extracted rather than the string
   * parsed — `Number("50+server count")` is NaN, and a NaN comparison passes
   * nothing while looking like it ran.
   *
   * WAITS for the badge before giving up. The strip fills from its own async
   * fan-out (`/badges`), independent of the page's read, so a badge queried on
   * arrival is reliably absent for a beat. Reading that as "this tab has no
   * badge" is how a reconciliation test passes without ever comparing anything
   * — which is exactly what this helper did on its first run.
   */
  async getBadgeCount(key, { timeout = 20000 } = {}) {
    const badge = this.badgeLocator(key);
    await badge.waitFor({ state: 'visible', timeout }).catch(() => {});
    if (!(await badge.count())) return null;
    if (!(await badge.isVisible().catch(() => false))) return null;
    const text = (await badge.textContent()) || '';
    const digits = text.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
  }

  /** Whether a badge discloses truncation ("50+" rather than an exact count). */
  async isBadgeTruncated(key) {
    const badge = this.badgeLocator(key);
    if (!(await badge.count())) return false;
    return ((await badge.textContent()) || '').includes('+');
  }

  // =======================================================================
  // Rows
  // =======================================================================

  /**
   * Rendered data rows in an OTable, excluding its header row.
   *
   * OTable renders `<tr>` for the header too, so a bare `tr` count is always
   * one too many — and on an empty table it returns 1, which reads as "a row
   * rendered" and would mask exactly the badge-vs-table disagreement these
   * specs exist to catch.
   */
  async getRowCount(tableLocator) {
    if (!(await tableLocator.count())) return 0;
    if (!(await tableLocator.isVisible().catch(() => false))) return 0;
    return tableLocator.locator('tbody tr').count();
  }

  // =======================================================================
  // Scope filters
  // =======================================================================

  /** The instance chip's rendered text ("" when no instance filter is set). */
  async getInstanceChipText() {
    if (!(await this.instanceChip.count())) return '';
    if (!(await this.instanceChip.isVisible().catch(() => false))) return '';
    return ((await this.instanceChip.textContent()) || '').trim();
  }

  /**
   * Apply a scope filter through the URL rather than the dropdown.
   *
   * Deliberate: the dropdown only offers values the CURRENTLY LOADED rows
   * mention, so a spec driving it can only ever pick a value that already
   * works — it could never reproduce the "filter matches nothing" bug. A URL
   * carries any value, which is also how a pasted permalink arrives.
   */
  async navigateWithScope(tab, scope, options = {}) {
    await this.navigate(tab, { ...options, query: { ...(options.query || {}), ...scope } });
  }

  /**
   * The `instance` value the table-health feed actually carries, or '' when
   * nothing is reporting.
   *
   * Read through the page's own session (`page.request` inherits its cookies),
   * so this needs no separate credentials and asks the API exactly what the
   * tab asks. Used to drive the instance-filter test with a REAL value — the
   * Instance column renders no data-test, and picking the value by text or
   * position would violate the selector policy and break on re-ordering.
   */
  async firstInstanceFromApi({ periodSeconds = 3600 } = {}) {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const now = Date.now() * 1000;
    const url =
      `${baseUrl}/api/${org}/traces/db_monitoring/table_health` +
      `?start_time=${now - periodSeconds * 1e6}&end_time=${now}`;
    // Basic auth explicitly: OpenObserve authenticates API calls with an
    // Authorization header the SPA holds in local storage, NOT with a cookie,
    // so `page.request` inherits nothing usable and every probe came back
    // unauthorized — which surfaced as this test silently skipping rather than
    // running. Same credentials the suite already logs in with.
    const email = process.env['ZO_ROOT_USER_EMAIL'] || '';
    const password = process.env['ZO_ROOT_USER_PASSWORD'] || '';
    const auth = Buffer.from(`${email}:${password}`).toString('base64');
    // Retry: this backend intermittently returns a search error under ingest
    // load (observed as EMFILE — "Too many open files" — while thousands of
    // tiny WAL parquet files were open). A single failed probe made the
    // instance-filter test SKIP, which silently removed the coverage instead
    // of reporting a problem, so a transient error must not be read as
    // "this deployment has no instances".
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.page.request.get(url, {
          timeout: 30000,
          headers: { Authorization: `Basic ${auth}` },
        });
        if (res.ok()) {
          const body = await res.json();
          const hit = (body.hits || []).find((h) => h && h.instance);
          if (hit) return String(hit.instance);
          // A well-formed empty answer is a real answer — this org simply has
          // no table-health rows. Don't burn retries on it.
          if (Array.isArray(body.hits)) return '';
        }
      } catch {
        // fall through to the retry
      }
      await this.page.waitForTimeout(1500);
    }
    return '';
  }

  // =======================================================================
  // Waiting
  // =======================================================================

  /**
   * Settle a tab: spinner gone, and either rows or a declared empty state.
   *
   * Both halves matter. Waiting only for the table races the fetch (the table
   * element mounts with zero rows while data is still in flight, so an
   * assertion can read 0 from a page that is merely slow), and waiting only
   * for rows hangs forever on a legitimately empty tab.
   */
  async waitForSettled(tableLocator, emptyLocators = [], timeout = 30000) {
    const deadline = Date.now() + timeout;
    let lastCount = -1;
    let stableFor = 0;

    // A typo'd or missing locator arrives here as `undefined` and would be
    // skipped silently, turning "this empty state never appears" into a
    // timeout blamed on the product. Fail loudly on the mapping instead.
    if (!tableLocator) throw new Error('waitForSettled: tableLocator is undefined');
    emptyLocators.forEach((l, i) => {
      if (!l) throw new Error(`waitForSettled: emptyLocators[${i}] is undefined`);
    });

    const anyEmptyStateVisible = async () => {
      for (const empty of emptyLocators) {
        if (await empty.isVisible().catch(() => false)) return true;
      }
      return false;
    };

    // A page still fetching has zero rows AND no empty state. Polling for a
    // "stable" count from the start treats that as settled-at-zero within
    // ~1.2s and reports an empty tab that renders 5 rows a moment later
    // (measured). So: resolve FIRST — wait for either rows or a declared empty
    // state to exist at all — and only then wait for the count to stop moving.
    //
    // The empty state is checked BEFORE the row count, and again inside the
    // stabilise loop below. The shell is keep-alive (`DbmShell.vue` wraps the
    // pages in <keep-alive>), so arriving on a tab repaints the PREVIOUS run's
    // rows for up to ~1s before the new response lands and clears them. An
    // earlier version broke out of this loop the moment rows appeared, then
    // entered a stabilise loop that could only ever return 'rows' or
    // 'timeout' — so a scope matching nothing, whose stale rows happened to
    // hold a constant count across 3 polls, settled as 'rows' and the caller
    // read a non-zero count off a table that was about to empty. That is the
    // "passes alone, fails in the full parallel suite" signature: under load
    // the real response is slower, so the stale window outlasts the 1.2s
    // stability threshold.
    while (Date.now() < deadline) {
      if (await anyEmptyStateVisible()) return 'empty';
      if ((await this.getRowCount(tableLocator)) > 0) break;
      await this.page.waitForTimeout(400);
    }
    if (Date.now() >= deadline) {
      return (await anyEmptyStateVisible()) ? 'empty' : 'timeout';
    }

    // Rows exist; now let the count settle. Still watching for the empty
    // state: these rows may be the outgoing tab's, and the incoming answer may
    // be an empty one.
    while (Date.now() < deadline) {
      if (await anyEmptyStateVisible()) return 'empty';
      const rows = await this.getRowCount(tableLocator);
      if (rows === 0) {
        // Rows vanished — the stale paint decayed. Go back to waiting for the
        // real answer rather than reporting the count we happened to catch.
        stableFor = 0;
        lastCount = 0;
        await this.page.waitForTimeout(400);
        continue;
      }
      if (rows === lastCount) {
        if (++stableFor >= 3) return 'rows';
      } else {
        stableFor = 0;
      }
      lastCount = rows;
      await this.page.waitForTimeout(400);
    }
    return lastCount > 0 ? 'rows' : (await anyEmptyStateVisible()) ? 'empty' : 'timeout';
  }

  /**
   * Settle a tab, then read badge and rows TOGETHER.
   *
   * The two come from independent async reads, so sampling them at different
   * moments compares a fresh badge against a stale table (or vice versa) and
   * reports a disagreement the UI never actually showed. Everything a
   * reconciliation spec needs is captured here, after the table stops moving.
   */
  async readBadgeAndRows(key, tableLocator, emptyLocators = [], timeout = 30000) {
    const outcome = await this.waitForSettled(tableLocator, emptyLocators, timeout);
    const badge = await this.getBadgeCount(key);
    // Re-read rows AFTER the badge wait: that wait can span a re-render, and a
    // count taken before it would no longer describe what is on screen.
    const rows = await this.getRowCount(tableLocator);
    const truncated = await this.isBadgeTruncated(key);
    return { outcome, badge, rows, truncated };
  }

  /** Assert the tab strip mounted — the shell rendered at all. */
  async expectLoaded() {
    await expect(this.sectionTabs).toBeVisible({ timeout: 30000 });
  }

  /**
   * Everything a generic test needs about one tab: its table, the empty states
   * it is allowed to show, and the badge key.
   *
   * Each tab declares DIFFERENT empty states, and passing the wrong ones makes
   * `waitForSettled` poll for an element that can never appear — so a
   * legitimately empty tab times out and reports a failure the product does
   * not have. Keeping the mapping in one place is what stops each spec from
   * re-deriving it (and getting it wrong).
   */
  tabSpec(tab) {
    const specs = {
      overview: {
        key: 'overview',
        table: this.databasesTable,
        empties: [this.databasesNoTraffic],
      },
      queries: {
        key: 'queries',
        table: this.queriesTable,
        // Zero-trace deployments answer here with the DATABASE-reported list,
        // so the server table is a legitimate "loaded" state, not an empty one.
        empties: [this.serverQueriesTable],
      },
      samples: {
        key: 'samples',
        table: this.samplesTable,
        empties: [this.samplesNoMatches, this.samplesLogOff, this.serverSamplesSection],
      },
      activity: {
        key: 'activity',
        table: this.activityTable,
        empties: [this.activityNotCollecting, this.activityHealthy, this.activityNoMatches],
      },
      deadlocks: {
        key: 'deadlocks',
        table: this.deadlocksTable,
        empties: [this.deadlocksNotCollecting, this.deadlocksHealthy],
      },
      blocked: {
        key: 'blocked',
        table: this.blockedTable,
        empties: [this.blockedNotCollecting, this.blockedHealthy],
      },
      tableHealth: {
        key: 'tableHealth',
        table: this.tableHealthTable,
        empties: [
          this.tableHealthNotCollecting,
          this.tableHealthNoMatches,
          this.tableHealthEngineUnsupported,
        ],
      },
    };
    return specs[tab];
  }

  /** Settle whichever table the named tab owns. */
  async settleTab(tab, timeout = 30000) {
    const spec = this.tabSpec(tab);
    return this.waitForSettled(spec.table, spec.empties, timeout);
  }

  /** Rows currently rendered on the named tab. */
  async rowsOn(tab) {
    return this.getRowCount(this.tabSpec(tab).table);
  }

  // =======================================================================
  // Query detail page
  // =======================================================================

  /** One of the detail page's three tabs (overview / plans / callers). */
  detailTab(key) {
    return this.page.locator(`[data-test="dbm-detail-tab-${key}"]`);
  }

  /** The entitlement padlock on a detail tab — must be absent for a data gap. */
  detailTabLock(key) {
    return this.page.locator(`[data-test="dbm-detail-tab-lock-${key}"]`);
  }

  /** Open the detail page for one statement. */
  async openQueryDetail(fingerprint, { period = '1h', org, system = 'postgresql' } = {}) {
    const orgId = org || process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const params = new URLSearchParams({
      org_identifier: orgId,
      period,
      fingerprint,
      system,
    });
    await this.page.goto(`${baseUrl}/web/infra/databases/query?${params}`, { timeout: 60000 });
    await this.page.waitForLoadState('load', { timeout: 20000 });
    await this.page.waitForTimeout(2500);
  }

  /** A fingerprint the DATABASE reported — available with or without traces. */
  async firstServerQueryFingerprint({ periodSeconds = 3600 } = {}) {
    const body = await this.dbmApi('server_queries', periodSeconds);
    const hit = (body?.hits || []).find((h) => h && h.fingerprint);
    return hit ? String(hit.fingerprint) : '';
  }

  /**
   * Whether this org has a CLIENT (trace) vantage at all.
   *
   * The Callers empty state only exists on a deployment with no traces, so a
   * test asserting it must skip rather than fail on a traced org — otherwise
   * the same suite reports a defect purely because it was pointed at the
   * `pgcs` lane instead of the `pg` one.
   */
  async orgHasClientVantage({ periodSeconds = 3600 } = {}) {
    const body = await this.dbmApi('badges', periodSeconds);
    const queries = body?.queries || {};
    return Boolean((queries.hits || []).length) || Number(queries.total) > 0;
  }

  /**
   * The instance AND engine this org's table-health rows actually carry.
   *
   * Both come from the data. Hardcoding the engine is what made the suite
   * engine-specific: a test pinned to `system: 'postgresql'` sends
   * `instance=my-prod-1&system=postgresql` against a MySQL org, which
   * correctly matches nothing — and then reports a healthy page as "filtering
   * emptied a populated table", i.e. it manufactures the exact defect the test
   * exists to catch.
   */
  async firstScopeFromApi({ periodSeconds = 3600 } = {}) {
    const body = await this.dbmApi('table_health', periodSeconds, { system: null });
    const hit = (body?.hits || []).find((h) => h && h.instance);
    return {
      instance: hit ? String(hit.instance) : '',
      engine: hit?.engine ? String(hit.engine) : '',
    };
  }

  /**
   * The NAMESPACE (the database a statement ran in) this org's data carries.
   *
   * Distinct from `instance`, and the distinction is the whole reason the DBM
   * filters confuse people: the chip the UI labels "database" is the INSTANCE
   * dimension, while the actual database is `namespace`. A matrix test has to
   * exercise both, with real values, or it proves nothing about either.
   *
   * Read from the deadlocks feed, which names a database per event.
   */
  async firstNamespaceFromApi({ periodSeconds = 3600 } = {}) {
    const body = await this.dbmApi('deadlocks', periodSeconds, { system: null });
    const hit = (body?.hits || []).find((h) => h && h.db_namespace);
    return hit ? String(hit.db_namespace) : '';
  }

  /**
   * How many rows an endpoint returns under a scope, straight from the API.
   *
   * The matrix test compares the UI against this rather than against a pinned
   * number: the rigs ingest continuously, so any hardcoded count is stale
   * before the run finishes. `null` means the read failed — the caller must
   * treat that as unknown, never as zero, or a broken backend reads as a
   * correctly-empty tab.
   */
  async apiCount(endpoint, params = {}, { periodSeconds = 3600 } = {}) {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const now = Date.now() * 1000;
    const qs = new URLSearchParams({
      start_time: String(now - periodSeconds * 1e6),
      end_time: String(now),
      ...Object.fromEntries(Object.entries(params).filter(([, v]) => v)),
    });
    const auth = Buffer.from(
      `${process.env['ZO_ROOT_USER_EMAIL'] || ''}:${process.env['ZO_ROOT_USER_PASSWORD'] || ''}`,
    ).toString('base64');
    try {
      const res = await this.page.request.get(
        `${baseUrl}/api/${org}/traces/db_monitoring/${endpoint}?${qs}`,
        { timeout: 30000, headers: { Authorization: `Basic ${auth}` } },
      );
      if (!res.ok()) return null;
      const body = await res.json();
      if (typeof body.total === 'number') return body.total;
      return Array.isArray(body.hits) ? body.hits.length : null;
    } catch {
      return null;
    }
  }

  /**
   * Shared reader for the DBM endpoints, with the suite's own credentials.
   *
   * `system` defaults to postgresql for callers that want it, but passing
   * `{ system: null }` omits the filter entirely — required when the point of
   * the call is to DISCOVER which engine this org holds.
   */
  async dbmApi(endpoint, periodSeconds = 3600, { system = 'postgresql' } = {}) {
    const org = process.env['ORGNAME'] || 'default';
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const now = Date.now() * 1000;
    const auth = Buffer.from(
      `${process.env['ZO_ROOT_USER_EMAIL'] || ''}:${process.env['ZO_ROOT_USER_PASSWORD'] || ''}`,
    ).toString('base64');
    const url =
      `${baseUrl}/api/${org}/traces/db_monitoring/${endpoint}` +
      `?start_time=${now - periodSeconds * 1e6}&end_time=${now}` +
      (system ? `&system=${encodeURIComponent(system)}` : '');
    try {
      const res = await this.page.request.get(url, {
        timeout: 30000,
        headers: { Authorization: `Basic ${auth}` },
      });
      return res.ok() ? await res.json() : null;
    } catch {
      return null;
    }
  }

  /**
   * Wait for a tab to EXPLAIN an empty result — any of its declared empty
   * states becoming visible.
   *
   * Polls rather than sampling once, because these empty states are gated on
   * `!loading`: mid-fetch a page truthfully has no rows and no explanation,
   * and a single read there condemns a page that is about to render the right
   * message. Returns false only if nothing explains the emptiness within the
   * timeout — which IS the defect worth reporting.
   */
  async waitForExplanation(tab, timeout = 15000) {
    const { empties } = this.tabSpec(tab);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const empty of empties) {
        if (await empty.isVisible().catch(() => false)) return true;
      }
      await this.page.waitForTimeout(400);
    }
    return false;
  }
}

export default DatabaseMonitoringPage;
