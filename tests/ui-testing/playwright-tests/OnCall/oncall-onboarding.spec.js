/**
 * On-Call — Quick start actually writes a schedule (TS-06.07)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-06.07 applying a preset must issue a real `POST /teams/{id}/schedule/from-preset`,
 *            and the primary rotation afterwards must hold the preset's shift rules.
 *
 * ENTERPRISE-GATED (@enterprise); skips with a reason via `isOnCallAvailable()`.
 *
 * WHY THIS IS ITS OWN FILE AND NOT AN APPEND. `oncall-quickstart.spec.js` is
 * being repaired by another workstream in this same run, so it is off-limits.
 * This file takes the one Tier-1 case that would naturally have landed there
 * and is where the rest of TS-22 will go next.
 *
 * THE DEFECT CLASS THIS GUARDS. A Quick start that validates, closes the drawer
 * and issues NOTHING looks exactly like success: the drawer disappears, no
 * error is shown, and the team's schedule is whatever it was before. So the
 * assertion is not "the drawer closed" — it is that the request went out AND
 * that what came back is the preset's shape. `confirmQuickStartReplace()` waits
 * on the write itself for precisely this reason.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The preset's exact restriction minutes. Those are the catalogue's
 *     business decision, read from `GET /oncall/schedule-presets` at runtime;
 *     pinning them here would make the test a copy of the catalogue rather than
 *     a check on it. What is asserted is that the two staffed groups became two
 *     shift rules on the primary rotation holding the people staffed into them,
 *     and that the rotation is no longer the auto-created `source: "default"` one.
 *
 * Self-cleaning, worker-scoped prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { OnCallAckPage } = require('../../pages/oncallPages/oncallAckPage.js');
const {
  isOnCallAvailable,
  createTeam,
  listTeams,
  addTeamMembers,
  setTeamSchedule,
  rotation,
  createOwnershipRule,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  getTeamSchedule,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
  deleteTeamById,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  waitForMail,
  requireMailSink,
  extractLinks,
} = require('../utils/oncall-seed-ext.js');
const { getAuthHeaders } = require('../utils/cloud-auth.js');
const { withFreshOrg } = require('../utils/first-event-helpers.js');

const PREFIX = 'e2e_oncall_onboarding';

const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

/**
 * The preset with the fewest required inputs that still produces two rotations.
 *
 * `weekday_weekend` needs exactly two groups, both required, and no boundary
 * day or minute — so the case stays about "did the apply issue a request"
 * rather than about filling a form.
 */
const PRESET_ID = 'weekday_weekend';
const PRESET_ROWS = ['weekdays', 'weekend'];

const gate = { checked: false, available: false, reason: '' };

test.describe.configure({ mode: 'parallel' });

