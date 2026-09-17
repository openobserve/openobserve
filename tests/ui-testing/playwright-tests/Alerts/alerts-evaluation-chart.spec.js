// Copyright 2026 OpenObserve Inc.

/**
 * Alert detail — the Evaluation chart's generated query.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The chart does not run the alert's own SQL. It REWRITES it into a bucketed
 * count/aggregate, and that rewrite is pure string surgery over SQL text
 * (web/src/utils/alerts/aggregationPreviewQuery.ts). Every bug this file guards
 * has the same shape: a SQL keyword appearing somewhere that is not a clause —
 * inside a quoted filter value, inside a function call — is mistaken for the
 * statement's own keyword, and the query is cut or spliced in the wrong place.
 *
 * openobserve#14514 was exactly that, and reached users as a raw
 * `ParserError` where a chart should have been.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The SQL the chart puts on the wire, not the pixels. A chart legitimately
 * renders "No Data" when the look-back window is quiet, so asserting on the
 * drawn series would make these tests depend on ingestion timing. A malformed
 * statement, by contrast, is always wrong — unbalanced quotes mean the backend
 * will reject it, and a filter value that changed between the alert and its
 * chart means the two are answering different questions.
 *
 * The backend generates the alert SQL and the frontend rewrites it, so the
 * whole chain is live; nothing here is mocked.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, simpleAlert, createAlert, findAlertId, deleteAlertsCascade,
  seedAlertFixturesOnce, STREAM,
} = require('../utils/alerts-api-helpers.js');

/** Quote count must stay even, or the backend hits "Unterminated string literal". */
const quotesBalanced = (sql) => (sql.match(/'/g) || []).length % 2 === 0;

/** Parens must net to zero, or the rewrite cut the statement mid-expression. */
const parensBalanced = (sql) =>
  [...sql].reduce((d, c) => d + (c === '(' ? 1 : c === ')' ? -1 : 0), 0) === 0;

/**
 * Blank the contents of quoted literals so a clause assertion cannot be fooled
 * by the literal it is meant to protect — asserting `not /HAVING/` against the
 * raw text fails on the filter value 'alerts having errors', which is precisely
 * the string the fix preserves.
 */
const withoutLiterals = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");

test.describe('Alert detail — Evaluation chart query', {
  tag: ['@alerts', '@alerts-evaluation-chart', '@P1'],
}, () => {
  let pm;
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    created = [];
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const leaked = await deleteAlertsCascade(page, created);
    if (leaked.length) {
      testLogger.error('fixture cleanup leaked alerts', { leaked, test: testInfo.title });
    }
  });

  /** Create an alert from `payload`, remember it for cleanup, return its id. */
  async function seed(page, payload) {
    const response = await createAlert(page, payload);
    expect(response.status(), 'alert creation should succeed').toBeLessThan(400);
    const id = await findAlertId(page, payload.name);
    expect(id, `alert ${payload.name} should exist after creation`).toBeTruthy();
    created.push(id);
    return id;
  }

  /** A count alert (no aggregation) whose condition is raw SQL. */
  function sqlAlert(name, sql) {
    const a = simpleAlert(name);
    a.query_condition.type = 'sql';
    a.query_condition.sql = sql;
    a.query_condition.conditions = null;
    return a;
  }

  /** A builder alert that aggregates, filtered on `value`. */
  function aggAlert(name, value, groupBy = ['city']) {
    const a = simpleAlert(name);
    a.query_condition.conditions = {
      version: 2,
      conditions: {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [{
          filterType: 'condition', column: 'city', operator: '=',
          value, logicalOperator: 'AND', ignore_case: false,
        }],
      },
    };
    a.query_condition.aggregation = {
      group_by: groupBy, function: 'count',
      having: { column: 'latency', operator: '>', value: 0 },
    };
    return a;
  }

  /** Open the alert and return the SQL its Evaluation chart put on the wire. */
  async function chartQueryFor(page, alertId) {
    const sql = await pm.alertDetailPage.captureChartQuery(
      async () => { await pm.alertDetailPage.open(alertId); },
    );
    expect(sql, 'the Evaluation chart should issue a search').toBeTruthy();
    return sql;
  }

  // ── openobserve#14514 — count path ────────────────────────────────────────
  // A keyword inside a quoted literal or a function call is not the statement's
  // own keyword. Each of these corrupted the rewritten query before the fix.
  const COUNT_CASES = [
    {
      // The projection is replaced wholesale by count(*), so the literal is
      // dropped by design — what matters is that the cut lands at the real
      // FROM and not inside the literal.
      name: 'literal containing the word from',
      sql: `SELECT 'data selected from openobserve' AS description, _timestamp FROM "${STREAM}"`,
      keep: null,
    },
    {
      name: 'FROM inside EXTRACT(EPOCH FROM now())',
      sql: `SELECT CAST(EXTRACT(EPOCH FROM now()) AS BIGINT) AS now_epoch, _timestamp FROM "${STREAM}"`,
      keep: null,
    },
    {
      name: 'WHERE literal containing order by',
      sql: `SELECT _timestamp FROM "${STREAM}" WHERE city = 'sort order by name'`,
      keep: "'sort order by name'",
    },
    {
      name: 'WHERE literal containing limit',
      sql: `SELECT _timestamp FROM "${STREAM}" WHERE city = 'rate limit exceeded'`,
      keep: "'rate limit exceeded'",
    },
  ];

  for (const c of COUNT_CASES) {
    test(`count alert: ${c.name} produces a valid chart query (#14514)`, async ({ page }) => {
      const id = await seed(page, sqlAlert(uniq('evalchart_count'), c.sql));

      const chartSql = await chartQueryFor(page, id);

      expect(quotesBalanced(chartSql), `unbalanced quotes: ${chartSql}`).toBe(true);
      expect(parensBalanced(chartSql), `unbalanced parens: ${chartSql}`).toBe(true);
      // The rewrite must anchor on the real table, never mid-expression.
      expect(chartSql).toMatch(/count\(\*\) AS zo_sql_num FROM /i);
      expect(chartSql).not.toMatch(/zo_sql_num FROM now\(\)/i);
      if (c.keep) expect(chartSql, 'filter value must reach the chart intact').toContain(c.keep);

      await pm.alertDetailPage.expectNoChartError();
    });
  }

  // ── openobserve#14526 — aggregation path ──────────────────────────────────
  // Same class of bug, reached through the Builder rather than raw SQL: the
  // filter value is user text and can contain any of these words.
  const AGG_VALUES = ['alerts having errors', 'group by service', 'sort order by name'];

  for (const value of AGG_VALUES) {
    test(`aggregation alert: filter value "${value}" survives the rewrite (#14526)`, async ({ page }) => {
      const id = await seed(page, aggAlert(uniq('evalchart_agg'), value));

      const chartSql = await chartQueryFor(page, id);

      expect(quotesBalanced(chartSql), `unbalanced quotes: ${chartSql}`).toBe(true);
      expect(chartSql, 'filter value must reach the chart intact').toContain(`'${value}'`);
      // HAVING is dropped so healthy groups stay on the chart; a recovery must
      // not look identical to a series that ended. Checked with literals blanked
      // so the filter value's own words cannot masquerade as the clause.
      expect(withoutLiterals(chartSql)).not.toMatch(/\sHAVING\s/i);

      await pm.alertDetailPage.expectNoChartError();
    });
  }

  test('aggregation alert: two group-by columns collapse into one labelled series (#14526)', async ({ page }) => {
    const id = await seed(page, aggAlert(uniq('evalchart_multi'), 'sort order by name', ['city', 'status']));

    const chartSql = await chartQueryFor(page, id);

    expect(quotesBalanced(chartSql), `unbalanced quotes: ${chartSql}`).toBe(true);
    expect(chartSql).toContain("'sort order by name'");
    // Two group-by columns are ONE group, so the series carries the whole
    // combination as its name.
    expect(chartSql).toContain('zo_group_label');

    await pm.alertDetailPage.expectNoChartError();
  });

  // ── Known-open defects ────────────────────────────────────────────────────
  // Skipped, not deleted: each asserts the behaviour the fix must produce, so
  // un-skipping is the whole verification step when the issue is closed.

  // o2-enterprise#2631: the chart's alias renames run over the raw query text,
  // so a filter value containing one of those internal names is rewritten
  // inside the user's own literal. The resulting SQL is still valid, so it
  // returns 200 and the chart silently answers a different question.
  test.skip('aggregation alert: a filter value naming an internal column is not rewritten (o2-enterprise#2631)', async ({ page }) => {
    const value = 'value zo_sql_val here';
    const id = await seed(page, aggAlert(uniq('evalchart_alias'), value));

    const chartSql = await chartQueryFor(page, id);

    expect(chartSql, 'the chart must filter on what the user typed').toContain(`'${value}'`);
  });

  // o2-enterprise#2635: SQL comments are not masked, so a comment mentioning
  // "from" is mistaken for the statement's real FROM.
  test.skip('count alert: a comment mentioning from does not corrupt the query (o2-enterprise#2635)', async ({ page }) => {
    const id = await seed(page, sqlAlert(
      uniq('evalchart_comment'),
      `SELECT _timestamp -- pick the from column\nFROM "${STREAM}"`,
    ));

    const chartSql = await chartQueryFor(page, id);

    // Exact shape, because a looser assertion passes on the corrupted output:
    // the comment's tail leaks in as `zo_sql_num from column\nFROM "<stream>"`,
    // which still "contains" the stream and still balances its parens.
    expect(chartSql).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num ' +
      `FROM "${STREAM}" GROUP BY zo_sql_key`,
    );
    await pm.alertDetailPage.expectNoChartError();
  });
});
