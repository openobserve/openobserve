// alerts-13243-prebuilt-form-reuse.spec.js
// Alerts Regression — prebuilt destination form on a reused form (#13243, bug 1)
//
// Creating a SECOND destination in the same session used to break the form:
// selecting a prebuilt type unmounted the type's credential field AND the
// destination-name field about half a second later, during the template
// auto-load re-render, and they never came back. The form was then unusable —
// the webhook URL and the name could not be typed, so the destination could not
// be created. The FIRST destination after a fresh page load was always fine,
// which is why this needs a reused form to reproduce at all.
//
// The assertion is deliberately about the fields STAYING mounted, not merely
// appearing: the old failure rendered them, then removed them. A single
// waitFor(visible) passes against the broken build, because it matches the first
// doomed render. This samples across the whole re-render window instead.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// The unmount was reported at ~0.5s and the fields stayed gone for 25s+, so a
// few seconds of sampling past the template fetch is enough to catch it.
const SAMPLE_WINDOW_MS = 6000;
const SAMPLE_EVERY_MS = 400;

// The credential field each prebuilt type renders behind its own v-if.
const CREDENTIAL_FIELD = {
  discord: '[data-test="discord-webhook-url-input-field"]',
  msteams: '[data-test="msteams-webhook-url-input-field"]',
  pagerduty: '[data-test="pagerduty-integration-key-input-field"]',
};

test.describe('Prebuilt destination form reuse (#13243)', () => {
  test.describe.configure({ mode: 'serial' });

  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.alertDestinationsPage.navigateToDestinations();
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: a reused prebuilt form keeps its credential and name fields mounted', {
    tag: ['@alerts', '@destinations', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    // Use the form once, the way a user would before hitting this. The bug needs
    // a form instance that has already been used, not a fresh page.
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('discord');
    await page.locator('[data-test="add-destination-cancel-btn"]').click();
    await page.locator('[data-test="prebuilt-destination-selector"]').waitFor({
      state: 'hidden',
      timeout: 15000,
    });

    for (const [type, credentialSelector] of Object.entries(CREDENTIAL_FIELD)) {
      await test.step(`reopen the form and select ${type}`, async () => {
        // Reopen WITHOUT a page reload — a reload gives a fresh mount, which is
        // exactly the case that never broke.
        await pm.alertDestinationsPage.clickNewDestination();
        await page
          .locator(`[data-test="destination-type-card"][data-type="${type}"]`)
          .click({ timeout: 15000 });

        const samples = [];
        const deadline = Date.now() + SAMPLE_WINDOW_MS;
        while (Date.now() < deadline) {
          samples.push(
            await page.evaluate(
              ([cred, name]) => ({
                credential: document.querySelectorAll(cred).length,
                name: document.querySelectorAll(name).length,
              }),
              [credentialSelector, '[data-test="add-destination-name-input-field"]'],
            ),
          );
          await page.waitForTimeout(SAMPLE_EVERY_MS);
        }

        const credentialGone = samples.filter((s) => s.credential === 0).length;
        const nameGone = samples.filter((s) => s.name === 0).length;
        expect(
          credentialGone,
          `${type}: the credential field unmounted in ${credentialGone}/${samples.length} samples`,
        ).toBe(0);
        expect(
          nameGone,
          `${type}: the destination-name field unmounted in ${nameGone}/${samples.length} samples`,
        ).toBe(0);

        // Mounted is not the same as usable — the point of the bug was a form
        // nobody could fill in.
        await page.locator(credentialSelector).first().fill('https://example.invalid/hook');
        await page.locator('[data-test="add-destination-name-input-field"]').first().fill(`reuse_${type}`);
        await expect(page.locator('[data-test="add-destination-name-input-field"]').first()).toHaveValue(
          `reuse_${type}`,
        );

        await page.locator('[data-test="add-destination-cancel-btn"]').click();
        await page.locator('[data-test="prebuilt-destination-selector"]').waitFor({
          state: 'hidden',
          timeout: 15000,
        });
      });
    }
  });
});
