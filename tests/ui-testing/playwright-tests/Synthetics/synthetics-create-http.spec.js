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

// Synthetics create — HTTP; the protocol flow has no client-side validation, so 400s land in a toast.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  uniqueName,
  createCheck,
  getCheck,
  deleteCheck,
  findCheckByName,
  createAlertTemplate,
  createAlertDestination,
  deleteAlertDestinationAndTemplate,
  cleanupWorkerEntities,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const HTTP_CONFIG = { method: 'GET', timeout_ms: 10000, follow_redirects: true, headers: [] };

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics create — HTTP', { tag: ['@synthetics', '@all'] }, () => {
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

  test('creates an HTTP check through the form', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('http', testInfo);

    testLogger.info('Opening the HTTP create form', { name });
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    // The form seeds one status_code assertion; this appends a second one.
    await pm.syntheticsCreatePage.addAssertion('response_time_ms', 'lt', 5000);
    testLogger.info('Selecting a location and saving the check disabled');
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    testLogger.info('Verifying the saved check through the list and the API');
    const created = await findCheckByName(page, name);
    expect(created, 'the check must be listed by the API').toBeTruthy();
    await pm.syntheticsListPage.search(name);
    await pm.syntheticsListPage.expectRowVisible(created.id);

    const { body } = await getCheck(page, created.id);
    expect(body.type).toBe('http');
    expect(body.locations).toEqual([locationId]);
    expect(body.config.assertions).toEqual([
      { field: 'status_code', operator: 'eq', value: 200 },
      { field: 'response_time_ms', operator: 'lt', value: 5000 },
    ]);
  });

  test('server rejects missing name, target and locations', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('invalid', testInfo);
    testLogger.info('Opening the HTTP create form without a name');
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.selectLocation(locationId);

    testLogger.info('Verifying save without a name is rejected');
    const noName = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noName.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('name: must not be empty');

    testLogger.info('Verifying save without a target is rejected');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('');
    const noTarget = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noTarget.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('target');

    testLogger.info('Verifying save without a location is rejected');
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.deselectLocation(locationId);
    const noLocation = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noLocation.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('locations');

    expect(await findCheckByName(page, name)).toBeNull();
  });

  test('cancelling a dirty form asks before leaving', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('dirty', testInfo);
    testLogger.info('Opening the HTTP create form and typing a name', { name });
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(name);
    testLogger.info('Cancelling the dirty form and confirming leave');
    await pm.syntheticsCreatePage.cancel();
    await pm.syntheticsCreatePage.confirmLeave();
    testLogger.info('Verifying the list is shown and no check was saved');
    await expect(page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });
    expect(await findCheckByName(page, name)).toBeNull();
  });

  test('custom interval and cron schedules persist', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const intervalName = uniqueName('interval', testInfo);
    testLogger.info('Creating a check with a custom interval', { name: intervalName });
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(intervalName);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.setCustomInterval(10);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    testLogger.info('Creating a check with a cron schedule');
    const cronName = uniqueName('cron', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(cronName);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    // The cron hint is client-side only (six fields, seconds first) and never blocks save.
    await pm.syntheticsCreatePage.setCron('bad');
    await pm.syntheticsCreatePage.expectCronError(true);
    await pm.syntheticsCreatePage.setCron('0 */10 * * * *');
    await pm.syntheticsCreatePage.expectCronError(false);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    testLogger.info('Verifying both schedules through the API');
    const interval = await findCheckByName(page, intervalName);
    expect(interval.frequency.type).toBe('minutes');
    expect(interval.frequency.interval).toBe(10);
    const cron = await findCheckByName(page, cronName);
    expect(cron.frequency.type).toBe('cron');
    expect(cron.frequency.cron).toBe('0 */10 * * * *');
  });

  test(
    'every assertion operator saves under the name the prober reads',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const name = uniqueName('ops', testInfo);
      const create = pm.syntheticsCreatePage;
      testLogger.info('Adding one assertion per operator', { name });
      await create.gotoCreate(ORG, 'http');
      await create.fillName(name);
      await create.fillTarget('https://example.com');
      await create.addAssertion('status_code', 'ne', 500);
      await create.addAssertion('response_time_ms', 'lt', 5000);
      await create.addAssertion('response_time_ms', 'gt', 1);
      await create.addAssertion('body', 'contains', 'Example');
      await create.addAssertion('body', 'not_contains', 'Server Error');
      await create.selectLocation(locationId);
      await create.setEnabled(false);
      const expected = [
        { field: 'status_code', operator: 'eq', value: 200 },
        { field: 'status_code', operator: 'ne', value: 500 },
        { field: 'response_time_ms', operator: 'lt', value: 5000 },
        { field: 'response_time_ms', operator: 'gt', value: 1 },
        { field: 'body', operator: 'contains', value: 'Example' },
        { field: 'body', operator: 'not_contains', value: 'Server Error' },
      ];
      const { payload, status } = await create.saveCapturingPayload();
      expect(status).toBe(200);
      expect(payload.config.assertions).toEqual(expected);
      await create.expectSavedAndListed();

      const saved = await findCheckByName(page, name);
      const { body } = await getCheck(page, saved.id);
      expect(body.config.assertions).toEqual(expected);
    },
  );

  test(
    'editing a check keeps its assertions, and removing one leaves the rest as saved',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const assertions = [
        { field: 'status_code', operator: 'eq', value: 200 },
        { field: 'body', operator: 'contains', value: 'Example Domain' },
        { field: 'response_time_ms', operator: 'lt', value: 3000 },
      ];
      const check = await createCheck(page, 'http', testInfo, {
        locations: [locationId],
        config: { ...HTTP_CONFIG, assertions },
      });
      const create = pm.syntheticsCreatePage;
      testLogger.info('Opening a check with three assertions', { id: check.id });
      await create.gotoEdit(ORG, check.id);
      await create.expectNameValue(check.name);
      await create.expectAssertionChips(assertions);

      testLogger.info('Removing the body assertion and saving');
      await create.removeAssertionAt(1);
      const kept = [assertions[0], assertions[2]];
      const { payload, status } = await create.saveCapturingPayload();
      expect(status).toBe(200);
      expect(payload.config.assertions).toEqual(kept);
      await create.expectUpdatedAndListed();

      testLogger.info('Reopening the check');
      await create.gotoEdit(ORG, check.id);
      await create.expectNameValue(check.name);
      await create.expectAssertionChips(kept);
    },
  );

  test(
    'an assertion left without a value is dropped, never saved empty',
    { tag: ['@P2'] },
    async ({ page }, testInfo) => {
      const name = uniqueName('noval', testInfo);
      const create = pm.syntheticsCreatePage;
      testLogger.info('Starting a body assertion and leaving it at the value step', { name });
      await create.gotoCreate(ORG, 'http');
      await create.fillName(name);
      await create.fillTarget('https://example.com');
      await create.abandonAssertionAtValue('body', 'contains');
      await create.selectLocation(locationId);
      await create.setEnabled(false);
      const { payload, status } = await create.saveCapturingPayload();
      expect(status).toBe(200);
      expect(payload.config.assertions).toEqual([{ field: 'status_code', operator: 'eq', value: 200 }]);
      await create.expectSavedAndListed();
      expect(await findCheckByName(page, name)).toBeTruthy();
    },
  );

  test(
    'a template override on the Alerts step persists after save and reopen',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const stem = uniqueName('tpl', testInfo);
      const create = pm.syntheticsCreatePage;
      let destinationTemplate = null;
      let override = null;
      let destination = null;
      let check = null;
      try {
        destinationTemplate = await createAlertTemplate(page, `${stem}_dest_tpl`);
        override = await createAlertTemplate(page, `${stem}_override`, ['synthetics']);
        destination = await createAlertDestination(page, `${stem}_dest`, destinationTemplate);
        check = await createCheck(page, 'http', testInfo, { locations: [locationId], destinations: [destination] });
        testLogger.info('Picking a template override on a check with a destination', { id: check.id, override });
        await create.gotoEdit(ORG, check.id);
        await create.expectNameValue(check.name);
        await create.selectTemplateOverride(override);
        const { payload, status } = await create.saveCapturingPayload();
        expect(status).toBe(200);
        expect(payload.template).toBe(override);
        await create.expectUpdatedAndListed();
        expect((await getCheck(page, check.id)).body.template).toBe(override);

        testLogger.info('Reopening the check');
        await create.gotoEdit(ORG, check.id);
        await create.expectNameValue(check.name);
        await create.expectTemplateOverride(override);
      } finally {
        if (check) await deleteCheck(page, check.id);
        await deleteAlertDestinationAndTemplate(page, destination, destinationTemplate);
        await deleteAlertDestinationAndTemplate(page, null, override);
      }
    },
  );
});
