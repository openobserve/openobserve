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

// The synthetic check form opened from AutoObserve; needs a ready private location and the three public regions (U6 lane seed).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const {
  apiBase,
  request,
  assertSyntheticsEnabled,
  listLocations,
  listChecks,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const PREFILL_KEY = 'o2:syntheticPrefill';
const EXPECT_PREFILL = process.env.U6_EXPECT_PREFILL !== 'false';

const prefillBase = {
  version: 1,
  source: 'autoobserve',
  sourceLabel: 'Suggested by AutoObserve',
  type: 'http',
  method: 'GET',
  intervalMinutes: 5,
  destinations: ['ops-webhook'],
  suggested: ['folder', 'tags', 'url', 'locations', 'destinations'],
};
const counts = { folderAlerts: 3, destinationAlerts: 3 };

function internalPrefill(ctx) {
  return {
    ...prefillBase,
    name: 'svc-c health',
    folder: ctx.folder,
    url: 'http://svc-c.ns-a.svc.cluster.local:8080/healthz',
    locations: [ctx.privateId],
    tags: ['service:svc-c', 'namespace:ns-a', 'cluster:cluster-k'],
    service: { name: 'svc-c', cluster: 'cluster-k', namespace: 'ns-a' },
    evidence: { reach: 'private', urlFrom: 'traces', ...counts },
  };
}

function publicPrefill(ctx) {
  return {
    ...prefillBase,
    name: 'checkout health',
    folder: ctx.folder,
    url: 'https://checkout.demo.test/health',
    locations: ctx.publicIds,
    tags: ['service:checkout', 'namespace:shop', 'cluster:cluster-p'],
    service: { name: 'checkout', cluster: 'cluster-p', namespace: 'shop' },
    evidence: { reach: 'public', urlFrom: 'traces', ...counts },
  };
}

function unknownUrlPrefill(ctx) {
  return { ...internalPrefill(ctx), name: 'svc-x health', url: '', service: { name: 'svc-x', cluster: 'cluster-k', namespace: 'ns-a' }, tags: ['service:svc-x', 'namespace:ns-a', 'cluster:cluster-k'], evidence: counts };
}

// U0 picks the service's ready in-cluster agent even for a public address.
function publicViaAgentPrefill(ctx) {
  return { ...publicPrefill(ctx), locations: [ctx.privateId], service: { name: 'checkout', cluster: 'cluster-k', namespace: 'shop' } };
}

// Seeds once per tab, so a reload shows what the form does with an already-read prefill.
async function seed(page, prefill) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('u6-seeded')) return;
      sessionStorage.setItem('u6-seeded', '1');
      sessionStorage.setItem(key, value);
    },
    [PREFILL_KEY, JSON.stringify(prefill)],
  );
}

async function openForm(page, query = '&prefill=autoobserve') {
  await page.goto(`/web/synthetics/add?type=http${query}&org_identifier=${ORG}`);
  await expect(page.locator('[data-test="synthetics-create-save-btn"]')).toBeVisible({ timeout: 30000 });
}

