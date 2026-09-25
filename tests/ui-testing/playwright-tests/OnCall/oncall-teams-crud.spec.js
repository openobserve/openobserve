/**
 * On-Call — teams list, the create/edit drawer, and the way out of it (§11.1)
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md (§11.1, plus the list
 * CRUD the rest of the suite depends on being able to reach).
 *
 * ENTERPRISE-GATED. On-call answers 404 (feature off) or 403 "Not Supported"
 * (OSS build) on every route, and the product treats both as the same calm
 * fact. `isOnCallAvailable()` turns that into one boolean, so an OSS runner
 * SKIPS with a reason instead of failing thirty seconds into a table timeout.
 * Tagged @enterprise, never @all.
 *
 * Self-cleaning: every team is named `e2e_oncall_teams_w<worker>_*` and swept
 * by that prefix in afterAll. `afterAll` runs once PER WORKER in parallel mode,
 * so a worker that finished early would otherwise delete fixtures another
 * worker is still using — see the docblock in SLO/slo-crud.spec.js.
 *
 * The team form is an ODrawer, so Save is `o-drawer-primary-btn` scoped inside
 * `oncall-team-form-drawer`. `o-dialog-primary-btn` is the ConfirmDialog's, and
 * the delete confirmation is the only dialog on this screen.
 *
 * Deliberately NOT asserted here: coverage tags, primary-gap alarms and
 * on-call-now cells. Those are properties of a SCHEDULE, and a team created
 * through this drawer has no members to staff one — asserting them here would
 * be asserting the schedule seeding, which oncall-schedule.spec.js owns.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  getTeam,
  listTeams,
  getTeamSchedule,
  setTeamSchedule,
  addTeamMembers,
  listTeamMembers,
  whoIsOnCall,
  rotation,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  createPagingAlert,
  triggerAlertOrLetSchedulerFire,
  waitForPages,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  getResponseRecord,
  getResponseHistory,
  deleteTeamExpectingStatus,
} = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_teams';

/** Names are scoped to the WORKER, not just the spec — see the docblock. */
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/** Probed once per worker: the answer is a fact about the deployment, not the test. */
const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call teams CRUD', { tag: ['@oncall', '@oncallTeams', '@enterprise'] }, () => {
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
    // A fresh context: the per-test pages are already closed by here.
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteOnCallFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  // ---------------------------------------------------------------- P0 smoke

  test('teams list loads with its table and a way to add a team', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectAvailable();
    await pm.oncallTeamsPage.expectListVisible();
    await pm.oncallTeamsPage.expectCreateControlVisible();
  });

  test('creates a team through the drawer and it appears in the list', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.createTeam({ name, description: 'created by e2e' });

    // Row selectors carry the team ID, not its name, so the id has to come from
    // the server rather than from what was typed.
    await pm.oncallTeamsPage.search(name);
    const row = pm.oncallTeamsPage.getRows();
    await expect(row, 'the created team must be in the list').toHaveCount(1);
  });

  // ------------------------------------------------------------- P1 functional

  test('the edit drawer hydrates the stored team and saves a change', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name, description: 'before' });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });

    const nameField = pm.oncallTeamsPage.getFormNameField();
    await expect(nameField, 'the drawer must open on the stored name').toHaveValue(name);

    await pm.oncallTeamsPage.fillTeamDescription('after');
    await pm.oncallTeamsPage.saveDrawer();
    await expect(pm.oncallTeamsPage.getFormDrawer()).toBeHidden({ timeout: 30000 });

    // Read the server, not the row: the list refreshes asynchronously after a
    // save, and a stale row would pass an assertion the store would fail.
    await expect
      .poll(async () => (await getTeam(page, team.id))?.description, { timeout: 20000 })
      .toBe('after');
  });

  /**
   * §11.1 — the pencil on the list must not be a dead end.
   *
   * The drawer edits a NAME and a timezone; members, the schedule and the
   * escalation policy each have a screen of their own, so the drawer's only
   * honest answer to "where do I add people" is a route to them. The assertion
   * is that the route lands on a team detail offering all three tabs, not that
   * a button with the right words exists.
   */
  test('§11.1 the edit drawer offers a route to members, schedule and escalation', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });

    const manage = pm.oncallTeamsPage.getFormManageLink();
    await expect(manage, 'the edit drawer must offer a way on to the team').toBeVisible();

    await pm.oncallTeamsPage.clickManageTeam();
    await pm.oncallTeamDetailPage.expectDetailVisible();

    for (const tab of ['members', 'schedule', 'escalation']) {
      await expect(
        pm.oncallTeamDetailPage.getTabButton(tab),
        `the team detail must offer a ${tab} tab`,
      ).toBeVisible({ timeout: 20000 });
    }
  });

  /**
   * The drawer's create-only fields.
   *
   * Members and the first shift are offered while CREATING and withdrawn once
   * the team exists — after that they have screens of their own, and two places
   * to edit one thing is how they come to disagree.
   */
  test('membership fields are offered on create and withdrawn on edit', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openCreateDrawer();
    await expect(pm.oncallTeamsPage.getFormMembers()).toBeVisible();
    await pm.oncallTeamsPage.cancelDrawer();

    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    await expect(
      pm.oncallTeamsPage.getFormMembers(),
      'the edit drawer must not duplicate the members screen',
    ).toHaveCount(0);
  });

  test('search filters the list by name', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const kept = uniqueName(`${workerPrefix(testInfo)}_kept`);
    const other = uniqueName(`${workerPrefix(testInfo)}_other`);
    const keptTeam = await createTeam(page, { name: kept });
    const otherTeam = await createTeam(page, { name: other });

    await pm.oncallTeamsPage.goto(ORG);

    // Asserting both rows are on screen BEFORE filtering only works while the
    // whole org fits on one page; past that the baseline fails for a reason the
    // filter has nothing to do with. Searching each name in turn proves the same
    // thing without depending on how many teams the org happens to hold.
    await pm.oncallTeamsPage.search(kept);
    await pm.oncallTeamsPage.expectRowVisible(keptTeam.id);
    await pm.oncallTeamsPage.expectRowAbsent(otherTeam.id);

    await pm.oncallTeamsPage.search(other);
    await pm.oncallTeamsPage.expectRowVisible(otherTeam.id);
    await pm.oncallTeamsPage.expectRowAbsent(keptTeam.id);
  });

  /**
   * The delete confirmation names the team before it removes it.
   *
   * Deleting a team leaves every alert routed to it paging nobody, which is why
   * the dialog exists at all — a confirmation that did not name what it was
   * about would be a click tax rather than a check.
   */
  test('the delete confirmation names the team, and deleting removes it', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openDeleteDialog(team.id, { name });
    await expect(pm.oncallTeamsPage.getConfirmDialog()).toContainText(name);

    await pm.oncallTeamsPage.getConfirmOk().click();
    await expect(pm.oncallTeamsPage.getConfirmDialog()).toHaveCount(0, { timeout: 20000 });
    await pm.oncallTeamsPage.expectRowDeleted(team.id);
  });

  // -------------------------------------------------------------- P2 edge cases

  /**
   * `oncall-teams-policies-btn` NAVIGATES to /oncall/policies. It reads like a
   * filter on this screen and is not one — a spec that treated it as one would
   * pass on an empty list forever.
   */
  test.fixme('the policies button leaves the teams list for the policies screen — not wired: the button was deleted in f6ad43986f (#14502) and nothing replaced it; the oncall/policies route still registers and renders but no component links to it, so the screen is reachable only by typing the URL. o2-enterprise#2481', {
    tag: ['@P2'],
  }, async ({ page }) => {
    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openPolicies();
    await expect
      .poll(() => page.url(), { timeout: 20000 })
      .toContain('/oncall/policies');
  });

  test('cancelling the create drawer writes nothing', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openCreateDrawer();
    await pm.oncallTeamsPage.fillTeamName(name);
    await pm.oncallTeamsPage.cancelDrawer();

    // ANCHOR FIRST. An empty list is also exactly what a screen that failed to
    // load looks like, and a bare row count was this test's ONLY assertion — so
    // establish that the table actually rendered before reading anything into
    // the emptiness.
    await pm.oncallTeamsPage.expectListVisible();
    await pm.oncallTeamsPage.search(name);
    await expect(
      pm.oncallTeamsPage.getRows(),
      'a cancelled drawer must not have created a team',
    ).toHaveCount(0);

    // And the server agrees, which is the half a rendered list cannot show.
    const stored = (await listTeams(page)) ?? [];
    expect(
      stored.some((t) => t?.name === name),
      'nor may the cancelled name be stored, whatever the list happens to render',
    ).toBe(false);
  });

  // ============================================================== Tier 2

  /**
   * TS-03.03 — auto-staffing is an offer, not a default.
   *
   * The create drawer offers to put everybody in the org on the new team and
   * give it a first shift. Declining must produce a team that is HONESTLY
   * empty — not one quietly staffed with whoever happened to be in the org,
   * because a team you did not staff paging people you did not choose is worse
   * than a team that pages nobody and says so.
   *
   * So the assertion is both halves: nobody was added, AND the list flags the
   * unstaffed team rather than rendering it as if it were ready.
   */
  test('TS-03.03 declining auto-staffing leaves the team honestly empty, and the list says so', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openCreateDrawer();
    await expect(
      pm.oncallTeamsPage.getFormAddEveryone(),
      'the drawer must actually be offering to staff the team, or this case tests nothing',
    ).toBeVisible();

    // Fill in the name and nothing else — the offer is declined by not taking it.
    await pm.oncallTeamsPage.fillTeamName(name);
    await pm.oncallTeamsPage.saveDrawer();
    await expect(pm.oncallTeamsPage.getFormDrawer()).toBeHidden({ timeout: 30000 });

    await pm.oncallTeamsPage.search(name);
    const row = pm.oncallTeamsPage.getRows();
    await expect(row, 'the team must exist').toHaveCount(1);
    const teamId = await pm.oncallTeamsPage.readFirstRowTeamId();

    // ANCHOR FIRST. Both assertions below are about something NOT being there,
    // and an empty list is what a failed read looks like too. So establish that
    // the endpoints actually answered before reading anything into the emptiness.
    const stored = await getTeam(page, teamId);
    expect(stored?.id, 'the team must be readable from the server before its roster is judged')
      .toBe(teamId);

    const members = await listTeamMembers(page, teamId);
    expect(Array.isArray(members), 'the members endpoint must have answered with a list')
      .toBe(true);
    expect(members, 'declining the offer must add nobody at all').toHaveLength(0);

    const slots = await whoIsOnCall(page, teamId);
    expect(Array.isArray(slots), 'the on-call endpoint must have answered with a list').toBe(true);
    expect(slots, 'and an unstaffed team must put nobody on call rather than guess')
      .toHaveLength(0);

    await pm.oncallTeamsPage.expectPrimaryGap(teamId, { name });
  });

  /**
   * TS-03.04 — a rename reaches every surface that names the team.
   *
   * A team's name is its identity to a human under pressure: it is on the
   * pages list, on the record header and on the routing rule that sends work
   * to it. A rename that reached only the list would leave somebody reading a
   * stale name on the screen that matters most.
   */
  test('TS-03.04 renaming a team and changing its timezone propagates to the stored team and its screens', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const before = uniqueName(`${workerPrefix(testInfo)}_was`);
    const after = uniqueName(`${workerPrefix(testInfo)}_now`);
    const team = await createTeam(page, { name: before, timezone: 'UTC' });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openEditDrawer(team.id, { name: before });
    await pm.oncallTeamsPage.fillTeamName(after);
    // NOT `Asia/Kolkata`, which this picker cannot offer: the options come from
    // `Intl.supportedValuesOf("timeZone")` (utils/oncall.ts:408) and Chromium's
    // ICU still canonicalises India to the legacy `Asia/Calcutta` — verified on
    // :5090, where the zone list holds Calcutta and no Kolkata at all. The case
    // is "a zone change propagates", not "this particular zone exists", so it
    // uses one whose canonical name no ICU release has ever moved.
    await pm.oncallTeamsPage.selectTimezone('Asia/Tokyo');
    await pm.oncallTeamsPage.saveDrawer();
    await expect(pm.oncallTeamsPage.getFormDrawer()).toBeHidden({ timeout: 30000 });

    await expect
      .poll(async () => (await getTeam(page, team.id))?.name, { timeout: 20000 })
      .toBe(after);
    expect((await getTeam(page, team.id))?.timezone, 'the new zone must be stored on the team')
      .toBe('Asia/Tokyo');

    // The list, searched by the NEW name — a rename that did not reach the
    // index would leave the team findable only by a name that no longer exists.
    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.search(after);
    await pm.oncallTeamsPage.expectRowVisible(team.id);

    // And the detail screen, which is what somebody opens from a page record.
    await pm.oncallTeamDetailPage.goto(ORG, team.id);
    await expect(
      pm.oncallTeamDetailPage.getRoot(),
      'the team detail must render the team under its new name',
    ).toContainText(after, { timeout: 30000 });
  });

  /**
   * The other half of TS-03.04: restriction windows re-evaluated in the new zone.
   *
   * PARKED — and it is a real split-brain, not a missing feature.
   *
   * The engine evaluates a rotation's restriction windows in the SCHEDULE's
   * stored `timezone`. `PUT /oncall/teams/{id}` changes the TEAM's timezone and
   * leaves the schedule's alone — verified against :5090: after moving a team
   * from UTC to Asia/Kolkata, `GET .../schedule` still answered
   * `"timezone": "UTC"` and a 09:00-17:00 weekday restriction still fired on
   * UTC hours (Wed 06:00 UTC = 11:30 IST resolved to NOBODY on call).
   *
   * Meanwhile the UI renders the whole schedule in the team's NEW zone:
   * OnCallTeamDetail.vue passes `:timezone="team?.timezone"` into every
   * schedule component, and OnCallScheduleEditor.vue only writes that zone onto
   * the schedule when somebody SAVES the schedule. So between a timezone change
   * and the next schedule save, the screen shows the roster in one zone and the
   * pager fires in another — on the one question the screen exists to answer.
   *
   * Left as a failing expectation on purpose: it goes green the day the team
   * write propagates the zone (or the UI stops claiming it has).
   */
  test.fixme('TS-03.04b changing a team\'s timezone re-evaluates its restriction windows in the new zone — not wired: PUT /oncall/teams/{id} changes the team zone but leaves the schedule at its own stored zone, so the engine keeps evaluating restrictions in the old one while the UI renders the new one, verified 16 Sep on :5090. o2-enterprise#2481.', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_tz`);
    const team = await createTeam(page, { name, timezone: 'UTC' });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    // The zone the picker can actually offer — see the note in TS-03.04. The
    // split-brain below is about the schedule not following the team, not about
    // which zone was chosen, and Kolkata is not in this runtime's ICU list.
    await pm.oncallTeamsPage.selectTimezone('Asia/Tokyo');
    await pm.oncallTeamsPage.saveDrawer();

    await expect
      .poll(async () => (await getTeamSchedule(page, team.id))?.timezone, { timeout: 20000 })
      .toBe('Asia/Tokyo');
  });

  /**
   * TS-03.05 — deleting a team must never leave a live page pointing at nothing.
   *
   * Either answer is acceptable and the case accepts both: refuse the delete
   * and list what is still open, or close the records with an explicit timeline
   * entry saying the team was deleted. What is not acceptable is the third
   * outcome — the team vanishes and the open record keeps a `team_id` that
   * resolves to nothing, so the record can never be routed, escalated or
   * handed off again and nothing on screen says why.
   */
  /**
   * TS-03.05 — PARKED. A real product gap, not a test that asks too much.
   *
   * `delete_team` (o2-enterprise .../oncall/service.rs:183) refuses ONLY when the
   * team is the org's nominated default. Past that it deletes ownership rules,
   * overrides, schedules and policies — and never queries `oncall_responses` at
   * all. Its own doc comment states the intent: "Response records are kept: they
   * are history, and history has to survive a reorg."
   *
   * That reasoning holds for a RESOLVED record. It does not hold for an OPEN one:
   * the delete succeeds (200), the page stays `triggered` against a `team_id`
   * that no longer resolves, and nothing escalates it any further — the ladder,
   * the schedule and the policy it would have climbed were all just deleted. The
   * record is not history; it is a live page nobody will ever be woken for, and
   * no timeline entry says why.
   *
   * The asymmetry is the argument that this is an oversight rather than a
   * decision: taking ONE MEMBER off a team already does the check. The same file
   * carries `open_records_acknowledged_by` (service.rs:1038), which calls
   * `oncall_responses::list_open` for the team and reports the open records that
   * person can no longer close. Deleting the entire team — which strands every
   * open record, not one person's — skips it.
   *
   * The test accepts EITHER honest answer — refuse and name what is still open,
   * or allow and close the record with a timeline entry. The product does
   * neither, verified 16 Sep on :5090. The body is left intact so it goes green
   * the day one of the two is implemented.
   */
  test.fixme('TS-03.05 a team with a live page cannot be deleted into a dangling reference — not wired: delete_team (o2-enterprise oncall/service.rs:183) refuses only for the org default team and never queries oncall_responses, so DELETE /oncall/teams/{id} returns 200 while an open page stays triggered against a team, schedule and policy that no longer exist, with no timeline entry, verified 16 Sep on :5090. o2-enterprise#2481.', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(600_000);
    const name = uniqueName(`${workerPrefix(testInfo)}_live`);
    const users = await createOrgUsers(page, name, 2);
    const team = await createTeam(page, { name, timezone: 'UTC' });
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: users })],
    });
    await addTeamMembers(page, team.id, users);

    const stream = `${name}_stream`;
    await seedOnCallStream(page, stream);
    await waitForStreamSearchable(page, stream, 1);
    const destination = await seedNotificationDestination(page, name);
    const alert = await createPagingAlert(page, {
      name: `${name}_alert`, stream, teamId: team.id, priority: 2,
      destinations: [destination],
    });
    await triggerAlertOrLetSchedulerFire(page, alert.id);
    const pages = await waitForPages(page, { alertId: alert.id, expected: 1 });
    expect(pages.length, 'the fixture needs a genuinely open page on this team')
      .toBeGreaterThan(0);
    const openRecord = pages[0];

    const deleted = await deleteTeamExpectingStatus(page, team.id);

    if (deleted.status >= 400) {
      // Answer one: refused. The refusal has to name what is still open,
      // or it is a wall rather than an explanation.
      expect(String(deleted.body?.message ?? deleted.text ?? ''),
        'a refusal must say what is still open, not just "cannot delete"')
        .toMatch(/page|open|response|firing/i);
      return;
    }

    // Answer two: allowed — then the record must have been closed, and the
    // timeline must say why, rather than left triggered against a gone team.
    const record = await getResponseRecord(page, openRecord.id);
    expect(record, 'the record must still be readable after its team is deleted').toBeTruthy();
    expect(record.state,
      'deleting the team must close the page it left open rather than strand it')
      .toBe('resolved');

    const events = await getResponseHistory(page, openRecord.id);
    const text = JSON.stringify(events);
    expect(text,
      'and the timeline must carry an explicit entry saying the team was deleted')
      .toMatch(/team.*(delete|removed|gone)/i);
  });

});
