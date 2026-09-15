/**
 * On-Call — the pages list and one page's detail
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md
 *   §2.4  the page detail badges each responder with what the ledger says
 *   §3.2  an exhausted ladder reads "Ladder finished — nobody left"
 *   §3.3  a ladder still climbing keeps saying so — the wording is per-state
 *   §11.3 a group heading's count against the rows actually drawn
 *   §11.6 a teamless page reads "Unrouted", and the exhaust reason must not
 *         claim the team was deleted
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * SLOW BY NATURE. Every case here needs a REAL page, which means an alert that
 * fires and a scheduler that turns the firing into a record — `firePageAndWait`
 * owns that wait, and no test here sleeps on a bare timeout. Budget is set per
 * test rather than globally so the exhaustion case, which also has to wait out
 * a ladder, does not hand its slack to the cheap ones.
 *
 * §11.3 IS NOT AN EQUALITY. The table paginates at 20 rows across the whole
 * result set while each heading carries its group's total over the FILTERED
 * set, so `headingTotal` and `rowsDrawn` legitimately differ and a spec
 * asserting they match would be asserting a bug. There is also no "n of m
 * shown" element in this build — the plan offers it as an alternative the
 * product did not take — so nothing here looks for that copy. What is asserted
 * is the RELATIONSHIP `readGroupsAndRows()` exposes: the drawn rows are a slice
 * of the stated total, and the slice never exceeds one page.
 *
 * Self-cleaning, worker-scoped prefix. Alerts are swept FIRST by
 * `deleteOnCallFixturesByPrefix` — a scheduled alert whose stream is gone is
 * retried every scheduler cycle forever and starves the same worker budget the
 * escalation lane runs on, so leaving one behind breaks LATER runs, not this one.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  rotation,
  setTeamSchedule,
  setTeamPolicy,
  rungPagingRotation,
  rungEscalatingToTeam,
  seedOnCallStream,
  seedNotificationDestination,
  firePageAndWait,
  getEscalationProgress,
  getDeliveries,
  getResponse,
  getRoutingConfig,
  baseUrl,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');

const PREFIX = 'e2e_oncall_pages';

/** Wording the plan pins, verbatim from `oncall.ladderFinished`. */
const FINISHED_WORDING = 'Ladder finished';
/** The blanket wording §3.2 guards against, from `oncall.escalationClimbing`. */
const CLIMBING_WORDING = 'Escalating';
/** `oncall.statUnrouted` — what a page nothing claimed must say. */
const UNROUTED_WORDING = 'Unrouted';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

