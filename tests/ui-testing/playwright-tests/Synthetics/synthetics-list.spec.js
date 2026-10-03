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

// Synthetics list — smoke, list operations, run-now, cross-cutting; checks are created disabled unless the scheduler is under test.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  workerPrefix,
  uniqueName,
  createCheck,
  getCheck,
  listChecks,
  findCheckByName,
  waitForCheck,
  startOneHourAhead,
  createSyntheticsFolder,
  checkPayload,
  request,
  apiBase,
  cleanupWorkerEntities,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const TYPES = ['http', 'tcp', 'tls', 'ssh', 'browser'];

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics list', { tag: ['@synthetics', '@all'] }, () => {
  let pm;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    await ensureSyntheticsLocation(page);
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

  test('sidebar entry opens the list page', { tag: ['@P0', '@smoke'] }, async () => {
    testLogger.info('Opening the list from the sidebar');
    await pm.syntheticsListPage.openFromSidebar();
    testLogger.info('Verifying the list is visible');
    await pm.syntheticsListPage.expectListVisible();
  });

  test('type picker lists all five types and routes to create', { tag: ['@P0', '@smoke'] }, async () => {
    testLogger.info('Opening the type picker');
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.openTypePicker();
    testLogger.info('Verifying all five type cards and picking HTTP');
    await pm.syntheticsListPage.expectTypeCards(TYPES);
    await pm.syntheticsListPage.pickType('http');
  });

  test('empty state renders when no row matches the search', { tag: ['@P1'] }, async () => {
    testLogger.info('Searching for a name that matches nothing');
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(`synth_e2e_nomatch_${Math.random().toString(36).slice(2, 8)}`);
    testLogger.info('Verifying the empty state');
    await pm.syntheticsListPage.expectEmptyState();
  });

  test('search narrows the list to the matching check', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding two HTTP checks via the API');
    const a = await createCheck(page, 'http', testInfo);
    const b = await createCheck(page, 'http', testInfo);

    testLogger.info('Searching for the first check', { checkId: a.id });
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(a.name);
    await pm.syntheticsListPage.expectRowVisible(a.id);
    await pm.syntheticsListPage.expectRowAbsent(b.id);

    testLogger.info('Searching for the second check', { checkId: b.id });
    await pm.syntheticsListPage.search(b.name);
    await pm.syntheticsListPage.expectRowVisible(b.id);
    await pm.syntheticsListPage.expectRowAbsent(a.id);
  });

  test('pause then enable round-trips through the API', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding an enabled HTTP check via the API');
    const check = await createCheck(page, 'http', testInfo, { enabled: true, start: startOneHourAhead() });

    testLogger.info('Pausing the check from the list', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.clickToggle(check.id, 'pause');
    await pm.syntheticsListPage.expectToggleState(check.id, 'enable');
    await waitForCheck(page, check.id, (c) => c.enabled === false);

    testLogger.info('Enabling the check from the list', { checkId: check.id });
    await pm.syntheticsListPage.clickToggle(check.id, 'enable');
    await pm.syntheticsListPage.expectToggleState(check.id, 'pause');
    await waitForCheck(page, check.id, (c) => c.enabled === true);
  });

  test('edit route loads and a rename persists', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding an HTTP check via the API');
    const check = await createCheck(page, 'http', testInfo);
    const renamed = uniqueName('renamed', testInfo);

    testLogger.info('Renaming the check from the edit route', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.clickEdit(check.id);
    await pm.syntheticsCreatePage.expectNameValue(check.name);
    await pm.syntheticsCreatePage.fillName(renamed);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectUpdatedAndListed();

    testLogger.info('Verifying the new name in the list and the API');
    await pm.syntheticsListPage.search(renamed);
    await pm.syntheticsListPage.expectRowName(check.id, renamed);
    const { body } = await getCheck(page, check.id);
    expect(body.name).toBe(renamed);
  });

  test('single delete via the row menu and confirm dialog', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding an HTTP check via the API');
    const check = await createCheck(page, 'http', testInfo);

    testLogger.info('Deleting the check from the row menu', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.deleteSingle(check.id);
    testLogger.info('Verifying the check is deleted');
    await pm.syntheticsListPage.expectToast('Check deleted.');
    await pm.syntheticsListPage.expectRowAbsent(check.id);
    expect((await getCheck(page, check.id)).status).toBe(404);
  });

  test('bulk delete removes every selected check', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding two HTTP checks under a bulk prefix');
    // Own sub-prefix so no other row from this worker can match the search.
    const prefix = `${workerPrefix(testInfo)}bulk_${Math.random().toString(36).slice(2, 8)}_`;
    const a = await createCheck(page, 'http', testInfo, { name: `${prefix}a` });
    const b = await createCheck(page, 'http', testInfo, { name: `${prefix}b` });

    testLogger.info('Selecting both rows and bulk deleting');
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(prefix);
    await pm.syntheticsListPage.expectRowCount(2);
    await pm.syntheticsListPage.selectRows([0, 1]);
    await pm.syntheticsListPage.bulkDelete();
    testLogger.info('Verifying both checks are deleted');
    await pm.syntheticsListPage.expectToast('Checks deleted successfully.');
    await pm.syntheticsListPage.expectRowAbsent(a.id);
    await pm.syntheticsListPage.expectRowAbsent(b.id);
    expect((await getCheck(page, a.id)).status).toBe(404);
    expect((await getCheck(page, b.id)).status).toBe(404);
  });

  test('duplicate creates a sibling of the same type', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding a TCP check via the API');
    const check = await createCheck(page, 'tcp', testInfo);
    const copyName = `${check.name}_copy`;

    testLogger.info('Duplicating the check from the list', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.duplicate(check.id, copyName);
    await pm.syntheticsListPage.expectToast('Check duplicated successfully.');

    testLogger.info('Verifying the duplicate through the API and the list');
    const copy = await findCheckByName(page, copyName);
    expect(copy, 'the duplicate must be listed by the API').toBeTruthy();
    expect(copy.type).toBe('tcp');
    await pm.syntheticsListPage.search(copyName);
    await pm.syntheticsListPage.expectRowVisible(copy.id);
  });

  test('move relocates the check to another folder', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding a check and a target folder via the API');
    const check = await createCheck(page, 'http', testInfo);
    const folderId = await createSyntheticsFolder(page, uniqueName('folder', testInfo));

    testLogger.info('Moving the check to the folder', { checkId: check.id, folderId });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.moveToFolder(check.id, folderId);

    testLogger.info('Verifying the check is listed only in the new folder');
    expect((await listChecks(page)).some((c) => c.id === check.id)).toBe(false);
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(check.name);
    await pm.syntheticsListPage.expectEmptyState();
    await pm.syntheticsListPage.goto(ORG, { folder: folderId });
    await pm.syntheticsListPage.search(check.name);
    await pm.syntheticsListPage.expectRowVisible(check.id);
    expect((await listChecks(page, folderId)).some((c) => c.id === check.id)).toBe(true);
  });

  test('bulk trigger, pause and enable act on the selection', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding two enabled HTTP checks via the API');
    const prefix = `${workerPrefix(testInfo)}bulk2_${Math.random().toString(36).slice(2, 8)}_`;
    const start = startOneHourAhead();
    const a = await createCheck(page, 'http', testInfo, { name: `${prefix}a`, enabled: true, start });
    const b = await createCheck(page, 'http', testInfo, { name: `${prefix}b`, enabled: true, start });

    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(prefix);
    await pm.syntheticsListPage.expectRowCount(2);
    // Trigger runs first: re-enabling resets next_run_at, so a later last_triggered_at would not prove the trigger.
    expect((await getCheck(page, a.id)).body.last_triggered_at).toBe(0);
    expect((await getCheck(page, b.id)).body.last_triggered_at).toBe(0);
    testLogger.info('Bulk triggering both checks');
    await pm.syntheticsListPage.selectRows([0, 1]);
    await pm.syntheticsListPage.bulkTrigger();
    await pm.syntheticsListPage.expectToast('Triggered 2 checks.');
    await waitForCheck(page, a.id, (c) => Number(c.last_triggered_at) > 0, { timeoutMs: 30000 });
    await waitForCheck(page, b.id, (c) => Number(c.last_triggered_at) > 0, { timeoutMs: 30000 });

    testLogger.info('Bulk pausing both checks');
    // Every bulk action clears the selection, so re-select before the next one.
    await pm.syntheticsListPage.selectRows([0, 1]);
    await pm.syntheticsListPage.bulkPause();
    await pm.syntheticsListPage.expectToast('Paused 2 checks.');
    await waitForCheck(page, a.id, (c) => c.enabled === false);
    await waitForCheck(page, b.id, (c) => c.enabled === false);

    testLogger.info('Bulk enabling both checks');
    await pm.syntheticsListPage.selectRows([0, 1]);
    await pm.syntheticsListPage.bulkEnable();
    await pm.syntheticsListPage.expectToast('Enabled 2 checks.');
    await waitForCheck(page, a.id, (c) => c.enabled === true);
    await waitForCheck(page, b.id, (c) => c.enabled === true);
  });

  test('run now from the list reaches the scheduler', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding an enabled HTTP check via the API');
    const check = await createCheck(page, 'http', testInfo, { enabled: true, start: startOneHourAhead() });
    expect((await getCheck(page, check.id)).body.last_triggered_at).toBe(0);

    testLogger.info('Running the check now from the list', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.runNow(check.id);
    await pm.syntheticsListPage.expectToast(`Run queued for "${check.name}"`);
    testLogger.info('Verifying the scheduler claimed the check');
    // The 5 s scheduler tick claims the check and stamps last_triggered_at; nothing runs on CI.
    await waitForCheck(page, check.id, (c) => Number(c.last_triggered_at) > 0, { timeoutMs: 30000 });
  });

  test('deep links to a missing id fall back to the list with a toast', { tag: ['@P2'] }, async ({ page }) => {
    testLogger.info('Opening the edit route for a missing id');
    await pm.syntheticsCreatePage.gotoEdit(ORG, 'synth_e2e_missing');
    await pm.syntheticsListPage.expectToast("This check doesn't exist in the current organization.");
    await expect(page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });

    testLogger.info('Opening the results route for a missing id');
    await page.goto(`/web/synthetics/synth_e2e_missing/results?org_identifier=${ORG}`);
    await pm.syntheticsListPage.expectToast("This check doesn't exist in the current organization.");
    await expect(page).toHaveURL(/\/synthetics(\?|$)/, { timeout: 30000 });
  });

  test('name length is bounded at 256 characters', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    testLogger.info('Building names at and over the length limit');
    const locationId = await ensureSyntheticsLocation(page);
    const base = workerPrefix(testInfo);
    const tooLong = base + 'x'.repeat(257 - base.length);
    const maxLen = base + 'x'.repeat(256 - base.length);

    testLogger.info('Verifying a 257-character name is rejected');
    const rejected = await request(page, 'post', `${apiBase()}?folder=default`, checkPayload('http', tooLong, locationId));
    expect(rejected.status).toBe(400);
    testLogger.info('Verifying a 256-character name is accepted');
    const accepted = await request(page, 'post', `${apiBase()}?folder=default`, checkPayload('http', maxLen, locationId));
    expect([200, 201]).toContain(accepted.status);
  });

  test('duplicate names are allowed', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    const name = uniqueName('dup', testInfo);
    testLogger.info('Seeding two HTTP checks with the same name', { name });
    const a = await createCheck(page, 'http', testInfo, { name });
    const b = await createCheck(page, 'http', testInfo, { name });

    testLogger.info('Verifying both checks are listed');
    await pm.syntheticsListPage.goto(ORG);
    await pm.syntheticsListPage.search(name);
    await pm.syntheticsListPage.expectRowVisible(a.id);
    await pm.syntheticsListPage.expectRowVisible(b.id);
    await pm.syntheticsListPage.expectRowCount(2);
  });

  test('names render as text, never as markup', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    const name = `${workerPrefix(testInfo)}<img src=x onerror=alert(1)>`;
    testLogger.info('Seeding a check whose name contains markup');
    const check = await createCheck(page, 'http', testInfo, { name });
    let dialogs = 0;
    page.on('dialog', async (d) => { dialogs += 1; await d.dismiss(); });

    testLogger.info('Verifying the name renders as text in the list', { checkId: check.id });
    await pm.syntheticsListPage.gotoCheck(ORG, check);
    await pm.syntheticsListPage.expectRowName(check.id, name);
    testLogger.info('Verifying the name renders as text on the results page');
    // The results title reads the name from the list link's query, so click through.
    await pm.syntheticsListPage.openResults(check.id);
    await pm.syntheticsResultsPage.expectPageContainsText(name);
    expect(dialogs).toBe(0);
  });
});
