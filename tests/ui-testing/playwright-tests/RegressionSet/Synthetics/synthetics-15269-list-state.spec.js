const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

const TAGS = ['@bug-15269', '@P1', '@regression', '@syntheticsRegression'];

test.describe('Synthetics lists keep their view state on return (#15269)', () => {
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

  test('the checks list keeps its search, type tab, status, sort, page size and page after opening a check and coming back', {
    tag: TAGS,
  }, async () => {
    const locationId = await synthetics.createProbeLocation(tag);
    const prefix = `synreg${tag}`;
    const httpNames = synthetics.numberedNames(`${prefix}_http_`, 12);
    for (const name of httpNames) await synthetics.createCheck(name, 'http', locationId);
    const tcpName = `${prefix}_tcp_00`;
    await synthetics.createCheck(tcpName, 'tcp', locationId);

    await synthetics.gotoMonitorsList();
    await synthetics.searchMonitors(prefix);
    await synthetics.expectMonitorRowVisible(tcpName);
    await synthetics.selectTypeTab('http');
    await synthetics.expectMonitorRowAbsent(tcpName);
    await synthetics.selectStatusTile('unknown');
    await synthetics.sortMonitors('name', 'desc');
    await synthetics.setMonitorsPageSize(10);
    await synthetics.nextMonitorsPage();
    const listState = {
      search: prefix,
      type: 'http',
      status: 'unknown',
      sortColumn: 'name',
      sortDirection: 'desc',
      pageSize: 10,
      from: 11,
      to: 12,
      total: 12,
      names: [httpNames[1], httpNames[0]],
    };
    await synthetics.expectMonitorsListState(listState);
    testLogger.info('Checks list state applied before leaving');

    await synthetics.openMonitor(httpNames[1]);
    await synthetics.clickResultsBack();
    await synthetics.expectMonitorsListState(listState);
    testLogger.info('Checks list state restored after the in-app back button');

    await synthetics.openMonitor(httpNames[1]);
    await synthetics.browserBack();
    await synthetics.expectMonitorsListState(listState);
    testLogger.info('Checks list state restored after browser back');
  });

  test("a check's runs list keeps its status filter, sort, page size and page after leaving the results page and coming back", {
    tag: TAGS,
  }, async () => {
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_runs`, 'http', locationId);
    const passed = Array.from({ length: 25 }, (_, i) => ({ status: 'passed', durationMs: 100 + i * 10, ageSec: 20 + i * 8 }));
    const failed = Array.from({ length: 3 }, (_, i) => ({ status: 'failed', durationMs: 6000 + i * 10, ageSec: 24 + i * 8 }));
    await synthetics.seedRuns(check, locationId, [...passed, ...failed]);

    await synthetics.gotoMonitorsList();
    await synthetics.searchMonitors(check.name);
    await synthetics.openMonitor(check.name);
    await synthetics.waitForRunsTable();
    await synthetics.selectRunStatus('pass');
    await synthetics.sortRuns('duration', 'asc');
    await synthetics.setRunsPageSize(20);
    await synthetics.nextRunsPage();
    const runsState = {
      status: 'pass',
      sortColumn: 'duration',
      sortDirection: 'asc',
      pageSize: 20,
      from: 21,
      to: 25,
      total: 25,
      durationsMs: passed.slice(20).map((run) => run.durationMs),
    };
    await synthetics.expectRunsListState(runsState);
    testLogger.info('Runs list state applied before leaving');

    await synthetics.openEditCheck(check.id);
    await synthetics.browserBack();
    await synthetics.expectRunsListState(runsState);
    testLogger.info('Runs list state restored after browser back from the edit page');

    await synthetics.clickResultsBack();
    await synthetics.openMonitor(check.name);
    await synthetics.expectRunsListState(runsState);
    testLogger.info('Runs list state restored after going back to the checks list and reopening the check');
  });

  test("back from a browser run's full page reopens that run on the results page with the same time range", {
    tag: TAGS,
  }, async () => {
    await synthetics.expectBackFromRunPageReopensRun(tag, 'browser');
  });

  test.fixme("back from an HTTP run's full page reopens that run on the results page with the same time range", {
    tag: TAGS,
    annotation: { type: 'issue', description: 'Still broken on main: the http/tcp/tls/ssh run page (ProtocolRunSummary) back drops the run and time range; #15269 only changed RunDetail' },
  }, async () => {
    await synthetics.expectBackFromRunPageReopensRun(tag, 'http');
  });

  test('the synthetics locations list keeps its search, sort, page size and page after leaving it and coming back', {
    tag: TAGS,
  }, async () => {
    const metaOrg = await synthetics.getMetaOrg();
    const locations = synthetics.numberedProbeLocations(tag, 12);
    await synthetics.createPublicLocations(locations);

    await synthetics.gotoLocations(metaOrg);
    await synthetics.searchLocations(tag);
    await synthetics.sortLocations('name', 'desc');
    await synthetics.setLocationsPageSize(10);
    await synthetics.nextLocationsPage();
    const listState = {
      search: tag,
      sortColumn: 'name',
      sortDirection: 'desc',
      pageSize: 10,
      from: 11,
      to: 12,
      total: 12,
      names: [locations[1].label, locations[0].label],
    };
    await synthetics.expectLocationsListState(listState);
    testLogger.info('Locations list state applied before leaving');

    await synthetics.openGeneralSettings();
    await synthetics.openLocationsFromRail();
    await synthetics.expectLocationsListState(listState);
    testLogger.info('Locations list state restored after reopening it from the settings menu');

    await synthetics.openGeneralSettings();
    await synthetics.browserBack();
    await synthetics.expectLocationsListState(listState);
    testLogger.info('Locations list state restored after browser back');
  });
});
