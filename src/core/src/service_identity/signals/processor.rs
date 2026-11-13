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

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    sync::{LazyLock, Mutex},
};

use config::{
    cluster::LOCAL_NODE,
    meta::{
        search,
        service_identity::{AliasRow, alias_key},
        stream::{StreamStats, StreamType},
    },
    utils::time::{SECOND_MICRO_SECS, now_micros},
};
use futures::StreamExt;
use infra::dist_lock;
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    service_identity::{
        aliases::{self, AliasKind, AliasOrigin, AliasState, AliasStatus},
        signals::{
            mappers::{self, PodRow, SignalRow, WindowCtx},
            sql,
        },
    },
};
use serde_json::Value;

use super::deploys::Ring;
use crate::traces::service_graph::v4::{
    MAX_BACKLOG_MICROS, MAX_WINDOWS_PER_TICK,
    schedule::{
        ClaimDecision, align_down, claim_decision, initial_offset, node_alive, org_allowed,
        window_ends,
    },
};

tokio::task_local! {
    pub(super) static QUERY_COUNT: std::cell::Cell<u64>;
}

// An org runs this many windows of time per tick, so its one evaluation covers several windows.
const RUN_BUDGET_WINDOWS: i64 = 6;
// Lanes mostly wait on searches and the meta DB; the cap bounds what one node puts on queriers.
const MAX_AUTO_LANES: usize = 16;
// Rows per search page of a window read; more pages are read in order.
const PAGE_SIZE: usize = 100_000;

// Scopes with rollup rows since their org's last evaluation; an org absent here is evaluated whole.
static DIRTY: LazyLock<Mutex<HashMap<String, BTreeSet<String>>>> = LazyLock::new(Default::default);

#[derive(Default)]
pub struct WindowOutput {
    pub signals: Vec<SignalRow>,
    pub detail: Vec<SignalRow>,
    pub pods: Vec<PodRow>,
}

pub(super) struct Ownership<'a> {
    lock: Option<&'a dist_lock::Locker>,
    lost: tokio::sync::watch::Receiver<bool>,
    pub(super) generation: i64,
    written_at: i64,
}

impl Ownership<'_> {
    pub(super) async fn check(&self) -> Result<(), anyhow::Error> {
        ensure_owned(&self.lost)?;
        if let Some(lock) = self.lock {
            lock.owned_revision().await?;
        }
        Ok(())
    }
}

/// One org's share of a tick: the window ends it may process, oldest first.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct OrgPlan {
    org: String,
    ends: Vec<i64>,
    /// Never processed nor tracked, so its lane starts ahead of the orgs with a cursor.
    fresh: bool,
}

/// How a tick shares time: orgs at once over all lanes, each org's run time, and the rescan period.
#[derive(Clone, Copy)]
struct RunLimits {
    concurrency: usize,
    budget: i64,
    rescan: i64,
}

/// What closing a window does to the org's evaluation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Window,
    Last,
    /// Evaluates a window closed earlier in the run, once a later window failed.
    Evaluate,
}

/// Each org's trace and RUM source streams.
type Sources = BTreeMap<String, Vec<(String, StreamType)>>;

pub(super) fn record_query() {
    let _ = QUERY_COUNT.try_with(|count| count.set(count.get().saturating_add(1)));
}

pub async fn process_service_signals() -> Result<(), anyhow::Error> {
    process_tick_at(now_micros()).await
}

pub async fn process_tick_at(now: i64) -> Result<(), anyhow::Error> {
    let lock = dist_lock::lock(db::service_signals::OFFSET_KEY, 0).await?;
    let (_local_guard, local_lost) = tokio::sync::watch::channel(false);
    let lost = lock.as_ref().map_or(local_lost, dist_lock::Locker::lost);
    let claim = lost.clone();
    let result = async {
        let ownership = Ownership {
            written_at: now_micros(),
            lock: lock.as_ref(),
            lost: lost.clone(),
            generation: match &lock {
                Some(lock) => i64::try_from(lock.owned_revision().await?)?,
                None => now_micros(),
            },
        };
        ownership.check().await?;
        infra::table::service_name_aliases::put_learned_batch(
            infra::db::get_orm_client_rw().await,
            &config::get_cluster_name(),
            ownership.generation,
            &[],
        )
        .await?;
        while_owned(lost, tick_locked(now, &ownership)).await
    }
    .await;
    // Another node now writes the windows, so this disk's state is stale from here on.
    if *claim.borrow() {
        super::snapshot::forget(|_| false);
    }
    let unlock = dist_lock::unlock(&lock).await;
    result?;
    unlock?;
    Ok(())
}

pub async fn process_org_window(
    org: &str,
    streams: &[(String, StreamType)],
    start: i64,
    end: i64,
) -> Result<WindowOutput, anyhow::Error> {
    let (_guard, lost) = tokio::sync::watch::channel(false);
    let ownership = Ownership {
        written_at: now_micros(),
        lock: None,
        lost,
        generation: now_micros(),
    };
    let (out, ring) = process_org_window_owned(org, streams, start, end, &ownership).await?;
    super::verdicts::evaluate(org, &ring, None, &ownership).await?;
    super::verdicts::emit_pending(org, &ring, &ownership).await?;
    Ok(out)
}

pub(super) async fn query(
    org: &str,
    kind: StreamType,
    sql: Option<String>,
    start: i64,
    end: i64,
) -> Result<Vec<Value>, anyhow::Error> {
    let Some(sql) = sql else {
        return Ok(Vec::new());
    };
    let page_size = PAGE_SIZE;
    let fetch = |sql: String, from: usize| async move {
        let request = search::Request {
            query: search::Query {
                sql,
                start_time: start,
                end_time: end,
                from: from as i64,
                size: page_size as i64,
                ..Default::default()
            },
            use_cache: false,
            regions: vec!["local".to_string()],
            clusters: vec![config::get_cluster_name()],
            ..Default::default()
        };
        record_query();
        let response =
            crate::search::search(&config::ider::generate(), org, kind, None, &request).await?;
        anyhow::ensure!(!response.is_partial, "partial service signals search");
        response
            .hits
            .into_iter()
            .map(|row| {
                let Value::Object(mut fields) = row else {
                    anyhow::bail!("non-object rollup group");
                };
                // An object row can omit a null column, and paging orders by every group column.
                for column in &response.columns {
                    fields.entry(column.clone()).or_insert(Value::Null);
                }
                Ok(Value::Object(fields))
            })
            .collect::<Result<Vec<_>, anyhow::Error>>()
    };
    let first = fetch(sql.clone(), 0).await?;
    if first.len() < page_size {
        return Ok(first);
    }
    let ordered = ordered_query(&sql, &first[0])?;
    collect_pages(page_size, |from| fetch(ordered.clone(), from)).await
}

async fn process_org_window_owned(
    org: &str,
    streams: &[(String, StreamType)],
    start: i64,
    end: i64,
    ownership: &Ownership<'_>,
) -> anyhow::Result<(WindowOutput, Ring)> {
    QUERY_COUNT
        .scope(std::cell::Cell::new(0), async {
            let result = process_org_window_body(org, streams, start, end, ownership).await;
            log::info!(
                "[ServiceSignals] org={org} window_end={end} queries={}",
                QUERY_COUNT.with(std::cell::Cell::get)
            );
            result
        })
        .await
}

