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

use tokio::time;

use crate::common::infra::{
    cache::stats,
    cluster::{is_compactor, is_querier},
    config::CONFIG,
    file_list as infra_file_list,
};
use crate::service::{db, usage};

pub async fn run() -> Result<(), anyhow::Error> {
    tokio::task::spawn(async move { usage_report_stats().await });
    tokio::task::spawn(async move { file_list_stats().await });
    Ok(())
}

pub async fn usage_report_stats() -> Result<(), anyhow::Error> {
    if !is_compactor(&super::cluster::LOCAL_NODE_ROLE) || !CONFIG.common.usage_enabled {
        return Ok(());
    }

    // should run it every 10 minutes
    let mut interval = time::interval(time::Duration::from_secs(
        CONFIG.limit.calculate_stats_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = usage::stats::publish_stats().await;
        if ret.is_err() {
            log::error!("[STATS] run error: {}", ret.err().unwrap());
        }
    }
}

pub async fn file_list_stats() -> Result<(), anyhow::Error> {
    if !is_querier(&super::cluster::LOCAL_NODE_ROLE)
        || CONFIG.common.file_list_storage.starts_with("dynamo")
    {
        return Ok(());
    }

    // should run it every 10 minutes
    let mut interval = time::interval(time::Duration::from_secs(
        CONFIG.limit.calculate_stats_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let orgs = db::schema::list_organizations_from_cache();
        for org_id in orgs {
            let ret = infra_file_list::stats(&org_id, None, None).await;
            if ret.is_err() {
                log::error!("[STATS] run error: {}", ret.err().unwrap());
                continue;
            }
            for (stream, stats) in ret.unwrap() {
                let columns = stream.split('/').collect::<Vec<&str>>();
                let org_id = columns[0];
                let stream_type = columns[1];
                let stream_name = columns[2];
                stats::set_stream_stats(org_id, stream_name, stream_type.into(), stats);
            }
            time::sleep(time::Duration::from_secs(2)).await;
        }
    }
}
