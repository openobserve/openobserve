/**
 * German (Deutsch) Translation Coverage Test
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test("German (Deutsch) translation coverage", {
  tag: ['@languageTranslation', '@P1', '@de']
}, async ({ page }) => {
  test.setTimeout(360000);
  await navigateToBase(page);
  const pm = new PageManager(page);

  await pm.languagePage.navigateToHome();
  const result = await pm.languagePage.testLanguageTranslation(pm, 'de', true);
  await pm.languagePage.resetToEnglish(pm);

  // Log result with status
  const statusMsg = result.status === 'ideal' ? 'PASS (ideal)'
    : result.status === 'acceptable' ? 'ACCEPTABLE (needs work)'
    : 'FAIL';
  testLogger.info(`\nGERMAN RESULT: ${result.overallPercentage}% - ${statusMsg}`);

  // Test passes if coverage >= acceptable minimum (ideal - delta)
  expect(result.overallPercentage,
    `German translation coverage should be >= ${pm.languagePage.getAcceptableMinCoverage()}%`)
    .toBeGreaterThanOrEqual(pm.languagePage.getAcceptableMinCoverage());
});
