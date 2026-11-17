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

use config::{
    meta::{otlp::OtlpRequestType, stream::StreamType},
    metrics,
    utils::json,
};
use http::StatusCode;
use infra::errors::{Error, Result};
use ingestion_common::{IngestUser, SystemJobType};
use openobserve_core::ingestion::feature_writer::{self, FeatureWriter, WRITER_METADATA_KEY};
use proto::cluster_rpc::{
    IngestionRequest, IngestionResponse, IngestionType, ingest_server::Ingest,
};
use tonic::{Request, Response, Status};

use crate::{handler::grpc::auth::basic_password, service::ingestion::create_log_ingestion_req};

#[derive(Default)]
pub struct Ingester;

/// The ingest identity of a caller; a user credential never carries platform identity.
fn caller_identity(
    user_id: Option<&str>,
    ingestion_type: Option<i32>,
    is_derived: bool,
) -> std::result::Result<(IngestUser, bool), Status> {
    match user_id {
        None => Ok((
            IngestUser::SystemJob(SystemJobType::InternalGrpc),
            is_derived,
        )),
        // Usage marks platform self-reporting, which fail-closed redaction lets through unscanned.
        Some(_) if ingestion_type == Some(IngestionType::Usage as i32) => Err(
            Status::permission_denied("usage ingestion requires the internal cluster token"),
        ),
        Some(user_id) => Ok((IngestUser::from_user_email(user_id.to_string()), false)),
    }
}

/// The org a request writes to; a user credential only reaches the org check_auth verified it in.
fn destination_org(
    user_id: Option<&str>,
    header_org: Option<&str>,
    body_org: String,
) -> std::result::Result<String, Status> {
    if user_id.is_none() {
        return Ok(body_org);
    }
    let Some(header_org) = header_org else {
        return Err(Status::unauthenticated(
            "missing organization header for user-authenticated request",
        ));
    };
    if !body_org.is_empty() && body_org != header_org {
        return Err(Status::permission_denied(format!(
            "credentials for organization {header_org} cannot ingest into {body_org}"
        )));
    }
    Ok(header_org.to_string())
}

/// The feature writer `check_ingest_auth` marked the request with, if any.
fn feature_writer(request: &Request<IngestionRequest>) -> Result<Option<FeatureWriter>, Status> {
    let Some(value) = request.metadata().get(WRITER_METADATA_KEY) else {
        return Ok(None);
    };
    value
        .to_str()
        .ok()
        .and_then(FeatureWriter::from_token_name)
        .map(Some)
        .ok_or_else(|| Status::permission_denied("unknown feature writer"))
}

/// A writer token reaches only its own named streams, types and format, in its token's org.
fn writer_caller(
    writer: FeatureWriter,
    header_org: Option<&str>,
    req: &IngestionRequest,
) -> std::result::Result<(String, IngestUser, bool), Status> {
    let in_scope = header_org == Some(req.org_id.as_str())
        && writer.token_org(&req.org_id) == req.org_id
        && writer
            .stream_types()
            .contains(&StreamType::from(req.stream_type.as_str()))
        && req.ingestion_type == Some(writer.ingestion_type() as i32)
        && writer.allows(&req.stream_name);
    if !in_scope {
        return Err(Status::permission_denied(
            writer.out_of_scope_message(&req.stream_name),
        ));
    }
    Ok((
        req.org_id.clone(),
        IngestUser::SystemJob(writer.job()),
        false,
    ))
}

/// Where a request writes, as whom, and whether its rows are pipeline-derived.
fn resolve_caller(
    writer: Option<FeatureWriter>,
    user_id: Option<&str>,
    header_org: Option<&str>,
    req: &IngestionRequest,
) -> std::result::Result<(String, IngestUser, bool), Status> {
    if let Some(writer) = writer {
        return writer_caller(writer, header_org, req);
    }
    let org_id = destination_org(user_id, header_org, req.org_id.clone())?;
    let is_derived = req
        .metadata
        .as_ref()
        .and_then(|m| {
            m.data
                .get("is_derived")
                .and_then(|v| v.parse::<bool>().ok())
        })
        .unwrap_or(false);
    let (user, is_derived) = caller_identity(user_id, req.ingestion_type, is_derived)?;
    Ok((org_id, user, is_derived))
}

/// The interceptor trusted its cache; only the primary says whether a writer's token is still live.
async fn confirm_writer(
    writer: FeatureWriter,
    org_id: &str,
    token: Option<&str>,
) -> std::result::Result<(), Status> {
    let refused = || Status::unauthenticated("No valid auth token[8]");
    let token = token.ok_or_else(refused)?;
    match feature_writer::confirm(writer, org_id, token).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(refused()),
        Err(e) => Err(Status::unavailable(e.to_string())),
    }
}

