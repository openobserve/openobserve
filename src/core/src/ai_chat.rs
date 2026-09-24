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

//! Durable storage for AI chat events.
//!
//! Server-side chat persistence itself lives in
//! `o2_enterprise::enterprise::ai::chat` — the background turn task,
//! batching, watermark and leases. This module is the one piece that has to
//! live here: writing to a stream needs OpenObserve's own ingestion and
//! schema plumbing, which sits above the enterprise crate in the dependency
//! graph. It is injected into a turn as a
//! [`ChatStore`](o2_enterprise::enterprise::ai::chat::ChatStore).
//!
//! Index/stream consistency (design §12). The stream is written first and the
//! index watermark second, so the only divergence a crash can leave is events
//! stored past the watermark. That needs no repair job: readers stop at the
//! watermark (the extra events are invisible), and the next turn re-sends from
//! the watermark — o2-ai forwards `seq > known_seq` — so those events are
//! written again byte-identically and the reader deduplicates them. A watermark
//! ahead of readable data (the other direction) is reported as an integrity
//! error and never papered over. Index rows of chats whose events aged out are
//! removed by the `ai_chat_retention` job.

use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock as Lazy},
    time::Duration,
};

use anyhow::Result;
use config::{
    meta::{
        search::{Query, Request as SearchRequest, RequestEncoding, SearchEventType},
        self_reporting::ai_chat::{AI_CHAT_EVENTS_STREAM, as_chat_history_reader},
        stream::{StreamParams, StreamSettings, StreamType},
    },
    metrics,
    utils::{json, schema::schema_eq, time::now_micros},
};
use dashmap::DashMap;
use infra::table::ai_chat_sessions::{self, NO_SEQ};
use o2_enterprise::enterprise::ai::chat::{
    AiChatEventRecord, Binding, ChatStore, batcher::DurableEvent,
};
use tokio::sync::OnceCell;

// One cell per org: concurrent first writers wait on the same initialization
// (as `llm_scores_schema` does), success is a node-lifetime no-op, and a
// failure leaves the cell empty so the next write retries.
static INITIALIZED_ORGS: Lazy<DashMap<String, Arc<OnceCell<()>>>> = Lazy::new(DashMap::new);

const SESSION_FIELD: &str = "session_id";

/// The storage a running chat turn writes through: durable events into the
/// org's protected `_o2_ai_chat_events` stream (via the internal ingestion
/// path — directly on an ingester, over gRPC to one otherwise), and the
/// session index in the meta DB.
pub struct StreamChatStore {
    retention_days: i64,
}

impl StreamChatStore {
    pub fn new(retention_days: i64) -> Self {
        Self { retention_days }
    }
}

