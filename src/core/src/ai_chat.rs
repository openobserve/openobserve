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

//! The `_o2_ai_chat_events` store behind persisted chat turns, and its verified reader.

pub mod projection;

use std::{
    collections::{BTreeMap, HashSet},
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
use infra::table::{
    ai_chat_sessions::{self, NO_SEQ, STATUS_ACTIVE},
    ai_chat_shares, ai_chat_turns,
};
use o2_enterprise::enterprise::ai::chat::{
    AiChatEventRecord, Binding, CancelReason, ChatStore, batcher::DurableEvent,
    record::assemble_event, registry,
};
use tokio::sync::OnceCell;

// A failed initialization leaves the org's cell empty, so the next write retries it.
static INITIALIZED_ORGS: Lazy<DashMap<String, Arc<OnceCell<()>>>> = Lazy::new(DashMap::new);

const SESSION_FIELD: &str = "session_id";
/// A window is a `seq` range, so every stored copy of one event is compared in the same window.
const READ_WINDOW: i64 = 500;
/// Search-visibility lag is retried this often before a missing committed event is an error.
const READ_RETRIES: u32 = 4;
const REFRESH_BATCH: usize = 500;

/// Writes a persisted turn's durable events to the org's protected stream and its session index.
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
        let now = now_micros();
        let advanced = ai_chat_sessions::advance_watermark(
            org_id,
            session_id,
            epoch,
            expected_prev_seq,
            new_seq,
            first_event_at,
            last_event_at,
            now,
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
        if advanced {
            metrics::AI_CHAT_PERSIST_LAG_MILLISECONDS
                .with_label_values(&[org_id])
                .set((now - first_event_at).max(0) / 1000);
        }
        Ok(advanced)
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

    async fn finish_turn(
        &self,
        org_id: &str,
        session_id: &str,
        turn_id: &str,
        status: &str,
        error_code: Option<&str>,
        start_seq: Option<i64>,
        end_seq: Option<i64>,
    ) -> Result<()> {
        let finished = ai_chat_turns::finish(
            org_id,
            session_id,
            turn_id,
            status,
            error_code,
            start_seq,
            end_seq,
            now_micros(),
        )
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
        if !finished {
            log::warn!(
                "[AI-CHAT] turn {turn_id} of {org_id}/{session_id} was no longer running \
                 when it ended as {status}"
            );
        }
        Ok(())
    }

    async fn is_deleted(&self, org_id: &str, session_id: &str) -> Result<bool> {
        let row = ai_chat_sessions::get(org_id, session_id)
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(row.is_none_or(|row| row.status != STATUS_ACTIVE))
    }
}

/// Why committed history could not be read back intact.
#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    /// Committed events are missing (after retrying for visibility lag).
    #[error("committed history has a gap: expected seq {expected}, found {found:?}")]
    Gap { expected: i64, found: Option<i64> },
    /// Two stored versions of one seq that no turn record or epoch tells apart.
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

/// One committed event: the stored rows (its parts, in order) it was assembled from.
pub type StoredEvent = (Vec<AiChatEventRecord>, DurableEvent);

/// Which stored rows count as a chat's committed history (contract R1).
#[derive(Debug, Default)]
struct Resolver {
    /// Rows of any other opencode session were written by an abandoned replica.
    opencode_session_id: Option<String>,
    epoch: i64,
    /// `(first_seq, last_seq, turn_id)` each recorded turn committed.
    coverage: Vec<(i64, i64, String)>,
}

impl Resolver {
    fn new(row: &ai_chat_sessions::Model, records: &[ai_chat_turns::Model]) -> Self {
        Self {
            opencode_session_id: row.opencode_session_id.clone(),
            epoch: row.session_epoch,
            coverage: turn_coverage(records, row.last_committed_seq),
        }
    }

    fn admits(&self, row: &AiChatEventRecord) -> bool {
        self.opencode_session_id
            .as_deref()
            .is_none_or(|bound| row.opencode_session_id == bound)
    }

    /// The turn that committed `seq`; the latest recorded one when ranges overlap.
    fn covering_turn(&self, seq: i64) -> Option<&str> {
        self.coverage
            .iter()
            .rev()
            .find(|(first, last, _)| (*first..=*last).contains(&seq))
            .map(|(.., turn)| turn.as_str())
    }

    /// The committed version of `seq` among its complete stored versions (`None`: not visible).
    fn pick<'a>(
        &self,
        seq: i64,
        versions: &'a [Version],
    ) -> std::result::Result<Option<&'a Version>, ReadError> {
        // Rows of any other turn at a seq a recorded turn committed are stray, whatever they hold.
        let candidates: Vec<&Version> = match self.covering_turn(seq) {
            Some(turn) => versions.iter().filter(|v| v.turn_id == turn).collect(),
            None => versions.iter().collect(),
        };
        if distinct_hashes(candidates.iter().copied()) <= 1 {
            // Empty: only strays are visible, the committing turn's rows are not yet.
            return Ok(candidates.first().copied());
        }
        let newest = candidates
            .iter()
            .map(|v| v.epoch)
            .filter(|epoch| *epoch <= self.epoch)
            .max();
        let newest: Vec<&Version> = candidates
            .iter()
            .copied()
            .filter(|v| Some(v.epoch) == newest)
            .collect();
        match distinct_hashes(newest.iter().copied()) {
            1 => Ok(newest.first().copied()),
            _ => Err(divergence(seq, candidates.into_iter())),
        }
    }
}

