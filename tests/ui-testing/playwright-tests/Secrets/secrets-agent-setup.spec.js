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

// Secrets & variables J14: the private-location agent setup drawer as an org admin and as an editor.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { SecretConsumersPage } = require('../../pages/secretsPages/secretConsumersPage.js');
const { selectOSelectOption } = require('../../pages/alertsPages/oselectHelpers.js');
const h = require('../utils/secrets-helpers.js');

const TOKEN_PLACEHOLDER = '<o2syn-token>';

test.describe.configure({ mode: 'serial' });

test.describe('Secrets store agent setup', { tag: ['@secrets', '@enterprise', '@synthetics'] }, () => {
  let api;
  let consumers;
  let member;
  let locationId;

  test.beforeAll(async () => {
    api = await h.rootApi();
    const { body } = await h.call(api, 'GET', '/secrets/status');
    test.skip(body?.store_ready !== true, 'secret store is not ready on this deployment');
    member = await h.createMember(api, `${h.plainName('editor')}@example.com`);
    const loc = await h.mustCall(api, 'POST', '/synthetics/locations', {
      kind: 'private',
      region: h.plainName('lab'),
      label: 'u61 e2e lab',
    });
    locationId = loc.location.id;
    expect(loc.install).toContain(TOKEN_PLACEHOLDER);
    expect(loc.install).not.toMatch(/o2syn_[A-Za-z0-9]/);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    consumers = new SecretConsumersPage(page);
  });

  test.afterAll(async () => {
    await h.deleteLocation(api, locationId);
    await h.deleteMember(api, member?.email);
    await api.dispose();
  });

  test(
    'J14 an org admin inserts an agent token into the install command',
    { tag: ['@P1'] },
    async ({ page }, testInfo) => {
      const { body: tokens } = await h.call(api, 'GET', '/synthetics/agent-tokens');
      const list = tokens?.tokens ?? tokens ?? [];
      test.skip(!list.some((t) => t.enabled !== false), 'needs an enabled agent token in the org');

      await consumers.openAgentSetup(locationId);
      const cmd = consumers.page.locator(consumers.locators.setupInstallCmd).first();
      await expect(cmd).toContainText(TOKEN_PLACEHOLDER);
      await expect(consumers.page.locator(consumers.locators.setupNewToken)).toBeVisible();
      await expect(consumers.page.locator(consumers.locators.setupAskAdmin)).toHaveCount(0);
      await h.shootThemes(page, testInfo, 'j14-admin-setup-placeholder');

      const tokenName = list.find((t) => t.enabled !== false).name;
      await selectOSelectOption(consumers.page, consumers.locators.setupTokenSelect, tokenName);
      await consumers.page.locator(consumers.locators.setupInsertToken).click();
      await expect(cmd).toContainText('--token=o2syn_');
      await expect(cmd).not.toContainText(TOKEN_PLACEHOLDER);
      await consumers.maskInstallToken();
      await h.shootThemes(page, testInfo, 'j14-admin-setup-token-inserted');
    },
  );

  test(
    'J14 an editor gets the placeholder command and is told to ask an org admin',
    { tag: ['@P1'] },
    async ({ browser }, testInfo) => {
      const editor = await h.loginAs(browser, member);
      try {
        const editorConsumers = new SecretConsumersPage(editor.page);
        await editorConsumers.openAgentSetup(locationId);
        const cmd = editor.page.locator(editorConsumers.locators.setupInstallCmd).first();
        await expect(cmd).toContainText(TOKEN_PLACEHOLDER);
        await expect(editor.page.locator(editorConsumers.locators.setupAskAdmin)).toBeVisible();
        await expect(editor.page.locator(editorConsumers.locators.setupInsertToken)).toHaveCount(0);
        await expect(editor.page.locator(editorConsumers.locators.setupNewToken)).toHaveCount(0);
        expect(await editor.page.content()).not.toMatch(/o2syn_[A-Za-z0-9]/);
        await h.shootThemes(editor.page, testInfo, 'j14-editor-setup-ask-admin');
      } finally {
        await editor.context.close();
      }
    },
  );
});
