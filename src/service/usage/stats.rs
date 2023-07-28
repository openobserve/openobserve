use crate::common::infra::dist_lock;
use crate::common::json;
use crate::common::meta::stats::Stats;
use crate::common::meta::usage::{UsageEvent, STATS_STREAM, USAGE_STREAM};
use crate::common::{
    infra::config::CONFIG,
    meta::{self, search::Request},
};
use once_cell::sync::Lazy;
use reqwest::Client;
use std::collections::HashMap;
use std::sync::Arc;

pub static CLIENT: Lazy<Arc<Client>> = Lazy::new(|| Arc::new(Client::new()));

pub async fn publish_stats() -> Result<(), anyhow::Error> {
    // get lock
    let mut locker = dist_lock::lock("/stats/publish_stats").await?;

    let last_query_ts = get_last_stats_time().await;
    let current_ts = chrono::Utc::now().timestamp_micros();

    let query = meta::search::Query {
        sql: format!("SELECT sum(num_records) as records ,sum(size) as original_size, org_id , stream_type  ,stream_name FROM \"{USAGE_STREAM}\" where _timestamp between {last_query_ts} and {current_ts} and event = \'{}\' group by  org_id , stream_type ,stream_name",UsageEvent::Ingestion),
        sql_mode: "full".to_owned(),
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
                        set_last_stats_time(current_ts).await?;
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
    // search done, release lock
    dist_lock::unlock(&mut locker).await?;
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

async fn get_last_stats_time() -> i64 {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/stats/last_updated";
    let value = match db.get(key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => String::from("0"),
    };
    let offset: i64 = value.parse().unwrap();
    offset
}

pub async fn set_last_stats_time(offset: i64) -> Result<(), anyhow::Error> {
    let db = &crate::common::infra::db::DEFAULT;
    let key = "/stats/last_updated";
    db.put(key, offset.to_string().into()).await?;
    Ok(())
}

fn _get_org_from_ep(usage_ep: String) -> String {
    let ep = usage_ep.strip_suffix('/').unwrap_or(&usage_ep);
    ep.split('/').last().unwrap_or("").to_owned()
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

#[cfg(test)]
mod test {
    use super::*;

    #[actix_web::test]
    async fn test_get_org_from_ep() {
        let res = _get_org_from_ep("http://localhost:5080/api/default/".to_string());
        assert_eq!(res, "default");

        let res = _get_org_from_ep("http://localhost:5080/api/default".to_string());
        assert_eq!(res, "default");
    }
}
