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
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');

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
    const row = page.locator('[data-test^="oncall-team-edit-"]');
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

    const nameField = page.locator('[data-test="oncall-team-form-name-field"]').first();
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

    const manage = page.locator('[data-test="oncall-team-form-manage-link"]');
    await expect(manage, 'the edit drawer must offer a way on to the team').toBeVisible();

    await pm.oncallTeamsPage.clickManageTeam();
    await pm.oncallTeamDetailPage.expectDetailVisible();

    for (const tab of ['members', 'schedule', 'escalation']) {
      await expect(
        page.locator(pm.oncallTeamDetailPage.tabButton(tab)),
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
    await expect(page.locator('[data-test="oncall-team-form-members"]')).toBeVisible();
    await pm.oncallTeamsPage.cancelDrawer();

    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    await expect(
      page.locator('[data-test="oncall-team-form-members"]'),
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
    await expect(page.locator('[data-test="confirm-dialog"]')).toContainText(name);

    await page.locator(pm.oncallTeamsPage.locators.confirmOk).click();
    await expect(page.locator('[data-test="confirm-dialog"]')).toHaveCount(0, { timeout: 20000 });
    await pm.oncallTeamsPage.expectRowDeleted(team.id);
  });

  // -------------------------------------------------------------- P2 edge cases

  /**
   * `oncall-teams-policies-btn` NAVIGATES to /oncall/policies. It reads like a
   * filter on this screen and is not one — a spec that treated it as one would
   * pass on an empty list forever.
   */
  test('the policies button leaves the teams list for the policies screen', {
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

    await pm.oncallTeamsPage.search(name);
    await expect(
      page.locator('[data-test^="oncall-team-edit-"]'),
      'a cancelled drawer must not have created a team',
    ).toHaveCount(0);
  });
});
