use once_cell::sync::Lazy;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;

use crate::common::infra::cluster::{get_node_by_uuid, LOCAL_NODE_UUID};
use crate::common::infra::dist_lock;
use crate::common::json;
use crate::common::meta::stats::Stats;
use crate::common::meta::usage::{UsageEvent, STATS_STREAM, USAGE_STREAM};
use crate::common::{
    infra::config::CONFIG,
    meta::{self, search::Request},
};
use crate::handler::grpc::cluster_rpc::UsageDataList;
use crate::service::db;
use crate::service::search as SearchService;

use super::ingestion_service;

pub static CLIENT: Lazy<Arc<Client>> = Lazy::new(|| Arc::new(Client::new()));

pub async fn publish_stats() -> Result<(), anyhow::Error> {
    let mut orgs = db::schema::list_organizations_from_cache();

    orgs.retain(|org: &String| org != &CONFIG.common.usage_org);

    println!("orgs: {:?}", orgs);

    for org_id in orgs {
        // get the working node for the organization
        let (_offset, node) = get_last_stats_offset(&org_id).await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[STATS] organization {org_id} is being calculated by {node}");
            continue;
        }

        // get lock
        let mut locker = dist_lock::lock(&format!("/stats/publish_stats/org/{org_id}"), 0).await?;

        let (last_query_ts, node) = get_last_stats_offset(&org_id).await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).is_some() {
            log::error!("[STATS] organization {org_id} is being calculated by {node}");
            continue;
        }
        // release lock
        dist_lock::unlock(&mut locker).await?;
        drop(locker);
        let current_ts = chrono::Utc::now().timestamp_micros();

        let sql = if CONFIG.common.report_compressed_size {
            format!("SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name ,min(min_ts) as min_ts , max(max_ts) as max_ts, sum(compressed_size) as compressed_size  FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' and org_id = \'{}\' group by  org_id , stream_type ,stream_name",UsageEvent::Ingestion, org_id)
        } else {
            format!("SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' and org_id = \'{}\' group by  org_id , stream_type ,stream_name",UsageEvent::Ingestion, org_id)
        };

        let query = meta::search::Query {
            sql,
            sql_mode: "full".to_owned(),
            size: 100000000,
            ..Default::default()
        };

        let req: meta::search::Request = Request {
            query,
            aggs: HashMap::new(),
            encoding: meta::search::RequestEncoding::Empty,
        };
        // do search
        match SearchService::search(&CONFIG.common.usage_org, meta::StreamType::Logs, &req).await {
            Ok(res) => {
                if !res.hits.is_empty() {
                    println!("res: {:?}", res.hits);
                    match report_stats(res.hits, &org_id, last_query_ts, current_ts).await {
                        Ok(_) => {
                            log::info!("report stats success");
                            set_last_stats_offset(
                                &org_id,
                                current_ts,
                                Some(&LOCAL_NODE_UUID.clone()),
                            )
                            .await?;
                        }
                        Err(err) => {
                            log::error!("report stats error: {:?}", err);
                        }
                    }
                } else {
                    log::info!(
                        "no stats between time: {} and {}",
                        last_query_ts,
                        current_ts
                    );
                }
            }
            Err(err) => {
                log::error!("calculate stats error: {:?}", err);
            }
        }
    }
    Ok(())
}

