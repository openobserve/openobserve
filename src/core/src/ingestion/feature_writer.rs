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

//! The one way a feature writes its own `_o2_` stream: with an org ingestion token kept for it.

use async_trait::async_trait;
use common::infra::config::ORG_INGESTION_TOKENS;
use config::{
    META_ORG_ID, get_config,
    meta::{
        alerts::alert_calibration::DIGEST_STREAM, autoobserve::AUTOOBSERVE_STREAM_PREFIX,
        stream::StreamType,
    },
    utils::base64,
};
use infra::table::org_ingestion_tokens::OrgIngestionTokenRecord;
use ingestion_common::{IngestUser, SystemJobType};
use openobserve_node::grpc::get_ingester_channel;
use proto::cluster_rpc::{self, IngestionRequest, IngestionResponse};
use tonic::{
    Code, Request, Status,
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
};

use crate::traces::service_graph::v4::writer::{ReplyClass, classify};

/// Every writer token's `created_by`; infra never authenticates another writer-named row.
pub const SYSTEM_CREATOR: &str = infra::table::org_ingestion_tokens::WRITER_TOKEN_CREATOR;
/// Set by the ingest interceptor for a writer token only, after it removes any a client sent.
pub const WRITER_METADATA_KEY: &str = "o2_feature_writer";
/// The create route's answer to a reserved name (AGENTS.md reserves `_o2_` for O2's own data).
pub const RESERVED_NAME: &str =
    "Token names starting with _o2_ are reserved for OpenObserve features.";
/// The token route's answer to a Splunk HEC token asked for on a writer's token.
pub const SPLUNK_FOR_WRITER: &str =
    "Splunk HEC tokens cannot be added to tokens reserved for OpenObserve features.";
/// A disabled writer token stops the feature's writes until an admin enables it again.
const REVOKED: &str = "Results were not saved because the {feature} ingestion token is disabled. Enable it under Ingestion tokens to resume.";
/// The interceptor reads only its cache, which a token made or rotated moments ago may miss.
const NOT_READY: &str = "Results were not saved because the {feature} ingestion token is not active yet. The next run retries.";
/// Shown beside the token in the org's token list.
const DESCRIPTION: &str = "Used by {feature} to save its results. Disable it to stop them.";
/// A writer token reaches only its feature's streams.
const OUT_OF_SCOPE: &str = "The {feature} ingestion token cannot write to stream '{stream}'.";
/// The org passcode rotation's answer when a writer token it must rotate with `default` fails.
const ROTATION_FAILED: &str = "The ingestion token was not rotated because the {feature} ingestion token could not be rotated with it. Try again.";

/// A feature that writes its own `_o2_` streams with its own org ingestion token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureWriter {
    AlertCalibration,
    AutoObserve,
}

impl FeatureWriter {
    pub const ALL: [Self; 2] = [Self::AlertCalibration, Self::AutoObserve];

    pub fn from_token_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|w| w.token_name() == name)
    }

    pub fn token_name(self) -> &'static str {
        match self {
            Self::AlertCalibration => "_o2_alert_calibration",
            Self::AutoObserve => "_o2_autoobserve",
        }
    }

    /// AutoObserve rows land in `_meta` whatever org they describe, so its token lives there.
    pub fn token_org(self, org: &str) -> &str {
        match self {
            Self::AlertCalibration => org,
            Self::AutoObserve => META_ORG_ID,
        }
    }

    pub fn allows(self, stream: &str) -> bool {
        match self {
            Self::AlertCalibration => stream == DIGEST_STREAM,
            Self::AutoObserve => stream.starts_with(AUTOOBSERVE_STREAM_PREFIX),
        }
    }

    /// What each writer sent before it had a token: AutoObserve's `Usage` keeps `_meta` unbilled.
    pub fn ingestion_type(self) -> cluster_rpc::IngestionType {
        match self {
            Self::AlertCalibration => cluster_rpc::IngestionType::Json,
            Self::AutoObserve => cluster_rpc::IngestionType::Usage,
        }
    }

    pub fn job(self) -> SystemJobType {
        match self {
            Self::AlertCalibration => SystemJobType::AlertCalibration,
            Self::AutoObserve => SystemJobType::AutoObserve,
        }
    }

    pub fn revoked_message(self) -> String {
        REVOKED.replace("{feature}", self.feature())
    }

    pub fn not_ready_message(self) -> String {
        NOT_READY.replace("{feature}", self.feature())
    }

    pub fn rotation_failed_message(self) -> String {
        ROTATION_FAILED.replace("{feature}", self.feature())
    }

    pub fn out_of_scope_message(self, stream: &str) -> String {
        OUT_OF_SCOPE
            .replace("{feature}", self.feature())
            .replace("{stream}", stream)
    }

    fn feature(self) -> &'static str {
        match self {
            Self::AlertCalibration => "Alert Calibration",
            Self::AutoObserve => "AutoObserve",
        }
    }

    fn description(self) -> String {
        DESCRIPTION.replace("{feature}", self.feature())
    }
}

