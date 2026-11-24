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

// Secrets & variables J1 policy and J3 access: allowlist, host pins, the now-failing warning, and grants a non-admin sees.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { SecretsPage } = require('../../pages/secretsPages/secretsPage.js');
const h = require('../utils/secrets-helpers.js');

test.describe.configure({ mode: 'serial' });

test.describe('Secrets store policy and access', { tag: ['@secrets', '@enterprise'] }, () => {
  let api;
  let secrets;
  let member;
  let role;
  const cleanup = { secretIds: [], destinations: [] };

  test.beforeAll(async () => {
    api = await h.rootApi();
    const { body } = await h.call(api, 'GET', '/secrets/status');
    test.skip(body?.store_ready !== true || body?.fga !== 'on', 'needs a ready store with OpenFGA on');
    member = await h.createMember(api, `${h.plainName('editor')}@example.com`);
    role = h.plainName('role');
    await h.createRole(api, role, [member.email]);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    secrets = new SecretsPage(page);
  });

  test.afterAll(async () => {
    for (const name of cleanup.destinations) await h.deleteDestination(api, name);
    for (const id of cleanup.secretIds) await h.destroySecret(api, id);
    await h.deleteRole(api, role);
    await h.deleteMember(api, member?.email);
    await api.dispose();
  });

  test(
    'J1 widens the allowlist and pins, and warns before a narrowing breaks a consumer',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const name = h.secretName('pol');
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
      await secrets.openDrawerTab('policy');
      const synthetics = secrets.policyType('synthetics_check').locator('[role="checkbox"]');
      await synthetics.click();
      await expect(synthetics).toHaveAttribute('aria-checked', 'true');
      await secrets.addPolicyHost('api.example.com');
      await h.shootThemes(page, testInfo, 'j1-policy-edit');
      await secrets.savePolicy();
      await expect(secrets.toastWith('success')).toBeVisible();
      await expect
        .poll(async () => (await h.getSecret(api, id)).body.allowed_consumers.map((c) => c.type).sort())
        .toEqual(['alert_destination', 'synthetics_check']);
      expect((await h.getSecret(api, id)).body.allowed_hosts).toContain('https://api.example.com:443');

      // Dropping the pin the destination relies on must surface it before anything is written.
      const policyRev = (await h.getSecret(api, id)).body.policy_rev;
      await secrets.openDrawerTab('values');
      await secrets.openDrawerTab('policy');
      const hosts = secrets.page.locator(secrets.locators.policyHosts);
      await expect(hosts.getByText('api.example.com')).toBeVisible();
      await secrets.tagRemove(hosts, 0).click();
      await secrets.savePolicy();
      const nowFailing = secrets.page.locator('[data-test="secret-policy-now-failing"]');
      await expect(nowFailing).toContainText(dest);
      await h.shootThemes(page, testInfo, 'j1-policy-now-failing');
      await secrets.page.locator('[data-test="secret-policy-cancel"]').click();
      await expect(nowFailing).toBeHidden();
      expect((await h.getSecret(api, id)).body.policy_rev).toBe(policyRev);
    },
  );

  test('J1 Allow any host needs a reason, then saves the override', { tag: ['@P1'] }, async () => {
    const name = h.secretName('any');
    const id = await h.createSecret(api, {
      name,
      value: h.canaryValue(),
      types: ['alert_destination'],
      hosts: ['example.com'],
    });
    cleanup.secretIds.push(id);
    const reason = 'u61 e2e: vendor rotates hosts';

    await secrets.goto();
    await secrets.openSecret(name);
    await secrets.openDrawerTab('policy');
    await expect(secrets.pinMode('hosts')).toHaveAttribute('data-state', 'checked');
    await secrets.setPinMode('any');
    await expect(secrets.page.locator(secrets.locators.policyHosts)).toBeHidden();
    await expect(secrets.page.locator(secrets.locators.policyAnyHostWarning)).toBeVisible();
    await secrets.savePolicy();
    await expect(secrets.page.locator('[data-test="secret-policy-pin-reason-error"]')).toBeVisible();
    expect((await h.getSecret(api, id)).body.pin_mode).toBe('hosts');

    await secrets.page.locator(secrets.locators.policyPinReason).fill(reason);
    await secrets.savePolicy();
    await expect(secrets.toastWith('success')).toBeVisible();
    await expect.poll(async () => (await h.getSecret(api, id)).body.pin_mode).toBe('any');
    expect((await h.getSecret(api, id)).body.pin_override_reason).toBe(reason);
  });

  test(
    'J3 root grants see and use on the Access tab, and the editor then sees the secret',
    { tag: ['@P1'] },
    async ({ page, browser }, testInfo) => {
      const name = h.secretName('acc');
      const value = h.canaryValue();
      const id = await h.createSecret(api, { name, value, types: ['alert_destination'], hosts: ['example.com'] });
      cleanup.secretIds.push(id);

      const editor = await h.loginAs(browser, member);
      try {
        const editorSecrets = new SecretsPage(editor.page);
        await editorSecrets.goto();
        await editorSecrets.search(name);
        await expect(editor.page.locator('[data-test="secrets-page-empty"]')).toBeVisible();
        await expect(editorSecrets.row(name)).toHaveCount(0);

        await secrets.goto();
        await secrets.openSecret(name);
        await secrets.openDrawerTab('access');
        await secrets.addAccessRole(role);
        await secrets.setGrant(role, 'see');
        await secrets.setGrant(role, 'use');
        await h.shootThemes(page, testInfo, 'j3-access-grant');
        await secrets.page.locator(secrets.locators.accessSave).click();
        await expect
          .poll(async () => (await h.call(api, 'GET', `/secrets/${id}/grants`)).body)
          .toMatchObject({ see: [role], use: [role] });

        await editorSecrets.goto();
        await editorSecrets.openSecret(name);
        await expect(editorSecrets.valueStatus()).toContainText(/Set/);
        await expect(editorSecrets.valueReplace()).toHaveCount(0);
        await expect(editor.page.locator(editorSecrets.locators.drawerMore)).toHaveCount(0);
        await h.expectNoValueInDom(editor.page, value);
        await h.shootThemes(editor.page, testInfo, 'j3-editor-sees-secret');

        const editorApi = await h.apiAs(member.email, member.password);
        try {
          const picker = await h.call(editorApi, 'GET', '/secrets', undefined, { usable_by: 'alert_destination' });
          expect((picker.body?.items ?? []).map((s) => s.name)).toContain(name);
          expect((await h.call(editorApi, 'PUT', `/secrets/${id}/values/_org`, { value: 'nope' })).status).toBe(403);
        } finally {
          await editorApi.dispose();
        }
      } finally {
        await editor.context.close();
      }
    },
  );
});
