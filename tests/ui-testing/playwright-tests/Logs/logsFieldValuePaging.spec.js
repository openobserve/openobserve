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

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { ingestRows, waitForSearchable } = require('../utils/auto-run-helpers.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { LogsFieldValuesPage } = require('../../pages/logsPages/logsFieldValuesPage.js');

const ORG = getOrgIdentifier();
const STREAM = `fvpaging${Date.now()}`;
const FIELD = 'host';
// Matches db-10..db-12 only, which no page of this fixture ever rendered, so the panel's local cache filter cannot produce a hit.
const SEARCH_TERM = 'db-1';

function apiBase() {
  const url = process.env.ZO_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Distinct per-value counts pin the backend rank order, so page 2 is the next values down and never a reshuffle of page 1.
function fixtureRows() {
  const now = Date.now() * 1000;
  const rows = [];
  let offset = 0;
  const push = (host, count) => {
    for (let i = 0; i < count; i++) {
      rows.push({ _timestamp: now - 5 * 60e6 + offset++ * 1000, host, body: `probe ${host} ${i}` });
    }
  };
  for (let i = 1; i <= 12; i++) push(`web-${String(i).padStart(2, '0')}`, 25 - i);
  for (let i = 1; i <= 12; i++) push(`db-${String(i).padStart(2, '0')}`, 13 - i);
  return rows;
}

const FIXTURE = fixtureRows();

// beforeAll/afterAll run per worker, and this file shares one ingested stream.
test.describe.configure({ mode: 'serial' });

test.describe('Logs field-value paging and in-field search', () => {
  let fieldValues;

  test.beforeAll(async ({ request }) => {
    await ingestRows(request, ORG, STREAM, FIXTURE);
    await waitForSearchable(request, ORG, STREAM, FIXTURE.length);
  });

  test.afterAll(async ({ request }) => {
    const response = await request.delete(`${apiBase()}/api/${ORG}/streams/${STREAM}?type=logs`, {
      headers: getAuthHeaders(),
    });
    testLogger.info('Deleted the stream this file created', {
      stream: STREAM,
      status: response.status(),
    });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    fieldValues = new LogsFieldValuesPage(page);
    await fieldValues.openLogs(ORG, STREAM);
  });

  test('"load more" fetches additional distinct values from the backend', {
    tag: ['@fieldValuePaging', '@all', '@logs'],
  }, async () => {
    await fieldValues.expandField(FIELD);
    const firstPage = await fieldValues.waitForValues(FIELD);
    await fieldValues.expectLoadMoreVisible(FIELD);

    await fieldValues.clickLoadMore(FIELD);
    const afterLoadMore = await fieldValues.waitForMoreThan(FIELD, firstPage.length);

    // A backend ignoring the larger `size` would answer the same page and leave the list unchanged, so the delta is the whole assertion.
    const added = afterLoadMore.filter((key) => !firstPage.includes(key));
    expect(added.length).toBeGreaterThan(0);
    expect(new Set(afterLoadMore).size).toBe(afterLoadMore.length);
    for (const key of firstPage) expect(afterLoadMore).toContain(key);

    testLogger.info('Load more appended distinct values', {
      firstPage: firstPage.length,
      added: added.length,
    });
  });

  test('in-field value search returns values the first page never held', {
    tag: ['@fieldValuePaging', '@all', '@logs'],
  }, async () => {
    await fieldValues.expandField(FIELD);
    const firstPage = await fieldValues.waitForValues(FIELD);
    expect(firstPage.some((key) => key.includes(SEARCH_TERM))).toBe(false);

    await fieldValues.searchValues(SEARCH_TERM);
    const narrowed = await fieldValues.waitForValuesMatching(FIELD, SEARCH_TERM);

    expect(narrowed.length).toBeGreaterThan(0);
    for (const key of narrowed) expect(firstPage).not.toContain(key);

    testLogger.info('In-field search narrowed to server-side matches', { narrowed });
  });
});
