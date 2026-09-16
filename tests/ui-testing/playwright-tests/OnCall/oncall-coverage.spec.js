/**
 * On-Call — covers, swaps, absences and the schedule bar (Tier 2, TS-08/09/05.13)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 2.
 *
 * THE QUESTION THIS FILE ASKS is the only one the schedule exists to answer:
 * who holds the pager at instant X. Four things can change that answer — the
 * rotation itself, a cover, a swap (which is two covers), and an absence — and
 * the whole value is that they compose to EXACTLY ONE holder, with no gap and
 * no tie. So nearly every assertion here is a comparison against
 * `whoIsOnCall(team, at)`, the engine's own answer, at instants chosen on
 * purpose either side of an edge.
 *
 * THE ENGINE IS THE ORACLE, except in TS-05.13. Everything here compares a
 * screen or a stored record against `/on-call`, because the engine is what
 * actually decides who gets woken. TS-05.13 is the exception and has to be: it
 * is the W-04 guard, and W-04 lives in the schedule bar, so the bar is exactly
 * what it must read. The strip above the chart (`oncall-schedule-answer`) is
 * not an alternative — it deliberately does not restate who is on, and speaks
 * only when nobody is. See that test's own note.
 *
 * ANCHORS SIT MID-SHIFT, NEVER ON A BOUNDARY. A weekly rotation anchored at
 * `now - WEEK` puts a handover at exactly `now`, so "an hour ago" and "an hour
 * from now" are different people for a reason that has nothing to do with the
 * cover under test. Every fixture here anchors half a shift back, which keeps
 * the whole ±1-day neighbourhood inside one person's turn.
 *
 * SCHEDULE FIRST, MEMBERS SECOND. `POST /teams/{id}/members` auto-provisions a
 * `source: "default"` rotation on a rotationless team and repoints rungs P1-P3
 * at it; a schedule written afterwards is then the §8.5 replacement the server
 * refuses. And a cover additionally requires its coverer to be a TEAM MEMBER —
 * being on a rotation is not enough — so both writes are mandatory and their
 * order is not negotiable. `stageTeam()` below is the only place that knows it.
 *
 * Self-cleaning: fixtures are named `e2e_oncall_coverage_w<worker>_*` and swept
 * by prefix in afterAll, which runs once PER WORKER in parallel mode.
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
  getTeamSchedule,
  whoIsOnCall,
  createCover,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  listCovers,
  deleteCover,
  createAbsence,
  listAbsences,
  deleteAbsence,
  getTeamAttention,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_coverage';
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const HOUR = 3600 * MICROS;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const gate = { checked: false, available: false, reason: '' };

const nowMicros = () => Date.now() * 1000;

/** A rotation whose current turn has half a shift left to run either way. */
function weeklyRotation(id, members, anchorMicros, shiftMicros = WEEK) {
  return {
    id,
    name: id,
    shift_rules: [{
      name: `${id} shift`,
      members,
      shift_micros: shiftMicros,
      anchor_micros: anchorMicros,
      priority: 0,
    }],
  };
}

/**
 * A team with rotations AND members, in the only order the server accepts.
 *
 * `rosters` is one member list per rotation; `extraMembers` are people on the
 * TEAM but on no rotation — which is what a coverer usually is, and what the
 * cover route requires before it will put them on call.
 */
async function stageTeam(page, name, {
  rosters, extraMembers = [], timezone = 'UTC', shiftMicros = WEEK,
}) {
  const team = await createTeam(page, { name, timezone });
  // Half a shift back: the handover is then half a shift away in both
  // directions, so the ±1-day neighbourhood the cover cases probe sits well
  // inside one person's turn.
  const anchor = nowMicros() - Math.floor(shiftMicros / 2);
  const rotations = rosters.map((members, i) => weeklyRotation(
    i === 0 ? 'Primary' : `Secondary${i === 1 ? '' : i}`,
    members,
    // Each further rotation is offset by a third of a shift so the positions
    // resolve to different people rather than shadowing the primary.
    anchor - i * Math.floor(shiftMicros / 3),
    shiftMicros,
  ));
  await setTeamSchedule(page, team.id, { timezone, rotations });
  const everyone = [...new Set([...rosters.flat(), ...extraMembers])];
  await addTeamMembers(page, team.id, everyone);
  return { team, rotations: rotations.map((r) => r.id) };
}

