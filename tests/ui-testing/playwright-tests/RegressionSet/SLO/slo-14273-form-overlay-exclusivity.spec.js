// slo-14273-form-overlay-exclusivity.spec.js
// SLO Regression — New SLO form overlay exclusivity (#14273)
//
// On the New SLO form, the Source alert
// dropdown and the Reliability nav flyout were open at the same time and drew on
// top of each other, so the alert options and the menu items were unreadable.
//
// The rule being pinned is mutual exclusion, asserted in BOTH orders: opening
// either overlay dismisses the other. A z-index tweak alone would leave the two
// still open, so "they do not overlap" is not enough — one of them must be gone.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');

// The flyout's own items, used as the proof it is open. Matching on the exact
// item text keeps this independent of the flyout's wrapper markup.
const FLYOUT_ITEM = /^(SLOs|Incidents|External Alert Sources)$/;

// The picker renders its options with no listbox wrapper, so the options
// themselves are the signal that it is open; the empty state covers an org with
// no eligible source alert, where the popover still opens.
const sourceAlertOverlay = (page) =>
  page.locator('[role="option"], [data-test="slos-addslo-alert-source-empty"]');

async function flyoutItemCount(page) {
  return page.evaluate(
    (pattern) =>
      [...document.querySelectorAll('a,button,li,div,span')].filter(
        (el) => el.children.length === 0 && new RegExp(pattern).test((el.innerText || '').trim()),
      ).length,
    FLYOUT_ITEM.source,
  );
}

test.describe('New SLO form overlay exclusivity', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);

    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = process.env['ORGNAME'] || 'default';
    await page.goto(`${baseUrl}/web/slos/add?org_identifier=${org}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Alert-based is the SLI type that has a Source alert picker at all.
    const alertBased = page.getByRole('button', { name: /Alert-based/i }).first();
    await alertBased.waitFor({ state: 'visible', timeout: 30000 });
    await alertBased.click();

    // The picker sits at the bottom of a long form. `scrollIntoViewIfNeeded` leaves
    // it flush against the viewport edge, where the popover has nowhere to open and
    // the click reads as a toggle-shut — so centre it explicitly.
    const trigger = page.locator('[data-test="slos-addslo-alert-source-trigger"]');
    await trigger.waitFor({ state: 'visible', timeout: 30000 });
    await page.evaluate(() =>
      document
        .querySelector('[data-test="slos-addslo-alert-source-trigger"]')
        .scrollIntoView({ block: 'center' }),
    );
    await page.waitForTimeout(500);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: the nav flyout and the Source alert dropdown are never open together', {
    tag: ['@slos', '@ui', '@functional', '@P1', '@all'],
  }, async ({ page }) => {
    // Open the nav flyout first, which is the order the bug was reported in.
    await page.locator('a:has-text("Reliability")').first().hover();
    await expect
      .poll(() => flyoutItemCount(page), { timeout: 10000 })
      .toBeGreaterThan(0);

    await page.locator('[data-test="slos-addslo-alert-source-trigger"]').click();
    await page.waitForTimeout(1500);

    // Whichever overlay wins, they must not both be on screen — that overlap is
    // the defect. Asserting "the dropdown opened" instead would over-specify:
    // dismissing the flyout with the same click is an equally correct outcome.
    const bothOpen =
      (await flyoutItemCount(page)) > 0 && (await sourceAlertOverlay(page).count()) > 0;
    expect(bothOpen, 'the nav flyout and the Source alert dropdown overlapped').toBe(false);
  });

  test('P1: opening the Reliability nav flyout dismisses an open Source alert dropdown', {
    tag: ['@slos', '@ui', '@functional', '@P1', '@all'],
  }, async ({ page }) => {
    await page.locator('[data-test="slos-addslo-alert-source-trigger"]').click();
    // Precondition: with no nav interference the dropdown really does open, so a
    // later count of 0 means it was dismissed rather than never shown.
    await expect(sourceAlertOverlay(page).first()).toBeVisible({ timeout: 10000 });

    await page.locator('a:has-text("Reliability")').first().hover();
    await expect.poll(() => flyoutItemCount(page), { timeout: 10000 }).toBeGreaterThan(0);

    await expect(sourceAlertOverlay(page)).toHaveCount(0, { timeout: 10000 });
  });
});
