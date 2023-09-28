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

use crate::common::infra::cluster;
use crate::service::db::file_list::{broadcast, local::BROADCAST_QUEUE};

pub async fn run() -> Result<(), anyhow::Error> {
    loop {
        if cluster::is_offline() {
            break;
        }
        time::sleep(time::Duration::from_secs(1)).await;
        let files = {
            let mut q = BROADCAST_QUEUE.write().await;
            if q.is_empty() {
                continue;
            }
            q.drain(..).collect::<Vec<_>>()
        };
        if let Err(e) = broadcast::send(&files, None).await {
            log::error!("[broadcast] local queue to nodes error: {}", e);
        }
    }
    log::info!("job::files::broadcast is stopped");
    Ok(())
}