/// Why a writer has no token to write with.
#[derive(Debug, thiserror::Error)]
pub enum WriterTokenError {
    /// An admin disabled it; it is never re-enabled or re-made here.
    #[error("{}", .0.revoked_message())]
    Revoked(FeatureWriter),
    /// A row with the writer's name that the system did not make.
    #[error("{}", .0.revoked_message())]
    Foreign(FeatureWriter),
    #[error("could not read or create the ingestion token: {0}")]
    Store(String),
}

/// Why a writer's chunk did not land.
#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("{0}")]
    OutOfScope(String),
    #[error("{}", .0.not_ready_message())]
    NotReady(FeatureWriter),
    #[error("ingest refused the chunk: {0}")]
    Failed(String),
}

/// An enabled writer token, made only by [`token`], so a revoked lookup has nothing to write with.
#[derive(Clone)]
pub struct WriterToken {
    writer: FeatureWriter,
    org: String,
    value: String,
}

impl WriterToken {
    pub fn writer(&self) -> FeatureWriter {
        self.writer
    }

    pub fn org(&self) -> &str {
        &self.org
    }

    #[cfg(test)]
    pub(crate) fn for_tests(writer: FeatureWriter, org: &str, value: &str) -> Self {
        Self {
            writer,
            org: org.to_string(),
            value: value.to_string(),
        }
    }

    fn authorization(&self) -> String {
        let user = IngestUser::SystemJob(self.writer.job()).to_email();
        format!(
            "Basic {}",
            base64::encode(&format!("{user}:{}", self.value))
        )
    }
}

impl std::fmt::Debug for WriterToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WriterToken")
            .field("writer", &self.writer)
            .field("org", &self.org)
            .finish_non_exhaustive()
    }
}

/// The ingest RPC, behind a trait so tests can record what a writer sends.
#[async_trait]
pub trait WriterTransport: Send + Sync {
    async fn send(&self, request: Request<IngestionRequest>) -> Result<IngestionResponse, Status>;
}

/// Any ingester, over the cluster channel; the writer's own credential is on the request.
pub struct GrpcTransport;

#[async_trait]
impl WriterTransport for GrpcTransport {
    async fn send(
        &self,
        mut request: Request<IngestionRequest>,
    ) -> Result<IngestionResponse, Status> {
        let cfg = get_config();
        let (addr, channel) = get_ingester_channel().await?;
        let max_size = cfg.grpc.max_message_size * 1024 * 1024;
        let mut client = cluster_rpc::ingest_client::IngestClient::new(channel)
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip)
            .max_decoding_message_size(max_size)
            .max_encoding_message_size(max_size);
        request.set_timeout(std::time::Duration::from_secs(
            cfg.limit.grpc_ingest_timeout,
        ));
        client
            .ingest(request)
            .await
            .map(tonic::Response::into_inner)
            .inspect_err(|e| log::error!("[feature_writer] ingest node {addr} answered: {e}"))
    }
}

/// The writer's token for `org`, made on first use; once disabled it is never re-made or used.
pub async fn token(writer: FeatureWriter, org: &str) -> Result<WriterToken, WriterTokenError> {
    let org = writer.token_org(org);
    let found = db::org_ingestion_tokens::get_by_name(org, writer.token_name())
        .await
        .map_err(|e| WriterTokenError::Store(e.to_string()))?;
    let value = match found {
        Some(row) => usable(writer, &row)?,
        None => create(writer, org).await?,
    };
    Ok(WriterToken {
        writer,
        org: org.to_string(),
        value,
    })
}

