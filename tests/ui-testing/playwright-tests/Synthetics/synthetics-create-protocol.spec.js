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

// Synthetics create — TCP / TLS / SSH through the protocol form (plan §2.2–§2.4, §2.8).

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
const SSH_SECRET = 'synth-e2e-secret';

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics create — TCP / TLS / SSH', { tag: ['@synthetics', '@all'] }, () => {
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

  test('creates a TCP check', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('tcp', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'tcp');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('example.com');
    await pm.syntheticsCreatePage.fillTcp(443);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    const created = await findCheckByName(page, name);
    expect(created).toBeTruthy();
    await pm.syntheticsListPage.search(name);
    await pm.syntheticsListPage.expectRowVisible(created.id);
    const { body } = await getCheck(page, created.id);
    expect(body.type).toBe('tcp');
    expect(body.config.port).toBe(443);
  });

  test('creates a TLS check', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('tls', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'tls');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('example.com');
    await pm.syntheticsCreatePage.fillTls({ port: 443, minDays: 7 });
    await pm.syntheticsCreatePage.setTlsVerifyChain(true);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    await pm.syntheticsCreatePage.save();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    const created = await findCheckByName(page, name);
    expect(created).toBeTruthy();
    const { body } = await getCheck(page, created.id);
    expect(body.type).toBe('tls');
    expect(body.config.min_days_until_expiry).toBe(7);
    expect(body.config.verify_chain).toBe(true);
  });

  test('creates an SSH check and the response redacts the secret', { tag: ['@P0'] }, async ({ page }, testInfo) => {
    const name = uniqueName('ssh', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'ssh');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('example.com');
    await pm.syntheticsCreatePage.fillSsh({ port: 22, username: 'e2e', secret: SSH_SECRET });
    await pm.syntheticsCreatePage.selectLocation(locationId);
    await pm.syntheticsCreatePage.setEnabled(false);
    const response = await pm.syntheticsCreatePage.saveCapturingResponse();
    await pm.syntheticsCreatePage.expectSavedAndListed();

    expect([200, 201]).toContain(response.status);
    // GET returns the secret in plaintext by design; only the write response is redacted.
    expect(response.text).not.toContain(SSH_SECRET);
    const { body } = await getCheck(page, response.body.id);
    expect(body.type).toBe('ssh');
    expect(body.config.username).toBe('e2e');
  });

  test('server rejects a URL-shaped host target', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const name = uniqueName('badhost', testInfo);
    await pm.syntheticsCreatePage.gotoCreate(ORG, 'tcp');
    await pm.syntheticsCreatePage.fillName(name);
    await pm.syntheticsCreatePage.fillTarget('https://example.com');
    await pm.syntheticsCreatePage.fillTcp(443);
    await pm.syntheticsCreatePage.selectLocation(locationId);
    const response = await pm.syntheticsCreatePage.saveCapturingResponse();

    expect(response.status).toBe(400);
    await pm.syntheticsCreatePage.expectToast('target: expected host or host:port');
    expect(await findCheckByName(page, name)).toBeNull();
  });
});
