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

use anyhow::Result;
use config::{
    META_ORG_ID, ider,
    meta::{cluster::RoleGroup, stream::StreamType},
    utils::json,
};
pub use search::usage::get_license_usage_data_from_node;

use crate::search as SearchService;

pub async fn get_usage(
    sql: String,
    start_time: i64,
    end_time: i64,
    local: bool,
) -> Result<Vec<json::Value>> {
    let req = search::usage::request(sql, start_time, end_time, local);

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

    search::usage::into_hits(resp)
}
