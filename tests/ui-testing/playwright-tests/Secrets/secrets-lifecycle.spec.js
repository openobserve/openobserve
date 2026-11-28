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

// Secrets & variables J1, J4, J5, J6: create, write-only values, delete while in use, restore, rename, purge.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { SecretsPage } = require('../../pages/secretsPages/secretsPage.js');
const h = require('../utils/secrets-helpers.js');

test.describe.configure({ mode: 'serial' });

test.describe('Secrets store lifecycle', { tag: ['@secrets', '@enterprise'] }, () => {
  let api;
  let secrets;
  const cleanup = { secretIds: [], destinations: [] };

  test.beforeAll(async () => {
    api = await h.rootApi();
    const { body } = await h.call(api, 'GET', '/secrets/status');
    test.skip(body?.store_ready !== true, 'secret store is not ready on this deployment');
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    secrets = new SecretsPage(page);
  });

  test.afterAll(async () => {
    for (const name of cleanup.destinations) await h.deleteDestination(api, name);
    for (const id of cleanup.secretIds) await h.destroySecret(api, id);
    await api.dispose();
  });

  test('J1 creates a pinned secret and a variable from the drawer', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const secretName = h.secretName('key');
    const varName = h.secretName('var');
    const value = h.canaryValue();

    await secrets.goto();
    await secrets.openCreate('secret');
    await secrets.fillCreate({
      name: secretName,
      value,
      description: 'u61 created in the UI',
      types: ['alert_destination'],
      hosts: ['example.com'],
    });
    await h.shootThemes(page, testInfo, 'j1-create-secret-drawer');
    await secrets.submitCreate();
    await expect(secrets.valueStatus()).toContainText(/Set/);
    await h.expectNoValueInDom(page, value);
    await h.shootThemes(page, testInfo, 'j1-secret-drawer-values');

    const [created] = await h.listSecretsNamed(api, secretName);
    expect(created).toBeTruthy();
    cleanup.secretIds.push(created.id);
    expect(created.kind).toBe('secret');
    expect(created.pin_mode).toBe('hosts');
    expect(created.allowed_types).toEqual(['alert_destination']);
    await secrets.closeDrawer();
    await expect(secrets.row(secretName)).toBeVisible();

    await secrets.openCreate('variable');
    await secrets.fillCreate({ name: varName, value: 'v1-ui', types: ['alert_destination'] });
    await secrets.submitCreate();
    await expect(secrets.variableValue()).toHaveText('v1-ui');
    const [variable] = await h.listSecretsNamed(api, varName);
    cleanup.secretIds.push(variable.id);
    expect(variable.kind).toBe('variable');
    await secrets.closeDrawer();
    await expect(secrets.row(varName)).toBeVisible();
    await h.shootThemes(page, testInfo, 'j1-variables-list');
  });

  test('J4 J6 replaces a value write-only, with no read-back', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = h.secretName('rot');
    const first = h.canaryValue();
    const second = h.canaryValue();
    const id = await h.createSecret(api, { name, value: first, types: ['alert_destination'], hosts: ['example.com'] });
    cleanup.secretIds.push(id);
    const before = (await h.getSecret(api, id)).body.envs.find((e) => e.env === '_org').value_version;

    await secrets.goto();
    await secrets.openSecret(name);
    await expect(secrets.valueStatus()).toContainText(/Set/);
    await secrets.valueReplace().click();
    await expect(secrets.valueInput()).toHaveValue('');
    await expect(secrets.valueInput()).toHaveAttribute('type', 'password');
    await h.shootThemes(page, testInfo, 'j4-replace-open');
    await secrets.valueInput().fill(second);
    await secrets.valueSave().click();
    await expect(secrets.valueInput()).toBeHidden();

    await expect
      .poll(async () => (await h.getSecret(api, id)).body.envs.find((e) => e.env === '_org').value_version)
      .toBeGreaterThan(before);
    const detail = (await h.getSecret(api, id)).body;
    expect(JSON.stringify(detail)).not.toContain(first);
    expect(JSON.stringify(detail)).not.toContain(second);
    await h.expectNoValueInDom(page, first);
    await h.expectNoValueInDom(page, second);
    await secrets.openDrawerTab('audit');
    await h.shootThemes(page, testInfo, 'j6-audit-tab');
  });

  test(
    'J5 refuses delete while in use, then force-deletes, restores, renames and purges',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const name = h.secretName('del');
      const renamed = h.secretName('ren');
      const dest = h.plainName('dest');
      const id = await h.createSecret(api, {
        name,
        value: h.canaryValue(),
        types: ['alert_destination'],
        hosts: ['example.com'],
      });
      cleanup.secretIds.push(id);
      await h.createDestination(api, {
        name: dest,
        url: 'https://example.com/u61',
        headers: { 'X-Api-Key': `{{secrets.${name}}}` },
      });
      cleanup.destinations.push(dest);

      await secrets.goto();
      await secrets.openSecret(name);
      await secrets.openDrawerTab('usage');
      await expect(secrets.usageRow(0)).toContainText(dest);

      await secrets.openMore('delete');
      await expect(secrets.page.locator(secrets.locators.deleteConsumers)).toContainText(dest);
      await h.shootThemes(page, testInfo, 'j5-delete-in-use-dialog');
      // The form will not submit an in-use delete without the force tick; the server refuses one too.
      await secrets.confirmDelete({ force: false });
      await expect(secrets.page.locator(secrets.locators.deleteDialog)).toBeVisible();
      const refused = await h.call(api, 'DELETE', `/secrets/${id}`);
      expect(refused.status).toBe(409);
      expect((await h.getSecret(api, id)).body.state).toBe('active');

      await secrets.confirmDelete({ force: true });
      await expect(secrets.page.locator(secrets.locators.deleteDialog)).toBeHidden();
      await expect.poll(async () => (await h.getSecret(api, id)).body.state).toBe('deleted');

      await secrets.goto();
      await secrets.openSecret(name, { deleted: true });
      await expect(secrets.page.locator(secrets.locators.deletedBanner)).toBeVisible();
      await h.shootThemes(page, testInfo, 'j5-deleted-drawer');
      await secrets.page.locator(secrets.locators.drawerRestore).click();
      await expect.poll(async () => (await h.getSecret(api, id)).body.state).toBe('active');
      await expect(secrets.page.locator(secrets.locators.deletedBanner)).toBeHidden();

      await secrets.rename(renamed);
      await expect.poll(async () => (await h.getSecret(api, id)).body.name).toBe(renamed);
      await secrets.openDrawerTab('usage');
      await expect(secrets.usageRow(0)).toContainText(dest);
      await h.shootThemes(page, testInfo, 'j5-renamed-usage');

      await secrets.openMore('delete');
      await secrets.confirmDelete({ force: true });
      await expect.poll(async () => (await h.getSecret(api, id)).body.state).toBe('deleted');
      await secrets.goto();
      await secrets.openSecret(renamed, { deleted: true });
      await secrets.purge(renamed);
      await expect(secrets.page.locator(secrets.locators.purgeDialog)).toBeHidden();
      await expect.poll(async () => (await h.getSecret(api, id)).status).toBe(404);
    },
  );
});
