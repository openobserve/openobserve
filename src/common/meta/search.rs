// Copyright 2024 OpenObserve Inc.
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

use config::meta::search::Response;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct CachedQueryResponse {
    pub cached_response: Response,
    pub deltas: Vec<QueryDelta>,
    pub has_cached_data: bool,
    pub cache_query_response: bool,
    pub response_start_time: i64,
    pub response_end_time: i64,
    pub ts_column: String,
    pub is_descending: bool,
    pub limit: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct QueryDelta {
    pub delta_start_time: i64,
    pub delta_end_time: i64,
    pub delta_removed_hits: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct CacheQueryRequest {
    pub q_start_time: i64,
    pub q_end_time: i64,
    pub is_aggregate: bool,
    pub ts_column: String,
    pub discard_interval: i64,
    pub is_descending: bool,
}
