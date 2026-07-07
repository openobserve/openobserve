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

// ---------------------------------------------------------------------------
// Shared µs-epoch window used throughout tests:
//   windowStart = 2026-01-01T00:00:00Z in µs
//   windowEnd   = 2026-01-01T01:00:00Z in µs  (1-hour span)
// ---------------------------------------------------------------------------
export const WINDOW_START_US = Date.UTC(2026, 0, 1, 0, 0, 0) * 1000; // µs
export const WINDOW_END_US = Date.UTC(2026, 0, 1, 1, 0, 0) * 1000; // µs

// A timestamp mid-window (30 min in) — used for deploy and "new" issues.
export const MID_WINDOW_US = Date.UTC(2026, 0, 1, 0, 30, 0) * 1000; // µs

// A timestamp just inside the window start — used for "ongoing" issues.
export const EARLY_WINDOW_US = Date.UTC(2026, 0, 1, 0, 1, 0) * 1000; // µs

// Histogram bucket ISO string used in histogram hits — aligned to 30-second
// interval (the interval returned by getTimeInterval for a 1-hour window).
// 2026-01-01T00:00:00 — first bucket (no timezone suffix, as OpenObserve returns)
export const HISTOGRAM_TS_STR = "2026-01-01T00:00:00";

// Schema that enables all optional fields.
export const FULL_SCHEMA: Record<string, boolean> = {
  error_type: true,
  error_message: true,
  error_handling: true,
  error_id: true,
  session_id: true,
  usr_id: true,
  service: true,
  view_url: true,
  version: true,
  error_stack: false,
  error_handling_stack: false,
};

// ---------------------------------------------------------------------------
// Issue hits (Q1 — buildIssuesSql)
// ---------------------------------------------------------------------------
export const MOCK_ISSUE_HITS = [
  {
    zo_sql_timestamp: WINDOW_END_US - 1000,
    first_seen: EARLY_WINDOW_US, // old — "ongoing" when no deploy is in window
    events: "42",
    users_affected: "7",
    sessions_affected: "5",
    error_type: "TypeError",
    error_message: "Cannot read properties of null",
    error_handling: "unhandled",
    latest_error_id: "err-001",
    service: "checkout",
    view_url: "https://example.com/checkout",
    session_id: "sess-001",
  },
  {
    zo_sql_timestamp: WINDOW_END_US - 2000,
    first_seen: MID_WINDOW_US, // mid-window — "new" when no deploy
    events: "10",
    users_affected: "3",
    sessions_affected: "3",
    error_type: "ReferenceError",
    error_message: "myVar is not defined",
    error_handling: "handled",
    latest_error_id: "err-002",
    service: "cart",
    view_url: "https://example.com/cart",
    session_id: "sess-002",
  },
];

// ---------------------------------------------------------------------------
// Histogram hits (Q2 — buildErrorsHistogramSql)
// ---------------------------------------------------------------------------
export const MOCK_HISTOGRAM_HITS = [
  {
    ts: HISTOGRAM_TS_STR,
    error_handling: "unhandled",
    events: 15,
  },
  {
    ts: HISTOGRAM_TS_STR,
    error_handling: "handled",
    events: 8,
  },
];

// ---------------------------------------------------------------------------
// KPI hit (Q3 — buildErrorKpisSql)
// ---------------------------------------------------------------------------
export const MOCK_KPI_HIT = {
  total_errors: "52",
  error_sessions: "10",
  users_affected: "8",
};

// ---------------------------------------------------------------------------
// Denominator hit (Q4b — buildDenominatorsSql)
// ---------------------------------------------------------------------------
export const MOCK_DENOMINATOR_HIT = {
  total_sessions: "200",
  total_users: "150",
};

// ---------------------------------------------------------------------------
// Deploy hits (Q5 — buildDeploysSql)
// ---------------------------------------------------------------------------
// A deploy whose first_seen is strictly inside the 1-h window (mid-window).
export const MOCK_DEPLOY_HITS_IN_WINDOW = [
  {
    version: "v2.0.0",
    first_seen: MID_WINDOW_US,
  },
];

// A deploy whose first_seen is at the window start — should NOT be picked
// (pickLatestDeploy requires > windowStart + bucketMicros).
export const MOCK_DEPLOY_HITS_AT_EDGE = [
  {
    version: "v1.0.0",
    first_seen: WINDOW_START_US,
  },
];

// ---------------------------------------------------------------------------
// Trend hits (Q3 — buildTrendsSql)
// One row per issue message in the first bucket.
// ---------------------------------------------------------------------------
export const MOCK_TREND_HITS = [
  {
    ts: HISTOGRAM_TS_STR,
    error_type: "TypeError",
    error_message: "Cannot read properties of null",
    error_handling: "unhandled",
    events: 10,
  },
  {
    ts: HISTOGRAM_TS_STR,
    error_type: "ReferenceError",
    error_message: "myVar is not defined",
    error_handling: "handled",
    events: 5,
  },
];