/// One stored version of an event: every part row a single write produced for it.
#[derive(Debug)]
struct Version {
    turn_id: String,
    epoch: i64,
    hash: String,
    parts: BTreeMap<i64, AiChatEventRecord>,
}

impl Version {
    fn is_complete(&self) -> bool {
        self.parts
            .values()
            .next()
            .is_some_and(|row| row.parts >= 1 && self.parts.len() as i64 == row.parts)
    }
}

/// A chat's verified, contiguous committed events past `after_seq`, or an error, never fewer.
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

/// Rewrites committed rows with fresh timestamps (caller holds the lease); returns how many.
pub async fn refresh_chat_history(
    org_id: &str,
    session_id: &str,
    retention_days: i64,
) -> Result<usize> {
    // Re-read under the lease: the row the caller listed may predate the last turn's commits.
    let Some(row) = ai_chat_sessions::get(org_id, session_id)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .filter(|row| row.status == STATUS_ACTIVE)
    else {
        return Ok(0);
    };
    let events = read_verified(&row, NO_SEQ).await?;
    if events.is_empty() {
        return Ok(0);
    }
    ensure_stream_initialized(org_id, retention_days).await;
    let stream = StreamParams::new(org_id, AI_CHAT_EVENTS_STREAM, StreamType::Logs);
    let rows: Vec<&AiChatEventRecord> = events.iter().flat_map(|(rows, _)| rows).collect();
    let first = now_micros();
    let mut last = first;
    for chunk in rows.chunks(REFRESH_BATCH) {
        last = now_micros().max(last);
        let values = chunk
            .iter()
            .map(|record| {
                let mut copy = (*record).clone();
                copy.timestamp = last;
                json::to_value(copy)
            })
            .collect::<Result<Vec<_>, _>>()?;
        crate::self_reporting::ingest_internal_logs(values, stream.clone()).await?;
    }
    let moved = ai_chat_sessions::set_refreshed_range(
        org_id,
        session_id,
        first,
        last,
        row.last_committed_seq,
    )
    .await
    .map_err(|e| anyhow::anyhow!("{e}"))?;
    if !moved {
        anyhow::bail!("the chat committed more events during the refresh; retried next pass");
    }
    Ok(events.len())
}

