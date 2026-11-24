// Pretty stack trace tells iOS and Android errors that JS source maps do not apply and offers no upload; browser errors still get it (#16460, fixed by #16478).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { sourcemapErrorEvent, ingestRumErrorEvents } = require('../../utils/rum-sourcemap-errors.js');

const RUN_ID = Date.now();

test.describe('Pretty stack trace for mobile RUM errors (#16460)', {
  tag: ['@bug-16460', '@P1', '@regression', '@rumRegression', '@sourcemapPretty'],
}, () => {
  test('iOS and Android errors show that source maps do not apply and offer no upload; a browser error still does', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(240000);
    const pm = new PageManager(page);
    const translateCalls = [];
    page.on('request', (req) => {
      if (req.url().includes('/sourcemaps/stacktrace')) translateCalls.push(req.url());
    });

    // Error detail reads the event with `SELECT *`, which quick mode caps at the first N schema fields; a fresh org keeps `_rumdata` narrow so `source` survives.
    const org = `smapmobile${RUN_ID}`;
    const cases = [
      { source: 'ios', service: `e2e-smap-ios-${RUN_ID}`, file: `main.ios-${RUN_ID}.js` },
      { source: 'android', service: `e2e-smap-android-${RUN_ID}`, file: `main.android-${RUN_ID}.js` },
      { source: 'browser', service: `e2e-smap-web-${RUN_ID}`, file: `main.web-${RUN_ID}.js` },
    ];
    for (const c of cases) {
      const event = sourcemapErrorEvent('typeError', { service: c.service, runId: RUN_ID, sourceFile: c.file, source: c.source });
      await ingestRumErrorEvents(page, [event], { service: c.service, org });
    }

    const openPretty = async (service) => {
      await pm.rumPage.gotoErrorsList({ service, period: '1h', org });
      await pm.rumPage.expectErrorsTableVisible();
      await pm.rumPage.waitForErrorRowsPresent();
      await pm.rumPage.openFirstError();
      await pm.rumPage.clickPrettyTab();
    };

    for (const c of cases.filter((m) => m.source !== 'browser')) {
      await openPretty(c.service);
      await pm.rumPage.expectPrettyMobileUnsupported();
      expect(translateCalls, `${c.source}: no stack translation is attempted`).toEqual([]);
    }

    await openPretty(cases.find((c) => c.source === 'browser').service);
    await pm.rumPage.expectPrettyUploadOffered();
    expect(translateCalls.length, 'a browser error is still translated').toBeGreaterThan(0);
  });
});