/** `{ rotationId: holderEmail }` at an instant — the engine's answer, flattened. */
async function holdersAt(page, teamId, atMicros) {
  const slots = (await whoIsOnCall(page, teamId, atMicros)) ?? [];
  return Object.fromEntries(slots.map((s) => [s.rotation_id, s.user_email]));
}

test.describe.configure({ mode: 'parallel' });

test.describe('On-call covers, swaps and absences', {
  tag: ['@oncall', '@oncall-coverage', '@enterprise'],
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

  // ------------------------------------------------------------------ TS-08

  /**
   * TS-08.01 — a cover wins while it stands, and hands back cleanly.
   *
   * The two edges are the point. A cover that began a microsecond late, or
   * ended a microsecond early, leaves an instant with nobody on call — and a
   * page landing in that instant reaches nobody at all. So this asserts a
   * named holder at FIVE instants: before, at both edges, inside, and after.
   * `covers()` is half-open (`at >= start_at && at < end_at`), so the closing
   * edge belongs to the rotation again, not to the cover.
   */
  test('TS-08.01 a cover holds the pager for its window and hands back with no gap at either edge', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_win`);
    const users = await createOrgUsers(page, name, 4);
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 3)],
      extraMembers: [users[3]],
    });

    const t0 = nowMicros();
    const baseline = (await holdersAt(page, team.id, t0)).Primary;
    expect(baseline, 'the rotation must put somebody on call before any cover exists').toBeTruthy();
    expect(baseline, 'the coverer must not already hold the slot, or the test proves nothing')
      .not.toBe(users[3]);

    const cover = await createCover(page, team.id, {
      userEmail: users[3],
      rotationId: 'Primary',
      fromMicros: t0 - HOUR,
      toMicros: t0 + HOUR,
      reason: 'e2e cover window',
    });

    const at = async (offset) => (await holdersAt(page, team.id, t0 + offset)).Primary;

    expect(await at(-HOUR - 60 * MICROS), 'a minute before the cover starts, the rotation still holds it')
      .toBe(baseline);
    expect(await at(-HOUR), 'the opening edge belongs to the cover — it is inclusive')
      .toBe(users[3]);
    expect(await at(0), 'inside the window the cover holds the pager').toBe(users[3]);
    expect(await at(HOUR - 60 * MICROS), 'a minute before it ends the cover still holds it')
      .toBe(users[3]);
    expect(await at(HOUR), 'the closing edge is exclusive — the rotation has it back')
      .toBe(baseline);
    expect(await at(HOUR + 60 * MICROS), 'and it stays back').toBe(baseline);

    await deleteCover(page, team.id, cover.id);
    testLogger.info('Cover window verified at both edges', { coverId: cover.id });
  });

  /**
   * TS-08.02 — the secondary position can be covered.
   *
   * "Secondary" is a rotation NAME by convention; nothing in the product
   * treats it as a slot keyword. The case exists because an implementation
   * that special-cased slots would answer "no rotation in slot secondary" —
   * so the assertion is a 200 AND that the cover landed on the SECONDARY
   * position while leaving the primary's holder alone. A cover that quietly
   * defaulted to the primary would otherwise pass a bare status check.
   */
  test('TS-08.02 a cover can name the secondary rotation, and leaves the primary untouched', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_sec`);
    const users = await createOrgUsers(page, name, 4);
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 3), users.slice(0, 3)],
      extraMembers: [users[3]],
    });

    const t0 = nowMicros() + 6 * HOUR;
    const before = await holdersAt(page, team.id, t0);
    expect(Object.keys(before), 'the fixture must staff two positions')
      .toEqual(expect.arrayContaining(['Primary', 'Secondary']));

    const cover = await createCover(page, team.id, {
      userEmail: users[3],
      rotationId: 'Secondary',
      fromMicros: t0 - HOUR,
      toMicros: t0 + HOUR,
    });
    expect(cover?.rotation_id, 'the stored cover must remember which position it stands over')
      .toBe('Secondary');

    const after = await holdersAt(page, team.id, t0);
    expect(after.Secondary, 'the cover must hold the secondary position').toBe(users[3]);
    expect(after.Primary, 'and must not have moved the primary').toBe(before.Primary);

    await deleteCover(page, team.id, cover.id);
  });

  /**
   * TS-08.03 — a swap lands in both directions.
   *
   * A swap is not an entity: the dialog writes TWO covers, one each way, in
   * sequence. So "both directions land" is literally two assertions at two
   * instants — A holds B's hours and B holds A's — and a half-done swap (the
   * second write failing after the first succeeded) is exactly the failure
   * this catches, because one direction would be right and the other wrong.
   */
  test('TS-08.03 a swap puts each person in the other\'s hours, both directions', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_swap`);
    const users = await createOrgUsers(page, name, 3);
    const { team } = await stageTeam(page, name, { rosters: [users] });

    // Two disjoint future windows standing in for two shifts.
    const t0 = nowMicros();
    const weekA = { from: t0 + 2 * DAY, to: t0 + 3 * DAY };
    const weekB = { from: t0 + 5 * DAY, to: t0 + 6 * DAY };
    const midA = weekA.from + Math.floor(DAY / 2);
    const midB = weekB.from + Math.floor(DAY / 2);

    const holderA = (await holdersAt(page, team.id, midA)).Primary;
    const holderB = (await holdersAt(page, team.id, midB)).Primary;
    test.skip(
      !holderA || !holderB || holderA === holderB,
      'a swap needs two windows held by different people; this roster produced one holder',
    );

    // The swap, written the way the dialog writes it: crosswise, with
    // `covering_for` naming whose hours each person is standing in.
    const first = await createCover(page, team.id, {
      userEmail: holderB, rotationId: 'Primary',
      fromMicros: weekA.from, toMicros: weekA.to, coveringFor: holderA,
    });
    const second = await createCover(page, team.id, {
      userEmail: holderA, rotationId: 'Primary',
      fromMicros: weekB.from, toMicros: weekB.to, coveringFor: holderB,
    });

    expect((await holdersAt(page, team.id, midA)).Primary, 'B must now hold A\'s window')
      .toBe(holderB);
    expect((await holdersAt(page, team.id, midB)).Primary, 'and A must hold B\'s window')
      .toBe(holderA);

    await deleteCover(page, team.id, first.id);
    await deleteCover(page, team.id, second.id);
  });

  /**
   * TS-08.04 — the cover list shows the live cover, and taking it back returns
   * the pager immediately.
   *
   * Driven through the SCREEN, because the value is that somebody who arranged
   * cover badly can undo it in one place under pressure. The removal is
   * confirmed against the engine rather than against the row vanishing: a row
   * absent from the DOM is what an unrendered row and a deleted cover look
   * like alike, and only one of those is the thing under test.
   */
  test('TS-08.04 the cover list shows the standing cover, and removing it returns the pager at once', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_list`);
    const users = await createOrgUsers(page, name, 4);
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 3)],
      extraMembers: [users[3]],
    });

    const t0 = nowMicros();
    const baseline = (await holdersAt(page, team.id, t0)).Primary;
    const cover = await createCover(page, team.id, {
      userEmail: users[3], rotationId: 'Primary',
      fromMicros: t0 - HOUR, toMicros: t0 + 6 * HOUR, reason: 'e2e live cover',
    });
    expect((await holdersAt(page, team.id, nowMicros())).Primary,
      'the cover must be live before the screen is asked about it').toBe(users[3]);

    await pm.oncallCoveragePage.gotoTeamTab(ORG, team.id, 'schedule');
    await pm.oncallCoveragePage.expectCoverListVisible();
    await pm.oncallCoveragePage.expectCoverRowVisible(cover.id);

    await pm.oncallCoveragePage.removeCover(cover.id);

    await expect
      .poll(async () => (await holdersAt(page, team.id, nowMicros())).Primary, {
        timeout: 30000,
        message: 'taking the cover back must return the pager to the rotation, not leave it in limbo',
      })
      .toBe(baseline);

    const remaining = await listCovers(page, team.id);
    expect(remaining.map((c) => c.id), 'the cover must be gone from the store too')
      .not.toContain(cover.id);
  });

  /**
   * TS-08.05 — overlapping covers resolve to exactly one holder, by the
   * documented rule.
   *
   * The server accepts overlapping covers deliberately: somebody arranging
   * cover at 2am should not have to work out what the earlier one said. The
   * documented rule is LAST CREATED WINS — `created_at` descending, `id`
   * descending to break a tie — stated once in
   * `config/src/meta/oncall/rotation.rs::covering_override_for`.
   *
   * Three instants, because "exactly one holder" is not the same claim as
   * "the right holder": the early-only hours must still be the first cover's,
   * the late-only hours the second's, and the overlap the second's by the rule.
   */
  test('TS-08.05 overlapping covers resolve to exactly one holder, the last created winning', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_lap`);
    const users = await createOrgUsers(page, name, 4);
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 2)],
      extraMembers: users.slice(2),
    });

    const t0 = nowMicros();
    // Two covers that overlap in the middle four hours.
    const earlier = await createCover(page, team.id, {
      userEmail: users[2], rotationId: 'Primary',
      fromMicros: t0 + 20 * HOUR, toMicros: t0 + 26 * HOUR,
    });
    const later = await createCover(page, team.id, {
      userEmail: users[3], rotationId: 'Primary',
      fromMicros: t0 + 22 * HOUR, toMicros: t0 + 28 * HOUR,
    });
    expect(later.created_at, 'the second cover must genuinely be the later write')
      .toBeGreaterThanOrEqual(earlier.created_at);

    const at = async (hours) => await whoIsOnCall(page, team.id, t0 + hours * HOUR);

    const earlyOnly = await at(21);
    expect(earlyOnly.filter((s) => s.rotation_id === 'Primary'),
      'exactly one person holds the primary at any instant').toHaveLength(1);
    expect(earlyOnly.find((s) => s.rotation_id === 'Primary').user_email,
      'the hours only the first cover spans are the first coverer\'s').toBe(users[2]);

    const overlap = await at(24);
    expect(overlap.filter((s) => s.rotation_id === 'Primary'),
      'an overlap must not produce two holders').toHaveLength(1);
    expect(overlap.find((s) => s.rotation_id === 'Primary').user_email,
      'in the overlap the LAST created cover wins — rotation.rs covering_override_for')
      .toBe(users[3]);

    const lateOnly = await at(27);
    expect(lateOnly.find((s) => s.rotation_id === 'Primary').user_email,
      'the hours only the second cover spans are the second coverer\'s').toBe(users[3]);

    await deleteCover(page, team.id, earlier.id);
    await deleteCover(page, team.id, later.id);
  });

  // ------------------------------------------------------------------ TS-09

  /**
   * TS-09.01 — an absence moves only the absent person's turn.
   *
   * The blast radius is the whole case. An absence that also shuffled the
   * secondary, or a colleague's turn, would quietly re-staff a team nobody
   * asked to re-staff. So the fixture gives the two positions DISJOINT
   * rosters, marks the primary's holder away, and asserts the primary moved
   * while the secondary is byte-for-byte what it was.
   */
  test('TS-09.01 marking somebody away moves their turn and nobody else\'s', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_away`);
    const users = await createOrgUsers(page, name, 4);
    // Disjoint rosters: whoever is away on the primary cannot be the secondary.
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 2), users.slice(2, 4)],
    });

    const t0 = nowMicros();
    const before = await holdersAt(page, team.id, t0);
    const absentee = before.Primary;
    expect(absentee, 'the primary must be staffed before anybody is marked away').toBeTruthy();

    const created = await createAbsence(page, {
      userEmail: absentee,
      fromMicros: t0 - HOUR,
      toMicros: t0 + 2 * HOUR,
      reason: 'e2e absence',
    });
    expect(created.status, 'marking somebody away must be accepted').toBe(200);

    const during = await holdersAt(page, team.id, nowMicros());
    expect(during.Primary, 'the absent person must not still be named as on call')
      .not.toBe(absentee);
    expect(during.Primary, 'their turn must pass to somebody, never to nobody').toBeTruthy();
    expect(during.Secondary, 'an absence on the primary must not disturb the secondary')
      .toBe(before.Secondary);

    const after = await holdersAt(page, team.id, t0 + 3 * HOUR);
    expect(after.Primary, 'and once the absence is over the turn comes back')
      .toBe(absentee);

    await deleteAbsence(page, created.body.id);
  });

  /**
   * TS-09.02 — one absence covers every team the person is on.
   *
   * The route is org-scoped and takes no `team_id`, deliberately: somebody on
   * leave is on leave everywhere, and an absence that had to be entered per
   * team is an absence somebody will forget to enter on the team that pages
   * them at 3am. Two teams, one write, both must move.
   */
  test('TS-09.02 a single absence takes the person off call on every team they are on', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_org`);
    const users = await createOrgUsers(page, name, 3);
    // Same two-person roster on both teams, so the same person is on call on both.
    const a = await stageTeam(page, `${name}_a`, { rosters: [users.slice(0, 2)] });
    const b = await stageTeam(page, `${name}_b`, { rosters: [users.slice(0, 2)] });

    const t0 = nowMicros();
    const beforeA = (await holdersAt(page, a.team.id, t0)).Primary;
    const beforeB = (await holdersAt(page, b.team.id, t0)).Primary;
    test.skip(
      beforeA !== beforeB,
      'this case needs one person on call on both teams; the anchors resolved to two',
    );

    const created = await createAbsence(page, {
      userEmail: beforeA, fromMicros: t0 - HOUR, toMicros: t0 + 2 * HOUR,
    });
    expect(created.status).toBe(200);
    expect(created.body.team_id, 'an absence is org-scoped and must not be stored against a team')
      .toBeUndefined();

    const afterA = (await holdersAt(page, a.team.id, nowMicros())).Primary;
    const afterB = (await holdersAt(page, b.team.id, nowMicros())).Primary;
    expect(afterA, 'the first team must have moved on').not.toBe(beforeA);
    expect(afterB, 'and the second team must have moved on from the same one write')
      .not.toBe(beforeA);
    expect(afterA, 'the first team must still have somebody').toBeTruthy();
    expect(afterB, 'and so must the second').toBeTruthy();

    const listed = await listAbsences(page, { userEmail: beforeA });
    expect(listed.map((x) => x.id), 'the one absence is listed once, not once per team')
      .toContain(created.body.id);

    await deleteAbsence(page, created.body.id);
  });

  /**
   * TS-09.03 — an away clash is surfaced while somebody is still looking.
   *
   * SELECTOR NOTE. The plan names `oncall-schedule-away-{email}`. That selector
   * does not exist anywhere in `web/src` — I grepped the whole tree, and so did
   * a second pass. Away state is keyed on the team-member ROW id
   * (`oncall-members-away-{row.id}`, OnCallMembers.vue) and the rotation-level
   * clash is rendered by OnCallShiftRuleFields.vue as unlabelled prose. The one
   * machine-readable surface for "this rotation hands a shift to somebody away"
   * is the team attention row
   * `oncall-attention-rotation_hands_a_shift_to_someone_away`
   * (OnCallTeamAttention.vue), which is what this asserts — a stronger anchor
   * than the prose, and a real one.
   */
  test('TS-09.03 a rotation handing a shift to somebody away is flagged before anybody is paged', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_clash`);
    const users = await createOrgUsers(page, name, 2);
    const { team } = await stageTeam(page, name, { rosters: [users] });

    const t0 = nowMicros();
    const beforeRisks = await getTeamAttention(page, team.id);
    const kinds = (rows) => (rows ?? []).map((r) => r.kind);
    expect(kinds(beforeRisks), 'the clean fixture must not already be raising an away clash')
      .not.toContain('rotation_hands_a_shift_to_someone_away');

    // Away across a stretch this rotation will hand them.
    const created = await createAbsence(page, {
      userEmail: users[0], fromMicros: t0 + HOUR, toMicros: t0 + 10 * DAY,
      reason: 'e2e clash',
    });
    expect(created.status).toBe(200);

    await expect
      .poll(async () => kinds(await getTeamAttention(page, team.id)), {
        timeout: 30000,
        message: 'the clash must be derived on read, not waited for until somebody is paged',
      })
      .toContain('rotation_hands_a_shift_to_someone_away');

    await pm.oncallCoveragePage.gotoTeamTab(ORG, team.id, 'overview');
    await pm.oncallCoveragePage.expectAttentionRowVisible(
      'rotation_hands_a_shift_to_someone_away',
    );

    await deleteAbsence(page, created.body.id);
  });

  // ------------------------------------------------------------------ TS-05.13

  /**
   * TS-05.13 (W-04) — the screen names the same person the engine does.
   *
   * The defect: a zero-length segment renders full width over the real ones, so
   * the bar can name the wrong person — three surfaces, two answers, on the one
   * question the screen exists to answer.
   *
   * READ FROM THE BAR, deliberately, even though the bar is where the defect
   * lives. My first draft read `oncall-schedule-answer`, the strip above the
   * chart, on the theory that comparing a non-defective surface against the
   * engine was safer. It is not a surface at all for this question: the strip
   * deliberately does NOT restate who is on — OnCallTeamDetail.vue says so
   * outright ("Who is on, until when and who is next are on the lane the reader
   * is already looking at; restating them here gave the reader two renderings
   * to reconcile") — and it speaks only when NOBODY is on call. The bands are
   * the only place the screen answers, so the bands are what must be checked.
   *
   * Two assertions, because W-04 has two symptoms and either alone would let it
   * through: EXACTLY ONE band may claim the present instant, and that band must
   * name the person the engine has on call. A zero-length segment drawn over
   * the real ones produces a second claim; a claim drawn over the wrong span
   * produces the wrong name.
   *
   * A cover is standing while this runs, because a cover is precisely what adds
   * the extra segment boundary the defect mishandles — a clean weekly rotation
   * has no interior boundary to get wrong.
   */
  test('TS-05.13 the schedule bar makes exactly one claim on now, naming the person the engine has on call', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_bar`);
    const users = await createOrgUsers(page, name, 4);
    const { team } = await stageTeam(page, name, {
      rosters: [users.slice(0, 3)],
      extraMembers: [users[3]],
    });

    const t0 = nowMicros();
    const cover = await createCover(page, team.id, {
      userEmail: users[3], rotationId: 'Primary',
      fromMicros: t0 - HOUR, toMicros: t0 + 6 * HOUR, reason: 'e2e bar',
    });

    const engine = (await holdersAt(page, team.id, nowMicros())).Primary;
    expect(engine, 'the engine must name the coverer while the cover stands').toBe(users[3]);

    await pm.oncallCoveragePage.gotoTeamTab(ORG, team.id, 'schedule');
    await pm.oncallCoveragePage.expectTimelineVisible();
    await pm.oncallCoveragePage.expectLaneVisible('Primary');

    const bands = await pm.oncallCoveragePage.readLaneBands('Primary');
    expect(bands.length, 'the bar must draw the rotation it was given').toBeGreaterThan(0);
    testLogger.info('TS-05.13 bands drawn', { bands });

    const claims = await pm.oncallCoveragePage.readCurrentClaims('Primary');
    expect(
      claims.length,
      'exactly one band may claim the present instant — W-04 is a zero-length segment drawn full width over the real ones',
    ).toBe(1);
    expect(
      claims[0].aria,
      `the band claiming now must name the person the engine has on call (${engine}); W-04 is that it names another`,
    ).toContain(engine);

    await deleteCover(page, team.id, cover.id);
  });
});