#[async_trait::async_trait]
impl ChatStore for StreamChatStore {
    async fn write_events(&self, org_id: &str, records: Vec<AiChatEventRecord>) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        ensure_stream_initialized(org_id, self.retention_days).await;
        let values = records
            .iter()
            .map(config::utils::json::to_value)
            .collect::<Result<Vec<_>, _>>()?;
        let stream = StreamParams::new(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs);
        crate::self_reporting::ingest_internal_logs(values, stream).await
    }

    async fn bind_opencode_session(
        &self,
        org_id: &str,
        session_id: &str,
        opencode_session_id: &str,
    ) -> Result<Binding> {
        ai_chat_sessions::bind_opencode_session(
            org_id,
            session_id,
            opencode_session_id,
            now_micros(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn advance_watermark(
        &self,
        org_id: &str,
        session_id: &str,
        epoch: i64,
        expected_prev_seq: i64,
        new_seq: i64,
        first_event_at: i64,
        last_event_at: i64,
    ) -> Result<bool> {
        ai_chat_sessions::advance_watermark(
            org_id,
            session_id,
            epoch,
            expected_prev_seq,
            new_seq,
            first_event_at,
            last_event_at,
            now_micros(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn set_auto_title(&self, org_id: &str, session_id: &str, title: &str) -> Result<()> {
        ai_chat_sessions::set_auto_title(org_id, session_id, title, now_micros())
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn bump_epoch(
        &self,
        org_id: &str,
        session_id: &str,
        expected_epoch: i64,
    ) -> Result<Option<i64>> {
        ai_chat_sessions::bump_epoch(org_id, session_id, expected_epoch, now_micros())
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))
    }

    async fn read_committed_events(
        &self,
        org_id: &str,
        session_id: &str,
        after_seq: i64,
    ) -> Result<Vec<DurableEvent>> {
        let row = ai_chat_sessions::get(org_id, session_id)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .ok_or_else(|| anyhow::anyhow!("unknown chat session {session_id}"))?;
        Ok(read_committed_events(&row, after_seq).await?)
    }
}

/// Events per read window. A window is a `seq` range, so every copy of a
/// retried (duplicated) event lands in the same window and is compared there.
const READ_WINDOW: i64 = 500;
/// Search-visibility lag is retried this many times before a missing committed
/// event is reported as an integrity failure.
const READ_RETRIES: u32 = 4;

/// Why committed history could not be read back intact.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    /// Committed events are missing (after retrying for visibility lag).
    #[error("committed history has a gap: expected seq {expected}, found {found:?}")]
    Gap { expected: i64, found: Option<i64> },
    /// Two stored copies of one seq differ — never resolved by picking one.
    #[error("seq {seq} is stored with different contents ({a} vs {b})")]
    Divergence { seq: i64, a: String, b: String },
    /// A stored row does not verify against its own hash, or cannot be decoded.
    #[error("stored event is corrupt: {0}")]
    Corrupt(String),
    #[error("the index row claims committed events but no time range")]
    NoTimeRange,
    #[error("reading the chat-events stream failed: {0}")]
    Search(String),
}

impl ReadError {
    fn reason(&self) -> &'static str {
        match self {
            ReadError::Gap { .. } => "gap",
            ReadError::Divergence { .. } => "divergence",
            ReadError::Corrupt(_) => "hash",
            ReadError::NoTimeRange => "index",
            ReadError::Search(_) => "search",
        }
    }
}

/// A chat's committed durable events with `seq > after_seq` through its
/// committed watermark: ascending, one per seq, each verified against its
/// stored hash, and contiguous. Anything less is an error — a shortened
/// history is never returned as if it were complete (design §9.3, §12.3).
pub async fn read_committed_events(
    row: &ai_chat_sessions::Model,
    after_seq: i64,
) -> std::result::Result<Vec<DurableEvent>, ReadError> {
    Ok(read_verified(row, after_seq)
        .await?
        .into_iter()
        .map(|(_, event)| event)
        .collect())
}

/// [`read_committed_events`], as the stored rows (each verified) with the
/// events they hold.
async fn read_verified(
    row: &ai_chat_sessions::Model,
    after_seq: i64,
) -> std::result::Result<Vec<(AiChatEventRecord, DurableEvent)>, ReadError> {
    let result = read_committed_inner(row, after_seq).await;
    if let Err(e) = &result {
        metrics::AI_CHAT_READ_INTEGRITY_ERRORS_TOTAL
            .with_label_values(&[&row.org_id, e.reason()])
            .inc();
        log::error!(
            "[AI-CHAT] cannot read committed history of {}/{} (after seq {after_seq}, \
             committed {}): {e}",
            row.org_id,
            row.session_id,
            row.last_committed_seq
        );
    }
    result
}

async fn read_committed_inner(
    row: &ai_chat_sessions::Model,
    after_seq: i64,
) -> std::result::Result<Vec<(AiChatEventRecord, DurableEvent)>, ReadError> {
    let last = row.last_committed_seq;
    if last <= after_seq.max(NO_SEQ) {
        return Ok(Vec::new());
    }
    let (Some(first_at), Some(last_at)) = (row.first_event_at, row.last_event_at) else {
        return Err(ReadError::NoTimeRange);
    };

    let mut events = Vec::with_capacity((last - after_seq.max(NO_SEQ)) as usize);
    let mut lo = after_seq.max(NO_SEQ);
    while lo < last {
        let hi = (lo + READ_WINDOW).min(last);
        let mut attempt = 0;
        let window = loop {
            let rows = search_window(row, lo, hi, first_at, last_at).await?;
            match verify_window(rows, lo, hi) {
                // Visibility lag: what was acknowledged may not be searchable yet.
                Err(ReadError::Gap { .. }) if attempt < READ_RETRIES => {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(100 << attempt)).await;
                }
                other => break other?,
            }
        };
        events.extend(window);
        lo = hi;
    }
    Ok(events)
}

async fn search_window(
    row: &ai_chat_sessions::Model,
    lo: i64,
    hi: i64,
    first_at: i64,
    last_at: i64,
) -> std::result::Result<Vec<AiChatEventRecord>, ReadError> {
    // The session id is validated as a UUID at the API; escaped regardless.
    let session = row.session_id.replace('\'', "''");
    let sql = format!(
        "SELECT * FROM \"{AI_CHAT_EVENTS_STREAM}\" WHERE session_id = '{session}' \
         AND seq > {lo} AND seq <= {hi} ORDER BY seq ASC"
    );
    let req = SearchRequest {
        query: Query {
            sql,
            from: 0,
            size: -1,
            start_time: first_at,
            // Inclusive of the last committed batch's timestamp.
            end_time: last_at + 1,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
            timezone: None,
        },
        encoding: RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: Some(SearchEventType::Other),
        search_event_context: None,
        // Never serve chat history from the result cache: it must reflect the
        // committed watermark exactly.
        use_cache: false,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = as_chat_history_reader(crate::search::search(
        &trace_id,
        &row.org_id,
        StreamType::Logs,
        None,
        &req,
    ))
    .await
    .map_err(|e| ReadError::Search(e.to_string()))?;
    if resp.is_partial {
        return Err(ReadError::Search(format!(
            "partial response: {}",
            resp.function_error.join(", ")
        )));
    }
    resp.hits
        .into_iter()
        .map(|hit| {
            json::from_value::<AiChatEventRecord>(hit)
                .map_err(|e| ReadError::Corrupt(format!("undecodable row: {e}")))
        })
        .collect()
}

/// Deduplicate one window's rows by seq and check it covers `(lo, hi]`.
fn verify_window(
    rows: Vec<AiChatEventRecord>,
    lo: i64,
    hi: i64,
) -> std::result::Result<Vec<(AiChatEventRecord, DurableEvent)>, ReadError> {
    let mut by_seq: BTreeMap<i64, AiChatEventRecord> = BTreeMap::new();
    for row in rows {
        if row.seq <= lo || row.seq > hi {
            continue;
        }
        match by_seq.get(&row.seq) {
            // A retried batch: byte-identical copies are expected.
            Some(kept) if kept.event_hash == row.event_hash => {}
            Some(kept) => {
                return Err(ReadError::Divergence {
                    seq: row.seq,
                    a: kept.event_hash.clone(),
                    b: row.event_hash,
                });
            }
            None => {
                by_seq.insert(row.seq, row);
            }
        }
    }
    let mut events = Vec::with_capacity(by_seq.len());
    for (expected, (seq, row)) in (lo + 1..=hi).zip(by_seq) {
        if seq != expected {
            return Err(ReadError::Gap {
                expected,
                found: Some(seq),
            });
        }
        let event = row
            .to_verified_event()
            .map_err(|e| ReadError::Corrupt(e.to_string()))?;
        events.push((row, event));
    }
    if events.len() as i64 != hi - lo {
        return Err(ReadError::Gap {
            expected: lo + 1 + events.len() as i64,
            found: None,
        });
    }
    Ok(events)
}

/// Rewrite a chat's committed history with fresh timestamps so it does not
/// age out of the chat-events stream while the chat is in use (see the
/// `ai_chat_retention` job). The copies are byte-identical rows — same seq,
/// same hash — so readers deduplicate them; once all are written, the chat's
/// read window moves to them. The caller holds the chat's turn lease.
/// Returns how many events were rewritten.
pub async fn refresh_chat_history(
    row: &ai_chat_sessions::Model,
    retention_days: i64,
) -> Result<usize> {
    let records = read_verified(row, NO_SEQ).await?;
    if records.is_empty() {
        return Ok(0);
    }
    ensure_stream_initialized(&row.org_id, retention_days).await;
    let stream = StreamParams::new(&row.org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs);
    let first = now_micros();
    let mut last = first;
    for chunk in records.chunks(REFRESH_BATCH) {
        last = now_micros().max(last);
        let values = chunk
            .iter()
            .map(|(record, _)| {
                let mut copy = record.clone();
                copy.timestamp = last;
                json::to_value(copy)
            })
            .collect::<Result<Vec<_>, _>>()?;
        crate::self_reporting::ingest_internal_logs(values, stream.clone()).await?;
    }
    ai_chat_sessions::set_refreshed_range(&row.org_id, &row.session_id, first, last)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(records.len())
}

const REFRESH_BATCH: usize = 500;

/// Split a chat's events into chunks of whole turns, each at most
/// `max_events` long unless a single turn is longer. A turn starts at the
/// first `message.updated` of a user message; o2-ai projects each chunk on
/// its own, so no request grows with the length of the conversation.
pub fn turn_chunks(events: &[DurableEvent], max_events: usize) -> Vec<&[DurableEvent]> {
    let mut starts = vec![0usize];
    let mut seen_users = std::collections::HashSet::new();
    for (i, event) in events.iter().enumerate() {
        if !event.event_type.starts_with("message.updated") {
            continue;
        }
        let info = &event.data["info"];
        if info["role"] == "user"
            && let Some(id) = info["id"].as_str()
            && seen_users.insert(id.to_string())
            && i > 0
        {
            starts.push(i);
        }
    }
    starts.push(events.len());

    let mut chunks = Vec::new();
    let mut chunk_start = 0;
    for window in starts.windows(2) {
        let (turn_start, turn_end) = (window[0], window[1]);
        if turn_end - chunk_start > max_events.max(1) && turn_start > chunk_start {
            chunks.push(&events[chunk_start..turn_start]);
            chunk_start = turn_start;
        }
    }
    if chunk_start < events.len() {
        chunks.push(&events[chunk_start..]);
    }
    chunks
}

fn expected_schema() -> Result<arrow_schema::Schema> {
    let sample = config::utils::json::to_value(AiChatEventRecord::init_for_reflection())?;
    // Ingestion flattens records before inferring a schema; mirror that so
    // every column is initialized the same way it will be written.
    let sample = config::utils::flatten::flatten(sample)?;
    let sample = sample
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("AiChatEventRecord did not serialize to an object"))?;
    Ok(config::utils::schema::infer_json_schema_from_map(
        AI_CHAT_EVENTS_STREAM,
        StreamType::Logs,
        std::iter::once(sample),
    )?)
}

/// Create the org's chat-events stream with the expected schema and settings.
/// Idempotent and cheap after the first call per org; a failure is logged and
/// retried on the next write (ingestion can infer the schema on its own, so
/// persistence does not depend on this succeeding).
pub async fn ensure_stream_initialized(org_id: &str, retention_days: i64) {
    let cell = INITIALIZED_ORGS
        .entry(org_id.to_string())
        .or_insert_with(|| Arc::new(OnceCell::new()))
        .clone();
    let _ = cell
        .get_or_try_init(|| async {
            initialize_schema(org_id).await.inspect_err(|e| {
                log::warn!(
                    "[AI-CHAT] Failed to initialize {AI_CHAT_EVENTS_STREAM} schema for org {org_id}: {e}"
                )
            })?;
            initialize_settings(org_id, retention_days)
                .await
                .inspect_err(|e| {
                    log::warn!(
                        "[AI-CHAT] Failed to apply {AI_CHAT_EVENTS_STREAM} settings for org {org_id}: {e}"
                    )
                })
        })
        .await;
}

async fn initialize_schema(org_id: &str) -> Result<()> {
    let expected = expected_schema()?;
    if infra::schema::get(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected))
    {
        return Ok(());
    }
    crate::db::schema::merge(
        org_id,
        AI_CHAT_EVENTS_STREAM,
        StreamType::Logs,
        &expected,
        Some(now_micros()),
    )
    .await
    .map(|_| {
        log::info!(
            "[AI-CHAT] Created {AI_CHAT_EVENTS_STREAM} schema for org {org_id} ({} fields)",
            expected.fields().len()
        );
    })
    .map_err(|e| anyhow::anyhow!("schema merge failed: {e}"))
}

