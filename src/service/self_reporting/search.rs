// Copyright 2025 OpenObserve Inc.
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

use anyhow::{Result, anyhow};
use config::{
    META_ORG_ID, ider,
    meta::{
        cluster::RoleGroup,
        search::{
            Query, Request as SearchRequest, RequestEncoding, SearchEventType, default_use_cache,
        },
        stream::StreamType,
    },
    utils::json,
};

use crate::service::search as SearchService;

pub async fn get_usage(sql: String, start_time: i64, end_time: i64) -> Result<Vec<json::Value>> {
    let req = SearchRequest {
        query: Query {
            sql,
            from: 0,
            size: -1,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            action_id: None,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
        },
        encoding: RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: Some(SearchEventType::Other),
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
    };

    let trace_id = ider::uuid();
    let resp = SearchService::grpc_search::grpc_search(
        &trace_id,
        META_ORG_ID,
        StreamType::Logs,
        None,
        &req,
        Some(RoleGroup::Interactive),
    )
    .await?;

    if resp.is_partial {
        return Err(anyhow!(
            "Partial response: {}",
            resp.function_error.join(", ")
        ));
    }

    Ok(resp.hits)
}
