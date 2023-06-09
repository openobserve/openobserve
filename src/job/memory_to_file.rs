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
use std::time::Instant;

use crate::infra::config::LOGS_SENDER;
use crate::service::logs::json::process_json_data;

pub async fn run() -> Result<(), anyhow::Error> {
    let mut logs_receiver_rx = LOGS_SENDER.subscribe();
    while let Ok(val) = logs_receiver_rx.recv().await {
        tokio::task::spawn(async move {
            process_json_data(&val.1, &val.0, &val.2, web::Data::new(0), Instant::now())
                .await
                .unwrap();
        });
    }
    Ok(())
}
