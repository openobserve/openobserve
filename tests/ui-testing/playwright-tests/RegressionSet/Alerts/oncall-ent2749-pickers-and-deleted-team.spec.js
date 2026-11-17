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
      // Not root: Mark away on root would change who the shard's other on-call spec pages if it were ever saved.
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
    if (made.member) await deleteOrgUser(page, made.member);
    await context.close();
  });

  test('Mark away: every number on the When end-time clock can be clicked', {
    tag: ['@bug-ent2749', '@P2'],
  }, async () => {
    const detail = pm.oncallTeamDetailPage;
    await detail.goto(orgId(), made.team.id, 'members');
    await detail.openMembersTab();
    await detail.openMarkAwayDialog();
    await detail.openAwayWindow();
    await detail.openAwayEndTimePicker();

    // The end time starts at the current time, so pick an hour and minute it cannot already show.
    const [nowHour, nowMinute] = (await detail.getAwayEndTimeInput().inputValue()).split(':').map(Number);
    const hour = nowHour % 12 === 9 ? 3 : 9;
    const minute = nowMinute === 30 ? 15 : 30;
    const hours = `(${String(hour).padStart(2, '0')}|${hour + 12})`;
    const blocked = async () => (await detail.readHitTargets(detail.locators.timeClockNumber))
      .filter((n) => !n.hit || !n.onScreen).map((n) => n.label);

    await expect.poll(async () => {
      const numbers = await detail.readHitTargets(detail.locators.timeClockNumber);
      return { count: numbers.length, blocked: numbers.filter((n) => !n.hit || !n.onScreen).map((n) => n.label) };
    }, { message: 'all 12 hours are on screen and on top of the dialog', timeout: 10000 }).toEqual({ count: 12, blocked: [] });
    await detail.clickClockNumber(hour);
    await expect(detail.getAwayEndTimeInput()).toHaveValue(new RegExp(`^${hours}:`));

    await expect.poll(blocked, { message: 'all the minutes are on top of the dialog too', timeout: 10000 }).toEqual([]);
    await detail.clickClockNumber(minute);
    await expect(detail.getAwayEndTimeInput()).toHaveValue(new RegExp(`^${hours}:${minute}:`));

    await expect.poll(blocked, { message: 'and the seconds', timeout: 10000 }).toEqual([]);
    await detail.clickClockNumber('00');
    await expect(detail.getAwayEndTimeInput()).toHaveValue(new RegExp(`^${hours}:${minute}:00$`));
    await expect(detail.getTimePopup()).toHaveCount(0);
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

    const { team, staffed } = await teams.saveNewTeamAndReadWrites();
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
