// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{get, HttpResponse};
use ahash::AHashMap;
use serde::Serialize;
use std::io::Error;
use utoipa::ToSchema;

use crate::common::json;
use crate::infra::config::{self, CONFIG};
use crate::infra::{cache, cluster};
use crate::meta::functions::ZoFunction;
use crate::service::search::datafusion::DEFAULT_FUNCTIONS;

#[derive(Serialize, ToSchema)]
pub struct HealthzResponse {
    status: String,
}

#[derive(Serialize)]
struct ConfigResponse<'a> {
    version: String,
    commit_hash: String,
    build_date: String,
    functions_enabled: bool,
    default_fts_keys: Vec<String>,
    telemetry_enabled: bool,
    default_functions: Vec<ZoFunction<'a>>,
}

/** healthz */
#[utoipa::path(
    path = "/healthz",
    tag = "Meta",
    responses(
        (status = 200, description="Staus OK", content_type = "application/json", body = HealthzResponse, example = json!({"status": "ok"}))
    )
)]
#[get("/healthz")]
pub async fn healthz() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(HealthzResponse {
        status: "ok".to_string(),
    }))
}

#[get("")]
pub async fn zo_config() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(ConfigResponse {
        version: config::VERSION.to_string(),
        commit_hash: config::COMMIT_HASH.to_string(),
        build_date: config::BUILD_DATE.to_string(),
        functions_enabled: config::HAS_FUNCTIONS,
        telemetry_enabled: CONFIG.common.telemetry_enabled,
        default_fts_keys: crate::common::stream::SQL_FULL_TEXT_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_functions: DEFAULT_FUNCTIONS.to_vec(),
    }))
}

#[get("/cache/status")]
pub async fn cache_status() -> Result<HttpResponse, Error> {
    let mut stats: AHashMap<&str, json::Value> = AHashMap::new();
    stats.insert(
        "LOCAL_NODE_UUID",
        json::json!(cluster::LOCAL_NODE_UUID.clone()),
    );
    stats.insert(
        "LOCAL_NODE_NAME",
        json::json!(&config::CONFIG.common.instance_name),
    );
    stats.insert(
        "LOCAL_NODE_ROLE",
        json::json!(&config::CONFIG.common.node_role),
    );
    stats.insert("NODES", json::json!(cluster::NODES.clone()));
    stats.insert(
        "STREAM_FUNCTIONS",
        json::json!(config::STREAM_FUNCTIONS.clone()),
    );
    stats.insert(
        "QUERY_FUNCTIONS",
        json::json!(config::QUERY_FUNCTIONS.clone()),
    );
    stats.insert("STREAM_STATS", json::json!({"stream_num": cache::stats::get_stream_stats_len(), "mem_size": cache::stats::get_stream_stats_in_memory_size()}));

    let (max_size, cur_size) = cache::file_data::stats();
    stats.insert(
        "FILE_DATA",
        json::json!({"memory_limit":max_size,"mem_size": cur_size}),
    );

    let (file_list_num, files_num, mem_size) = cache::file_list::get_file_num().unwrap();
    stats.insert(
        "FILE_LIST",
        json::json!({"file_list_num":file_list_num, "files_num":files_num, "mem_size":mem_size}),
    );

    Ok(HttpResponse::Ok().json(stats))
}