/// Sends one chunk of JSON rows to `stream` as the token's writer.
pub async fn write(
    transport: &dyn WriterTransport,
    token: &WriterToken,
    stream: &str,
    data: Vec<u8>,
) -> Result<(), WriteError> {
    let writer = token.writer;
    if !writer.allows(stream) {
        return Err(WriteError::OutOfScope(writer.out_of_scope_message(stream)));
    }
    let mut request = Request::new(IngestionRequest {
        org_id: token.org.clone(),
        stream_type: StreamType::Logs.as_str().to_string(),
        stream_name: stream.to_string(),
        data: Some(cluster_rpc::IngestionData { data }),
        ingestion_type: Some(writer.ingestion_type() as i32),
        metadata: None,
    });
    let invalid = |e: &dyn std::fmt::Display| WriteError::Failed(e.to_string());
    let authorization = MetadataValue::try_from(token.authorization()).map_err(|e| invalid(&e))?;
    let org_key = MetadataKey::from_bytes(get_config().grpc.org_header_key.as_bytes())
        .map_err(|e| invalid(&e))?;
    let org = MetadataValue::try_from(token.org.as_str()).map_err(|e| invalid(&e))?;
    request
        .metadata_mut()
        .insert("authorization", authorization);
    request.metadata_mut().insert(org_key, org);
    match transport.send(request).await {
        Ok(reply) => match classify(reply.status_code) {
            ReplyClass::Ok => Ok(()),
            // Rows a pipeline refused leave the stream short, yet it would read as complete.
            ReplyClass::Partial | ReplyClass::Rejected | ReplyClass::Retry => Err(
                WriteError::Failed(format!("code {} {}", reply.status_code, reply.message)),
            ),
        },
        Err(status) if status.code() == Code::Unauthenticated => Err(WriteError::NotReady(writer)),
        Err(status) => Err(WriteError::Failed(status.to_string())),
    }
}

/// Whether `token` is `writer`'s live token in `org` on the primary; evicts it if not.
pub async fn confirm(
    writer: FeatureWriter,
    org: &str,
    token: &str,
) -> Result<bool, WriterTokenError> {
    let row = infra::table::org_ingestion_tokens::find_token_any_state(org, token)
        .await
        .map_err(|e| WriterTokenError::Store(e.to_string()))?;
    let live = writer.token_org(org) == org
        && row.is_some_and(|r| {
            r.enabled && r.name == writer.token_name() && r.created_by == SYSTEM_CREATOR
        });
    if !live {
        ORG_INGESTION_TOKENS.remove(&db::org_ingestion_tokens::cache_key(org, token));
    }
    Ok(live)
}

fn usable(
    writer: FeatureWriter,
    row: &OrgIngestionTokenRecord,
) -> Result<String, WriterTokenError> {
    if row.created_by != SYSTEM_CREATOR {
        log::error!(
            "[feature_writer] org {} has a {} token made by {}, so it is not used",
            row.org_id,
            row.name,
            row.created_by
        );
        return Err(WriterTokenError::Foreign(writer));
    }
    if !row.enabled {
        return Err(WriterTokenError::Revoked(writer));
    }
    Ok(row.token.clone())
}

