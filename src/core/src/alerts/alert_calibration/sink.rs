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

//! Writes digest records to the org's `_o2_alert_calibration_digests` stream.

use std::collections::HashMap;

use arrow_schema::{DataType, Field, Schema};
pub use config::meta::alerts::alert_calibration::DIGEST_STREAM;
use config::{get_config, meta::stream::StreamType, utils::time::now_micros};
use serde_json::Value;

use crate::{
    ingestion::feature_writer::{self, GrpcTransport, WriteError, WriterToken, WriterTransport},
    traces::service_graph::v4::writer::{chunk, max_request_bytes},
};

/// The columns a run read tells a marker by; a read planned without them sees a skip as a run.
const CLASSIFYING_COLUMNS: [&str; 2] = ["kind", "rule_id"];
/// Schema metadata holding when the merge adding `kind` was seen stored, in microseconds.
const KIND_ADDED_AT_KEY: &str = "alert_calibration_kind_added_at";
/// Schema metadata that is non-empty from before that merge until it is seen stored.
const KIND_PENDING_KEY: &str = "alert_calibration_kind_pending";
/// Time for the `NEED_WATCH` schema event to reach every node's cache, on top of the query timeout.
const SETTLE_MARGIN_SECS: u64 = 60;

/// What a pass did with its records.
#[derive(Debug, PartialEq)]
pub(crate) enum DigestWrite {
    Written,
    /// The stream gained `kind` too recently for every read planned without it to have ended.
    Deferred,
}

/// The clock, schema writes and ingest of a pass, so tests can delay, fail or count each.
trait DigestStore {
    fn now(&self) -> i64;
    async fn set_metadata(
        &self,
        org_id: &str,
        entries: HashMap<String, String>,
    ) -> Result<(), anyhow::Error>;
    async fn merge(&self, org_id: &str, schema: &Schema, at: i64) -> Result<(), anyhow::Error>;
    async fn write(&self, org_id: &str, records: Vec<Value>) -> Result<(), anyhow::Error>;
}

/// The meta store, and the ingester reached with the org's calibration writer token.
struct Ingest<'a> {
    token: &'a WriterToken,
}

impl DigestStore for Ingest<'_> {
    fn now(&self) -> i64 {
        now_micros()
    }

    async fn set_metadata(
        &self,
        org_id: &str,
        entries: HashMap<String, String>,
    ) -> Result<(), anyhow::Error> {
        crate::db::schema::update_setting(org_id, DIGEST_STREAM, StreamType::Logs, entries).await
    }

    async fn merge(&self, org_id: &str, schema: &Schema, at: i64) -> Result<(), anyhow::Error> {
        crate::db::schema::merge(org_id, DIGEST_STREAM, StreamType::Logs, schema, Some(at)).await?;
        Ok(())
    }

    async fn write(&self, _org_id: &str, records: Vec<Value>) -> Result<(), anyhow::Error> {
        write_chunks(&GrpcTransport, self.token, records).await
    }
}

/// The stream is a pass's only record, so a lost chunk fails the pass rather than shortening it.
pub(crate) async fn write_digest_records(
    org_id: &str,
    token: &WriterToken,
    records: Vec<Value>,
) -> Result<DigestWrite, anyhow::Error> {
    write_once_ready(&Ingest { token }, org_id, records).await
}

async fn write_once_ready(
    store: &impl DigestStore,
    org_id: &str,
    records: Vec<Value>,
) -> Result<DigestWrite, anyhow::Error> {
    match readiness(store, org_id).await {
        Ok(DigestWrite::Written) => {
            store.write(org_id, records).await?;
            Ok(DigestWrite::Written)
        }
        Ok(DigestWrite::Deferred) => {
            log::info!(
                "[alert_calibration] the digest stream for {org_id} gained kind recently, so a later run writes the records"
            );
            Ok(DigestWrite::Deferred)
        }
        Err(e) => {
            log::warn!(
                "[alert_calibration] could not register kind and rule_id for {org_id}, so this pass wrote nothing: {e}"
            );
            Err(anyhow::anyhow!(
                "could not prepare the digest stream, so nothing was written; the next run retries: {e}"
            ))
        }
    }
}

