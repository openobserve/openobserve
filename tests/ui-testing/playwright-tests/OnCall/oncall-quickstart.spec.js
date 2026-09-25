/**
 * On-Call — Quick start (schedule presets), §11.2
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md §11.2 —
 *   "Quick start with regions unnamed and unstaffed: Save is disabled, or it
 *    names the missing field — never a silent no-op."
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * THE PLAN'S NOTE UNDER §11.2 IS STALE AGAINST MAIN. It records "still
 * reproduces: Save fires no request, shows no inline error and no toast" from an
 * older build. On main `OnCallSchedulePresets.apply()` sets `attempted`,
 * computes `invalidFields()` and writes `oncall-presets-error` before any
 * request leaves the browser, while Save itself is only `:disabled="!chosen"` —
 * so today the SECOND limb of the plan's disjunction is the one that holds.
 * These tests therefore assert the disjunction the plan actually states rather
 * than either limb of it: disabled with a reason, OR a visible error naming the
 * missing field, and never a silent no-op. That assertion is correct whether or
 * not the fix stays, which is the point of writing it that way.
 *
 * `attemptQuickStartSave()` returns `{disabled, requestSeen, error,
 * invalidFields}`; `requestSeen` is the half that catches the silent no-op, and
 * neither half alone proves it.
 *
 * A team whose schedule already has rotations puts a REPLACE CONFIRMATION
 * between Save and `apply()`, and a confirmation is not a validation verdict —
 * so every test here clears the rotations first. That is also why a brand-new
 * team is not enough: `createTeam` auto-staffs a `source: "default"` rotation,
 * so `rotationCount` is 1 the moment the team exists.
 *
 * Self-cleaning, worker-scoped prefix; `afterAll` runs once per worker.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');
const {
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  detachPolicyFromRotations,
  setTeamSchedule,
  getTeamSchedule,
  baseUrl,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const { createOrgUser, oncallUserEmail } = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_quickstart';

/** The one shape whose rows carry a REQUIRED name — §11.2's "regions". */
const REGIONS_PRESET = 'follow_the_sun';

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

test.describe.configure({ mode: 'parallel' });

