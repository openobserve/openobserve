// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::meta::otlp::OtlpRequestType;
use opentelemetry_proto::tonic::collector::logs::v1::{
    ExportLogsServiceRequest, ExportLogsServiceResponse, logs_service_server::LogsService,
};
use tonic::{Response, Status};

use crate::handler::grpc::request::otlp::{error_status, export_reply, metadata_str, observe_ok};

#[derive(Default)]
pub struct LogsServer;

#[tonic::async_trait]
impl LogsService for LogsServer {
    async fn export(
        &self,
        request: tonic::Request<ExportLogsServiceRequest>,
    ) -> Result<tonic::Response<ExportLogsServiceResponse>, tonic::Status> {
        let start = std::time::Instant::now();
        let cfg = config::get_config();

        let metadata = request.metadata().clone();
        let msg = format!(
            "Please specify organization id with header key '{}' ",
            cfg.grpc.org_header_key
        );
        let Some(org_id) = metadata_str(&metadata, &cfg.grpc.org_header_key)? else {
            return Err(Status::invalid_argument(msg));
        };

        let in_req = request.into_inner();
        let in_stream_name = metadata_str(&metadata, &cfg.grpc.stream_header_key)?;
        let user_email = metadata_str(&metadata, "user_id")?.unwrap_or_default();

        let resp = openobserve_core::logs::otlp::handle_request(
            0,
            org_id,
            in_req,
            in_stream_name,
            user_email,
            OtlpRequestType::Grpc,
        )
        .await
        .map_err(|e| error_status(&e))?;
        let reply = export_reply(resp).await?;
        observe_ok("/otlp/v1/logs", start);
        Ok(Response::new(reply))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_logs_server_default() {
        let _server = LogsServer;
    }

    #[tokio::test]
    async fn test_non_ascii_metadata_is_invalid_argument() {
        let cfg = config::get_config();
        for key in [
            "user_id",
            cfg.grpc.stream_header_key.as_str(),
            cfg.grpc.org_header_key.as_str(),
        ] {
            let mut request = tonic::Request::new(ExportLogsServiceRequest::default());
            request.metadata_mut().insert(
                tonic::metadata::MetadataKey::from_bytes(cfg.grpc.org_header_key.as_bytes())
                    .unwrap(),
                "default".parse().unwrap(),
            );
            request.metadata_mut().insert(
                tonic::metadata::MetadataKey::from_bytes(key.as_bytes()).unwrap(),
                tonic::metadata::AsciiMetadataValue::try_from(b"\xff").unwrap(),
            );
            let status = LogsServer.export(request).await.unwrap_err();
            assert_eq!(status.code(), tonic::Code::InvalidArgument, "{key}");
        }
    }
}
