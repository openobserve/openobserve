const fs = require('fs');
const path = require('path');
const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { apiContext } = require('../../utils/rum-analytics-ingestion.js');
const { buildZip } = require('../../utils/zip-builder.js');

const TAGS = ['@bug-15269', '@P2', '@regression', '@rumRegression'];
const FIXTURE_DIR = path.resolve(__dirname, '../../../fixtures/sourcemaps');
const manifest = require(path.join(FIXTURE_DIR, 'manifest.json'));

const sourceMapsUrl = (query = '') => {
  const { orgId, baseUrl } = apiContext();
  return `${baseUrl}/api/${orgId}/sourcemaps${query}`;
};

test.describe('RUM Source Maps list keeps its view state (#15269)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ timezoneId: 'UTC' });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('Source Maps keeps its service filter, sort and page size after Upload and after leaving RUM', {
    tag: TAGS,
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const maps = pm.rumSourcemapsPage;
    const service = `e2e-15269-${Date.now()}`;
    const versions = ['1.0.0', '2.0.0', '3.0.0'];
    const zip = buildZip([
      { name: manifest.bundle, content: fs.readFileSync(path.join(FIXTURE_DIR, 'dist', manifest.bundle)) },
      { name: `${manifest.bundle}.map`, content: fs.readFileSync(path.join(FIXTURE_DIR, 'dist', `${manifest.bundle}.map`)) },
    ]);
    const { Authorization } = apiContext().headers;
    try {
      for (const version of versions) {
        const res = await page.request.post(sourceMapsUrl(), {
          headers: { Authorization },
          multipart: { service, version, env: 'e2e', file: { name: manifest.zip, mimeType: 'application/zip', buffer: zip } },
        });
        expect(res.ok(), `upload ${service}@${version}: ${res.status()} ${await res.text()}`).toBe(true);
      }
      await maps.gotoSourceMapsList();
      await maps.expectOnListPage();
      await maps.filterByService(service);
      await maps.sortBy('version', 'desc');
      await maps.setPageSize(50);
      const state = { service, column: 'version', direction: 'desc', pageSize: 50, versions: [...versions].reverse() };
      await maps.expectListState(state);

      testLogger.info('Opening Upload and cancelling back to the list');
      await maps.openUploadAndCancel();
      await maps.expectListState(state);

      testLogger.info('Leaving RUM for Product Analytics and returning from the menu');
      await pm.rumProductAnalyticsPage.openFromMenu();
      await expect(pm.rumProductAnalyticsPage.root).toBeVisible({ timeout: 30000 });
      await maps.returnViaRumMenu();
      await maps.expectListState(state);
    } finally {
      for (const version of versions) {
        const res = await page.request
          .delete(sourceMapsUrl(`?service=${service}&version=${version}&env=e2e`), { headers: { Authorization } })
          .catch(() => {});
        if (!res?.ok()) testLogger.warn('Cleanup delete failed', { service, version, status: res?.status() });
      }
    }
  });
});
