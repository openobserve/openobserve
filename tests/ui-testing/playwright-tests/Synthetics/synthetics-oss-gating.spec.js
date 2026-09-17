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

// Synthetics OSS gating negatives for the private-location slice (plan §9); self-skips on enterprise builds via /config build_type.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createLocation,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics — OSS gating', { tag: ['@synthetics', '@all', '@oss'] }, () => {
  let pm;
  let config;
  let locationId;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    config = await assertSyntheticsEnabled(page);
    locationId = await ensureSyntheticsLocation(page);
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.skip(config.build_type !== 'opensource', `Runs only on OSS build (detected: ${config.build_type})`);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('private locations tab is hidden and the section falls back to checks', { tag: ['@P1'] }, async () => {
    expect(config.synthetics_private_locations_enabled).toBe(false);
    const l = pm.syntheticsListPage;
    await l.goto(ORG, { section: 'private' });
    await l.expectPrivateSectionAbsent();
  });

  test('creating a private location returns 400', { tag: ['@P1'] }, async ({ page }) => {
    const { status, body } = await createLocation(page, { kind: 'private', region: 'x', label: 'x' });
    expect(status).toBe(400);
    expect(String(body?.message ?? '')).toContain('private locations require enterprise');
  });

  test('Configure offers no private section', { tag: ['@P2'] }, async () => {
    const c = pm.syntheticsCreatePage;
    await c.gotoCreate(ORG, 'http');
    await c.expectLocationOffered(locationId, true);
    await c.expectNoPrivateLocationSection();
  });
});
