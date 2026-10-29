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
 * Where a case needs a reachable agent (a verdict on a real page), it skips
 * unless the preview reports one; CI runs without an agent.
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
const { createOrgUser, oncallUserEmail } = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_l0';

/** The server refuses a budget outside 30-600s rather than clamping it. */
const TRIAGE_BUDGET_SECONDS = 60;

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

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
   * Members before schedule: a schedule naming somebody not on the team is
   * refused with a 400.
   *
   * `mode` is per-severity and keyed by the UPPERCASE wire strings beside rung
   * priorities that are integers — both forms in one policy object, which is
   * the API's shape rather than a mistake. P1 is pinned `parallel` and P4
   * pinned `only` server-side; sending anything else is a 400, so the modes
   * below are the only ones those two accept.
   */
  async function seedTeamWithL0(page, testInfo, { p2Mode = 'gate', rungs = [1, 2, 3, 4] } = {}) {
    // Our own member: the first org user may be another worker's fixture, deleted mid-test.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'l0'),
    });

    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });

    const rotationId = `${workerPrefix(testInfo)}_rot`;
    await addTeamMembers(page, team.id, [memberEmail]);
    await setTeamSchedule(page, team.id, {
      rotations: [rotation({ id: rotationId, name: 'Primary', members: [memberEmail] })],
    });

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
    expect(preview.l0, 'the policy configured L0, so the preview must answer whether an agent is available')
      .toBeTruthy();
    const claimed = preview.l0.available === true;
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

  /** §9.1 — P1 is pinned `parallel` server-side, and parallel means the first rung does not wait on the agent. */
  test('§9.1 P1 is parallel — the first rung fires at +0 without waiting on the agent', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    const { team } = await seedTeamWithL0(page, testInfo);

    const preview = await escalationPreview(page, team.id, 1);
    expect(preview.l0, 'the policy configured L0, so the P1 preview must carry its block').toBeTruthy();
    expect(preview.l0.mode, 'P1 is pinned parallel server-side — a critical page is never held').toBe('parallel');

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
    expect(
      Number(record.priority),
      'the alert names P1, so its page must open at P1 — otherwise this asserts another rung\'s behaviour',
    ).toBe(1);

    let progress;
    await expect.poll(async () => {
      progress = await getEscalationProgress(page, record.id);
      return (progress?.fired ?? []).length;
    }, {
      timeout: 60000, intervals: [2000], message: 'a parallel priority pages immediately, so a rung must have fired',
    }).toBeGreaterThan(0);
    testLogger.info('§9.1 ladder progress', { priority: record.priority, progress });
    expect(
      progress.fired[0].after_micros,
      'parallel means the page goes out at +0 while the agent runs alongside',
    ).toBe(0);
  });

  test('§9.1b a parallel agent attaches its verdict on an alert-backed P1 page', {
    tag: ['@P1', '@oncall-l0'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    const { team } = await seedTeamWithL0(page, testInfo);
    const preview = await escalationPreview(page, team.id, 1);
    test.skip(!usableL0(preview), 'needs a reachable AI SRE agent (O2_AGENT_URL); this deployment has none');

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
    await expect.poll(async () => {
      const detail = await getResponse(page, pages[0].id);
      return (detail?.events ?? []).filter((e) => e?.kind === 'ai_verdict').length;
    }, {
      timeout: (TRIAGE_BUDGET_SECONDS + 120) * 1000,
      intervals: [5000],
      message: 'a parallel agent must still attach its verdict — running alongside is not running never',
    }).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------- 9.2

  /**
   * §9.2 — a gate holds the first rung for the budget, or until the verdict.
   *
   * The server resolves P2 to `gate` with the budget the policy set, and the
   * screen draws the hold ONLY when an agent is actually reachable —
   * `available: false` must draw no L0 step at all, because a hold rendered
   * there reads as configured and is wrong.
   *
   * Not asserted: that the rung is genuinely deferred. With no reachable agent a
   * gate holds nothing, and CI runs without one.
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
   * P4 reaches nobody.
   *
   * Not asserted: that a verdict is still recorded. That needs a reachable
   * agent, and CI runs without one.
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
