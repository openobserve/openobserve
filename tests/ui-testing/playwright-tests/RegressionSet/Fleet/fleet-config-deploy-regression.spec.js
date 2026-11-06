const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { FLEET_YAML } = require('../../../pages/fleetPages/fleetSeed.js');

test.describe('Fleet management configurations and deploy regressions', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    // Cleared first so a failed navigation never leaves afterEach the previous test's closed page.
    pm = undefined;
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.fleetManagerPage.assertEnabled();
  });

  test.afterEach(async () => {
    if (!pm) return;
    await pm.fleetSeed.cleanup();
    expect(await pm.fleetSeed.survivors()).toEqual([]);
  });

  test('R-16104a · Visual keeps "true", "123" and "null" as strings, and YAML with a quoted number opens in Visual', {
    tag: ['@fleetConfig', '@regression', '@P1'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('quoted', FLEET_YAML.seed);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.setYaml(FLEET_YAML.quotedNumber);

    await pm.fleetConfigPage.switchToVisual();
    await pm.fleetConfigPage.selectNode('logs|exporter:debug');
    await pm.fleetConfigPage.expectPropertyValue('verbosity', '"123"');
    await pm.fleetConfigPage.addSetting('fl_true', '"true"');
    await pm.fleetConfigPage.addSetting('fl_num', '"123"');
    await pm.fleetConfigPage.addSetting('fl_null', '"null"');

    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.expectYaml(
      FLEET_YAML.quotedNumber.replace(
        '    verbosity: "123"\n',
        '    verbosity: "123"\n    fl_true: "true"\n    fl_num: "123"\n    fl_null: "null"\n',
      ),
    );
  });

  test('R-16104b · Deploy from the editor opens with no fleet picked and is blocked with "Pick a fleet"', {
    tag: ['@fleetDeploy', '@regression', '@P1'],
  }, async () => {
    await pm.fleetSeed.createFleet('pick');
    const config = await pm.fleetSeed.createConfig('deploy', FLEET_YAML.publishable);
    await pm.fleetSeed.publishConfig(config, FLEET_YAML.publishable);
    await pm.fleetConfigPage.goto(config);

    await pm.fleetConfigPage.openDeployFromEditor();
    await pm.fleetRolloutPage.expectReady();
    await pm.fleetRolloutPage.expectNoFleetPicked();
    await pm.fleetRolloutPage.submit();
    await pm.fleetRolloutPage.expectFleetError('Pick a fleet');
    expect(await pm.fleetSeed.rolloutsForConfig(config)).toEqual([]);
  });

  test('R-3311-8 · Fix forward on a halted rollout opens the editor with Publish off until the YAML differs from the failed version', {
    tag: ['@fleetConfig', '@regression', '@P2'],
  }, async () => {
    const halted = await pm.fleetSeed.seedRejectedRollout('fixfwd', FLEET_YAML.publishable);
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: halted.fleetId, rollout: halted.rolloutId });
    await pm.fleetFleetsPage.fixForwardFromRolloutDrawer();

    await pm.fleetConfigPage.expectOpenedFor(halted.config);
    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.expectYaml(FLEET_YAML.publishable);
    await pm.fleetConfigPage.expectPublishEnabled(false);
    await pm.fleetConfigPage.setYaml(FLEET_YAML.publishable.replace('https://example.com', 'https://example.org'));
    await pm.fleetConfigPage.expectPublishEnabled(true);
    await pm.fleetConfigPage.setYaml(FLEET_YAML.publishable);
    await pm.fleetConfigPage.expectPublishEnabled(false);
    expect((await pm.fleetSeed.getConfig(halted.config)).latest_version).toBe(halted.version);
  });

  test('R-3311-12 · the deploy dialog shows a 90 s phase timeout as "1 min 30 s", not rounded up to "2 min"', {
    tag: ['@fleetDeploy', '@regression', '@P3'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('timeout');
    await pm.fleetSeed.setFleetSettings(fleet.id, { phase_timeout_secs: 90 });
    const config = await pm.fleetSeed.createConfig('timeout', FLEET_YAML.publishable);
    const v1 = await pm.fleetSeed.publishConfig(config, FLEET_YAML.publishable);
    // Spec §9.3: a fleet with no collectors waits on an unproven version; the dialog only needs a desired version.
    const seeded = await pm.fleetSeed.setDesired(fleet.id, config, v1);
    await pm.fleetSeed.waitForRolloutStatus(seeded.id, 'waiting');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openDeploy();
    await pm.fleetRolloutPage.expectReady();

    expect(await pm.fleetRolloutPage.timeoutNoteText()).not.toContain('2 min');
    await pm.fleetRolloutPage.expectTimeoutNoteContains(/\b(1 min 30 s|90 s|1\.5 min)\b/);
  });
});
