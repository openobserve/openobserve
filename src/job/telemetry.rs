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

use crate::common::{infra::config::CONFIG, meta::telemetry::Telemetry};

pub async fn run() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(
        (CONFIG.limit.hb_interval * 60).try_into().unwrap(),
    ));
    interval.tick().await;
    loop {
        interval.tick().await;
        Telemetry::new()
            .heart_beat("OpenObserve - heartbeat", None)
            .await;
    }
}
