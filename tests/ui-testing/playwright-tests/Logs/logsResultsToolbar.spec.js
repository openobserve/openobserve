// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// The results-header breakpoint is a measured container width, so only a real viewport
// resize can fire it.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData: ingestion } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { LogsResultsToolbarPage } = require('../../pages/logsPages/logsResultsToolbarPage.js');

const STREAM = 'e2e_automate';
const WIDE_VIEWPORT = 1500;
// Below SearchResult.vue's 700px container threshold once the field-list sidebar is paid for.
const NARROW_VIEWPORT = 800;

test.describe('Logs results header overflow actions', () => {
  let pm;
  let toolbar;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    toolbar = new LogsResultsToolbarPage(page);

    await ingestion(page);
    await page.setViewportSize({ width: WIDE_VIEWPORT, height: 1024 });
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();
  });

  test('a narrow viewport moves the results actions into a working overflow menu', {
    tag: ['@resultsToolbar', '@logs', '@P2', '@all'],
  }, async ({ page }) => {
    await toolbar.setViewportWidthAndSettle(WIDE_VIEWPORT, { expectOverflow: false });
    const wrapBefore = await toolbar.readStoredWrapContent();

    let searchCalls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/_search')) searchCalls += 1;
    });

    await toolbar.setViewportWidthAndSettle(NARROW_VIEWPORT, { expectOverflow: true });
    await toolbar.openOverflowMenu();
    await toolbar.clickOverflowWrapItem();

    await expect
      .poll(() => toolbar.readStoredWrapContent(), {
        timeout: 15000,
        message: 'the overflow wrap item did not change the stored wrap preference',
      })
      .not.toBe(wrapBefore);
    // Wrap is a render-only concern; re-querying on it would be a regression.
    expect(searchCalls, 'wrapping from the overflow menu issued a search').toBe(0);

    await toolbar.setViewportWidthAndSettle(WIDE_VIEWPORT, { expectOverflow: false });

    testLogger.info('Actions collapsed below the breakpoint, stayed usable, and came back');
  });
});
