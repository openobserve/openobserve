// Error breadcrumbs read the click name and selector the browser SDK stores in action_target_name and the JSON-valued _o2_action_target (#16331).

const { test } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { generateHexId } = require('../../utils/trace-ingestion.js');
const { ingestRumData, waitForSearch } = require('../../utils/traces-api.js');

// A dedicated org keeps _rumdata narrow: past ZO_QUICK_MODE_NUM_FIELDS, the breadcrumb SELECT * can drop the action fields.
const RUM_ORG = 'e2e16331rum';

function sessionRows({ sessionId, viewId, errorId, now }) {
  const base = { session_id: sessionId, view_id: viewId, service: 'e2e-16331-web', source: 'browser', view_url: 'https://shop.example.com/cart' };
  const at = (offsetMs) => ({ _timestamp: (now + offsetMs) * 1000, date: now + offsetMs });
  return [
    { ...base, ...at(0), type: 'view', view_loading_type: 'initial_load' },
    // A JSON string, as the SDK sends it; an object would be flattened into _o2_action_target_selector, which the old code already read.
    { ...base, ...at(1000), type: 'action', action_type: 'click', action_id: generateHexId(8), action_target_name: 'Checkout', _o2_action_target: JSON.stringify({ selector: 'button#checkout' }) },
    { ...base, ...at(2000), type: 'action', action_type: 'click', action_id: generateHexId(8), action_target_name: 'Pay now', _o2_action_target: '{not json' },
    { ...base, ...at(3000), type: 'error', error_id: errorId, error_type: 'TypeError', error_message: 'e2e-16331 checkout failed', error_source: 'source' },
  ];
}

test.describe('RUM error breadcrumbs for SDK click targets (#16331)', () => {
  test('a click shows its target name and selector instead of "undefined : undefined"', {
    tag: ['@bug-16331', '@P2', '@regression', '@rumRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pm = new PageManager(page);
    const now = Date.now() - 2 * 60 * 1000;
    const f = { sessionId: `e2e-16331-${generateHexId(6)}`, viewId: generateHexId(8), errorId: `e2e-16331-${generateHexId(6)}`, now };
    const rows = sessionRows(f);
    await ingestRumData(page.request, rows, { org: RUM_ORG, message: 'Precondition: the session must ingest' });
    await waitForSearch(page.request, `SELECT type FROM "_rumdata" WHERE session_id = '${f.sessionId}'`, {
      org: RUM_ORG,
      type: 'logs',
      size: 10,
      expected: rows.length,
      message: 'the session must become searchable',
    });

    await pm.rumPage.gotoErrorViewer(f.errorId, rows[rows.length - 1]._timestamp, RUM_ORG);
    await pm.rumPage.expectBreadcrumbDescription('Checkout : button#checkout');
    // A malformed target JSON keeps the name rather than breaking the row.
    await pm.rumPage.expectBreadcrumbDescription('Pay now');
    await pm.rumPage.expectNoBreadcrumbDescriptionContaining('undefined');
    testLogger.testEnd(testInfo.title, 'passed');
  });
});
