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

//! Writes accepted change events to `_o2_change_events` with the org's change-events writer token.

use config::{
    meta::{
        alerts::change_events::{CHANGE_EVENTS_STREAM, RETENTION_DAYS},
        stream::StreamType,
    },
    utils::json::Value,
};

use crate::ingestion::feature_writer::{
    self, FeatureWriter, GrpcTransport, WriteError, WriterToken, WriterTokenError, WriterTransport,
    seed_retention_settings,
};

/// Why accepted events were not stored.
#[derive(Debug, thiserror::Error)]
pub enum ChangeWriteError {
    /// An admin disabled the writer token; the events stay out until it is enabled.
    #[error("{0}")]
    Disabled(String),
    /// The ingester has not seen the new token yet; a retry succeeds.
    #[error("{0}")]
    NotReady(String),
    #[error("{0}")]
    Failed(String),
}

impl From<WriterTokenError> for ChangeWriteError {
    fn from(e: WriterTokenError) -> Self {
        match e {
            WriterTokenError::Revoked(_) | WriterTokenError::Foreign(_) => {
                Self::Disabled(e.to_string())
            }
            WriterTokenError::Store(_) => Self::Failed(e.to_string()),
        }
    }
}

impl From<WriteError> for ChangeWriteError {
    fn from(e: WriteError) -> Self {
        match e {
            WriteError::NotReady(_) => Self::NotReady(e.to_string()),
            WriteError::OutOfScope(_) | WriteError::Failed(_) => Self::Failed(e.to_string()),
        }
    }
}

/// Stores `records` in the org's `_o2_change_events`, then gives a new stream its retention.
pub async fn write_events(org: &str, records: Vec<Value>) -> Result<(), ChangeWriteError> {
    let token = feature_writer::token(FeatureWriter::ChangeEvents, org).await?;
    write_with(&GrpcTransport, &token, records).await?;
    settle_retention(org).await;
    Ok(())
}

async fn write_with(
    transport: &dyn WriterTransport,
    token: &WriterToken,
    records: Vec<Value>,
) -> Result<(), ChangeWriteError> {
    let data = Value::Array(records).to_string().into_bytes();
    feature_writer::write(transport, token, CHANGE_EVENTS_STREAM, data).await?;
    Ok(())
}

// The settings cache decides, not a node-local flag: deleting the stream drops its settings.
// A failed seed never fails the request: the rows are stored, and the next write retries it.
async fn settle_retention(org: &str) {
    let key = format!("{org}/{}/{CHANGE_EVENTS_STREAM}", StreamType::Logs);
    let default = config::get_config().compact.data_retention_days;
    let cached = infra::schema::get_stream_settings_atomic(&key);
    if cached.is_some_and(|s| !seed_retention_settings(&mut (*s).clone(), RETENTION_DAYS, default))
    {
        return;
    }
    if let Err(e) = seed_retention(org).await {
        log::warn!("[change_events] could not seed the retention of {org}: {e}");
    }
}

