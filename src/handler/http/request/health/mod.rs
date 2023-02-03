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

#[get("/healthz")]
pub async fn healthz() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(HealthzResponse {
        status: "ok".to_string(),
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
