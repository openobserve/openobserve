// Kubernetes page: the cluster picker shows while clusters load, and a relative date preset applies at once (#16682, fixed by #16778).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { k8sEventRow, ingestK8sEvents } = require('../../utils/k8s-events-seed.js');

// An own org so the only cluster the page can find is the one seeded here.
const K8S_ORG = 'e2e16778k8s';
const CLUSTER = 'e2e-16778-prod';
// The page opens on the last hour, so a 6-hour window can only come from the preset.
const SIX_HOURS_US = 6 * 60 * 60 * 1000 * 1000;

test.describe('Kubernetes cluster picker and date presets (#16682)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const id = generateHexId(6);
    await ingestK8sEvents(request, K8S_ORG, [k8sEventRow({ id, note: `e2e-16778 ${id}`, cluster: CLUSTER })]);
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the cluster picker is shown disabled with "Loading clusters…" until the clusters arrive', {
    tag: ['@bug-16682', '@P2', '@regression', '@infraRegression'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const hold = await pm.kubernetesPage.holdQueries(K8S_ORG);
    await pm.kubernetesPage.open({ org: K8S_ORG });
    await expect.poll(() => hold.held.length, { timeout: 15000, message: 'Precondition: the cluster lookup must be in flight' }).toBeGreaterThan(0);
    await pm.kubernetesPage.expectClusterPickerLoading('Loading clusters…');

    await hold.release();
    await pm.kubernetesPage.expectClusterPickerShows(CLUSTER);
  });

  test('picking "Last 6 hours" applies the range at once, with no Apply click', {
    tag: ['@bug-16682', '@P2', '@regression', '@infraRegression'],
  }, async ({ page }) => {
    const pm = new PageManager(page);
    const windows = pm.kubernetesPage.trackSearchWindows();
    await pm.kubernetesPage.open({ org: K8S_ORG });
    await expect.poll(() => windows.length, { timeout: 30000, message: 'Precondition: the page must run its first queries' }).toBeGreaterThan(0);

    await pm.kubernetesPage.pickRelativePreset('6-h');
    await pm.kubernetesPage.expectDateMenuClosed();
    // Some query reads exactly the picked window, so the preset reached the page without Apply.
    await expect.poll(
      () => windows.some((w) => Math.abs(w.end - w.start - SIX_HOURS_US) < 60 * 1000 * 1000),
      { timeout: 20000, message: 'a search over the last 6 hours must run after the preset click' },
    ).toBe(true);
  });
});
