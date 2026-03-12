const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const STREAM_NAME = 'stream_pytest_data';

/**
 * Helper: base64 encode a string (matching OpenObserve's base64::encode_url).
 */
function base64Encode(text) {
  return Buffer.from(text).toString('base64');
}

/**
 * Helper: Parse SSE response text into structured events.
 * Returns array of { event, data } objects.
 */
function parseSSEEvents(content) {
  const events = [];
  const lines = content.split('\n');
  let currentEvent = null;

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const dataStr = line.slice(6).trim();
      if (dataStr === '[[DONE]]') {
        events.push({ event: 'done', data: null });
      } else {
        try {
          const data = JSON.parse(dataStr);
          events.push({ event: currentEvent || 'data', data });
        } catch {
          // Skip non-JSON data lines
        }
      }
      currentEvent = null;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// VRL function code used across tests
// ---------------------------------------------------------------------------

const RESULT_ARRAY_VRL = `#ResultArray#

prev_data = []
curr_data = []
res = []
result = array!(.)

if length(result) >= 2 {
  today_data = result[0]
  yesterday_data = result[1]

  cnt_yesterday = 0.0
  cnt_today = 0.0

  for_each(array!(yesterday_data)) -> |index, p_value| {
    cnt_yesterday, err = cnt_yesterday + p_value.cnt
  }

  for_each(array!(today_data)) -> |index, p_value| {
    cnt_today, err = cnt_today + p_value.cnt
  }

  diff = cnt_today - cnt_yesterday
  if diff < 0.0 {
    diff = cnt_yesterday - cnt_today
  }
  diff_percentage, err = (diff) * 100.0 / cnt_yesterday
  if diff_percentage > 0.0 {
    diff_data = {"diff": diff, "diff_percentage": diff_percentage}
    temp = []
    second_dummy = []
    temp = push(temp, diff_data)
    res = push(res, temp)
    res = push(res, second_dummy)
  }
}
. = res
.`;

const NON_RESULT_ARRAY_VRL = '.doubled_cnt = .cnt * 2\n.';

// ---------------------------------------------------------------------------
// Panel builders
// ---------------------------------------------------------------------------

function makeMultiWindowPanelNoVrl(panelId = 'panel_mw_no_vrl') {
  return {
    id: panelId,
    type: 'line',
    title: 'Multi Window No VRL',
    description: '',
    config: { show_legends: true, legends_position: null, show_symbol: false, show_gridlines: true },
    queryType: 'sql',
    queries: [{
      query: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
      vrlFunctionQuery: '',
      customQuery: true,
      fields: {
        stream: STREAM_NAME, stream_type: 'logs',
        x: [{ label: 'time_s', alias: 'time_s', type: 'build', color: null }],
        y: [{ label: 'cnt', alias: 'cnt', type: 'build', color: null }],
        z: [], breakdown: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] }
      },
      config: { promql_legend: '', time_shift: [{ offSet: '1h' }] }
    }],
    layout: { x: 0, y: 0, w: 96, h: 18, i: 0 }
  };
}

function makeMultiWindowPanelNonResultArrayVrl(panelId = 'panel_mw_vrl_simple') {
  return {
    id: panelId,
    type: 'line',
    title: 'Multi Window Non-ResultArray VRL',
    description: '',
    config: { show_legends: true, legends_position: null, show_symbol: false, show_gridlines: true },
    queryType: 'sql',
    queries: [{
      query: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
      vrlFunctionQuery: NON_RESULT_ARRAY_VRL,
      customQuery: true,
      fields: {
        stream: STREAM_NAME, stream_type: 'logs',
        x: [{ label: 'time_s', alias: 'time_s', type: 'build', color: null }],
        y: [{ label: 'cnt', alias: 'cnt', type: 'build', color: null }],
        z: [], breakdown: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] }
      },
      config: { promql_legend: '', time_shift: [{ offSet: '1h' }] }
    }],
    layout: { x: 0, y: 20, w: 96, h: 18, i: 1 }
  };
}

