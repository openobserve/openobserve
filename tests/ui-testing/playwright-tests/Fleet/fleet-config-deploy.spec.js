const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { FLEET_YAML } = require('../../pages/fleetPages/fleetSeed.js');

const DOTTED_KEY = 'system.resource_attributes."host.id".enabled';

test.describe('Fleet management configurations and deploy', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.fleetManagerPage.assertEnabled();
  });

  test.afterEach(async () => {
    await pm.fleetSeed.cleanup();
    expect(await pm.fleetSeed.survivors()).toEqual([]);
  });

  test('FL-CFG-03 + FL-CFG-08 · palette OTLP, Batch, OpenObserve and Memory limiter wire a pipeline with memory_limiter first and env references', {
    tag: ['@fleetConfig', '@smoke', '@P0'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('palette', FLEET_YAML.seed);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.expectVisualMode();

    await pm.fleetConfigPage.addFromPalette('receiver', 'otlp', 'logs|receiver:otlp');
    await pm.fleetConfigPage.addFromPalette('processor', 'batch', 'logs|processor:batch');
    await pm.fleetConfigPage.addFromPalette('exporter', 'openobserve', 'logs|exporter:otlphttp/openobserve');
    await pm.fleetConfigPage.addFromPalette('processor', 'memory_limiter', 'logs|processor:memory_limiter');

    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.expectYaml(FLEET_YAML.paletteResult);
    const yaml = await pm.fleetConfigPage.readYaml();
    expect(yaml).toContain('processors: [memory_limiter, batch]');
    expect(yaml).toContain('endpoint: "${env:O2_ENDPOINT}"');
    expect(yaml).toContain('Authorization: "${env:O2_TOKEN}"');
  });

  test('FL-CFG-04 + FL-CFG-05 · a YAML edit round-trips through Visual byte for byte and a dotted key stays one key', {
    tag: ['@fleetConfig', '@regression', '@P1'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('roundtrip', FLEET_YAML.seed);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.setYaml(FLEET_YAML.dottedKey);

    await pm.fleetConfigPage.switchToVisual();
    await pm.fleetConfigPage.selectNode('logs|processor:resourcedetection');
    await pm.fleetConfigPage.expectPropertyValue(DOTTED_KEY, 'true');
    await pm.fleetConfigPage.expectNoProperty('system.resource_attributes.host.id.enabled');
    await pm.fleetConfigPage.setProperty(DOTTED_KEY, 'false');

    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.expectYaml(FLEET_YAML.dottedKey.replace('enabled: true', 'enabled: false'));
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

  test('FL-CFG-09 · invalid YAML validates as "1 error · publish blocked" and Publish is refused', {
    tag: ['@fleetConfig', '@smoke', '@P0'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('invalid', FLEET_YAML.seed);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.setYaml(FLEET_YAML.broken);
    await pm.fleetConfigPage.expectVisualUnavailable();

    await pm.fleetConfigPage.validate();
    await pm.fleetConfigPage.expectValidationChip('1 error · publish blocked');

    await pm.fleetConfigPage.publish('fleet automation invalid');
    await pm.fleetManagerPage.expectAnyErrorToast();
    await pm.fleetConfigPage.expectModeChip('Editing draft');
    expect((await pm.fleetSeed.getConfig(config)).latest_version).toBe(0);
  });

  test('FL-VER-01 + FL-VER-02 · publishing reads "published v1 · not rolled out"; after v2 Compare shows the diff and is off for v1', {
    tag: ['@fleetConfig', '@P1'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('versions', FLEET_YAML.publishable);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.expectModeChip('Editing draft');

    await pm.fleetConfigPage.publish('first version');
    await pm.fleetConfigPage.expectModeChip('Viewing published v1 · not rolled out');
    await pm.fleetConfigPage.expectSuccessToast('Published v1');

    await pm.fleetConfigPage.switchToYaml();
    await pm.fleetConfigPage.setYaml(FLEET_YAML.publishable.replace('https://example.com', 'https://example.org'));
    await pm.fleetConfigPage.expectModeChip('Editing draft');
    await pm.fleetConfigPage.publish('second version');
    await pm.fleetConfigPage.expectModeChip('Viewing published v2 · not rolled out');

    await pm.fleetConfigPage.openHistory();
    await pm.fleetConfigPage.expectCompareDisabled(1);
    await pm.fleetConfigPage.compare(2);
    await pm.fleetConfigPage.expectDiffContains('https://example.org');
    expect((await pm.fleetSeed.getConfig(config)).latest_version).toBe(2);
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

  test('FL-RO-01 · the deploy dialog disables Scheduled for an empty fleet and refuses counts below 1 and a max below the initial batch', {
    tag: ['@fleetDeploy', '@P1'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('guards');
    const config = await pm.fleetSeed.createConfig('guards', FLEET_YAML.publishable);
    const v1 = await pm.fleetSeed.publishConfig(config, FLEET_YAML.publishable);
    const seeded = await pm.fleetSeed.setDesired(fleet.id, config, v1);
    await pm.fleetSeed.waitForRolloutStatus(seeded.id, 'completed');
    // A desired v1 plus a published v2 seeds a valid config and version, so only the batching fields are judged.
    await pm.fleetSeed.publishConfig(config, FLEET_YAML.publishable.replace('https://example.com', 'https://example.org'));
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openDeploy();
    await pm.fleetRolloutPage.expectReady();
    await pm.fleetRolloutPage.expectScheduledDisabled();

    await pm.fleetRolloutPage.chooseBatching('canary');
    await pm.fleetRolloutPage.setCanaryFirst(0);
    await pm.fleetRolloutPage.submit();
    await pm.fleetRolloutPage.expectFirstError('Enter a whole number of 1 or more');

    await pm.fleetRolloutPage.chooseBatching('progressive');
    await pm.fleetRolloutPage.setProgressive(5, 2);
    await pm.fleetRolloutPage.submit();
    await pm.fleetRolloutPage.expectMaxError('Use at least the initial batch');
    expect((await pm.fleetSeed.rolloutsForConfig(config)).map((r) => r.id)).toEqual([seeded.id]);
  });
});
