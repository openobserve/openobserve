// Copyright 2023 Zinc Labs Inc.
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
use ahash::AHashMap as HashMap;
use datafusion::arrow::datatypes::{Field, Schema};
use serde::Serialize;
use std::io::Error;
use utoipa::ToSchema;

use crate::common::{
    infra::{cache, cluster, config::*, file_list},
    meta::functions::ZoFunction,
    utils::json,
};
use crate::service::{db, search::datafusion::DEFAULT_FUNCTIONS};

#[derive(Serialize, ToSchema)]
pub struct HealthzResponse {
    status: String,
}

#[derive(Serialize)]
struct ConfigResponse<'a> {
    version: String,
    instance: String,
    commit_hash: String,
    build_date: String,
    functions_enabled: bool,
    default_fts_keys: Vec<String>,
    telemetry_enabled: bool,
    default_functions: Vec<ZoFunction<'a>>,
    lua_fn_enabled: bool,
    sql_base64_enabled: bool,
    timestamp_column: String,
    syslog_enabled: bool,
    data_retention_days: i64,
}

/** Healthz */
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
        version: VERSION.to_string(),
        instance: INSTANCE_ID.get("instance_id").unwrap().to_string(),
        commit_hash: COMMIT_HASH.to_string(),
        build_date: BUILD_DATE.to_string(),
        functions_enabled: HAS_FUNCTIONS,
        telemetry_enabled: CONFIG.common.telemetry_enabled,
        default_fts_keys: SQL_FULL_TEXT_SEARCH_FIELDS_EXTRA
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_functions: DEFAULT_FUNCTIONS.to_vec(),
        lua_fn_enabled: false,
        sql_base64_enabled: CONFIG.common.ui_sql_base64_enabled,
        timestamp_column: CONFIG.common.column_timestamp.clone(),
        syslog_enabled: *SYSLOG_ENABLED.read(),
        data_retention_days: CONFIG.compact.data_retention_days,
    }))
}

#[get("/cache/status")]
pub async fn cache_status() -> Result<HttpResponse, Error> {
    let mut stats: HashMap<&str, json::Value> = HashMap::default();
    stats.insert(
        "LOCAL_NODE_UUID",
        json::json!(cluster::LOCAL_NODE_UUID.clone()),
    );
    stats.insert("LOCAL_NODE_NAME", json::json!(&CONFIG.common.instance_name));
    stats.insert("LOCAL_NODE_ROLE", json::json!(&CONFIG.common.node_role));
    let nodes = cluster::get_cached_online_nodes();
    stats.insert("NODE_LIST", json::json!(nodes));

    let (stream_num, stream_schema_num, mem_size) = get_stream_schema_status();
    stats.insert("STREAM_SCHEMA", json::json!({"stream_num": stream_num,"stream_schema_num": stream_schema_num, "mem_size": mem_size}));

    let stream_num = cache::stats::get_stream_stats_len();
    let mem_size = cache::stats::get_stream_stats_in_memory_size();
    stats.insert(
        "STREAM_STATS",
        json::json!({"stream_num": stream_num, "mem_size": mem_size}),
    );

    let mem_file_num = cache::file_data::memory::len().await;
    let (mem_max_size, mem_cur_size) = cache::file_data::memory::stats().await;
    let disk_file_num = cache::file_data::disk::len().await;
    let (disk_max_size, disk_cur_size) = cache::file_data::disk::stats().await;
    stats.insert(
        "FILE_DATA",
        json::json!({
            "memory":{"cache_files":mem_file_num, "cache_limit":mem_max_size,"cache_bytes": mem_cur_size},
            "disk":{"cache_files":disk_file_num, "cache_limit":disk_max_size,"cache_bytes": disk_cur_size}
        }),
    );

    let file_list_num = file_list::len().await;
    stats.insert("FILE_LIST", json::json!({"num":file_list_num}));

    let tmpfs_mem_size = cache::tmpfs::stats().unwrap();
    stats.insert("TMPFS", json::json!({ "mem_size": tmpfs_mem_size }));

    let last_file_list_offset = db::compact::file_list::get_offset().await.unwrap();
    stats.insert(
        "COMPACT",
        json::json!({"file_list_offset": last_file_list_offset}),
    );

    Ok(HttpResponse::Ok().json(stats))
}

fn get_stream_schema_status() -> (usize, usize, usize) {
    let mut stream_num = 0;
    let mut stream_schema_num = 0;
    let mut mem_size = 0;
    for item in STREAM_SCHEMAS.iter() {
        stream_num += 1;
        mem_size += std::mem::size_of::<Vec<Schema>>();
        mem_size += item.key().len();
        for schema in item.value().iter() {
            stream_schema_num += 1;
            for (key, val) in schema.metadata.iter() {
                mem_size += std::mem::size_of::<HashMap<String, String>>();
                mem_size += key.len() + val.len();
            }
            mem_size += std::mem::size_of::<Vec<Field>>();
            for field in schema.fields() {
                mem_size += std::mem::size_of::<Field>();
                mem_size += field.name().len();
            }
        }
    }
    (stream_num, stream_schema_num, mem_size)
}