async fn process_org_window_body(
    org: &str,
    streams: &[(String, StreamType)],
    start: i64,
    end: i64,
    ownership: &Ownership<'_>,
) -> Result<(WindowOutput, Ring), anyhow::Error> {
    ownership.check().await?;
    let identity = db::service_identity::get_cached_overrides(org).await;
    let mut out = WindowOutput::default();
    for (stream, kind) in streams {
        anyhow::ensure!(
            !stream.contains('"'),
            "invalid service signal source stream"
        );
        let schema = infra::schema::get(org, stream, *kind).await?;
        let cols: HashSet<String> = schema
            .fields()
            .iter()
            .map(|field| field.name().clone())
            .collect();
        let ctx = WindowCtx {
            org_id: org.to_string(),
            source_stream: stream.clone(),
            window_start: start,
            window_secs: (end - start) / SECOND_MICRO_SECS,
            written_at: ownership.written_at,
            cluster: config::get_cluster_name(),
        };
        if *kind == StreamType::Traces {
            if !["service_name", "span_kind", "span_status", "duration"]
                .iter()
                .all(|col| cols.contains(*col))
            {
                continue;
            }
            trace_rows(org, &cols, &ctx, &identity, &mut out).await?;
        } else {
            rum_rows(org, &cols, &ctx, &identity, &mut out, ownership).await?;
        }
    }
    ownership.check().await?;
    super::writer::write_window(
        org,
        start,
        end,
        &[out.signals.as_slice(), out.detail.as_slice()],
        &out.pods,
        ownership,
    )
    .await?;
    ownership.check().await?;
    learn_aliases(org, &out.pods, end, ownership).await?;
    let ring =
        super::deploys::detect(org, end, end - start, &out.signals, &out.pods, ownership).await?;
    let filled = super::k8s_versions::without_span_texts(
        org,
        bounded_observations(
            org,
            super::k8s_versions::image_observations(org, &out.pods, &ring.presence[1]),
        ),
    )
    .await?;
    if !filled.is_empty() {
        ownership.check().await?;
        if db::service_versions::queue_observations(org, filled).should_flush {
            ownership.check().await?;
            db::service_versions::flush_org(org).await?;
        }
    }
    Ok((out, ring))
}

/// One search gives T1 and endpoint detail (folded T2), a second the pods (T3).
async fn trace_rows(
    org: &str,
    cols: &HashSet<String>,
    ctx: &WindowCtx,
    identity: &config::meta::service_identity::OrgIdentity,
    out: &mut WindowOutput,
) -> anyhow::Result<()> {
    let (start, end) = (
        ctx.window_start,
        ctx.window_start + ctx.window_secs * SECOND_MICRO_SECS,
    );
    let stream = ctx.source_stream.as_str();
    let folded = sql::build_t2_folded_sql(stream, start, end, cols, sql::T2_TOP_N);
    if folded.is_some() {
        let hits = query(org, StreamType::Traces, folded, start, end).await?;
        let folded_ops: u64 = hits
            .iter()
            .filter(|hit| hit["operation"] == sql::OTHER_OPERATION)
            .filter_map(|hit| hit["operations"].as_u64())
            .sum();
        super::writer::count_dropped(org, super::writer::KIND_TOP_N, folded_ops);
        let rows = mappers::map_t2(ctx, &hits, identity);
        out.signals.extend(mappers::fold_t1(&rows));
        out.detail.extend(
            rows.into_iter()
                .filter(|row| row.operation.as_deref() != Some(sql::OTHER_OPERATION)),
        );
    } else {
        let hits = query(
            org,
            StreamType::Traces,
            sql::build_t1_sql(stream, start, end, cols)
                .map(|query| format!("{query} LIMIT {}", sql::CANDIDATE_LIMIT)),
            start,
            end,
        )
        .await?;
        out.signals.extend(mappers::map_t1(ctx, &hits, identity));
    }
    let hits = query(
        org,
        StreamType::Traces,
        sql::build_t3_sql(stream, start, end, cols),
        start,
        end,
    )
    .await?;
    out.pods.extend(mappers::map_t3(ctx, &hits));
    Ok(())
}

/// R1 views and vitals, then R2 error types and R3 pages, every window (D241).
async fn rum_rows(
    org: &str,
    cols: &HashSet<String>,
    ctx: &WindowCtx,
    identity: &config::meta::service_identity::OrgIdentity,
    out: &mut WindowOutput,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    let (start, end) = (
        ctx.window_start,
        ctx.window_start + ctx.window_secs * SECOND_MICRO_SECS,
    );
    let stream = ctx.source_stream.as_str();
    let kind = StreamType::Logs;
    let hits = query(
        org,
        kind,
        sql::build_r1_sql(stream, start, end, cols),
        start,
        end,
    )
    .await?;
    out.signals.extend(mappers::map_r1(ctx, &hits, identity));
    let observations = bounded_observations(org, mappers::r1_observations(ctx, &hits, identity));
    ownership.check().await?;
    let outcome = db::service_versions::queue_observations(org, observations);
    if outcome.should_flush {
        ownership.check().await?;
        db::service_versions::flush_org(org).await?;
    }
    let hits = query(
        org,
        kind,
        sql::build_r2_sql(stream, start, end, cols, sql::R2_TOP_N),
        start,
        end,
    )
    .await?;
    out.detail.extend(mappers::map_r2(ctx, &hits, identity));
    let hits = query(
        org,
        kind,
        sql::build_r3_sql(stream, start, end, cols, sql::R3_TOP_N),
        start,
        end,
    )
    .await?;
    out.detail.extend(mappers::map_r3(ctx, &hits, identity));
    Ok(())
}

async fn tick_locked(now: i64, ownership: &Ownership<'_>) -> Result<(), anyhow::Error> {
    let (offset, owner) = db::service_signals::get_offset().await?;
    let decision = claim_decision(&owner, &LOCAL_NODE.uuid, node_alive(&owner).await);
    if decision == ClaimDecision::Skip {
        return Ok(());
    }
    // Another node may have written windows since this node kept any history.
    if decision == ClaimDecision::Claim {
        super::deploys::forget_history(|_| false);
        super::deploys::forget_rings(|_| false);
        super::writer::forget(|_| false);
        let restored = super::snapshot::restore_all(&owner).await;
        log::info!("[ServiceSignals] claimed from {owner:?}; {restored} org snapshots restored");
    }
    ownership.check().await?;
    db::service_signals::compare_set_offset((offset, owner), offset, &LOCAL_NODE.uuid).await?;
    let interval = get_o2_config().service_signals.window_secs as i64 * SECOND_MICRO_SECS;
    let horizon = now - config::get_config().limit.cache_delay_secs * SECOND_MICRO_SECS;
    let (planned, jumped) = initial_offset(offset, horizon, interval, MAX_BACKLOG_MICROS);
    if jumped {
        log::warn!("[ServiceSignals] skipping backlog from {offset} to {planned}");
    }
    if planned != offset {
        ownership.check().await?;
        db::service_signals::compare_set_offset(
            (offset, LOCAL_NODE.uuid.clone()),
            planned,
            &LOCAL_NODE.uuid,
        )
        .await?;
    }
    let latest = align_down(horizon, interval);
    let (sources, every_org) = service_sources(planned.min(latest - interval), latest).await;
    let sources = Mutex::new(sources);
    let known: Vec<String> = sources
        .lock()
        .expect("service signal sources")
        .keys()
        .cloned()
        .collect();
    let mut plans = Vec::with_capacity(known.len());
    for org in &known {
        plans.push(plan_for(org, planned, horizon, interval).await?);
    }
    let behind = now - horizon;
    let sources = &sources;
    let results = run_plans(
        plans,
        RunLimits {
            concurrency: org_lanes(config::get_config().limit.cpu_num),
            budget: RUN_BUDGET_WINDOWS * interval,
            rescan: interval,
        },
        &now_micros,
        || tokio::time::sleep(std::time::Duration::from_micros(interval.unsigned_abs())),
        |seen: BTreeSet<String>| async move {
            let horizon = now_micros() - behind;
            let latest = align_down(horizon, interval);
            let mut found = Vec::new();
            for (org, streams) in service_sources(latest - interval, latest).await.0 {
                if seen.contains(&org) {
                    continue;
                }
                match plan_for(&org, planned, horizon, interval).await {
                    Ok(plan) => {
                        sources
                            .lock()
                            .expect("service signal sources")
                            .insert(org, streams);
                        found.push(plan);
                    }
                    Err(error) => log::warn!("[ServiceSignals] org={org} not planned: {error}"),
                }
            }
            found
        },
        |org: String, end: i64| {
            let streams = sources
                .lock()
                .expect("service signal sources")
                .get(&org)
                .cloned()
                .unwrap_or_default();
            async move {
                ownership.check().await?;
                let (_, ring) =
                    process_org_window_owned(&org, &streams, end - interval, end, ownership)
                        .await?;
                Ok(ring)
            }
        },
        |org: String, end: i64, ring: Ring, step: Step| async move {
            let result = match step {
                Step::Evaluate => evaluate_dirty(&org, &ring, ownership).await,
                Step::Window | Step::Last => {
                    close_window(&org, end, &ring, step == Step::Last, ownership).await
                }
            };
            (ring, result)
        },
    )
    .await;
    let mut failed = None;
    for (org, result) in results {
        if let Err(error) = result {
            log::error!("[ServiceSignals] org={org} processing failed: {error}");
            failed.get_or_insert(error);
        }
    }
    let orgs: Vec<String> = sources
        .lock()
        .expect("service signal sources")
        .keys()
        .cloned()
        .collect();
    let mut reached = latest;
    for org in &orgs {
        reached = reached.min(
            db::service_signals::get_org_offset(org)
                .await?
                .unwrap_or(planned),
        );
    }
    if reached > planned {
        ownership.check().await?;
        db::service_signals::compare_set_offset(
            (planned, LOCAL_NODE.uuid.clone()),
            reached,
            &LOCAL_NODE.uuid,
        )
        .await?;
    }
    let cutoff = now
        - o2_enterprise::enterprise::common::config::SERVICE_VERSIONS_TOMBSTONE_DAYS as i64
            * 86_400
            * SECOND_MICRO_SECS;
    let processed: BTreeSet<&str> = orgs.iter().map(String::as_str).collect();
    super::deploys::forget_history(|org| processed.contains(org));
    super::deploys::forget_rings(|org| processed.contains(org));
    super::writer::forget(|org| processed.contains(org));
    super::snapshot::forget(|org| processed.contains(org));
    let mut purged = every_org;
    purged.extend(orgs.iter().cloned());
    for org in &purged {
        ownership.check().await?;
        super::purge::daily(org, now).await?;
        if infra::table::service_name_aliases::purge_tombstones(
            infra::db::get_orm_client_rw().await,
            org,
            cutoff,
        )
        .await?
            > 0
        {
            db::service_identity::invalidate_aliases(org).await;
        }
    }
    failed.map_or(Ok(()), Err)
}