/// Delete every chat `user_id` owns in `org_id` as the user's own delete does; returns their ids.
pub async fn delete_all_for_user(org_id: &str, user_id: &str) -> Result<Vec<String>> {
    match ai_chat_sessions::active_ids_for_user(org_id, user_id).await {
        Ok(ids) => {
            for session_id in ids {
                registry::cancel(org_id, &session_id, CancelReason::Deleted);
            }
        }
        Err(e) => log::warn!("[AI-CHAT] cannot list chats of {org_id}/{user_id} to stop: {e}"),
    }
    let now = now_micros();
    let session_ids = ai_chat_sessions::mark_all_deleted(org_id, user_id, now)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    if !session_ids.is_empty()
        && let Err(e) = ai_chat_shares::revoke_for_sessions(org_id, &session_ids, now).await
    {
        // A share of a deleted chat is already unservable; this only tidies the rows.
        log::error!("[AI-CHAT] cannot revoke shares of deleted chats in {org_id}: {e}");
    }
    Ok(session_ids)
}

/// Split a chat's events into chunks of whole turns of at most `max_events` (a longer turn alone).
pub fn turn_chunks(events: &[DurableEvent], max_events: usize) -> Vec<&[DurableEvent]> {
    let mut starts = vec![0usize];
    let mut seen_users = HashSet::new();
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

/// Create the org's chat-events stream with the expected schema and settings, once per node.
pub async fn ensure_stream_initialized(org_id: &str, retention_days: i64) {
    let cell = INITIALIZED_ORGS
        .entry(org_id.to_string())
        .or_insert_with(|| Arc::new(OnceCell::new()))
        .clone();
    let _ = cell
        .get_or_try_init(|| async {
            purge_stream_alerts(org_id).await;
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

/// [`read_committed_events`], with the stored rows each event was assembled from.
async fn read_verified(
    row: &ai_chat_sessions::Model,
    after_seq: i64,
) -> std::result::Result<Vec<StoredEvent>, ReadError> {
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
) -> std::result::Result<Vec<StoredEvent>, ReadError> {
    let last = row.last_committed_seq;
    if last <= after_seq.max(NO_SEQ) {
        return Ok(Vec::new());
    }
    let (Some(first_at), Some(last_at)) = (row.first_event_at, row.last_event_at) else {
        return Err(ReadError::NoTimeRange);
    };
    let records = ai_chat_turns::list_for_session(&row.org_id, &row.session_id)
        .await
        .map_err(|e| ReadError::Search(format!("turn records: {e}")))?;
    let resolver = Resolver::new(row, &records);

    let mut events = Vec::with_capacity((last - after_seq.max(NO_SEQ)) as usize);
    let mut lo = after_seq.max(NO_SEQ);
    while lo < last {
        let hi = (lo + READ_WINDOW).min(last);
        let mut attempt = 0;
        let window = loop {
            let rows = search_window(row, lo, hi, first_at, last_at).await?;
            match verify_window(rows, lo, hi, &resolver) {
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
        // Chat history must reflect the committed watermark exactly, never a cached result.
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
    resp.hits.into_iter().map(decode_row).collect()
}

/// A search hit as a stored row; columns a file predates come back null and take their default.
fn decode_row(mut hit: json::Value) -> std::result::Result<AiChatEventRecord, ReadError> {
    if let Some(obj) = hit.as_object_mut() {
        obj.retain(|_, value| !value.is_null());
    }
    json::from_value::<AiChatEventRecord>(hit)
        .map_err(|e| ReadError::Corrupt(format!("undecodable row: {e}")))
}

/// Resolve one window's rows to the committed event of each seq and check `(lo, hi]` is covered.
fn verify_window(
    rows: Vec<AiChatEventRecord>,
    lo: i64,
    hi: i64,
    resolver: &Resolver,
) -> std::result::Result<Vec<StoredEvent>, ReadError> {
    let mut by_seq: BTreeMap<i64, Vec<Version>> = BTreeMap::new();
    for row in rows {
        if row.seq <= lo || row.seq > hi || !resolver.admits(&row) {
            continue;
        }
        add_part(by_seq.entry(row.seq).or_default(), row)?;
    }
    let mut events = Vec::with_capacity(by_seq.len());
    let mut expected = lo + 1;
    for (seq, mut versions) in by_seq {
        versions.retain(Version::is_complete);
        let Some(version) = resolver.pick(seq, &versions)? else {
            continue;
        };
        if seq != expected {
            return Err(ReadError::Gap {
                expected,
                found: Some(seq),
            });
        }
        let rows: Vec<AiChatEventRecord> = version.parts.values().cloned().collect();
        let event = assemble_event(&rows).map_err(|e| ReadError::Corrupt(e.to_string()))?;
        events.push((rows, event));
        expected += 1;
    }
    if expected <= hi {
        return Err(ReadError::Gap {
            expected,
            found: None,
        });
    }
    Ok(events)
}

/// File `row` under its version of the event; a retried write repeats parts byte for byte.
fn add_part(
    versions: &mut Vec<Version>,
    row: AiChatEventRecord,
) -> std::result::Result<(), ReadError> {
    let found = versions.iter_mut().find(|v| {
        v.turn_id == row.turn_id && v.epoch == row.session_epoch && v.hash == row.event_hash
    });
    let version = match found {
        Some(version) => version,
        None => {
            versions.push(Version {
                turn_id: row.turn_id.clone(),
                epoch: row.session_epoch,
                hash: row.event_hash.clone(),
                parts: BTreeMap::new(),
            });
            versions.last_mut().expect("just pushed")
        }
    };
    match version.parts.get(&row.part) {
        Some(kept) if kept.payload != row.payload || kept.parts != row.parts => {
            Err(ReadError::Divergence {
                seq: row.seq,
                a: kept.event_hash.clone(),
                b: format!("{} (part {} differs)", row.event_hash, row.part),
            })
        }
        Some(_) => Ok(()),
        None => {
            version.parts.insert(row.part, row);
            Ok(())
        }
    }
}

/// The seq range each turn record committed: its recorded end, else up to the next turn's start.
fn turn_coverage(records: &[ai_chat_turns::Model], last_committed: i64) -> Vec<(i64, i64, String)> {
    records
        .iter()
        .enumerate()
        .filter_map(|(i, record)| {
            let first = record.start_seq?;
            let last = record.end_seq.unwrap_or_else(|| {
                records[i + 1..]
                    .iter()
                    .find_map(|next| next.start_seq)
                    .map_or(last_committed, |next| next - 1)
            });
            (last >= first).then(|| (first, last, record.turn_id.clone()))
        })
        .collect()
}

fn distinct_hashes<'a>(versions: impl Iterator<Item = &'a Version>) -> usize {
    versions
        .map(|v| v.hash.as_str())
        .collect::<HashSet<_>>()
        .len()
}

fn divergence<'a>(seq: i64, mut versions: impl Iterator<Item = &'a Version>) -> ReadError {
    let a = versions.next().map(|v| v.hash.clone()).unwrap_or_default();
    let b = versions
        .find(|v| v.hash != a)
        .map(|v| v.hash.clone())
        .unwrap_or_default();
    ReadError::Divergence { seq, a, b }
}

/// Realtime alerts on the protected stream would hand every chat to the alert's destination.
async fn purge_stream_alerts(org_id: &str) {
    let key = format!("{org_id}/{}/{AI_CHAT_EVENTS_STREAM}", StreamType::Logs);
    if ::common::infra::config::STREAM_ALERTS
        .write()
        .await
        .remove(&key)
        .is_some()
    {
        log::warn!(
            "[AI-CHAT] dropped realtime alerts cached on {AI_CHAT_EVENTS_STREAM} of {org_id}"
        );
    }
}

fn expected_schema() -> Result<arrow_schema::Schema> {
    let sample = config::utils::json::to_value(AiChatEventRecord::init_for_reflection())?;
    // Ingestion flattens before inferring, so the schema is inferred the same way.
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

/// Bloom filter and index on `session_id`, and retention when set; `true` if anything changed.
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
    use infra::table::ai_chat_turns::{TURN_COMPLETED, TURN_FAILED, TURN_RUNNING};
    use o2_enterprise::enterprise::ai::chat::{RecordContext, record};

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
            "part",
            "parts",
        ] {
            assert!(schema.field_with_name(field).is_ok(), "{field}");
        }
        // A nested payload would be flattened into a column per field the model ever emits.
        assert_eq!(
            schema.field_with_name("payload").unwrap().data_type(),
            &arrow_schema::DataType::Utf8
        );
        assert_eq!(schema.fields().len(), 15);
    }

    fn ctx(opencode: &str, epoch: i64, turn: &str) -> RecordContext {
        RecordContext {
            org_id: "org".into(),
            user_id: "u".into(),
            session_id: "sid".into(),
            opencode_session_id: opencode.into(),
            session_epoch: epoch,
            turn_id: turn.into(),
        }
    }

    fn event(seq: i64, data: &str, opencode: &str) -> DurableEvent {
        DurableEvent {
            id: format!("evt_{seq}_{data}"),
            aggregate_id: opencode.into(),
            seq,
            event_type: "message.part.updated.1".into(),
            data: json::json!({ "d": data }),
        }
    }

    fn written(seq: i64, data: &str, opencode: &str, epoch: i64, turn: &str) -> AiChatEventRecord {
        record::to_record(&ctx(opencode, epoch, turn), &event(seq, data, opencode), 1)
    }

    fn stored(seq: i64, data: &str) -> AiChatEventRecord {
        written(seq, data, "ses_A", 1, "t")
    }

    fn resolver(epoch: i64, coverage: &[(i64, i64, &str)]) -> Resolver {
        Resolver {
            opencode_session_id: Some("ses_A".into()),
            epoch,
            coverage: coverage
                .iter()
                .map(|(first, last, turn)| (*first, *last, turn.to_string()))
                .collect(),
        }
    }

    fn data_of(events: &[StoredEvent]) -> Vec<String> {
        events
            .iter()
            .map(|(_, e)| e.data["d"].as_str().unwrap().to_string())
            .collect()
    }

    fn turn_record(
        turn: &str,
        status: &str,
        start: Option<i64>,
        end: Option<i64>,
    ) -> ai_chat_turns::Model {
        ai_chat_turns::Model {
            org_id: "org".into(),
            session_id: "sid".into(),
            turn_id: turn.into(),
            status: status.into(),
            error_code: None,
            start_seq: start,
            end_seq: end,
            started_at: 0,
            ended_at: None,
        }
    }

    #[test]
    fn a_window_is_deduplicated_and_verified() {
        let rows = vec![
            stored(2, "b"),
            stored(1, "a"),
            stored(2, "b"),
            stored(3, "c"),
        ];
        let events = verify_window(rows, 0, 3, &resolver(1, &[])).unwrap();
        assert_eq!(
            events.iter().map(|(_, e)| e.seq).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn a_window_with_a_hole_or_a_short_tail_is_a_gap() {
        let hole = verify_window(
            vec![stored(1, "a"), stored(3, "c")],
            0,
            3,
            &resolver(1, &[]),
        );
        assert!(matches!(hole, Err(ReadError::Gap { expected: 2, .. })));
        let short = verify_window(
            vec![stored(1, "a"), stored(2, "b")],
            0,
            3,
            &resolver(1, &[]),
        );
        assert!(matches!(
            short,
            Err(ReadError::Gap {
                expected: 3,
                found: None
            })
        ));
    }

    #[test]
    fn two_different_copies_from_one_writer_are_never_resolved_silently() {
        let rows = vec![stored(1, "a"), stored(1, "tampered")];
        assert!(matches!(
            verify_window(rows, 0, 1, &resolver(1, &[])),
            Err(ReadError::Divergence { seq: 1, .. })
        ));
    }

    #[test]
    fn a_row_that_does_not_match_its_hash_is_corrupt() {
        let mut row = stored(1, "a");
        row.payload = r#"{"d":"changed"}"#.into();
        assert!(matches!(
            verify_window(vec![row], 0, 1, &resolver(1, &[])),
            Err(ReadError::Corrupt(_))
        ));
    }

    #[test]
    fn rows_of_an_abandoned_opencode_session_are_ignored() {
        // A first turn wrote 0..=1 under ses_B, then a retry bound the chat to ses_A.
        let rows = vec![
            written(0, "stray0", "ses_B", 1, "t1"),
            written(1, "stray1", "ses_B", 1, "t1"),
            written(0, "a", "ses_A", 2, "t1"),
            written(1, "b", "ses_A", 2, "t1"),
        ];
        let events = verify_window(rows, -1, 1, &resolver(2, &[(0, 1, "t1")])).unwrap();
        assert_eq!(data_of(&events), vec!["a", "b"]);
    }

    #[test]
    fn rows_of_a_turn_that_never_committed_them_are_stray() {
        // t2 wrote 2..=3 but was fenced before its watermark; t3 regenerated and committed 2..=3.
        let records = vec![
            turn_record("t1", TURN_COMPLETED, Some(0), Some(1)),
            turn_record("t2", TURN_FAILED, Some(2), None),
            turn_record("t3", TURN_COMPLETED, Some(2), Some(3)),
        ];
        let resolver = Resolver {
            opencode_session_id: Some("ses_A".into()),
            epoch: 3,
            coverage: turn_coverage(&records, 3),
        };
        let rows = vec![
            written(0, "a", "ses_A", 1, "t1"),
            written(1, "b", "ses_A", 1, "t1"),
            written(2, "stray", "ses_A", 2, "t2"),
            written(3, "stray", "ses_A", 2, "t2"),
            written(2, "c", "ses_A", 3, "t3"),
            written(3, "d", "ses_A", 3, "t3"),
        ];
        let events = verify_window(rows.clone(), -1, 3, &resolver).unwrap();
        assert_eq!(data_of(&events), vec!["a", "b", "c", "d"]);
        // Only the strays visible yet: that is lag, retried as a gap, never served.
        let lagging: Vec<_> = rows.into_iter().filter(|r| r.turn_id != "t3").collect();
        assert!(matches!(
            verify_window(lagging, -1, 3, &resolver),
            Err(ReadError::Gap { expected: 2, .. })
        ));
    }

    #[test]
    fn a_running_turn_covers_up_to_the_watermark() {
        let records = vec![
            turn_record("t1", TURN_COMPLETED, Some(0), Some(0)),
            turn_record("t2", TURN_RUNNING, Some(1), None),
        ];
        assert_eq!(
            turn_coverage(&records, 4),
            vec![(0, 0, "t1".to_string()), (1, 4, "t2".to_string())]
        );
        // A turn that stored nothing covers nothing; the next one starts where it did.
        let records = vec![
            turn_record("t1", TURN_FAILED, Some(0), None),
            turn_record("t2", TURN_COMPLETED, Some(0), Some(2)),
        ];
        assert_eq!(turn_coverage(&records, 2), vec![(0, 2, "t2".to_string())]);
    }

    #[test]
    fn without_a_turn_record_the_newest_epoch_wins() {
        let rows = vec![
            written(0, "old", "ses_A", 1, "x"),
            written(0, "new", "ses_A", 2, "y"),
            written(0, "future", "ses_A", 9, "z"),
        ];
        let events = verify_window(rows, -1, 0, &resolver(2, &[])).unwrap();
        assert_eq!(data_of(&events), vec!["new"]);
    }

    #[test]
    fn a_split_event_is_reassembled_from_its_parts_in_any_order() {
        let big = event(0, &"é".repeat(300), "ses_A");
        let mut rows = record::to_records(&ctx("ses_A", 1, "t"), &big, 1, 64);
        assert!(rows.len() > 3);
        let parts = rows.clone();
        rows.reverse();
        rows.push(parts[1].clone());
        let events = verify_window(rows, -1, 0, &resolver(1, &[])).unwrap();
        assert_eq!(events[0].1, big);
        assert_eq!(events[0].0, parts);
        // A part not visible yet leaves the event missing, never truncated.
        let partial = parts[1..].to_vec();
        assert!(matches!(
            verify_window(partial, -1, 0, &resolver(1, &[])),
            Err(ReadError::Gap { expected: 0, .. })
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
