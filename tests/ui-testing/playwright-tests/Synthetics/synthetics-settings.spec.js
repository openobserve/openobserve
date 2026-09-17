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

// Synthetics settings — public locations (meta org) and agent tokens (plan §7, §8); ids are `{provider}-{region}`, so the region carries the worker prefix.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  workerPrefix,
  uniqueName,
  listLocations,
  createLocation,
  deleteLocation,
  listTokens,
  disableTokensByPrefix,
  request,
  apiBase,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const META_ORG = '_meta';
const PROVIDER = 'e2e';

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics settings — locations and tokens', { tag: ['@synthetics', '@all'] }, () => {
  let pm;
  let sharedLocationId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    sharedLocationId = await ensureSyntheticsLocation(page);
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
    const prefix = `${PROVIDER}-${workerPrefix(testInfo)}`;
    for (const loc of await listLocations(page).catch(() => [])) {
      if (typeof loc?.id === 'string' && loc.id.startsWith(prefix)) await deleteLocation(page, loc.id);
    }
    await disableTokensByPrefix(page, workerPrefix(testInfo));
    await context.close();
  });

  async function seedLocation(page, testInfo, overrides = {}) {
    const region = uniqueName('loc', testInfo);
    const { status, body } = await createLocation(page, {
      kind: 'public', provider: PROVIDER, region, label: `E2E ${region}`, enabled: true, ...overrides,
    });
    if (status !== 200) throw new Error(`Location seed failed: HTTP ${status} — ${JSON.stringify(body)}`);
    return body.location;
  }

  async function findLocation(page, id) {
    return (await listLocations(page)).find((l) => l.id === id) ?? null;
  }

  // ------------------------------------------------------------- §7 locations

  test('adds a public location from Settings', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const region = uniqueName('loc', testInfo);
    const id = `${PROVIDER}-${region}`;
    const s = pm.syntheticsSettingsPage;
    await s.gotoLocations(META_ORG);
    await s.openAddForm();
    await s.fillLocationForm({ label: `E2E ${region}`, provider: 'custom', customProvider: PROVIDER, region });
    await s.submitLocationForm();
    await s.expectToast('Location created successfully');
    await s.expectLocationRow(id);
    expect(await findLocation(page, id)).toBeTruthy();
  });

  test('edits a location label', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const loc = await seedLocation(page, testInfo);
    const s = pm.syntheticsSettingsPage;
    await s.gotoLocations(META_ORG);
    await s.openEditForm(loc.id);
    await s.fillLocationForm({ label: `${loc.label} edited` });
    await s.submitLocationForm();
    await s.expectToast('Location updated successfully');
    expect((await findLocation(page, loc.id)).label).toBe(`${loc.label} edited`);
  });

  test('disables then enables a location', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const loc = await seedLocation(page, testInfo);
    const s = pm.syntheticsSettingsPage;
    await s.gotoLocations(META_ORG);
    await s.toggleLocation(loc.id, 'disable');
    await s.expectToast('Location disabled');
    await s.expectLocationToggle(loc.id, 'enable');
    expect((await findLocation(page, loc.id)).enabled).toBe(false);
    await s.toggleLocation(loc.id, 'enable');
    await s.expectToast('Location enabled');
    await s.expectLocationToggle(loc.id, 'disable');
    expect((await findLocation(page, loc.id)).enabled).toBe(true);
  });

  test('deletes a location with confirmation', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const loc = await seedLocation(page, testInfo);
    const s = pm.syntheticsSettingsPage;
    await s.gotoLocations(META_ORG);
    await s.deleteLocation(loc.id);
    await s.expectToast('Location deleted successfully');
    await s.expectLocationRowAbsent(loc.id);
    expect(await findLocation(page, loc.id)).toBeNull();
  });

  test('a disabled location is not offered in Configure', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const loc = await seedLocation(page, testInfo, { enabled: false });
    const c = pm.syntheticsCreatePage;
    await c.gotoCreate(ORG, 'http');
    await c.expectLocationOffered(loc.id, false, { loadedId: sharedLocationId });

    await pm.syntheticsSettingsPage.gotoLocations(META_ORG);
    await pm.syntheticsSettingsPage.toggleLocation(loc.id, 'enable');
    await pm.syntheticsSettingsPage.expectToast('Location enabled');
    await c.gotoCreate(ORG, 'http');
    await c.expectLocationOffered(loc.id, true);
  });

  test('import validates each item', { tag: ['@P2'] }, async ({ page }, testInfo) => {
    const region = uniqueName('loc', testInfo);
    const s = pm.syntheticsSettingsPage;
    await s.gotoLocations(META_ORG);
    await s.pasteImportJson(JSON.stringify([
      { provider: PROVIDER, region, label: `E2E ${region}` },
      { provider: PROVIDER, label: 'missing region' },
    ]));
    // Client-side validation lists only the invalid items, so the second item is error 0.
    await s.expectImportError(0, 'Region is required for item 2');
    // The import view unmounts itself shortly after success, so the outcome is read from the toast and the API.
    await s.runImport();
    await s.expectToast('1 locations imported successfully');
    expect(await findLocation(page, `${PROVIDER}-${region}`)).toBeTruthy();
  });

  test('locations tab is hidden outside the meta org', { tag: ['@P2'] }, async () => {
    const s = pm.syntheticsSettingsPage;
    await s.gotoSettings(META_ORG);
    await s.expectLocationsTabCount(1);
    await s.gotoSettings(ORG);
    await s.expectLocationsTabCount(0);
  });

  // ---------------------------------------------------------------- §8 tokens

  test('creates then disables a token', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('tok', testInfo);
    const s = pm.syntheticsSettingsPage;
    await s.gotoTokens(ORG);
    const created = await s.createToken(name);
    expect(created.status).toBe(200);
    await s.expectToast('Token created');
    await s.closeRevealDialog();
    await s.expectTokenRow(name);
    expect((await listTokens(page)).find((t) => t.name === name)?.enabled).toBe(true);

    await s.toggleToken(name);
    await s.expectToast('Token disabled');
    expect((await listTokens(page)).find((t) => t.name === name)?.enabled).toBe(false);
  });

  // The form schema rejects the name before any request is made; the server rule is covered directly.
  test('the reserved token name "default" is rejected', { tag: ['@P2'] }, async ({ page }) => {
    const s = pm.syntheticsSettingsPage;
    await s.gotoTokens(ORG);
    await s.submitTokenName('default');
    await s.expectTokenNameError('reserved');
    const server = await request(page, 'post', `${apiBase()}/agent-tokens`, { name: 'default' });
    expect(server.status).toBe(400);
    expect(String(server.body?.message ?? '')).toContain('reserved');
    expect((await listTokens(page)).filter((t) => t.name === 'default')).toHaveLength(1);
  });
});