/// Allowed orgs with trace or RUM data since `start` or with verdict work, and every org.
async fn service_sources(start: i64, end: i64) -> (Sources, BTreeSet<String>) {
    let known = known_sources().await;
    let every = known.keys().cloned().collect();
    let work = match super::deploys::orgs_with_work(end).await {
        Ok(work) => Some(work),
        Err(error) => {
            log::warn!("[ServiceSignals] verdict work unavailable; processing every org: {error}");
            None
        }
    };
    let mut orgs = select_sources(known, work.as_ref(), start - stats_lag_micros());
    retain_service_sources(&mut orgs);
    let mut allowed = BTreeMap::new();
    for (org, streams) in orgs {
        if org_allowed(&org).await {
            allowed.insert(org, streams);
        }
    }
    (allowed, every)
}

/// Every org's trace streams and `_rumdata` in the schema cache.
async fn known_sources() -> Sources {
    let mut orgs = Sources::new();
    for (org, types) in db::schema::list_all_streams_grouped().await {
        let streams = orgs.entry(org).or_default();
        if let Some(traces) = types.get(&StreamType::Traces) {
            streams.extend(
                traces
                    .iter()
                    .map(|stream| (stream.clone(), StreamType::Traces)),
            );
        }
        if types
            .get(&StreamType::Logs)
            .is_some_and(|streams| streams.iter().any(|s| s == "_rumdata"))
        {
            streams.push(("_rumdata".to_string(), StreamType::Logs));
        }
    }
    orgs
}

/// Without verdict work every known org runs; with it, orgs with data since `since` or with work.
fn select_sources(mut known: Sources, work: Option<&BTreeSet<String>>, since: i64) -> Sources {
    let Some(work) = work else {
        return known;
    };
    known.retain(|org, streams| {
        work.contains(org)
            || streams.iter().any(|(stream, kind)| {
                has_data_since(
                    &infra::cache::stats::get_stream_stats(org, stream, *kind),
                    since,
                )
            })
    });
    known
}

/// A stream without stats has not persisted a file yet, so it counts as active.
fn has_data_since(stats: &StreamStats, since: i64) -> bool {
    stats.doc_time_max == 0 || stats.doc_time_max >= since
}

/// How far the cached stats' newest data time can trail ingestion on this node.
fn stats_lag_micros() -> i64 {
    let limit = &config::get_config().limit;
    let secs = limit.max_file_retention_time
        + limit.mem_persist_interval
        + limit.file_push_interval
        + limit.calculate_stats_interval.max(10)
        + limit.calculate_stats_interval.max(60);
    secs as i64 * SECOND_MICRO_SECS
}

/// Lanes follow the CPU count, at most [`MAX_AUTO_LANES`] (D230).
fn org_lanes(cpus: usize) -> usize {
    cpus.clamp(1, MAX_AUTO_LANES)
}

/// A new org starts at the current window; an org tracked under the shared cursor resumes there.
fn plan_org(
    org: &str,
    own: Option<i64>,
    tracked: bool,
    shared: i64,
    horizon: i64,
    interval: i64,
) -> OrgPlan {
    let start = match own {
        Some(offset) => offset,
        None if tracked => shared,
        None => align_down(horizon, interval) - interval,
    };
    let (start, jumped) = initial_offset(start, horizon, interval, MAX_BACKLOG_MICROS);
    // A jump persists only when a window closes, so the current window runs.
    let start = if jumped {
        let start = start - interval;
        log::warn!("[ServiceSignals] org={org} skipping backlog to {start}");
        start
    } else {
        start
    };
    OrgPlan {
        org: org.to_string(),
        ends: window_ends(start, horizon, interval, MAX_WINDOWS_PER_TICK),
        fresh: own.is_none() && !tracked,
    }
}

/// An org without a cursor starts at the current window, or resumes at `shared` once tracked.
async fn plan_for(org: &str, shared: i64, horizon: i64, interval: i64) -> anyhow::Result<OrgPlan> {
    let own = db::service_signals::get_org_offset(org).await?;
    let tracked = own.is_none() && super::deploys::has_epoch(org).await?;
    Ok(plan_org(org, own, tracked, shared, horizon, interval))
}

/// Runs the fresh lane first, then fewest pending windows first, and orgs found meanwhile.
async fn run_plans<K, P, PF, D, DF, W, WF, T, C, CF>(
    plans: Vec<OrgPlan>,
    limits: RunLimits,
    clock: &K,
    pause: P,
    discover: D,
    window: W,
    close: C,
) -> Vec<(String, anyhow::Result<()>)>
where
    K: Fn() -> i64,
    P: Fn() -> PF,
    PF: std::future::Future<Output = ()>,
    D: Fn(BTreeSet<String>) -> DF,
    DF: std::future::Future<Output = Vec<OrgPlan>>,
    W: Fn(String, i64) -> WF,
    WF: std::future::Future<Output = anyhow::Result<T>>,
    C: Fn(String, i64, T, Step) -> CF,
    CF: std::future::Future<Output = (T, anyhow::Result<()>)>,
{
    let mut seen: BTreeSet<String> = plans.iter().map(|plan| plan.org.clone()).collect();
    let mut waiting = plans;
    let mut running = futures::stream::FuturesUnordered::new();
    let mut results = Vec::new();
    let mut next_scan = clock().saturating_add(limits.rescan);
    let cap = limits.concurrency.max(1);
    loop {
        // Popped from the back, so a fresh org, then the fewest pending windows, goes next.
        waiting.sort_by(|a, b| {
            a.fresh
                .cmp(&b.fresh)
                .then_with(|| b.ends.len().cmp(&a.ends.len()))
                .then_with(|| b.org.cmp(&a.org))
        });
        while running.len() < cap
            && let Some(plan) = waiting.pop()
        {
            running.push(run_org(plan, clock, limits.budget, &window, &close));
        }
        if running.is_empty() {
            break;
        }
        let pause = pause();
        tokio::pin!(pause);
        tokio::select! {
            Some(done) = running.next() => results.push(done),
            () = &mut pause => {}
        }
        if clock() >= next_scan {
            next_scan = clock().saturating_add(limits.rescan);
            for plan in discover(seen.clone()).await {
                if seen.insert(plan.org.clone()) {
                    waiting.push(plan);
                }
            }
        }
    }
    results
}