/// Reads only stored schema state, so a manual run or a restart in the window still waits.
async fn readiness(store: &impl DigestStore, org_id: &str) -> Result<DigestWrite, anyhow::Error> {
    let current = infra::schema::get_from_db(org_id, DIGEST_STREAM, StreamType::Logs).await?;
    // A new stream gets its columns from its first write, so no read can plan without them.
    if current.fields().is_empty() {
        return Ok(DigestWrite::Written);
    }
    if is_pending(&current) || current.field_with_name("kind").is_err() {
        register(store, org_id, &current).await?;
        return Ok(DigestWrite::Deferred);
    }
    if !holds_classifying_columns(&current) {
        store
            .merge(org_id, &classifying_schema(), store.now())
            .await?;
    }
    // Without a stamp or a pending registration, kind came with the stream's first version-2 write.
    let added_at = current
        .metadata()
        .get(KIND_ADDED_AT_KEY)
        .and_then(|at| at.parse::<i64>().ok());
    let window = settle_window_micros();
    let settled = added_at.is_none_or(|at| store.now().saturating_sub(at) >= window);
    Ok(if settled {
        DigestWrite::Written
    } else {
        DigestWrite::Deferred
    })
}

/// The window starts once the merge is seen stored, however long the merge itself waited.
async fn register(
    store: &impl DigestStore,
    org_id: &str,
    current: &Schema,
) -> Result<(), anyhow::Error> {
    if !is_pending(current) {
        // Set before the merge, so a registration cut short leaves every later pass deferring.
        let pending = HashMap::from([(KIND_PENDING_KEY.to_string(), store.now().to_string())]);
        store.set_metadata(org_id, pending).await?;
    }
    if !holds_classifying_columns(current) {
        store
            .merge(org_id, &classifying_schema(), store.now())
            .await?;
    }
    let stored = infra::schema::get_from_db(org_id, DIGEST_STREAM, StreamType::Logs).await?;
    if !holds_classifying_columns(&stored) {
        anyhow::bail!("the schema merge returned, but kind and rule_id are not stored");
    }
    let done = HashMap::from([
        (KIND_ADDED_AT_KEY.to_string(), store.now().to_string()),
        (KIND_PENDING_KEY.to_string(), String::new()),
    ]);
    store.set_metadata(org_id, done).await?;
    log::info!("[alert_calibration] registered kind and rule_id on the digest stream for {org_id}");
    Ok(())
}

fn is_pending(schema: &Schema) -> bool {
    schema
        .metadata()
        .get(KIND_PENDING_KEY)
        .is_some_and(|pending| !pending.is_empty())
}

fn holds_classifying_columns(schema: &Schema) -> bool {
    CLASSIFYING_COLUMNS
        .iter()
        .all(|column| schema.field_with_name(column).is_ok())
}

fn classifying_schema() -> Schema {
    let columns: Vec<Field> = CLASSIFYING_COLUMNS
        .iter()
        .map(|column| Field::new(*column, DataType::Utf8, true))
        .collect();
    Schema::new(columns)
}

/// The digest read sets no timeout, so search ends it at the query timeout (flight.rs:83).
fn settle_window_micros() -> i64 {
    let limit = &get_config().limit;
    let timeout = limit
        .query_timeout
        .max(limit.query_ingester_timeout)
        .max(limit.query_querier_timeout);
    let secs = timeout.saturating_add(SETTLE_MARGIN_SECS);
    i64::try_from(secs.saturating_mul(1_000_000)).unwrap_or(i64::MAX)
}

