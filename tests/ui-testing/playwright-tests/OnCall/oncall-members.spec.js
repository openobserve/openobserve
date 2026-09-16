/**
 * On-Call — staffing a team so it can actually page somebody (TS-03, TS-04)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-03.01 a team created through the drawer is pageable immediately
 *   TS-04.01 an added member joins the default rotation, in add order
 *   TS-04.02 a member on no rotation is named out loud, not silently stranded
 *   TS-04.04 a member payload that adds nobody is refused (the W-02 guard)
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The exact default ladder DELAYS. The plan quotes the book's 5/15/30/60m;
 *     this build auto-creates P1 at 0/5m/15m, P2 at 0/5m/15m and P3 at 0/15m/30m.
 *     Pinning minute values would encode one build's product decision as a
 *     contract, so what is asserted is the SHAPE the case is actually about: the
 *     first P1 rung pages both rotations in parallel, P4 and P5 page nobody, and
 *     an L0 block exists.
 *   - Whether a well-formed address on a real domain is a typo. The server
 *     cannot know, accepts it, and reports it reachable. That is a documented
 *     limitation, recorded in the generation report rather than asserted.
 *   - Delivery. Nothing here waits on mail; that is TS-15's job.
 *
 * SELECTOR CORRECTION CARRIED FROM THE ARCHITECT: the book's
 * `oncall-teams-slot-{id}-primary` does not exist. `OnCallTeams.vue` renders
 * `oncall-teams-primary-gap-{id}`, which is a GAP TAG — its ABSENCE is what
 * "somebody is on call" looks like — so TS-03.01 asserts the gap is absent and
 * cross-checks the holder against `GET /teams/{id}/on-call`.
 *
 * Self-cleaning, worker-scoped prefix: every test owns its own team and its own
 * seeded users, because the `default` org on this environment carries fixture
 * litter from earlier runs and no assertion here may depend on an org-wide count.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  listTeams,
  addTeamMembers,
  listTeamMembers,
  getTeamSchedule,
  getTeamPolicy,
  whoIsOnCall,
  setTeamSchedule,
  detachPolicyFromRotations,
  rotation,
  allDayRestriction,
  orgId,
  uniqueName,
  baseUrl,
  deleteOnCallFixturesByPrefix,
  DAY_MICROS,
} = require('../utils/oncall-seed.js');
const {
  createOrgUser,
  createOrgUsers,
  oncallUserEmail,
  getConfigRisks,
} = require('../utils/oncall-seed-ext.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');

const PREFIX = 'e2e_oncall_members';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call team staffing', {
  tag: ['@oncall', '@oncall-members', '@enterprise'],
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

  // ------------------------------------------------------------------ TS-03.01

  test('a team created through the drawer is pageable with no further configuration', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_new`);
    const emails = await createOrgUsers(page, prefix, 3);
    const name = `${prefix}_team`;

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectAvailable();
    await pm.oncallTeamsPage.openCreateDrawer();
    await pm.oncallTeamsPage.fillTeamName(name);
    await pm.oncallTeamsPage.pickFormMembers(emails);
    await pm.oncallTeamsPage.saveDrawer();

    // The team id is the server's, so the row can only be found once it exists.
    await expect.poll(
      async () => (await listTeams(page)).some((t) => t.name === name),
      { timeout: 60000, intervals: [1000], message: 'the create drawer never produced a team' },
    ).toBe(true);
    const created = (await listTeams(page)).find((t) => t.name === name);

    // Auto-staffing: two slots, two DIFFERENT people. One person in both slots
    // means the secondary is decorative, which is the failure this case exists for.
    const onCall = await whoIsOnCall(page, created.id);
    testLogger.info('TS-03.01 auto-staffed slots', { onCall });
    expect(onCall.length, 'a new team resolves a primary and a secondary').toBe(2);
    const holders = onCall.map((slot) => slot.user_email);
    expect(new Set(holders).size, 'the two slots must resolve to two different people').toBe(2);
    for (const holder of holders) {
      expect(emails, 'every resolved holder is somebody who was actually staffed').toContain(holder);
    }

    // One 24x7 unrestricted weekly rotation per slot.
    //
    // `source` is NOT asserted here. A team created through the drawer carries
    // rotations with no `source` at all, because the drawer is explicit
    // configuration — `source: "default"` marks the rotations the API
    // auto-provisions when members are added to a bare team. Asserting it here
    // would pin the wrong one of two legitimate provisioning paths.
    const schedule = await getTeamSchedule(page, created.id);
    expect(schedule?.rotations?.length, 'the drawer creates the two rotations the slots need').toBe(2);
    for (const rot of schedule.rotations) {
      expect(rot.shift_rules?.length, 'a rotation with no shift rule pages nobody').toBeGreaterThan(0);
      expect(rot.shift_rules[0].members?.length, 'a rotation with no members resolves to nobody')
        .toBeGreaterThan(0);
      expect(rot.shift_rules[0].restrictions ?? [], 'the starting rotation is unrestricted — 24x7').toEqual([]);
    }

    // The default ladder: P1's first rung pages BOTH rotations at once, and the
    // low priorities page nobody rather than pretending to.
    const policy = await getTeamPolicy(page, created.id);
    const p1 = policy.rungs.find((r) => r.priority === 1);
    expect(p1.steps[0].after_micros, 'P1 starts immediately').toBe(0);
    expect(p1.steps[0].targets.length, 'P1 rung one is parallel across both slots').toBe(2);
    for (const priority of [4, 5]) {
      const rung = policy.rungs.find((r) => r.priority === priority);
      expect(rung.steps, `P${priority} pages nobody by default, and says so with an empty ladder`).toEqual([]);
    }
    expect(policy.l0, 'a default team carries an L0 block, not a null').toBeTruthy();

    // The gap tag is the screen's way of saying nobody holds the primary. A
    // freshly staffed team must not have it.
    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.search(name);
    await pm.oncallTeamsPage.expectRowVisible(created.id);
    await pm.oncallTeamsPage.expectNoPrimaryGap(created.id);
  });

  // ------------------------------------------------------------------ TS-04.01

  test('a member added from the members tab joins the default rotation in add order', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_add`);
    const seeded = await createOrgUsers(page, prefix, 3);
    const joiner = oncallUserEmail(prefix, 'joiner');
    await createOrgUser(page, { email: joiner });

    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, seeded);

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'members');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openMembersTab();
    await pm.oncallTeamDetailPage.pickMemberToAdd(joiner);
    await pm.oncallTeamDetailPage.submitAddMembers();

    // Membership first — the roster is the fact the rotation is derived from.
    await expect.poll(
      async () => (await listTeamMembers(page, team.id)).map((m) => m.user_email),
      { timeout: 60000, intervals: [1000], message: 'the added member never reached the roster' },
    ).toContain(joiner);

    const members = await listTeamMembers(page, team.id);
    const order = members.map((m) => m.user_email);
    expect(order[order.length - 1], 'a new member is APPENDED — roster order decides who is woken').toBe(joiner);

    // Appended, not inserted: nobody already on call changes hands because
    // somebody joined.
    const schedule = await getTeamSchedule(page, team.id);
    const primaryMembers = schedule.rotations[0].shift_rules[0].members;
    expect(primaryMembers, 'the joiner is on the default rotation, not merely on the roster').toContain(joiner);
    expect(primaryMembers.slice(0, seeded.length), 'the people already in the rotation keep their turns')
      .toEqual(seeded);

    // Coverage recomputes on the same render — it is derived, not remembered.
    const coverage = await pm.oncallTeamDetailPage.readMembersCoverage();
    testLogger.info('TS-04.01 members coverage line', { coverage });
    expect(coverage, 'the members tab states how many of the org are on this team').toMatch(/\d+/);
  });

  // ------------------------------------------------------------------ TS-04.02

  /**
   * UNWIRED, and kept as a fixme with its real assertions intact.
   *
   * Verified on this build, 15 Sep: a team with three members whose schedule
   * names only two of them derives `single_member_rotation` for each rotation
   * and NOTHING naming the third. `GET /teams/{id}/config-risks` produces
   * exactly three kinds — `coverage_gap`, `single_member_rotation`,
   * `unreachable_on_rung` — and none of them is "on the roster, on no
   * rotation". So a person can be added to an on-call team, appear on the
   * members tab, and never be woken, with no surface saying so.
   *
   * This is the Tier-1 "a team is silently not paged" class, which is why the
   * body asserts the CORRECT behaviour rather than the current one: it goes
   * green the moment the risk is derived, and weakening it to assert the gap
   * would pin the gap as correct.
   */
  test.fixme('a member on no rotation is named as a config risk rather than silently stranded — not wired: config-risks derives no such kind, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_strand`);
    const emails = await createOrgUsers(page, prefix, 3);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    // A follow-the-sun shape: two named rotations that between them do NOT
    // include everybody. Replacing the auto-staffed schedule is what creates
    // the stranding — the default one covers the whole roster by construction.
    // `id` is REQUIRED on a rotation — the route 422s on a rotation without one
    // — and the policy must be detached first, because replacing a schedule
    // whose rotations the policy names is refused.
    await detachPolicyFromRotations(page, team.id);
    const anchor = Math.floor(Date.now() / 1000) * 1_000_000;
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [
        rotation({
          id: 'RegionA',
          members: [emails[0]],
          shiftMicros: DAY_MICROS,
          anchorMicros: anchor,
          restrictions: [allDayRestriction()],
        }),
        rotation({
          id: 'RegionB',
          members: [emails[1]],
          shiftMicros: DAY_MICROS,
          anchorMicros: anchor,
          restrictions: [allDayRestriction()],
        }),
      ],
    });

    // emails[2] is now on the roster and on no rotation: on the team, never woken.
    const risks = await getConfigRisks(page, team.id);
    testLogger.info('TS-04.02 derived risks', { kinds: (risks?.risks ?? []).map((r) => r.kind) });
    const stranded = (risks?.risks ?? []).filter((r) => String(r.message ?? '').includes(emails[2]));
    expect(stranded.length, `a member on no rotation must be raised as a risk naming them (${emails[2]})`)
      .toBeGreaterThan(0);
    expect(stranded[0].message, 'the risk has to say what is wrong in words, not just a kind')
      .toMatch(/rotation|on call|schedule/i);

    // And the screen has to carry it, not only the API.
    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'overview');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.expectConfigRiskTagVisible();
    const count = await pm.oncallTeamDetailPage.readConfigRiskCount();
    expect(count, 'the team screen states the number of risks the server derived')
      .toBe(risks.total);
  });

  // ------------------------------------------------------------------ TS-04.04

  test('every member payload that adds nobody is refused, with a message naming the field', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_w02`);
    const emails = await createOrgUsers(page, prefix, 1);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    const endpoint = `${baseUrl()}/api/${ORG}/oncall/teams/${team.id}/members`;
    const post = async (payload) => {
      const res = await page.request.post(endpoint, { headers: getAuthHeaders(), data: payload });
      return { status: res.status(), body: await res.text().catch(() => '') };
    };

    // W-02: all three of these once answered 200 while adding nobody, which is
    // the worst possible outcome — a team that looks staffed and pages no one.
    for (const payload of [{}, { user_emails: [] }, { members: [emails[0]] }]) {
      const res = await post(payload);
      testLogger.info('TS-04.04 empty-add payload', { payload, status: res.status, body: res.body.slice(0, 200) });
      expect(res.status, `a body that adds nobody must be refused, not accepted: ${JSON.stringify(payload)}`)
        .toBe(400);
      expect(res.body, 'the refusal names the field the caller should have sent')
        .toMatch(/user_email/i);
    }

    // A malformed address is refused at the same gate.
    const malformed = await post({ user_emails: ['not-an-address'] });
    testLogger.info('TS-04.04 malformed address', malformed);
    expect(malformed.status, 'a malformed address is not a member').toBe(400);

    // A well-formed address that is not in the org is refused with the fix in
    // the message — being pageable requires being in the org first.
    const outsider = await post({ user_emails: [`${prefix}_outsider@o2-qa.com`] });
    testLogger.info('TS-04.04 non-org user', outsider);
    expect(outsider.status, 'somebody who is not in the org cannot be put on call').toBe(400);
    expect(outsider.body, 'the refusal tells the reader what to do about it')
      .toMatch(/organization|org/i);

    // Nothing above added anybody: the roster is exactly what it was.
    const after = (await listTeamMembers(page, team.id)).map((m) => m.user_email);
    expect(after, 'a refused add must not partially land').toEqual(emails);
  });

  /**
   * TS-04.03 — taking the current pager holder off the team is a warned act,
   * and the pager lands on somebody.
   *
   * Removing whoever is on call RIGHT NOW is the one member edit that can
   * silently un-staff a live rotation: every alert routed at this team keeps
   * firing, and the ladder's first rung resolves to nobody. So two things are
   * required and both are asserted — the screen warns before it happens, and
   * afterwards the engine names a DIFFERENT person rather than an empty slot.
   *
   * The engine, not the roster, is the oracle: a roster that still lists two
   * people proves nothing about who a page would reach.
   */
  test('TS-04.03 removing the person currently on call warns first, and the pager moves to somebody else', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_holder`);
    const users = await createOrgUsers(page, name, 3);
    const team = await createTeam(page, { name, timezone: 'UTC' });
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: users })],
    });
    await addTeamMembers(page, team.id, users);

    const before = (await whoIsOnCall(page, team.id)) ?? [];
    expect(before.length, 'somebody must be on call before this test removes them')
      .toBeGreaterThan(0);
    const holder = before[0].user_email;

    await pm.oncallTeamDetailPage.goto(ORG, team.id);
    await pm.oncallTeamDetailPage.openTab('members');
    await expect(pm.oncallTeamDetailPage.getMembersTable())
      .toBeVisible({ timeout: 30000 });

    // Member controls key off the ROW id, never the email, so the holder's row
    // is found by its rendered address and the control taken from inside it.
    const holderRow = pm.oncallTeamDetailPage.getMemberRowByText(holder);
    await expect(holderRow, 'the holder must be listed before being removed')
      .toBeVisible({ timeout: 30000 });
    const removeBtn = pm.oncallTeamDetailPage.getMemberRemoveIn(holderRow);
    await expect(removeBtn, 'the holder\'s row must offer a remove control').toBeVisible();
    await removeBtn.click();

    // The warning is the point: removing the live holder must not be a
    // one-click act with no statement of what it does.
    //
    // NOTE, and it is a gap worth recording rather than failing on: the copy is
    // the SAME whether or not this person is holding the pager at this instant
    // ("They will no longer be paged for this team. Any rotation position they
    // hold goes with them."). Removing the person currently on call reads
    // exactly like removing somebody on the bench. Asserted here as the
    // consequence being stated at all; the missing distinction is in the
    // generation report.
    const confirm = pm.oncallTeamDetailPage.getConfirmDialog();
    await expect(confirm, 'removing the person on call must be confirmed, not done silently')
      .toBeVisible({ timeout: 20000 });
    await expect(
      confirm,
      'and the confirmation must state the consequence, not just ask "are you sure"',
    ).toContainText(/paged|on call|rotation/i);

    await pm.oncallTeamDetailPage.getConfirmOkIn(confirm).click();
    await expect(confirm).toBeHidden({ timeout: 30000 });

    await expect
      .poll(async () => ((await whoIsOnCall(page, team.id)) ?? [])[0]?.user_email, {
        timeout: 30000,
        message: 'after removing the holder the pager must land on the next person, never on nobody',
      })
      .not.toBe(holder);

    const after = (await whoIsOnCall(page, team.id)) ?? [];
    expect(after.length, 'the rotation must still put somebody on call').toBeGreaterThan(0);
    expect(after[0].user_email, 'and that somebody must be a real remaining member')
      .toBeTruthy();
  });

});
