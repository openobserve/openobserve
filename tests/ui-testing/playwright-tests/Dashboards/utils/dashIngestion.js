// ingestion.js
import logsdata from "../../../../test-data/logs_data.json";
import geoMapdata from "../../../../test-data/geo_map.json";
import dashboardChartJsonData from "../../../../test-data/dashboard_chart_json.json";
import sankeyData from "../../../../test-data/sankey_data.json";
import { ingestBase } from '../../utils/ingest-url.js';
// Fixed testLogger path - updated to use correct relative path
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier, refreshCloudConfig } = require('../../utils/cloud-auth.js');

// Streams this worker process has already loaded the fixture into.
const ingestedStreams = new Set();

// Exported function to remove UTF characters
const removeUTFCharacters = (text) => {
  // Remove UTF characters using regular expression
  return text.replace(/[^\x00-\x7F]/g, " ");
};

// Function to retrieve authentication token (to be implemented securely)
const getAuthToken = async () => {
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");
  return `Basic ${basicAuthCredentials}`;
};

// Shared by ingestion() and ingestionHighCardinality() so their retry, passcode-refresh and backoff rules cannot drift apart.
const postWithRetry = async (page, streamName, records, label) => {
  // Resolve headers/org per attempt so a refreshed passcode is picked up on retry.
  const post = () =>
    fetch(
      `${ingestBase(process.env.INGESTION_URL)}/api/${getOrgIdentifier()}/${streamName}/_json`,
      {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(records),
      }
    );

  const MAX_ATTEMPTS = 3;
  let fetchResponse;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fetchResponse = await post();
    } catch (networkError) {
      // A connect timeout / socket reset rejects before any status exists, so the
      // status-based retries below never see it and beforeEach dies on a blip.
      if (attempt === MAX_ATTEMPTS) throw networkError;
      testLogger.warn(
        `${label} request failed (${networkError.message}) — retrying (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }

    // The per-org cloud passcode can be rotated mid-session (another shard, or expiry).
    // The 401 leaves no data ingested and surfaces far away as "No dropdown options
    // appeared for stream", so refresh it from the page's live session and retry.
    if ((fetchResponse.status === 401 || fetchResponse.status === 403) && page) {
      testLogger.warn(
        `${label} returned ${fetchResponse.status} — refreshing cloud passcode and retrying`
      );
      if (await refreshCloudConfig(page)) continue;
    }

    // Transient upstream failure (e.g. "502 Proxy request failed") — payload and
    // credentials are fine, so back off briefly and retry rather than fail beforeEach.
    if (fetchResponse.status >= 500 && attempt < MAX_ATTEMPTS) {
      testLogger.warn(
        `${label} returned ${fetchResponse.status} — retrying (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      continue;
    }

    break;
  }
  return fetchResponse;
};

