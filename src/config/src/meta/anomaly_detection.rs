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

//! Column names the anomaly detector reads from a query's result rows, shared with the scheduler.

/// Timestamp column names a result row is read from, in priority order. `zo_sql_timestamp`
/// is the histogram alias the Logs page generates, so queries copied from there train as-is.
pub const TIMESTAMP_COLUMNS: [&str; 5] = [
    "_timestamp",
    "timestamp",
    "time",
    "time_bucket",
    "zo_sql_timestamp",
];

/// Value column names tried when a config declares none. Kept so configs created before
/// `value_column` existed keep resolving exactly as they did.
pub const LEGACY_VALUE_COLUMNS: [&str; 5] = ["value", "count", "_count", "metric", "result"];