async fn get_last_stats(
    org_id: &str,
    stats_ts: i64,
) -> std::result::Result<Vec<json::Value>, anyhow::Error> {
    let sql = if CONFIG.common.report_compressed_size {
        format!("SELECT records ,original_size, org_id , stream_type ,stream_name ,min_ts , max_ts, compressed_size FROM \"{STATS_STREAM}\" where _timestamp ={stats_ts} and org_id = \'{org_id}\'")
    } else {
        format!("SELECT records ,original_size, org_id , stream_type ,stream_name ,min_ts , max_ts FROM \"{STATS_STREAM}\" where _timestamp ={stats_ts} and org_id = \'{org_id}\'")
    };

    let query = meta::search::Query {
        sql,
        sql_mode: "full".to_owned(),
        size: 100000000,
        ..Default::default()
    };

    let req: meta::search::Request = Request {
        query,
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    match SearchService::search(&CONFIG.common.usage_org, meta::StreamType::Logs, &req).await {
        Ok(res) => Ok(res.hits),
        Err(err) => Err(err.into()),
    }
}

async fn report_stats(
    report_data: Vec<json::Value>,
    org_id: &str,
    last_query_ts: i64,
    curr_ts: i64,
) -> Result<(), anyhow::Error> {
    //get existing stats
    let existing_stats = get_last_stats(org_id, last_query_ts).await?;

    let mut report_data_map = to_map(report_data);

    let curr_data: Vec<&Stats> = if !existing_stats.is_empty() {
        let mut existing_stats_map = to_map(existing_stats);
        for (key, value) in report_data_map.iter_mut() {
            if let Some(existing_value) = existing_stats_map.remove(key) {
                value.records += existing_value.records;
                value.original_size += existing_value.original_size;
                value._timestamp = curr_ts;

                if !CONFIG.common.report_compressed_size {
                    if value.min_ts == 0 && existing_value.min_ts != 0 {
                        value.min_ts = existing_value.min_ts;
                    } else {
                        value.min_ts = curr_ts;
                    }
                    value.max_ts = curr_ts;
                } else {
                    if existing_value.min_ts != 0 && value.min_ts > existing_value.min_ts {
                        value.min_ts = existing_value.min_ts;
                    }
                    if value.max_ts < existing_value.max_ts {
                        value.max_ts = existing_value.max_ts;
                    }

                    if value.compressed_size.is_some() && existing_value.compressed_size.is_some() {
                        value.compressed_size = Some(
                            value.compressed_size.unwrap()
                                + existing_value.compressed_size.unwrap(),
                        );
                    }
                }
            } else {
                value._timestamp = curr_ts;
            }
        }
        // Add entries from existing_stats_map that aren't in report_data_map
        for (key, mut value) in existing_stats_map {
            value._timestamp = curr_ts;
            report_data_map.entry(key).or_insert(value);
        }
        report_data_map.values().collect()
    } else {
        for (_, value) in report_data_map.iter_mut() {
            value._timestamp = curr_ts;
            value.min_ts = curr_ts;
            value.max_ts = curr_ts;
        }
        report_data_map.values().collect()
    };

    let report_data: Vec<json::Value> = curr_data
        .iter()
        .map(|s| serde_json::to_value(s).unwrap())
        .collect();

    let req = crate::handler::grpc::cluster_rpc::UsageRequest {
        usage_list: Some(UsageDataList::from(report_data)),
        stream_name: STATS_STREAM.to_owned(),
    };

    let _ = ingestion_service::ingest(&CONFIG.common.usage_org, req).await;
    Ok(())
}

async fn get_last_stats_offset(org_id: &str) -> (i64, String) {
    let db = &crate::common::infra::db::DEFAULT;
    let key = format!("/stats/last_updated/org/{org_id}");
    let value = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    if value.contains(';') {
        let mut parts = value.split(';');
        let offset: i64 = parts.next().unwrap().parse().unwrap();
        let node = parts.next().unwrap().to_string();
        (offset, node)
    } else {
        (value.parse().unwrap(), String::from(""))
    }
}

pub async fn set_last_stats_offset(
    org_id: &str,
    offset: i64,
    node: Option<&str>,
) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    let key = format!("/stats/last_updated/org/{org_id}");
    db.put(&key, val.into()).await?;
    Ok(())
}

fn to_map(data: Vec<json::Value>) -> HashMap<String, Stats> {
    let mut map = HashMap::new();
    for item in data {
        let stats: Stats = json::from_value(item).unwrap();
        let key = format!(
            "{}/{}/{}",
            stats.org_id, stats.stream_type, stats.stream_name
        );
        map.insert(key, stats);
    }
    map
}