// `page` is used to recover a rotated cloud passcode via its live session (see below)
export const ingestion = async (page, streamName = "e2e_automate") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  // Every beforeEach re-posts this fixture, but the rows are identical and the org is
  // shared, so repeats add nothing observable while costing ~90 s of each test's
  // 180 s budget on cloud — enough on its own to time out the longer specs.
  const ingestKey = `${getOrgIdentifier()}:${streamName}`;
  if (ingestedStreams.has(ingestKey)) {
    return { skipped: true };
  }

  try {
    const fetchResponse = await postWithRetry(page, streamName, logsdata, "Ingestion");

    if (!fetchResponse.ok) {
      const body = await fetchResponse.text().catch(() => "");
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${body.slice(0, 200)}`
      );
    }

    ingestedStreams.add(ingestKey);
    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Ingestion failed", { error: error.message, cause: String(error.cause ?? '') });
    throw error;
  }
};

// No fixture has >100 distinct values, so this writes `count` distinct breakdown values to trip the 100-series cap.
export const ingestionHighCardinality = async (
  page,
  streamName,
  { breakdownField = "breakdown", measureField = "metric_value", count = 150 } = {},
) => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const nowUs = Date.now() * 1000;
  const records = [];
  for (let i = 0; i < count; i++) {
    records.push({
      [breakdownField]: `series-${i}`,
      [measureField]: i + 1,
      _timestamp: nowUs,
    });
  }

  const fetchResponse = await postWithRetry(page, streamName, records, "High-cardinality ingestion");

  if (!fetchResponse.ok) {
    const body = await fetchResponse.text().catch(() => "");
    throw new Error(
      `HTTP error! status: ${fetchResponse.status}, response: ${body.slice(0, 200)}`
    );
  }

  testLogger.info("High-cardinality stream ingested", {
    streamName,
    count,
    breakdownField,
  });
  return await fetchResponse.json();
};

// Runs this worker ingested, keyed by org:stream. Reused for 8 minutes, well inside a panel's default 15-minute range.
const logsPanelRuns = new Map();
const LOGS_PANEL_RUN_MAX_AGE_MS = 8 * 60 * 1000;
export const LOGS_PANEL_STREAM = "e2e_logs_panel";
export const LOGS_PANEL_LEVELS = ["info", "warn", "error", "debug"];
export const LOGS_PANEL_ROW_COUNT = 30;

// Seed rows tagged with one run_id so a spec's SQL only sees this ingestion. kind "row": seq 0 (newest) to 29, 1 s apart;
// kind "special" (older): XSS payloads (seq 100-102), a JSON message (103) and a 2,000-character line (104).
export const ingestionForLogsPanel = async (page, streamName = LOGS_PANEL_STREAM) => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }
  const key = `${getOrgIdentifier()}:${streamName}`;
  const cached = logsPanelRuns.get(key);
  if (cached && Date.now() - cached.baseMs < LOGS_PANEL_RUN_MAX_AGE_MS) return cached;

  const runId = `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const baseMs = Date.now() - 2000;
  const records = [];
  for (let seq = 0; seq < LOGS_PANEL_ROW_COUNT; seq++) {
    const ms = baseMs - seq * 1000;
    records.push({
      _timestamp: ms * 1000,
      run_id: runId,
      kind: "row",
      seq,
      level: LOGS_PANEL_LEVELS[seq % LOGS_PANEL_LEVELS.length],
      lvl: seq % 2 === 0 ? "err" : "warn",
      message: `logs-panel row ${seq}`,
      svc: `svc-${seq % 3}`,
      status: seq % 5 === 0 ? 500 : 200,
      ts_ms: ms,
      ts_ns: `${ms}000000`,
    });
  }
  const specials = [
    '<img src=x onerror="window.__lpXss=1">XSS-IMG',
    '"><svg onload="window.__lpXss=2">XSS-SVG',
    "<script>window.__lpXss=3</script>XSS-SCRIPT",
    '{"nested":{"a":1},"msg":"json in message"}',
    `LONG ${"x".repeat(2000)} END`,
  ];
  specials.forEach((message, i) => {
    records.push({
      _timestamp: (baseMs - (LOGS_PANEL_ROW_COUNT + 10 + i) * 1000) * 1000,
      run_id: runId,
      kind: "special",
      seq: 100 + i,
      level: "info",
      message,
    });
  });

  const fetchResponse = await postWithRetry(page, streamName, records, "Logs panel ingestion");
  if (!fetchResponse.ok) {
    const body = await fetchResponse.text().catch(() => "");
    throw new Error(`HTTP error! status: ${fetchResponse.status}, response: ${body.slice(0, 200)}`);
  }
  const run = { runId, baseMs };
  logsPanelRuns.set(key, run);
  testLogger.info("Logs panel stream ingested", { streamName, runId, rows: records.length });
  return run;
};

// SQL and expected values for the rows ingestionForLogsPanel writes.
export const logsPanelStarterSql = (stream = LOGS_PANEL_STREAM, order = "DESC") =>
  `SELECT * FROM "${stream}" ORDER BY _timestamp ${order} LIMIT 100`;
export const logsPanelRowsSql = (runId, { limit = 10, order = "DESC" } = {}) =>
  `SELECT * FROM "${LOGS_PANEL_STREAM}" WHERE run_id = '${runId}' AND kind = 'row' ORDER BY _timestamp ${order} LIMIT ${limit}`;
export const logsPanelSeqSql = (runId, seqs) =>
  `SELECT * FROM "${LOGS_PANEL_STREAM}" WHERE run_id = '${runId}' AND (${seqs.map((seq) => `seq = ${seq}`).join(" OR ")}) ORDER BY _timestamp DESC LIMIT 10`;
export const logsPanelNoRowsSql = () => `SELECT * FROM "${LOGS_PANEL_STREAM}" WHERE run_id = 'no_such_run' LIMIT 10`;
export const logsPanelInvalidSql = () => `SELEC * FRM "${LOGS_PANEL_STREAM}"`;
export const LOGS_PANEL_XSS_SEQS = [100, 101, 102];
export const LOGS_PANEL_LONG_SEQ = 104;
/** Messages of plain rows `from`..`to` in that order (either direction). */
export const logsPanelMessages = (from, to) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => `logs-panel row ${from <= to ? from + i : from - i}`);

