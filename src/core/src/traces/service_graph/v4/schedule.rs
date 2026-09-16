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

//! Stream discovery, org gate, claim, learning trigger and the per-stream window loop.

use std::sync::{Arc, atomic::Ordering};

use config::{
    cluster::LOCAL_NODE,
    meta::stream::StreamType,
    utils::time::{SECOND_MICRO_SECS, now_micros},
};
use futures::StreamExt;
use infra::{cluster::get_node_by_uuid, dist_lock};
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

use super::{
    LEARN_INTERVAL_SECS, MAX_BACKLOG_MICROS, MAX_WINDOWS_PER_TICK, ORG_RETAINED, ORG_TABLES,
    RETAINED, SNAPSHOT_INTERVAL_SECS, STARTED_AT_WRITTEN, STREAM_STATES, Settings, TableRef,
    resolution::{ResolutionTable, read_snapshot_file, snapshot_path, write_snapshot_file},
    resolve::{CONNECTION_MODEL, CONNECTION_TOOL, SeriesKey, Staging},
    sql::{
        AgentEdgeRow, AgentForm, Columns, PairingRow, Q0Row, Q1Row, Q2Row, Q3Row, Q4Row,
        SelfIdentityRow, WindowCounts, agent_form, build_pairing_query, build_q0, build_q1,
        build_q2, build_q3, build_q4, build_q5, build_q6, build_self_identity_query,
        validate_stream_name,
    },
    state::{Batch, StreamState},
    stream_concurrency, writer,
};
use crate::{
    db::service_graph::{get_v4_offset, set_started_at_if_absent, set_v4_offset, v4_offset_key},
    traces::service_graph::run_graph_search,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimDecision {
    Skip,
    Owned,
    Claim,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// The two identity-learning passes of design §4.3: self keys (Q1k) and sampled pairing (QL).
enum LearnKind {
    SelfIdentity,
    Pairing,
}

struct StreamJob {
    org: String,
    stream: String,
    offset: i64,
    table: TableRef,
}

struct WindowRows {
    q1: Vec<Q1Row>,
    q2: Vec<Q2Row>,
    q3: Vec<Q3Row>,
    q4: Vec<Q4Row>,
    q5: Vec<AgentEdgeRow>,
    q6: Vec<AgentEdgeRow>,
}

/// The four cases of design §8.3: unclaimed, ours, another live node's, a dead node's.
pub fn claim_decision(node: &str, local: &str, node_alive: bool) -> ClaimDecision {
    if node.is_empty() {
        ClaimDecision::Claim
    } else if node == local {
        ClaimDecision::Owned
    } else if node_alive {
        ClaimDecision::Skip
    } else {
        ClaimDecision::Claim
    }
}

pub fn align_down(ts: i64, flush: i64) -> i64 {
    ts - ts.rem_euclid(flush.max(1))
}

pub fn initial_offset(offset: i64, horizon: i64, flush: i64, max_backlog: i64) -> (i64, bool) {
    if offset == 0 {
        (align_down(horizon, flush), false)
    } else if horizon - offset > max_backlog {
        (align_down(horizon, flush), true)
    } else {
        (offset, false)
    }
}

pub fn window_ends(offset: i64, horizon: i64, flush: i64, max_windows: usize) -> Vec<i64> {
    let flush = flush.max(1);
    let mut ends = vec![];
    let mut end = offset + flush;
    while end <= horizon && ends.len() < max_windows {
        ends.push(end);
        end += flush;
    }
    ends
}

/// A pairing pass that was needed but failed keeps its trigger so the range is retried, not
/// skipped.
pub fn settle_ql_trigger(
    table: &mut ResolutionTable,
    need_ql: bool,
    pairing_ok: bool,
    horizon: i64,
) {
    if !need_ql {
        table.pairing_up_to = table.pairing_up_to.max(horizon);
    } else if pairing_ok {
        table.has_unresolved = false;
    }
}

pub async fn run_tick(settings: &Settings) {
    let now = now_micros();
    let discovered = discover().await;

    let mut jobs = vec![];
    for (org, streams) in discovered {
        if !org_allowed(&org).await {
            continue;
        }
        let mut claimed = vec![];
        for stream in &streams {
            if let Some(offset) = claim_stream(&org, stream).await {
                claimed.push((stream.clone(), offset));
            }
        }
        if claimed.is_empty() {
            continue;
        }
        let offsets: Vec<i64> = claimed.iter().map(|(_, o)| *o).collect();
        let table = org_table(&org, &offsets, settings, now).await;
        let learn_due =
            now - table.read().await.last_learn_at >= LEARN_INTERVAL_SECS * SECOND_MICRO_SECS;
        if learn_due {
            learn_org(&org, &streams, &table, settings, now).await;
        }
        snapshot_if_due(&org, &table, now).await;
        jobs.extend(claimed.into_iter().map(|(stream, offset)| StreamJob {
            org: org.clone(),
            stream,
            offset,
            table: table.clone(),
        }));
    }

    let settings = *settings;
    futures::stream::iter(jobs)
        .for_each_concurrent(stream_concurrency(), |job| async move {
            process_stream(job, &settings, now).await;
        })
        .await;
}

async fn discover() -> Vec<(String, Vec<String>)> {
    let orgs = match crate::organization::list_all_orgs(None).await {
        Ok(orgs) => orgs,
        Err(e) => {
            log::error!("[ServiceGraph] org list failed, skipping tick: {e}");
            return vec![];
        }
    };
    let mut grouped = crate::db::schema::list_all_streams_grouped().await;
    let mut out = vec![];
    for org in orgs {
        let Some(streams) = grouped
            .get_mut(&org.identifier)
            .and_then(|types| types.remove(&StreamType::Traces))
        else {
            continue;
        };
        let valid: Vec<String> = streams
            .into_iter()
            .filter(|s| {
                let ok = validate_stream_name(s);
                if !ok {
                    log::warn!(
                        "[ServiceGraph] {}/{s}: invalid stream name, skipped",
                        org.identifier
                    );
                }
                ok
            })
            .collect();
        if !valid.is_empty() {
            out.push((org.identifier, valid));
        }
    }
    out
}

/// Mirrors the two sources `check_ingestion_allowed` reads; that function is ingester-only.
async fn org_allowed(org: &str) -> bool {
    if crate::db::file_list::BLOCKED_ORGS.contains(org) {
        return false;
    }
    #[cfg(feature = "cloud")]
    match crate::organization::is_org_in_free_trial_period(org).await {
        Ok(true) => {}
        Ok(false) => return false,
        Err(e) => {
            log::warn!("[ServiceGraph] org {org}: trial check failed, skipped this tick: {e}");
            return false;
        }
    }
    true
}

async fn claim_stream(org: &str, stream: &str) -> Option<i64> {
    let (offset, node) = get_v4_offset(org, stream).await;
    match claim_decision(&node, &LOCAL_NODE.uuid, node_alive(&node).await) {
        ClaimDecision::Skip => None,
        ClaimDecision::Owned => Some(offset),
        ClaimDecision::Claim => claim_under_lock(org, stream).await,
    }
}

async fn node_alive(node: &str) -> bool {
    !node.is_empty() && node != LOCAL_NODE.uuid && get_node_by_uuid(node).await.is_some()
}

/// Re-reads the offset inside the lock because another scheduler may have claimed it first.
async fn claim_under_lock(org: &str, stream: &str) -> Option<i64> {
    let key = v4_offset_key(org, stream);
    let locker = match dist_lock::lock(&key, 0).await {
        Ok(l) => l,
        Err(e) => {
            log::warn!("[ServiceGraph] {org}/{stream}: claim lock failed: {e}");
            return None;
        }
    };
    let (offset, node) = get_v4_offset(org, stream).await;
    let decision = claim_decision(&node, &LOCAL_NODE.uuid, node_alive(&node).await);
    let claimed = if decision == ClaimDecision::Skip {
        None
    } else {
        match set_v4_offset(org, stream, offset, &LOCAL_NODE.uuid).await {
            Ok(()) => Some(offset),
            Err(e) => {
                log::warn!("[ServiceGraph] {org}/{stream}: claim write failed: {e}");
                None
            }
        }
    };
    if let Err(e) = dist_lock::unlock(&locker).await {
        log::warn!("[ServiceGraph] {org}/{stream}: claim unlock failed: {e}");
    }
    claimed
}

async fn org_table(org: &str, claimed_offsets: &[i64], settings: &Settings, now: i64) -> TableRef {
    if let Some(t) = ORG_TABLES.get(org) {
        return t.clone();
    }
    let path = snapshot_path(org);
    let loaded = tokio::task::spawn_blocking(move || read_snapshot_file(&path, now))
        .await
        .ok()
        .flatten();
    // learning never reaches further back than the offset backlog jump does
    let floor = now - MAX_BACKLOG_MICROS;
    let mut table = loaded.unwrap_or_else(|| {
        let boundary = ResolutionTable::cold_start_boundary(claimed_offsets, settings.horizon(now));
        ResolutionTable::new(boundary, boundary)
    });
    table.self_identity_up_to = table.self_identity_up_to.max(floor);
    table.pairing_up_to = table.pairing_up_to.max(floor);
    table.last_snapshot_at = now;
    let table = Arc::new(RwLock::new(table));
    ORG_TABLES.insert(org.to_string(), table.clone());
    table
}

async fn learn_org(org: &str, streams: &[String], table: &TableRef, settings: &Settings, now: i64) {
    let (self_identity_from, pairing_from, need_ql) = {
        let mut t = table.write().await;
        t.last_learn_at = now;
        t.learn_gen += 1;
        t.prune(now);
        (t.self_identity_up_to, t.pairing_up_to, t.has_unresolved)
    };
    let horizon = settings.horizon(now);
    let mut cols_by_stream = vec![];
    for stream in streams {
        match infra::schema::get(org, stream, StreamType::Traces).await {
            Ok(schema) => {
                let cols = Columns::from_schema(&schema);
                if cols.has_required() {
                    cols_by_stream.push((stream.clone(), cols));
                }
            }
            Err(e) => {
                log::warn!("[ServiceGraph] {org}/{stream}: schema unavailable for learning: {e}")
            }
        }
    }
    learn_chunks(
        org,
        &cols_by_stream,
        table,
        self_identity_from,
        horizon,
        now,
        LearnKind::SelfIdentity,
    )
    .await;
    let pairing_ok = if need_ql {
        learn_chunks(
            org,
            &cols_by_stream,
            table,
            pairing_from,
            horizon,
            now,
            LearnKind::Pairing,
        )
        .await
    } else {
        false
    };
    settle_ql_trigger(&mut *table.write().await, need_ql, pairing_ok, horizon);
}

/// `LEARN_INTERVAL` chunks; a boundary moves only after a fully successful chunk.
async fn learn_chunks(
    org: &str,
    streams: &[(String, Columns)],
    table: &TableRef,
    from: i64,
    horizon: i64,
    now: i64,
    kind: LearnKind,
) -> bool {
    let step = LEARN_INTERVAL_SECS * SECOND_MICRO_SECS;
    let mut start = from;
    while start < horizon {
        let end = (start + step).min(horizon);
        let mut hits = vec![];
        for (stream, cols) in streams {
            let sql = match kind {
                LearnKind::SelfIdentity => {
                    Some(build_self_identity_query(cols, stream, start, end))
                }
                LearnKind::Pairing => build_pairing_query(cols, stream, start, end),
            };
            let Some(sql) = sql else {
                continue;
            };
            match run_graph_search(org, sql, start, end).await {
                Ok(rows) => hits.extend(rows),
                Err(e) => {
                    log::warn!(
                        "[ServiceGraph] {org}/{stream}: {kind:?} learning failed at {start}: {e}"
                    );
                    return false;
                }
            }
        }
        match kind {
            LearnKind::SelfIdentity => {
                let rows: Vec<SelfIdentityRow> =
                    hits.iter().filter_map(SelfIdentityRow::parse).collect();
                let mut t = table.write().await;
                t.learn_self_identity(&rows, now);
                t.self_identity_up_to = end;
            }
            LearnKind::Pairing => {
                let rows: Vec<PairingRow> = hits.iter().filter_map(PairingRow::parse).collect();
                let mut t = table.write().await;
                t.learn_pairing(&rows, now);
                t.pairing_up_to = end;
            }
        }
        start = end;
    }
    true
}

async fn snapshot_if_due(org: &str, table: &TableRef, now: i64) {
    let snap = {
        let mut t = table.write().await;
        if now - t.last_snapshot_at < SNAPSHOT_INTERVAL_SECS * SECOND_MICRO_SECS {
            return;
        }
        t.last_snapshot_at = now;
        t.snapshot()
    };
    let path = snapshot_path(org);
    // JSON encoding of up to 200k keys happens off the lock and off the runtime threads
    let write = move || {
        let bytes = snap.to_json().map_err(std::io::Error::other)?;
        write_snapshot_file(&path, &bytes)
    };
    match tokio::task::spawn_blocking(write).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::warn!("[ServiceGraph] org {org}: snapshot write failed: {e}"),
        Err(e) => log::warn!("[ServiceGraph] org {org}: snapshot task failed: {e}"),
    }
}

async fn process_stream(job: StreamJob, settings: &Settings, now: i64) {
    let (org, stream) = (job.org.as_str(), job.stream.as_str());
    let state_arc = STREAM_STATES
        .entry((job.org.clone(), job.stream.clone()))
        .or_insert_with(|| Arc::new(Mutex::new(StreamState::new())))
        .clone();
    let mut state = state_arc.lock().await;

    if let Some(batch) = state.pending.take()
        && !deliver(org, stream, &mut state, batch).await
    {
        return;
    }
    apply_staging(org, stream, &mut state, &job.table, now).await;

    let horizon = settings.horizon(now);
    let flush = settings.flush_micros();
    let (offset, jumped) = initial_offset(job.offset, horizon, flush, MAX_BACKLOG_MICROS);
    if offset != job.offset {
        if jumped {
            log::warn!(
                "[ServiceGraph] {org}/{stream}: offset {} too far behind, jumping to {offset}",
                job.offset
            );
        }
        if let Err(e) = set_v4_offset(org, stream, offset, &LOCAL_NODE.uuid).await {
            log::error!("[ServiceGraph] {org}/{stream}: offset write failed: {e}");
            return;
        }
    }
    let schema = match infra::schema::get(org, stream, StreamType::Traces).await {
        Ok(s) => s,
        Err(e) => {
            log::warn!("[ServiceGraph] {org}/{stream}: schema unavailable, skipped this tick: {e}");
            return;
        }
    };
    let cols = Columns::from_schema(&schema);
    if !cols.has_required() {
        log::warn!(
            "[ServiceGraph] {org}/{stream}: schema lacks service_name or span_kind, skipped"
        );
        return;
    }
    for end in window_ends(offset, horizon, flush, MAX_WINDOWS_PER_TICK) {
        let start = end - flush;
        if let Err(e) = process_window(&job, &cols, (start, end), now, settings, &mut state).await {
            log::error!("[ServiceGraph] {org}/{stream}: window [{start}, {end}) stopped: {e}");
            break;
        }
    }
}

async fn apply_staging(
    org: &str,
    stream: &str,
    state: &mut StreamState,
    table: &TableRef,
    now: i64,
) {
    let t = table.read().await;
    if t.learn_gen == state.staging_gen {
        return;
    }
    state.staging_gen = t.learn_gen;
    if state.staging.is_empty() {
        return;
    }
    let admissions = state.staging.learning_pass(&t, now);
    drop(t);
    for tier in admissions.iter().filter_map(|adm| adm.tier) {
        config::metrics::O2_SERVICE_GRAPH_RESOLVED_TOTAL
            .with_label_values(&[org, tier.as_str()])
            .inc();
    }
    let admissions = admissions
        .into_iter()
        .map(|adm| (adm.key, adm.windows))
        .collect();
    state.admit_staged(org, admissions, now);
    update_retained(org, stream, state);
}

async fn process_window(
    job: &StreamJob,
    cols: &Columns,
    (start, end): (i64, i64),
    now: i64,
    settings: &Settings,
    state: &mut StreamState,
) -> Result<(), anyhow::Error> {
    let (org, stream, table) = (job.org.as_str(), job.stream.as_str(), &job.table);
    let rows = fetch_window(org, stream, cols, start, end).await?;
    set_v4_offset(org, stream, end, &LOCAL_NODE.uuid)
        .await
        .map_err(|e| anyhow::anyhow!("offset write failed: {e}"))?;

    let max_windows = Staging::max_windows(settings.flush_secs);
    let (contributions, staged) = {
        let t = table.read().await;
        window_contributions(org, state, &t, &rows, now, end, max_windows)
    };
    if staged > 0 {
        table.write().await.has_unresolved = true;
    }
    let report = state.merge_window(org, end, now, rows.q1.len(), contributions);
    let excess = state.staging.len().saturating_sub(state.budgets.edges);
    if excess > 0 {
        let early = state
            .staging
            .finalize_oldest(excess)
            .into_iter()
            .map(|adm| (adm.key, adm.windows))
            .collect();
        state.admit_staged(org, early, now);
    }
    if report.dropped_cardinality > 0 || report.evicted_cap > 0 {
        log::warn!("[ServiceGraph] {org}/{stream}: window {end}: {report:?}");
    }
    update_retained(org, stream, state);
    let mut batch = state.emit(end);
    batch.instances = retained_instances(state, &rows.q4);
    if !deliver(org, stream, state, batch).await {
        return Err(anyhow::anyhow!("metrics write failed, batch kept pending"));
    }
    Ok(())
}

/// Q1/Q2 failures abort the window (offset untouched); Q3 and Q4–Q6 only lose their own edges.
async fn fetch_window(
    org: &str,
    stream: &str,
    cols: &Columns,
    start: i64,
    end: i64,
) -> Result<WindowRows, anyhow::Error> {
    let q1: Vec<Q1Row> = run_graph_search(org, build_q1(cols, stream, start, end), start, end)
        .await
        .map_err(|e| anyhow::anyhow!("Q1 failed: {e}"))?
        .iter()
        .filter_map(Q1Row::parse)
        .collect();
    let q2: Vec<Q2Row> = run_graph_search(org, build_q2(cols, stream, start, end), start, end)
        .await
        .map_err(|e| anyhow::anyhow!("Q2 failed: {e}"))?
        .iter()
        .filter_map(Q2Row::parse)
        .collect();
    let q3 = run_optional(
        org,
        stream,
        "Q3",
        build_q3(cols, stream, start, end),
        start,
        end,
    )
    .await
    .iter()
    .filter_map(Q3Row::parse)
    .collect();
    let (q4, q5, q6) = fetch_agent_rows(org, stream, cols, start, end).await;
    Ok(WindowRows {
        q1,
        q2,
        q3,
        q4,
        q5,
        q6,
    })
}

/// No gen_ai spans → skip Q4–Q6; a failed Q0 leaves the orphan counts unknown → Flat form.
async fn fetch_agent_rows(
    org: &str,
    stream: &str,
    cols: &Columns,
    start: i64,
    end: i64,
) -> (Vec<Q4Row>, Vec<AgentEdgeRow>, Vec<AgentEdgeRow>) {
    let Some(q0_sql) = build_q0(cols, stream, start, end) else {
        return (vec![], vec![], vec![]);
    };
    let q0 = match run_graph_search(org, q0_sql, start, end).await {
        Ok(hits) => Some(hits.first().map(Q0Row::parse).unwrap_or_default()),
        Err(e) => {
            log::error!("[ServiceGraph] {org}/{stream}: Q0 failed for window {end}: {e}");
            None
        }
    };
    if q0.is_some_and(|q| q.gen_ai_spans == 0) {
        return (vec![], vec![], vec![]);
    }
    let (orphan_tools, orphan_models) = q0
        .map(|q| (q.orphan_tool_spans, q.orphan_model_spans))
        .unwrap_or((0, 0));
    let tool_form = agent_form(cols, orphan_tools);
    let model_form = agent_form(cols, orphan_models);
    if tool_form == AgentForm::Join || model_form == AgentForm::Join {
        log::debug!(
            "[ServiceGraph] {org}/{stream}: window {end}: Q5 {tool_form:?} ({orphan_tools} orphan tool spans), Q6 {model_form:?} ({orphan_models} orphan model spans)"
        );
    }
    let q4 = run_optional(
        org,
        stream,
        "Q4",
        build_q4(cols, stream, start, end),
        start,
        end,
    )
    .await
    .iter()
    .filter_map(Q4Row::parse)
    .collect();
    let q5_sql = build_q5(cols, stream, start, end, tool_form);
    let q5 = run_optional(org, stream, "Q5", q5_sql, start, end)
        .await
        .iter()
        .filter_map(AgentEdgeRow::parse)
        .collect();
    let q6_sql = build_q6(cols, stream, start, end, model_form);
    let q6 = run_optional(org, stream, "Q6", q6_sql, start, end)
        .await
        .iter()
        .filter_map(AgentEdgeRow::parse)
        .collect();
    (q4, q5, q6)
}

/// An optional family's failure only empties that family: the offset advances with the window.
async fn run_optional(
    org: &str,
    stream: &str,
    name: &str,
    sql: Option<String>,
    start: i64,
    end: i64,
) -> Vec<Value> {
    let Some(sql) = sql else {
        return vec![];
    };
    match run_graph_search(org, sql, start, end).await {
        Ok(hits) => hits,
        Err(e) => {
            log::error!("[ServiceGraph] {org}/{stream}: {name} failed for window {end}: {e}");
            vec![]
        }
    }
}

fn window_contributions(
    org: &str,
    state: &mut StreamState,
    table: &ResolutionTable,
    rows: &WindowRows,
    now: i64,
    end: i64,
    max_windows: usize,
) -> (Vec<(SeriesKey, WindowCounts)>, usize) {
    let WindowRows { q1, q2, q3, .. } = rows;
    let mut out = Vec::with_capacity(q1.len() * 2 + q2.len() + q3.len() + agent_rows(rows));
    for r in q1 {
        out.push((SeriesKey::node(&r.service_name), r.counts));
        if r.root_requests > 0 {
            let counts = WindowCounts {
                requests: r.root_requests,
                ..Default::default()
            };
            out.push((SeriesKey::entry_edge(&r.service_name), counts));
        }
    }
    let (resolved, staged) = state
        .staging
        .classify_window(q2, table, now, end, max_windows);
    for c in resolved {
        if let Some(tier) = c.tier {
            config::metrics::O2_SERVICE_GRAPH_RESOLVED_TOTAL
                .with_label_values(&[org, tier.as_str()])
                .inc();
        }
        out.push((c.key, c.counts));
    }
    for r in q3 {
        out.push((SeriesKey::queue_edge(&r.client, &r.server), r.counts));
    }
    agent_contributions(rows, &mut out);
    (out, staged)
}

fn agent_rows(rows: &WindowRows) -> usize {
    rows.q4.len() + rows.q5.len() + rows.q6.len()
}

/// Agent edges are ordinary edge series: same baseline, TTL, cap and budget as Q1–Q3's.
fn agent_contributions(rows: &WindowRows, out: &mut Vec<(SeriesKey, WindowCounts)>) {
    for r in &rows.q4 {
        out.push((agent_key(r), r.counts));
    }
    for (family, connection_type) in [(&rows.q5, CONNECTION_TOOL), (&rows.q6, CONNECTION_MODEL)] {
        for r in family {
            let key = SeriesKey::agent_call_edge(
                r.agent_from.as_deref(),
                &r.service_name,
                &r.server,
                connection_type,
                r.agent_env.as_deref().unwrap_or(""),
            );
            out.push((key, r.counts));
        }
    }
}

fn agent_key(r: &Q4Row) -> SeriesKey {
    SeriesKey::agent_edge(&r.client, &r.agent, r.agent_env.as_deref().unwrap_or(""))
}

/// The gauge rides only on a retained Q4 edge, so it can never outgrow the edge budget.
fn retained_instances(state: &StreamState, q4: &[Q4Row]) -> Vec<(SeriesKey, u64)> {
    q4.iter()
        .filter(|r| r.instances > 0)
        .map(|r| (agent_key(r), r.instances))
        .filter(|(key, _)| state.series.contains_key(key))
        .collect()
}

async fn deliver(org: &str, stream: &str, state: &mut StreamState, batch: Batch) -> bool {
    let records = writer::render(stream, &batch);
    let chunks = writer::chunk(&records, writer::max_request_bytes());
    match writer::write_batch(org, chunks).await {
        writer::WriteOutcome::Delivered => {
            state.mark_clean(&batch);
            note_started().await;
            true
        }
        outcome => {
            log::warn!(
                "[ServiceGraph] {org}/{stream}: batch for window {} kept pending ({outcome:?})",
                batch.window_end
            );
            state.pending = Some(batch);
            false
        }
    }
}

async fn note_started() {
    if STARTED_AT_WRITTEN.load(Ordering::Relaxed) {
        return;
    }
    match set_started_at_if_absent(now_micros()).await {
        Ok(()) => STARTED_AT_WRITTEN.store(true, Ordering::Relaxed),
        Err(e) => log::warn!("[ServiceGraph] failed to record v4 started_at: {e}"),
    }
}

fn update_retained(org: &str, stream: &str, state: &StreamState) {
    let new = state.retained();
    let prev = RETAINED
        .insert((org.to_string(), stream.to_string()), new)
        .unwrap_or((0, 0));
    let (edges, nodes) = {
        let mut total = ORG_RETAINED.entry(org.to_string()).or_insert((0, 0));
        total.0 = (total.0 + new.0).saturating_sub(prev.0);
        total.1 = (total.1 + new.1).saturating_sub(prev.1);
        *total
    };
    config::metrics::O2_SERVICE_GRAPH_RETAINED_EDGES
        .with_label_values(&[org])
        .set(edges as i64);
    config::metrics::O2_SERVICE_GRAPH_RETAINED_NODES
        .with_label_values(&[org])
        .set(nodes as i64);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claim_decision_four_cases() {
        assert_eq!(claim_decision("", "me", false), ClaimDecision::Claim);
        assert_eq!(claim_decision("me", "me", true), ClaimDecision::Owned);
        assert_eq!(claim_decision("other", "me", true), ClaimDecision::Skip);
        assert_eq!(claim_decision("other", "me", false), ClaimDecision::Claim);
    }

    #[test]
    fn test_window_arithmetic() {
        let flush = 60 * SECOND_MICRO_SECS;
        assert_eq!(
            align_down(125 * SECOND_MICRO_SECS, flush),
            120 * SECOND_MICRO_SECS
        );
        assert_eq!(
            align_down(120 * SECOND_MICRO_SECS, flush),
            120 * SECOND_MICRO_SECS
        );
        let horizon = 1_000 * SECOND_MICRO_SECS;
        assert_eq!(
            initial_offset(0, horizon, flush, MAX_BACKLOG_MICROS),
            (960 * SECOND_MICRO_SECS, false)
        );
        assert_eq!(
            initial_offset(700 * SECOND_MICRO_SECS, horizon, flush, MAX_BACKLOG_MICROS),
            (700 * SECOND_MICRO_SECS, false)
        );
        let far = horizon - MAX_BACKLOG_MICROS - SECOND_MICRO_SECS;
        assert_eq!(
            initial_offset(far, horizon, flush, MAX_BACKLOG_MICROS),
            (960 * SECOND_MICRO_SECS, true)
        );
        assert_eq!(
            window_ends(960 * SECOND_MICRO_SECS, horizon, flush, 120),
            Vec::<i64>::new()
        );
        assert_eq!(
            window_ends(940 * SECOND_MICRO_SECS, horizon, flush, 120),
            vec![1_000 * SECOND_MICRO_SECS]
        );
        assert_eq!(
            window_ends(700 * SECOND_MICRO_SECS, horizon, flush, 120),
            vec![
                760 * SECOND_MICRO_SECS,
                820 * SECOND_MICRO_SECS,
                880 * SECOND_MICRO_SECS,
                940 * SECOND_MICRO_SECS,
                1_000 * SECOND_MICRO_SECS
            ]
        );
        assert_eq!(
            window_ends(700 * SECOND_MICRO_SECS, horizon, flush, 2),
            vec![760 * SECOND_MICRO_SECS, 820 * SECOND_MICRO_SECS]
        );
        assert_eq!(
            window_ends(0, 10_000 * SECOND_MICRO_SECS, flush, MAX_WINDOWS_PER_TICK).len(),
            MAX_WINDOWS_PER_TICK
        );
    }

    fn counts(n: u64) -> WindowCounts {
        WindowCounts {
            requests: n,
            ..Default::default()
        }
    }

    fn q4(client: &str, agent: &str, env: Option<&str>, instances: u64) -> Q4Row {
        Q4Row {
            client: client.into(),
            agent: agent.into(),
            agent_env: env.map(str::to_string),
            instances,
            counts: counts(1),
        }
    }

    fn edge_row(
        agent_from: Option<&str>,
        service: &str,
        server: &str,
        env: Option<&str>,
    ) -> AgentEdgeRow {
        AgentEdgeRow {
            agent_from: agent_from.map(str::to_string),
            service_name: service.into(),
            server: server.into(),
            agent_env: env.map(str::to_string),
            counts: counts(2),
        }
    }

    #[test]
    fn test_agent_contributions_mapping() {
        let rows = WindowRows {
            q1: vec![],
            q2: vec![],
            q3: vec![],
            q4: vec![
                q4("o2-ai", "sre-rca", Some("prod"), 2),
                q4("svc", "planner", None, 0),
            ],
            q5: vec![
                edge_row(Some("sre-rca"), "o2-ai", "search", Some("prod")),
                edge_row(None, "o2-ai", "search", None),
            ],
            q6: vec![
                edge_row(Some("sre-rca"), "o2-ai", "gpt-4o", None),
                edge_row(None, "claude-code", "claude-opus-4-6", Some("dev")),
            ],
        };
        let mut out = vec![];
        agent_contributions(&rows, &mut out);
        let keys: Vec<SeriesKey> = out.iter().map(|(k, _)| k.clone()).collect();
        assert_eq!(
            keys,
            vec![
                SeriesKey::agent_edge("o2-ai", "sre-rca", "prod"),
                SeriesKey::agent_edge("svc", "planner", ""),
                SeriesKey::agent_call_edge(Some("sre-rca"), "o2-ai", "search", "tool", "prod"),
                SeriesKey::agent_call_edge(None, "o2-ai", "search", "tool", ""),
                SeriesKey::agent_call_edge(Some("sre-rca"), "o2-ai", "gpt-4o", "model", ""),
                SeriesKey::agent_call_edge(None, "claude-code", "claude-opus-4-6", "model", "dev"),
            ]
        );
        assert!(matches!(
            &keys[2],
            SeriesKey::Edge { client, client_type, .. } if client == "sre-rca" && client_type == "agent"
        ));
        assert!(matches!(
            &keys[3],
            SeriesKey::Edge { client, client_type, .. } if client == "o2-ai" && client_type.is_empty()
        ));
        assert!(keys.iter().all(SeriesKey::is_edge));
        assert_eq!(out[0].1.requests, 1);
        assert_eq!(out[2].1.requests, 2);
    }

    #[test]
    fn test_retained_instances_only_for_retained_keys() {
        let mut state = StreamState::new();
        let rows = vec![
            q4("o2-ai", "sre-rca", Some("prod"), 3),
            q4("o2-ai", "zero", None, 0),
            q4("o2-ai", "dropped", None, 5),
        ];
        let end = 100 * SECOND_MICRO_SECS;
        state.merge_window(
            "o",
            end,
            end,
            1,
            vec![
                (agent_key(&rows[0]), counts(1)),
                (agent_key(&rows[1]), counts(1)),
            ],
        );
        assert_eq!(
            retained_instances(&state, &rows),
            vec![(SeriesKey::agent_edge("o2-ai", "sre-rca", "prod"), 3)]
        );
        assert!(retained_instances(&StreamState::new(), &rows).is_empty());
        let mut batch = state.emit(end);
        batch.instances = retained_instances(&state, &rows);
        state.mark_clean(&batch);
        assert_eq!(state.retained(), (2, 0));
    }

    #[test]
    fn test_ql_trigger_survives_failed_pass() {
        let mut t = ResolutionTable::new(100, 100);
        t.has_unresolved = true;
        settle_ql_trigger(&mut t, true, false, 900);
        assert!(t.has_unresolved);
        assert_eq!(t.pairing_up_to, 100);
        let need_ql = t.has_unresolved;
        settle_ql_trigger(&mut t, need_ql, true, 900);
        assert!(!t.has_unresolved);
        settle_ql_trigger(&mut t, false, false, 900);
        assert_eq!(t.pairing_up_to, 900);
    }
}
