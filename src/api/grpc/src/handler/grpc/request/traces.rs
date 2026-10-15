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
use ingestion_common::IngestUser;
use opentelemetry_proto::tonic::collector::trace::v1::{
    ExportTraceServiceRequest, ExportTraceServiceResponse, trace_service_server::TraceService,
};
use tonic::{Response, Status};

use crate::{
    handler::grpc::request::otlp::{export_reply, metadata_str, observe_ok},
    service::traces::handle_otlp_request,
};

#[derive(Default)]
pub struct TraceServer;

#[tonic::async_trait]
impl TraceService for TraceServer {
    async fn export(
        &self,
        request: tonic::Request<ExportTraceServiceRequest>,
    ) -> Result<tonic::Response<ExportTraceServiceResponse>, tonic::Status> {
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

        let user_email = metadata
            .get("user_id")
            .and_then(|id| id.to_str().ok())
            .unwrap_or_else(|| {
                log::warn!("[gRPC Traces] user_id not found in metadata, using empty string");
                ""
            });

        let user = IngestUser::from_user_email(user_email);

        let resp = handle_otlp_request(org_id, in_req, OtlpRequestType::Grpc, in_stream_name, user)
            .await
            .map_err(|e| {
                log::error!("handle_trace_request err {e}");
                Status::internal(e.to_string())
            })?;
        let reply = export_reply(resp).await?;
        observe_ok("/otlp/v1/traces", start);
        Ok(Response::new(reply))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trace_server_default() {
        let _server = TraceServer;
    }

    #[tokio::test]
    async fn test_non_ascii_metadata_is_invalid_argument() {
        let cfg = config::get_config();
        for key in [
            cfg.grpc.stream_header_key.as_str(),
            cfg.grpc.org_header_key.as_str(),
        ] {
            let mut request = tonic::Request::new(ExportTraceServiceRequest::default());
            request.metadata_mut().insert(
                tonic::metadata::MetadataKey::from_bytes(cfg.grpc.org_header_key.as_bytes())
                    .unwrap(),
                "default".parse().unwrap(),
            );
            request.metadata_mut().insert(
                tonic::metadata::MetadataKey::from_bytes(key.as_bytes()).unwrap(),
                tonic::metadata::AsciiMetadataValue::try_from(b"\xff").unwrap(),
            );
            let status = TraceServer.export(request).await.unwrap_err();
            assert_eq!(status.code(), tonic::Code::InvalidArgument, "{key}");
        }
    }
}
