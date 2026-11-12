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

// Cross-links reach the drawer only if the server returns stream_links/org_links for
// the queried fields, which no unit test can stand in for.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData: ingestion } = require('../utils/data-ingestion.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { LogsCrossLinkPage } = require('../../pages/logsPages/logsCrossLinkPage.js');

const STREAM = 'e2e_automate';
const LINKED_FIELD = 'kubernetes_namespace_name';

// The org-level cross_links array is shared, so no two workers may hold a snapshot of it.
test.describe.configure({ mode: 'serial' });

test.describe('Logs cross-links', () => {
  let pm;
  let crossLinkPage;
  let linkName;
  let savedCrossLinks;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    crossLinkPage = new LogsCrossLinkPage(page);

    const configResponse = await page.request.get(
      `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/config`,
      { headers: getAuthHeaders() },
    );
    const zoConfig = await configResponse.json();
    // Server env, not org settings: a test cannot turn this on, so off means misconfigured.
    expect(
      zoConfig?.enable_cross_linking,
      'ZO_ENABLE_CROSS_LINKING is off on this environment, so no cross-link is ever offered. ' +
        'It is set true by .github/workflows/playwright.yml:63 and ' +
        'playwright_bugfix_regression.yml:43 — set the env var on the environment under test. ' +
        'Do not skip or delete this spec.',
    ).toBeTruthy();

    linkName = `e2e_crosslink_${Date.now()}`;
    savedCrossLinks = await crossLinkPage.readOrgCrossLinks();
    await crossLinkPage.writeOrgCrossLinks([
      ...savedCrossLinks,
      {
        name: linkName,
        // A cheap same-origin target: the assertion is the resolved URL, not what it renders.
        url:
          `${process.env.ZO_BASE_URL}/config?xl_field=\${field.__name}` +
          '&xl_value=${field.__value}&xl_from=${start_time}&xl_to=${end_time}&xl_query=${query}',
        fields: [{ name: LINKED_FIELD }],
      },
    ]);

    await ingestion(page);
    await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
    await pm.logsPage.selectStream(STREAM);
    await pm.logsPage.clickDateTimeButton();
    await pm.logsPage.clickRelative15MinButton();
    await pm.logsPage.clickSearchBarRefreshButton();
    await pm.logsPage.expectResultsGridSettledWithRows();
    await pm.logsPage.openLogDetailSidebar();
    await crossLinkPage.openFieldTableTab();
  });

  test.afterEach(async () => {
    // Restore the exact array that was there; a POST replaces cross_links wholesale.
    if (savedCrossLinks) await crossLinkPage.writeOrgCrossLinks(savedCrossLinks);
  });

  test('a configured cross-link opens the resolved URL in a real tab', {
    tag: ['@crossLinks', '@logs', '@P1', '@all'],
  }, async () => {
    const fieldValue = await crossLinkPage.readFieldValue(LINKED_FIELD);
    expect(fieldValue, 'the linked field rendered no value to substitute').not.toBe('');

    await crossLinkPage.openFieldMenu(LINKED_FIELD);
    await crossLinkPage.expectCrossLinkOffered(linkName);

    const openedUrl = await crossLinkPage.openCrossLinkAndReadUrl(linkName);
    // A literal space would mean the SQL was spliced in unencoded and the href is invalid.
    expect(openedUrl, 'the resolved URL was not percent-encoded').not.toMatch(/\s/);

    const params = new URL(openedUrl).searchParams;
    expect(params.get('xl_field')).toBe(LINKED_FIELD);
    expect(params.get('xl_value')).toBe(fieldValue);
    expect(params.get('xl_query')).toContain(STREAM);

    const from = Number(params.get('xl_from'));
    const to = Number(params.get('xl_to'));
    expect(String(from), 'start_time was not substituted as microseconds').toMatch(/^\d{16}$/);
    expect(String(to), 'end_time was not substituted as microseconds').toMatch(/^\d{16}$/);
    expect(from).toBeLessThan(to);

    testLogger.info('Cross-link resolved and opened with the row value and search window');
  });
});
