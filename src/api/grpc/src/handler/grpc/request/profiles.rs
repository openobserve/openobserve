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

use config::{meta::otlp::OtlpRequestType, metrics};
use ingestion_common::IngestUser;
use opentelemetry_proto::tonic::collector::profiles::v1development::{
    ExportProfilesServiceRequest, ExportProfilesServiceResponse,
    profiles_service_server::ProfilesService,
};
use tonic::{Response, Status};

use crate::service::profiles::{ProfilesExportError, handle_otlp_request};

fn export_error_to_status(err: ProfilesExportError) -> Status {
    match err {
        ProfilesExportError::TrialPeriodExpired(msg) => Status::resource_exhausted(msg),
        ProfilesExportError::Unavailable(msg) => Status::unavailable(msg),
        ProfilesExportError::Internal(err) => Status::internal(err.to_string()),
    }
}

#[derive(Default)]
pub struct ProfilesServer;

#[tonic::async_trait]
impl ProfilesService for ProfilesServer {
    async fn export(
        &self,
        request: tonic::Request<ExportProfilesServiceRequest>,
    ) -> Result<tonic::Response<ExportProfilesServiceResponse>, tonic::Status> {
        let start = std::time::Instant::now();
        let cfg = config::get_config();

        let metadata = request.metadata().clone();
        let msg = format!(
            "Please specify organization id with header key '{}' ",
            cfg.grpc.org_header_key
        );
        if !metadata.contains_key(&cfg.grpc.org_header_key) {
            return Err(Status::invalid_argument(msg));
        }

        let in_req = request.into_inner();
        let org_id = metadata.get(&cfg.grpc.org_header_key);
        if org_id.is_none() {
            return Err(Status::invalid_argument(msg));
        }

        let stream_name = metadata.get(&cfg.grpc.stream_header_key);
        let mut in_stream_name: Option<&str> = None;
        if let Some(stream_name) = stream_name {
            in_stream_name = Some(stream_name.to_str().unwrap());
        }

        let user_email = metadata
            .get("user_id")
            .and_then(|id| id.to_str().ok())
            .unwrap_or_else(|| {
                log::warn!("[gRPC Profiles] user_id not found in metadata, using empty string");
                ""
            });

        let user = IngestUser::from_user_email(user_email);

        match handle_otlp_request(
            org_id.unwrap().to_str().unwrap(),
            in_req,
            OtlpRequestType::Grpc,
            in_stream_name,
            user,
        )
        .await
        {
            Ok(res) => {
                let time = start.elapsed().as_secs_f64();
                metrics::GRPC_RESPONSE_TIME
                    .with_label_values(&["/otlp/v1/profiles", "200", "", "", "", ""])
                    .observe(time);
                metrics::GRPC_INCOMING_REQUESTS
                    .with_label_values(&["/otlp/v1/profiles", "200", "", "", "", ""])
                    .inc();
                Ok(Response::new(res))
            }
            Err(err) => {
                log::error!("[gRPC Profiles] handle_otlp_request err: {err}");
                Err(export_error_to_status(err))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profiles_server_default() {
        let _server = ProfilesServer;
    }

    #[test]
    fn export_error_to_status_does_not_ack_gate_failures() {
        let trial = export_error_to_status(ProfilesExportError::TrialPeriodExpired(
            "trial expired".to_string(),
        ));
        assert_eq!(trial.code(), tonic::Code::ResourceExhausted);
        assert_eq!(trial.message(), "trial expired");

        let unavailable = export_error_to_status(ProfilesExportError::Unavailable(
            "not an ingester".to_string(),
        ));
        assert_eq!(unavailable.code(), tonic::Code::Unavailable);
        assert_eq!(unavailable.message(), "not an ingester");

        let internal = export_error_to_status(ProfilesExportError::Internal(anyhow::anyhow!(
            "write failed"
        )));
        assert_eq!(internal.code(), tonic::Code::Internal);
        assert_eq!(internal.message(), "write failed");
    }
}