async fn write_chunks(
    transport: &dyn WriterTransport,
    token: &WriterToken,
    records: Vec<Value>,
) -> Result<(), anyhow::Error> {
    let org_id = token.org();
    let chunks = chunk(&records, max_request_bytes());
    let total = chunks.len();
    let mut lost = 0usize;
    let mut not_ready = false;
    for (index, data) in chunks.into_iter().enumerate() {
        // Retrying would duplicate the chunks that landed, since records carry no idempotency key.
        if let Err(e) = write_chunk(transport, token, data).await {
            lost += 1;
            not_ready |= matches!(e, WriteError::NotReady(_));
            log::error!(
                "[alert_calibration] digest chunk {index} of {total} failed for {org_id}: {e}"
            );
        }
    }
    if not_ready {
        anyhow::bail!("{}", token.writer().not_ready_message());
    }
    if lost > 0 {
        anyhow::bail!("{lost} of {total} digest chunks were not written for {org_id}");
    }
    Ok(())
}

async fn write_chunk(
    transport: &dyn WriterTransport,
    token: &WriterToken,
    data: Vec<u8>,
) -> Result<(), WriteError> {
    feature_writer::write(transport, token, DIGEST_STREAM, data).await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    const T0: i64 = 1_800_000_000_000_000;
    const SECOND: i64 = 1_000_000;
    const V1_MARKERS: [&str; 5] = [
        "_timestamp",
        "window_start",
        "window_end",
        "finding_count",
        "skip_count",
    ];

    /// How the fake's merge behaves.
    #[derive(Clone, Copy, Default)]
    enum MergeMode {
        #[default]
        Lands,
        /// Lands only after the clock has moved on by this many microseconds.
        LandsAfter(i64),
        /// Fails after the pending marker was set, as a crash or a lost connection would.
        Interrupted,
        /// Returns success without the columns reaching the store.
        Lost,
    }

    /// One process's view of the store: the schema writes go to the test DB, the ingest is counted.
    #[derive(Default)]
    struct Fake {
        meta_store_down: bool,
        merge: MergeMode,
        clock: Mutex<i64>,
        merges: Mutex<usize>,
        written: Mutex<Vec<usize>>,
    }

    impl Fake {
        fn with_merge(merge: MergeMode) -> Self {
            Self {
                merge,
                ..Default::default()
            }
        }

        fn failing() -> Self {
            Self {
                meta_store_down: true,
                ..Default::default()
            }
        }

        async fn pass(&self, org: &str, now: i64) -> Result<DigestWrite, anyhow::Error> {
            *self.clock.lock().unwrap() = now;
            write_once_ready(self, org, records()).await
        }

        fn written(&self) -> Vec<usize> {
            self.written.lock().unwrap().clone()
        }

        fn merges(&self) -> usize {
            *self.merges.lock().unwrap()
        }
    }

    impl DigestStore for Fake {
        fn now(&self) -> i64 {
            *self.clock.lock().unwrap()
        }

        async fn set_metadata(
            &self,
            org_id: &str,
            entries: HashMap<String, String>,
        ) -> Result<(), anyhow::Error> {
            if self.meta_store_down {
                anyhow::bail!("meta store unavailable");
            }
            infra::schema::update_setting(org_id, DIGEST_STREAM, StreamType::Logs, entries).await?;
            Ok(())
        }

        async fn merge(&self, org_id: &str, schema: &Schema, at: i64) -> Result<(), anyhow::Error> {
            *self.merges.lock().unwrap() += 1;
            if self.meta_store_down {
                anyhow::bail!("meta store unavailable");
            }
            match self.merge {
                MergeMode::Lands => {}
                MergeMode::LandsAfter(delay) => *self.clock.lock().unwrap() += delay,
                MergeMode::Interrupted => anyhow::bail!("connection lost during the merge"),
                MergeMode::Lost => return Ok(()),
            }
            infra::schema::merge(org_id, DIGEST_STREAM, StreamType::Logs, schema, Some(at)).await?;
            Ok(())
        }

        async fn write(&self, _: &str, records: Vec<Value>) -> Result<(), anyhow::Error> {
            self.written.lock().unwrap().push(records.len());
            Ok(())
        }
    }

    fn records() -> Vec<Value> {
        vec![
            serde_json::json!({"_timestamp": T0, "kind": "skip", "rule_id": "noise", "finding_count": 0}),
            serde_json::json!({"_timestamp": T0, "kind": "skip", "rule_id": "silent", "finding_count": 0}),
        ]
    }

    async fn stream_with(org: &str, columns: &[&str]) {
        infra::db_init().await.unwrap();
        if columns.is_empty() {
            return;
        }
        let fields: Vec<Field> = columns
            .iter()
            .map(|name| Field::new(*name, DataType::Int64, true))
            .collect();
        infra::schema::merge(
            org,
            DIGEST_STREAM,
            StreamType::Logs,
            &Schema::new(fields),
            Some(1),
        )
        .await
        .unwrap();
    }

    async fn digest_schema(org: &str) -> Schema {
        infra::schema::get_from_db(org, DIGEST_STREAM, StreamType::Logs)
            .await
            .unwrap()
    }

    fn stamp_of(schema: &Schema) -> Option<i64> {
        schema.metadata().get(KIND_ADDED_AT_KEY)?.parse().ok()
    }

    // A manual Run now can follow the registering pass at once, before any older read has ended.
    #[tokio::test]
    async fn an_immediate_rerun_after_registration_defers_again() {
        let org = "sink_rerun_at_once";
        stream_with(org, &V1_MARKERS).await;
        let store = Fake::default();
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Deferred);
        let registered = digest_schema(org).await;
        for column in CLASSIFYING_COLUMNS {
            let field = registered.field_with_name(column).unwrap();
            assert!(field.is_nullable(), "{column}");
            assert_eq!(*field.data_type(), DataType::Utf8, "{column}");
        }
        assert_eq!(stamp_of(&registered), Some(T0));
        assert!(!is_pending(&registered));
        let rerun = store.pass(org, T0 + SECOND).await.unwrap();
        assert_eq!(rerun, DigestWrite::Deferred);
        assert!(store.written().is_empty());
        assert_eq!(store.merges(), 1);
    }

    #[tokio::test]
    async fn a_rerun_after_the_settle_window_writes() {
        let org = "sink_rerun_after_window";
        stream_with(org, &V1_MARKERS).await;
        let store = Fake::default();
        store.pass(org, T0).await.unwrap();
        let just_inside = store.pass(org, T0 + settle_window_micros() - 1).await;
        assert_eq!(just_inside.unwrap(), DigestWrite::Deferred);
        let after = store.pass(org, T0 + settle_window_micros()).await.unwrap();
        assert_eq!(after, DigestWrite::Written);
        assert_eq!(store.written(), [2]);
    }

    // A merge held up past the window, as by a meta store row lock, still waits a full window.
    #[tokio::test]
    async fn a_registration_delayed_past_the_window_defers_a_window_after_it_completes() {
        let org = "sink_merge_delayed";
        stream_with(org, &V1_MARKERS).await;
        let delay = settle_window_micros() + 10 * SECOND;
        let store = Fake::with_merge(MergeMode::LandsAfter(delay));
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Deferred);
        let completed = T0 + delay;
        let rerun = store.pass(org, completed + SECOND).await.unwrap();
        assert_eq!(rerun, DigestWrite::Deferred);
        let registered = digest_schema(org).await;
        assert_eq!(stamp_of(&registered), Some(completed));
        assert!(!is_pending(&registered));
        let window = settle_window_micros();
        let just_inside = store.pass(org, completed + window - 1).await.unwrap();
        assert_eq!(just_inside, DigestWrite::Deferred);
        assert!(store.written().is_empty());
        let after = store.pass(org, completed + window).await.unwrap();
        assert_eq!(after, DigestWrite::Written);
        assert_eq!(store.written(), [2]);
        assert_eq!(store.merges(), 1);
    }

    #[tokio::test]
    async fn an_interrupted_registration_stays_pending_and_the_next_pass_retries_and_defers() {
        let org = "sink_merge_interrupted";
        stream_with(org, &V1_MARKERS).await;
        let cut = Fake::with_merge(MergeMode::Interrupted);
        assert!(cut.pass(org, T0).await.is_err());
        assert!(cut.written().is_empty());
        let left = digest_schema(org).await;
        assert!(left.field_with_name("kind").is_err());
        assert!(is_pending(&left));
        assert_eq!(stamp_of(&left), None);
        let store = Fake::default();
        let retry = store.pass(org, T0 + 5 * SECOND).await.unwrap();
        assert_eq!(retry, DigestWrite::Deferred);
        assert_eq!(store.merges(), 1);
        let registered = digest_schema(org).await;
        assert!(registered.field_with_name("kind").is_ok());
        assert_eq!(stamp_of(&registered), Some(T0 + 5 * SECOND));
        assert!(!is_pending(&registered));
        assert!(store.written().is_empty());
    }

    // The merge landed but the pass stopped before stamping, so the window starts at the next pass.
    #[tokio::test]
    async fn a_pending_stream_that_already_holds_kind_is_stamped_now_and_defers() {
        let org = "sink_pending_with_kind";
        let mut columns = V1_MARKERS.to_vec();
        columns.extend(CLASSIFYING_COLUMNS);
        stream_with(org, &columns).await;
        let pending = HashMap::from([(KIND_PENDING_KEY.to_string(), T0.to_string())]);
        Fake::default().set_metadata(org, pending).await.unwrap();
        let store = Fake::default();
        let resumed = T0 + 5 * SECOND;
        assert_eq!(
            store.pass(org, resumed).await.unwrap(),
            DigestWrite::Deferred
        );
        assert_eq!(store.merges(), 0);
        let registered = digest_schema(org).await;
        assert_eq!(stamp_of(&registered), Some(resumed));
        assert!(!is_pending(&registered));
        let after = store.pass(org, resumed + settle_window_micros()).await;
        assert_eq!(after.unwrap(), DigestWrite::Written);
        assert_eq!(store.written(), [2]);
    }

    #[tokio::test]
    async fn a_merge_that_returns_without_the_columns_stored_fails_closed() {
        let org = "sink_merge_lost";
        stream_with(org, &V1_MARKERS).await;
        let lost = Fake::with_merge(MergeMode::Lost);
        assert!(lost.pass(org, T0).await.is_err());
        let left = digest_schema(org).await;
        assert!(is_pending(&left));
        assert_eq!(stamp_of(&left), None);
        assert!(lost.pass(org, T0 + settle_window_micros()).await.is_err());
        assert!(lost.written().is_empty());
    }

    // Nothing is kept in memory, so a second process reads the same stamp and waits the same time.
    #[tokio::test]
    async fn a_restarted_process_inside_the_window_still_defers() {
        let org = "sink_restart";
        stream_with(org, &V1_MARKERS).await;
        Fake::default().pass(org, T0).await.unwrap();
        let restarted = Fake::default();
        let inside = restarted.pass(org, T0 + 30 * SECOND).await.unwrap();
        assert_eq!(inside, DigestWrite::Deferred);
        assert!(restarted.written().is_empty());
        assert_eq!(restarted.merges(), 0);
        let after = restarted.pass(org, T0 + settle_window_micros()).await;
        assert_eq!(after.unwrap(), DigestWrite::Written);
        assert_eq!(restarted.written(), [2]);
    }

    #[tokio::test]
    async fn a_failed_registration_writes_nothing_and_the_next_pass_retries() {
        let org = "sink_merge_fails";
        stream_with(org, &V1_MARKERS).await;
        let broken = Fake::failing();
        assert!(broken.pass(org, T0).await.is_err());
        assert!(broken.written().is_empty());
        let unchanged = digest_schema(org).await;
        assert!(unchanged.field_with_name("kind").is_err());
        assert_eq!(stamp_of(&unchanged), None);
        let store = Fake::default();
        let retry = store.pass(org, T0 + SECOND).await.unwrap();
        assert_eq!(retry, DigestWrite::Deferred);
        assert_eq!(stamp_of(&digest_schema(org).await), Some(T0 + SECOND));
    }

    // A stamp whose merge never landed is replaced, so the window starts when kind really exists.
    #[tokio::test]
    async fn a_stamp_left_without_kind_is_renewed_by_the_next_registration() {
        let org = "sink_stamp_without_kind";
        stream_with(org, &V1_MARKERS).await;
        let stale = HashMap::from([(
            KIND_ADDED_AT_KEY.to_string(),
            (T0 - settle_window_micros()).to_string(),
        )]);
        Fake::default().set_metadata(org, stale).await.unwrap();
        let store = Fake::default();
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Deferred);
        assert_eq!(stamp_of(&digest_schema(org).await), Some(T0));
    }

    #[tokio::test]
    async fn a_stream_holding_both_columns_writes_at_once() {
        let org = "sink_both_columns";
        let mut columns = V1_MARKERS.to_vec();
        columns.extend(CLASSIFYING_COLUMNS);
        stream_with(org, &columns).await;
        let store = Fake::default();
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Written);
        assert_eq!(store.written(), [2]);
        assert_eq!(store.merges(), 0);
    }

    // Every version-2 record writes kind, so the kind clause already guards a v2 marker stream.
    #[tokio::test]
    async fn a_version_two_marker_stream_gains_rule_id_and_writes_at_once() {
        let org = "sink_v2_markers";
        let mut columns = V1_MARKERS.to_vec();
        columns.push("kind");
        stream_with(org, &columns).await;
        let store = Fake::default();
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Written);
        assert_eq!(store.written(), [2]);
        assert!(digest_schema(org).await.field_with_name("rule_id").is_ok());
    }

    #[tokio::test]
    async fn a_new_stream_writes_at_once_and_is_created_by_that_write() {
        let org = "sink_no_stream";
        stream_with(org, &[]).await;
        let store = Fake::default();
        assert_eq!(store.pass(org, T0).await.unwrap(), DigestWrite::Written);
        assert_eq!(store.written(), [2]);
        assert_eq!(store.merges(), 0);
        assert!(digest_schema(org).await.fields().is_empty());
    }

    #[tokio::test]
    async fn the_digest_write_carries_the_org_writer_token_not_the_internal_token() {
        use crate::ingestion::feature_writer::{FeatureWriter, tests::RecordingTransport};
        let transport = RecordingTransport::answering(200);
        let token = WriterToken::for_tests(FeatureWriter::AlertCalibration, "demo-org", "o2oi_d");
        write_chunk(&transport, &token, b"[]".to_vec())
            .await
            .unwrap();
        let sent = transport.credentials();
        assert_eq!(sent.len(), 1);
        let (credentials, org, body) = &sent[0];
        assert_eq!(credentials, "alert_calibration@system.local:o2oi_d");
        assert_eq!(org, "demo-org");
        assert_eq!(
            (body.org_id.as_str(), body.stream_name.as_str()),
            ("demo-org", DIGEST_STREAM)
        );
        config::cache_instance_id("instance");
        let internal = config::meta::cluster::get_internal_grpc_token();
        let authorization = transport.sent.lock().unwrap()[0]
            .metadata()
            .get("authorization")
            .map(|v| v.to_str().unwrap().to_string());
        assert_ne!(authorization.as_deref(), Some(internal.as_str()));
    }

    #[tokio::test]
    async fn a_storage_failure_or_refused_rows_fail_the_digest_write() {
        use crate::ingestion::feature_writer::{FeatureWriter, tests::RecordingTransport};
        let token = WriterToken::for_tests(FeatureWriter::AlertCalibration, "demo-org", "o2oi_d");
        for code in [500, 207] {
            let transport = RecordingTransport::answering(code);
            let records = vec![serde_json::json!({"kind": "run"})];
            assert!(
                write_chunks(&transport, &token, records).await.is_err(),
                "a {code} reply read as written"
            );
        }
    }

    #[tokio::test]
    async fn a_chunk_the_interceptor_has_not_cached_fails_the_pass_as_not_ready() {
        use crate::ingestion::feature_writer::{FeatureWriter, tests::UncachedTransport};
        let token = WriterToken::for_tests(FeatureWriter::AlertCalibration, "demo-org", "o2oi_d");
        let records = vec![serde_json::json!({"kind": "run"})];
        let err = write_chunks(&UncachedTransport, &token, records)
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            FeatureWriter::AlertCalibration.not_ready_message()
        );
    }
}