/// A writer must learn of a failed storage write or refused rows; other Logs callers keep a 200.
fn writer_logs_reply(
    writer: Option<FeatureWriter>,
    resp: &ingestion_common::IngestionResponse,
) -> Option<IngestionResponse> {
    writer.map(|_| encode_logs_reply(resp))
}

#[tonic::async_trait]
impl Ingest for Ingester {
    async fn ingest(
        &self,
        request: Request<IngestionRequest>,
    ) -> Result<Response<IngestionResponse>, Status> {
        let start = std::time::Instant::now();
        // check_auth appends `user_id` only for user credentials; the internal token adds none.
        let user_id = request
            .metadata()
            .get_all("user_id")
            .iter()
            .next_back()
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let header_org = request
            .metadata()
            .get(&config::get_config().grpc.org_header_key)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let writer = feature_writer(&request)?;
        let writer_token = writer.and_then(|_| basic_password(request.metadata()));
        let req = request.into_inner();
        let (org_id, internal_user, is_derived) =
            resolve_caller(writer, user_id.as_deref(), header_org.as_deref(), &req)?;
        if let Some(writer) = writer {
            confirm_writer(writer, &org_id, writer_token.as_deref()).await?;
        }
        let stream_type: StreamType = req.stream_type.into();
        let stream_name = req.stream_name;
        let in_data = req.data.unwrap_or_default();

        let mut metrics_reply: Option<IngestionResponse> = None;
        let resp = match stream_type {
            StreamType::Logs => {
                let log_ingestion_type = req.ingestion_type.unwrap_or_default();
                let data = bytes::Bytes::from(in_data.data);
                match create_log_ingestion_req(log_ingestion_type, data) {
                    Err(e) => Err(e),
                    Ok(ingestion_req) => openobserve_core::logs::ingest::ingest(
                        0,
                        &org_id,
                        &stream_name,
                        ingestion_req,
                        internal_user.clone(),
                        None,
                        is_derived,
                    )
                    .await
                    .map(|resp| metrics_reply = writer_logs_reply(writer, &resp)),
                }
            }
            StreamType::Metrics => {
                let stream_name =  if stream_name.is_empty(){
                    None
                } else {
                    Some(stream_name.as_str())
                };
                let log_ingestion_type: IngestionType = req
                    .ingestion_type
                    .unwrap_or_default()
                    .try_into()
                    .unwrap_or(IngestionType::Multi); // multi is just place holder
                if log_ingestion_type != IngestionType::Json {
                    Err(Error::IngestionError(format!(
                        "Internal gPRC metric ingestion only supports json type data, got {log_ingestion_type:?}"
                    )))
                } else {
                    let data = bytes::Bytes::from(in_data.data);
                    openobserve_core::metrics::json::ingest(&org_id, stream_name, data, internal_user)
                        .await
                        .map(|resp| metrics_reply = Some(encode_metrics_reply(&resp)))
                        .map_err(|e| Error::IngestionError(format!("error in ingesting metrics {e}")))
                }
            }
            StreamType::Traces => {
                let log_ingestion_type: IngestionType = req
                    .ingestion_type
                    .unwrap_or_default()
                    .try_into()
                    .unwrap_or(IngestionType::Multi); // multi is just place holder
                if log_ingestion_type != IngestionType::Json {
                    Err(Error::IngestionError(format!(
                        "Internal gRPC trace ingestion only supports json type data, got {log_ingestion_type:?}"
                    )))
                } else {
                    let data = bytes::Bytes::from(in_data.data);
                    // internal ingestion does not require email id
                    match openobserve_core::traces::ingest_json(&org_id, data, OtlpRequestType::Grpc, &stream_name, internal_user).await {
                        Err(e) => Err(Error::IngestionError(format!("error in ingesting traces {e}"))),
                        // overload and write failures come back as an error status, not as Err
                        Ok(res) if !res.status().is_success() => Err(Error::IngestionError(format!(
                            "error in ingesting traces: http code {}",
                            res.status()
                        ))),
                        Ok(_) => Ok(()),
                    }
                }
            }
            StreamType::EnrichmentTables => {
                let append_data = match req.metadata {
                    Some(metadata) => metadata
                        .data
                        .get("append_data")
                        .and_then(|v| v.parse::<bool>().ok())
                        .unwrap_or(true),
                    None => true,
                };
                ingest_enrichment_records(&org_id, &stream_name, &in_data.data, append_data)
                    .await
            }
            StreamType::ServiceGraph => {
                // Service graph edges - use same pattern as Logs
                let log_ingestion_type = req.ingestion_type.unwrap_or_default();
                let data = bytes::Bytes::from(in_data.data);
                match create_log_ingestion_req(log_ingestion_type, data) {
                    Err(e) => Err(e),
                    // Only the DBM rollup reads this reply; the other ServiceGraph senders ignore it.
                    Ok(ingestion_req) => openobserve_core::logs::ingest::ingest(
                        0,
                        &org_id,
                        &stream_name,
                        ingestion_req,
                        internal_user,
                        None,
                        is_derived,
                    )
                    .await
                    .map(|resp| metrics_reply = Some(encode_logs_reply(&resp))),
                }
            }
            _ => Err(Error::IngestionError(
                "Internal gRPC ingestion service currently only supports Logs, Metrics, Traces, EnrichmentTables, and ServiceGraph"
                    .to_string(),
            )),
        };

        let reply = match resp {
            Ok(_) => metrics_reply.unwrap_or_else(ok_reply),
            Err(err) => IngestionResponse {
                status_code: 500,
                message: err.to_string(),
            },
        };

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/ingest/inner", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/ingest/inner", "200", "", "", "", ""])
            .inc();

        Ok(Response::new(reply))
    }
}

