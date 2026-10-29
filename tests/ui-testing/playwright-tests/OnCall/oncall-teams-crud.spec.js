/**
 * On-Call — teams list, the create/edit drawer, and the way out of it (§11.1)
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md (§11.1, plus the list
 * CRUD the rest of the suite depends on being able to reach).
 *
 * ENTERPRISE-GATED (@enterprise, never @all). `isOnCallAvailable()` skips on an
 * OSS build and fails an enterprise build that has on-call switched off.
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
  waitForPages,
  listResponses,
  getDeliveries,
  getEscalationProgress,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  getResponseRecord,
  getResponseHistory,
  eventsOfKind,
  resolveResponse,
  shortenPolicyForSpeed,
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

    // A created team opens straight away; the list is one step back.
    await expect(page, 'create must open the new team')
      .toHaveURL(/\/oncall\/teams\/[^/?]+/, { timeout: 30000 });
    await pm.oncallTeamsPage.goto(ORG);

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

  test.fixme('the policies button leaves the teams list for the policies screen — nothing links to /oncall/policies since #14502. o2-enterprise#2628', {
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

  test('TS-03.04b changing a team\'s timezone re-evaluates its restriction windows in the new zone', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_tz`);
    const [member] = await createOrgUsers(page, name, 1);
    const team = await createTeam(page, { name, timezone: 'UTC' });
    // Weekdays and weekends alike, so the instants below need no day-of-week arithmetic.
    const officeHours = { days: [0, 1, 2, 3, 4, 5, 6], start_minute: 9 * 60, end_minute: 17 * 60 };
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: [member], restrictions: [officeHours] })],
    });
    await addTeamMembers(page, team.id, [member]);

    // Tomorrow 01:00 UTC is 10:00 in Tokyo; tomorrow 10:00 UTC is 19:00 in Tokyo.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const at = (hourUtc) => Date.UTC(
      tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), hourUtc,
    ) * 1000;
    const onCallAt = async (micros) => (await whoIsOnCall(page, team.id, micros)).map((slot) => slot.user_email);

    expect(await onCallAt(at(1)), 'before the move, 01:00 UTC is outside UTC office hours').not.toContain(member);
    expect(await onCallAt(at(10)), 'before the move, 10:00 UTC is inside UTC office hours').toContain(member);

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    await pm.oncallTeamsPage.selectTimezone('Asia/Tokyo');
    await pm.oncallTeamsPage.saveDrawer();
    await expect(pm.oncallTeamsPage.getFormDrawer()).toBeHidden({ timeout: 30000 });

    await expect
      .poll(async () => (await getTeamSchedule(page, team.id))?.timezone, {
        timeout: 20000, message: 'the schedule must move with the team it belongs to',
      })
      .toBe('Asia/Tokyo');
    expect(await onCallAt(at(1)), '01:00 UTC is 10:00 in Tokyo, inside the moved office hours').toContain(member);
    expect(await onCallAt(at(10)), '10:00 UTC is 19:00 in Tokyo, outside the moved office hours')
      .not.toContain(member);
  });

  test('TS-03.05 deleting a team with a live page stops its ladder and leaves the page open for a new owner', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    test.setTimeout(600_000);
    const name = uniqueName(`${workerPrefix(testInfo)}_live`);
    const users = await createOrgUsers(page, name, 2);
    const team = await createTeam(page, { name, timezone: 'UTC' });
    await addTeamMembers(page, team.id, users);
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: users })],
    });
    // A second rung 45s out, so "nothing was delivered after the delete" covers a rung that was really due.
    await shortenPolicyForSpeed(page, team.id, 2, [0, 45]);

    const stream = `${name}_stream`;
    await seedOnCallStream(page, stream);
    await waitForStreamSearchable(page, stream, 1);
    const destination = await seedNotificationDestination(page, name);
    const alert = await createPagingAlert(page, {
      name: `${name}_alert`, stream, teamId: team.id, priority: 2,
      destinations: [destination],
    });
    const [openRecord] = await waitForPages(page, { alertId: alert.id, expected: 1, expectTeamId: team.id });

    await expect.poll(async () => (await getDeliveries(page, openRecord.id))?.total ?? 0, {
      timeout: 60000, intervals: [1000], message: 'the first rung must have paged before the team goes',
    }).toBeGreaterThan(0);
    const ledgerAtDelete = await getDeliveries(page, openRecord.id);
    expect(ledgerAtDelete.deliveries.map((row) => row.rung_micros),
      'the second rung must still be pending when the team is deleted').toEqual(
      ledgerAtDelete.deliveries.map(() => 0),
    );

    const deletedAtMicros = Date.now() * 1000;
    const deleted = await deleteTeamExpectingStatus(page, team.id);
    expect(deleted.status, `deleting a non-default team is allowed: ${deleted.text}`).toBe(200);

    const record = await getResponseRecord(page, openRecord.id);
    testLogger.info('TS-03.05 record after the team delete', record);
    expect(record.state, 'the page stays open: somebody still has to own it').toBe('triggered');
    expect(record.exhausted_at, 'the ladder is stopped, and the record says when').toBeTruthy();
    expect(record.team_id, 'the record keeps naming the team it was lost from').toBe(team.id);

    const exhausted = eventsOfKind(await getResponseHistory(page, openRecord.id), 'exhausted');
    expect(exhausted.length, 'the timeline must say once why the ladder stopped').toBe(1);
    expect(exhausted[0].actor, 'the engine stopped it, not a person').toBe('o2-engine');
    expect(exhausted[0].body, 'and say it was the team delete').toMatch(/owning team was deleted/);

    const progress = await getEscalationProgress(page, openRecord.id);
    expect(progress.stopped_because, 'the escalation view names the same reason')
      .toMatch(/owning team was deleted/);
    expect(progress.next_at ?? null, 'and schedules nothing further').toBeNull();

    await page.waitForTimeout(60_000);
    const ledgerAfter = await getDeliveries(page, openRecord.id);
    expect(ledgerAfter.deliveries.filter((row) => row.at > deletedAtMicros),
      'the pending rung must not fire once its team is gone').toEqual([]);

    const open = await listResponses(page, { subjectType: 'alert', sourceId: alert.id });
    expect(open.map((r) => r.id), 'the page stays on the open list until somebody closes it')
      .toContain(openRecord.id);
    const resolved = await resolveResponse(page, openRecord.id, { cause: 'noisy_threshold' });
    expect(resolved.status, `a page whose team is gone can still be closed: ${resolved.text}`).toBe(200);
    expect((await getResponseRecord(page, openRecord.id)).state).toBe('resolved');
  });

});
