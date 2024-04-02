// Copyright 2023 Zinc Labs Inc.
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

use std::{collections::HashMap, sync::Arc};

use config::{
    cluster::LOCAL_NODE_UUID,
    meta::{
        stream::StreamType,
        usage::{Stats, UsageEvent, STATS_STREAM, USAGE_STREAM},
    },
    utils::json,
    CONFIG,
};
use infra::{db as infra_db, dist_lock};
use once_cell::sync::Lazy;
use reqwest::Client;

use super::ingestion_service;
use crate::{
    common::{
        infra::cluster::get_node_by_uuid,
        meta::{self, search::Request},
    },
    handler::grpc::cluster_rpc,
    service::{db, search as SearchService},
};

pub static CLIENT: Lazy<Arc<Client>> = Lazy::new(|| Arc::new(Client::new()));

pub async fn publish_stats() -> Result<(), anyhow::Error> {
    let mut orgs = db::schema::list_organizations_from_cache().await;
    orgs.retain(|org: &String| org != &CONFIG.common.usage_org);

    for org_id in orgs {
        // get the working node for the organization
        let (_offset, node) = get_last_stats_offset(&org_id).await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            log::debug!("[STATS] for organization {org_id} are being calculated by {node}");
            continue;
        }

        // get lock
        let locker = dist_lock::lock(&format!("/stats/publish_stats/org/{org_id}"), 0).await?;
        let (last_query_ts, node) = get_last_stats_offset(&org_id).await;
        if !node.is_empty() && LOCAL_NODE_UUID.ne(&node) && get_node_by_uuid(&node).await.is_some()
        {
            log::debug!("[STATS] for organization {org_id} are being calculated by {node}");
            dist_lock::unlock(&locker).await?;
            continue;
        }
        // set current node to lock the organization
        let ret = if !node.is_empty() || LOCAL_NODE_UUID.ne(&node) {
            set_last_stats_offset(&org_id, last_query_ts, Some(&LOCAL_NODE_UUID.clone())).await
        } else {
            Ok(())
        };
        // release lock
        dist_lock::unlock(&locker).await?;
        drop(locker);
        ret?;

        let current_ts = chrono::Utc::now().timestamp_micros();

        let sql = if CONFIG.common.usage_report_compressed_size {
            format!(
                "SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name ,min(min_ts) as min_ts , max(max_ts) as max_ts, sum(compressed_size) as compressed_size  FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' and org_id = \'{}\' group by  org_id , stream_type ,stream_name",
                UsageEvent::Ingestion,
                org_id
            )
        } else {
            format!(
                "SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' and org_id = \'{}\' group by  org_id , stream_type ,stream_name",
                UsageEvent::Ingestion,
                org_id
            )
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
            timeout: 0,
        };
        // do search
        match SearchService::search("", &CONFIG.common.usage_org, StreamType::Logs, &req).await {
            Ok(res) => {
                if !res.hits.is_empty() {
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
                            log::error!("report stats error: {:?} for {}", err, &org_id);
                        }
                    }
                } else {
                    log::info!(
                        "no stats between time: {} and {} for {}",
                        last_query_ts,
                        current_ts,
                        &org_id
                    );
                }
            }
            Err(err) => {
                log::error!("calculate stats error: {:?} for {}", err, &org_id);
            }
        }
    }
    Ok(())
}

async fn get_last_stats(
    org_id: &str,
    stats_ts: i64,
) -> std::result::Result<Vec<json::Value>, anyhow::Error> {
    let sql = if CONFIG.common.usage_report_compressed_size {
        format!(
            "SELECT records ,original_size, org_id , stream_type ,stream_name ,min_ts , max_ts, compressed_size FROM \"{STATS_STREAM}\" where _timestamp ={stats_ts} and org_id = \'{org_id}\'"
        )
    } else {
        format!(
            "SELECT records ,original_size, org_id , stream_type ,stream_name ,min_ts , max_ts FROM \"{STATS_STREAM}\" where _timestamp ={stats_ts} and org_id = \'{org_id}\'"
        )
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
        timeout: 0,
    };
    match SearchService::search("", &CONFIG.common.usage_org, StreamType::Logs, &req).await {
        Ok(res) => Ok(res.hits),
        Err(err) => match &err {
            infra::errors::Error::ErrorCode(infra::errors::ErrorCodes::SearchStreamNotFound(_)) => {
                Ok(vec![])
            }
            _ => Err(err.into()),
        },
    }
}

async fn report_stats(
    report_data: Vec<json::Value>,
    org_id: &str,
    last_query_ts: i64,
    curr_ts: i64,
) -> Result<(), anyhow::Error> {
    // get existing stats
    let existing_stats = get_last_stats(org_id, last_query_ts).await?;

    let mut report_data_map = to_map(report_data);

    let curr_data: Vec<&Stats> = if !existing_stats.is_empty() {
        let mut existing_stats_map = to_map(existing_stats);
        for (key, value) in report_data_map.iter_mut() {
            if let Some(existing_value) = existing_stats_map.remove(key) {
                value.records += existing_value.records;
                value.original_size += existing_value.original_size;
                value._timestamp = curr_ts;

                if !CONFIG.common.usage_report_compressed_size {
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

    let req = cluster_rpc::UsageRequest {
        stream_name: STATS_STREAM.to_owned(),
        data: Some(cluster_rpc::UsageData::from(report_data)),
    };

    match ingestion_service::ingest(&CONFIG.common.usage_org, req).await {
        Ok(_) => Ok(()),
        Err(err) => Err(err),
    }
}

async fn get_last_stats_offset(org_id: &str) -> (i64, String) {
    let db = infra_db::get_db().await;
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
    let db = infra_db::get_db().await;
    let val = if let Some(node) = node {
        format!("{};{}", offset, node)
    } else {
        offset.to_string()
    };
    let key = format!("/stats/last_updated/org/{org_id}");
    db.put(&key, val.into(), infra_db::NO_NEED_WATCH, None)
        .await?;
    Ok(())
}

pub async fn _set_cache_expiry(offset: i64) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = "/stats/cache_expiry".to_string();
    db.put(
        &key,
        offset.to_string().into(),
        infra_db::NO_NEED_WATCH,
        None,
    )
    .await?;
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
