/**
 * On-Call — schedules, the rotation editor, and what the timeline draws
 *
 * Plan: docs/test_generator/features/oncall-test-plan.md
 *   §8.1  an all-day restriction renders `00:00 / 24:00`, never `00:00 / 00:00`
 *   §8.6  a shift rule with nobody in it says so
 *   §11.5 timeline bars carry display names, not raw email addresses
 *
 * ENTERPRISE-GATED (@enterprise). Skips with a reason via `isOnCallAvailable()`
 * rather than failing on an OSS build, where every on-call route is a 404 or a
 * 403 "Not Supported" and the product treats both as the same calm fact.
 *
 * Self-cleaning, worker-scoped prefix — `afterAll` runs once per worker in
 * parallel mode, so each worker sweeps only its own `_w<index>_` names.
 *
 * TWO SURFACES RENDER THE SAME ALL-DAY WINDOW, AND THEY DO NOT AGREE BY DESIGN.
 * The timeline lane collapses 0 -> 1440 to the word "All day"; the rotation
 * editor shows the two boundary minutes, `00:00` and `24:00`. The plan's literal
 * `00:00 / 24:00` is the EDITOR's rendering. Both are asserted, because the
 * defect being guarded — 1440 formatted as `00:00` — would show up as
 * `00:00 / 00:00` on the lane and as a zero-length warning in the editor, and
 * one surface alone would miss half of it.
 *
 * Deliberately NOT asserted: who is on call right now. Resolution is the
 * engine's, it moves with the clock, and pinning a name here would make this
 * spec fail at a shift boundary rather than on a regression. `/on-call` is the
 * API suite's.
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
  allDayRestriction,
  setTeamSchedule,
  getTeamSchedule,
  baseUrl,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const { createOrgUser, oncallUserEmail } = require('../utils/oncall-seed-ext.js');

const PREFIX = 'e2e_oncall_sched';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

const gate = { checked: false, available: false, reason: '' };

/**
 * The org's roster.
 *
 * On-call membership can only name accounts the org already has, and §11.5 is a
 * claim about how a member's DISPLAY name is rendered — so the roster, not a
 * literal, is what a spec has to start from.
 */
