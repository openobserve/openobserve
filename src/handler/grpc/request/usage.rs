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

use async_trait::async_trait;
use tonic::{Request, Response, Status};

use crate::common::infra::config::CONFIG;
use crate::handler::grpc::cluster_rpc::{usage_server::Usage, UsageRequest, UsageResponse};

#[derive(Debug, Default)]
pub struct UsageServerImpl;

#[async_trait]
impl Usage for UsageServerImpl {
    async fn report_usage(
        &self,
        request: Request<UsageRequest>,
    ) -> Result<Response<UsageResponse>, Status> {
        let metadata = request.metadata().clone();
        let req = request.into_inner();
        let report_to_stream = req.stream_name;
        let report_to_org_id = metadata.get(&CONFIG.grpc.org_header_key);
        let in_data = req.data.unwrap_or_default();
        log::info!("UsageServer: report_usage received data");
        let resp = crate::service::logs::otlp_grpc::ingest(
            report_to_org_id.unwrap().to_str().unwrap(),
            &report_to_stream,
            in_data.data.into(),
            0_usize,
        )
        .await;

        match resp {
            Ok(_) => {
                let reply = UsageResponse {
                    status_code: 200,
                    message: "OK".to_string(),
                };
                Ok(Response::new(reply))
            }
            Err(err) => {
                let reply = UsageResponse {
                    status_code: 500,
                    message: err.to_string(),
                };
                Ok(Response::new(reply))
            }
        }
    }
}