/// One org's windows, oldest first, until its budget from its own start runs out or one fails.
async fn run_org<K, W, WF, T, C, CF>(
    plan: OrgPlan,
    clock: &K,
    budget: i64,
    window: &W,
    close: &C,
) -> (String, anyhow::Result<()>)
where
    K: Fn() -> i64,
    W: Fn(String, i64) -> WF,
    WF: std::future::Future<Output = anyhow::Result<T>>,
    C: Fn(String, i64, T, Step) -> CF,
    CF: std::future::Future<Output = (T, anyhow::Result<()>)>,
{
    let stop = clock().saturating_add(budget);
    let mut result = Ok(());
    let mut unevaluated = None;
    for (index, end) in plan.ends.iter().enumerate() {
        let output = match window(plan.org.clone(), *end).await {
            Ok(output) => output,
            Err(error) => {
                result = Err(error);
                break;
            }
        };
        let last = index + 1 == plan.ends.len() || clock() >= stop;
        let step = if last { Step::Last } else { Step::Window };
        let (output, closed) = close(plan.org.clone(), *end, output, step).await;
        // A failed close keeps its rolled-up window due; a last close has evaluated already.
        unevaluated = (!last).then_some((*end, output));
        if let Err(error) = closed {
            result = Err(error);
            break;
        }
        if last {
            break;
        }
    }
    if result.is_err()
        && let Some((end, output)) = unevaluated
        && let (_, Err(error)) = close(plan.org.clone(), end, output, Step::Evaluate).await
    {
        log::error!(
            "[ServiceSignals] org={} evaluation at {end} after a failed window failed: {error}",
            plan.org
        );
    }
    (plan.org, result)
}

// Verdicts read a range of windows, so a tick evaluates each org once, at its newest window.
async fn close_window(
    org: &str,
    end: i64,
    ring: &Ring,
    last: bool,
    ownership: &Ownership<'_>,
) -> anyhow::Result<()> {
    mark_dirty(org, ring);
    close_in_order(
        last,
        evaluate_dirty(org, ring, ownership),
        super::verdicts::emit_pending(org, ring, ownership),
        async {
            ownership.check().await?;
            db::service_signals::advance_org_offset(org, end).await?;
            super::snapshot::maybe_write(org, end, now_micros()).await;
            Ok(())
        },
    )
    .await
}

/// A final window is evaluated before its emission and cursor write, so neither failure drops it.
async fn close_in_order(
    last: bool,
    evaluate: impl std::future::Future<Output = anyhow::Result<()>>,
    emit: impl std::future::Future<Output = anyhow::Result<()>>,
    persist: impl std::future::Future<Output = anyhow::Result<()>>,
) -> anyhow::Result<()> {
    if last {
        evaluate.await?;
    }
    emit.await?;
    persist.await
}

async fn evaluate_dirty(org: &str, ring: &Ring, ownership: &Ownership<'_>) -> anyhow::Result<()> {
    let due = DIRTY
        .lock()
        .expect("service signals dirty scopes")
        .get(org)
        .cloned();
    QUERY_COUNT
        .scope(std::cell::Cell::new(0), async {
            let result = super::verdicts::evaluate(org, ring, due.as_ref(), ownership).await;
            log::info!(
                "[ServiceSignals] org={org} evaluated_at={} queries={}",
                ring.end,
                QUERY_COUNT.with(std::cell::Cell::get)
            );
            result
        })
        .await?;
    DIRTY
        .lock()
        .expect("service signals dirty scopes")
        .insert(org.to_string(), BTreeSet::new());
    Ok(())
}

fn mark_dirty(org: &str, ring: &Ring) {
    let mut dirty = DIRTY.lock().expect("service signals dirty scopes");
    if let Some(scopes) = dirty.get_mut(org) {
        scopes.extend(ring.scope_keys(org));
    }
}

/// Streams O2 writes itself (such as `_evaluator` traces) never become services.
fn retain_service_sources(orgs: &mut BTreeMap<String, Vec<(String, StreamType)>>) {
    for streams in orgs.values_mut() {
        streams.retain(|(name, kind)| infra::schema::is_service_source_stream(*kind, name));
    }
}

fn ordered_query(sql: &str, first: &Value) -> Result<String, anyhow::Error> {
    let mut columns: Vec<_> = first
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("non-object rollup group"))?
        .keys()
        .filter(|name| {
            matches!(
                name.as_str(),
                "service"
                    | "where_key"
                    | "version"
                    | "operation"
                    | "k8s_namespace"
                    | "k8s_pod"
                    | "k8s_workload"
                    | "k8s_container"
                    | "error_type"
                    | "error_message"
                    | "error_handling"
                    | "page"
            ) || (name.as_str() == "env" && first.get("where_key").is_none())
        })
        .map(|name| format!("\"{}\"", name.replace('"', "\"\"")))
        .collect();
    columns.sort();
    Ok(format!(
        "SELECT * FROM ({sql}) AS rollup_groups ORDER BY {}",
        columns.join(", ")
    ))
}

async fn collect_pages<F, Fut>(page_size: usize, mut fetch: F) -> Result<Vec<Value>, anyhow::Error>
where
    F: FnMut(usize) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<Value>, anyhow::Error>>,
{
    let mut rows = Vec::new();
    loop {
        let page = fetch(rows.len()).await?;
        let complete = page.len() < page_size;
        rows.extend(page);
        if complete {
            return Ok(rows);
        }
    }
}

fn ensure_owned(lost: &tokio::sync::watch::Receiver<bool>) -> Result<(), anyhow::Error> {
    anyhow::ensure!(!*lost.borrow(), "service signals lease lost");
    Ok(())
}

async fn while_owned<T>(
    mut lost: tokio::sync::watch::Receiver<bool>,
    work: impl std::future::Future<Output = Result<T, anyhow::Error>>,
) -> Result<T, anyhow::Error> {
    ensure_owned(&lost)?;
    tokio::select! {
        biased;
        _ = lost.wait_for(|lost| *lost) => anyhow::bail!("service signals lease lost"),
        result = work => result,
    }
}

async fn learn_aliases(
    org: &str,
    pods: &[PodRow],
    observed_at: i64,
    ownership: &Ownership<'_>,
) -> Result<(), anyhow::Error> {
    let states: Vec<_> = if pods.is_empty() {
        Vec::new()
    } else {
        db::service_identity::get_cached_aliases(org)
            .await?
            .iter()
            .filter_map(alias_state)
            .collect()
    };
    publish_alias_rows(
        alias_rows(org, pods, &states, observed_at),
        ownership,
        |rows| async {
            db::service_identity::put_learned_aliases(
                org,
                &config::get_cluster_name(),
                ownership.generation,
                rows,
            )
            .await?;
            Ok(())
        },
    )
    .await
}

async fn publish_alias_rows<F, Fut>(
    mut rows: Vec<AliasRow>,
    ownership: &Ownership<'_>,
    put: F,
) -> Result<(), anyhow::Error>
where
    F: FnOnce(Vec<AliasRow>) -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    // The tick's opening fence write already proves ownership, so no rows means no write.
    if rows.is_empty() {
        return Ok(());
    }
    for row in &mut rows {
        row.fencing_token = ownership.generation;
    }
    ownership.check().await?;
    put(rows).await?;
    Ok(())
}