test.describe('On-call onboarding', {
  tag: ['@oncall', '@oncall-onboarding', '@enterprise'],
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

  // ------------------------------------------------------------------ TS-06.07

  // Apply rewrites only the PRIMARY rotation's shift rules in place, so escalation steps that name it keep working.
  test('applying a Quick start preset issues a real schedule write, not a silent no-op', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_preset`);
    const emails = await createOrgUsers(page, prefix, 4);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    const before = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule before Quick start', {
      rotations: before.rotations.map((r) => ({ id: r.id, name: r.name, source: r.source })),
    });
    expect(before.rotations.length, 'a staffed team starts with an auto-created rotation for Quick start to rewrite')
      .toBeGreaterThan(0);
    expect(before.rotations.every((r) => r.source === 'default'),
      'a new team starts on auto-created rotations — that is what Quick start replaces').toBe(true);
    const [primary, ...others] = before.rotations;

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openQuickStart();
    await pm.oncallTeamDetailPage.chooseQuickStartTemplate(PRESET_ID);

    const staffing = {
      weekdays: [emails[0], emails[1]],
      weekend: [emails[2], emails[3]],
    };
    for (const row of PRESET_ROWS) {
      await pm.oncallTeamDetailPage.setQuickStartRegionMembers(row, staffing[row]);
    }

    await pm.oncallTeamDetailPage.applyQuickStart();
    await expect(pm.oncallTeamDetailPage.getConfirmDialog(),
      'rewriting a stored rotation is confirmed first, naming it').toContainText(primary.name, { timeout: 20000 });
    const write = await pm.oncallTeamDetailPage.confirmQuickStartReplace();
    expect(write.status(), `the preset write must be accepted: ${await write.text().catch(() => '')}`).toBe(200);

    await expect.poll(
      async () => (await getTeamSchedule(page, team.id)).rotations.find((r) => r.id === primary.id)?.source ?? 'gone',
      { timeout: 60000, intervals: [1000], message: 'the primary rotation never left its auto-created state' },
    ).not.toBe('default');

    const after = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule after Quick start', {
      rotations: after.rotations.map((r) => ({
        id: r.id, name: r.name, source: r.source,
        rules: (r.shift_rules ?? []).map((rule) => ({ name: rule.name, members: rule.members })),
      })),
    });
    const rewritten = after.rotations.find((r) => r.id === primary.id);
    expect(rewritten, 'Quick start must rewrite the primary rotation in place, not delete or replace it').toBeTruthy();
    expect(rewritten.name, 'the rewritten rotation keeps its name, so escalation steps still point at it')
      .toBe(primary.name);
    const storedMembers = (rewritten.shift_rules ?? []).map((rule) => [...(rule.members ?? [])].sort());
    expect(storedMembers.length, 'a two-group preset writes one shift rule per group').toBe(PRESET_ROWS.length);
    for (const row of PRESET_ROWS) {
      expect(storedMembers, `the "${row}" group must be stored with the people staffed into it`)
        .toContainEqual([...staffing[row]].sort());
    }
    expect(after.rotations.filter((r) => r.id !== primary.id),
      'only the primary rotation is rewritten; every other rotation is left as it was').toEqual(others);
  });

  // Staged in an org of its own: in the shared org other workers' setup completes all four steps, so the checklist is never drawn there.
  test('TS-22.02 checklist state is derived from live configuration, including its absence', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    // Opening a page needs a real alert firing in the staged org.
    test.setTimeout(480_000);
    const list = pm.oncallPagesListPage;
    const checklist = list.getSetupChecklist();
    const stateOf = (key) => list.readSetupStepState(key);
    const expectSteps = async (expected, why) => {
      for (const [key, done] of Object.entries(expected)) {
        await expect.poll(async () => (await stateOf(key)) === 'done', {
          timeout: 20000, intervals: [1000],
          message: `${why}: the "${key}" step must read ${done ? 'done' : 'not done'}`,
        }).toBe(done);
      }
    };

    await withFreshOrg(page, 'oncall_checklist', async (stagedOrg) => {
      const sharedOrg = process.env.ORGNAME;
      // Every seed helper reads its org from ORGNAME, and a worker runs one test at a time.
      process.env.ORGNAME = stagedOrg;
      let alertId = null;
      try {
        const prefix = uniqueName(`${workerPrefix(testInfo)}_chk`);
        const reload = async () => {
          await list.goto(stagedOrg);
          await list.expandSetupChecklist();
        };

        await reload();
        await expect(checklist, 'an org with nothing configured must be shown the checklist').toBeVisible({ timeout: 30000 });
        await expectSteps({ team: false, rotation: false, routing: false, destinations: false }, 'an empty org');
        await expect(list.getSetupCollapse(),
          'with no pages the checklist is the whole screen, so it offers nothing to hide it behind').toHaveCount(0);

        const team = await createTeam(page, { name: `${prefix}_team` });
        await reload();
        await expectSteps({ team: true, rotation: false }, 'a team with nobody in it');

        await deleteTeamById(page, team.id);
        await expect.poll(async () => (await listTeams(page)).length, { timeout: 30000 }).toBe(0);
        await reload();
        await expectSteps({ team: false }, 'the only team was deleted, so a remembered tick would be stale');

        const [member] = await createOrgUsers(page, prefix, 1);
        const staffed = await createTeam(page, { name: `${prefix}_staffed` });
        await addTeamMembers(page, staffed.id, [member]);
        const destination = await seedNotificationDestination(page, prefix);
        await reload();
        await expectSteps({ team: true, rotation: true, routing: false, destinations: true },
          'a staffed team and a destination, but nothing routed');

        const stream = `${prefix}_stream`.toLowerCase();
        await seedOnCallStream(page, stream);
        const fired = await firePageAndWait(page, {
          alertOptions: { name: `${prefix}_alert`, stream, teamId: staffed.id },
        });
        alertId = fired.alert.id;

        // A page bound straight to a team completes routing without a rule, so all four steps are done.
        await list.goto(stagedOrg);
        await expect(list.getRowByIndex(0), 'the fired page must be on the list').toBeVisible({ timeout: 30000 });
        await expect(checklist, 'a fully configured org must draw no checklist').toHaveCount(0);
        await expect(list.getSetupBanner(), 'and no setup banner either').toHaveCount(0);

        const deleted = await page.request.delete(
          `${process.env.ZO_BASE_URL}/api/${stagedOrg}/alerts/destinations/${encodeURIComponent(destination)}`,
          { headers: getAuthHeaders() },
        );
        expect(deleted.ok(), `deleting the destination must succeed: ${deleted.status()}`).toBe(true);
        await list.goto(stagedOrg);
        await expect(list.getSetupBanner(),
          'the only destination is gone, so the setup is unfinished again and must say so over the live list')
          .toBeVisible({ timeout: 30000 });
        await list.expandSetupChecklist();
        await expectSteps({ team: true, rotation: true, routing: true, destinations: false }, 'the destination was deleted');

        await list.getSetupCollapse().click();
        await expect(checklist, '"Hide for now" folds the checklist back into its banner').toHaveCount(0);
        await list.goto(stagedOrg);
        await expect(list.getSetupBanner(),
          'hiding the checklist must not survive a reload while the setup is still unfinished').toBeVisible({ timeout: 30000 });
      } finally {
        if (alertId) {
          await page.request.delete(`${process.env.ZO_BASE_URL}/api/v2/${stagedOrg}/alerts/${alertId}`,
            { headers: getAuthHeaders() }).catch(() => {});
        }
        process.env.ORGNAME = sharedOrg;
      }
    });
  });

  /**
   * TS-07.05 (G4) — the handover picker is in the TEAM's zone, not the browser's.
   *
   * G4 recorded this the other way round, as a defect: a picker reading and
   * writing in the browser's zone meant an operator in Berlin editing an
   * Asia/Kolkata team saw the handover three and a half hours from where it
   * was — and moved it there by saving. The code now converts explicitly
   * (`toZonedInputValue(anchor, props.timezone)` / `fromZonedInputValue`), and
   * shows the zone as a disabled third field so there is no ambiguity about
   * which one is meant.
   *
   * This is therefore a REGRESSION GUARD, written to pass, on a team whose zone
   * is deliberately far from any plausible runner zone.
   */
  test('TS-07.05 the handover picker reads and writes in the team\'s zone, not the browser\'s', {
    tag: ['@P1'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(`${workerPrefix(testInfo)}_zone`);
    const users = await createOrgUsers(page, name, 2);
    const TEAM_ZONE = 'Asia/Kolkata';

    const team = await createTeam(page, { name, timezone: TEAM_ZONE });
    // A handover at a known absolute instant: 2026-03-04T00:00:00Z, which is
    // 05:30 the same day in Asia/Kolkata and never 00:00 in any other zone.
    const anchorMicros = Date.UTC(2026, 2, 4, 0, 0, 0) * 1000;
    await setTeamSchedule(page, team.id, {
      timezone: TEAM_ZONE,
      rotations: [rotation({ id: 'Primary', members: users, anchorMicros })],
    });
    await addTeamMembers(page, team.id, users);

    await pm.oncallTeamDetailPage.goto(ORG, team.id);
    await pm.oncallTeamDetailPage.openTab('schedule');
    await pm.oncallTeamDetailPage.getLaneEdit('Primary').first().click();
    await expect(pm.oncallTeamDetailPage.getRotationDrawer())
      .toBeVisible({ timeout: 30000 });

    const zoneField = pm.oncallTeamDetailPage.getPreviewZone();
    await expect(zoneField, 'the drawer must state which zone the handover is expressed in')
      .toBeVisible({ timeout: 20000 });
    await expect(zoneField, 'and it must be the team\'s zone, not the viewer\'s')
      .toContainText(TEAM_ZONE);

    const timeField = pm.oncallTeamDetailPage.getHandoverTimeTrigger(0);
    await expect(timeField).toBeVisible({ timeout: 20000 });
    await expect(
      timeField,
      `the handover is 00:00Z, which is 05:30 in ${TEAM_ZONE}; showing 00:00 would mean the picker is reading in UTC/browser time (G4)`,
    ).toContainText('05:30');
  });

  /**
   * TS-02.03 — the configure controls are not gated on a permission answer,
   * because no permission question is ever asked.
   *
   * There is no "what may I do" endpoint. `canConfigure` starts TRUE and is
   * latched closed only by an observed 403 on a real write
   * (`useOnCallPermissions.ts`: "controls render optimistically and the server
   * is the real gate... never a client-side role guess"). The plan's "the probe
   * runs at most once per org per session" is therefore satisfied at zero.
   *
   * TWO WRONG VERSIONS BEFORE THIS ONE, both worth recording:
   *
   *   Watching every request for a URL CONTAINING "role"/"permission" failed —
   *   the app fetches unrelated URLs with those substrings, so the filter
   *   measured its own looseness. Matched on path SEGMENTS now.
   *
   *   Then I held the screen's own data request open and asserted the control
   *   was already on screen. That also failed, and correctly: the toolbar is
   *   gated on the page having LOADED, which is ordinary data-loading and not
   *   the claim under test. Asserting it would have encoded a contract the
   *   product never made — optimism here is about permissions, not about data.
   *
   * What is left is the true claim: the control is there on a normal load with
   * no 403 ever having been observed, and nothing resembling a permission probe
   * was requested to decide it.
   */
  test('TS-02.03 configure controls render with no permission probe behind them', {
    tag: ['@P1'],
  }, async ({ page }) => {
    // Path SEGMENTS, so `?role=admin` or a bundle named `role-utils.js` cannot
    // masquerade as a probe.
    const PROBE = /\/(permissions?|roles?|authz|capabilities)(\/|\?|$)/i;
    const probes = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname + new URL(req.url()).search;
      if (PROBE.test(path)) probes.push(path);
    });

    await pm.oncallTeamsPage.goto(ORG);
    await pm.oncallTeamsPage.expectListVisible();

    // The canonical configure-gated control on this screen. Its presence with
    // no 403 yet observed IS the optimistic default.
    await pm.oncallTeamsPage.expectCreateControlVisible();

    expect(
      probes,
      'on-call must not ask the server what the viewer may do — the control defaults open and a 403 on a real write is the only gate',
    ).toEqual([]);
  });

  /**
   * TS-16.06 — the acknowledge landing page is usable on a phone.
   *
   * This is the one screen in the product opened half asleep, one-handed, from
   * a mail client, on a phone, by somebody who has just been woken up. It is
   * deliberately server-rendered HTML with no JavaScript and no framework —
   * so it cannot be checked by any of the component tests, and the only way to
   * know it still works is to open it at a phone viewport and look.
   *
   * There are no data-test attributes on it at all (it is Rust-generated
   * markup), so this asserts on structure and geometry: the form and its button
   * exist, the page does not scroll sideways, and the tap target is big enough
   * to hit without aiming.
   *
   * PARKED ON A CONFIRMED DEFECT. It fails on the horizontal-overflow check —
   * measured 159px of sideways scroll at a 390x844 viewport — and the source
   * says why rather than contradicting it. The page is built in
   * `src/api/management/src/request/oncall/mod.rs` `ack_confirm_page`, and its
   * title renders as `<h1 style="font-size:1.25rem">{title}</h1>` with no
   * `word-break` or `overflow-wrap` anywhere in the document. `body` carries
   * `padding:2rem`, leaving ~326px of content on a 390px phone, so any record
   * title that is one long unbroken token — which alert names routinely are,
   * `prod-us-east-1-checkout-error-rate` and the like, and CSS does not break
   * on hyphens or underscores by default — pushes the document wider than the
   * screen and can carry the Acknowledge button off the right edge.
   *
   * That matters more here than almost anywhere: this is the one screen the
   * product deliberately builds without JavaScript because, in its own source
   * comment, "it is opened on a phone at night from a mail client". One CSS
   * declaration on the `h1` fixes it. Kept as a failing expectation so it goes
   * green when that lands.
   */
  test.fixme('TS-16.06 the acknowledge landing page is usable at a phone viewport — a long title overflows it. o2-enterprise#2481.', {
    tag: ['@P1'],
  }, async ({ page, browser }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(480_000);
    await requireMailSink(test);
    const prefix = uniqueName(`${workerPrefix(testInfo)}_ack`);
    const emails = await createOrgUsers(page, prefix, 1);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await setTeamSchedule(page, team.id, {
      timezone: 'UTC',
      rotations: [rotation({ id: 'Primary', members: emails })],
    });
    await addTeamMembers(page, team.id, emails);

    // A REAL firing, not a test page. The test-page mail carries a link to the
    // configuration, not an ack token — W-01 is precisely that its link is
    // broken — so only a genuine page email has an `/oncall/ack?token=` to open.
    const service = `${prefix}_svc`;
    const stream = prefix.toLowerCase();
    const seeded = await seedOnCallStream(page, stream, { minutes: 30, services: [service] });
    await waitForStreamSearchable(page, stream, seeded.records);
    await createOwnershipRule(page, { teamId: team.id, dimensions: { service } });
    const destination = await seedNotificationDestination(page, stream);

    const since = Date.now();
    await firePageAndWait(page, {
      alertOptions: { name: `${prefix}_alert`, stream, destinations: [destination] },
    });

    const mail = await waitForMail({
      to: emails[0], sinceMs: since, subject: /\[P\d\]/, timeout: 180000,
    });
    expect(mail, `a real firing must page ${emails[0]} by email`).not.toBeNull();

    const ackLink = extractLinks(mail).find((u) => /\/oncall\/ack\?/.test(u));
    expect(ackLink, 'a page email must carry an acknowledge link — that is its purpose').toBeTruthy();

    // A phone, not a narrowed desktop: the device scale and touch flags change
    // how the page lays out and how big a tap target has to be.
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const small = await phone.newPage();
    const res = await small.goto(ackLink, { waitUntil: 'domcontentloaded' });
    expect(res.status(), 'the ack link must render a page, not an error').toBeLessThan(400);

    // It must declare a viewport, or a phone renders it at desktop width and
    // zooms out until the button is unhittable.
    const ackPage = new OnCallAckPage(small);
    const viewportMeta = await ackPage.readViewportMeta();
    expect(viewportMeta, 'a page opened on a phone must declare a viewport').toBeTruthy();
    expect(viewportMeta, 'and must scale to the device rather than assume a desktop width')
      .toMatch(/width=device-width/);

    // The two things the page exists for.
    const button = ackPage.getAcknowledgeButton();
    await expect(button, 'the acknowledge button must be on screen').toBeVisible({ timeout: 20000 });
    await expect(ackPage.getTokenField(),
      'and the form must carry the token that identifies the page')
      .toHaveCount(1);

    // Nothing may run off the side: a horizontal scrollbar on a phone means
    // the button can be off-screen entirely.
    const overflow = await small.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the ack page must not scroll sideways on a phone').toBeLessThanOrEqual(1);

    // And the tap target must be hittable by a thumb, not a mouse pointer.
    const box = await button.boundingBox();
    expect(box, 'the button must have a measurable box').toBeTruthy();
    expect(box.height,
      'a target under about 40 CSS px is missed by a thumb, which is the only input this page has')
      .toBeGreaterThanOrEqual(38);
    expect(box.width, 'and it must be wide enough to aim at without care')
      .toBeGreaterThanOrEqual(80);
    expect(box.x + box.width,
      'the whole button must be inside the viewport, not clipped at the right edge')
      .toBeLessThanOrEqual(390);

    await phone.close();
  });

});
