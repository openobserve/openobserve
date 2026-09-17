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

// Synthetics create — HTTP (plan §2.1, §2.6, §2.7, §2.10); the protocol flow has no client-side validation, so 400s land in a toast.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  workerPrefix,
  uniqueName,
  getCheck,
  findCheckByName,
  deleteChecksByPrefix,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];

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
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await deleteChecksByPrefix(page, workerPrefix(testInfo));
    await context.close();
  });

  test('creates an HTTP check through the form', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('http', testInfo);

    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    // The form seeds one status_code assertion; this appends a second row.
    await pm.syntheticsCreatePage.addAssertion(1, 'response_time_ms', 'lt', 5000);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

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
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.selectLocation(locationId);

    const noName = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noName.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('name: must not be empty');

    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('');
    const noTarget = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noTarget.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('target');

    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.deselectLocation(locationId);
    const noLocation = await pm.syntheticsCreatePage.saveCapturingResponse();
    expect(noLocation.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('locations');

    expect(await findCheckByName(page, name)).toBeNull();
  });

  test('cancelling a dirty form asks before leaving', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('dirty', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.cancel();
    await pm.syntheticsCreatePage.confirmLeave();
    await expect(page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });
    expect(await findCheckByName(page, name)).toBeNull();
  });

  test('custom interval and cron schedules persist', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const intervalName = uniqueName('interval', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'http');
    await pm.syntheticsCreatePage.fillName(intervalName);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.setCustomInterval(10);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

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

    const interval = await findCheckByName(page, intervalName);
    expect(interval.frequency.type).toBe('minutes');
    expect(interval.frequency.interval).toBe(10);
    const cron = await findCheckByName(page, cronName);
    expect(cron.frequency.type).toBe('cron');
    expect(cron.frequency.cron).toBe('0 */10 * * * *');
  });
});