fn bounded_observations(
    org: &str,
    mut observations: BTreeMap<String, config::meta::service_identity::ServiceVersionObservation>,
) -> BTreeMap<String, config::meta::service_identity::ServiceVersionObservation> {
    let before = observations.len();
    // Oversized metadata is excluded while preserving the original telemetry.
    observations.retain(|_, row| {
        row.service_name.len() <= 256 && row.version.len() <= 128 && row.env.len() <= 256
    });
    db::service_versions::count_oversized(org, before - observations.len());
    observations
}

fn alias_rows(org: &str, pods: &[PodRow], states: &[AliasState], now: i64) -> Vec<AliasRow> {
    aliases::learn(pods, states)
        .into_iter()
        .filter(|row| {
            let valid =
                row.canonical.len() <= 256 && row.scope.len() <= 256 && row.alias.len() <= 256;
            if !valid {
                db::service_versions::count_oversized(org, 1);
            }
            valid
        })
        .map(|row| AliasRow {
            confidence: alias_confidence(&row, pods).to_string(),
            alias_key: alias_key(org, row.kind.as_str(), &row.scope, &row.alias),
            org_id: org.to_string(),
            kind: row.kind.as_str().to_string(),
            first_seen: pods
                .iter()
                .filter(|pod| pod.service == row.canonical && pod.k8s_namespace == row.scope)
                .map(|pod| pod.min_ts)
                .min(),
            scope: row.scope,
            alias: row.alias,
            canonical: row.canonical,
            origin: row.origin.as_str().to_string(),
            status: row.status.as_str().to_string(),
            evidence: row.evidence,
            last_seen: Some(row.last_seen),
            created_by: "system".to_string(),
            created_at: now,
            updated_at: now,
            deleted_at: row.deleted_at,
            writer_cluster: config::get_cluster_name(),
            ..Default::default()
        })
        .collect()
}

// A learned rename of one workload is high, a workload whose every pod emits the name medium.
fn alias_confidence(row: &aliases::AliasUpsert, pods: &[PodRow]) -> &'static str {
    if row.status == AliasStatus::Active || row.kind == AliasKind::Rename {
        return "high";
    }
    let workload: Vec<&PodRow> = pods
        .iter()
        .filter(|pod| {
            pod.k8s_namespace == row.scope
                && pod.k8s_workload == row.alias
                && !pod.service.is_empty()
                && pod.spans > 0
        })
        .collect();
    let all: BTreeSet<&str> = workload.iter().map(|pod| pod.k8s_pod.as_str()).collect();
    let emitting: BTreeSet<&str> = workload
        .iter()
        .filter(|pod| pod.service == row.canonical)
        .map(|pod| pod.k8s_pod.as_str())
        .collect();
    if !all.is_empty() && all == emitting {
        "medium"
    } else {
        "low"
    }
}