// Dashboard maps ingestion

// Ingestion function for Geomap and Maps chart
const ingestionForMaps = async (page, streamName = "geojson") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

    const fetchResponse = await fetch(
      `${ingestBase(process.env.INGESTION_URL)}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(geoMapdata),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Ingestion failed", { error });
    throw error;
  }
};

// Ingestion function for Dashboard Chart JSON data
const ingestionForDashboardChartJson = async (page, streamName = "kubernetes") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

    const fetchResponse = await fetch(
      `${ingestBase(process.env.INGESTION_URL)}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(dashboardChartJsonData),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Dashboard Chart JSON ingestion failed", { error });
    throw error;
  }
};

// Ingestion function for Sankey chart data
const ingestionForSankey = async (streamName = "sankey_data") => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const orgId = getOrgIdentifier();

  try {
    const headers = getAuthHeaders();

    const fetchResponse = await fetch(
      `${ingestBase(process.env.INGESTION_URL)}/api/${orgId}/${streamName}/_json`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(sankeyData),
      }
    );

    if (!fetchResponse.ok) {
      throw new Error(
        `HTTP error! status: ${fetchResponse.status}, response: ${fetchResponse}`
      );
    }

    return await fetchResponse.json();
  } catch (error) {
    testLogger.error("Sankey data ingestion failed", { error });
    throw error;
  }
};

// Samples sit on step-aligned times with one constant state per host, so re-ingesting
// (e.g. from parallel tests) only adds samples at the same times and max(state_code) never changes.
export const ingestionForStateTimeline = async (
  page,
  streamName = "e2e_state_timeline",
  {
    hosts = [
      { host: "st-host-a", state_code: 1 },
      { host: "st-host-b", state_code: 3 },
    ],
    samples = 30,
    stepSeconds = 10,
  } = {},
) => {
  if (!process.env["INGESTION_URL"]) {
    throw new Error("Required environment variables are not set");
  }

  const stepMs = stepSeconds * 1000;
  const lastMs = Math.floor(Date.now() / stepMs) * stepMs - stepMs;
  const records = [];
  for (let i = 0; i < samples; i++) {
    const timestampUs = (lastMs - i * stepMs) * 1000;
    for (const { host, state_code } of hosts) {
      records.push({ host, state_code, _timestamp: timestampUs });
    }
  }

  const fetchResponse = await postWithRetry(page, streamName, records, "State timeline ingestion");
  if (!fetchResponse.ok) {
    const body = await fetchResponse.text().catch(() => "");
    throw new Error(
      `HTTP error! status: ${fetchResponse.status}, response: ${body.slice(0, 200)}`
    );
  }
  testLogger.info("State timeline data ingested", { streamName, records: records.length });
  return await fetchResponse.json();
};

// Export only the required functions
export { ingestionForMaps, ingestionForDashboardChartJson, ingestionForSankey, getAuthToken, removeUTFCharacters };