test.describe('On-call Quick start', {
  tag: ['@oncall', '@oncallQuickStart', '@enterprise'],
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
   * A staffed team with NO rotations.
   *
   * Members are needed for the preset's people picker to have options at all;
   * the empty rotation list is what keeps the replace confirmation out of the
   * way of the validation under test.
   *
   * THE POLICY HAS TO BE DETACHED BETWEEN THE TWO. Putting the first member on
   * a rotationless team auto-provisions a `source: "default"` rotation and
   * repoints rungs P1..P3 at it, so clearing the rotations afterwards is the
   * §8.5 replacement the server refuses. The schedule-first order the other
   * specs use is no help here — the rotations being written are EMPTY, and an
   * existing-but-rotationless schedule auto-provisions just the same — so this
   * takes the other limb of the server's own advice and edits the policy first.
   */
  async function seedEmptyScheduleTeam(page, testInfo) {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'qs'),
    });

    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });
    await addTeamMembers(page, team.id, [memberEmail]);
    await detachPolicyFromRotations(page, team.id);
    await setTeamSchedule(page, team.id, { rotations: [] });
    // ADDRESSES, not user objects — callers pass these straight to the pickers.
    return { team, members: [memberEmail] };
  }

  async function openQuickStartOn(teamId) {
    await pm.oncallTeamDetailPage.goto(ORG, teamId, 'schedule');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openQuickStart();
  }

  // ---------------------------------------------------------------- P0 smoke

  test('Quick start opens from the timeline and lands on a chosen shape', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }, testInfo) => {
    const { team } = await seedEmptyScheduleTeam(page, testInfo);
    await openQuickStartOn(team.id);

    await expect(pm.oncallTeamDetailPage.getPresetsTabs()).toBeVisible({ timeout: 20000 });
    // The catalogue lands on a shape rather than an empty right-hand pane, so
    // Save's only gate (`!chosen`) is already satisfied when the drawer opens.
    await expect(
      pm.oncallTeamDetailPage.getActivePresetTab(),
    ).toHaveCount(1);
  });

  // ------------------------------------------------------------------ §11.2

  /**
   * §11.2, the whole contract in one assertion.
   *
   * Three outcomes are acceptable and one is not. Acceptable: the button is
   * disabled; or a visible error names what is missing; or the request actually
   * went (which would mean the shape had nothing required left blank). The
   * defect is the fourth: nothing sent, nothing said.
   */
  test('§11.2 Save on an unnamed, unstaffed shape is never a silent no-op', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const { team } = await seedEmptyScheduleTeam(page, testInfo);
    await openQuickStartOn(team.id);

    const regions = pm.oncallTeamDetailPage.getPresetTab(REGIONS_PRESET);
    if (await regions.count()) {
      await pm.oncallTeamDetailPage.chooseQuickStartTemplate(REGIONS_PRESET);
    } else {
      // The catalogue is server-supplied; on a build without the regions shape
      // the landing shape still has a required people picker, which is the same
      // question asked of a different form.
      testLogger.warn('Quick start has no follow_the_sun shape — using the landing shape');
    }

    const outcome = await pm.oncallTeamDetailPage.attemptQuickStartSave();
    testLogger.info('§11.2 Quick start save outcome', outcome);

    const spokeUp = outcome.disabled
      || Boolean(outcome.error)
      || outcome.invalidFields > 0
      || outcome.requestSeen;
    expect(
      spokeUp,
      'Save with required fields blank must disable, or name the gap, or actually send — '
      + `it did none of those: ${JSON.stringify(outcome)}`,
    ).toBe(true);

    // The silent no-op stated explicitly, so a regression reads as itself.
    expect(
      outcome.requestSeen === false && !outcome.error && outcome.invalidFields === 0 && !outcome.disabled,
      'a Save that fires no request AND says nothing is the §11.2 defect',
    ).toBe(false);

    // Whatever the screen did, nothing may have been written.
    if (!outcome.requestSeen) {
      const stored = await getTeamSchedule(page, team.id);
      expect(
        (stored?.rotations ?? []).length,
        'a refused apply must not have created rotations',
      ).toBe(0);
    }
  });

  /**
   * The second limb, pinned precisely.
   *
   * With EXACTLY ONE field still blank, `apply()` takes the single-field branch
   * — the one that names it. Worth its own test because the multi-field branch
   * says only "fix the highlighted fields", which would pass an assertion about
   * naming without naming anything.
   *
   * REACHING THAT BRANCH MEANS FILLING BOTH REGIONS BAR ONE FIELD. The
   * catalogue declares `groups` with `min: 2`, so the shape opens at TWO region
   * rows and each wants a name and a roster: naming only `groups-0` leaves
   * three fields blank and lands on the summary instead. So this fills
   * `groups-1` completely, names `groups-0`, and leaves that one roster empty —
   * the single gap the message then has to name. The catch-all is not in the
   * count: it is optional and its controls stay off screen until overridden,
   * and `invalidFields()` skips a row whose controls are not visible.
   */
  test('§11.2 a named but unstaffed region gets a message naming the gap', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const { team, members } = await seedEmptyScheduleTeam(page, testInfo);
    await openQuickStartOn(team.id);

    const regions = pm.oncallTeamDetailPage.getPresetTab(REGIONS_PRESET);
    test.skip(
      (await regions.count()) === 0,
      'this build\'s preset catalogue has no follow_the_sun shape, which is the only one with a required name',
    );

    await pm.oncallTeamDetailPage.chooseQuickStartTemplate(REGIONS_PRESET);
    // Row keys for a repeated group are `<field>-<index>`, and a group_list
    // opens at its declared minimum — two, for this shape.
    await expect(
      pm.oncallTeamDetailPage.getPresetRow('groups-0'),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      pm.oncallTeamDetailPage.getPresetRow('groups-1'),
      'follow_the_sun declares min: 2 regions, so the second row opens with the shape',
    ).toBeVisible({ timeout: 20000 });

    await pm.oncallTeamDetailPage.fillQuickStartRegionName('groups-0', 'APAC');
    await pm.oncallTeamDetailPage.fillQuickStartRegionName('groups-1', 'EMEA');
    // The member picker offers the TEAM's roster, and the team was staffed with
    // the first org user, so that is the one address certain to be on offer.
    await pm.oncallTeamDetailPage.setQuickStartRegionMembers('groups-1', [members[0]]);

    const outcome = await pm.oncallTeamDetailPage.attemptQuickStartSave();
    testLogger.info('§11.2 named-but-unstaffed outcome', outcome);

    expect(outcome.requestSeen, 'an unstaffed shape must not reach the server').toBe(false);
    expect(
      outcome.error ?? '',
      'the single missing field must be named, not summarised',
    ).toMatch(/needs someone assigned/i);
  });

  /**
   * Applying replaces every rotation the team has, so on a team that already
   * has a schedule the confirmation is the product's own guard — not the
   * validation §11.2 is about. Pinned separately so the two are never confused
   * for one another again.
   */
  test('Save on a team that already has rotations asks before replacing them', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member — listOrgUsers()[0] may belong to another worker and be
    // swept mid-test.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'qs'),
    });
    // No schedule write: the auto-staffed default rotation is enough to make
    // this a replacement.
    const team = await createTeam(page, { name: uniqueName(workerPrefix(testInfo)) });
    await addTeamMembers(page, team.id, [memberEmail]);

    const stored = await getTeamSchedule(page, team.id);
    // An ASSERTION, not a skip: putting the FIRST member on a team with no
    // schedule auto-provisions a `source: "default"` rotation — verified against
    // this build, where the team goes 0 -> 1 rotations on that write. So an empty
    // schedule here is that auto-provisioning having regressed, which is the
    // precondition Quick start's replace guard exists for; skipping would retire
    // the case exactly when it started mattering.
    expect(
      (stored?.rotations ?? []).length,
      'adding the first member must auto-provision a rotation for Quick start to replace',
    ).toBeGreaterThan(0);

    await openQuickStartOn(team.id);
    await pm.oncallTeamDetailPage.applyQuickStart();

    await expect(
      pm.oncallTeamDetailPage.getConfirmDialog(),
      'replacing an existing schedule must be confirmed first',
    ).toBeVisible({ timeout: 20000 });
  });
});
