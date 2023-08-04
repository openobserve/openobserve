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
        let resp = crate::service::logs::json_no_fn::ingest(
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
