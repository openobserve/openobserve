// Copyright 2026 OpenObserve Inc.

/**
 * Composite alerts — detail view and status timeline (plan areas G and H).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The detail page answers "why is this firing?", and the honest answer often
 * depends on state the expression does not show: a child whose freshness
 * deadline expired, one that errored on its last run, or a composite that is
 * enabled but has no scheduler job behind it and so will never evaluate at all.
 *
 * The missing-job banner is the sharpest of those — an enabled composite with
 * no job is silently dead, and this banner is the only place that is ever said.
 *
 * MOCKING POLICY
 * --------------
 * Structure (children, links, config read-back) is driven live. Only states a
 * fixture cannot reach on demand — stale reasons, evaluation errors, a missing
 * scheduler job, an unreadable child — are injected by rewriting the detail
 * response. The contracts behind them are asserted live in
 * alerts-composite-api.spec.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const {
  uniq, compositeAlert, createAlert, findAlertId, createChildAlerts,
  deleteAlertsCascade, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

test.describe('Composite alerts — detail', {
  tag: ['@alerts', '@alerts-composite', '@P0'],
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

  test.afterEach(async ({ page }) => {
    await deleteAlertsCascade(page, created);
  });

  /**
   * Two children plus a composite over them.
   *
   * `conditionOverrides` is merged INTO the generated composite_condition rather
   * than replacing it — replacing drops the expression the helper built from the
   * child ids, and the API rejects an empty one.
   */
  async function seedComposite(page, prefix, conditionOverrides = {}) {
    const [a, b] = await createChildAlerts(page, prefix, 2);
    created.push(a.id, b.id);
    const name = uniq(`${prefix}_parent`);
    const payload = compositeAlert(name, [a.id, b.id]);
    payload.composite_condition = { ...payload.composite_condition, ...conditionOverrides };
    const response = await createAlert(page, payload);
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, name);
    created.push(id);
    return { a, b, parent: { id, name } };
  }

  /**
   * Rewrite the composite's own detail response before the page reads it.
   *
   * Matched by regex, not glob: `get_by_alert_id` appends `?folder=` only when a
   * folder is passed, so a pattern requiring the query string silently misses
   * the request and the test then asserts against unpatched live data. The
   * `(\?|$)` anchor also keeps this off sibling paths like /composite-timeline.
   */
  async function patchDetail(page, id, mutate) {
    let patched = 0;
    await page.route(new RegExp(`/api/v2/[^/]+/alerts/${id}(\\?|$)`), async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      mutate(body);
      patched += 1;
      await route.fulfill({ response, json: body });
    });
    return () => patched;
  }

  // ===================== G · detail view =====================

  test('G1/G3 · children render as lettered cards and the config reads back', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'g1');

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.detail()).toBeVisible();
    await expect(pm.compositeAlertsPage.detailChild(a.id)).toContainText('A');
    await expect(pm.compositeAlertsPage.detailChild(a.id)).toContainText(a.name);
    await expect(pm.compositeAlertsPage.detailChild(b.id)).toContainText('B');
    await expect(pm.compositeAlertsPage.detailExpressionLive()).toBeVisible();

    // The config block resolves ids back to names — the list never does this.
    await expect(pm.compositeAlertsPage.detailExpression()).toContainText(a.name);
    await expect(pm.compositeAlertsPage.detailExpression()).toContainText(b.name);
  });

  test('G2 · a child link points at that child, carrying its folder', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'g2');

    await pm.compositeAlertsPage.openDetail(parent.id);

    const link = pm.compositeAlertsPage.detailChildLink(a.id);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', new RegExp(`/alerts/detail/${a.id}\\?folder=`));
  });

  test('G4 · the stale policy the composite was saved with reads back', async ({ page }) => {
    const { parent } = await seedComposite(page, 'g4', {
      warning_counts_as_firing: false,
      stale_child_policy: 'treat_as_false',
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.detailConfig()).toBeVisible();
    await expect(pm.compositeAlertsPage.detailStalePolicy()).toContainText('treat_as_false');
  });

  test('G5 · an enabled composite with no scheduler job is called out', async ({ page }) => {
    const { parent } = await seedComposite(page, 'g5');
    const patches = await patchDetail(page, parent.id, (body) => {
      body.enabled = true;
      body.scheduler_job_present = false;
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.missingJob()).toBeVisible();
    expect(patches(), 'detail response was never patched').toBeGreaterThan(0);
  });

  test('G5b · a disabled composite is not accused of a missing job', async ({ page }) => {
    const { parent } = await seedComposite(page, 'g5b');
    const patches = await patchDetail(page, parent.id, (body) => {
      body.enabled = false;
      body.scheduler_job_present = false;
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    // A paused composite has no job on purpose; warning about it is noise.
    await expect(pm.compositeAlertsPage.detail()).toBeVisible();
    await expect(pm.compositeAlertsPage.missingJob()).toHaveCount(0);
    // Without this the assertion above also passes when the route never fired.
    expect(patches(), 'detail response was never patched').toBeGreaterThan(0);
  });

  test('G6 · an expired freshness deadline is named on the child card', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'g6');
    const patches = await patchDetail(page, parent.id, (body) => {
      body.children[0] = {
        ...body.children[0],
        level: 'critical',
        last_outcome: 'firing',
        stale: true,
        truth: true,
        stale_reason: 'freshness_expired',
        policy_decision: 'used_last_state',
      };
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.detailStaleReason(a.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.detailChild(a.id)).toContainText(/stale|fresh/i);
    expect(patches(), 'detail response was never patched').toBeGreaterThan(0);
  });

  test('G8 · an unreadable child degrades to its id instead of crashing', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'g8');
    const patches = await patchDetail(page, parent.id, (body) => {
      body.children[0] = { alert_id: a.id, accessible: false };
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    // The page must still render: the readable sibling and the config survive.
    await expect(pm.compositeAlertsPage.detail()).toBeVisible();
    await expect(pm.compositeAlertsPage.detailChild(a.id)).toContainText(a.id);
    await expect(pm.compositeAlertsPage.detailChildLink(a.id)).toHaveCount(0);
    await expect(pm.compositeAlertsPage.detailChild(b.id)).toContainText(b.name);
    expect(patches(), 'detail response was never patched').toBeGreaterThan(0);
  });

  test('G9 · a very long child name does not push the page sideways', async ({ page }) => {
    const { a, parent } = await seedComposite(page, 'g9');
    const longName = `checkout_${'regional_database_failover_'.repeat(8)}`;
    const patches = await patchDetail(page, parent.id, (body) => {
      body.children[0] = { ...body.children[0], name: longName };
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.detailChild(a.id)).toContainText(longName);
    expect(await pm.compositeAlertsPage.bodyHasNoHorizontalOverflow()).toBeTruthy();
    expect(patches(), 'detail response was never patched').toBeGreaterThan(0);
  });

  // ===================== H · status timeline =====================

  test('H1/H5 · the timeline renders a lane per child plus the result', async ({ page }) => {
    const { parent } = await seedComposite(page, 'h1');

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.timeline()).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineWindow('1h')).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineWindow('4h')).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineWindow('1d')).toBeVisible();
    // The legend is the only key to the segment colours.
    await expect(pm.compositeAlertsPage.timeline()).toContainText(/firing/i);
  });

  test('H2 · switching the window refetches over the new range', async ({ page }) => {
    const { parent } = await seedComposite(page, 'h2');
    const ranges = [];
    await page.route('**/composite-timeline*', async (route) => {
      const url = new URL(route.request().url());
      ranges.push(Number(url.searchParams.get('to')) - Number(url.searchParams.get('from')));
      await route.continue();
    });

    await pm.compositeAlertsPage.openDetail(parent.id);
    await expect.poll(() => ranges.length).toBeGreaterThan(0);
    const initial = ranges.at(-1);

    await pm.compositeAlertsPage.selectTimelineWindow('1d');

    await expect.poll(() => ranges.at(-1)).toBeGreaterThan(initial);
    // 4h default -> 1d is a six-fold widening, not an arbitrary change.
    expect(ranges.at(-1)).toBe(86_400_000_000);
  });

  test('H3 · an empty timeline says so rather than rendering nothing', async ({ page }) => {
    const { parent } = await seedComposite(page, 'h3');
    await page.route('**/composite-timeline*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'unavailable' }),
      });
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.timelineEmpty()).toBeVisible();
    // A failed fetch must not take the rest of the detail page down with it.
    await expect(pm.compositeAlertsPage.detailConfig()).toBeVisible();
  });

  test('H4 · lanes carry the current level of each accessible child', async ({ page }) => {
    const { a, b, parent } = await seedComposite(page, 'h4');
    await page.route('**/composite-timeline*', async (route) => {
      const to = Date.now() * 1000;
      const from = to - 14_400_000_000;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          from,
          to,
          children: [
            {
              alert_id: a.id, name: a.name, accessible: true, slot: 0, current_level: 'critical',
              transitions: [{ at: from + 3_600_000_000, from_level: 'ok', to_level: 'critical' }],
            },
            {
              alert_id: b.id, name: b.name, accessible: true, slot: 1, current_level: 'ok',
              transitions: [],
            },
          ],
          result: {
            alert_id: parent.id, name: parent.name, accessible: true, current_level: 'critical',
            transitions: [{ at: from + 3_600_000_000, from_level: 'ok', to_level: 'critical' }],
          },
        }),
      });
    });

    await pm.compositeAlertsPage.openDetail(parent.id);

    await expect(pm.compositeAlertsPage.timelineLevel(a.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineLevel(b.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineLevel(parent.id)).toBeVisible();
    await expect(pm.compositeAlertsPage.timelineEmpty()).toHaveCount(0);
  });
});
