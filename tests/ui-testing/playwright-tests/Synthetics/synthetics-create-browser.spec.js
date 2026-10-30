// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Synthetics create — browser check via "Build manually", no recorder extension.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  uniqueName,
  dummySecret,
  getCheck,
  findCheckByName,
  cleanupWorkerEntities,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const START_URL = 'https://example.com';
const BASIC_AUTH_PASSWORD = dummySecret();

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics create — browser (build manually)', { tag: ['@synthetics', '@all'] }, () => {
  let pm;
  let locationId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    locationId = await ensureSyntheticsLocation(page);
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    await cleanupWorkerEntities(browser, testInfo);
  });

  // Gate → empty journey → navigate step + page_title assertion → Configure.
  async function buildTwoStepJourney(name) {
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'browser');
    await pm.syntheticsCreatePage.fillGate(START_URL, name);
    await pm.syntheticsCreatePage.buildManually();
    await pm.syntheticsCreatePage.expectJourneyStepCount(0);
    await pm.syntheticsCreatePage.addNavigateStep(START_URL);
    await pm.syntheticsCreatePage.expectJourneyStepCount(1);
    await pm.syntheticsCreatePage.addStep();
    await pm.syntheticsCreatePage.setStepAction('assert');
    await pm.syntheticsCreatePage.setStepName('Title is Example Domain');
    await pm.syntheticsCreatePage.setAssertion('page_title', 'Example Domain');
    await pm.syntheticsCreatePage.continueToConfigure();
    await pm.syntheticsCreatePage.expectOnConfigureStep();
  }

  test('creates a browser check via Build manually', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('browser', testInfo);
    testLogger.info('Building a two-step journey for a new browser check', { name });
    await buildTwoStepJourney(name);
    testLogger.info('Selecting a location and saving the check disabled');
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    testLogger.info('Verifying the saved check through the list and the API');
    const created = await findCheckByName(page, name);
    expect(created).toBeTruthy();
    await pm.syntheticsListPage.search(name);
    await pm.syntheticsListPage.expectRowVisible(created.id);
    const { body } = await getCheck(page, created.id);
    expect(body.type).toBe('browser');
    expect(body.config.steps).toHaveLength(2);
    expect(body.config.steps[1].assertion).toEqual({ kind: 'page_title', expected: 'Example Domain' });
    expect(body.config.browser_devices).toContainEqual({ browser: 'chromium', device: 'desktop' });
  });

  test('gate rejects an invalid start URL and disables Build', { tag: ['@P1'] }, async () => {
    testLogger.info('Opening the browser create gate');
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'browser');
    await pm.syntheticsCreatePage.fillGate('ftp://x');
    testLogger.info('Verifying the gate rejects the start URL');
    await pm.syntheticsCreatePage.expectGateUrlRejected();
  });

  test('a click step without a locator blocks Continue', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Opening the journey builder via Build manually');
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'browser');
    await pm.syntheticsCreatePage.fillGate(START_URL, uniqueName('nolocator', testInfo));
    await pm.syntheticsCreatePage.buildManually();
    await pm.syntheticsCreatePage.addNavigateStep(START_URL);
    testLogger.info('Adding a step with no locator');
    // A new step defaults to `click` with an empty locator.
    await pm.syntheticsCreatePage.addStep();
    testLogger.info('Verifying Continue is blocked by the locator error');
    await pm.syntheticsCreatePage.continueToConfigure();
    await pm.syntheticsCreatePage.expectStepLocatorError();
    await pm.syntheticsCreatePage.expectOnJourneyStep();
  });

  test('auth, retries, alerts and variables persist', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('configure', testInfo);
    testLogger.info('Building a journey for a new browser check', { name });
    await buildTwoStepJourney(name);
    testLogger.info('Setting auth, retries, alerts and a variable');
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.setBasicAuth('e2e-user', BASIC_AUTH_PASSWORD);
    // Run-budget gate (combos × attempts × step timeout vs ZO_SYNTHETICS_MAX_CHECK_BUDGET_SECS): one retry is the ceiling here.
    await pm.syntheticsCreatePage.setRetries(1, 30);
    await pm.syntheticsCreatePage.setAlerts(3, 10);
    await pm.syntheticsCreatePage.addVariable('BASE_URL', START_URL);
    testLogger.info('Saving the check and capturing the response');
    const response = await pm.syntheticsCreatePage.saveCapturingResponse();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    testLogger.info('Verifying the configure fields persisted through the API');
    expect([200, 201]).toContain(response.status);
    expect(response.text).not.toContain(BASIC_AUTH_PASSWORD);
    const { body } = await getCheck(page, response.body.id);
    expect(body.retries).toBe(1);
    expect(body.wait_before_retry_secs).toBe(30);
    expect(body.alert_if_fails).toBe(3);
    expect(body.cooldown_mins).toBe(10);
    expect(body.variables[0].name).toBe('BASE_URL');
    expect(body.auth.username).toBe('e2e-user');
    expect(body.auth.password).toBe(BASIC_AUTH_PASSWORD);
  });

  test('variables panel validates names and undoes a removal', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    testLogger.info('Building a journey to reach the variables panel');
    await buildTwoStepJourney(uniqueName('variables', testInfo));
    const c = pm.syntheticsCreatePage;

    testLogger.info('Verifying an invalid variable name is rejected');
    await c.openAddVariable();
    await c.typeVariableName('1abc');
    await c.expectVariableNameError('Names start with a letter or underscore');
    await c.addVariable('A', '1');
    await c.expectVariableCount(1);

    testLogger.info('Verifying a duplicate variable name is rejected');
    await c.openAddVariable();
    await c.typeVariableName('A');
    await c.expectVariableNameError('A variable with this name already exists.');
    await c.addVariable('B', '2');
    await c.expectVariableCount(2);

    testLogger.info('Removing a variable and undoing the removal');
    await c.removeVariable(1);
    await c.expectVariableCount(1);
    await c.undoVariableRemoval();
    await c.expectVariableCount(2);
  });

  test('tags, description and device matrix round-trip', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    const name = uniqueName('details', testInfo);
    testLogger.info('Building a journey for a new browser check', { name });
    await buildTwoStepJourney(name);
    const c = pm.syntheticsCreatePage;
    testLogger.info('Setting tags, description and a second device');
    await c.selectLocation(locationId);
    await c.setEnabled(false);
    await c.addTag('alpha');
    await c.addTag('beta');
    await c.removeTag(0);
    await c.fillDescription('synthetics e2e description');
    // Two combos only fit the run budget without retries.
    await c.setRetries(0, 5);
    await c.toggleDevice('chromium', 'mobile');
    await c.save();
    await c.expectSavedAndListed();

    testLogger.info('Verifying tags, description and devices through the API');
    const created = await findCheckByName(page, name);
    expect(created).toBeTruthy();
    const { body } = await getCheck(page, created.id);
    expect(body.tags).toEqual(['beta']);
    expect(body.description).toBe('synthetics e2e description');
    expect(body.config.browser_devices).toHaveLength(2);
  });
});
