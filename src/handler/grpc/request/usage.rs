use tonic::{Request, Response, Status};

use crate::handler::grpc::cluster_rpc::{usage_server::Usage, EmptyResponse, UsageDataList};

#[derive(Debug, Default)]
pub struct UsageServer;

#[tonic::async_trait]
impl Usage for UsageServer {
    async fn report_usage(
        &self,
        request: Request<UsageDataList>,
    ) -> Result<Response<EmptyResponse>, Status> {
        println!("Received UsageDataList: {:?}", request.into_inner());
        let reply = EmptyResponse {};
        Ok(Response::new(reply))
    }
}
