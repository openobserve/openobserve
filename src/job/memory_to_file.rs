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

use actix_web::web;
use ahash::HashMap;
use ahash::HashMapExt;
use chrono::Utc;
use std::fs;
use std::time::Instant;
use tokio::time;

use crate::common::json;
use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::infra::config::STREAMS_DATA;
use crate::service::logs::json::process_json_data;

pub async fn run() -> Result<(), anyhow::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(()); // not an ingester, no need to init job
    }

    // create wal dir
    fs::create_dir_all(&CONFIG.common.data_wal_dir)?;

    let mut interval = time::interval(time::Duration::from_secs(
        CONFIG.common.memory_wal_ser_interval,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let mut grouped: HashMap<String, Vec<json::Value>> = HashMap::new();
        let mut to_remove: Vec<String> = vec![];
        for item in STREAMS_DATA.clone().iter() {
            let key = item.key();
            if key.ends_with(Utc::now().timestamp().to_string().as_str()) {
                continue;
            }

            let pos = key.rfind('/').unwrap();
            let stream_key = &key[0..pos];
            grouped
                .entry(stream_key.to_string())
                .or_default()
                .extend(item.value().to_owned().iter().cloned());
            to_remove.push(key.clone());
        }

        for (stream_key, items) in grouped.iter() {
            let stream_name = stream_key.split('/').last().unwrap();
            let org_id = stream_key.split('/').nth(1).unwrap();
            let start = Instant::now();
            for chunk in items.chunks(10000) {
                let thread_id = web::Data::new(0);
                let _ =
                    process_json_data(&org_id.to_string(), stream_name, chunk, thread_id, start)
                        .await;
            }
        }

        for key in to_remove {
            STREAMS_DATA.remove(&key);
        }
    }
}