fn ok_reply() -> IngestionResponse {
    IngestionResponse {
        status_code: 200,
        message: "OK".to_string(),
    }
}

async fn ingest_enrichment_records(
    org_id: &str,
    stream_name: &str,
    data: &[u8],
    append_data: bool,
) -> Result<()> {
    let json_records = parse_enrichment_records(data)?;
    match enrichment_data::enrichment_table::save_enrichment_data(
        org_id,
        stream_name,
        json_records,
        append_data,
    )
    .await
    {
        Err(e) => Err(Error::IngestionError(format!(
            "Internal gPRC ingestion service errors saving enrichment data: {e}"
        ))),
        Ok(res) => {
            if res.status() != StatusCode::OK {
                let status: StatusCode = res.status();
                log::error!(
                    "Internal gPRC ingestion service errors saving enrichment data: code: {status}, body: {:?}",
                    res.into_body()
                );
                Err(Error::IngestionError(format!(
                    "Internal gPRC ingestion service errors saving enrichment data: http code {status}"
                )))
            } else {
                Ok(())
            }
        }
    }
}

fn parse_enrichment_records(data: &[u8]) -> Result<Vec<json::Map<String, json::Value>>> {
    if let Ok(records) = json::from_slice(data) {
        return Ok(records);
    }
    let values: Vec<json::Value> = json::from_slice(data)
        .map_err(|e| Error::IngestionError(format!("enrichment data must be a JSON array: {e}")))?;
    Ok(values
        .into_iter()
        .filter_map(|v| match v {
            json::Value::Object(map) => Some(map),
            _ => None,
        })
        .collect())
}

/// The proto has only `status_code` + `message`, so `207` carries the partial-failure JSON.
fn encode_metrics_reply(resp: &ingestion_common::IngestionResponse) -> IngestionResponse {
    if resp.code != 200 {
        return IngestionResponse {
            status_code: i32::from(resp.code),
            message: resp.error.clone().unwrap_or_default(),
        };
    }
    if resp.status.iter().any(|s| s.status.failed > 0) {
        return IngestionResponse {
            status_code: 207,
            message: json::to_string(resp).unwrap_or_default(),
        };
    }
    ok_reply()
}

