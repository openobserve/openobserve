const { test, expect, navigateToBase, generateUUID } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { deleteStream } = require('../../utils/traces-api.js');

const CONTROL_BUTTON = '[data-test="traces-trace-dag-wrapper"] .vue-flow__controls-button';
const WHITE = 'rgb(255, 255, 255)';
const VUE_FLOW_DEFAULT = 'rgb(254, 254, 254)';

test.describe('Trace DAG zoom/fit controls follow the dark theme (o2-enterprise#3126 B8)', () => {
  let pm;
  let stream;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (stream) await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('DAG control buttons take the panel surface colour in dark mode, not white', {
    tag: ['@bug-ent3126', '@P2', '@regression', '@tracesRegression'],
  }, async ({ page }) => {
    const suffix = generateUUID();
    stream = `e2e_ent3126_dag_${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(stream, {
      name: spanName,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'e2e-model',
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(stream, spanName);

    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.searchUntilTraceResultVisible();
    await pm.tracesPage.clickFirstTraceResult();
    // The DAG tab renders only once the trace's spans load, which can outlast the helper's 10s wait.
    await page.locator('[data-test="trace-details-dag-tab"]').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    expect(await pm.tracesPage.openTraceDetailsTab('dag'), 'an LLM trace must offer the DAG tab').toBe(true);

    await expect(page.locator('html'), 'precondition: the app must be in dark mode').toHaveClass(/\bdark\b/);
    const buttons = page.locator(CONTROL_BUTTON);
    await expect(buttons.first()).toBeVisible({ timeout: 30000 });
    expect(await buttons.count(), 'vue-flow renders its zoom/fit controls').toBeGreaterThan(0);

    const { colours, surface } = await buttons.first().evaluate((first, selector) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--color-surface-base)';
      first.parentElement.appendChild(probe);
      const surfaceColour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        colours: [...document.querySelectorAll(selector)].map((b) => getComputedStyle(b).backgroundColor),
        surface: surfaceColour,
      };
    }, CONTROL_BUTTON);
    testLogger.info('DAG control colours', { colours, surface });

    expect(surface, 'the dark surface token must not itself be white').not.toBe(WHITE);
    for (const colour of colours) {
      expect(colour).not.toBe(WHITE);
      expect(colour).not.toBe(VUE_FLOW_DEFAULT);
      expect(colour, 'each control matches the themed surface').toBe(surface);
    }
  });
});
