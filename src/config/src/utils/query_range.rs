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

/// Get the default maximum query range in hours considering the stream setting max query range
/// and the environment variable ZO_DEFAULT_MAX_QUERY_RANGE_DAYS
pub fn get_default_max_query_range(stream_max_query_range: i64) -> i64 {
    let cfg = crate::get_config();
    let default_max_query_range = cfg.limit.default_max_query_range_days * 24;

    // This will allow the stream setting to override the global setting
    if stream_max_query_range > 0 {
        stream_max_query_range
    } else {
        default_max_query_range
    }
}
