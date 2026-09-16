/**
 * On-Call — L0 / AI SRE (§9)
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md §9
 *   9.1 P1 `parallel` — the first rung pages at +0s and a verdict attaches
 *       within the triage budget
 *   9.2 P2 `gate`     — the first rung is HELD until the verdict or the budget
 *   9.3 P4 `only`     — nobody is paged, and the agent still records a verdict
 *   9.4 agent unavailable — the preview must not claim `available: true`
 *
 * THESE ARE EXPECTED RED UNTIL THE AGENT IS LIVE, AND THAT IS THE POINT.
 * On build `8401c636ea` `escalation-preview` reported `available: true` for all
 * three modes while nothing from the agent ever reached a page. They are
 * written against the documented contract rather than against that behaviour,
 * and tagged `@oncall-l0` so CI can hold them separately instead of letting a
 * known product gap block the suite. A green run here is news; a red one is the
 * status quo the plan already records.
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * There is no L0 page object, and none is invented here. The lever is
 * `setTeamPolicy`'s `l0` argument — absent means UNCHANGED, so it is only ever
 * sent when a test means to configure the gate — and the read is
 * `GET /oncall/teams/{id}/escalation-preview?priority=N`, which is the one
 * endpoint that answers "what would happen", resolved per priority. `mode`
 * arrives ALREADY RESOLVED for the priority asked about: the server applies the
 * P1 invariant (always `parallel`) and the pages-nobody rule (P4/P5 -> `only`)
 * before answering, so nothing here re-derives it from `policy.l0.mode`.
 *
 * BLOCKED, and recorded rather than faked — the timing halves of 9.1-9.3 need a
 * page opened AT a chosen priority. An alert carries a top-level `priority`
 * field on the wire, but `createPagingAlert` in the seeding layer does not pass
 * one through, so a UI spec can only open a page at whatever priority the alert
 * path defaults to. What each case CAN assert is stated on the test. Closing the
 * rest needs either a priority argument on the seed helper or the API suite,
 * which owns per-priority ladder timing.
 *
 * Self-cleaning, worker-scoped prefix.
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
  seedOnCallStream,
  firePageAndWait,
  getEscalationProgress,
  getResponse,
  baseUrl,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');

const PREFIX = 'e2e_oncall_l0';

/** The server refuses a budget outside 30-600s rather than clamping it. */
const TRIAGE_BUDGET_SECONDS = 60;

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
 * A dry run of one priority's ladder, agent step included.
 *
 * Not in the seeding module, and deliberately not added to it: this is the only
 * spec that reads the preview, and a helper nothing else calls belongs beside
 * its caller.
 */
async function escalationPreview(page, teamId, priority) {
  const res = await page.request.get(
    `${baseUrl()}/api/${orgId()}/oncall/teams/${encodeURIComponent(teamId)}`
    + `/escalation-preview?priority=${priority}`,
    { headers: getAuthHeaders() },
  );
  if (!res.ok()) {
    throw new Error(
      `escalation-preview for team ${teamId} at P${priority} failed: `
      + `HTTP ${res.status()} — ${(await res.text().catch(() => '')).slice(0, 200)}`,
    );
  }
  return await res.json();
}

/** The L0 block as the ladder itself reads it: present only when an agent is reachable. */
function usableL0(preview) {
  return preview?.l0?.available ? preview.l0 : null;
}

test.describe.configure({ mode: 'parallel' });

