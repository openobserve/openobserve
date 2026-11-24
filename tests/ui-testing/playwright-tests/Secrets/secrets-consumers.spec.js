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

// Secrets & variables consumers: J2 destination bind and status-only test, the {{vars}} re-sign and its refusal,
// J7 synthetics write-only header and URL refusal, J13 AI toolset picker.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { SecretsPage } = require('../../pages/secretsPages/secretsPage.js');
const { SecretConsumersPage } = require('../../pages/secretsPages/secretConsumersPage.js');
const h = require('../utils/secrets-helpers.js');

test.describe.configure({ mode: 'serial' });

test.describe('Secrets store consumers', { tag: ['@secrets', '@enterprise'] }, () => {
  let api;
  let consumers;
  let secrets;
  let member;
  let role;
  const cleanup = { secretIds: [], destinations: [], checks: [], toolsets: [], locations: [] };

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
    consumers = new SecretConsumersPage(page);
    secrets = new SecretsPage(page);
  });

  test.afterAll(async () => {
    for (const name of cleanup.destinations) await h.deleteDestination(api, name);
    for (const id of cleanup.checks) await h.deleteCheck(api, id);
    for (const id of cleanup.toolsets) await h.deleteToolset(api, id);
    for (const id of cleanup.locations) await h.deleteLocation(api, id);
    for (const id of cleanup.secretIds) await h.destroySecret(api, id);
    await h.deleteRole(api, role);
    await h.deleteMember(api, member?.email);
    await api.dispose();
  });

  test(
    'J2 binds a secret into a destination header, then tests the saved destination status-only',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const name = h.secretName('dst');
      const value = h.canaryValue();
      const dest = h.plainName('dest');
      const id = await h.createSecret(api, { name, value, types: ['alert_destination'], hosts: ['example.com'] });
      cleanup.secretIds.push(id);
      cleanup.destinations.push(dest);

      await consumers.gotoDestinations();
      await consumers.startCustomDestination(dest);
      await consumers.page.locator(consumers.locators.destUrlField).fill('https://example.com/u61-hook');
      await consumers.destHeaderKey(0).fill('X-Api-Key');
      await consumers.pickSecret(consumers.destPicker(0), name);
      await expect(consumers.destHeaderKey(0)).toHaveValue('X-Api-Key');
      await expect(consumers.destHeaderValue(0)).toHaveValue(`{{secrets.${name}}}`);
      await expect(consumers.page.locator(consumers.locators.destTestSaveFirst)).toBeVisible();
      await expect(consumers.page.locator(consumers.locators.destTest)).toBeDisabled();
      await h.shootThemes(page, testInfo, 'j2-destination-picked');
      await consumers.saveDestination();

      const saved = await h.getDestination(api, dest);
      expect(saved.status).toBe(200);
      expect(saved.body.headers['X-Api-Key']).toBe(`{{secrets.${name}}}`);

      await consumers.openDestination(dest);
      await expect(consumers.page.locator(consumers.locators.destTest)).toBeEnabled();
      await consumers.page.locator(consumers.locators.destTest).click();
      const outcome = consumers.page.locator(consumers.locators.destTestStatusOnly);
      await expect(outcome).toHaveText(/^(Delivered|Failed)/, { timeout: 30000 });
      await h.expectNoValueInDom(page, value);
      await h.shootThemes(page, testInfo, 'j2-destination-test-status-only');

      await secrets.goto();
      await secrets.openSecret(name);
      await secrets.openDrawerTab('usage');
      await expect(secrets.usageRow(0)).toContainText(dest);
    },
  );

  test(
    'J7 a {{vars}} edit re-signs as root and is refused for an editor without use',
    { tag: ['@P1'] },
    async ({ browser }, testInfo) => {
      const keyName = h.secretName('vkey');
      const varName = h.secretName('vvar');
      const dest = h.plainName('vdest');
      const keyId = await h.createSecret(api, {
        name: keyName,
        value: h.canaryValue(),
        types: ['alert_destination'],
        hosts: ['example.com'],
      });
      const varId = await h.createSecret(api, {
        name: varName,
        kind: 'variable',
        value: 'v1',
        types: ['alert_destination'],
      });
      cleanup.secretIds.push(keyId, varId);
      await h.createDestination(api, {
        name: dest,
        url: `https://example.com/hook/{{vars.${varName}}}`,
        headers: { 'X-Api-Key': `{{secrets.${keyName}}}` },
      });
      cleanup.destinations.push(dest);
      await h.putGrants(api, varId, { see: [role], use: [role], manage: [role] });
      await h.putGrants(api, keyId, { see: [role] });

      await secrets.goto();
      await secrets.openKindTab('variable');
      await secrets.openSecret(varName);
      await secrets.replaceValue('v2-root');
      await expect(secrets.variableValue()).toHaveText('v2-root');
      await expect.poll(async () => (await h.getSecret(api, varId)).body.value).toBe('v2-root');

      const editor = await h.loginAs(browser, member);
      try {
        const editorSecrets = new SecretsPage(editor.page);
        await editorSecrets.goto();
        await editorSecrets.openKindTab('variable');
        await editorSecrets.openSecret(varName);
        await editorSecrets.replaceValue('v3-editor');
        const refusal = editor.page.locator(editorSecrets.locators.refusal);
        await expect(refusal).toBeVisible();
        await expect(editor.page.locator(editorSecrets.locators.refusalCode)).toContainText(
          'variable_feeds_secret_consumer',
        );
        await expect(editor.page.locator(editorSecrets.locators.refusalUsage)).toContainText(dest);
        await h.shootThemes(editor.page, testInfo, 'j7-variable-refusal-editor');
      } finally {
        await editor.context.close();
      }
      expect((await h.getSecret(api, varId)).body.value).toBe('v2-root');
    },
  );

  test(
    'J7 a synthetics check keeps a header write-only and refuses a secret in the URL',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      // A private location takes an inline write-only header; only store refs are refused there.
      const loc = await h.mustCall(api, 'POST', '/synthetics/locations', {
        kind: 'private',
        region: h.plainName('lab'),
        label: 'u61 e2e lab',
      });
      cleanup.locations.push(loc.location.id);
      const name = h.secretName('chk');
      const inline = h.canaryValue();
      const keyId = await h.createSecret(api, {
        name,
        value: h.canaryValue(),
        types: ['synthetics_check'],
        hosts: ['example.com'],
      });
      cleanup.secretIds.push(keyId);
      const check = await h.mustCall(api, 'POST', '/synthetics', {
        name: h.plainName('check'),
        type: 'http',
        target: 'https://example.com/health',
        config: {
          method: 'GET',
          headers: [{ name: 'X-U61-Token', value: inline, secure: true }],
          timeout_ms: 10000,
          assertions: [],
        },
        locations: [loc.location.id],
        folder_id: 'default',
        frequency: { frequency_type: 'minutes', interval: 60 },
        enabled: false,
      });
      cleanup.checks.push(check.id);
      expect(check.config.headers[0].value).toMatchObject({ set: true });

      await consumers.gotoCheckEdit(check.id);
      await expect(consumers.checkHeaderReplace(0)).toBeVisible();
      await h.expectNoValueInDom(page, inline);
      await h.shootThemes(page, testInfo, 'j7-check-write-only-header');

      await consumers.page
        .locator(consumers.locators.checkUrlField)
        .fill(`https://example.com/health?k={{secrets.${name}}}`);
      await expect(consumers.page.locator(consumers.locators.checkUrlError)).toContainText(name);
      await h.shootThemes(page, testInfo, 'j7-check-url-ref-refused');
      await consumers.page.locator(consumers.locators.checkSave).click();
      await expect(consumers.page.locator(consumers.locators.checkUrlError)).toContainText(name);

      const refused = await h.call(api, 'POST', '/synthetics', {
        name: h.plainName('urlref'),
        type: 'http',
        target: `https://example.com/health?k={{secrets.${name}}}`,
        config: { method: 'GET', headers: [], timeout_ms: 10000, assertions: [] },
        locations: [loc.location.id],
        folder_id: 'default',
        frequency: { frequency_type: 'minutes', interval: 60 },
        enabled: false,
      });
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
      expect(refused.body?.code).toBe('ref_not_allowed_in_field');
      const stored = (await h.call(api, 'GET', `/synthetics/${check.id}`)).body;
      expect(stored.target).toBe('https://example.com/health');
      expect(JSON.stringify(stored)).not.toContain(inline);
    },
  );

  test(
    'J13 an MCP header offers the picker',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const name = h.secretName('tool');
      const id = await h.createSecret(api, {
        name,
        value: h.canaryValue(),
        types: ['ai_toolset'],
        hosts: ['example.com'],
      });
      cleanup.secretIds.push(id);
      const mcp = await h.mustCall(api, 'POST', '/ai/toolsets', {
        name: h.plainName('mcp'),
        kind: 'mcp',
        description: 'u61 e2e',
        data: {
          url: 'https://example.com/mcp',
          headers: { Authorization: `{{secrets.${name}}}` },
          timeout_seconds: 30,
        },
        automation_allowed: false,
      });
      cleanup.toolsets.push(mcp.id);

      await consumers.gotoToolsetEdit(mcp.id);
      await expect(consumers.toolsetHeaderKey(0)).toHaveValue('Authorization');
      await expect(consumers.toolsetHeaderValue(0)).toHaveValue(`{{secrets.${name}}}`);
      await expect(consumers.toolsetHeaderRemove(0)).toBeVisible();
      await consumers.toolsetPicker(0).click();
      await consumers.page.locator(consumers.locators.pickerSearch).fill(name);
      await expect(consumers.pickerItem(name)).toBeVisible();
      await h.shootThemes(page, testInfo, 'j13-toolset-mcp-picker');
      await consumers.page.keyboard.press('Escape');
      await expect(consumers.page.locator(consumers.locators.toolsetAutomation)).toBeVisible();
    },
  );
});
