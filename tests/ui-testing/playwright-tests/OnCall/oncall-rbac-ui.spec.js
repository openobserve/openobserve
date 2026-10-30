/**
 * On-Call — what the screen draws for a role that may not configure (§10.5)
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md §10.5 —
 *   "UI, per role: controls that the API refuses are not rendered."
 *   It is called out as the gap that let openobserve/o2-enterprise#2601
 *   through: the manual pass asserted API status codes and never asserted what
 *   the screen drew.
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHAT §10.5 ASKS FOR IS NOT WHAT MAIN DOES, AND THE DIVERGENCE IS DELIBERATE.
 * `useOnCallPermissions` carries this in its own comment: the API has no
 * "what may I do" endpoint and role strings vary by provisioning path (native
 * vs SSO/SCIM), so controls render OPTIMISTICALLY and the server is the real
 * gate. `canConfigure` is `!deniedOrgs.includes(org)` — it starts TRUE and only
 * flips once a configuration write has actually been refused and the 403
 * caught by `noteConfigurationDenied`. On a cold load a `viewer` therefore
 * legitimately sees New team, edit and delete, and a spec asserting those are
 * hidden on first paint would fail against correct behaviour.
 *
 * So the contract this spec encodes is the OBSERVED one:
 *   1. a role that may configure sees the controls (the UI half of §10.2), and
 *   2. once a configuration write is refused, the controls latch closed and the
 *      denial is explained rather than swallowed.
 * (2) is what actually protects a read-only user in this design, and it is what
 * #2601 needed and did not have. It is driven by refusing one write at the
 * network edge rather than by signing in as a viewer, because this harness has
 * a single authenticated session and no per-role storage state — provisioning a
 * second identity is out of scope here and is where the API suite's
 * `test_oncall_rbac.py` does the role matrix properly (§10.1-§10.4).
 *
 * BLOCKED, and recorded rather than faked: a viewer's cold load. It needs a
 * second signed-in session, and even with one the assertion the plan writes
 * ("controls are not rendered") would be wrong against this implementation
 * until the first refused write lands. Closing §10.5 as the plan words it needs
 * a product change — a permissions endpoint, or role-aware gating — not a test.
 *
 * Self-cleaning, worker-scoped prefix.
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

const PREFIX = 'e2e_oncall_rbac';

/** `oncall.configDenied`, which is what a refused configuration write must say. */
const DENIED_WORDING = /permission to change on-call configuration/i;

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

/**
 * Refuse exactly the on-call configuration WRITES, and nothing else.
 *
 * Reads have to keep working or the screen never renders the controls whose
 * disappearance is the subject — so this is scoped by method, not by URL alone.
 * `/config` is never touched: the app's bootstrap reads it, and intercepting it
 * hangs the nav rail rather than testing anything.
 */
async function refuseOnCallWrites(page) {
  await page.route('**/api/*/oncall/**', async (route, request) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method())) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Forbidden' }),
      });
      return;
    }
    await route.continue();
  });
}

test.describe.configure({ mode: 'parallel' });

test.describe('On-call configuration controls and permission', {
  tag: ['@oncall', '@oncallRbac', '@enterprise'],
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

  // ------------------------------------------------- the configuring half

  /**
   * §10.5, positive limb: the UI counterpart of §10.2.
   *
   * A role the API accepts must be offered the controls. Worth pinning on its
   * own: the latch below is module state shared by every component using the
   * composable, so a bug that left it latched would hide the controls from
   * everybody and nothing else on the screen would say why.
   */
  test('§10.5 a role that may configure is offered the create and row controls', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectAvailable();
    await pm.oncallTeamsPage.expectCreateControlVisible();
    await pm.oncallTeamsPage.revealTeam(team.id, name);
    await expect(pm.oncallTeamsPage.getEditButton(team.id)).toBeVisible({ timeout: 30000 });
    await expect(pm.oncallTeamsPage.getDeleteButton(team.id)).toBeVisible({ timeout: 30000 });

    await pm.oncallTeamDetailPage.goto(ORG, team.id);
    await expect(
      pm.oncallTeamDetailPage.getEditButton(),
      'the team detail offers its own edit while the role may configure',
    ).toBeVisible({ timeout: 30000 });
  });

  // ----------------------------------------------------- the refused half

  /**
   * §10.5, as main enforces it: the server's refusal is what closes a control.
   *
   * Three things have to happen together, and any one of them alone would be a
   * worse product: the write must not silently appear to succeed, the reader
   * must be told it was a permission problem rather than a failure, and the
   * control must stop being offered so the refusal is not rediscovered on every
   * click.
   */
  test('§10.5 a refused configuration write explains itself and latches the controls closed', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name, description: 'before' });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectCreateControlVisible();

    // Only from here on: the fixture above had to be created for real.
    await refuseOnCallWrites(page);

    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    await pm.oncallTeamsPage.fillTeamDescription('after');
    await pm.oncallTeamsPage.saveDrawer();

    await expect(
      pm.oncallTeamsPage.getDeniedNotice(DENIED_WORDING),
      'a 403 must be named as a permission problem, not as a generic save failure',
    ).toBeVisible({ timeout: 20000 });

    await expect(
      pm.oncallTeamsPage.getAddButton(),
      'once a write has been refused the create control must stop being offered',
    ).toHaveCount(0, { timeout: 20000 });
    await pm.oncallTeamsPage.expectRowActionsHidden(team.id, { name });

    // The refusal must be real: nothing may have been written.
    const stored = await getTeam(page, team.id);
    expect(stored?.description, 'a refused write must not have changed the team').toBe('before');
  });

  /**
   * The latch is a module-level cache keyed by org, so it must hold across a
   * ROUTE change — otherwise a reader who moved to the team screen would be
   * offered the same refused controls again and learn nothing from the first
   * denial.
   *
   * The move is a row click (router.push), not `goto`: a full page load drops
   * the cache and re-renders optimistically, which is the composable's design
   * rather than a regression, and navigating that way would test the reload.
   */
  test('§10.5 the latch holds across a route change inside the app', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectCreateControlVisible();
    await refuseOnCallWrites(page);

    await pm.oncallTeamsPage.openEditDrawer(team.id, { name });
    await pm.oncallTeamsPage.fillTeamDescription('after');
    await pm.oncallTeamsPage.saveDrawer();
    await expect(pm.oncallTeamsPage.getDeniedNotice(DENIED_WORDING)).toBeVisible({ timeout: 20000 });
    await pm.oncallTeamsPage.cancelDrawer();

    await pm.oncallTeamsPage.openTeam(name);
    await pm.oncallTeamDetailPage.expectDetailVisible();
    await pm.oncallTeamDetailPage.expectConfigurationControlsHidden();
  });
});
