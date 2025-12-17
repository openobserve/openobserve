/**
 * Language Translation Coverage Tests
 *
 * Tests translation coverage for all supported languages.
 * Runs in parallel for faster execution.
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Configure parallel execution within this file
test.describe.configure({ mode: 'parallel' });

const languages = [
  { code: 'de', name: 'German (Deutsch)', tag: '@de' },
  { code: 'es', name: 'Spanish (Español)', tag: '@es' },
  { code: 'fr', name: 'French (Français)', tag: '@fr' },
  { code: 'it', name: 'Italian (Italiano)', tag: '@it' },
  { code: 'nl', name: 'Dutch (Nederlands)', tag: '@nl' },
  { code: 'pt', name: 'Portuguese (Português)', tag: '@pt' },
  { code: 'tr-turk', name: 'Turkish (Türkçe)', tag: '@tr' },
  { code: 'ja', name: 'Japanese (日本語)', tag: '@ja' },
  { code: 'ko', name: 'Korean (한국어)', tag: '@ko' },
  { code: 'zh-cn', name: 'Chinese Simplified (简体中文)', tag: '@zh' },
];

for (const { code, name, tag } of languages) {
  test(`${name} translation coverage`, {
    tag: ['@languageTranslation', '@P1', tag]
  }, async ({ page }) => {
    test.setTimeout(360000);
    await navigateToBase(page);
    const pm = new PageManager(page);

    await pm.languagePage.navigateToHome();
    const result = await pm.languagePage.testLanguageTranslation(pm, code, true);
    await pm.languagePage.resetToEnglish(pm);

    // Log result with status
    const statusMsg = result.status === 'ideal' ? 'PASS (ideal)'
      : result.status === 'acceptable' ? 'ACCEPTABLE (needs work)'
      : 'FAIL';
    testLogger.info(`\n${name.toUpperCase()} RESULT: ${result.overallPercentage}% - ${statusMsg}`);

    // Test passes if coverage >= acceptable minimum (ideal - delta)
    expect(result.overallPercentage,
      `${name} translation coverage should be >= ${pm.languagePage.getAcceptableMinCoverage()}%`)
      .toBeGreaterThanOrEqual(pm.languagePage.getAcceptableMinCoverage());
  });
}
