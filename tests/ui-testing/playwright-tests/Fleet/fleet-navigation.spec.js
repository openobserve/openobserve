const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { FLEET_YAML } = require('../../pages/fleetPages/fleetSeed.js');

test.describe('Fleet management navigation', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
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

  test('FL-GATE-01 · Data → Fleet management opens /web/fleet on the Overview', {
    tag: ['@fleetNav', '@smoke', '@P0'],
  }, async () => {
    await pm.fleetManagerPage.openFromNav();
    await pm.fleetManagerPage.expectOnFleetRoute({ org_identifier: pm.fleetSeed.orgId() });
    await pm.fleetManagerPage.expectOverviewVisible();
  });

  test('FL-NAV-01 · tabs set ?tab= by replace and keep org_identifier, so Back leaves the page', {
    tag: ['@fleetNav', '@P1'],
  }, async () => {
    const org = pm.fleetSeed.orgId();
    await pm.fleetManagerPage.gotoFleet();
    await pm.fleetManagerPage.expectTabActive('overview');

    await pm.fleetManagerPage.clickTab('fleets');
    await pm.fleetManagerPage.expectOnFleetRoute({ tab: 'fleets', org_identifier: org });
    await pm.fleetManagerPage.clickTab('configurations');
    await pm.fleetManagerPage.expectOnFleetRoute({ tab: 'configurations', org_identifier: org });
    await pm.fleetManagerPage.clickTab('audit');
    await pm.fleetManagerPage.expectOnFleetRoute({ tab: 'audit', org_identifier: org });

    await pm.fleetManagerPage.goBackAndExpectLeftFleet();
  });

  test('FL-NAV-04 · an unknown ?fleet= says the fleet no longer exists', {
    tag: ['@fleetNav', '@P2'],
  }, async () => {
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: pm.fleetSeed.fleetName('missing') });
    await pm.fleetManagerPage.expectFleetNotFound('This fleet no longer exists');
  });

  test('FL-NAV-05 · ?scope=all&status=offline shows the Fleet column, Offline pressed and no fleet panel', {
    tag: ['@fleetNav', '@P1'],
  }, async () => {
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', scope: 'all', status: 'offline' });
    await pm.fleetManagerPage.expectAllFleetsScope();
    await pm.fleetManagerPage.expectStatPressed('offline');
    await pm.fleetManagerPage.expectFleetPanelHidden();
  });

  test('FL-NAV-08 · ?rollout= of fleet B with ?fleet=A opens that rollout and switches to fleet B', {
    tag: ['@fleetNav', '@P1'],
  }, async () => {
    const fleetA = await pm.fleetSeed.createFleet('a');
    const fleetB = await pm.fleetSeed.createFleet('b');
    const config = await pm.fleetSeed.createConfig('nav', FLEET_YAML.publishable);
    const version = await pm.fleetSeed.publishConfig(config, FLEET_YAML.publishable);
    const rollout = await pm.fleetSeed.setDesired(fleetB.id, config, version);
    await pm.fleetSeed.waitForRolloutStatus(rollout.id, 'completed');

    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleetA.id, rollout: rollout.id });
    await pm.fleetManagerPage.expectQueryParam('fleet', fleetB.id);
    await pm.fleetFleetsPage.expectRailItemActive(fleetB.id);
    await pm.fleetFleetsPage.expectRolloutDrawerStatus('No collectors targeted');
  });

  test('FL-NAV-10 · the config editor deep link opens the editor and Back returns to ?tab=configurations', {
    tag: ['@fleetNav', '@P2'],
  }, async () => {
    const config = await pm.fleetSeed.createConfig('deeplink', FLEET_YAML.seed);
    await pm.fleetConfigPage.goto(config);
    await pm.fleetConfigPage.expectTitle(config);

    await pm.fleetConfigPage.clickBack();
    await pm.fleetManagerPage.expectOnFleetRoute({ tab: 'configurations', org_identifier: pm.fleetSeed.orgId() });
    await pm.fleetManagerPage.expectTabActive('configurations');
  });
});
