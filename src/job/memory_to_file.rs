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
use chrono::Utc;
use std::fs;
use std::time::Instant;
use tokio::time;

use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::infra::config::STREAMS_DATA;

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

        for item in STREAMS_DATA.iter() {
            let key = item.key();
            if key
                .as_str()
                .ends_with(Utc::now().timestamp().to_string().as_str())
            {
                continue;
            }
            let values = key.split('/').collect::<Vec<&str>>();
            let stream_data = item.value();
            match crate::service::logs::json::process_json_data(
                &values[2].to_string(),
                values[0],
                stream_data,
                web::Data::new(0),
                Instant::now(),
            )
            .await
            {
                Ok(_) => {
                    STREAMS_DATA.remove(key);
                }
                Err(e) => {
                    log::error!("Error consuming data from memory: {}", e);
                }
            }
        }
    }
}
