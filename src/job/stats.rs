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

use tokio::time;

use crate::common::infra::cluster::is_compactor;
use crate::service;

pub async fn run() -> Result<(), anyhow::Error> {
    if !is_compactor(&super::cluster::LOCAL_NODE_ROLE) {
        return Ok(());
    }
    // should run it every 10 minutes
    let mut interval = time::interval(time::Duration::from_secs(600));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        let ret = service::usage::stats::publish_stats().await;
        if ret.is_err() {
            log::error!("[STATS] run error: {}", ret.err().unwrap());
        }
    }
}