/// Seeds the retention once the stream exists, unless the operator set one.
async fn seed_retention(org: &str) -> anyhow::Result<()> {
    let stream_type = StreamType::Logs;
    // the schema lands with the first row, which may still be on another ingester
    if infra::schema::get(org, CHANGE_EVENTS_STREAM, stream_type)
        .await?
        .fields()
        .is_empty()
    {
        return Ok(());
    }
    let mut settings = infra::schema::get_settings(org, CHANGE_EVENTS_STREAM, stream_type)
        .await
        .map(|s| (*s).clone())
        .unwrap_or_default();
    let default = config::get_config().compact.data_retention_days;
    if seed_retention_settings(&mut settings, RETENTION_DAYS, default) {
        schema::save_stream_settings(org, CHANGE_EVENTS_STREAM, stream_type, settings).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use ingestion_common::{IngestUser, IngestionRequest, SystemJobType};
    use proto::cluster_rpc::{IngestionRequest as RpcRequest, IngestionResponse};
    use serde_json::json;

    use super::*;
    use crate::ingestion::feature_writer::tests::meta_store;

    /// Ingests each request in this process as the change-events writer.
    struct InProcessIngester;

    #[async_trait]
    impl WriterTransport for InProcessIngester {
        async fn send(
            &self,
            request: tonic::Request<RpcRequest>,
        ) -> Result<IngestionResponse, tonic::Status> {
            let body = request.into_inner();
            let data = body.data.unwrap_or_default().data;
            crate::logs::ingest::ingest(
                0,
                &body.org_id,
                &body.stream_name,
                IngestionRequest::JSON(bytes::Bytes::from(data)),
                IngestUser::SystemJob(SystemJobType::ChangeEvents),
                None,
                false,
            )
            .await
            .map_err(|e| tonic::Status::internal(e.to_string()))?;
            Ok(IngestionResponse {
                status_code: 200,
                message: "OK".to_string(),
            })
        }
    }

    struct TimestampTransport;

    #[async_trait]
    impl WriterTransport for TimestampTransport {
        async fn send(
            &self,
            request: tonic::Request<RpcRequest>,
        ) -> Result<IngestionResponse, tonic::Status> {
            let records: Value =
                serde_json::from_slice(&request.into_inner().data.unwrap().data).unwrap();
            assert_eq!(records[0]["ts_server_stamped"], true);
            assert_eq!(records[0]["_timestamp"], 7);
            assert_eq!(records[1]["ts_server_stamped"], false);
            assert_eq!(records[1]["_timestamp"], 5);
            Ok(IngestionResponse {
                status_code: 200,
                message: "OK".into(),
            })
        }
    }

    #[tokio::test]
    async fn writer_preserves_server_and_event_timestamp_precision_markers() {
        use config::meta::alerts::change_events::{Provenance, parse_events};

        let records = parse_events(
            json!({"events": [
                {"service": "checkout", "kind": "deploy", "summary": "v2"},
                {"service": "checkout", "kind": "deploy", "summary": "v3", "_timestamp": 5},
            ]}),
            (1, 10),
        )
        .unwrap()
        .into_iter()
        .map(|event| {
            event.into_record(
                &Provenance::Integration {
                    id: "i1",
                    name: "release",
                },
                7,
            )
        })
        .collect();
        let token =
            WriterToken::for_tests(FeatureWriter::ChangeEvents, "timestamp-markers", "o2oi_c");
        write_with(&TimestampTransport, &token, records)
            .await
            .unwrap();
    }

    fn fresh_org(label: &str) -> String {
        format!("chg-{label}-{}", config::utils::time::now_micros())
    }

    fn row(probe: &str) -> Value {
        json!({
            "_timestamp": config::utils::time::now_micros(),
            "service": "checkout",
            "kind": "config",
            "summary": "raise pool size",
            "probe": probe,
        })
    }

    #[tokio::test]
    async fn only_the_change_events_writer_reaches_the_stream_on_every_ingest_path() {
        meta_store().await;
        let org = fresh_org("paths");
        let token = WriterToken::for_tests(FeatureWriter::ChangeEvents, &org, "o2oi_c");
        write_with(&InProcessIngester, &token, vec![row("writer")])
            .await
            .unwrap();
        let schema = infra::schema::get(&org, CHANGE_EVENTS_STREAM, StreamType::Logs)
            .await
            .unwrap();
        assert!(schema.field_with_name("probe").is_ok(), "no row landed");

        let body = bytes::Bytes::from(Value::Array(vec![row("user")]).to_string());
        let user = IngestUser::User("ci@example.com".to_string());
        let json_write = crate::logs::ingest::ingest(
            0,
            &org,
            CHANGE_EVENTS_STREAM,
            IngestionRequest::JSON(body),
            user,
            None,
            false,
        )
        .await;
        assert!(json_write.is_err(), "HTTP JSON ingest took a user write");

        let otlp = crate::logs::otlp::handle_request(
            0,
            &org,
            Default::default(),
            Some(CHANGE_EVENTS_STREAM),
            "ci@example.com",
            config::meta::otlp::OtlpRequestType::HttpJson,
        )
        .await
        .err()
        .unwrap_or_else(|| panic!("OTLP took a write"));
        assert!(otlp.to_string().contains("is reserved"), "{otlp}");

        assert!(config::meta::pipeline::is_forbidden_destination(
            "app",
            CHANGE_EVENTS_STREAM,
            false
        ));
    }

    #[tokio::test]
    async fn retention_is_seeded_once_and_an_operator_setting_is_kept() {
        meta_store().await;
        let org = fresh_org("retention");
        let retention = || async {
            infra::schema::get_settings(&org, CHANGE_EVENTS_STREAM, StreamType::Logs)
                .await
                .map(|s| s.data_retention)
        };
        settle_retention(&org).await;
        assert_ne!(
            retention().await,
            Some(RETENTION_DAYS),
            "seeded a missing stream"
        );
        let token = WriterToken::for_tests(FeatureWriter::ChangeEvents, &org, "o2oi_c");
        write_with(&InProcessIngester, &token, vec![row("first")])
            .await
            .unwrap();
        settle_retention(&org).await;
        assert_eq!(retention().await, Some(RETENTION_DAYS));

        set_retention(&org, 12).await;
        settle_retention(&org).await;
        assert_eq!(
            retention().await,
            Some(12),
            "the operator's retention was overwritten"
        );
    }

    #[tokio::test]
    async fn a_recreated_stream_is_seeded_again() {
        meta_store().await;
        let org = fresh_org("recreated");
        let token = WriterToken::for_tests(FeatureWriter::ChangeEvents, &org, "o2oi_c");
        write_with(&InProcessIngester, &token, vec![row("first")])
            .await
            .unwrap();
        settle_retention(&org).await;
        set_retention(&org, 0).await;
        let key = format!("{org}/{}/{CHANGE_EVENTS_STREAM}", StreamType::Logs);
        infra::schema::remove_stream_settings(&key).await;
        settle_retention(&org).await;
        let days = infra::schema::get_settings(&org, CHANGE_EVENTS_STREAM, StreamType::Logs)
            .await
            .map(|s| s.data_retention);
        assert_eq!(
            days,
            Some(RETENTION_DAYS),
            "the recreated stream kept no retention"
        );
    }

    async fn set_retention(org: &str, days: i64) {
        let mut settings =
            (*infra::schema::get_settings(org, CHANGE_EVENTS_STREAM, StreamType::Logs)
                .await
                .unwrap())
            .clone();
        settings.data_retention = days;
        schema::save_stream_settings(org, CHANGE_EVENTS_STREAM, StreamType::Logs, settings)
            .await
            .unwrap();
    }
}