function makeMultiWindowPanelResultArrayVrl(panelId = 'panel_mw_vrl_result_array') {
  return {
    id: panelId,
    type: 'bar',
    title: 'Multi Window ResultArray VRL',
    description: '',
    config: { show_legends: true, legends_position: null, show_symbol: false, show_gridlines: true },
    queryType: 'sql',
    queries: [{
      query: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
      vrlFunctionQuery: RESULT_ARRAY_VRL,
      customQuery: true,
      fields: {
        stream: STREAM_NAME, stream_type: 'logs',
        x: [{ label: 'diff', alias: 'diff', type: 'build', color: null, isDerived: true }],
        y: [{ label: 'diff_percentage', alias: 'diff_percentage', type: 'build', color: null, isDerived: true }],
        z: [], breakdown: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] }
      },
      config: { promql_legend: '', time_shift: [{ offSet: '1h' }] }
    }],
    layout: { x: 96, y: 20, w: 96, h: 18, i: 2 }
  };
}

// ===========================================================================
// PART 1: Dashboard CRUD with multi-time-window panels
// ===========================================================================

test.describe('Dashboard Multi-Time-Window CRUD API tests', () => {
  let headers;
  let baseUrl;
  let orgId;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    headers = getAuthHeaders();
    baseUrl = process.env.ZO_BASE_URL.replace(/\/$/, '');
    orgId = getOrgIdentifier();
  });

  test('POST /dashboards - create dashboard with multi-window panel (no VRL)', {
    tag: ['@api', '@dashboards', '@multiWindow', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating dashboard with multi-window panel (no VRL)');

    const dashboardData = {
      version: 8,
      title: `MW No VRL Test ${Date.now()}`,
      description: 'Multi-window dashboard without VRL',
      folder_id: 'default',
      tabs: [{ tabId: 'tab-1', name: 'Overview', panels: [makeMultiWindowPanelNoVrl()] }],
      variables: { list: [], showDynamicFilters: false }
    };

    const resp = await page.request.post(`${baseUrl}/api/${orgId}/dashboards`, {
      headers, data: dashboardData
    });

    expect([200, 201]).toContain(resp.status());
    const body = await resp.json();
    expect(body).toHaveProperty('v8.dashboardId');
    const dashboardId = body.v8.dashboardId;
    testLogger.info(`Created dashboard: ${dashboardId}`);

    // Verify time_shift persisted
    const getResp = await page.request.get(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    expect(getResp.status()).toBe(200);
    const saved = await getResp.json();
    const queryConfig = saved.v8.tabs[0].panels[0].queries[0].config;
    expect(queryConfig).toHaveProperty('time_shift');
    expect(queryConfig.time_shift).toHaveLength(1);
    expect(queryConfig.time_shift[0].offSet).toBe('1h');

    // Cleanup
    await page.request.delete(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    testLogger.info('Test completed');
  });

  test('POST /dashboards - create dashboard with multi-window + non-ResultArray VRL', {
    tag: ['@api', '@dashboards', '@multiWindow', '@vrl', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating dashboard with non-ResultArray VRL');

    const dashboardData = {
      version: 8,
      title: `MW Simple VRL Test ${Date.now()}`,
      description: 'Multi-window dashboard with per-hit VRL',
      folder_id: 'default',
      tabs: [{ tabId: 'tab-1', name: 'Overview', panels: [makeMultiWindowPanelNonResultArrayVrl()] }],
      variables: { list: [], showDynamicFilters: false }
    };

    const resp = await page.request.post(`${baseUrl}/api/${orgId}/dashboards`, {
      headers, data: dashboardData
    });

    expect([200, 201]).toContain(resp.status());
    const body = await resp.json();
    const dashboardId = body.v8.dashboardId;

    // Verify VRL and time_shift persisted
    const getResp = await page.request.get(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    expect(getResp.status()).toBe(200);
    const saved = await getResp.json();
    const query = saved.v8.tabs[0].panels[0].queries[0];
    expect(query.vrlFunctionQuery).toBeTruthy();
    expect(query.vrlFunctionQuery).toContain('.doubled_cnt');
    expect(query.config.time_shift[0].offSet).toBe('1h');

    // Cleanup
    await page.request.delete(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    testLogger.info('Test completed');
  });

  test('POST /dashboards - create dashboard with multi-window + ResultArray VRL', {
    tag: ['@api', '@dashboards', '@multiWindow', '@vrl', '@P0']
  }, async ({ page }) => {
    testLogger.info('Creating dashboard with ResultArray VRL');

    const dashboardData = {
      version: 8,
      title: `MW ResultArray VRL Test ${Date.now()}`,
      description: 'Multi-window dashboard with ResultArray VRL',
      folder_id: 'default',
      tabs: [{ tabId: 'tab-1', name: 'Overview', panels: [makeMultiWindowPanelResultArrayVrl()] }],
      variables: { list: [], showDynamicFilters: false }
    };

    const resp = await page.request.post(`${baseUrl}/api/${orgId}/dashboards`, {
      headers, data: dashboardData
    });

    expect([200, 201]).toContain(resp.status());
    const body = await resp.json();
    const dashboardId = body.v8.dashboardId;

    // Verify #ResultArray# VRL persisted
    const getResp = await page.request.get(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    expect(getResp.status()).toBe(200);
    const saved = await getResp.json();
    const query = saved.v8.tabs[0].panels[0].queries[0];
    expect(query.vrlFunctionQuery).toContain('#ResultArray#');
    expect(query.vrlFunctionQuery).toContain('diff_percentage');
    expect(query.config.time_shift[0].offSet).toBe('1h');

    // Cleanup
    await page.request.delete(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    testLogger.info('Test completed');
  });

  test('POST /dashboards - create dashboard with all 3 multi-window panel types', {
    tag: ['@api', '@dashboards', '@multiWindow', '@vrl', '@P1']
  }, async ({ page }) => {
    testLogger.info('Creating dashboard with all 3 panel types');

    const dashboardData = {
      version: 8,
      title: `MW Combined Test ${Date.now()}`,
      description: 'All multi-window panel types combined',
      folder_id: 'default',
      tabs: [{
        tabId: 'tab-1', name: 'Overview',
        panels: [
          makeMultiWindowPanelNoVrl('p_no_vrl'),
          makeMultiWindowPanelNonResultArrayVrl('p_simple_vrl'),
          makeMultiWindowPanelResultArrayVrl('p_result_array_vrl')
        ]
      }],
      variables: { list: [], showDynamicFilters: false }
    };

    const resp = await page.request.post(`${baseUrl}/api/${orgId}/dashboards`, {
      headers, data: dashboardData
    });

    expect([200, 201]).toContain(resp.status());
    const body = await resp.json();
    const dashboardId = body.v8.dashboardId;

    const getResp = await page.request.get(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    expect(getResp.status()).toBe(200);
    const saved = await getResp.json();
    const panels = saved.v8.tabs[0].panels;
    expect(panels).toHaveLength(3);

    // Every panel should have time_shift
    for (const panel of panels) {
      const ts = panel.queries[0].config.time_shift;
      expect(ts.length).toBeGreaterThanOrEqual(1);
    }

    // Cleanup
    await page.request.delete(`${baseUrl}/api/${orgId}/dashboards/${dashboardId}`, { headers });
    testLogger.info('Test completed');
  });
});

// ===========================================================================
// PART 2: _search_multi_stream with VRL functions
// ===========================================================================

test.describe('Search Multi-Stream VRL API tests', () => {
  let headers;
  let baseUrl;
  let orgId;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    headers = getAuthHeaders();
    baseUrl = process.env.ZO_BASE_URL.replace(/\/$/, '');
    orgId = getOrgIdentifier();
  });

  test('POST /_search_multi_stream - no VRL, per_query_response=true', {
    tag: ['@api', '@search', '@multiStream', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing multi-stream search without VRL');

    const endTime = Date.now() * 1000; // microseconds
    const startTime = endTime - (60 * 60 * 1000000); // 1 hour

    const resp = await page.request.post(
      `${baseUrl}/api/${orgId}/_search_multi_stream?type=logs&search_type=dashboards&use_cache=false&is_multi_stream_search=false`,
      {
        headers,
        data: {
          sql: [
            { sql: `SELECT count(_timestamp) as cnt FROM "${STREAM_NAME}"`, start_time: startTime, end_time: endTime },
            { sql: `SELECT count(_timestamp) as cnt FROM "${STREAM_NAME}"`, start_time: startTime - 3600000000, end_time: endTime - 3600000000 }
          ],
          start_time: startTime,
          end_time: endTime,
          from: 0, size: -1,
          quick_mode: false,
          per_query_response: true
        }
      }
    );

    if (resp.status() === 400) {
      const text = await resp.text();
      if (text.toLowerCase().includes('not found')) {
        test.skip();
        return;
      }
    }

    expect(resp.status()).toBe(200);
    const content = await resp.text();
    expect(content).toContain('[[DONE]]');

    const events = parseSSEEvents(content);
    const hitsEvents = events.filter(e => e.event === 'search_response_hits');
    const metadataEvents = events.filter(e => e.event === 'search_response_metadata');

    expect(metadataEvents).toHaveLength(2);
    expect(hitsEvents).toHaveLength(2);

    for (const { data } of hitsEvents) {
      expect(data).toHaveProperty('hits');
      expect(Array.isArray(data.hits)).toBeTruthy();
    }

    testLogger.info('Test completed');
  });

  test('POST /_search_multi_stream - non-ResultArray VRL adds field per hit', {
    tag: ['@api', '@search', '@multiStream', '@vrl', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing multi-stream search with non-ResultArray VRL');

    const endTime = Date.now() * 1000;
    const startTime = endTime - (60 * 60 * 1000000);
    const encodedVrl = base64Encode(NON_RESULT_ARRAY_VRL);

    const resp = await page.request.post(
      `${baseUrl}/api/${orgId}/_search_multi_stream?type=logs&search_type=dashboards&use_cache=false&is_multi_stream_search=false`,
      {
        headers,
        data: {
          sql: [
            { sql: `SELECT count(_timestamp) as cnt FROM "${STREAM_NAME}"`, start_time: startTime, end_time: endTime },
            { sql: `SELECT count(_timestamp) as cnt FROM "${STREAM_NAME}"`, start_time: startTime - 3600000000, end_time: endTime - 3600000000 }
          ],
          start_time: startTime,
          end_time: endTime,
          from: 0, size: -1,
          quick_mode: false,
          per_query_response: true,
          query_fn: encodedVrl,
          uses_zo_fn: true
        }
      }
    );

    if (resp.status() === 400) {
      const text = await resp.text();
      if (text.toLowerCase().includes('not found')) { test.skip(); return; }
    }

    expect(resp.status()).toBe(200);
    const content = await resp.text();
    expect(content).toContain('[[DONE]]');

    const events = parseSSEEvents(content);
    const hitsEvents = events.filter(e => e.event === 'search_response_hits');
    expect(hitsEvents).toHaveLength(2);

    // If first query has data, verify VRL field was added
    const firstHits = hitsEvents[0].data.hits;
    if (firstHits.length > 0) {
      expect(firstHits[0]).toHaveProperty('doubled_cnt');
      testLogger.info('Non-ResultArray VRL correctly added doubled_cnt field');
    } else {
      testLogger.info('No hits in first query — VRL field check skipped');
    }

    testLogger.info('Test completed');
  });

  test('POST /_search_multi_stream - ResultArray VRL computes diff across time windows', {
    tag: ['@api', '@search', '@multiStream', '@vrl', '@resultArray', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing multi-stream search with ResultArray VRL');

    const endTime = Date.now() * 1000;
    const startTime = endTime - (24 * 60 * 60 * 1000000); // 24 hours
    const encodedVrl = base64Encode(RESULT_ARRAY_VRL);

    const resp = await page.request.post(
      `${baseUrl}/api/${orgId}/_search_multi_stream?type=logs&search_type=dashboards&use_cache=false&is_multi_stream_search=false&fallback_order_by_col=diff`,
      {
        headers,
        data: {
          sql: [
            {
              sql: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
              start_time: startTime, end_time: endTime
            },
            {
              sql: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
              start_time: startTime - 3600000000, end_time: endTime - 3600000000
            }
          ],
          start_time: startTime,
          end_time: endTime,
          from: 0, size: -1,
          quick_mode: false,
          per_query_response: true,
          query_fn: encodedVrl,
          uses_zo_fn: true
        }
      }
    );

    if (resp.status() === 400) {
      const text = await resp.text();
      if (text.toLowerCase().includes('not found')) { test.skip(); return; }
    }

    expect(resp.status()).toBe(200);
    const content = await resp.text();
    expect(content).toContain('[[DONE]]');

    const events = parseSSEEvents(content);
    const hitsEvents = events.filter(e => e.event === 'search_response_hits');
    const metadataEvents = events.filter(e => e.event === 'search_response_metadata');

    // Should get exactly 2 hits arrays
    expect(hitsEvents).toHaveLength(2);
    expect(metadataEvents).toHaveLength(2);

    const firstHits = hitsEvents[0].data.hits;
    const secondHits = hitsEvents[1].data.hits;

    if (firstHits.length > 0) {
      // First array should contain exactly 1 object with diff and diff_percentage
      expect(firstHits).toHaveLength(1);
      expect(firstHits[0]).toHaveProperty('diff');
      expect(firstHits[0]).toHaveProperty('diff_percentage');
      expect(typeof firstHits[0].diff).toBe('number');
      expect(typeof firstHits[0].diff_percentage).toBe('number');
      testLogger.info(`ResultArray VRL: diff=${firstHits[0].diff}, diff_percentage=${firstHits[0].diff_percentage}`);
    } else {
      testLogger.info('First hits empty — VRL condition not met (possibly no data difference)');
    }

    // Second array should always be empty
    expect(secondHits).toEqual([]);

    testLogger.info('Test completed');
  });

  test('POST /_search_multi_stream - ResultArray VRL SSE response structure', {
    tag: ['@api', '@search', '@multiStream', '@vrl', '@contract', '@P1']
  }, async ({ page }) => {
    testLogger.info('Validating full SSE response structure');

    const endTime = Date.now() * 1000;
    const startTime = endTime - (24 * 60 * 60 * 1000000);
    const encodedVrl = base64Encode(RESULT_ARRAY_VRL);

    const resp = await page.request.post(
      `${baseUrl}/api/${orgId}/_search_multi_stream?type=logs&search_type=dashboards&use_cache=false&is_multi_stream_search=false&fallback_order_by_col=diff`,
      {
        headers,
        data: {
          sql: [
            {
              sql: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
              start_time: startTime, end_time: endTime
            },
            {
              sql: `SELECT histogram(_timestamp, '15 minutes') as time_s, count(_timestamp) as cnt FROM "${STREAM_NAME}" GROUP BY time_s ORDER BY time_s ASC`,
              start_time: startTime - 3600000000, end_time: endTime - 3600000000
            }
          ],
          start_time: startTime,
          end_time: endTime,
          from: 0, size: -1,
          quick_mode: false,
          per_query_response: true,
          query_fn: encodedVrl,
          uses_zo_fn: true
        }
      }
    );

    if (resp.status() === 400) {
      const text = await resp.text();
      if (text.toLowerCase().includes('not found')) { test.skip(); return; }
    }

    expect(resp.status()).toBe(200);
    const content = await resp.text();

    const events = parseSSEEvents(content);

    // Progress events
    const progressEvents = events.filter(e => e.event === 'progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    // [[DONE]] marker
    const doneEvents = events.filter(e => e.event === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(1);

    // Metadata events should have query_index 0 and 1
    const metadataEvents = events.filter(e => e.event === 'search_response_metadata');
    expect(metadataEvents).toHaveLength(2);

    const queryIndices = new Set(metadataEvents.map(e => e.data.results.query_index));
    expect(queryIndices).toEqual(new Set([0, 1]));

    for (const { data } of metadataEvents) {
      expect(data.results).toHaveProperty('took');
      expect(data.results).toHaveProperty('query_index');
    }

    testLogger.info('SSE response structure validation passed');
  });

  test('POST /_search_multi_stream - per_query_response=false with ResultArray VRL', {
    tag: ['@api', '@search', '@multiStream', '@vrl', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing per_query_response=false with ResultArray VRL');

    const endTime = Date.now() * 1000;
    const startTime = endTime - (60 * 60 * 1000000);
    const encodedVrl = base64Encode(RESULT_ARRAY_VRL);

    const resp = await page.request.post(
      `${baseUrl}/api/${orgId}/_search_multi_stream?type=logs&search_type=dashboards&use_cache=false&is_multi_stream_search=false`,
      {
        headers,
        data: {
          sql: [
            { sql: `SELECT count(_timestamp) as cnt FROM "${STREAM_NAME}"`, start_time: startTime, end_time: endTime }
          ],
          start_time: startTime,
          end_time: endTime,
          from: 0, size: -1,
          quick_mode: false,
          per_query_response: false,
          query_fn: encodedVrl,
          uses_zo_fn: true
        }
      }
    );

    if (resp.status() === 400) {
      const text = await resp.text();
      if (text.toLowerCase().includes('not found')) { test.skip(); return; }
    }

    // Should not error — VRL is set on individual queries when per_query_response=false
    expect(resp.status()).toBe(200);
    const content = await resp.text();
    expect(content).toContain('[[DONE]]');

    testLogger.info('Test completed');
  });
});
