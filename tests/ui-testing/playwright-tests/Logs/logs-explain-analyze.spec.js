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
const PageManager = require('../../pages/page-manager.js');
const { ingestRows, waitForSearchable } = require('../utils/auto-run-helpers.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const { deleteStream } = require('../utils/traces-api.js');

const ORG = getOrgIdentifier() || 'default';
const STREAM = `explain_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ROWS = 30;

test.describe.configure({ mode: 'serial' });

test.describe('Logs Explain query: Plan and Analyze', () => {
  let pm;

  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    const rows = Array.from({ length: ROWS }, (_, i) => ({
      _timestamp: now - 5 * 60e6 + i * 1000,
      n: i,
      level: i % 2 ? 'info' : 'error',
      log: `explain e2e line ${i}`,
    }));
    await ingestRows(request, ORG, STREAM, rows);
    await waitForSearchable(request, ORG, STREAM, ROWS);
  });

  test.afterAll(async ({ request }) => {
    await deleteStream(request, STREAM, { type: 'logs', org: ORG });
    testLogger.info('Deleted the stream this file created', { stream: STREAM });
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('Plan tab renders operators, Analyze runs on the server and shows the profile', {
    tag: ['@explainAnalyze', '@logs', '@P1', '@all'],
  }, async () => {
    await pm.logsPage.openExplainForQuery(STREAM, `SELECT n, log FROM "${STREAM}" LIMIT 5`);
    await pm.logsPage.expectQueryPlanOperatorsRendered();

    await pm.logsPage.switchQueryPlanToAnalyze();
    const { status, state } = await pm.logsPage.runQueryPlanAnalyze();
    expect(status).toBe(200);
    expect(state).toBe('done');
    await pm.logsPage.expectQueryProfileRendered();
    testLogger.info('Plan and Analyze both rendered operators');
  });

  test('Analyze of a query that fails at run time does not show success', {
    tag: ['@explainAnalyze', '@logs', '@P1', '@all'],
  }, async () => {
    await pm.logsPage.openExplainForQuery(STREAM, `SELECT CAST(log AS INT) x FROM "${STREAM}" LIMIT 5`, { expectRows: false });
    await pm.logsPage.switchQueryPlanToAnalyze();
    const { state } = await pm.logsPage.runQueryPlanAnalyze();
    // Marked only after setup has settled, so a broken setup fails red instead of passing as the known bug.
    test.fail(true, '#16511 item 2: a failed EXPLAIN ANALYZE run is shown as a success');
    expect(state).not.toBe('done');
    await pm.logsPage.expectAnalyzeNotShownAsSuccess();
  });
});