async fn create(writer: FeatureWriter, org: &str) -> Result<String, WriterTokenError> {
    let name = writer.token_name();
    let description = writer.description();
    match crate::ingestion_tokens::create_token(org, name, &description, SYSTEM_CREATOR, false)
        .await
    {
        Ok(created) => {
            // The watch fills the other nodes' caches; this lets a local ingester accept at once.
            ORG_INGESTION_TOKENS.insert(
                db::org_ingestion_tokens::cache_key(org, &created.token),
                name.to_string(),
            );
            // A disable or rotation that committed before the insert would be undone by it.
            if let Err(e) = confirm(writer, org, &created.token).await {
                log::warn!("[feature_writer] could not recheck the new {name} token of {org}: {e}");
            }
            log::info!("[feature_writer] created the {name} ingestion token for org {org}");
            Ok(created.token)
        }
        // Another node made it first, so the unique (org, name) index refused this one.
        Err(e) => match infra::table::org_ingestion_tokens::get_by_name_rw(org, name).await {
            Ok(Some(row)) => usable(writer, &row),
            _ => Err(WriterTokenError::Store(e.to_string())),
        },
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::Mutex;

    use super::*;

    /// Records each request a writer sends and answers every one with `status_code`.
    pub(crate) struct RecordingTransport {
        pub(crate) sent: Mutex<Vec<Request<IngestionRequest>>>,
        pub(crate) status_code: i32,
    }

    impl RecordingTransport {
        pub(crate) fn answering(status_code: i32) -> Self {
            Self {
                sent: Mutex::new(vec![]),
                status_code,
            }
        }

        /// The decoded `user:password` of each request, with its org header and body.
        pub(crate) fn credentials(&self) -> Vec<(String, String, IngestionRequest)> {
            let org_key = get_config().grpc.org_header_key.clone();
            self.sent
                .lock()
                .unwrap()
                .iter()
                .map(|request| {
                    let header = |key: &str| {
                        request
                            .metadata()
                            .get(key)
                            .map(|v| v.to_str().unwrap().to_string())
                            .unwrap_or_default()
                    };
                    let basic = header("authorization");
                    let encoded = basic.strip_prefix("Basic ").unwrap_or(&basic);
                    let decoded = base64::decode(encoded).unwrap();
                    (decoded, header(&org_key), request.get_ref().clone())
                })
                .collect()
        }
    }

    #[async_trait]
    impl WriterTransport for RecordingTransport {
        async fn send(
            &self,
            request: Request<IngestionRequest>,
        ) -> Result<IngestionResponse, Status> {
            self.sent.lock().unwrap().push(request);
            Ok(IngestionResponse {
                status_code: self.status_code,
                message: String::new(),
            })
        }
    }

    /// Answers every request as an interceptor that has not cached the token yet.
    pub(crate) struct UncachedTransport;

    #[async_trait]
    impl WriterTransport for UncachedTransport {
        async fn send(&self, _: Request<IngestionRequest>) -> Result<IngestionResponse, Status> {
            Err(Status::unauthenticated("No valid auth token[7]"))
        }
    }

    /// The local meta store, migrated once per test binary.
    pub(crate) async fn meta_store() {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
    }

    fn fresh_org(label: &str) -> String {
        format!("demo-org-{label}-{}", config::utils::time::now_micros())
    }

    #[test]
    fn each_writer_reaches_only_its_own_streams() {
        use FeatureWriter::*;
        assert!(AlertCalibration.allows(DIGEST_STREAM));
        assert!(!AlertCalibration.allows("_o2_autoobserve_health"));
        assert!(!AlertCalibration.allows("default"));
        assert!(AutoObserve.allows("_o2_autoobserve_health"));
        assert!(AutoObserve.allows("_o2_autoobserve_stream_silence_decisions"));
        assert!(!AutoObserve.allows(DIGEST_STREAM));
        assert!(!AutoObserve.allows("_o2_dbm_server"));
        assert_eq!(AlertCalibration.token_org("demo-org"), "demo-org");
        assert_eq!(AutoObserve.token_org("demo-org"), META_ORG_ID);
        for writer in FeatureWriter::ALL {
            assert_eq!(
                FeatureWriter::from_token_name(writer.token_name()),
                Some(writer)
            );
            assert!(infra::table::org_ingestion_tokens::is_writer_token_name(
                writer.token_name()
            ));
        }
        assert_eq!(FeatureWriter::from_token_name("ci-collector"), None);
        assert_eq!(FeatureWriter::from_token_name("_o2_x"), None);
    }

    #[tokio::test]
    async fn a_writer_token_is_created_once_and_then_looked_up() {
        meta_store().await;
        let org = fresh_org("once");
        let first = token(FeatureWriter::AlertCalibration, &org).await.unwrap();
        let second = token(FeatureWriter::AlertCalibration, &org).await.unwrap();
        assert_eq!(first.value, second.value);
        assert!(first.value.starts_with("o2oi_"));
        let rows = db::org_ingestion_tokens::list_by_org(&org).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "_o2_alert_calibration");
        assert_eq!(rows[0].created_by, SYSTEM_CREATOR);
        assert!(rows[0].enabled);
        let listed = crate::ingestion_tokens::list_tokens(&org).await.unwrap();
        assert!(
            listed.iter().any(|t| t.name == "default"),
            "the writer token kept the org from getting its default token"
        );
    }

    #[tokio::test]
    async fn a_disabled_writer_token_is_never_recreated_or_used() {
        meta_store().await;
        let org = fresh_org("revoked");
        token(FeatureWriter::AlertCalibration, &org).await.unwrap();
        crate::ingestion_tokens::set_enabled_token(&org, "_o2_alert_calibration", false)
            .await
            .unwrap();
        let err = token(FeatureWriter::AlertCalibration, &org)
            .await
            .unwrap_err();
        assert!(matches!(err, WriterTokenError::Revoked(_)), "{err:?}");
        assert_eq!(
            err.to_string(),
            "Results were not saved because the Alert Calibration ingestion token is disabled. Enable it under Ingestion tokens to resume."
        );
        let rows = db::org_ingestion_tokens::list_by_org(&org).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].enabled, "the lookup re-enabled a disabled token");
    }

    #[tokio::test]
    async fn only_the_live_writer_token_is_confirmed_and_a_stale_entry_is_evicted() {
        meta_store().await;
        let org = fresh_org("confirm");
        let name = "_o2_alert_calibration";
        let first = token(FeatureWriter::AlertCalibration, &org).await.unwrap();
        assert!(
            confirm(FeatureWriter::AlertCalibration, &org, &first.value)
                .await
                .unwrap()
        );
        assert!(
            !confirm(FeatureWriter::AutoObserve, &org, &first.value)
                .await
                .unwrap()
        );
        let rotated = db::org_ingestion_tokens::rotate_token(&org, name)
            .await
            .unwrap();
        let stale = db::org_ingestion_tokens::cache_key(&org, &first.value);
        ORG_INGESTION_TOKENS.insert(stale.clone(), name.to_string());
        assert!(
            !confirm(FeatureWriter::AlertCalibration, &org, &first.value)
                .await
                .unwrap()
        );
        assert!(!ORG_INGESTION_TOKENS.contains_key(&stale));
        assert!(
            confirm(FeatureWriter::AlertCalibration, &org, &rotated)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn a_user_made_token_with_the_writer_name_is_not_used() {
        meta_store().await;
        let org = fresh_org("foreign");
        crate::ingestion_tokens::create_token(
            &org,
            "_o2_alert_calibration",
            "",
            "admin@demo-org",
            false,
        )
        .await
        .unwrap();
        let err = token(FeatureWriter::AlertCalibration, &org)
            .await
            .unwrap_err();
        assert!(matches!(err, WriterTokenError::Foreign(_)), "{err:?}");
    }

    #[tokio::test]
    async fn a_write_carries_the_writer_token_and_stays_in_scope() {
        let transport = RecordingTransport::answering(200);
        let token = WriterToken::for_tests(FeatureWriter::AlertCalibration, "demo-org", "o2oi_w");
        write(&transport, &token, DIGEST_STREAM, b"[]".to_vec())
            .await
            .unwrap();
        let err = write(&transport, &token, "default", b"[]".to_vec())
            .await
            .unwrap_err();
        assert!(matches!(err, WriteError::OutOfScope(_)), "{err:?}");
        let sent = transport.credentials();
        assert_eq!(sent.len(), 1, "an out-of-scope write reached the RPC");
        let (credentials, org, body) = &sent[0];
        assert_eq!(credentials, "alert_calibration@system.local:o2oi_w");
        assert_eq!(org, "demo-org");
        assert_eq!(body.org_id, "demo-org");
        assert_eq!(body.stream_name, DIGEST_STREAM);
        assert_eq!(
            body.ingestion_type,
            Some(cluster_rpc::IngestionType::Json as i32)
        );
    }

    #[tokio::test]
    async fn a_refused_or_uncached_write_is_an_error() {
        let token = WriterToken::for_tests(FeatureWriter::AutoObserve, META_ORG_ID, "o2oi_w");
        let err = write(&UncachedTransport, &token, "_o2_autoobserve_health", vec![])
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "Results were not saved because the AutoObserve ingestion token is not active yet. The next run retries."
        );
        for code in [207, 429, 500] {
            let transport = RecordingTransport::answering(code);
            let err = write(&transport, &token, "_o2_autoobserve_health", vec![])
                .await
                .unwrap_err();
            assert!(matches!(err, WriteError::Failed(_)), "{code}: {err:?}");
        }
    }
}
