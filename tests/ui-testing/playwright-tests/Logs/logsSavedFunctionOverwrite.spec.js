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
const { LogsSavedFunctionPage } = require('../../pages/logsPages/logsSavedFunctionPage.js');

const ORG = getOrgIdentifier();
const STAMP = Date.now();
const STREAM = `fnovr${STAMP}`;
const FUNCTION_NAME = `fnovr${STAMP}`;
// No quotes or brackets: Monaco auto-closes them, which would corrupt what the keystrokes leave in the editor.
const BODY_BEFORE = '.overwrite_marker = 101';
const BODY_AFTER = '.overwrite_marker = 202';

function apiBase() {
  const url = process.env.ZO_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function trackFunctionWrites(page) {
  const sent = [];
  page.on('request', (request) => {
    if (/\/api\/[^/]+\/functions(\/|\?|$)/.test(request.url())) {
      sent.push({ method: request.method(), url: request.url() });
    }
  });
  return { of: (method) => sent.filter((entry) => entry.method === method) };
}

async function storedFunction(request, name) {
  const response = await request.get(
    `${apiBase()}/api/${ORG}/functions?page_num=1&page_size=1000&name=${name}`,
    { headers: getAuthHeaders() },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  return (body.list || []).filter((entry) => entry.name === name);
}

// beforeAll/afterAll run per worker, and this file shares one ingested stream plus one saved function.
test.describe.configure({ mode: 'serial' });

test.describe('Logs saved-function overwrite', () => {
  let savedFunction;

  test.beforeAll(async ({ request }) => {
    const now = Date.now() * 1000;
    const rows = Array.from({ length: 10 }, (_, i) => ({
      _timestamp: now - 60e6 + i * 1000,
      host: `web-${i}`,
      body: `overwrite fixture ${i}`,
    }));
    await ingestRows(request, ORG, STREAM, rows);
    await waitForSearchable(request, ORG, STREAM, rows.length);
  });

  test.afterAll(async ({ request }) => {
    const fn = await request.delete(`${apiBase()}/api/${ORG}/functions/${FUNCTION_NAME}`, {
      headers: getAuthHeaders(),
    });
    const stream = await request.delete(`${apiBase()}/api/${ORG}/streams/${STREAM}?type=logs`, {
      headers: getAuthHeaders(),
    });
    testLogger.info('Deleted exactly what this file created', {
      function: [FUNCTION_NAME, fn.status()],
      stream: [STREAM, stream.status()],
    });
  });

  test('overwriting a saved function replaces the stored body and survives a reload', {
    tag: ['@savedFunctionOverwrite', '@all', '@logs'],
  }, async ({ page, request }) => {
    testLogger.testStart('saved-function overwrite', __filename);
    const writes = trackFunctionWrites(page);
    await navigateToBase(page);
    savedFunction = new LogsSavedFunctionPage(page);
    await savedFunction.openLogs(ORG, STREAM);

    await savedFunction.setFunctionBody(BODY_BEFORE);
    await savedFunction.createFunction(FUNCTION_NAME);
    await expect
      .poll(async () => (await storedFunction(request, FUNCTION_NAME)).length, { timeout: 30000 })
      .toBe(1);

    await savedFunction.setFunctionBody(BODY_AFTER);
    await savedFunction.overwriteFunction(FUNCTION_NAME);

    // The PUT is what separates an overwrite from a second create.
    await expect.poll(() => writes.of('PUT').length, { timeout: 30000 }).toBeGreaterThan(0);

    const stored = await storedFunction(request, FUNCTION_NAME);
    expect(stored).toHaveLength(1);
    expect(stored[0].function).toContain(BODY_AFTER);
    expect(stored[0].function).not.toContain(BODY_BEFORE);

    await savedFunction.openLogs(ORG, STREAM);
    await savedFunction.applySavedFunction(FUNCTION_NAME);
    await expect
      .poll(async () => savedFunction.functionBody(), { timeout: 30000 })
      .toContain(BODY_AFTER);
    expect(await savedFunction.functionBody()).not.toContain(BODY_BEFORE);

    testLogger.info('Overwritten body round-tripped and survived the reload', {
      function: FUNCTION_NAME,
    });
  });
});
