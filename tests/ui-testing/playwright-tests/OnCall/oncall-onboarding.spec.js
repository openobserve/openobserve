/**
 * On-Call — Quick start actually writes a schedule (TS-06.07)
 *
 * Plan: docs/test_generator/test-plans/oncall-ui-test-plan.md, Tier 1 —
 *   TS-06.07 applying a preset must issue a real `PUT /teams/{id}/schedule`,
 *            and the stored schedule afterwards must be the preset's.
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
 * that what came back is the preset's shape. `attemptQuickStartSave()` watches
 * the network for precisely this reason.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE:
 *   - The preset's exact restriction minutes. Those are the catalogue's
 *     business decision, read from `GET /oncall/schedule-presets` at runtime;
 *     pinning them here would make the test a copy of the catalogue rather than
 *     a check on it. What is asserted is that the two staffed groups became two
 *     rotations holding the people who were staffed into them, and that the
 *     rotations are no longer the auto-created `source: "default"` pair.
 *
 * Self-cleaning, worker-scoped prefix.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  isOnCallAvailable,
  createTeam,
  listTeams,
  addTeamMembers,
  setTeamSchedule,
  rotation,
  createOwnershipRule,
  listOwnershipRules,
  seedOnCallStream,
  waitForStreamSearchable,
  seedNotificationDestination,
  firePageAndWait,
  getTeamSchedule,
  orgId,
  uniqueName,
  deleteOnCallFixturesByPrefix,
} = require('../utils/oncall-seed.js');
const {
  createOrgUsers,
  getCoverageGaps,
  waitForMail,
  extractLinks,
} = require('../utils/oncall-seed-ext.js');

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

  /**
   * UNWIRED, and kept as a fixme with its real assertions intact.
   *
   * Reproduced on this build, 15 Sep: with the `weekday_weekend` preset chosen
   * and both required groups staffed, Apply is ENABLED (`disabled: false`),
   * clicking it issues NO request (`requestSeen: false`), and the screen says
   * nothing about why (`error: null`, `invalidFields: 0`). A Quick start that
   * validates, looks successful and writes nothing is indistinguishable from
   * one that worked, which is the entire reason this case exists.
   *
   * The body asserts the CORRECT behaviour — the apply issues
   * `PUT /teams/{id}/schedule` and the stored schedule is the preset's — so it
   * flips green the moment the handler is wired, and weakening it to assert the
   * no-op would pin the defect as correct.
   */
  test.fixme('applying a Quick start preset issues a real schedule write, not a silent no-op — not wired: Apply is enabled, issues no request and reports no error, verified 15 Sep on :5090', {
    tag: ['@P0'],
  }, async ({ page }, testInfo) => {
    const prefix = uniqueName(`${workerPrefix(testInfo)}_preset`);
    const emails = await createOrgUsers(page, prefix, 4);
    const team = await createTeam(page, { name: `${prefix}_team` });
    await addTeamMembers(page, team.id, emails);

    // The auto-staffed starting point, so "the schedule changed" is a real
    // before/after rather than an assumption about an empty team.
    const before = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule before Quick start', {
      rotations: before.rotations.map((r) => ({ id: r.id, name: r.name, source: r.source })),
    });
    expect(before.rotations.every((r) => r.source === 'default'),
      'a new team starts on auto-created rotations — that is what Quick start replaces').toBe(true);

    await pm.oncallTeamDetailPage.goto(ORG, team.id, 'schedule');
    await pm.oncallTeamDetailPage.expectAvailable();
    await pm.oncallTeamDetailPage.openScheduleTab();
    await pm.oncallTeamDetailPage.openQuickStart();
    await pm.oncallTeamDetailPage.chooseQuickStartTemplate(PRESET_ID);

    // Two groups staffed with different people, so the stored rotations can be
    // told apart afterwards.
    const staffing = {
      weekdays: [emails[0], emails[1]],
      weekend: [emails[2], emails[3]],
    };
    // Only `members` is required on this preset — `name` is optional and takes
    // a sensible default — so staffing is the whole of filling it in.
    for (const row of PRESET_ROWS) {
      await pm.oncallTeamDetailPage.setQuickStartRegionMembers(row, staffing[row]);
    }

    // The network watch is the point: a Quick start that closes the drawer
    // without issuing a PUT looks identical to one that worked.
    const attempt = await pm.oncallTeamDetailPage.attemptQuickStartSave({ settleMs: 4000 });
    testLogger.info('TS-06.07 apply attempt', attempt);
    expect(attempt.disabled, 'a fully-filled Quick start must be applicable').toBe(false);
    expect(attempt.requestSeen, 'applying a preset must issue PUT /teams/{id}/schedule — a silent no-op is the defect')
      .toBe(true);
    expect(attempt.error, 'a valid preset must not be refused').toBeNull();

    // And the stored schedule has to actually be the preset's.
    await expect.poll(
      async () => (await getTeamSchedule(page, team.id)).rotations.some((r) => r.source !== 'default'),
      { timeout: 60000, intervals: [1000], message: 'the schedule never left its auto-created state' },
    ).toBe(true);

    const after = await getTeamSchedule(page, team.id);
    testLogger.info('TS-06.07 schedule after Quick start', {
      rotations: after.rotations.map((r) => ({
        id: r.id, name: r.name, source: r.source,
        members: r.shift_rules?.[0]?.members,
      })),
    });
    expect(after.rotations.length, 'a two-group preset stores two rotations').toBe(PRESET_ROWS.length);

    // Each staffed group became a rotation holding exactly the people put in it
    // — the strongest available statement that the preset, not something else,
    // is what got written.
    const storedMembers = after.rotations.map((r) => [...(r.shift_rules?.[0]?.members ?? [])].sort());
    for (const row of PRESET_ROWS) {
      expect(storedMembers, `the "${row}" group must be stored with the people staffed into it`)
        .toContainEqual([...staffing[row]].sort());
    }
  });

  /**
   * TS-22.02 — the checklist is derived from live configuration, never
   * remembered.
   *
   * A checklist that stored "done" would keep saying done after somebody
   * deleted the destination it was about, and the first anybody would hear of
   * it is a page that announced nowhere.
   *
   * ASSERTED IN BOTH DIRECTIONS, INCLUDING ABSENCE. The obvious shape for this
   * test skips when the checklist is not drawn — and on any org that has been
   * used, it never is, so the case would be permanently skipped and nobody
   * would notice. But "not drawn" is itself derived: the component appears only
   * while at least one step is outstanding. So a fully configured org must draw
   * NOTHING, and that is just as much an assertion as a tick is. This computes
   * what the four steps should say from the live configuration and holds the
   * screen to it either way.
   */
  test('TS-22.02 checklist state is derived from live configuration, including its absence', {
    tag: ['@P1'],
  }, async ({ page }) => {
    // What the product computes the four steps from, read independently.
    const teams = (await listTeams(page)) ?? [];
    const rules = (await listOwnershipRules(page)) ?? [];
    const gaps = await getCoverageGaps(page);
    const hasTeam = teams.length > 0;
    const hasRouting = rules.length > 0;
    // "Would any team page somebody": fewer teams in the gap list than exist.
    const gapCount = Array.isArray(gaps) ? gaps.length : (gaps?.total ?? gaps?.teams?.length ?? 0);
    const hasStaffedRotation = hasTeam && gapCount < teams.length;

    await pm.oncallPagesListPage.goto(ORG);

    const checklist = pm.oncallPagesListPage.getSetupChecklist();
    await pm.oncallPagesListPage.expandSetupChecklist();

    if (!(await checklist.count())) {
      // Absence is derived too: the checklist withdraws only once nothing is
      // outstanding.
      //
      // NARROWED ON PURPOSE. I first asserted all four steps were satisfied and
      // it failed — because my re-derivation was wrong, not the product:
      // `hasRouting` in OnCallResponses.vue is
      // `rules.length > 0 || responses.some(r => !!r.team_id)`, so an org with
      // no ownership rules but routed pages legitimately has that step done.
      // Re-implementing the product's derivation only tests my copy of it. What
      // is checkable without duplicating internals is the unambiguous subset:
      // a withdrawn checklist must not be hiding an org with no teams, or one
      // where no team would page anybody.
      expect(
        hasTeam,
        'the checklist is not drawn, so the org must at least have a team — a checklist that hides an unconfigured org is remembering, not deriving',
      ).toBe(true);
      expect(
        hasStaffedRotation,
        'and at least one team must actually put somebody on call',
      ).toBe(true);
      testLogger.info('TS-22.02 checklist absent, and the configuration says it should be', {
        teams: teams.length, rules: rules.length, gapCount,
      });
      return;
    }

    await expect(checklist).toBeVisible({ timeout: 30000 });

    const stateOf = (key) => pm.oncallPagesListPage.readSetupStepState(key);

    // Each step's rendered state must follow from the configuration, not from
    // anything the component kept.
    for (const [key, satisfied] of [
      ['team', hasTeam],
      ['routing', hasRouting],
      ['rotation', hasStaffedRotation],
    ]) {
      const state = await stateOf(key);
      expect(state, `the "${key}" step must render its state as data, not only as a colour`)
        .toBeTruthy();
      expect(
        state === 'done',
        `the "${key}" step must read done exactly when the live configuration satisfies it`,
      ).toBe(satisfied);
    }

    // Nothing was clicked and nothing was stored, so a reload must recompute
    // the same answer from the same configuration.
    const before = await stateOf('team');
    await pm.oncallPagesListPage.goto(ORG);
    await pm.oncallPagesListPage.expandSetupChecklist();
    await expect(checklist).toBeVisible({ timeout: 30000 });
    expect(await stateOf('team'),
      'a reload must recompute the same state — the checklist remembers nothing of its own')
      .toBe(before);

    // "Hide for now" is a view state, and a checklist that stayed hidden would
    // hide an unfinished setup for good.
    const collapse = pm.oncallPagesListPage.getSetupCollapse();
    if (await collapse.count()) {
      await collapse.first().click();
      await pm.oncallPagesListPage.goto(ORG);
      const reappeared = (await pm.oncallPagesListPage.getSetupBanner().count())
        + (await checklist.count());
      expect(reappeared,
        'hiding the checklist must not survive a reload while the setup is still unfinished')
        .toBeGreaterThan(0);
    }
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

    const zoneField = pm.oncallTeamDetailPage.getHandoverTimezone(0);
    await expect(zoneField, 'the drawer must state which zone the handover is expressed in')
      .toBeVisible({ timeout: 20000 });
    await expect(zoneField, 'and it must be the team\'s zone, not the viewer\'s')
      .toContainText(TEAM_ZONE);

    const timeField = pm.oncallTeamDetailPage.getHandoverTimeInput(0);
    await expect(timeField).toBeVisible({ timeout: 20000 });
    const shown = await timeField.inputValue();
    expect(
      shown,
      `the handover is 00:00Z, which is 05:30 in ${TEAM_ZONE}; showing 00:00 would mean the picker is reading in UTC/browser time (G4)`,
    ).toMatch(/^05:30/);
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
  test.fixme('TS-16.06 the acknowledge landing page is usable at a phone viewport — not wired: the ack page h1 has no word-break, so a long record title overflows a 390px viewport by 159px and can push the Acknowledge button off screen (ack_confirm_page, request/oncall/mod.rs), verified 16 Sep on :5090', {
    tag: ['@P1'],
  }, async ({ page, browser }, testInfo) => {
    // A real firing has to clear ingestion, the scheduler and the ladder; the
    // 3-minute default is for screens, not for this.
    test.setTimeout(480_000);
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
    test.skip(!mail, 'no mail sink is reachable on this deployment, so there is no ack link to open');

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
    const viewportMeta = await small.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewportMeta, 'a page opened on a phone must declare a viewport').toBeTruthy();
    expect(viewportMeta, 'and must scale to the device rather than assume a desktop width')
      .toMatch(/width=device-width/);

    // The two things the page exists for.
    const button = small.locator('form button[type="submit"]').first();
    await expect(button, 'the acknowledge button must be on screen').toBeVisible({ timeout: 20000 });
    await expect(small.locator('form input[name="token"]'),
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
