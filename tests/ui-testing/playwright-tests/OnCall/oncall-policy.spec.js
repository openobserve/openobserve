/**
 * On-Call — the escalation policy editor and L0 bounds (Tier 2, TS-10/11)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 2.
 *
 * VOCABULARY. In the model a "rung" IS a priority (one `PriorityRung` per
 * P1..P5); the things you add and remove inside one are STEPS. The selectors
 * say otherwise — `oncall-policy-rung-<priority>-<stepIndex>` is a STEP, and
 * `oncall-policy-remove-rung-<p>-<i>` removes a STEP — and there is no control
 * anywhere that adds or removes a PRIORITY. So the plan's "every add/remove
 * operates on the intended index" is about step indices, which is the index
 * that can actually be got wrong.
 *
 * WHY INDEX CORRECTNESS IS WORTH A TEST. An off-by-one in a remove handler
 * deletes a rung nobody meant to delete, and the policy still looks plausible:
 * four steps became three, the ladder still climbs, and the rung that used to
 * wake the manager is simply gone. Nothing downstream complains. A count
 * assertion passes that bug trivially, so everything here asserts on the
 * ORDERED LIST of what each step says, before and after.
 *
 * THE DRAWER OPENS ON THE DELIVERY TAB, every time (`policyTab = "delivery"`
 * runs on each open). A spec that wants the ladder or the triage panel must
 * click its tab first or the selectors are simply not in the DOM.
 *
 * SOME([]) vs NONE IS THE POINT OF TS-10.10, and both render an empty list —
 * the `source` tag is the only thing that separates "this team announces
 * nowhere on purpose" from "this team never set a channel, so the policy's
 * list applies". Asserting on the list being empty would pass for both and
 * prove nothing.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  MICROS,
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  setTeamSchedule,
  rotation,
  seedNotificationDestination,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  getPolicy,
  putPolicy,
  getTeamChannel,
  setTeamChannel,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_policy';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

/** The documented L0 triage-budget bounds — agent.rs MIN/MAX_TRIAGE_BUDGET_SECONDS. */
const BUDGET_MIN = 30;
const BUDGET_MAX = 600;

/**
 * A team with one rotation and members, in the order the server accepts.
 *
 * Schedule before members: adding the first member to a rotationless team
 * auto-provisions a `source: "default"` rotation and repoints P1-P3 at it, and
 * a schedule written afterwards is then the §8.5 replacement the server
 * refuses.
 */
async function stageTeam(page, name, { memberCount = 3 } = {}) {
  const users = await createOrgUsers(page, name, memberCount);
  const team = await createTeam(page, { name, timezone: 'UTC' });
  await setTeamSchedule(page, team.id, {
    timezone: 'UTC',
    rotations: [rotation({ id: 'Primary', members: users })],
  });
  await addTeamMembers(page, team.id, users);
  return { team, users };
}

/**
 * Three steps that render three DIFFERENT lines.
 *
 * Distinguished by TARGET, not by delay. An earlier version varied only the
 * delay, and two steps both paging the same rotation drew identical text inside
 * `oncall-policy-rung-{p}-{i}` — the delay lives in its own control, not in the
 * step's body — which made "the ordered list of steps" unable to see an
 * off-by-one at all. A rotation, then one named person, then the whole team.
 */
function threeSteps(rotationId, personEmail) {
  return [
    { after_micros: 0, targets: [{ kind: 'rotation', rotation_id: rotationId }] },
    { after_micros: 300 * MICROS, targets: [{ kind: 'user', email: personEmail }] },
    { after_micros: 900 * MICROS, targets: [{ kind: 'whole_team' }] },
  ];
}

const rungFor = (policy, priority) => (policy?.rungs ?? []).find((r) => r.priority === priority);

test.describe.configure({ mode: 'parallel' });