async function deleteChecksNamed(page, folder, name) {
  for (const c of await listChecks(page, folder)) {
    if (c.name === name) await request(page, 'delete', `${apiBase()}/${c.id}?folder=${folder}`);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Synthetic check form from AutoObserve', { tag: ['@synthetics', '@autoobserve', '@enterprise'] }, () => {
  const ctx = {};

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    const locations = await listLocations(page);
    ctx.privateId = locations.find((l) => l.label === 'cluster-k agents')?.id;
    ctx.pendingId = locations.find((l) => l.label === 'dc-east')?.id;
    ctx.publicIds = ['aws-us-east-1', 'aws-eu-west-1', 'aws-ap-south-1'];
    const { body } = await request(page, 'get', `${process.env.ZO_BASE_URL}/api/v2/${ORG}/folders/synthetics`);
    ctx.folder = (body?.list ?? []).find((f) => f.name === 'ops')?.folderId;
    expect(ctx.privateId, 'lane seed: cluster-k agents').toBeTruthy();
    expect(ctx.pendingId, 'lane seed: dc-east with no agent').toBeTruthy();
    expect(ctx.folder, 'lane seed: folder ops').toBeTruthy();
    for (const name of ['svc-c health', 'checkout health', 'plain check u6']) {
      await deleteChecksNamed(page, ctx.folder, name);
      await deleteChecksNamed(page, 'default', name);
    }
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
  });

  test('an internal service opens filled with a private location and saves only on Save & Exit', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await seed(page, internalPrefill(ctx));
    await openForm(page);
    const banner = page.locator('[data-test="synthetics-prefill-banner"]');
    await expect(banner).toContainText('Suggested by AutoObserve for svc-c (cluster-k / ns-a).');
    await expect(page.locator('[data-test="synthetics-check-details-name-input"] input')).toHaveValue('svc-c health');
    await expect(page.locator('[data-test="synthetics-prefill-note-folder"]')).toHaveText(/Where svc-c's 3 alerts live\./);
    await expect(page.locator('[data-test="synthetics-prefill-note-url"]')).toContainText('port 8080 and the health route /healthz');
    await expect(page.locator(`[data-test="synthetics-prefill-location-chip-${ctx.privateId}"]`)).toBeVisible();
    await expect(page.locator('[data-test^="synthetics-prefill-location-chip-"]')).toHaveCount(1);
    await expect(page.locator(`[data-test="synthetics-check-locations-warning-${ctx.pendingId}"]`)).toHaveText("No agent has connected yet, so it can't run checks");
    await expect(page.locator(`[data-test="synthetics-check-locations-option-${ctx.pendingId}"] [role="checkbox"]`)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-test="synthetics-prefill-location-note-public"]')).toContainText("isn't reachable from the internet");
    await expect(page.locator('[data-test="synthetics-prefill-runs-per-day"]')).toHaveText('288 runs a day');
    await expect(page.locator('[data-test="synthetics-prefill-alert-line"]')).toHaveText('Alert after 2 failed runs in a row.');
    await expect(page.locator('[data-test="synthetics-prefill-after-save-runs"]')).toHaveText('The check runs every 5 minutes from cluster-k agents.');
    expect((await listChecks(page, ctx.folder)).some((c) => c.name === 'svc-c health')).toBe(false);

    await page.locator('[data-test="synthetics-create-save-btn"]').click();
    await expect(page).toHaveURL(/\/web\/autoobserve\?.*page=coverage.*service=svc-c/, { timeout: 30000 });
    const saved = (await listChecks(page, ctx.folder)).find((c) => c.name === 'svc-c health');
    expect(saved, 'saved in folder ops').toBeTruthy();
    const { body } = await request(page, 'get', `${apiBase()}/${saved.id}?folder=${ctx.folder}`);
    testLogger.info('saved check', { tags: body.tags, locations: body.locations, url: body.url ?? body.config?.url });
    expect(body.tags).toEqual(['service:svc-c', 'namespace:ns-a', 'cluster:cluster-k']);
    expect(body.locations).toEqual([ctx.privateId]);
    expect(JSON.stringify(body)).toContain('http://svc-c.ns-a.svc.cluster.local:8080/healthz');
    expect(JSON.stringify(body)).toContain('ops-webhook');
    expect(body.description).toMatch(/^Created from an AutoObserve suggestion for svc-c on /);
  });

  test('a public address opens with the three public regions and saves them', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await seed(page, publicPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-banner"]')).toContainText('Suggested by AutoObserve for checkout (public address).');
    await expect(page.locator('[data-test^="synthetics-prefill-location-chip-"]')).toHaveCount(3);
    await expect(page.locator('[data-test="synthetics-prefill-location-note-private"]')).toContainText('Not selected: the address is public');
    await expect(page.locator('[data-test="synthetics-prefill-runs-per-day"]')).toHaveText('864 runs a day across 3 regions');
    await page.locator('[data-test="synthetics-create-save-btn"]').click();
    await expect(page).toHaveURL(/service=checkout/, { timeout: 30000 });
    const saved = (await listChecks(page, ctx.folder)).find((c) => c.name === 'checkout health');
    expect(saved, 'saved in folder ops').toBeTruthy();
    const { body } = await request(page, 'get', `${apiBase()}/${saved.id}?folder=${ctx.folder}`);
    expect([...body.locations].sort()).toEqual([...ctx.publicIds].sort());
    expect(body.tags).toContain('service:checkout');
  });

  test('an unknown URL leaves the field empty and says why', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await seed(page, unknownUrlPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-note-url"]')).toHaveText(
      "svc-x's URL isn't in its traces or logs, so you enter it; location, folder and destination are filled in.",
    );
    await expect(page.locator('[data-test="synthetics-prefill-note-url"] [data-test="synthetics-prefill-suggested-chip"]')).toHaveCount(0);
    await expect(page.locator('[data-test="synthetics-prefill-location-note-reach"]')).toContainText(
      "AutoObserve can't tell whether svc-x is reachable from the internet, so choose the locations: a public one fails every run if it isn't.",
    );
    await expect(page.locator('[data-test="synthetics-prefill-location-note-public"]')).toHaveCount(0);
  });

  test('a prefill without evidence quotes no counts and leaves the reach to the user', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    const { evidence: _evidence, ...bare } = internalPrefill(ctx);
    await seed(page, bare);
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-note-folder"]')).toHaveText(/Where svc-c's alerts live\./);
    await expect(page.locator('[data-test="synthetics-prefill-note-destinations"]')).toContainText("svc-c's alerts notify ops-webhook.");
    await expect(page.locator('[data-test="synthetics-prefill-note-url"]')).toHaveCount(0);
    await expect(page.locator('[data-test="synthetics-prefill-location-note-reach"]')).toBeVisible();
    await expect(page.locator('[data-test="synthetics-prefill-location-note-public"]')).toHaveCount(0);
  });

  test('a public address checked from the in-cluster agent keeps the agent and says why public is not selected', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await seed(page, publicViaAgentPrefill(ctx));
    await openForm(page);
    await expect(page.locator(`[data-test="synthetics-prefill-location-chip-${ctx.privateId}"]`)).toBeVisible();
    await expect(page.locator('[data-test="synthetics-prefill-location-note-public"]')).toHaveText(
      /Not selected: a private location runs this check; add a public one to also check checkout from the internet\./,
    );
    await expect(page.locator('[data-test="synthetics-prefill-location-note-private"]')).not.toContainText('Not selected');
    await expect(page.locator('[data-test="synthetics-prefill-after-save-runs"]')).toHaveText('The check runs every 5 minutes from cluster-k agents.');
  });

  test('a destination the org no longer has is dropped before saving', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await page.route('**/alerts/destinations?**', (route) => route.fulfill({ json: [] }));
    await seed(page, internalPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-after-save-notify"]')).not.toContainText('ops-webhook');
    await expect(page.locator('[data-test="synthetics-prefill-note-destinations"]')).toHaveCount(0);
    await expect(page.locator('[data-test="synthetics-prefill-unconfirmed-destinations"]')).toHaveCount(0);
  });

  test('lists that fail to load keep the suggestions and say they are not confirmed', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await page.route('**/synthetics/locations', (route) => route.fulfill({ status: 500, json: { message: 'down' } }));
    await page.route('**/alerts/destinations?**', (route) => route.fulfill({ status: 500, json: { message: 'down' } }));
    await seed(page, internalPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-unconfirmed-locations"]')).toHaveText(
      "Locations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    await expect(page.locator('[data-test="synthetics-prefill-unconfirmed-destinations"]')).toHaveText(
      "Destinations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    await expect(page.locator('[data-test="synthetics-prefill-after-save-runs"]')).toHaveText(
      'The check will run every 5 minutes from 1 location if you keep the suggestion.',
    );
    await expect(page.locator('[data-test="synthetics-prefill-after-save-notify"]')).toHaveText(
      'If 2 runs in a row fail, ops-webhook will be notified if you keep the suggestion.',
    );
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.locator('[data-test="synthetics-check-locations-refresh-btn"]').click();
    await expect(page.locator('[data-test="synthetics-prefill-unconfirmed-locations"]')).toHaveCount(0);
    await expect(page.locator(`[data-test="synthetics-prefill-location-chip-${ctx.privateId}"]`)).toBeVisible();
    await expect(page.locator('[data-test="synthetics-prefill-after-save-runs"]')).toHaveText('The check runs every 5 minutes from cluster-k agents.');
  });

  test('a reload shows the plain form, because the prefill is read once', async ({ page }) => {
    test.skip(!EXPECT_PREFILL, 'OSS build');
    await seed(page, internalPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-prefill-banner"]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-test="synthetics-create-save-btn"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="synthetics-prefill-banner"]')).toHaveCount(0);
    await expect(page.locator('[data-test="synthetics-check-details-name-input"] input')).toHaveValue('');
  });

  test('the same seed on a build without enterprise opens the plain form', async ({ page }) => {
    test.skip(EXPECT_PREFILL, 'enterprise build');
    await seed(page, internalPrefill(ctx));
    await openForm(page);
    await expect(page.locator('[data-test="synthetics-check-details-name-input"] input')).toHaveValue('');
    await expect(page.locator('[data-test^="synthetics-prefill-"]')).toHaveCount(0);
  });

  test('without a prefill the form is unchanged and saves to the checks list', async ({ page }) => {
    await openForm(page, '');
    await expect(page.locator('[data-test^="synthetics-prefill-"]')).toHaveCount(0);
    await expect(page.locator(`[data-test="synthetics-check-locations-option-${ctx.pendingId}"]`)).toHaveCount(0);
    await page.locator('[data-test="synthetics-check-details-name-input"] input').fill('plain check u6');
    await page.locator('[data-test="synthetics-check-details-url-input"] input, [data-test="synthetics-check-details-url-input"] [contenteditable]').first().fill('https://plain.demo.test/');
    await page.locator(`[data-test="synthetics-check-locations-option-aws-us-east-1"]`).click();
    await page.locator('[data-test="synthetics-create-save-btn"]').click();
    await expect(page).toHaveURL(/\/web\/synthetics(\?|$)/, { timeout: 30000 });
    expect((await listChecks(page, 'default')).some((c) => c.name === 'plain check u6')).toBe(true);
    await deleteChecksNamed(page, 'default', 'plain check u6');
  });
});
