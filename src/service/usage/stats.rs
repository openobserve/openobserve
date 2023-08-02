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
use crate::service::db;

pub static CLIENT: Lazy<Arc<Client>> = Lazy::new(|| Arc::new(Client::new()));

pub async fn publish_stats() -> Result<(), anyhow::Error> {
    let orgs = db::schema::list_organizations_from_cache();

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

        let query = meta::search::Query {
            sql: format!("SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' group by  org_id , stream_type ,stream_name",UsageEvent::Ingestion),
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
        match get_stats_from_usage(req).await {
            Ok(response) => {
                //let res = response.json::<meta::search::Response>().await?;
                let temp = response.bytes().await?;
                let res: meta::search::Response = json::from_slice(&temp)?;

                if !res.hits.is_empty() {
                    match report_stats(res.hits, last_query_ts, current_ts).await {
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

async fn get_stats_from_usage(
    req: meta::search::Request,
) -> std::result::Result<reqwest::Response, reqwest::Error> {
    let usage_url = if CONFIG.common.usage_ep.ends_with('/') {
        format!("{}_search?type=logs", CONFIG.common.usage_ep)
    } else {
        format!("{}/_search?type=logs", CONFIG.common.usage_ep)
    };
    let url = url::Url::parse(&usage_url).unwrap();
    let cl = Arc::clone(&CLIENT);

    cl.post(url)
        .header("Content-Type", "application/json")
        .header(reqwest::header::AUTHORIZATION, &CONFIG.common.usage_auth)
        .json(&req)
        .send()
        .await
}

async fn get_last_stats(stats_ts: i64) -> std::result::Result<Vec<json::Value>, reqwest::Error> {
    let query = meta::search::Query {
        sql: format!("SELECT records ,original_size, org_id , stream_type ,stream_name FROM \"{STATS_STREAM}\" where _timestamp ={stats_ts}") ,
        sql_mode: "full".to_owned(),
        size: 100000000,
        ..Default::default()
    };

    let req: meta::search::Request = Request {
        query,
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    let usage_url = if CONFIG.common.usage_ep.ends_with('/') {
        format!("{}_search?type=logs", CONFIG.common.usage_ep)
    } else {
        format!("{}/_search?type=logs", CONFIG.common.usage_ep)
    };
    let url = url::Url::parse(&usage_url).unwrap();
    let cl = Arc::clone(&CLIENT);

    match cl
        .post(url)
        .header("Content-Type", "application/json")
        .header(reqwest::header::AUTHORIZATION, &CONFIG.common.usage_auth)
        .json(&req)
        .send()
        .await
    {
        Ok(response) => {
            let temp = response.bytes().await?;
            let res: meta::search::Response = json::from_slice(&temp).unwrap();
            Ok(res.hits)
        }
        Err(_) => todo!(),
    }
}

async fn report_stats(
    report_data: Vec<json::Value>,
    last_query_ts: i64,
    curr_ts: i64,
) -> Result<(), anyhow::Error> {
    //get existing stats
    let existing_stats = get_last_stats(last_query_ts).await?;

    let mut report_data_map = to_map(report_data);

    let final_data: Vec<&Stats> = if !existing_stats.is_empty() {
        let mut existing_stats_map = to_map(existing_stats);
        for (key, value) in report_data_map.iter_mut() {
            if let Some(existing_value) = existing_stats_map.remove(key) {
                value.records += existing_value.records;
                value.original_size += existing_value.original_size;
                value._timestamp = curr_ts;
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
            value._timestamp = curr_ts
        }
        report_data_map.values().collect()
    };

    let stats_url = if CONFIG.common.usage_ep.ends_with('/') {
        format!("{}{STATS_STREAM}/_json", CONFIG.common.usage_ep)
    } else {
        format!("{}/{STATS_STREAM}/_json", CONFIG.common.usage_ep)
    };
    let url = url::Url::parse(&stats_url).unwrap();
    let cl = Arc::clone(&CLIENT);

    match cl
        .post(url)
        .header("Content-Type", "application/json")
        .header(reqwest::header::AUTHORIZATION, &CONFIG.common.usage_auth)
        .json(&final_data)
        .send()
        .await
    {
        Ok(_) => {
            log::info!("report stats success");
            Ok(())
        }
        Err(err) => {
            log::error!("report stats error: {:?}", err);
            Err(err.into())
        }
    }
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