fn alias_state(row: &AliasRow) -> Option<AliasState> {
    Some(AliasState {
        kind: match row.kind.as_str() {
            "k8s_workload" => AliasKind::K8sWorkload,
            "rename" => AliasKind::Rename,
            _ => return None,
        },
        scope: row.scope.clone(),
        alias: row.alias.clone(),
        canonical: row.canonical.clone(),
        origin: if row.origin == "manual" {
            AliasOrigin::Manual
        } else {
            AliasOrigin::Learned
        },
        status: match row.status.as_str() {
            "rejected" => AliasStatus::Rejected,
            "proposed" => AliasStatus::Proposed,
            _ => AliasStatus::Active,
        },
        evidence: row.evidence.clone(),
        last_seen: row.last_seen.unwrap_or(0),
        deleted_at: row.deleted_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECORDED_POD: &str = r#"{"_timestamp": 1792774500000000, "cluster": "fixture-region", "env": "fixture-cluster", "k8s_cluster": "fixture-cluster", "k8s_container": "app", "k8s_namespace": "fixture-ns", "k8s_pod": "store-pod-2.0", "k8s_workload": "store-workload", "k8s_workload_kind": "deployment", "max_ts": 1792774700000000, "min_ts": 1792774501000000, "service": "store", "source_stream": "default", "spans": 200, "version": "2.0", "where_key": "k8s:fixture-cluster/fixture-ns", "window_secs": 300, "written_at": 1792778565492884}"#;

    // Global metadata pools must outlive every test future that uses them.
    static TEST_RUNTIME: LazyLock<tokio::runtime::Runtime> =
        LazyLock::new(|| tokio::runtime::Runtime::new().unwrap());

    /// Where a fake window fails: its rollup, its event emission or its cursor write.
    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Fail {
        Window,
        Emit,
        Cursor,
    }

    #[test]
    fn oversized_metadata_does_not_block_postgres_or_offset() {
        TEST_RUNTIME.block_on(async {
        use infra::table::service_versions::{
            create_tables_for_tests, sqlite_and_postgres_for_tests,
        };
                let mut pod: PodRow = serde_json::from_str(RECORDED_POD).unwrap();
        pod.service = "s".repeat(257);
        pod.k8s_workload = "workload".into();
        let mut oversized_workload = pod.clone();
        oversized_workload.service = "valid".into();
        oversized_workload.k8s_workload = "w".repeat(257);
        let mut oversized_namespace = oversized_workload.clone();
        oversized_namespace.k8s_workload = "workload".into();
        oversized_namespace.k8s_namespace = "n".repeat(257);
        let mut healthy = pod.clone();
        healthy.service = "healthy".into();
        healthy.k8s_workload = "healthy-workload".into();
        let pods = vec![pod, oversized_workload, oversized_namespace, healthy];
        let org = "oversized_tick_metadata";
        let rows = alias_rows(org, &pods, &[], now_micros());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].canonical, "healthy");
        let ctx = WindowCtx {
            org_id: org.into(),
            source_stream: "_rumdata".into(),
            window_start: 0,
            window_secs: 300,
            written_at: 1,
            cluster: "test".into(),
        };
        let hits = vec![
            serde_json::json!({"service": "s".repeat(257), "env":"prod", "version":"v1", "min_ts":1,"max_ts":2}),
        ];
        let unbounded = mappers::r1_observations(&ctx, &hits, &Default::default());
        assert_eq!(unbounded.len(), 1);
        let observations = bounded_observations(org, unbounded);
        assert!(observations.is_empty());
        for conn in sqlite_and_postgres_for_tests("oversized_tick_metadata").await {
            create_tables_for_tests(&conn).await.unwrap();
            infra::table::service_streams::create_table_for_tests(&conn)
                .await
                .unwrap();
            db::service_identity::put_aliases_with(&conn, org, rows.clone(), true)
                .await
                .unwrap();
            let stored = infra::table::service_name_aliases::list(&conn, org)
                .await
                .unwrap();
            assert_eq!(stored.len(), 1);
            assert_eq!(stored[0].canonical, "healthy");
            db::service_versions::queue_observations(org, observations.clone());
            db::service_versions::flush_org_with(&conn, org)
                .await
                .unwrap();
        }
        infra::db::create_table().await.unwrap();
        let expected = db::service_signals::get_offset().await.unwrap();
        let next = expected.0 + 300 * SECOND_MICRO_SECS;
        db::service_signals::compare_set_offset(expected, next, "oversized-test")
            .await
            .unwrap();
        assert_eq!(db::service_signals::get_offset().await.unwrap().0, next);
            });
    }

    #[test]
    fn learned_alias_window_uses_one_fenced_batch() {
        TEST_RUNTIME.block_on(async {
            let (_sender, lost) = tokio::sync::watch::channel(false);
            let ownership = Ownership {
                lock: None,
                lost,
                generation: 42,
                written_at: 300,
            };
            let rows = vec![AliasRow::default(); 8];
            let mut calls = 0;
            publish_alias_rows(rows, &ownership, |batch| {
                calls += 1;
                assert_eq!(batch.len(), 8);
                assert!(batch.iter().all(|row| row.fencing_token == 42));
                async { Ok(()) }
            })
            .await
            .unwrap();
            assert_eq!(calls, 1);
            publish_alias_rows(Vec::new(), &ownership, |_| {
                calls += 1;
                async { Ok(()) }
            })
            .await
            .unwrap();
            assert_eq!(calls, 1);
        });
    }

    #[test]
    fn takeover_aliases_use_observation_time_not_resume_time() {
        TEST_RUNTIME.block_on(async {
            use infra::table::service_versions::sqlite_and_postgres_for_tests;
            let mut a: PodRow = serde_json::from_str(RECORDED_POD).unwrap();
            a.k8s_workload = "shared-workload".into();
            a.service = "old-service".into();
            let mut b = a.clone();
            b.service = "new-service".into();
            let stale = alias_rows("takeover", &[a], &[], 300);
            let fresh = alias_rows("takeover", &[b], &[], 600);
            assert!(!stale.is_empty());
            assert_eq!(stale[0].updated_at, 300);
            for conn in sqlite_and_postgres_for_tests("takeover_aliases").await {
                infra::table::service_versions::create_tables_for_tests(&conn)
                    .await
                    .unwrap();
                for row in &fresh {
                    infra::table::service_name_aliases::upsert_learned(&conn, row)
                        .await
                        .unwrap();
                }
                for row in &stale {
                    assert!(
                        !infra::table::service_name_aliases::upsert_learned(&conn, row)
                            .await
                            .unwrap()
                    );
                }
                let rows = infra::table::service_name_aliases::list(&conn, "takeover")
                    .await
                    .unwrap();
                assert!(rows.iter().all(|row| row.canonical == "new-service"));
            }
        });
    }

    #[tokio::test]
    async fn lost_lease_cancels_before_claim_and_mid_tick_writes() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let writes = AtomicUsize::new(0);
        let (sender, lost) = tokio::sync::watch::channel(true);
        let result = while_owned(lost, async {
            writes.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await;
        assert!(result.is_err());
        let _guard = sender.subscribe();
        sender.send(false).unwrap();
        let lost = sender.subscribe();
        let (started, processing) = tokio::sync::oneshot::channel();
        let (_resume, paused) = tokio::sync::oneshot::channel::<()>();
        let work = async {
            started.send(()).unwrap();
            paused.await.unwrap();
            writes.fetch_add(3, Ordering::SeqCst);
            Ok(())
        };
        let revoke = async {
            processing.await.unwrap();
            sender.send(true).unwrap();
        };
        let (result, ()) = tokio::join!(while_owned(lost, work), revoke);
        assert!(result.is_err());
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn rollup_pagination_writes_every_group_beyond_page_size() {
        let session = datafusion::prelude::SessionContext::new();
        let sql = "SELECT service, 'env:prod' AS where_key, 'v1' AS version, 'op' AS operation, COUNT(*) AS requests FROM (VALUES ('e'), ('d'), ('c'), ('b'), ('a')) AS input(service) GROUP BY service";
        let ordered = ordered_query(sql, &serde_json::json!({"service":"e", "where_key":"env:prod", "version":"v1", "operation":"op", "requests":1})).unwrap();
        let rows = collect_pages(2, |from| {
            let session = &session;
            let ordered = &ordered;
            async move {
                let batches = session
                    .sql(ordered)
                    .await?
                    .limit(from, Some(2))?
                    .collect()
                    .await?;
                Ok(config::utils::arrow::record_batches_to_json_rows(
                    &batches.iter().collect::<Vec<_>>(),
                )?
                .into_iter()
                .map(Value::Object)
                .collect())
            }
        })
        .await
        .unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(
            rows.iter()
                .map(|row| row["service"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["a", "b", "c", "d", "e"]
        );
        let ctx = WindowCtx {
            org_id: "pagination_groups".into(),
            source_stream: "trace".into(),
            window_start: 0,
            window_secs: 3600,
            written_at: 1,
            cluster: "test".into(),
        };
        let written: Vec<_> = mappers::map_t2(&ctx, &rows, &Default::default())
            .iter()
            .map(SignalRow::to_json)
            .collect();
        assert_eq!(written.len(), 5);
    }

    #[test]
    fn pods_pass_gated_on_k8s_columns() {
        TEST_RUNTIME.block_on(async {
            use opentelemetry_proto::tonic::{
                collector::trace::v1::ExportTraceServiceRequest,
                common::v1::{AnyValue, KeyValue, any_value},
                resource::v1::Resource,
                trace::v1::{ResourceSpans, ScopeSpans, Span},
            };
            let org = "service_signals_pod_gating";
            infra::db::create_table().await.unwrap();
            for (stream, with_pod) in [("plain", false), ("pods", true)] {
                let pairs = if with_pod {
                    vec![
                        ("service.name", "store"),
                        ("k8s.namespace.name", "ns"),
                        ("k8s.pod.name", "pod"),
                    ]
                } else {
                    vec![("service.name", "store")]
                };
                let attributes = pairs
                    .into_iter()
                    .map(|(key, value)| KeyValue {
                        key: key.into(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue(value.into())),
                        }),
                        ..Default::default()
                    })
                    .collect();
                let now = now_micros() as u64 * 1000;
                let request = ExportTraceServiceRequest {
                    resource_spans: vec![ResourceSpans {
                        resource: Some(Resource {
                            attributes,
                            ..Default::default()
                        }),
                        scope_spans: vec![ScopeSpans {
                            spans: vec![Span {
                                trace_id: vec![3; 16],
                                span_id: vec![3; 8],
                                name: "request".into(),
                                kind: 2,
                                start_time_unix_nano: now,
                                end_time_unix_nano: now + 1_000_000,
                                ..Default::default()
                            }],
                            ..Default::default()
                        }],
                        ..Default::default()
                    }],
                };
                let response = crate::traces::handle_otlp_request(
                    org,
                    request,
                    config::meta::otlp::OtlpRequestType::HttpProtobuf,
                    Some(stream),
                    ingestion_common::IngestUser::from_user_email("fixture@example.com"),
                )
                .await
                .unwrap();
                assert_eq!(response.status(), axum::http::StatusCode::OK);
                let schema = infra::schema::get(org, stream, StreamType::Traces)
                    .await
                    .unwrap();
                let cols = schema
                    .fields()
                    .iter()
                    .map(|field| field.name().clone())
                    .collect();
                assert_eq!(
                    sql::build_t3_sql(
                        stream,
                        now as i64 / 1000 - 1,
                        now as i64 / 1000 + 2_000,
                        &cols
                    )
                    .is_some(),
                    with_pod
                );
            }
        });
    }

    fn fake_tick(
        plans: Vec<OrgPlan>,
        costs: &[(&str, i64)],
        concurrency: usize,
        budget: i64,
    ) -> (Vec<(String, i64, bool)>, i64) {
        let (closed, elapsed, _) =
            fake_tick_with(plans, costs, concurrency, budget, Vec::new(), &[]);
        (closed, elapsed)
    }

    fn fake_tick_with(
        plans: Vec<OrgPlan>,
        costs: &[(&str, i64)],
        concurrency: usize,
        budget: i64,
        arrivals: Vec<(i64, OrgPlan)>,
        failures: &[(&str, i64, Fail)],
    ) -> (Vec<(String, i64, bool)>, i64, i64) {
        use std::sync::atomic::{AtomicI64, Ordering};
        let clock = AtomicI64::new(0);
        let (active, peak) = (AtomicI64::new(0), AtomicI64::new(0));
        let closed = Mutex::new(Vec::new());
        let arrivals = Mutex::new(arrivals);
        let costs: HashMap<String, i64> = costs
            .iter()
            .map(|(org, cost)| (org.to_string(), *cost))
            .collect();
        let now = || clock.load(Ordering::SeqCst);
        let results = TEST_RUNTIME.block_on(run_plans(
            plans,
            RunLimits {
                concurrency,
                budget,
                rescan: 1,
            },
            &now,
            std::future::pending::<()>,
            |seen: BTreeSet<String>| {
                let mut pending = arrivals.lock().unwrap();
                let (due, later): (Vec<_>, Vec<_>) = pending
                    .drain(..)
                    .partition(|(at, plan)| *at <= now() && !seen.contains(&plan.org));
                *pending = later;
                async move { due.into_iter().map(|(_, plan)| plan).collect() }
            },
            |org: String, end: i64| {
                clock.fetch_add(costs[&org], Ordering::SeqCst);
                let (active, peak) = (&active, &peak);
                let fails = failures.contains(&(org.as_str(), end, Fail::Window));
                async move {
                    peak.fetch_max(active.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
                    tokio::task::yield_now().await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    anyhow::ensure!(!fails, "window failed");
                    Ok(end)
                }
            },
            |org: String, end: i64, ring: i64, step: Step| {
                let fails = |stage: Fail| failures.contains(&(org.as_str(), end, stage));
                let (emit_fails, cursor_fails) = (fails(Fail::Emit), fails(Fail::Cursor));
                let closed = &closed;
                async move {
                    let record =
                        |evaluated| closed.lock().unwrap().push((org.clone(), ring, evaluated));
                    let result = if step == Step::Evaluate {
                        record(true);
                        Ok(())
                    } else {
                        close_in_order(
                            step == Step::Last,
                            async {
                                record(true);
                                Ok(())
                            },
                            async {
                                anyhow::ensure!(!emit_fails, "emission failed");
                                Ok(())
                            },
                            async {
                                anyhow::ensure!(!cursor_fails, "cursor write failed");
                                if step == Step::Window {
                                    record(false);
                                }
                                Ok(())
                            },
                        )
                        .await
                    };
                    (ring, result)
                }
            },
        ));
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_err()).count(),
            failures.len()
        );
        (
            closed.into_inner().unwrap(),
            clock.load(Ordering::SeqCst),
            peak.load(Ordering::SeqCst),
        )
    }

    fn plan(org: &str, windows: i64) -> OrgPlan {
        OrgPlan {
            org: org.into(),
            ends: (1..=windows).map(|n| n * 10).collect(),
            fresh: false,
        }
    }

    #[test]
    fn every_org_is_evaluated_once_per_tick_at_its_newest_window() {
        let orgs = ["a", "b", "c"];
        let plans = orgs.iter().map(|org| plan(org, 4)).collect();
        let costs: Vec<_> = orgs.iter().map(|org| (*org, 1)).collect();
        let (closed, _) = fake_tick(plans, &costs, 4, i64::MAX);
        assert_eq!(closed.len(), 12);
        for org in orgs {
            let evaluated: Vec<_> = closed
                .iter()
                .filter(|(name, _, last)| name == org && *last)
                .map(|(_, end, _)| *end)
                .collect();
            assert_eq!(evaluated, vec![40], "{org}");
        }
    }

    #[test]
    fn a_heavy_org_does_not_hold_back_a_light_one() {
        let (closed, elapsed) = fake_tick(
            vec![plan("heavy", 30), plan("light", 1)],
            &[("heavy", 10), ("light", 1)],
            1,
            15,
        );
        assert_eq!(
            closed,
            vec![
                ("light".to_string(), 10, true),
                ("heavy".to_string(), 10, false),
                ("heavy".to_string(), 20, true),
            ]
        );
        assert_eq!(elapsed, 21);
    }

    #[test]
    fn an_org_started_late_in_the_tick_still_gets_its_own_budget() {
        let (closed, _) = fake_tick(
            vec![plan("slow", 1), plan("behind", 5)],
            &[("slow", 12), ("behind", 1)],
            1,
            10,
        );
        let behind: Vec<_> = closed
            .iter()
            .filter(|(org, ..)| org == "behind")
            .map(|(_, end, last)| (*end, *last))
            .collect();
        assert_eq!(
            behind,
            vec![
                (10, false),
                (20, false),
                (30, false),
                (40, false),
                (50, true)
            ]
        );
    }

    #[test]
    fn a_fresh_org_goes_first_within_one_cap_over_all_lanes() {
        let fresh = |org| OrgPlan {
            fresh: true,
            ..plan(org, 1)
        };
        let (closed, _, peak) = fake_tick_with(
            vec![plan("heavy", 3), plan("busy", 3), fresh("new")],
            &[("heavy", 10), ("busy", 10), ("new", 1)],
            1,
            i64::MAX,
            Vec::new(),
            &[],
        );
        assert_eq!((peak, closed[0].0.as_str()), (1, "new"));
        let (_, _, peak) = fake_tick_with(
            vec![
                plan("a", 3),
                plan("b", 3),
                plan("c", 3),
                fresh("x"),
                fresh("y"),
                fresh("z"),
            ],
            &[
                ("a", 10),
                ("b", 10),
                ("c", 10),
                ("x", 1),
                ("y", 1),
                ("z", 1),
            ],
            4,
            i64::MAX,
            Vec::new(),
            &[],
        );
        assert_eq!(peak, 4);
    }

    #[test]
    fn windows_closed_before_a_failure_are_still_evaluated() {
        let (closed, ..) = fake_tick_with(
            vec![plan("window", 5), plan("close", 5)],
            &[("window", 1), ("close", 1)],
            2,
            i64::MAX,
            Vec::new(),
            &[("window", 40, Fail::Window), ("close", 30, Fail::Emit)],
        );
        let of = |org: &str| -> Vec<_> {
            closed
                .iter()
                .filter(|(name, ..)| name == org)
                .map(|(_, end, evaluated)| (*end, *evaluated))
                .collect()
        };
        assert_eq!(
            of("window"),
            vec![(10, false), (20, false), (30, false), (30, true)]
        );
        assert_eq!(of("close"), vec![(10, false), (20, false), (30, true)]);
        let (closed, ..) = fake_tick_with(
            vec![plan("first", 3)],
            &[("first", 1)],
            1,
            i64::MAX,
            Vec::new(),
            &[("first", 10, Fail::Window)],
        );
        assert!(closed.is_empty());
    }

    #[test]
    fn a_failed_emission_or_cursor_write_still_evaluates_the_windows_rolled_up() {
        let orgs = [
            ("emit_first", 3, 10, Fail::Emit),
            ("cursor_first", 3, 10, Fail::Cursor),
            ("emit_later", 4, 30, Fail::Emit),
            ("cursor_later", 4, 30, Fail::Cursor),
            ("emit_last", 2, 20, Fail::Emit),
            ("cursor_last", 2, 20, Fail::Cursor),
        ];
        let (closed, ..) = fake_tick_with(
            orgs.iter().map(|(org, n, ..)| plan(org, *n)).collect(),
            &orgs.map(|(org, ..)| (org, 1)),
            orgs.len(),
            i64::MAX,
            Vec::new(),
            &orgs.map(|(org, _, end, fail)| (org, end, fail)),
        );
        for (org, _, failed_at, _) in orgs {
            let of = |evaluated: bool| -> Vec<i64> {
                closed
                    .iter()
                    .filter(|(name, _, e)| name == org && *e == evaluated)
                    .map(|(_, end, _)| *end)
                    .collect()
            };
            let persisted: Vec<i64> = (1..failed_at / 10).map(|n| n * 10).collect();
            assert_eq!((of(true), of(false)), (vec![failed_at], persisted), "{org}");
        }
    }

    #[test]
    fn an_org_that_appears_mid_tick_runs_in_the_same_tick() {
        let (closed, ..) = fake_tick_with(
            vec![plan("heavy", 5), plan("light", 1)],
            &[("heavy", 10), ("light", 1), ("new", 1)],
            2,
            i64::MAX,
            vec![(5, plan("new", 1)), (5, plan("light", 1))],
            &[],
        );
        assert_eq!(
            closed
                .iter()
                .filter(|(org, _, last)| org == "new" && *last)
                .count(),
            1
        );
        assert_eq!(closed.iter().filter(|(org, ..)| org == "light").count(), 1);
    }

    #[test]
    fn a_new_org_starts_at_the_current_window_and_a_tracked_one_resumes() {
        let interval = 10 * SECOND_MICRO_SECS;
        let horizon = 1_700_000_005 * SECOND_MICRO_SECS;
        let latest = align_down(horizon, interval);
        let shared = latest - 50 * interval;
        let ends = |own, tracked| plan_org("org", own, tracked, shared, horizon, interval).ends;
        assert_eq!(ends(None, false), vec![latest]);
        assert!(plan_org("org", None, false, shared, horizon, interval).fresh);
        assert!(!plan_org("org", None, true, shared, horizon, interval).fresh);
        assert!(!plan_org("org", Some(latest), false, shared, horizon, interval).fresh);
        let resumed = ends(None, true);
        assert_eq!((resumed.len(), resumed.last()), (50, Some(&latest)));
        assert!(ends(Some(latest), true).is_empty());
        assert_eq!(
            ends(Some(latest - 3 * interval), true),
            vec![latest - 2 * interval, latest - interval, latest]
        );
        assert_eq!(
            ends(Some(latest - MAX_BACKLOG_MICROS - interval), true),
            vec![latest]
        );
    }

    #[test]
    fn an_org_past_the_backlog_limit_recovers_over_consecutive_ticks() {
        let interval = 10 * SECOND_MICRO_SECS;
        let mut horizon = 1_700_000_005 * SECOND_MICRO_SECS;
        let mut own = Some(horizon - MAX_BACKLOG_MICROS - 7 * interval);
        for _ in 0..3 {
            let ends = plan_org("org", own, true, 0, horizon, interval).ends;
            assert_eq!(ends, vec![align_down(horizon, interval)]);
            own = ends.last().copied();
            horizon += interval;
        }
    }

    #[test]
    fn lanes_default_to_the_cpu_count_under_a_cap() {
        assert_eq!(org_lanes(2), 2);
        assert_eq!(org_lanes(12), 12);
        assert_eq!(org_lanes(96), MAX_AUTO_LANES);
        assert_eq!(org_lanes(0), 1);
    }

    #[test]
    fn only_orgs_with_traffic_or_verdict_work_are_rolled_up() {
        let hour = 3_600 * SECOND_MICRO_SECS;
        let since = 1_000 * hour;
        let traces = |name: &str| (name.to_string(), StreamType::Traces);
        let rum = ("_rumdata".to_string(), StreamType::Logs);
        let stats = |newest: i64| StreamStats {
            created_at: 1,
            doc_time_min: newest - hour,
            doc_time_max: newest,
            ..Default::default()
        };
        for (org, stream, kind, newest) in [
            ("o2sel_busy", "default", StreamType::Traces, since + hour),
            ("o2sel_busy", "old", StreamType::Traces, since - 48 * hour),
            (
                "o2sel_judged",
                "default",
                StreamType::Traces,
                since - 48 * hour,
            ),
            ("o2sel_idle", "default", StreamType::Traces, since - 1),
            ("o2sel_idle", "_rumdata", StreamType::Logs, since - hour),
            ("o2sel_rum_app", "_rumdata", StreamType::Logs, since),
        ] {
            infra::cache::stats::set_stream_stats(org, stream, kind, stats(newest));
        }
        let known: Sources = [
            ("o2sel_busy", vec![traces("default"), traces("old")]),
            ("o2sel_judged", vec![traces("default")]),
            ("o2sel_idle", vec![traces("default"), rum.clone()]),
            ("o2sel_logs_only", vec![]),
            ("o2sel_rum_app", vec![rum.clone()]),
            ("o2sel_unflushed", vec![traces("default")]),
        ]
        .into_iter()
        .map(|(org, streams)| (org.to_string(), streams))
        .collect();
        let work: BTreeSet<String> = ["o2sel_judged".to_string()].into_iter().collect();
        let selected = select_sources(known.clone(), Some(&work), since);
        assert_eq!(
            selected.keys().map(String::as_str).collect::<Vec<_>>(),
            [
                "o2sel_busy",
                "o2sel_judged",
                "o2sel_rum_app",
                "o2sel_unflushed"
            ]
        );
        assert_eq!(selected["o2sel_busy"], [traces("default"), traces("old")]);
        assert_eq!(select_sources(known.clone(), None, since), known);
    }

    #[test]
    fn with_usage_reporting_off_only_the_org_with_recent_data_runs() {
        let interval = 300 * SECOND_MICRO_SECS;
        let start = 10_000 * interval;
        let since = start - stats_lag_micros();
        for (org, newest) in [
            ("o2usage_off_active", start - interval),
            ("o2usage_off_idle", since - 3 * interval),
        ] {
            infra::cache::stats::set_stream_stats(
                org,
                "default",
                StreamType::Traces,
                StreamStats {
                    created_at: 1,
                    doc_time_min: newest - interval,
                    doc_time_max: newest,
                    ..Default::default()
                },
            );
        }
        let known: Sources = ["o2usage_off_active", "o2usage_off_idle"]
            .into_iter()
            .map(|org| {
                (
                    org.to_string(),
                    vec![("default".to_string(), StreamType::Traces)],
                )
            })
            .collect();
        let selected = select_sources(known, Some(&BTreeSet::new()), since);
        assert_eq!(
            selected.keys().map(String::as_str).collect::<Vec<_>>(),
            ["o2usage_off_active"]
        );
    }

    #[test]
    fn rollup_reads_no_stream_o2_writes_itself() {
        let mut orgs = BTreeMap::from([(
            "org".to_string(),
            vec![
                ("default".to_string(), StreamType::Traces),
                ("_evaluator".to_string(), StreamType::Traces),
                ("_rumdata".to_string(), StreamType::Logs),
            ],
        )]);
        retain_service_sources(&mut orgs);
        assert_eq!(
            orgs["org"],
            vec![
                ("default".to_string(), StreamType::Traces),
                ("_rumdata".to_string(), StreamType::Logs),
            ]
        );
    }

    #[test]
    fn alias_confidence_follows_the_pod_shape() {
        let base: PodRow = serde_json::from_str(RECORDED_POD).unwrap();
        let pod = |workload: &str, name: &str, service: &str| {
            let mut row = base.clone();
            row.k8s_namespace = "shop".into();
            row.k8s_workload = workload.into();
            row.k8s_pod = name.into();
            row.service = service.into();
            row.spans = 5;
            row
        };
        let pods = vec![
            pod("solo", "solo-0", "solo-svc"),
            pod("sidecar", "sidecar-0", "app"),
            pod("sidecar", "sidecar-0", "envoy"),
            pod("sidecar", "sidecar-1", "app"),
            pod("sidecar", "sidecar-1", "envoy"),
            pod("split", "split-0", "left"),
            pod("split", "split-1", "right"),
            pod("renamed", "renamed-0", "checkout-v2"),
        ];
        let prior = AliasState {
            kind: AliasKind::K8sWorkload,
            scope: "shop".into(),
            alias: "renamed".into(),
            canonical: "checkout".into(),
            origin: AliasOrigin::Learned,
            status: AliasStatus::Active,
            evidence: None,
            last_seen: base.min_ts,
            deleted_at: None,
        };
        let rows = alias_rows("alias_confidence", &pods, &[prior], now_micros());
        let confidence = |kind: &str, alias: &str| {
            rows.iter()
                .find(|row| row.kind == kind && row.alias == alias)
                .map(|row| (row.status.as_str(), row.confidence.as_str()))
                .unwrap()
        };
        assert_eq!(confidence("k8s_workload", "solo"), ("active", "high"));
        assert_eq!(
            confidence("k8s_workload", "sidecar"),
            ("proposed", "medium")
        );
        assert_eq!(confidence("k8s_workload", "split"), ("proposed", "low"));
        assert_eq!(confidence("rename", "checkout"), ("proposed", "high"));
    }
}
