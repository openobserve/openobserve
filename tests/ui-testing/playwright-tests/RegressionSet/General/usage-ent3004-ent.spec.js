// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

// At $0.50 per GB: Ingestion $100, Search $5, so dividing Ingestion by the Search-only total would read 2000%.
const METERING = { ingestionMb: 204800, searchMb: 10240, ratePerGb: 0.5 };

// Org delete 404s on this build, so a fixed id keeps one org across runs instead of one per run; this test must not run concurrently with itself.
const USAGE_ORG = 'e2e_usage3004';

const OTHER_ORG_BUDGET = {
  org_id: 'usage_ent3004_other_org',
  total_budget_amount: 900,
  warn_at_amount: 720,
  paused: false,
};

test.describe('Usage page regressions from ENT#3004', () => {
  test.describe.configure({ mode: 'parallel' });

  let usage;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    usage = new PageManager(page).billingUsagePage;
  });

  // A mocked route still in flight when the test ends must not fail it after its assertions passed.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('selecting a meter makes it the Top Meter, with a share of at most 100% @bug-ent3004 @P1 @regression @usage', async ({ page }) => {
    await usage.clearLeftoverUsage(USAGE_ORG);
    try {
      await usage.seedUsage(USAGE_ORG, { Ingestion: METERING.ingestionMb, Search: METERING.searchMb });
      await usage.enableUsageReporting(USAGE_ORG);
      await usage.mockMetering(METERING);

      await usage.openUsageTab(USAGE_ORG, 'trends');
      await usage.expectTotalCost('$105.00');
      await usage.expectTopMeter('Ingestion', '$100.00 · 95% of cost');

      await usage.toggleMeter('Search');
      await usage.expectTotalCost('$5.00');
      await usage.expectTopMeter('Search', '$5.00 · 5% of cost');
      await usage.expectTopMeterIsNot('Ingestion');
      expect(await usage.getTopMeterSharePercent()).toBeLessThanOrEqual(100);
      testLogger.info('Top Meter names the selected meter with its share of all meters');

      await usage.toggleMeter('Search');
      await usage.expectTotalCost('$105.00');
      await usage.expectTopMeter('Ingestion', '$100.00 · 95% of cost');
    } finally {
      await usage.removeUsageData(USAGE_ORG);
    }
  });

  for (const [how, typed] of [
    ['clearing the amount', ''],
    ['setting the amount to $0', '0'],
  ]) {
    test(`${how} and saving removes only this org's budget @bug-ent3004 @P1 @regression @usage`, async ({ page }) => {
      const orgId = getOrgIdentifier();
      await usage.mockMetering(METERING);
      await usage.mockBudgetStorage([
        { org_id: orgId, total_budget_amount: 500, warn_at_amount: 400, paused: false },
        OTHER_ORG_BUDGET,
      ]);

      await usage.openUsageTab(orgId, 'budget');
      await usage.expectBudgetShown('500', '$500.00');
      await usage.expectSaveDisabled();

      await usage.setBudgetAmount(typed);
      await usage.expectSaveEnabled();
      await usage.saveBudget();

      expect(usage.budgetPosts).toEqual([{ orgId, body: { budget_config: [OTHER_ORG_BUDGET] } }]);
      await usage.expectToast('Budget removed');
      await usage.expectSaveDisabled();
      testLogger.info('Save sent the budget list without this org and kept the other org');

      await usage.reloadBudgetTab();
      await usage.expectNoBudgetShown();
      await usage.expectNothingStoredToRemove();
    });
  }
});
