/**
 * Quick mode builds the query's SELECT list out of the interesting fields, so only a
 * schema-backed field can be one. A VRL function's output field exists only on the
 * result hits — the backend applies the VRL after the SQL — so putting one in the
 * SELECT fails the whole search with "Search field not found: <field>".
 *
 * Bug: o2-enterprise#2859 — quick mode + a starred VRL field errors on Run.
 */
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require('../../../fixtures/log.json');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const STREAM = 'e2e_automate';
const VRL_FIELD = 'e2e2859';
const SCHEMA_FIELD = 'kubernetes_container_name';

test.describe("Logs VRL-derived field in quick mode", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestTestData(page).catch((e) => testLogger.warn(`Ingestion skipped: ${e.message}`));
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier() || 'default'}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative1HourOrFallback();
    await pm.logsPage.enableQuickModeIfDisabled();
    await pm.logsPage.setVrlFunction(`.${VRL_FIELD} = "derived"`);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.expectResultsGridSettledWithRows();
    testLogger.info(`Quick mode on, VRL field "${VRL_FIELD}" produced by the function`);
  });

  // No afterEach: nothing is persisted server-side, and each test's beforeEach
  // re-navigates and rewrites the VRL editor's whole model.

  test("a VRL-derived field must not offer the interesting-field toggle", {
    tag: ['@bug-2859', '@P2', '@regression', '@logsRegression', '@logsRegressionVrl', '@quickMode']
  }, async () => {
    // The control side: without it, a sidebar that rendered no toggles at all would pass.
    await pm.logsPage.searchFieldByName(SCHEMA_FIELD);
    const schemaToggles = await pm.logsPage.countInterestingFieldButtons(SCHEMA_FIELD);
    testLogger.info(`Schema field "${SCHEMA_FIELD}" offers ${schemaToggles} interesting toggles`);
    expect(
      schemaToggles,
      `Precondition: the schema field "${SCHEMA_FIELD}" must offer the interesting-field toggle`
    ).toBeGreaterThan(0);

    // The VRL field is listed — extractFields() reads it off the hits — but it is not
    // schema-backed, so it must not be offerable as an interesting field.
    await pm.logsPage.searchFieldByName(VRL_FIELD);
    const vrlToggles = await pm.logsPage.countInterestingFieldButtons(VRL_FIELD);
    testLogger.info(`VRL field "${VRL_FIELD}" offers ${vrlToggles} interesting toggles`);
    expect(
      vrlToggles,
      'Bug #2859: a VRL-derived field cannot be in the quick-mode SELECT, so it must not render the ⓘ toggle'
    ).toBe(0);

    testLogger.info(`PASSED: VRL field "${VRL_FIELD}" carries no interesting-field toggle`);
  });

  test("a VRL-derived field carried in the interesting list must not break the search", {
    tag: ['@bug-2859', '@P2', '@regression', '@logsRegression', '@logsRegressionVrl', '@quickMode']
  }, async () => {
    // A list persisted by a build that still starred the field comes back on load, so
    // hiding the toggle alone does not clear the error for anyone who already has one.
    await pm.logsPage.forceInterestingFieldInState(VRL_FIELD);

    await pm.logsPage.runQueryAndWaitForResults();

    // Pre-fix the SELECT carried the VRL field and the search failed with
    // "Search field not found: e2e2859" instead of returning rows.
    await pm.logsPage.expectNoSearchError();
    await pm.logsPage.expectResultsGridSettledWithRows();

    const interestingFields = await pm.logsPage.getInterestingFieldList();
    expect(
      Array.isArray(interestingFields),
      'interestingFieldList must be readable from Vue state'
    ).toBe(true);
    expect(
      interestingFields,
      `"${VRL_FIELD}" must be pruned from interestingFieldList, got: ${interestingFields?.join(',')}`
    ).not.toContain(VRL_FIELD);

    testLogger.info('PASSED: the VRL field was pruned and the search returned rows');
  });
});