test.describe('On-call L0 / AI SRE', {
  tag: ['@oncall', '@oncallL0', '@oncall-l0', '@enterprise'],
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
   * A pageable team whose policy carries an L0 block.
   *
   * Schedule before members: the first member on a rotationless team auto-creates
   * a `source: "default"` rotation and repoints rungs P1..P3 at it, which makes a
   * later schedule write the §8.5 replacement the server refuses.
   *
   * `mode` is per-severity and keyed by the UPPERCASE wire strings beside rung
   * priorities that are integers — both forms in one policy object, which is
   * the API's shape rather than a mistake. P1 is pinned `parallel` and P4
   * pinned `only` server-side; sending anything else is a 400, so the modes
   * below are the only ones those two accept.
   */
  async function seedTeamWithL0(page, testInfo, { p2Mode = 'gate', rungs = [1, 2, 3, 4] } = {}) {
    const users = await listOrgUsers(page);
    expect(users.length, 'the org must have at least one user').toBeGreaterThan(0);
    const memberEmail = users[0].email;

    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });

    const rotationId = `${workerPrefix(testInfo)}_rot`;
    await setTeamSchedule(page, team.id, {
      rotations: [rotation({ id: rotationId, name: 'Primary', members: [memberEmail] })],
    });

    await addTeamMembers(page, team.id, [memberEmail]);

    // Whether P4 pages is decided by the ladder, not by the severity: escalation.rs
    // arms a rung at P4 exactly when the team configured one, so §9.3 seeds both shapes.
    await setTeamPolicy(page, team.id, {
      rungs: rungs.map((priority) => rungPagingRotation(priority, rotationId)),
      l0: {
        mode: { P1: 'parallel', P2: p2Mode, P3: p2Mode, P4: 'only' },
        triage_budget_seconds: TRIAGE_BUDGET_SECONDS,
        allow_promotion: false,
        max_promotion_steps: 1,
        allow_downgrade: false,
        allow_suppress: false,
      },
    });

    return { team, rotationId, memberEmail };
  }

  // -------------------------------------------------------------------- 9.4

  /**
   * §9.4 — a preview that claims an agent it does not have is worse than no
   * agent at all: the ladder draws a hold that nothing is holding.
   *
   * The two halves are asserted together because neither is checkable alone.
   * If a real page never attracts a verdict inside the budget, the deployment
   * has no working agent, and the preview must not have said otherwise. THIS IS
   * THE CASE THE PLAN RECORDS AS FAILING: the preview answered `available: true`
   * on a build where nothing from the agent ever reached a page.
   */
  test('§9.4 the preview must not claim an agent that never reaches a page', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    const { team } = await seedTeamWithL0(page, testInfo);

    const preview = await escalationPreview(page, team.id, 1);
    const claimed = preview?.l0?.available === true;
    testLogger.info('§9.4 preview L0 block', { l0: preview?.l0 ?? null });

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

    // The verdict is its own event kind — `ai_verdict`, storage id 11 — because
    // it is the durable, auditable copy of a machine's recommendation.
    let verdicts = 0;
    const deadline = Date.now() + (TRIAGE_BUDGET_SECONDS + 120) * 1000;
    while (Date.now() < deadline) {
      const detail = await getResponse(page, responseId);
      verdicts = (detail?.events ?? []).filter((e) => e?.kind === 'ai_verdict').length;
      if (verdicts > 0) break;
      await page.waitForTimeout(5000);
    }
    testLogger.info('§9.4 verdicts attached', { responseId, verdicts, claimed });

    if (verdicts === 0) {
      expect(
        claimed,
        'no verdict ever attached to a real page, so this deployment has no working agent — '
        + 'the preview must report available: false rather than drawing an L0 step that holds nothing',
      ).toBe(false);
    } else {
      expect(
        claimed,
        'the agent produced a verdict, so the preview must say it is available',
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------- 9.1

  /**
   * §9.1 — P1 is pinned `parallel`, and parallel means nothing waits.
   *
   * Holding a critical page behind a model is not a setting the product offers;
   * the server pins P1 and 400s anything else, so the preview resolving P1 to
   * anything but `parallel` is a server bug rather than a policy one. The
   * paging half is read from the record that a real firing opened: the first
   * rung must be at +0, not deferred behind a triage budget.
   *
   * Blocked half: the verdict is asserted only when the record this fired is
   * itself a P1. Without a priority on the seed's alert helper the priority is
   * the alert path's default, so it is read back rather than assumed.
   */
  test('§9.1 P1 is parallel — the first rung fires at +0 and the agent stays out of an alert-backed page', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    const { team } = await seedTeamWithL0(page, testInfo);

    const preview = await escalationPreview(page, team.id, 1);
    expect(
      preview?.l0?.mode ?? 'parallel',
      'P1 is pinned parallel server-side — a critical page is never held',
    ).toBe('parallel');

    const stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedOnCallStream(page, stream);
    const { pages } = await firePageAndWait(page, {
      alertOptions: {
        name: uniqueName(`${workerPrefix(testInfo)}_alert`),
        stream,
        teamId: team.id,
        priority: 1,
      },
    });
    const record = pages[0];

    const progress = await getEscalationProgress(page, record.id);
    testLogger.info('§9.1 ladder progress', { priority: record.priority, progress });
    const first = (progress?.fired ?? [])[0];
    expect(first, 'a parallel priority pages immediately, so a rung must already have fired').toBeTruthy();
    expect(
      first?.after_micros ?? 0,
      'parallel means the page goes out at +0 while the agent runs alongside',
    ).toBe(0);

    expect(
      Number(record.priority),
      'the alert names P1, so its page must open at P1 — otherwise this asserts another rung\'s behaviour',
    ).toBe(1);

    const detail = await getResponse(page, record.id);
    const actors = new Set((detail?.events ?? []).map((e) => e?.actor).filter(Boolean));
    testLogger.info('§9.1 actors on an alert-backed P1 page', { actors: [...actors] });
    expect(
      actors.has('o2-sre'),
      'the agent does not participate on an alert-backed page — see the open P1 in o2-enterprise#2481',
    ).toBe(false);
  });

  /**
   * §9.1b — the verdict half, which this deployment cannot answer.
   *
   * The agent only joins a page whose subject is an INCIDENT. Two things have to
   * be true and neither is here: `/config` reports `incidents_enabled: false`, so
   * no incident-backed page can open at all, and `ai_enabled: false` with no model
   * provider configured, so nothing would attach a verdict even if one did.
   *
   * `creates_incident` is NOT the obstacle — it is a field on the ordinary alert
   * (`entity/alerts.rs`), and a plain alert accepts and stores it. An earlier note
   * here blamed the composite-alert entity; that was wrong, and it made the gap
   * look structural when it is only configuration.
   *
   * To un-park: run against a deployment with `O2_INCIDENTS_ENABLED=true`,
   * `O2_AI_ENABLED=true` and a real model provider, seed the alert with
   * `createsIncident: true`, and assert the verdict as below. Measuring this on an
   * alert-backed page instead is how the documented split gets misread as a
   * product bug (o2-enterprise#2481, open P1).
   */
  test.fixme('§9.1b a parallel agent attaches its verdict on an incident-backed page', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    const { team } = await seedTeamWithL0(page, testInfo);
    const record = { id: null, team };
    let verdicts = 0;
    const deadline = Date.now() + (TRIAGE_BUDGET_SECONDS + 120) * 1000;
    while (Date.now() < deadline) {
      const detail = await getResponse(page, record.id);
      verdicts = (detail?.events ?? []).filter((e) => e?.kind === 'ai_verdict').length;
      if (verdicts > 0) break;
      await page.waitForTimeout(5000);
    }
    expect(
      verdicts,
      'a parallel agent must still attach its verdict — running alongside is not running never',
    ).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------- 9.2

  /**
   * §9.2 — a gate holds the first rung for the budget, or until the verdict.
   *
   * What is assertable without a P2 page: the server resolves P2 to `gate` with
   * the budget the policy set, and the screen draws the hold ONLY when an agent
   * is actually reachable — `available: false` must draw no L0 step at all,
   * because a hold rendered there reads as configured and is wrong.
   *
   * Blocked half: that the rung is genuinely deferred. It needs a page opened at
   * P2, which the seeding layer cannot do.
   */
  test('§9.2 P2 resolves to a gate with its budget, and the hold is drawn only when an agent exists', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    const { team } = await seedTeamWithL0(page, testInfo, { p2Mode: 'gate' });

    const preview = await escalationPreview(page, team.id, 2);
    testLogger.info('§9.2 P2 preview', { l0: preview?.l0 ?? null });
    expect(preview?.l0 ?? null, 'the policy configured a gate at P2, so the preview must carry an L0 block').toBeTruthy();
    expect(preview.l0.mode, 'P2 was configured as a gate').toBe('gate');
    expect(
      preview.l0.triage_budget_seconds,
      'the budget is what the hold is measured against — the server refuses out-of-range values rather than clamping',
    ).toBe(TRIAGE_BUDGET_SECONDS);

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'escalation');
    await pm.oncallTeamDetailPage.openEscalationTab();

    const holdBand = pm.oncallTeamDetailPage.getLadderL0Bands();
    if (usableL0(preview)) {
      await expect(
        holdBand,
        'an agent the deployment can reach earns an L0 step above the rungs',
      ).toHaveCount(1, { timeout: 20000 });
    } else {
      await expect(
        holdBand,
        'a gate with nothing to gate on does not hold the page, so no L0 step may be drawn',
      ).toHaveCount(0, { timeout: 20000 });
    }
  });

  // -------------------------------------------------------------------- 9.3

  /**
   * §9.3 — `only` means the agent investigates and nobody is paged.
   *
   * Both halves of "nobody is paged" are read from the preview, which is the
   * dry run of exactly that question: P4 resolves to `only`, and the ladder for
   * P4 reaches nobody. That is assertable without opening a P4 page, which is
   * why it is the one case here that is not blocked on the seed's alert helper.
   *
   * Blocked half: that a verdict is still recorded. That needs a P4 page.
   */
  test('§9.3 P4 is investigate-only until the team gives it a rung', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    const noP4 = await seedTeamWithL0(page, testInfo, { rungs: [1, 2, 3] });
    const quiet = await escalationPreview(page, noP4.team.id, 4);

    expect(quiet?.l0 ?? null, 'P4 carries an L0 block — it is the one severity the agent owns alone').toBeTruthy();
    expect(
      quiet.l0.mode,
      'P4 and P5 are pinned `only` server-side: neither has a gate to set',
    ).toBe('only');
    expect(
      quiet.pages_anyone,
      'with no P4 rung the agent investigates alone and nobody is woken',
    ).toBe(false);

    const withP4 = await seedTeamWithL0(page, testInfo, { rungs: [1, 2, 3, 4] });
    const paging = await escalationPreview(page, withP4.team.id, 4);

    expect(
      paging.pages_anyone,
      'a team that configures a P4 rung is opting in to being paged at P4 — it is still an issue someone must see',
    ).toBe(true);
  });
});
