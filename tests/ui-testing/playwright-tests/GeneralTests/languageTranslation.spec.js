/**
 * Language Translation Coverage Tests
 *
 * Tests translation coverage for all supported languages.
 */
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Run the 10 language cases SEQUENTIALLY within this file (default mode), NOT in
// parallel. Each case is an exhaustive ~27-page full-app crawl (Logs/Metrics/
// Traces/RUM/Dashboards — chart, monaco and websocket-heavy views) held in one
// context for up to 6 minutes. Under the CI `--workers=5` override, `mode:'parallel'`
// let up to 5 of these giant crawls run at once and OOM-killed a worker browser
// process — every case scheduled on that worker then failed with "Target page,
// context or browser has been closed" (an 8-test cascade in run 29481437880).
// Default mode keeps at most ONE language crawl resident per worker while OTHER
// GeneralTests spec files still parallelise across the remaining workers, and —
// unlike `mode:'serial'` — a single case failure does NOT skip the rest.
// (Full coverage is preserved; only the concurrency is reduced.)
test.describe.configure({ mode: 'default' });

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
