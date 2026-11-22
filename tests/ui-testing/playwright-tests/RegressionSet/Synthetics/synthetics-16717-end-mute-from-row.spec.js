// Copyright 2026 OpenObserve Inc.
// openobserve#16717 (o2-enterprise#3437): a synthetics row could be muted from the list but its mute could not be ended there.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

test.describe('End a synthetics mute from the row that started it (#16717)', () => {
  test.describe.configure({ mode: 'parallel' });
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    synthetics = new SyntheticsRegressionPage(page);
    tag = synthetics.newRunTag();
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a row muted from its menu offers End mute there, and ending it unmutes the row', {
    tag: ['@bug-16717', '@P1', '@regression', '@syntheticsRegression'],
  }, async () => {
    await synthetics.getMetaOrg();
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_end_mute`, 'http', locationId);
    await synthetics.ensureDowntimeFolder();

    await synthetics.gotoMonitorsList();
    await synthetics.searchMonitors(check.name);
    await synthetics.expectMonitorRowVisible(check.name);
    const downtimeId = await synthetics.quickMuteMonitorRow(check.name);
    synthetics.createdDowntimeIds.push(downtimeId);
    await synthetics.expectMonitorRowMuted(check, true);

    expect(await synthetics.endMuteFromMonitorRow(check)).toBe(downtimeId);
    await synthetics.expectMonitorRowMuted(check, false);
    await expect.poll(() => synthetics.downtimeStatus(downtimeId), { timeout: 15000 }).toBe('ended_early');
  });

  test('a downtime over two checks shows only a Muted by link on each row', {
    tag: ['@bug-16717', '@P2', '@regression', '@syntheticsRegression'],
  }, async () => {
    await synthetics.getMetaOrg();
    const locationId = await synthetics.createProbeLocation(tag);
    const first = await synthetics.createCheck(`synreg${tag}_shared_a`, 'http', locationId);
    const second = await synthetics.createCheck(`synreg${tag}_shared_b`, 'http', locationId);
    const downtimeName = `synreg${tag}_shared_window`;
    const downtimeId = await synthetics.createDowntimeOverChecks(downtimeName, [first.id, second.id]);

    await synthetics.gotoMonitorsList();
    await synthetics.searchMonitors(`synreg${tag}_shared`);
    await synthetics.expectMonitorRowMuted(first, true);
    await synthetics.expectOnlyMutedByLink(first, downtimeName);
    await synthetics.expectOnlyMutedByLink(second, downtimeName);
    expect(await synthetics.downtimeStatus(downtimeId)).toBe('active');
  });
});