async function listOrgUsers(page) {
  const res = await page.request.get(`${baseUrl()}/api/${orgId()}/users`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return [];
  const body = await res.json().catch(() => ({}));
  const list = Array.isArray(body) ? body : (body?.data ?? []);
  return Array.isArray(list) ? list : [];
}

/** What the timeline's `nameOf()` would draw for one roster entry. */
function displayNameOf(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
}

test.describe.configure({ mode: 'parallel' });

test.describe('On-call schedules and rotations', {
  tag: ['@oncall', '@oncallSchedule', '@enterprise'],
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
   * One team, one member, one all-day rotation.
   *
   * The schedule is a FULL REPLACE and must be written before any policy names
   * the rotation, which is why nothing here sets a policy: §8.5 refuses a
   * replacement whose rotation an escalation policy still points at.
   *
   * THE SCHEDULE GOES IN BEFORE THE MEMBERS, and that order is load-bearing
   * rather than stylistic. Putting the first member on a rotationless team
   * auto-provisions a `source: "default"` rotation and repoints rungs P1..P3 at
   * it, so a schedule written afterwards is the §8.5 replacement the server
   * refuses — a 400 about a policy this spec never wrote. Seeding the rotation
   * first leaves that auto-write pointing at OUR rotation instead.
   */
  async function seedAllDayTeam(page, testInfo, { memberEmail }) {
    const name = uniqueName(workerPrefix(testInfo));
    const team = await createTeam(page, { name });

    const rotationId = `${workerPrefix(testInfo)}_rot`;
    await setTeamSchedule(page, team.id, {
      rotations: [rotation({
        id: rotationId,
        name: 'All day cover',
        members: [memberEmail],
        restrictions: [allDayRestriction()],
      })],
    });

    await addTeamMembers(page, team.id, [memberEmail]);
    return { team, rotationId };
  }

  // ---------------------------------------------------------------- P0 smoke

  test('the schedule tab draws a lane for each seeded rotation', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'sch'),
    });

    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.expectLaneVisible(rotationId);

    const lanes = await pm.oncallTeamDetailPage.readLaneIds();
    expect(lanes, 'the seeded rotation id is the lane key').toContain(rotationId);
  });

  // ------------------------------------------------------------------- §8.1

  /**
   * §8.1 — minute 1440 is the whole day, minute 0 is no day at all.
   *
   * `formatMinuteOfDay` special-cases 1440 to `24:00` precisely so a full-day
   * layer and a zero-length one cannot read alike. A rotation that renders
   * `00:00 / 00:00` looks configured on a calendar and wins no hour, which is
   * the failure this case exists to catch.
   */
  test('§8.1 the rotation editor renders an all-day window as 00:00 / 24:00', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'sch'),
    });
    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openRotationEditorFor(rotationId);
    await pm.oncallTeamDetailPage.openShiftRule(0);

    // The "When it applies" section is unfolded already for a rule that carries
    // a restriction, so the window is on screen without opening anything.
    const window = pm.oncallTeamDetailPage.getRuleRestriction(0, 0);
    await expect(window, 'the seeded restriction must be rendered').toBeVisible({ timeout: 20000 });

    const text = ((await window.innerText()) ?? '').replace(/\s+/g, ' ');
    expect(text, 'the opening edge is midnight').toContain('00:00');
    expect(text, 'the closing edge is 24:00, never a second 00:00').toContain('24:00');

    // The zero-length warning is the product's own name for the bug: it fires
    // when start === end, which is exactly what 1440-rendered-as-0 would make.
    await expect(
      pm.oncallTeamDetailPage.getRestrictionNotice(0, 0, 'never matches'),
      'an all-day window must not be read as zero length',
    ).toHaveCount(0);
  });

  test('§8.1 the timeline lane for an all-day rotation never reads 00:00 / 00:00', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'sch'),
    });
    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.expectLaneVisible(rotationId);

    const cadence = pm.oncallTeamDetailPage.getLaneCadence(rotationId);
    await expect(cadence).toBeVisible({ timeout: 20000 });
    const text = ((await cadence.innerText()) ?? '').replace(/\s+/g, ' ');

    expect(text, 'a full day and a zero-length window must not read alike')
      .not.toMatch(/00:00\s*\/\s*00:00/);
    expect(text, 'the lane collapses 0 -> 1440 to a word').toContain('All day');
  });

  // ------------------------------------------------- the rotation editor

  test('the rotation editor opens on the stored rotation name', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'sch'),
    });
    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openRotationEditorFor(rotationId);

    await expect(
      pm.oncallTeamDetailPage.getScheduleNameField(),
    ).toHaveValue('All day cover');
  });

  /**
   * §8.6 — a shift rule with nobody in it is the one state that looks
   * configured on a calendar and pages nobody. The server refuses it, so the
   * drawer has to say so beside the pick that fixes it rather than letting the
   * save fail with a field name.
   */
  test('§8.6 a shift rule with nobody in it is called out in the editor', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const { email: memberEmail } = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'sch'),
    });
    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openRotationEditorFor(rotationId);

    // Rule tabs are indexed by POSITION, so the new rule's index is whatever
    // count the drawer had before it — never a cached selector.
    const before = await pm.oncallTeamDetailPage.countShiftRuleTabs();
    await pm.oncallTeamDetailPage.addShiftRule();
    await pm.oncallTeamDetailPage.openShiftRule(before);
    await pm.oncallTeamDetailPage.expectRuleNeedsPeople(before);

    // The stored schedule must be untouched: the warning is about a draft.
    const stored = await getTeamSchedule(page, team.id);
    const rules = (stored?.rotations ?? []).find((r) => r.id === rotationId)?.shift_rules ?? [];
    expect(rules.length, 'an unsaved draft rule must not have been stored').toBe(1);
  });

  // ------------------------------------------------------------------ §11.5

  /**
   * §11.5 — the bands say who, and "who" is a person's name.
   *
   * A band drawn at a few percent of the window's width has no room for an
   * address, and at a dozen members two addresses clip to the same illegible
   * prefix. `nameOf()` falls back to the raw email for an account with no first
   * or last name, and that fallback is CORRECT — so this test staffs the
   * rotation with an account that has a display name, and skips with a reason
   * when the org has none. Asserting "no @ on the chart" against a nameless
   * roster would be asserting the fallback is a bug.
   */
  test('§11.5 timeline bars carry display names, not raw email addresses', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Seed our OWN member. The org is shared across workers and every suite now
    // sweeps the accounts it creates, so listOrgUsers()[0] can be another worker's
    // fixture, deleted mid-test — a 400 on add-members naming an address this spec
    // never chose.
    const seed = await createOrgUser(page, {
      email: oncallUserEmail(uniqueName(workerPrefix(testInfo)), 'named'),
    });
    const named = (await listOrgUsers(page)).find((u) => u.email === seed.email);
    test.skip(
      !named,
      'no account in this org has a first or last name — the timeline correctly falls back to the address, so §11.5 has nothing to assert here',
    );

    const { team, rotationId } = await seedAllDayTeam(page, testInfo, {
      memberEmail: named.email,
    });

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.expectLaneVisible(rotationId);

    expect(
      (await pm.oncallTeamDetailPage.readTimelineLabels()).join(' | '),
      'the chart must have drawn at least one band',
    ).not.toBe('');

    // The band label is drawn BEFORE the name it needs has arrived.
    // OnCallScheduleTimeline.vue fetches the org's users in `onMounted`
    // (line 399) purely to label bands, and `nameOf()` returns the raw email
    // until that lands — so a single read taken as soon as the lane appears can
    // catch the fallback rather than the answer, and reports the very defect
    // this case exists to catch. The bigger the org, the wider that window:
    // this passed at ~1400 accounts and failed at 1494 in the same day.
    //
    // Polled, not slept, and the assertion is unchanged — a band that never
    // resolves to the name still fails here, which is the real defect.
    await expect
      .poll(async () => (await pm.oncallTeamDetailPage.readTimelineLabels()).join(' | '), {
        timeout: 30000,
        intervals: [500],
        message: 'the band names the person',
      })
      .toContain(displayNameOf(named));

    const chart = (await pm.oncallTeamDetailPage.readTimelineLabels()).join(' | ');
    expect(chart, 'a raw address on a band is the defect, not a formatting preference')
      .not.toContain(named.email);
  });
});