/// A logs write reports a failed WAL write as `write_failed` under a 200, so map it to 500.
fn encode_logs_reply(resp: &ingestion_common::IngestionResponse) -> IngestionResponse {
    if resp.write_failed {
        return IngestionResponse {
            status_code: 500,
            message: "write to storage failed".to_string(),
        };
    }
    encode_metrics_reply(resp)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use ingestion_common::{RecordStatus, StreamStatus};
    use proto::cluster_rpc::{IngestRequestMetadata, IngestionData};

    use super::*;

    fn writer_req(
        org_id: &str,
        stream_type: StreamType,
        stream: &str,
        kind: IngestionType,
    ) -> IngestionRequest {
        IngestionRequest {
            org_id: org_id.to_string(),
            stream_type: stream_type.as_str().to_string(),
            stream_name: stream.to_string(),
            data: None,
            ingestion_type: Some(kind as i32),
            metadata: None,
        }
    }

    #[test]
    fn a_writer_token_reaches_only_its_own_stream() {
        let writer = Some(FeatureWriter::AlertCalibration);
        let digests = "_o2_alert_calibration_digests";
        let req = writer_req("demo-org", StreamType::Logs, digests, IngestionType::Json);
        let (org, user, derived) = resolve_caller(writer, None, Some("demo-org"), &req).unwrap();
        assert_eq!(org, "demo-org");
        assert_eq!(user, IngestUser::SystemJob(SystemJobType::AlertCalibration));
        assert!(!derived);

        let denied = [
            (
                "demo-org",
                "demo-org",
                StreamType::Logs,
                "default",
                IngestionType::Json,
            ),
            (
                "demo-org",
                "demo-org",
                StreamType::Logs,
                "_o2_autoobserve_health",
                IngestionType::Json,
            ),
            (
                "demo-org",
                "other-org",
                StreamType::Logs,
                digests,
                IngestionType::Json,
            ),
            (
                "demo-org",
                "demo-org",
                StreamType::Metrics,
                digests,
                IngestionType::Json,
            ),
            (
                "demo-org",
                "demo-org",
                StreamType::Logs,
                digests,
                IngestionType::Usage,
            ),
        ];
        for (header, body_org, stream_type, stream, kind) in denied {
            let req = writer_req(body_org, stream_type, stream, kind);
            let status = resolve_caller(writer, None, Some(header), &req).unwrap_err();
            assert_eq!(
                status.code(),
                tonic::Code::PermissionDenied,
                "{body_org} {stream} {kind:?}"
            );
        }
        let req = writer_req("demo-org", StreamType::Logs, digests, IngestionType::Json);
        assert!(resolve_caller(writer, None, None, &req).is_err());
    }

    #[test]
    fn the_service_signals_writer_reaches_its_named_log_and_metric_streams() {
        let writer = Some(FeatureWriter::ServiceSignals);
        let allowed = [
            (StreamType::Logs, "_o2_service_verdicts"),
            (StreamType::Metrics, "_o2_service_requests_total"),
        ];
        for (stream_type, stream) in allowed {
            let req = writer_req("demo-org", stream_type, stream, IngestionType::Json);
            let (org, user, _) = resolve_caller(writer, None, Some("demo-org"), &req).unwrap();
            assert_eq!(org, "demo-org");
            assert_eq!(user, IngestUser::SystemJob(SystemJobType::ServiceSignals));
        }
        let denied = [
            (StreamType::Metrics, ""),
            (StreamType::Metrics, "up"),
            (StreamType::Traces, "_o2_service_requests_total"),
        ];
        for (stream_type, stream) in denied {
            let req = writer_req("demo-org", stream_type, stream, IngestionType::Json);
            assert!(
                resolve_caller(writer, None, Some("demo-org"), &req).is_err(),
                "{stream}"
            );
        }
    }

    #[test]
    fn the_autoobserve_writer_reaches_only_autoobserve_streams_in_meta() {
        let writer = Some(FeatureWriter::AutoObserve);
        let meta = config::META_ORG_ID;
        for stream in [
            "_o2_autoobserve_health",
            "_o2_autoobserve_stream_silence_decisions",
        ] {
            let req = writer_req(meta, StreamType::Logs, stream, IngestionType::Usage);
            let (org, user, _) = resolve_caller(writer, None, Some(meta), &req).unwrap();
            assert_eq!(org, meta);
            assert_eq!(user, IngestUser::SystemJob(SystemJobType::AutoObserve));
        }
        let json = writer_req(
            meta,
            StreamType::Logs,
            "_o2_autoobserve_health",
            IngestionType::Json,
        );
        assert!(
            resolve_caller(writer, None, Some(meta), &json).is_err(),
            "AutoObserve rows are Usage rows"
        );
        let digests = writer_req(
            meta,
            StreamType::Logs,
            "_o2_alert_calibration_digests",
            IngestionType::Usage,
        );
        assert!(resolve_caller(writer, None, Some(meta), &digests).is_err());
        let elsewhere = writer_req(
            "demo-org",
            StreamType::Logs,
            "_o2_autoobserve_health",
            IngestionType::Usage,
        );
        assert!(resolve_caller(writer, None, Some("demo-org"), &elsewhere).is_err());
    }

    #[test]
    fn an_unknown_writer_mark_is_denied() {
        let mut request = Request::new(writer_req(
            "demo-org",
            StreamType::Logs,
            "x",
            IngestionType::Json,
        ));
        assert_eq!(feature_writer(&request).unwrap(), None);
        request
            .metadata_mut()
            .insert(WRITER_METADATA_KEY, "_o2_x".parse().unwrap());
        assert!(feature_writer(&request).is_err());
        request
            .metadata_mut()
            .insert(WRITER_METADATA_KEY, "_o2_autoobserve".parse().unwrap());
        assert_eq!(
            feature_writer(&request).unwrap(),
            Some(FeatureWriter::AutoObserve)
        );
    }

    #[test]
    fn a_writer_hears_of_a_failed_storage_write_or_refused_rows() {
        let writer = Some(FeatureWriter::AutoObserve);
        let failed = metrics_resp(200, 0, None).with_write_failed(true);
        assert_eq!(writer_logs_reply(writer, &failed).unwrap().status_code, 500);
        let refused = metrics_resp(200, 2, None);
        assert_eq!(
            writer_logs_reply(writer, &refused).unwrap().status_code,
            207
        );
        let clean = metrics_resp(200, 0, None);
        assert_eq!(writer_logs_reply(writer, &clean).unwrap().status_code, 200);
        assert!(writer_logs_reply(None, &failed).is_none());
    }

    async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    fn writer_request(org: &str, token: &str) -> Request<IngestionRequest> {
        let digests = "_o2_alert_calibration_digests";
        let mut request = Request::new(writer_req(
            org,
            StreamType::Logs,
            digests,
            IngestionType::Json,
        ));
        let basic =
            config::utils::base64::encode(&format!("alert_calibration@system.local:{token}"));
        let org_key = tonic::metadata::MetadataKey::from_bytes(
            config::get_config().grpc.org_header_key.as_bytes(),
        )
        .unwrap();
        let metadata = request.metadata_mut();
        metadata.insert("authorization", format!("Basic {basic}").parse().unwrap());
        metadata.insert(org_key, org.parse().unwrap());
        metadata.insert(
            WRITER_METADATA_KEY,
            "_o2_alert_calibration".parse().unwrap(),
        );
        request
    }

    #[tokio::test]
    async fn a_late_cache_insert_cannot_revive_a_disabled_or_rotated_writer_token() {
        use common::infra::config::ORG_INGESTION_TOKENS;
        meta_store().await;
        let org = format!("demo-org-late-{}", config::utils::time::now_micros());
        let name = "_o2_alert_calibration";
        feature_writer::token(FeatureWriter::AlertCalibration, &org)
            .await
            .unwrap();
        let old = db::org_ingestion_tokens::get_by_name(&org, name)
            .await
            .unwrap()
            .unwrap()
            .token;
        let key = db::org_ingestion_tokens::cache_key(&org, &old);
        openobserve_core::ingestion_tokens::set_enabled_token(&org, name, false)
            .await
            .unwrap();
        ORG_INGESTION_TOKENS.insert(key.clone(), name.to_string());
        let refused = Ingester
            .ingest(writer_request(&org, &old))
            .await
            .unwrap_err();
        assert_eq!(refused.code(), tonic::Code::Unauthenticated, "{refused}");
        assert!(
            !ORG_INGESTION_TOKENS.contains_key(&key),
            "a disabled token stayed cached"
        );

        openobserve_core::ingestion_tokens::set_enabled_token(&org, name, true)
            .await
            .unwrap();
        db::org_ingestion_tokens::rotate_token(&org, name)
            .await
            .unwrap();
        ORG_INGESTION_TOKENS.insert(key.clone(), name.to_string());
        let refused = Ingester
            .ingest(writer_request(&org, &old))
            .await
            .unwrap_err();
        assert_eq!(refused.code(), tonic::Code::Unauthenticated, "{refused}");
        assert!(
            !ORG_INGESTION_TOKENS.contains_key(&key),
            "a rotated-out token stayed cached"
        );
    }

    #[tokio::test]
    async fn the_handler_tells_a_writer_its_rows_were_refused() {
        meta_store().await;
        let org = format!("demo-org-reply-{}", config::utils::time::now_micros());
        feature_writer::token(FeatureWriter::AlertCalibration, &org)
            .await
            .unwrap();
        let token = db::org_ingestion_tokens::get_by_name(&org, "_o2_alert_calibration")
            .await
            .unwrap()
            .unwrap()
            .token;
        let mut request = writer_request(&org, &token);
        let rows = r#"[{"kind":"run"},{"kind":"old","_timestamp":1000000}]"#;
        request.get_mut().data = Some(IngestionData {
            data: rows.as_bytes().to_vec(),
        });
        let reply = Ingester.ingest(request).await.unwrap().into_inner();
        assert_eq!(reply.status_code, 207, "{}", reply.message);
    }

    #[test]
    fn test_caller_identity_keeps_platform_identity_for_the_internal_token_only() {
        let usage = Some(IngestionType::Usage as i32);
        let (user, derived) = caller_identity(None, usage, true).unwrap();
        assert!(matches!(
            user,
            IngestUser::SystemJob(SystemJobType::InternalGrpc)
        ));
        assert!(derived);

        let err = caller_identity(Some("a@b.c"), usage, false).unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);

        let json = Some(IngestionType::Json as i32);
        let (user, derived) = caller_identity(Some("a@b.c"), json, true).unwrap();
        assert!(matches!(user, IngestUser::User(ref email) if email == "a@b.c"));
        assert!(!derived, "a user cannot claim pipeline-derived routing");
    }

    #[test]
    fn destination_org_user_call_cannot_name_another_org() {
        let err = destination_org(Some("a@b.c"), Some("org_a"), "org_b".to_string()).unwrap_err();
        assert_eq!(err.code(), tonic::Code::PermissionDenied);
    }

    #[test]
    fn destination_org_user_call_writes_to_the_authenticated_org() {
        for body_org in ["org_a", ""] {
            let org = destination_org(Some("a@b.c"), Some("org_a"), body_org.to_string()).unwrap();
            assert_eq!(org, "org_a");
        }
    }

    #[test]
    fn destination_org_user_call_without_an_org_header_is_unauthenticated() {
        let err = destination_org(Some("a@b.c"), None, "org_b".to_string()).unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn destination_org_internal_token_keeps_the_body_org() {
        let org = destination_org(None, Some("org_a"), "org_b".to_string()).unwrap();
        assert_eq!(org, "org_b");
    }

    fn metrics_resp(
        code: u16,
        failed: u32,
        error: Option<&str>,
    ) -> ingestion_common::IngestionResponse {
        let mut resp = ingestion_common::IngestionResponse::new(
            code,
            vec![StreamStatus {
                name: "m".to_string(),
                status: RecordStatus {
                    successful: 1,
                    failed,
                    ..Default::default()
                },
                items: vec![],
            }],
        );
        resp.error = error.map(str::to_string);
        resp
    }

    #[test]
    fn test_parse_enrichment_records_object_array() {
        let records =
            parse_enrichment_records(br#"[{"id": 1}, {"id": 2, "nested": {"ok": true}}]"#).unwrap();
        assert_eq!(
            json::to_value(records).unwrap(),
            json::json!([
                {"id": 1}, {"id": 2, "nested": {"ok": true}}
            ])
        );
        assert!(parse_enrichment_records(b"[]").unwrap().is_empty());
    }

    #[test]
    fn test_parse_enrichment_records_mixed_array() {
        let records =
            parse_enrichment_records(br#"[null, {"id": 1}, 2, "text", false, [], {"id": 2}]"#)
                .unwrap();
        assert_eq!(
            json::to_value(records).unwrap(),
            json::json!([{"id": 1}, {"id": 2}])
        );
        assert!(
            parse_enrichment_records(b"[null, 1, false]")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_parse_enrichment_records_rejects_non_array() {
        for input in [&b"{}"[..], b"42", b"null", br#""x""#] {
            assert!(parse_enrichment_records(input).is_err());
        }
    }

    #[test]
    fn test_encode_metrics_reply_rejection_keeps_code() {
        let reply = encode_metrics_reply(&metrics_resp(503, 0, Some("blocked")));
        assert_eq!(reply.status_code, 503);
        assert_eq!(reply.message, "blocked");
        let reply = encode_metrics_reply(&metrics_resp(429, 0, None));
        assert_eq!(reply.status_code, 429);
        assert_eq!(reply.message, "");
    }

    #[test]
    fn test_encode_metrics_reply_partial_failure_is_207_with_body() {
        let reply = encode_metrics_reply(&metrics_resp(200, 2, None));
        assert_eq!(reply.status_code, 207);
        let body: ingestion_common::IngestionResponse = json::from_str(&reply.message).unwrap();
        assert_eq!(body.status[0].status.failed, 2);
    }

    // The rollup holds its offset on this reply; a bare `Ok(())` would report every failure as 200.
    #[test]
    fn test_service_graph_arm_returns_the_logs_reply() {
        let src = include_str!("ingest.rs");
        let arm = &src[src
            .find("StreamType::ServiceGraph =>")
            .expect("ServiceGraph arm")..];
        let arm = &arm[..arm.find("\n            _ =>").expect("arm end")];
        assert!(
            arm.contains(".map(|resp| metrics_reply = Some(encode_logs_reply(&resp)))"),
            "{arm}"
        );
    }

    #[test]
    fn test_encode_logs_reply_write_failed_is_500() {
        let resp = metrics_resp(200, 0, None).with_write_failed(true);
        assert_eq!(encode_logs_reply(&resp).status_code, 500);
    }

    #[test]
    fn test_encode_logs_reply_rejected_records_are_207() {
        let reply = encode_logs_reply(&metrics_resp(200, 3, None));
        assert_eq!(reply.status_code, 207);
        let body: ingestion_common::IngestionResponse = json::from_str(&reply.message).unwrap();
        assert_eq!(body.status[0].status.failed, 3);
    }

    #[test]
    fn test_encode_logs_reply_clean_and_skipped_are_200() {
        assert_eq!(
            encode_logs_reply(&metrics_resp(200, 0, None)).status_code,
            200
        );
        let skipped = metrics_resp(200, 0, None).with_stream_skipped(true);
        assert_eq!(encode_logs_reply(&skipped).status_code, 200);
    }

    #[test]
    fn test_encode_metrics_reply_success_is_200_ok() {
        let reply = encode_metrics_reply(&metrics_resp(200, 0, None));
        assert_eq!(reply.status_code, 200);
        assert_eq!(reply.message, "OK");
    }

    #[test]
    fn test_ingester_struct() {
        // Test that Ingester can be created
        let ingester = Ingester;
        // Ingester is a unit struct, so its size is 0
        assert_eq!(std::mem::size_of_val(&ingester), 0);
    }

    #[test]
    fn test_ingestion_request_creation() {
        // Test creating an IngestionRequest
        let request = IngestionRequest {
            org_id: "test_org".to_string(),
            stream_type: "logs".to_string(),
            stream_name: "test_stream".to_string(),
            data: Some(IngestionData {
                data: b"test data".to_vec(),
            }),
            ingestion_type: Some(IngestionType::Json as i32),
            metadata: Some(IngestRequestMetadata {
                data: HashMap::new(),
            }),
        };

        assert_eq!(request.org_id, "test_org");
        assert_eq!(request.stream_type, "logs");
        assert_eq!(request.stream_name, "test_stream");
        assert!(request.data.is_some_and(|d| d.data == b"test data"));
    }

    #[test]
    fn test_ingestion_response_creation() {
        // Test creating an IngestionResponse
        let success_response = IngestionResponse {
            status_code: 200,
            message: "OK".to_string(),
        };

        assert_eq!(success_response.status_code, 200);
        assert_eq!(success_response.message, "OK");

        let error_response = IngestionResponse {
            status_code: 500,
            message: "Error occurred".to_string(),
        };

        assert_eq!(error_response.status_code, 500);
        assert_eq!(error_response.message, "Error occurred");
    }

    #[test]
    fn test_ingestion_data_creation() {
        // Test creating IngestionData
        let data = IngestionData {
            data: b"test log data".to_vec(),
        };

        assert_eq!(data.data, b"test log data");
        assert_eq!(data.data.len(), 13);
    }

    #[test]
    fn test_ingestion_metadata_creation() {
        // Test creating IngestRequestMetadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("is_derived".to_string(), "true".to_string());
        metadata_map.insert("append_data".to_string(), "false".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };

        assert_eq!(metadata.data.len(), 2);
        assert_eq!(metadata.data.get("is_derived"), Some(&"true".to_string()));
        assert_eq!(metadata.data.get("append_data"), Some(&"false".to_string()));
    }

    #[test]
    fn test_stream_type_conversion() {
        // Test converting string stream types to StreamType enum
        let logs_type: StreamType = "logs".into();
        assert_eq!(logs_type, StreamType::Logs);

        let metrics_type: StreamType = "metrics".into();
        assert_eq!(metrics_type, StreamType::Metrics);

        let traces_type: StreamType = "traces".into();
        assert_eq!(traces_type, StreamType::Traces);

        let enrichment_type: StreamType = "enrichment_tables".into();
        assert_eq!(enrichment_type, StreamType::EnrichmentTables);
    }

    #[test]
    fn test_ingestion_type_enum() {
        // Test IngestionType enum values
        assert_eq!(IngestionType::Json as i32, 0);
        assert_eq!(IngestionType::Multi as i32, 1);
        assert_eq!(IngestionType::Gcp as i32, 2);
        assert_eq!(IngestionType::Kinesisfh as i32, 3);
        assert_eq!(IngestionType::Rum as i32, 4);
        assert_eq!(IngestionType::Usage as i32, 5);
    }

    #[test]
    fn test_is_derived_parsing() {
        // Test parsing is_derived from metadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("is_derived".to_string(), "true".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };
        let is_derived = metadata
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(is_derived);

        // Test with false value
        let mut metadata_map_false = HashMap::new();
        metadata_map_false.insert("is_derived".to_string(), "false".to_string());

        let metadata_false = IngestRequestMetadata {
            data: metadata_map_false,
        };
        let is_derived_false = metadata_false
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(!is_derived_false);

        // Test with missing key
        let empty_metadata = IngestRequestMetadata {
            data: HashMap::new(),
        };
        let is_derived_missing = empty_metadata
            .data
            .get("is_derived")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(false);

        assert!(!is_derived_missing);
    }

    #[test]
    fn test_append_data_parsing() {
        // Test parsing append_data from metadata
        let mut metadata_map = HashMap::new();
        metadata_map.insert("append_data".to_string(), "true".to_string());

        let metadata = IngestRequestMetadata { data: metadata_map };
        let append_data = metadata
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(append_data);

        // Test with false value
        let mut metadata_map_false = HashMap::new();
        metadata_map_false.insert("append_data".to_string(), "false".to_string());

        let metadata_false = IngestRequestMetadata {
            data: metadata_map_false,
        };
        let append_data_false = metadata_false
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(!append_data_false);

        // Test with missing key (defaults to true)
        let empty_metadata = IngestRequestMetadata {
            data: HashMap::new(),
        };
        let append_data_missing = empty_metadata
            .data
            .get("append_data")
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true);

        assert!(append_data_missing);
    }

    #[test]
    fn test_bytes_conversion() {
        // Test converting Vec<u8> to bytes::Bytes
        let data_vec = b"test data".to_vec();
        let bytes_data = bytes::Bytes::from(data_vec.clone());

        assert_eq!(bytes_data, data_vec);
        assert_eq!(bytes_data.len(), 9);
    }

    #[test]
    fn test_json_parsing_patterns() {
        // Test JSON parsing patterns used in the code
        let json_data = r#"[{"key": "value"}, {"another": "data"}]"#;
        let parsed: Result<Vec<json::Map<String, json::Value>>, _> =
            json::from_slice(json_data.as_bytes());

        assert!(parsed.is_ok());
        let result = parsed.unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0].get("key"),
            Some(&json::Value::String("value".to_string()))
        );
        assert_eq!(
            result[1].get("another"),
            Some(&json::Value::String("data".to_string()))
        );

        // Test fallback parsing for non-object arrays
        let mixed_json_data = r#"[{"key": "value"}, "string_value", 123]"#;
        let parsed_mixed: Result<Vec<json::Value>, _> =
            json::from_slice(mixed_json_data.as_bytes());
        assert!(parsed_mixed.is_ok());

        let mixed_result = parsed_mixed.unwrap();
        assert_eq!(mixed_result.len(), 3);
        assert!(matches!(mixed_result[0], json::Value::Object(_)));
        assert!(matches!(mixed_result[1], json::Value::String(_)));
        assert!(matches!(mixed_result[2], json::Value::Number(_)));
    }

    #[test]
    fn test_error_handling_patterns() {
        // Test error handling patterns used in the code
        let result: Result<(), Error> = Err(Error::IngestionError("test error".to_string()));

        match result {
            Ok(_) => panic!("Expected error"),
            Err(Error::IngestionError(msg)) => {
                assert_eq!(msg, "test error");
            }
            Err(_) => panic!("Expected IngestionError"),
        }
    }

    #[test]
    fn test_status_code_handling() {
        // Test status code handling patterns
        let success_status = StatusCode::OK;
        assert_eq!(success_status.as_u16(), 200);

        let error_status = StatusCode::INTERNAL_SERVER_ERROR;
        assert_eq!(error_status.as_u16(), 500);

        // Test status code comparison
        assert!(success_status != error_status);
        assert_eq!(success_status, StatusCode::OK);
    }

    #[test]
    fn test_ingestion_type_conversion() {
        // Test IngestionType conversion patterns
        let json_type = IngestionType::Json;
        let json_int: i32 = json_type as i32;
        assert_eq!(json_int, 0);

        let multi_type = IngestionType::Multi;
        let multi_int: i32 = multi_type as i32;
        assert_eq!(multi_int, 1);

        // Test try_into conversion
        let json_type_from_int: Result<IngestionType, _> = 0.try_into();
        assert!(json_type_from_int.is_ok());
        assert_eq!(json_type_from_int.unwrap(), IngestionType::Json);

        let invalid_type: Result<IngestionType, _> = 999.try_into();
        assert!(invalid_type.is_err());
    }

    #[test]
    fn test_otlp_request_type() {
        // Test OtlpRequestType enum
        assert_eq!(OtlpRequestType::Grpc as i32, 0);
        assert_eq!(OtlpRequestType::HttpJson as i32, 1);
        assert_eq!(OtlpRequestType::HttpProtobuf as i32, 2);
    }

    #[test]
    fn test_metrics_recording_patterns() {
        // Test metrics recording patterns used in the code
        let _time = 0.123f64;
        let path = "/ingest/inner";
        let status = "200";
        let org_id = "";
        let stream_type = "";
        let stream_name = "";

        // This test just ensures the metrics format is valid
        let metric_labels = [path, status, org_id, stream_type, stream_name, ""];
        assert_eq!(metric_labels.len(), 6);
        assert_eq!(metric_labels[0], "/ingest/inner");
        assert_eq!(metric_labels[1], "200");
    }

    #[test]
    fn test_logging_patterns() {
        // Test logging patterns used in the code
        let status: StatusCode = StatusCode::INTERNAL_SERVER_ERROR;
        let body = "error body";

        // This test just ensures the logging format is valid
        let log_message = format!(
            "Internal gPRC ingestion service errors saving enrichment data: code: {status}, body: {body:?}"
        );

        assert!(log_message.contains("Internal gPRC ingestion service errors"));
        assert!(log_message.contains("code: 500"));
        assert!(log_message.contains("body: \"error body\""));
    }

    #[test]
    fn test_stream_type_validation() {
        // Test stream type validation patterns
        let valid_stream_types = vec!["logs", "metrics", "traces", "enrichment_tables"];

        for stream_type in valid_stream_types {
            let converted: StreamType = stream_type.into();
            assert!(matches!(
                converted,
                StreamType::Logs
                    | StreamType::Metrics
                    | StreamType::Traces
                    | StreamType::EnrichmentTables
            ));
        }
    }

    #[test]
    fn test_ingestion_data_validation() {
        // Test ingestion data validation patterns
        let empty_data = IngestionData { data: vec![] };
        assert!(empty_data.data.is_empty());

        let non_empty_data = IngestionData {
            data: b"some data".to_vec(),
        };
        assert!(!non_empty_data.data.is_empty());
        assert_eq!(non_empty_data.data.len(), 9);
    }
}