async fn initialize_settings(org_id: &str, retention_days: i64) -> Result<()> {
    let mut settings = infra::schema::get_settings(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs)
        .await
        .map(|settings| (*settings).clone())
        .unwrap_or_default();
    if !apply_settings(&mut settings, retention_days, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs, settings).await?;
    Ok(())
}

/// A bloom filter and a secondary index on `session_id` make the per-session
/// reads the Chat API does cheap; retention is applied only when configured.
/// Returns whether anything changed.
fn apply_settings(settings: &mut StreamSettings, retention_days: i64, now: i64) -> bool {
    let mut changed = false;
    if !settings
        .bloom_filter_fields
        .iter()
        .any(|f| f == SESSION_FIELD)
    {
        settings.bloom_filter_fields.push(SESSION_FIELD.to_string());
        changed = true;
    }
    if !settings.index_fields.iter().any(|f| f == SESSION_FIELD) {
        settings.index_fields.push(SESSION_FIELD.to_string());
        settings
            .index_fields_updated_at
            .insert(SESSION_FIELD.to_string(), now);
        changed = true;
    }
    if retention_days > 0 && settings.data_retention != retention_days {
        settings.data_retention = retention_days;
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_schema_has_a_text_payload_and_every_column() {
        let schema = expected_schema().unwrap();
        for field in [
            "_timestamp",
            "org_id",
            "user_id",
            "session_id",
            "opencode_session_id",
            "session_epoch",
            "turn_id",
            "seq",
            "event_id",
            "event_type",
            "event_hash",
            "payload",
            "payload_bytes",
        ] {
            assert!(schema.field_with_name(field).is_ok(), "{field}");
        }
        // A JSON *string*: flattening a nested object here would create a
        // column per message/part field the model ever emits.
        assert_eq!(
            schema.field_with_name("payload").unwrap().data_type(),
            &arrow_schema::DataType::Utf8
        );
        assert_eq!(schema.fields().len(), 13);
    }

    fn stored(seq: i64, data: &str) -> AiChatEventRecord {
        let ctx = o2_enterprise::enterprise::ai::chat::RecordContext {
            org_id: "org".into(),
            user_id: "u".into(),
            session_id: "sid".into(),
            opencode_session_id: "ses_A".into(),
            session_epoch: 1,
            turn_id: "t".into(),
        };
        let event = DurableEvent {
            id: format!("evt_{seq}"),
            aggregate_id: "ses_A".into(),
            seq,
            event_type: "message.part.updated.1".into(),
            data: json::json!({ "d": data }),
        };
        o2_enterprise::enterprise::ai::chat::record::to_record(&ctx, &event, 1)
    }

    #[test]
    fn a_window_is_deduplicated_and_verified() {
        // Retried batch: seq 2 stored twice, identically; order is irrelevant.
        let rows = vec![
            stored(2, "b"),
            stored(1, "a"),
            stored(2, "b"),
            stored(3, "c"),
        ];
        let events = verify_window(rows, 0, 3).unwrap();
        assert_eq!(
            events.iter().map(|(_, e)| e.seq).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn a_window_with_a_hole_or_a_short_tail_is_a_gap() {
        let hole = verify_window(vec![stored(1, "a"), stored(3, "c")], 0, 3);
        assert!(matches!(hole, Err(ReadError::Gap { expected: 2, .. })));
        let short = verify_window(vec![stored(1, "a"), stored(2, "b")], 0, 3);
        assert!(matches!(
            short,
            Err(ReadError::Gap {
                expected: 3,
                found: None
            })
        ));
    }

    #[test]
    fn two_different_copies_of_one_seq_are_never_resolved_silently() {
        let rows = vec![stored(1, "a"), stored(1, "tampered")];
        assert!(matches!(
            verify_window(rows, 0, 1),
            Err(ReadError::Divergence { seq: 1, .. })
        ));
    }

    #[test]
    fn a_row_that_does_not_match_its_hash_is_corrupt() {
        let mut row = stored(1, "a");
        row.payload = r#"{"d":"changed"}"#.into();
        assert!(matches!(
            verify_window(vec![row], 0, 1),
            Err(ReadError::Corrupt(_))
        ));
    }

    fn msg(seq: i64, role: &str, id: &str) -> DurableEvent {
        DurableEvent {
            id: format!("evt_{seq}"),
            aggregate_id: "ses_A".into(),
            seq,
            event_type: "message.updated.1".into(),
            data: json::json!({"info": {"id": id, "role": role}}),
        }
    }

    #[test]
    fn chunks_hold_whole_turns() {
        // turn 1: seq 0..=3, turn 2: 4..=6 (its user message updated twice), turn 3: 7..=8
        let events = vec![
            msg(0, "user", "u1"),
            msg(1, "assistant", "a1"),
            msg(2, "assistant", "a1"),
            msg(3, "assistant", "a1"),
            msg(4, "user", "u2"),
            msg(5, "user", "u2"),
            msg(6, "assistant", "a2"),
            msg(7, "user", "u3"),
            msg(8, "assistant", "a3"),
        ];
        let seqs = |chunks: Vec<&[DurableEvent]>| -> Vec<Vec<i64>> {
            chunks
                .iter()
                .map(|c| c.iter().map(|e| e.seq).collect())
                .collect()
        };
        assert_eq!(
            seqs(turn_chunks(&events, 5)),
            vec![vec![0, 1, 2, 3], vec![4, 5, 6, 7, 8]]
        );
        assert_eq!(
            seqs(turn_chunks(&events, 100)),
            vec![(0..=8).collect::<Vec<_>>()]
        );
        // A turn longer than the cap is sent alone, never split.
        assert_eq!(
            seqs(turn_chunks(&events, 2)),
            vec![vec![0, 1, 2, 3], vec![4, 5, 6], vec![7, 8]]
        );
        assert!(turn_chunks(&[], 10).is_empty());
    }

    #[test]
    fn settings_are_applied_once_and_retention_only_when_configured() {
        let mut settings = StreamSettings::default();
        assert!(apply_settings(&mut settings, 0, 5));
        assert_eq!(settings.bloom_filter_fields, vec![SESSION_FIELD]);
        assert_eq!(settings.index_fields, vec![SESSION_FIELD]);
        assert_eq!(
            settings.index_fields_updated_at.get(SESSION_FIELD),
            Some(&5)
        );
        assert!(!apply_settings(&mut settings, 0, 6));

        assert!(apply_settings(&mut settings, 30, 7));
        assert_eq!(settings.data_retention, 30);
        assert!(!apply_settings(&mut settings, 30, 8));
    }
}
