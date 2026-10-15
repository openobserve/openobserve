// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const dt = require('../utils/downtimes-api.js');
const fx = require('../utils/downtimes-fixtures.js');

const PREFIX = 'e2e_dt_create';

const gate = { ready: false, config: {} };
const shared = { stream: null, dest: null, run: null, svcA: null, svcB: null, h1: null, alertA: null, alertB: null, alertFolder: null };

test.describe.configure({ mode: 'parallel' });

test.describe('Downtimes create and edit', { tag: ['@downtimes', '@enterprise', '@all'] }, () => {
  let pm;
  let reg = null;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      gate.config = await dt.assertDowntimesEnabled(page);
      gate.ready = true;
      const wp = fx.workerPrefix(PREFIX, testInfo);
      await dt.cleanupDowntimes(page, { prefix: `${wp}_` });

      shared.run = dt.uniqueName('r').slice(-8);
      shared.svcA = `svc-a-${shared.run}`;
      shared.svcB = `svc-b-${shared.run}`;
      shared.h1 = `h1-${shared.run}`;
      shared.stream = `${wp}_${shared.run}_stream`;
      await dt.seedStream(page, shared.stream, { minutes: 15, services: [shared.svcA, shared.svcB], hosts: [shared.h1, `h2-${shared.run}`] });
      shared.dest = (await dt.seedSinkDestination(page, `${wp}_${shared.run}`)).destination;
      shared.alertA = await dt.createSqlAlert(page, {
        name: `${wp}_${shared.run}_alert_a`,
        stream: shared.stream,
        sql: `SELECT service_name, count(*) AS c FROM "${shared.stream}" WHERE service_name = '${shared.svcA}' GROUP BY service_name`,
        destinations: [shared.dest],
        frequencyMinutes: 60,
        periodMinutes: 60,
      });
      shared.alertB = await dt.createSqlAlert(page, {
        name: `${wp}_${shared.run}_alert_b`,
        stream: shared.stream,
        sql: `SELECT count(*) AS c FROM "${shared.stream}"`,
        destinations: [shared.dest],
        frequencyMinutes: 60,
        periodMinutes: 60,
      });
      shared.alertFolder = await dt.createAlertFolder(page, `${wp}_${shared.run}_afolder`);
      testLogger.info('Create-spec fixtures seeded', { stream: shared.stream });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    reg = { prefix: dt.uniqueName(fx.workerPrefix(PREFIX, testInfo)), folders: [] };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }) => {
    if (reg) await dt.cleanupDowntimes(page, { prefix: reg.prefix, folderIds: reg.folders });
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (!gate.ready) return;
    const context = await browser.newContext();
    const page = await context.newPage();
    const wp = fx.workerPrefix(PREFIX, testInfo);
    await dt.cleanupDowntimes(page, { prefix: `${wp}_` });
    await dt.deleteAlertsAndFolders(page, [shared.alertA, shared.alertB], [shared.alertFolder]);
    await dt.deleteDestinationsByPrefix(page, `${wp}_`);
    await context.close();
  });

  test('DT-C-01 creates a one-time downtime for a specific alert, and the first Save saves nothing', { tag: ['@P1', '@alerts'] }, async ({ page }) => {
    test.setTimeout(4 * 60_000);
    const folderId = await fx.newDowntimeFolder(page, reg);
    const name = `${reg.prefix}_once`;
    const before = await dt.downtimeCountInFolder(page, folderId);
    // A save after the default start (the next full hour) would make the row active instead of scheduled.
    await pm.downtimesPage.waitOutLocalHourBoundary(120_000);
    const expected = await pm.downtimesPage.nextLocalHour();

    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(name);
    await pm.downtimesPage.addSpecificItems('alerts', [shared.alertA]);
    await pm.downtimesPage.save();

    await pm.downtimesPage.expectActiveTab('schedule');
    await pm.downtimesPage.expectCheckScheduleNudge();
    expect(await dt.downtimeCountInFolder(page, folderId), 'the first Save must not persist anything').toBe(before);

    await pm.downtimesPage.save();
    await pm.downtimesPage.expectToast('Downtime created');
    await pm.downtimesPage.expectOnListUrl(folderId);

    const row = (await dt.listDowntimes(page, { folder_id: folderId })).items.find((r) => r.name === name);
    expect(row, 'the saved downtime must be listed in its folder').toBeTruthy();
    await pm.downtimesPage.expectRowVisible(row.id);

    const saved = await dt.getDowntime(page, row.id, folderId);
    expect(saved.targets).toHaveLength(1);
    expect(saved.targets[0]).toMatchObject({ module: 'alerts', folders: { kind: 'all' }, ids: [shared.alertA.id] });
    expect(saved.schedule.repeat).toBe('none');
    expect(saved.schedule.ends_at - saved.schedule.starts_at).toBe(3600 * dt.MICROS);
    expect(saved.schedule.starts_at / 1000, 'the default start is the next full local hour').toBe(expected.startMs);
    expect(saved.status).toBe('scheduled');
  });

  test('DT-C-02 Enter in the name field never submits or saves', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const name = `${reg.prefix}_enter`;
    const before = await dt.downtimeCountInFolder(page, folderId);

    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(name, { pressEnterTimes: 2 });

    const samples = await dt.sampleCountOver(page, async () => (await dt.listDowntimes(page, { search: name })).total, { holdMs: 3000, everyMs: 1000 });
    expect(samples.every((c) => c === 0), `no downtime named ${name} may exist after Enter: ${samples}`).toBe(true);
    expect(await dt.downtimeCountInFolder(page, folderId)).toBe(before);
    await pm.downtimesPage.expectOnAddPage();
    await pm.downtimesPage.expectNoToast('Downtime created');
    await pm.downtimesPage.expectTitle(name);
  });

  test('DT-C-03 "Mute whole modules?": Cancel saves nothing and Mute all saves', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const name = `${reg.prefix}_muteall`;
    const before = await dt.downtimeCountInFolder(page, folderId);

    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(name);
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.setOnceWindow(fx.minutesFromNow(120), fx.minutesFromNow(180));
    await pm.downtimesPage.save();

    await pm.downtimesPage.expectMuteAllDialog({ present: ['alerts'] });
    await pm.downtimesPage.muteAllCancel();
    expect(await dt.downtimeCountInFolder(page, folderId), 'Cancel in the safety dialog must save nothing').toBe(before);

    await pm.downtimesPage.save();
    await pm.downtimesPage.expectMuteAllDialog({ present: ['alerts'] });
    await pm.downtimesPage.muteAllConfirm();
    await pm.downtimesPage.expectToast('Downtime created');

    const row = (await dt.listDowntimes(page, { folder_id: folderId })).items.find((r) => r.name === name);
    expect(row).toBeTruthy();
    const saved = await dt.getDowntime(page, row.id, folderId);
    expect(saved.targets[0].folders).toEqual({ kind: 'all' });
    expect(saved.targets[0].ids ?? []).toEqual([]);
    expect(saved.condition ?? null).toBeNull();
    expect(saved.status, 'a future window keeps the whole-module mute inactive').toBe('scheduled');
    await dt.cancelDowntime(page, row.id, folderId);
  });

  test('DT-C-04 the safety dialog lists only the unnarrowed modules', { tag: ['@P1', '@synthetics'] }, async ({ page }) => {
    // The ENT gate runs without ZO_SYNTHETICS_ENABLED, so the module is legitimately absent there.
    test.skip(gate.config.synthetics_enabled !== true, 'the synthetics module is not enabled here (config.synthetics_enabled)');
    const folderId = await fx.newDowntimeFolder(page, reg);
    const before = await dt.downtimeCountInFolder(page, folderId);

    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(`${reg.prefix}_partial`);
    await pm.downtimesPage.toggleModule('synthetics');
    await pm.downtimesPage.expectModulePressed('synthetics', true);
    await pm.downtimesPage.setTargetFolders('alerts', [shared.alertFolder]);
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.setOnceWindow(fx.minutesFromNow(120), fx.minutesFromNow(180));
    await pm.downtimesPage.save();

    await pm.downtimesPage.expectMuteAllDialog({
      title: 'Mute every synthetics check in this org?',
      present: ['synthetics'],
      absent: ['alerts'],
    });
    await pm.downtimesPage.muteAllCancel();
    expect(await dt.downtimeCountInFolder(page, folderId)).toBe(before);
  });

  test('DT-C-05 schedule defaults to the next full hour, and weekly preselects today', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    // The form computes its defaults when it opens; an hour or midnight passing before the read below would split them.
    await pm.downtimesPage.waitOutLocalHourBoundary();
    await pm.downtimesPage.gotoAdd(folderId);
    const expected = await pm.downtimesPage.nextLocalHour();
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.expectScheduleTimes(expected.start, expected.end);

    await pm.downtimesPage.setRepeat('weekly');
    for (let day = 1; day <= 7; day++) {
      await pm.downtimesPage.expectWeekdayPressed(day, day === expected.todayIso);
    }
    await pm.downtimesPage.expectSummary(new RegExp(`^Every ${expected.todayLong} at \\d{2}:\\d{2}`));
  });

  test('DT-C-06 the title is generated, and Refine by resource defaults to host', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    // The generated title carries the date of the default start, which an hour or midnight passing would shift.
    await pm.downtimesPage.waitOutLocalHourBoundary();
    await pm.downtimesPage.gotoAdd(folderId);
    const expected = await pm.downtimesPage.nextLocalHour();
    await pm.downtimesPage.expectTitle(`All alerts · once ${expected.autoDate}`);

    await pm.downtimesPage.openCondition();
    await pm.downtimesPage.fillConditionRow(0, { key: 'service', value: shared.svcA });
    await pm.downtimesPage.expectTitle(new RegExp(`^service=${shared.svcA} · once`));

    await pm.downtimesPage.expectResourceDimension('host');
    await pm.downtimesPage.loadResources();
    await pm.downtimesPage.expectResourceListed(shared.h1);
  });

  test('DT-C-07 the condition preview shows the incomplete state, then only the real matches', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.openCondition();
    await pm.downtimesPage.expectPreviewIncomplete('Finish the condition to see a preview.');
    await pm.downtimesPage.expectSummaryNotContains('with =');

    await pm.downtimesPage.fillConditionRow(0, { key: 'service', value: shared.svcA });
    await pm.downtimesPage.expectPreviewIncludes('alerts', shared.alertA.name, true);
    await pm.downtimesPage.expectPreviewIncludes('alerts', shared.alertB.name, false);
    await pm.downtimesPage.expectSummaryContains(`service=${shared.svcA}`);
  });

  test('DT-C-08 condition validation messages block the save', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const before = await dt.downtimeCountInFolder(page, folderId);
    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(`${reg.prefix}_cond`);
    await pm.downtimesPage.openCondition();

    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('Choose a dimension for every row.');

    await pm.downtimesPage.fillConditionRow(0, { key: 'service', value: '*' });
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('A value cannot be a lone *.');

    await pm.downtimesPage.fillConditionRow(0, { value: 'ab*c' });
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('A * is allowed only at the end of a value.');

    await pm.downtimesPage.fillConditionRow(0, { operator: '!=', value: shared.svcA });
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('Add at least one = condition. A condition made only of != rows would silence everything else.');

    expect(await dt.downtimeCountInFolder(page, folderId), 'an invalid condition must save nothing').toBe(before);
  });

  test('DT-C-09 one-time schedule validation moves a failed save to the Schedule tab', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const before = await dt.downtimeCountInFolder(page, folderId);
    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(`${reg.prefix}_sched`);
    await pm.downtimesPage.addSpecificItems('alerts', [shared.alertA]);

    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.setOnceWindow(fx.minutesFromNow(180), fx.minutesFromNow(120));
    await pm.downtimesPage.openTab('targets');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectActiveTab('schedule');
    await pm.downtimesPage.expectErrorText('The end must be after the start.');

    const start = fx.minutesFromNow(120);
    await pm.downtimesPage.setOnceWindow(start, new Date(start.getTime() + 8 * 24 * 3600_000));
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('A window can last at most 7 days.');

    expect(await dt.downtimeCountInFolder(page, folderId)).toBe(before);
  });

  test('DT-C-10 recurring schedule validation', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const before = await dt.downtimeCountInFolder(page, folderId);
    // Weekly preselects today, so midnight passing between the form opening and the read below would untick the wrong day.
    await pm.downtimesPage.waitOutLocalHourBoundary();
    await pm.downtimesPage.gotoAdd(folderId);
    const { todayIso } = await pm.downtimesPage.nextLocalHour();
    await pm.downtimesPage.setName(`${reg.prefix}_recur`);
    await pm.downtimesPage.addSpecificItems('alerts', [shared.alertA]);
    await pm.downtimesPage.openTab('schedule');

    await pm.downtimesPage.setRepeat('weekly');
    await pm.downtimesPage.toggleWeekday(todayIso);
    await pm.downtimesPage.expectWeekdayPressed(todayIso, false);
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('Choose at least one day.');

    await pm.downtimesPage.setRepeat('daily');
    await pm.downtimesPage.setDuration('abc');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('Enter a duration such as 90m or 1h 30m.');

    expect(await dt.downtimeCountInFolder(page, folderId)).toBe(before);
  });

  test('DT-C-11 name, module and folder validation, each on its owning tab', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const before = await dt.downtimeCountInFolder(page, folderId);
    await pm.downtimesPage.gotoAdd(folderId);

    await pm.downtimesPage.setName('n'.repeat(257));
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectNameError('A name can be at most 256 characters.');

    await pm.downtimesPage.setName(`${reg.prefix}_mods`);
    await pm.downtimesPage.toggleModule('alerts');
    await pm.downtimesPage.expectModulePressed('alerts', false);
    await pm.downtimesPage.expectNoModuleHint('Choose a module in Applies to.');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectErrorText('Choose at least one module.');

    await pm.downtimesPage.toggleModule('alerts');
    await pm.downtimesPage.clearTargetFolders('alerts');
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectActiveTab('targets');
    await pm.downtimesPage.expectErrorText('Choose All folders or at least one folder.');

    expect(await dt.downtimeCountInFolder(page, folderId)).toBe(before);
  });

  test('DT-C-12 editing an active downtime shows the active banner, reloads the condition and bumps the version', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const created = await dt.createDowntime(page, folderId, {
      name: `${reg.prefix}_active`,
      // The edit form always saves a top-level group, so seed that shape and expect it back unchanged.
      condition: { type: 'group', op: 'and', items: [dt.pair('service', shared.svcA)] },
      targets: [dt.allFoldersTarget('alerts')],
      schedule: dt.activeWindow(),
    });
    const before = await dt.getDowntime(page, created.id, folderId);

    await pm.downtimesPage.gotoEdit(created.id, folderId);
    await pm.downtimesPage.expectActiveEditBanner('This downtime is active. An edit takes effect at the next evaluation');
    await pm.downtimesPage.expectConditionRow(0, { key: 'service', operator: '=', value: shared.svcA });

    const renamed = `${reg.prefix}_active_renamed`;
    await pm.downtimesPage.setName(renamed);
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectToast('Downtime saved');

    const after = await dt.getDowntime(page, created.id, folderId);
    expect(after.version).toBe(before.version + 1);
    expect(after.name).toBe(renamed);
    expect(after.condition).toEqual(before.condition);
  });

  test('DT-C-13 a stale edit shows the 409 banner and Reload recovers the newer row', { tag: ['@P1'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const created = await dt.createDowntime(page, folderId, {
      name: `${reg.prefix}_stale`,
      targets: [dt.alertIdsTarget([shared.alertA.id])],
      schedule: dt.futureWindow({ startInSec: 7200 }),
    });
    await pm.downtimesPage.gotoEdit(created.id, folderId);

    const apiName = `${reg.prefix}_stale_api`;
    await dt.updateDowntime(page, created.id, folderId, { name: apiName });

    await pm.downtimesPage.setReason('changed in the UI after someone else saved');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectStaleBanner('Someone changed this downtime since you loaded it. Reload and try again.');
    expect((await dt.getDowntime(page, created.id, folderId)).name, 'the stale save must not overwrite').toBe(apiName);

    await pm.downtimesPage.reloadStale();
    await pm.downtimesPage.expectTitle(apiName);
  });

  test('DT-C-14 picking a notify destination ticks "ending soon" and "ended" with a 10m lead', { tag: ['@P2'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const name = `${reg.prefix}_notify`;
    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(name);
    await pm.downtimesPage.addSpecificItems('alerts', [shared.alertA]);
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.pickNotifyDestination(shared.dest);
    await pm.downtimesPage.expectNotifyEventChecked('ending_soon', true);
    await pm.downtimesPage.expectNotifyEventChecked('ended', true);
    await pm.downtimesPage.expectNotifyLead('10m');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectToast('Downtime created');

    const row = (await dt.listDowntimes(page, { folder_id: folderId })).items.find((r) => r.name === name);
    const saved = await dt.getDowntime(page, row.id, folderId);
    expect(saved.notifications.destinations).toEqual([shared.dest]);
    expect(saved.notifications.events.ending_soon).toBe(true);
    expect(saved.notifications.events.ended).toBe(true);
    expect(saved.notifications.ending_soon_lead_secs).toBe(600);
  });

  test('DT-C-15 incident mode "Not created" persists', { tag: ['@P2', '@incidents'] }, async ({ page }) => {
    const folderId = await fx.newDowntimeFolder(page, reg);
    const name = `${reg.prefix}_incmode`;
    await pm.downtimesPage.gotoAdd(folderId);
    await pm.downtimesPage.setName(name);
    await pm.downtimesPage.addSpecificItems('alerts', [shared.alertA]);
    await pm.downtimesPage.chooseIncidentModeNone();
    await pm.downtimesPage.openTab('schedule');
    await pm.downtimesPage.save();
    await pm.downtimesPage.expectToast('Downtime created');

    const row = (await dt.listDowntimes(page, { folder_id: folderId })).items.find((r) => r.name === name);
    const saved = await dt.getDowntime(page, row.id, folderId);
    expect(saved.targets[0].incident_mode).toBe('none');
  });
});