test.describe('On-call escalation policy editor', {
  tag: ['@oncall', '@oncall-policy', '@enterprise'],
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
   * TS-10.06 — add and remove hit the index they were asked to, and editing one
   * priority leaves its neighbours alone.
   *
   * Three claims, all invisible to a count:
   *   1. removing step 1 of three leaves the TARGETS of steps 0 and 2 — not of
   *      0 and 1.
   *   2. the ladder closes up by exactly the removed step's wait. A ladder is
   *      edited as a chain of waits between neighbours, so removing a rung
   *      removes its wait too (`removeStep` subtracts the gap from everything
   *      below it). My first draft asserted the surviving step's rendered
   *      offset was UNCHANGED and failed on exactly this — 15m became 10m after
   *      a 5m step was taken out, which is the design working, not a bug. The
   *      real claim is that it moves by the right amount: anything else would
   *      leave a dead gap, or silently bring a later rung forward.
   *   3. saving P2 leaves P1 and P3 byte-for-byte what they were. The editor
   *      PUTs the WHOLE policy, so a draft that mangled a priority the operator
   *      never opened would ship silently.
   */
  test('TS-10.06 removing a step removes the one asked for, and editing P2 leaves P1 and P3 alone', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_ladder`);
    const { team, users } = await stageTeam(page, name);

    // A known ladder on three priorities, each with three distinguishable steps.
    const seeded = [1, 2, 3].map((priority) => ({
      priority,
      channels: ['email'],
      steps: threeSteps('Primary', users[0]),
    }));
    const wrote = await putPolicy(page, team.id, { rungs: seeded });
    expect(wrote.status, 'the seeded ladder must be accepted').toBe(200);

    const before = await getPolicy(page, team.id);
    const p1Before = JSON.stringify(rungFor(before, 1));
    const p3Before = JSON.stringify(rungFor(before, 3));

    await pm.oncallPolicyEditorPage.gotoEscalationTab(ORG, team.id);
    await pm.oncallPolicyEditorPage.openEditor();
    await pm.oncallPolicyEditorPage.openTab('policy');
    await pm.oncallPolicyEditorPage.selectPriority(2);

    // The leading `+15m` offset legitimately moves when a step above is
    // removed, so identity is the TARGET half of the line, not the whole line.
    const targetsOf = (lines) => lines.map((l) => l.replace(/^\+?\S+\s*/, '').trim());

    const originalSteps = await pm.oncallPolicyEditorPage.readStepTexts(2);
    expect(originalSteps, 'the editor must draw the three seeded steps').toHaveLength(3);
    const originalTargets = targetsOf(originalSteps);
    expect(new Set(originalTargets).size,
      'the three steps must page three different things, or this test cannot see an off-by-one')
      .toBe(3);

    // Remove the MIDDLE step. An off-by-one takes the last one instead.
    await pm.oncallPolicyEditorPage.removeStepAt(2, 1);
    await expect
      .poll(() => pm.oncallPolicyEditorPage.countSteps(2), { timeout: 20000 })
      .toBe(2);

    const afterRemove = await pm.oncallPolicyEditorPage.readStepTexts(2);
    expect(
      targetsOf(afterRemove),
      'removing index 1 must leave the steps that paged the rotation and the whole team — leaving the named person means the wrong rung was deleted',
    ).toEqual([originalTargets[0], originalTargets[2]]);

    await pm.oncallPolicyEditorPage.addStepTo(2);
    await expect
      .poll(() => pm.oncallPolicyEditorPage.countSteps(2), { timeout: 20000 })
      .toBe(3);

    await pm.oncallPolicyEditorPage.savePolicy();
    await expect(pm.oncallPolicyEditorPage.getEditor())
      .toBeHidden({ timeout: 30000 });

    const after = await getPolicy(page, team.id);
    expect(JSON.stringify(rungFor(after, 1)),
      'editing P2 must not have touched P1').toBe(p1Before);
    expect(JSON.stringify(rungFor(after, 3)),
      'editing P2 must not have touched P3').toBe(p3Before);

    const p2After = rungFor(after, 2);
    expect(p2After.steps, 'P2 must have been written with the edited step list').toHaveLength(3);

    // The ladder closed up by exactly the removed step's wait: the whole-team
    // step sat at 900s behind a 300s step, so it must now sit at 600s. Not
    // 900s (a dead gap left behind) and not 0 (the whole tail collapsed).
    expect(
      p2After.steps[1].after_micros,
      'removing the 300s step must bring the 900s step forward to 600s — its own wait is preserved, only the removed one is gone',
    ).toBe(600 * MICROS);
    expect(
      p2After.steps[1].targets?.[0]?.kind,
      'the surviving second step must be the seeded THIRD one (whole_team), not the removed second (a named person)',
    ).toBe('whole_team');
    expect(
      JSON.stringify(p2After.steps).includes(users[0]),
      'the step naming a person was the one removed, so no surviving step may still name them',
    ).toBe(false);
  });

  /**
   * TS-10.08 — a step that cannot reach anybody says so while somebody is still
   * looking at it.
   *
   * Two reachable shapes, one parked (see the fixme below):
   *   - a step naming a rotation the team no longer has. The API stores this
   *     happily (verified: `rotation_id: "GhostRotation"` -> 200), so it is a
   *     state real data reaches, and the editor must call it out rather than
   *     render an empty row.
   *   - a step whose targets are all removed in the draft. The server refuses
   *     to store that ("the rung at 0us pages nobody"), so the ONLY place it can
   *     be caught is at edit time — which is exactly the claim.
   */
  test('TS-10.08 a step naming a vanished rotation, or reaching nobody, is called out at edit time', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_nobody`);
    const { team } = await stageTeam(page, name);

    const wrote = await putPolicy(page, team.id, {
      rungs: [{
        priority: 2,
        channels: ['email'],
        steps: [
          { after_micros: 0, targets: [{ kind: 'rotation', rotation_id: 'GhostRotation' }] },
          { after_micros: 300 * MICROS, targets: [{ kind: 'whole_team' }] },
        ],
      }],
    });
    expect(wrote.status, 'a policy naming a rotation the team lacks is stored, not refused')
      .toBe(200);

    await pm.oncallPolicyEditorPage.gotoEscalationTab(ORG, team.id);
    await pm.oncallPolicyEditorPage.openEditor();
    await pm.oncallPolicyEditorPage.openTab('policy');
    await pm.oncallPolicyEditorPage.selectPriority(2);

    await pm.oncallPolicyEditorPage.expectStepNamesMissingRotation(2, 0);

    // Now strip the second step's targets in the draft and watch it admit it.
    await pm.oncallPolicyEditorPage.getRemoveTarget(2, 1, 0).click();
    await pm.oncallPolicyEditorPage.expectStepReachesNobody(2, 1);

    // And the server agrees, naming the rung rather than failing vaguely.
    const refused = await putPolicy(page, team.id, {
      rungs: [{ priority: 2, channels: ['email'], steps: [{ after_micros: 0, targets: [] }] }],
    });
    expect(refused.status, 'a stored rung that pages nobody must be refused').toBe(400);
    expect(String(refused.body?.message ?? refused.text),
      'and the refusal must name the rung rather than say "invalid"')
      .toMatch(/pages nobody/i);
  });

  /**
   * G5's other half: a target kind the UI does not know.
   *
   * PARKED, not skipped, and not weakened. The UI defect is real and I read it:
   * `describeTarget` (web/src/utils/oncall.ts) treats any kind that is not
   * `user` or `whole_team` as a rotation, so an unknown kind renders as
   * "A rotation this team no longer has" — confidently wrong rather than
   * "unrecognised" — and `resolveLadder`'s `switch (target.kind)` has no
   * `default`, so the row also claims it reaches nobody.
   *
   * It cannot be driven from here: `EscalationTarget` is a closed serde enum
   * (config/src/meta/oncall/target.rs), so the API answers
   * 422 "unknown variant `martian_relay`, expected one of `rotation`, `user`,
   * `whole_team`" — verified against :5090 — and an unknown kind can only
   * arrive from legacy data or a newer engine. Writing one needs a fixture at
   * the storage layer, which is a decision, not a test.
   */
  test.fixme('TS-10.08b an unrecognised target kind renders as unrecognised rather than as a deleted rotation — not wired: POST/PUT policy 422s any kind outside rotation|user|whole_team, so the state cannot be seeded through the API, verified 16 Sep on :5090', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_kind`);
    const { team } = await stageTeam(page, name);
    await putPolicy(page, team.id, {
      rungs: [{
        priority: 2, channels: ['email'],
        steps: [{ after_micros: 0, targets: [{ kind: 'martian_relay' }] }],
      }],
    });

    await pm.oncallPolicyEditorPage.gotoEscalationTab(ORG, team.id);
    await pm.oncallPolicyEditorPage.openEditor();
    await pm.oncallPolicyEditorPage.openTab('policy');
    await pm.oncallPolicyEditorPage.selectPriority(2);

    const chip = pm.oncallPolicyEditorPage.getTarget(2, 0, 0);
    await expect(chip, 'an unknown kind must not be described as a deleted rotation')
      .not.toContainText(/no longer has/i);
  });

  /**
   * TS-10.10 — `Some([])` and `None` are different facts, and the screen says
   * which one this team is in.
   *
   * Both store an empty list, so an assertion on emptiness would pass for both
   * and prove nothing. The distinction lives in `source`:
   *   Some([])  -> source "team"   : announce nowhere, on purpose
   *   None      -> source "policy" : never set, the policy's list applies
   *
   * That difference decides whether a page is announced anywhere at all, which
   * is why the plan calls it load-bearing.
   */
  test('TS-10.10 an empty team channel set on purpose is distinguishable from one never set', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_chan`);
    const { team } = await stageTeam(page, name);
    const destination = await seedNotificationDestination(page, name);

    // A real list first, so "empty" afterwards is a change and not the default.
    expect((await setTeamChannel(page, team.id, [destination])).status).toBe(200);
    let channel = await getTeamChannel(page, team.id);
    expect(channel.destinations, 'the team channel must hold what was set')
      .toEqual([destination]);
    expect(channel.source, 'a list set on the team is sourced from the team').toBe('team');

    // Some([]) — deliberately silent.
    expect((await setTeamChannel(page, team.id, [])).status).toBe(200);
    channel = await getTeamChannel(page, team.id);
    expect(channel.destinations, 'a deliberate silence is an empty list').toEqual([]);
    expect(channel.source,
      'and it is still the TEAM\'s own answer — this is what makes it different from unset')
      .toBe('team');

    await pm.oncallPolicyEditorPage.gotoEscalationTab(ORG, team.id);
    await pm.oncallPolicyEditorPage.openEditor();
    await pm.oncallPolicyEditorPage.openTab('delivery');
    await pm.oncallPolicyEditorPage.expectTeamChannelVisible();
    await pm.oncallPolicyEditorPage.expectChannelSilentWarning();
    const silentSource = await pm.oncallPolicyEditorPage.readChannelSourceText();
    expect(silentSource.toLowerCase(),
      'the screen must attribute the deliberate silence to the team')
      .toContain('team');

    // None — never set, so the policy's list applies again.
    await pm.oncallPolicyEditorPage.clearTeamChannel();
    await expect
      .poll(async () => (await getTeamChannel(page, team.id))?.source, {
        timeout: 20000,
        message: '"use the policy\'s list" must send None, not another empty list',
      })
      .toBe('policy');

    const cleared = await getTeamChannel(page, team.id);
    expect(cleared.destinations,
      'both states render an empty list — which is exactly why source has to carry the difference')
      .toEqual([]);
    const policySource = await pm.oncallPolicyEditorPage.readChannelSourceText();
    expect(policySource.toLowerCase(),
      'and the screen must now attribute it to the policy instead')
      .toContain('policy');
  });

  /**
   * TS-11.04 — the L0 triage budget round-trips inside its bounds and is
   * refused outside them, with the bound named.
   *
   * "With the bound named" is the half that matters: a bare 400 sends somebody
   * to guess. The message is built from the constants themselves
   * (agent.rs `BudgetOutOfRange`), so it cannot drift from the check.
   *
   * The editor's own control is a SELECT of presets, not a number field, so an
   * out-of-range value cannot be typed into it at all — the UI half of this
   * case is therefore that every option it offers is inside the bounds and that
   * both edges are offered. The refusal can only be provoked at the API, which
   * is where it is asserted.
   */
  test('TS-11.04 the L0 triage budget round-trips within 30-600s and is refused outside it, naming the bound', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_l0`);
    const { team } = await stageTeam(page, name);
    const base = await getPolicy(page, team.id);
    const withBudget = (seconds) => ({ ...base.l0, triage_budget_seconds: seconds });

    for (const seconds of [BUDGET_MIN, 90, BUDGET_MAX]) {
      const res = await putPolicy(page, team.id, { rungs: base.rungs, l0: withBudget(seconds) });
      expect(res.status, `a budget of ${seconds}s is inside the bounds and must be accepted`)
        .toBe(200);
      const stored = await getPolicy(page, team.id);
      expect(stored.l0.triage_budget_seconds, `${seconds}s must round-trip unchanged`)
        .toBe(seconds);
    }

    for (const seconds of [BUDGET_MIN - 1, BUDGET_MAX + 1, 0, 3600]) {
      const res = await putPolicy(page, team.id, { rungs: base.rungs, l0: withBudget(seconds) });
      expect(res.status, `a budget of ${seconds}s is outside the bounds and must be refused`)
        .toBe(400);
      const message = String(res.body?.message ?? res.text);
      expect(message, 'the refusal must name the value it rejected').toContain(String(seconds));
      expect(message, 'and must name the bound, so nobody has to guess it')
        .toContain(`${BUDGET_MIN}-${BUDGET_MAX}`);
    }

    // A refused write must not have left the stored budget mangled.
    await putPolicy(page, team.id, { rungs: base.rungs, l0: withBudget(120) });
    expect((await getPolicy(page, team.id)).l0.triage_budget_seconds).toBe(120);

    await pm.oncallPolicyEditorPage.gotoEscalationTab(ORG, team.id);
    await pm.oncallPolicyEditorPage.openEditor();
    await pm.oncallPolicyEditorPage.openTab('triage');
    await pm.oncallPolicyEditorPage.expectL0EditorVisible();

    const offered = await pm.oncallPolicyEditorPage.readBudgetOptions();
    expect(offered.length, 'the budget control must offer something').toBeGreaterThan(0);
    expect(
      offered.filter((v) => v < BUDGET_MIN || v > BUDGET_MAX),
      'the editor must not offer a budget the server will refuse',
    ).toEqual([]);
    expect(offered, 'both edges of the documented range must be reachable from the UI')
      .toEqual(expect.arrayContaining([BUDGET_MIN, BUDGET_MAX]));
  });
});
