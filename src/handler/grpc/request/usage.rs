use async_trait::async_trait;
use tonic::{Request, Response, Status};

use crate::{
    common::{infra::config::CONFIG, json},
    handler::grpc::cluster_rpc::{usage_server::Usage, UsageRequest, UsageResponse},
};

#[derive(Debug, Default)]
pub struct UsageServerImpl;

#[async_trait]
impl Usage for UsageServerImpl {
    async fn report_usage(
        &self,
        request: Request<UsageRequest>,
    ) -> Result<Response<UsageResponse>, Status> {
        log::info!("UsageServer: report_usage");
        let metadata = request.metadata().clone();
        let req = request.into_inner();
        let report_to_stream = req.stream_name;
        let report_to_org_id = metadata.get(&CONFIG.grpc.org_header_key);

        match req.usage_list {
            Some(data) => {
                log::info!("UsageServer: report_usage received data");
                let in_data: Vec<json::Value> = data.into();
                let resp = crate::service::logs::json_wo_fn::ingest(
                    report_to_org_id.unwrap().to_str().unwrap(),
                    &report_to_stream,
                    in_data,
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
            None => {
                log::error!("UsageDataList: Err");
                let reply = UsageResponse {
                    status_code: 400,
                    message: "empty request body".to_string(),
                };
                Ok(Response::new(reply))
            }
        }
    }
}
