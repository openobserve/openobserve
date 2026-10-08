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

// Shared helpers for the Logs Auto Run specs (item 2): request classification, fixtures, stats.
const { getAuthHeaders } = require('./cloud-auth.js');

const MINUTE_US = 60 * 1_000_000;

function apiBase() {
  const url = process.env.INGESTION_URL || process.env.ZO_BASE_URL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Classifies a search request the way the spec defines it (§9): hits, histogram or page count. */
function classifySearch(request) {
  const url = request.url();
  if (request.method() !== 'POST' || !/\/_search(_multi)?_stream\b/.test(url)) return null;
  if (url.includes('is_ui_histogram=true')) return 'histogram';
  let body = {};
  try {
    body = JSON.parse(request.postData() || '{}');
  } catch {
    body = {};
  }
  // Single-stream requests wrap the query in {query:{…}}; multi-stream sends it directly.
  const query = body && typeof body.query === 'object' && !Array.isArray(body.query) ? body.query : body;
  if (query.size === 0 && query.track_total_hits) return 'pageCount';
  return 'hits';
}

/** Records every classified search request the page sends. */
function trackSearches(page) {
  const sent = [];
  page.on('request', (request) => {
    const type = classifySearch(request);
    if (!type) return;
    let sql = '';
    try {
      const body = JSON.parse(request.postData() || '{}');
      const query = body.query && typeof body.query === 'object' ? body.query : body;
      sql = typeof query.sql === 'string' ? query.sql : JSON.stringify(query.sql);
    } catch {
      sql = '';
    }
    sent.push({ type, url: request.url(), sql });
  });
  return {
    hits: () => sent.filter((r) => r.type === 'hits'),
    all: () => sent.slice(),
  };
}

async function ingestRows(request, org, stream, rows) {
  const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
  for (let i = 0; i < rows.length; i += 2000) {
    const response = await request.post(`${apiBase()}/api/${org}/${stream}/_json`, {
      headers,
      data: rows.slice(i, i + 2000),
    });
    if (!response.ok()) throw new Error(`ingest failed: ${response.status()} ${await response.text()}`);
  }
}

/** Polls /streams until the stream has persisted stats (needs short file retention and stats intervals). */
async function waitForStats(request, org, stream, timeoutMs = 180000) {
  const headers = getAuthHeaders();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request.get(`${apiBase()}/api/${org}/streams?type=logs`, { headers });
    if (response.ok()) {
      const body = await response.json();
      const entry = (body.list || []).find((s) => s.name === stream);
      if (entry && Number(entry.stats?.doc_time_max) > 0) return entry;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`no stats for ${org}/${stream} within ${timeoutMs} ms`);
}

/** The client estimate (P3) for a window ending now, in MB. */
function estimateMb(entry, windowUs, retentionDays = 0) {
  const now = Date.now() * 1000;
  const min = Number(entry.stats.doc_time_min);
  const max = Number(entry.stats.doc_time_max);
  const span = Math.max(1, Math.min(now, max) - min);
  const retention = retentionDays > 0 ? retentionDays * 24 * 60 * MINUTE_US : span;
  const rate = Number(entry.stats.storage_size) / Math.min(retention, span);
  const covered = Math.max(0, now - Math.max(now - windowUs, min));
  return rate * covered;
}

async function readConfig(request, org) {
  const response = await request.get(`${process.env.ZO_BASE_URL}/api/${org}/config`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok()) throw new Error(`config: ${response.status()}`);
  return response.json();
}

module.exports = {
  MINUTE_US,
  classifySearch,
  trackSearches,
  ingestRows,
  waitForStats,
  estimateMb,
  readConfig,
};
