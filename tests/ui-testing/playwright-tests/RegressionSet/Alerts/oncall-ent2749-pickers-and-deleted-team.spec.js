const { randomUUID } = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  orgId,
  uniqueName,
  isOnCallAvailable,
  createTeam,
  addTeamMembers,
  deleteTeamById,
  getTeamSchedule,
} = require('../../utils/oncall-seed.js');
const { createOrgUser, deleteOrgUser, oncallUserEmail } = require('../../utils/oncall-seed-ext.js');

// The issue's screenshots are about 900 tall; a taller viewport would hide a popup running off the bottom.
const SHORT_VIEWPORT = { width: 1500, height: 900 };

test.describe('On-call pickers and deleted team (o2-enterprise#2749)', {
  tag: ['@oncall', '@enterprise', '@regression', '@alertsRegression'],
}, () => {
  let pm;
  const made = { team: null, yearTeam: null, goneTeam: null, tag: '', member: null };

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const gate = await isOnCallAvailable(page);
      expect(gate.available, `this spec runs only in the OnCall-Regression shard: ${gate.reason}`).toBe(true);
      made.tag = uniqueName(`e2e_ent2749_w${testInfo.workerIndex}`);
      // Not root: an absence is org-wide, and marking root away would change who the shard's other on-call spec pages.
      made.member = oncallUserEmail(made.tag, 'away');
      await createOrgUser(page, { email: made.member, password: `${randomUUID()}Aa1#` });
      made.team = await createTeam(page, { name: `${made.tag}_team` });
      await addTeamMembers(page, made.team.id, [made.member]);
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.setViewportSize(SHORT_VIEWPORT);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (made.team) await deleteTeamById(page, made.team.id);
    if (made.yearTeam) await deleteTeamById(page, made.yearTeam);
    if (made.goneTeam) await deleteTeamById(page, made.goneTeam);
    // Removing the user also drops the absence the calendar test saved.
    if (made.member) await deleteOrgUser(page, made.member);
    await context.close();
  });

  test('Mark away: every number on the Back on clock can be clicked', {
    tag: ['@bug-ent2749', '@P2'],
  }, async ({ page }) => {
    const detail = pm.oncallTeamDetailPage;
    await detail.goto(orgId(), made.team.id, 'members');
    await detail.openMembersTab();
    await detail.openMarkAwayDialog();
    await detail.openBackOnTimePicker();

    await expect.poll(async () => {
      const numbers = await detail.readHitTargets(detail.locators.timeClockNumber);
      return { count: numbers.length, blocked: numbers.filter((n) => !n.hit || !n.onScreen).map((n) => n.label) };
    }, { message: 'all 12 hours are on screen and on top of the dialog', timeout: 10000 }).toEqual({ count: 12, blocked: [] });

    // A real mouse click, because the original bug left these numbers in the DOM where a scripted click still worked.
    const hours = await detail.readHitTargets(detail.locators.timeClockNumber);
    const nine = hours.find((n) => /\b9\b/.test(n.label));
    await page.mouse.click(nine.x, nine.y);
    await expect(detail.getBackOnTimeInput()).toHaveValue(/^(09|21):/);

    await expect.poll(async () => {
      const numbers = await detail.readHitTargets(detail.locators.timeClockNumber);
      return numbers.filter((n) => !n.hit || !n.onScreen).map((n) => n.label);
    }, { message: 'all the minutes are on top of the dialog too', timeout: 10000 }).toEqual([]);
    const minutes = await detail.readHitTargets(detail.locators.timeClockNumber);
    const half = minutes.find((n) => /\b30\b/.test(n.label));
    await page.mouse.click(half.x, half.y);
    await expect(detail.getBackOnTimeInput()).toHaveValue(/^(09|21):30$/);
    await expect(detail.getTimePopup()).toHaveCount(0);
  });

  test('Mark away: the Back on calendar opens above the dialog and a clicked day is saved', {
    tag: ['@bug-ent2749', '@P2'],
  }, async ({ page }) => {
    const detail = pm.oncallTeamDetailPage;
    await detail.goto(orgId(), made.team.id, 'members');
    await detail.openMembersTab();
    await detail.openMarkAwayDialog();
    await detail.openBackOnCalendar();
    await detail.showNextCalendarMonth();

    await expect.poll(async () => {
      const days = await detail.readHitTargets(detail.locators.calendarDay);
      return { weeks: days.length >= 28, blocked: days.filter((d) => !d.hit || !d.onScreen).map((d) => d.date) };
    }, { message: 'every day, first week included, is on top of the dialog', timeout: 10000 }).toEqual({ weeks: true, blocked: [] });

    const inMonth = await detail.readHitTargets(detail.locators.calendarDayInMonth);
    const picked = inMonth[14];
    await page.mouse.click(picked.x, picked.y);
    await expect(detail.getCalendarDay(picked.date)).toHaveAttribute('data-selected', 'true');
    await detail.closeCalendar();
    await detail.getBackOnTimeInput().fill('10:00');
    await detail.fillAwayFrom(new Date().toISOString().slice(0, 10), '00:00');

    const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/oncall/unavailability'));
    await detail.saveMarkAway();
    const response = await saved;
    expect(response.status()).toBe(200);
    const absence = await response.json();
    expect(new Date(absence.end_at / 1000).toISOString().slice(0, 10), 'the absence ends on the day that was clicked').toBe(picked.date);
  });

  test('First handover date: a half-typed year is not committed and the typed date keeps its weekday', {
    tag: ['@bug-ent2749', '@P1'],
  }, async ({ page }) => {
    const teams = pm.oncallTeamsPage;
    await teams.goto(orgId());
    await teams.openCreateDrawer();
    await teams.fillTeamName(`${made.tag}_year`);
    await teams.pickFormMembers([made.member]);

    await teams.typeFormHandoverYear('2029');
    await expect(teams.getFormHandoverDate()).toHaveText(/\/2029$/);
    const typed = (await teams.getFormHandoverDate().innerText()).replace(/\s/g, '');

    await teams.typeFormHandoverYear('4');
    await teams.getFormNameField().click();

    const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/oncall\/teams$/.test(new URL(r.url()).pathname));
    const staffed = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/oncall\/teams\/[^/]+\/schedule$/.test(new URL(r.url()).pathname));
    await teams.saveDrawer();
    const team = await (await created).json();
    made.yearTeam = team.id;
    expect((await staffed).status()).toBe(200);

    // The form moves a future anchor back to the current shift but keeps its weekday, so the weekday is what proves the typed year was used.
    const [month, day] = typed.split('/').map(Number);
    const typedWeekday = new Date(Date.UTC(2029, month - 1, day)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const schedule = await getTeamSchedule(page, team.id);
    const weekdays = schedule.rotations.flatMap((r) => r.shift_rules).map((rule) => new Date(rule.anchor_micros / 1000)
      .toLocaleDateString('en-US', { weekday: 'short', timeZone: schedule.timezone }));
    expect(weekdays.length, 'the form staffed a rotation').toBeGreaterThan(0);
    expect(new Set(weekdays), `the handover falls on the weekday of ${typed}`).toEqual(new Set([typedWeekday]));
  });

  test('deleting a team then pressing browser Back says the team is gone, not that on-call is unavailable', {
    tag: ['@bug-ent2749', '@P2'],
  }, async ({ page }) => {
    const name = `${made.tag}_gone`;
    const gone = await createTeam(page, { name });
    made.goneTeam = gone.id;
    const teams = pm.oncallTeamsPage;
    const detail = pm.oncallTeamDetailPage;

    await teams.goto(orgId());
    await teams.search(name);
    await teams.openTeam(name);
    await detail.expectDetailVisible();
    await detail.backToTeams();
    await teams.expectListVisible();
    await teams.search(name);
    await teams.deleteTeam(gone.id);

    await page.goBack();

    await expect(detail.getNotFound()).toBeVisible({ timeout: 30000 });
    await expect(detail.getNotAvailable()).toHaveCount(0);
  });
});