async function listOrgUsers(page) {
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/users`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body) ? body : (body?.data ?? []);
  return Array.isArray(list) ? list : [];
}

/**
 * The delivery ledger as a flat list.
 *
 * The route has answered both a bare array and a wrapper at different points;
 * normalising here keeps a shape change out of the assertion, which is about
 * agreement between the ledger and the badge rather than about JSON.
 */
function deliveryRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['list', 'deliveries', 'events', 'rows']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

test.describe.configure({ mode: 'parallel' });

test.describe('On-call pages list', {
  tag: ['@oncall', '@oncallPages', '@enterprise'],
}, () => {
  let pm;
  let ORG;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    ORG = orgId();

    if (!gate.checked) {
      const probe = await isOnCallAvailable(page);
      gate.checked = true;
      gate.available = probe.available;
      gate.reason = probe.reason;
    }
    test.skip(!gate.available, `On-call is not testable here — ${gate.reason}`);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteOnCallFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  /**
   * A team that can actually be paged: a member, a rotation holding them, and a
   * ladder naming that rotation.
   *
   * ORDER IS LOAD-BEARING. The schedule is written BEFORE the policy that names
   * its rotation — the reverse is refused (§8.5), because replacing a schedule
   * whose rotation a policy still points at would leave the ladder aiming at
   * nothing.
   *
   * AND MEMBERSHIP IS ONE OF THE WRITERS THAT NAMES A ROTATION, which is why
   * the schedule also goes in before the members. Putting the first member on a
   * rotationless team auto-provisions a `source: "default"` rotation and
   * repoints rungs P1..P3 at it, so a schedule written afterwards is the §8.5
   * replacement the server refuses — a 400 about a policy this spec never
   * wrote. Seeding the rotation first leaves that auto-write pointing at OUR
   * rotation, which `setTeamPolicy` then overwrites deliberately.
   */
  async function seedPageableTeam(page, testInfo, { exhausting = false } = {}) {
    const users = await listOrgUsers(page);
    expect(users.length, 'the org must have at least one user').toBeGreaterThan(0);
    const memberEmail = users[0].email;

    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });

    const rotationId = `${workerPrefix(testInfo)}_rot`;
    await setTeamSchedule(page, team.id, {
      rotations: [rotation({ id: rotationId, name: 'Primary', members: [memberEmail] })],
    });

    await addTeamMembers(page, team.id, [memberEmail]);

    if (exhausting) {
      // Two rungs and no repeat, so the ladder runs out inside a test rather
      // than climbing for the rest of the run.
      await setTeamPolicy(page, team.id, {
        rungs: [rungEscalatingToTeam(1, rotationId)],
        repeatCount: 1,
        finalAction: 'stop',
      });
    } else {
      await setTeamPolicy(page, team.id, { rungs: [rungPagingRotation(1, rotationId)] });
    }

    return { team, rotationId, memberEmail };
  }

  // ---------------------------------------------------------------- P0 smoke

  test('the pages list loads with its table', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectAvailable();
    await pm.oncallPagesListPage.expectListVisible();
  });

  // ------------------------------------------------------------------ §11.3

  /**
   * §11.3 — a heading describes the GROUP, the table draws a PAGE of it.
   *
   * A heading reading "3" on page one of five would be describing the
   * pagination rather than the state, which is why the two numbers are allowed
   * to differ. The invariant that must hold is that the drawn rows are a subset
   * of what the heading claims, and that no page draws more than the page size.
   */
  test('§11.3 group headings state the whole group while the table draws one page of it', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const { team } = await seedPageableTeam(page, testInfo);
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedOnCallStream(page, stream);

    await firePageAndWait(page, {
      alertOptions: {
        name: uniqueName(`${workerPrefix(testInfo)}_alert`),
        stream,
        teamId: team.id,
      },
    });

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectListVisible();
    // The table frame renders before the fetch resolves, so a snapshot taken
    // straight after `expectListVisible()` can catch an empty tbody — which
    // reads as "no headings drawn" and is indistinguishable from the defect
    // this test is for.
    await pm.oncallPagesListPage.waitForRows();
    expect(await pm.oncallPagesListPage.isGrouped(), 'grouping is on by default').toBe(true);

    const view = await pm.oncallPagesListPage.readGroupsAndRows();
    testLogger.info('§11.3 groups and rows', view);

    expect(view.groups.length, 'a grouped list must draw at least one heading').toBeGreaterThan(0);
    for (const group of view.groups) {
      expect(
        group.rowsDrawn,
        `heading "${group.key}" claims ${group.headingTotal} but ${group.rowsDrawn} rows sit under it`,
      ).toBeLessThanOrEqual(group.headingTotal);
    }

    const attributed = view.groups.reduce((sum, g) => sum + g.rowsDrawn, 0);
    expect(attributed, 'every drawn row belongs to a heading').toBe(view.rowsDrawn);
    expect(view.rowsDrawn, 'one page never draws more than the page size')
      .toBeLessThanOrEqual(view.pageSize);
  });

  // ------------------------------------------------------------- §3.2 / §3.3

  /**
   * §3.2 with §3.3 as its other half.
   *
   * "Level 6 of 6" and "nobody is coming" are the same number and opposite
   * situations. The honest wording is per-state, so this reads the same cell
   * twice: once while the ladder is still climbing — it must not already claim
   * to be finished — and once after the server reports exhaustion, where it must
   * say so in words and must NOT still read "Escalating".
   *
   * BOTH READS GO THROUGH THE TEAM FILTER, and that is what makes this test
   * survive a busy org rather than a freshly-wiped one. The list loads a
   * ladder for at most `ESCALATION_DETAIL_LIMIT` (25) open pages, OLDEST
   * FIRST, and says so with `oncall-escalation-capped`. A page this test just
   * opened is the newest in the org, so on an instance carrying more than 25
   * open pages it is always outside that window — its cell then has no
   * progress to render and falls back to "Not paged yet", which is not the
   * product being wrong, it is the row not being loaded. Open pages accumulate
   * permanently (fixture teardown removes alerts and teams, never the pages
   * they already opened), so an unfiltered read here is a test that works once
   * on a clean instance and never again. Narrowing to this test's own team is
   * the product's own answer to that: `team_id` is a SERVER-side filter, so
   * the refetched list holds one row and the ladder window covers it.
   *
   * The Refresh after it is not optional: changing the team filter calls
   * `fetchResponses()` alone, and only a full refresh re-runs
   * `fetchEscalationProgress()` over the newly narrowed set.
   */
  test('§3.2 an exhausted ladder says so, and a climbing one does not', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    const { team } = await seedPageableTeam(page, testInfo, { exhausting: true });
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedOnCallStream(page, stream);

    const { pages } = await firePageAndWait(page, {
      alertOptions: {
        name: uniqueName(`${workerPrefix(testInfo)}_alert`),
        stream,
        teamId: team.id,
      },
    });
    const responseId = pages[0].id;
    const cell = page.locator(`[data-test="oncall-escalation-cell-${responseId}"]`);

    const openListOnThisTeam = async () => {
      await pm.oncallPagesListPage.goto(ORG);
      await pm.oncallPagesListPage.expectListVisible();
      await pm.oncallPagesListPage.filterByTeam(team.id);
      await pm.oncallPagesListPage.refresh();
    };

    // §3.3 — while it is still climbing the cell must not claim it is over.
    await openListOnThisTeam();
    await expect(cell, 'the freshly opened page must be on the list').toBeVisible({ timeout: 60000 });
    const climbing = await getEscalationProgress(page, responseId);
    if (climbing && climbing.exhausted !== true) {
      await expect(cell, 'a ladder still due to fire must not read as finished')
        .not.toContainText(FINISHED_WORDING);
    }

    // The ladder's own cadence decides when it runs out; poll the server rather
    // than the screen, so a UI that never updates fails as a UI failure.
    await expect
      .poll(
        async () => (await getEscalationProgress(page, responseId))?.exhausted === true,
        {
          timeout: 300_000,
          intervals: [5000],
          message: 'the two-rung ladder never reported exhaustion — check that the escalation worker is running',
        },
      )
      .toBe(true);

    await openListOnThisTeam();
    await expect(cell).toBeVisible({ timeout: 60000 });

    await expect(
      cell,
      'an exhausted ladder must say nobody is left — if this times out, check whether '
      + 'oncall-escalation-capped is on screen and this row fell outside the loaded window',
    ).toContainText(FINISHED_WORDING, { timeout: 60000 });
    await expect(cell, 'a finished ladder must never still read as escalating')
      .not.toContainText(CLIMBING_WORDING);
  });

  // ------------------------------------------------------------------ §11.6

  /**
   * §11.6 — a page nothing routed is "Unrouted", and the reason must be true.
   *
   * A teamless page is still opened and must stay closable, so the row reads
   * "Unrouted" rather than going blank. The second half matters more: the
   * exhaust reason has to say nothing claimed it, not that a team was deleted —
   * the second sends somebody looking for a team that never existed.
   *
   * Requires the org to have NO default routing team. Setting one is org-wide
   * and would break every other worker's routing, so this skips rather than
   * touching it.
   *
   * PARKED ON A CONFIRMED PRODUCT DEFECT, NOT ON A TEST PROBLEM. The second
   * half genuinely fails on this build, and the assertion below is the correct
   * one — so it is left exactly as written and the test is fixme'd rather than
   * softened. Reproduced without Playwright: fire an alert with no
   * `oncall_team` into an org whose `default_team_id` is null, and
   * `GET /api/{org}/oncall/responses/{id}/escalation` answers
   *   {"stopped_because": "the owning team was deleted — this page needs a new owner"}
   * on a page whose `team_id` has been null since it opened. Nothing was ever
   * deleted; no team ever claimed it. The string belongs to the enterprise
   * backend (it appears in this repo only as a fixture, in
   * web/src/components/oncall/OnCallEscalation.spec.ts:430), so the fix is a
   * paired o2-enterprise change. Everything up to that assertion — the page
   * opening teamless, the row reading "Unrouted" — passes.
   */
  test.fixme('§11.6 a teamless page reads Unrouted and blames nothing on a deletion', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const routing = await getRoutingConfig(page);
    test.skip(
      Boolean(routing?.default_team_id),
      'this org nominates a catch-all team, so nothing can be unrouted — clearing it is org-wide and would break parallel workers',
    );

    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    // A dimension value nothing owns: the shared service names are claimed by
    // other fixtures, and a rule matching one would route this page after all.
    const service = uniqueName(`${workerPrefix(testInfo)}_svc`);
    await seedOnCallStream(page, stream, { services: [service] });

    // TEAMLESS IS NOT DESTINATIONLESS. §4.2 refuses an alert carrying none of
    // `oncall_team`, `destinations` and `workflows`, and the alert under test
    // has to omit the FIRST of those — that is what leaves routing to the rules
    // and lets nothing claim the page. So it carries a destination instead: an
    // http sink pointed back at this instance, which satisfies §4.2 without
    // naming an owner. Dropping all three was a seeding mistake, not a way to
    // build an unrouted page.
    const destination = await seedNotificationDestination(page, workerPrefix(testInfo));
    const alertName = uniqueName(`${workerPrefix(testInfo)}_alert`);
    const { pages } = await firePageAndWait(page, {
      alertOptions: { name: alertName, stream, destinations: [destination] },
    });
    const record = pages[0];
    expect(record.team_id ?? null, 'nothing must have claimed this page').toBeFalsy();

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectListVisible();
    await pm.oncallPagesListPage.search(alertName);

    const indices = await pm.oncallPagesListPage.readRowIndices();
    expect(indices.length, 'the search must have found the teamless page').toBeGreaterThan(0);
    const row = page.locator(pm.oncallPagesListPage.rowByIndex(indices[0]));
    await expect(
      row,
      'a page no rule claimed reads Unrouted — the team cell is a tag, not a link, so it carries no row-scoped data-test',
    ).toContainText(UNROUTED_WORDING, { timeout: 30000 });

    // The sentences the product would show for why this went nowhere.
    const progress = await getEscalationProgress(page, record.id);
    const detail = await getResponse(page, record.id);
    const reasons = [
      progress?.stopped_because,
      detail?.response?.why_not,
      ...(detail?.events ?? [])
        .filter((e) => e?.kind === 'exhausted')
        .map((e) => e?.body),
    ].filter((s) => typeof s === 'string' && s.length > 0);
    testLogger.info('§11.6 exhaust reasons', { reasons });

    for (const reason of reasons) {
      expect(
        reason,
        'nothing ever claimed this page, so no reason may say a team was deleted',
      ).not.toMatch(/delet|no longer (exists|has)|removed team/i);
    }
  });

  // ------------------------------------------------------------------- §2.4

  /**
   * §2.4 — the badge has to agree with the ledger, not with hope.
   *
   * `progress.reached` was computed from Delivery rows but loaded through a
   * query defined by EXCLUDING exactly those rows, so every rung of every page
   * reported reaching nobody whatever the ledger said. The badge is the
   * UI-visible form of that bug, so the assertion is agreement: present when
   * the ledger has sends for that address, absent when it has none, and reading
   * "reached" exactly when one of those sends landed.
   *
   * Deliberately NOT asserted: that anything actually lands. Whether email
   * leaves the box is a property of the deployment's transport, and a test that
   * demanded delivery would fail on a correctly-behaving instance with no SMTP.
   */
  test('§2.4 the page detail badges a responder with what the delivery ledger says', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const { team, memberEmail } = await seedPageableTeam(page, testInfo);
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedOnCallStream(page, stream);

    const { pages } = await firePageAndWait(page, {
      alertOptions: {
        name: uniqueName(`${workerPrefix(testInfo)}_alert`),
        stream,
        teamId: team.id,
      },
    });
    const responseId = pages[0].id;

    // The ledger is written as the ladder runs, so an empty read a second after
    // the record opens is "not yet", not "nothing was sent". Polled with a
    // deadline rather than asserted, because an empty ledger is a legitimate
    // outcome this test then asserts the ABSENCE of a badge against.
    let sends = [];
    const ledgerDeadline = Date.now() + 120_000;
    while (Date.now() < ledgerDeadline) {
      sends = deliveryRows(await getDeliveries(page, responseId))
        .filter((row) => row?.recipient === memberEmail);
      if (sends.length) break;
      await page.waitForTimeout(3000);
    }
    testLogger.info('§2.4 ledger for the on-call responder', {
      memberEmail, sends: sends.length,
    });

    await pm.oncallPagesListPage.gotoDetail(ORG, responseId);
    await expect(page.locator('[data-test="oncall-who-is-on"]')).toBeVisible({ timeout: 30000 });

    const badge = page.locator('[data-test="oncall-who-is-on-primary-reach"]');
    if (sends.length === 0) {
      await expect(
        badge,
        'with nothing in the ledger for this address there is nothing to badge',
      ).toHaveCount(0);
      return;
    }

    await expect(badge, 'a responder the ladder paged must carry a reach badge')
      .toBeVisible({ timeout: 30000 });
    const landed = sends.some((row) => row?.delivered === true);
    const text = ((await badge.textContent()) ?? '').trim();
    expect(
      text.toLowerCase(),
      `the ledger says landed=${landed}; the badge must agree with it`,
    ).toBe(landed ? 'reached' : 'unreached');
  });

  // -------------------------------------------------------------- P2 surface

  /**
   * The row expand control expands INLINE in this build (`@click.stop`,
   * `expansion="single"`), while the manual pass against an older one recorded
   * it navigating. `clickRowExpand()` reports both observations rather than
   * encoding one, so this asserts that it did one of them — a chevron that
   * neither expands nor navigates is the only failure.
   */
  test('the row expand control either expands inline or opens the page', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const { team } = await seedPageableTeam(page, testInfo);
    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedOnCallStream(page, stream);
    const alertName = uniqueName(`${workerPrefix(testInfo)}_alert`);
    await firePageAndWait(page, {
      alertOptions: { name: alertName, stream, teamId: team.id },
    });

    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expectListVisible();
    await pm.oncallPagesListPage.search(alertName);

    const indices = await pm.oncallPagesListPage.readRowIndices();
    expect(indices.length).toBeGreaterThan(0);

    const outcome = await pm.oncallPagesListPage.clickRowExpand(indices[0]);
    testLogger.info('row expand outcome', outcome);
    expect(
      outcome.expandedInline || outcome.navigated,
      'the chevron must do something — inline expansion in this build',
    ).toBe(true);
  });
});
