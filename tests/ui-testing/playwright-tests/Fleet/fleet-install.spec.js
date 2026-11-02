const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const FleetInstallPage = require('../../pages/fleetPages/fleetInstallPage.js');

const PLATFORMS = [
  { id: 'FL-INST-03', label: 'Linux', platform: 'linux' },
  { id: 'FL-INST-04', label: 'macOS', platform: 'macos' },
  { id: 'FL-INST-05', label: 'Windows', platform: 'windows' },
  { id: 'FL-INST-06', label: 'Docker', platform: 'docker' },
  { id: 'FL-INST-07', label: 'Kubernetes agent', platform: 'kubernetes', role: 'agent' },
  { id: 'FL-INST-08', label: 'Kubernetes gateway', platform: 'kubernetes', role: 'gateway' },
];

test.describe('Fleet management Add collector', { tag: ['@fleet', '@enterprise', '@all'] }, () => {
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

  for (const p of PLATFORMS) {
    test(`${p.id} + FL-INST-09 + FL-UNI-02 · ${p.label}: every install line over HTTP and WebSocket, uninstall without the token`, {
      tag: ['@fleetInstall', '@regression', '@P0'],
    }, async () => {
      const fleet = await pm.fleetSeed.createFleet(`inst_${p.platform}_${p.role ?? 'host'}`);
      const token = await pm.fleetSeed.createToken(fleet.id, 'tok');
      await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
      await pm.fleetFleetsPage.openAddCollector();
      await pm.fleetInstallPage.expectDialogOpen();
      await pm.fleetInstallPage.expectCommandShown();

      await pm.fleetInstallPage.selectPlatform(p.platform);
      if (p.role) await pm.fleetInstallPage.selectRole(p.role);
      const target = { ...(await pm.fleetInstallPage.installTarget(pm.fleetSeed, token.token)), role: p.role };
      await pm.fleetInstallPage.revealToken();

      await pm.fleetInstallPage.expectWebsocket(false);
      await pm.fleetInstallPage.expectCommandLines(
        FleetInstallPage.expectedInstallLines(p.platform, { ...target, http: true }),
      );

      await pm.fleetInstallPage.setWebsocket(true);
      await pm.fleetInstallPage.expectCommandLines(
        FleetInstallPage.expectedInstallLines(p.platform, { ...target, http: false }),
      );

      await pm.fleetInstallPage.expandUninstall();
      await pm.fleetInstallPage.expectUninstallLines(
        FleetInstallPage.expectedUninstallLines(p.platform, p.role),
        token.token,
      );
    });
  }

  test('R-16042 · a Kubernetes cluster name becomes --set-string clusterName with commas escaped; empty adds no flag', {
    tag: ['@fleetInstall', '@regression', '@P2'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('cluster');
    const token = await pm.fleetSeed.createToken(fleet.id, 'tok');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectCommandShown();
    await pm.fleetInstallPage.selectPlatform('kubernetes');
    const target = { ...(await pm.fleetInstallPage.installTarget(pm.fleetSeed, token.token)), http: true, role: 'agent' };
    await pm.fleetInstallPage.revealToken();

    await pm.fleetInstallPage.setClusterName('prod,us-east');
    const withName = FleetInstallPage.expectedInstallLines('kubernetes', { ...target, clusterName: 'prod,us-east' });
    expect(withName).toContain("  --set-string clusterName='prod\\,us-east' \\");
    await pm.fleetInstallPage.expectCommandLines(withName);

    await pm.fleetInstallPage.setClusterName('');
    const withoutName = FleetInstallPage.expectedInstallLines('kubernetes', target);
    expect(withoutName.some((line) => line.includes('clusterName'))).toBe(false);
    await pm.fleetInstallPage.expectCommandLines(withoutName);
  });

  test('FL-INST-10 · the token stays masked until Reveal, and Copy gives the full command with the real token', {
    tag: ['@fleetInstall', '@P1'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('mask');
    const token = await pm.fleetSeed.createToken(fleet.id, 'tok');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectCommandShown();
    const target = { ...(await pm.fleetInstallPage.installTarget(pm.fleetSeed, token.token)), http: true };

    await pm.fleetInstallPage.expectCommandMasked(token.token);
    const copied = await pm.fleetInstallPage.copyCommand();
    expect(copied.split('\n')).toEqual(FleetInstallPage.expectedInstallLines('linux', target));

    await pm.fleetInstallPage.revealToken();
    await pm.fleetInstallPage.expectCommandLines(FleetInstallPage.expectedInstallLines('linux', target));
  });

  test('FL-INST-01 + R-16103 · with no token the inline form creates one, shows the command and polls collectors again', {
    tag: ['@fleetInstall', '@regression', '@P0'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('notoken');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectNoTokenState();

    const created = await pm.fleetInstallPage.createInlineTokenAndAwaitCollectorsPoll(pm.fleetSeed.fleetName('inline'));
    expect(created.token).toMatch(/^o2ft_/);
    expect(created.fleet?.id).toBe(fleet.id);

    await pm.fleetInstallPage.expectCommandShown();
    await pm.fleetInstallPage.expectCopyOnceAndWaiting();
    await pm.fleetInstallPage.expectCommandMasked(created.token);
  });

  test('FL-INST-02 + FL-INST-11 · the token select lists "{name} (no collectors)" newest first, says which fleet it joins, and --url is the ingestion URL', {
    tag: ['@fleetInstall', '@P1'],
  }, async () => {
    const fleet = await pm.fleetSeed.createFleet('pick');
    const older = await pm.fleetSeed.createToken(fleet.id, 'older');
    const newer = await pm.fleetSeed.createToken(fleet.id, 'newer');
    await pm.fleetManagerPage.gotoFleet({ tab: 'fleets', fleet: fleet.id });
    await pm.fleetFleetsPage.openAddCollector();
    await pm.fleetInstallPage.expectCommandShown();

    await pm.fleetInstallPage.expectSelectedToken(`${newer.name} (no collectors)`);
    expect(await pm.fleetInstallPage.tokenOptionLabels()).toEqual([
      `${newer.name} (no collectors)`,
      `${older.name} (no collectors)`,
    ]);
    await pm.fleetInstallPage.expectJoinsText(
      `Collectors installed with this token join fleet ${fleet.name}, which has no configuration yet.`,
    );

    const target = { ...(await pm.fleetInstallPage.installTarget(pm.fleetSeed, newer.token)), http: true };
    await pm.fleetInstallPage.revealToken();
    const lines = FleetInstallPage.expectedInstallLines('linux', target);
    expect(lines[1]).toBe(`  --url '${target.baseUrl}' \\`);
    await pm.fleetInstallPage.expectCommandLines(lines);
  });
});
