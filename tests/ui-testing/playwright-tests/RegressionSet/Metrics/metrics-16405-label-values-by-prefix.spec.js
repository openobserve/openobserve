const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { postRows, waitForInstantQuery } = require('../../utils/metrics-explore-seed.js');

const RID = Math.random().toString(36).slice(2, 7);
const LABEL = 'e2e16405_host';
// The docker prefix sorts first org-wide and carries only the docker host, like `container_*` beside `system_*`.
const DOCKER_PREFIX = `a16405${RID}`;
const SYSTEM_PREFIX = `s16405${RID}`;
const DOCKER_HOST = `docker-${RID}`;
const HOSTS = ['a', 'b', 'c', 'd'].map((h) => `host-${h}-${RID}`);
const DOCKER_METRICS = Array.from({ length: 6 }, (_, i) => `${DOCKER_PREFIX}_m${i}`);
const SYSTEM_METRICS = [`${SYSTEM_PREFIX}_cpu`, `${SYSTEM_PREFIX}_mem`];

const rows = (metric, host) => {
  const start = Date.now() - 8 * 60_000;
  return Array.from({ length: 20 }, (_, i) => ({
    __name__: metric,
    __type__: 'gauge',
    [LABEL]: host,
    _timestamp: start + i * 15_000,
    value: i + 1,
  }));
};

// openobserve#16405 (issue #15690): label value suggestions sampled the first streams org-wide, ignoring the selected prefix.
test.describe('Metrics Explorer label values follow the selected prefix (#16405)', () => {
  test.beforeAll(async ({ request }) => {
    await postRows(request, DOCKER_METRICS.flatMap((m) => rows(m, DOCKER_HOST)));
    await postRows(request, SYSTEM_METRICS.flatMap((m) => [DOCKER_HOST, ...HOSTS].flatMap((h) => rows(m, h))));
    await waitForInstantQuery(request, `${SYSTEM_METRICS[1]}{${LABEL}="${HOSTS[3]}"}`);
    await waitForInstantQuery(request, DOCKER_METRICS[5]);
  });

  test('with a prefix selected, the value list holds every host of that prefix', {
    tag: ['@bug-16405', '@bug-15690', '@P2', '@regression', '@metrics', '@metricsRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);

    await pm.metricsExplorerPage.gotoExplorer({ prefix: SYSTEM_PREFIX });
    await pm.metricsExplorerPage.expectExplorerVisible();
    await pm.metricsExplorerPage.expectCardCharted(SYSTEM_METRICS[0]);

    const values = await pm.metricsExplorerPage.labelValueSuggestions(LABEL);
    testLogger.info('value suggestions', { values });
    for (const host of [DOCKER_HOST, ...HOSTS]) expect(values, `${host} sends ${SYSTEM_PREFIX}_* metrics`).toContain(host);
  });
});
