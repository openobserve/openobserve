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
use serde_json::{json, Value};
use std::io::Error;

use crate::infra::{cache, cluster, config};

#[derive(Clone, Debug, Serialize)]
struct HealthzResponse {
    status: String,
}

#[derive(Clone, Debug, Serialize)]
struct ConfigResponse {
    version: String,
    commit: String,
    date: String,
    functions_enabled: bool,
}

#[get("/healthz")]
pub async fn healthz() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(HealthzResponse {
        status: "ok".to_string(),
    }))
}

#[get("/config")]
pub async fn zo_config() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(ConfigResponse {
        version: config::VERSION.to_string(),
        commit: config::COMMIT_HASH.to_string(),
        date: config::BUILD_DATE.to_string(),
        functions_enabled: config::HAS_FUNCTIONS,
    }))
}

#[get("/cache/status")]
pub async fn cache_status() -> Result<HttpResponse, Error> {
    let mut stats: AHashMap<&str, Value> = AHashMap::new();
    stats.insert("LOCAL_NODE_UUID", json!(cluster::LOCAL_NODE_UUID.clone()));
    stats.insert(
        "LOCAL_NODE_NAME",
        json!(&config::CONFIG.common.instance_name),
    );
    stats.insert("LOCAL_NODE_ROLE", json!(&config::CONFIG.common.node_role));
    stats.insert("NODES", json!(cluster::NODES.clone()));
    stats.insert("STREAM_TRANSFORMS", json!(config::STREAM_FUNCTIONS.clone()));
    stats.insert("QUERY_TRANSFORMS", json!(config::QUERY_FUNCTIONS.clone()));
    stats.insert("STREAM_STATS", json!({"stream_num": cache::stats::get_stream_stats_len(), "mem_size": cache::stats::get_stream_stats_in_memory_size()}));

    let (max_size, cur_size) = cache::file_data::stats();
    stats.insert(
        "FILE_DATA",
        json!({"memory_limit":max_size,"mem_size": cur_size}),
    );

    let (file_list_num, files_num, mem_size) = cache::file_list::get_file_num().unwrap();
    stats.insert(
        "FILE_LIST",
        json!({"file_list_num":file_list_num, "files_num":files_num, "mem_size":mem_size}),
    );

    Ok(HttpResponse::Ok().json(stats))
}
