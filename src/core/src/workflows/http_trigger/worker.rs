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

//! The region's hook worker: one lock holder claims queued ledger rows and runs them.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use bytes::Bytes;
use config::{cluster::LOCAL_NODE, utils::time::now_micros};
use infra::{
    db::{NO_NEED_WATCH, get_orm_client_rw},
    table::{
        entity::{
            workflow_http_trigger_credentials as credentials,
            workflow_http_trigger_requests::Model as HookRequest, workflow_run_data,
        },
        workflow_http_trigger_requests::{
            self as ledger, ERR_CREDENTIAL_REVOKED, ERR_ENDPOINT_DISABLED, ERR_RUN_TIMEOUT,
            ERR_WORKER_LOST, ERR_WORKFLOW_DISABLED, HookRunStatus, LocalClaims, RunningCounts,
        },
        workflow_http_triggers::{self as http_triggers, CredentialState},
    },
};
use sea_orm::{ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter};
use tokio::{
    sync::Notify,
    task::JoinHandle,
    time::{Instant, MissedTickBehavior},
};
use tokio_util::sync::CancellationToken;

use super::{HEARTBEAT_KEY, WORKER_LOCK_KEY, sweeper, wake};
use crate::{
    common::utils::get_nats_lock,
    workflows::{WorkflowExecutionStatus, publish_hook_history, run_hook_workflow},
};

pub const HEARTBEAT_STALE_SECS: i64 = 15;
pub const ERR_NODE_ERRORED: &str = "node_errored";
pub const ERR_RUN_FAILED: &str = "run_failed";
pub const ERR_PAYLOAD_MISSING: &str = "payload_missing";
const TICK: Duration = Duration::from_secs(2);
const HEARTBEAT_EVERY: Duration = Duration::from_secs(5);
const MAINTENANCE_EVERY: Duration = Duration::from_secs(60);
const RESTART_AFTER: Duration = Duration::from_secs(1);
const REAP_GRACE_SECS: i64 = 60;
// Bounds back-to-back passes so a long backlog cannot starve the heartbeat.
const MAX_PASSES_PER_WAKE: usize = 32;
const DRAIN_POLL: Duration = Duration::from_millis(100);
// Shares of the shutdown cap: runs end on their own, then cancelled, then the ledger cleanup.
const DRAIN_CANCEL_AT: f64 = 0.5;
const DRAIN_CLEANUP_AT: f64 = 0.8;

static IN_FLIGHT: LazyLock<InFlightRuns> = LazyLock::new(Default::default);
// Read outside `CLAIMING`, so a stalled pass holding that lock cannot delay the stop.
static STOPPING: AtomicBool = AtomicBool::new(false);
// Lock renewals and claim passes hold it, so the shutdown drain waits out the pass in progress.
static CLAIMING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static HOLDING: AtomicBool = AtomicBool::new(false);

type InFlightRuns = parking_lot::Mutex<HashMap<i64, CancellationToken>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkerLimits {
    pub global: u64,
    pub per_org: u64,
    pub run_timeout: Duration,
    pub queue_ttl: Duration,
}

impl WorkerLimits {
    pub fn from_config() -> Self {
        let limit = &config::get_config().limit;
        Self {
            global: limit.workflow_hook_concurrency,
            per_org: limit.workflow_hook_org_concurrency,
            run_timeout: Duration::from_secs(limit.workflow_hook_run_timeout_secs),
            queue_ttl: Duration::from_secs(limit.workflow_hook_queue_ttl_secs),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimDecision {
    Run,
    Expire,
    WorkflowDisabled,
    EndpointDisabled,
    CredentialRevoked,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Heartbeat {
    pub node_uuid: String,
    pub ts: i64,
}

#[async_trait]
trait HookMetaStore: Send + Sync {
    async fn get(&self, key: &str) -> Result<Option<Bytes>, anyhow::Error>;
    async fn put(&self, key: &str, value: Bytes) -> Result<(), anyhow::Error>;
    async fn delete(&self, key: &str) -> Result<(), anyhow::Error>;
}

struct MetaStore;

#[async_trait]
impl HookMetaStore for MetaStore {
    async fn get(&self, key: &str) -> Result<Option<Bytes>, anyhow::Error> {
        Ok(infra::db::get_db().await.get_if_exists(key).await?)
    }

    async fn put(&self, key: &str, value: Bytes) -> Result<(), anyhow::Error> {
        Ok(infra::db::get_db()
            .await
            .put(key, value, NO_NEED_WATCH, None)
            .await?)
    }

    async fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
        Ok(infra::db::get_db()
            .await
            .delete(key, false, NO_NEED_WATCH, None)
            .await?)
    }
}

/// What one claim pass reads besides the ledger, so tests can drive it on an in-memory DB.
#[async_trait]
trait ClaimHooks: Send + Sync {
    async fn workflow_enabled(
        &self,
        org_id: &str,
        workflow_id: &str,
    ) -> Result<Option<bool>, anyhow::Error>;
    fn org_blocked(&self, org_id: &str) -> bool;
    /// Read from the meta DB, not the trigger cache, so a revoke stops runs queued before it.
    async fn endpoint_decision(&self, row: &HookRequest) -> Result<ClaimDecision, anyhow::Error>;
    fn start_run(&self, row: HookRequest);
}

struct LiveClaims {
    node_uuid: String,
    limits: WorkerLimits,
    wake: Arc<Notify>,
}

#[async_trait]
impl ClaimHooks for LiveClaims {
    async fn workflow_enabled(
        &self,
        org_id: &str,
        workflow_id: &str,
    ) -> Result<Option<bool>, anyhow::Error> {
        Ok(db::workflows::get_workflow(org_id, workflow_id)
            .await?
            .map(|workflow| workflow.enabled))
    }

    fn org_blocked(&self, org_id: &str) -> bool {
        db::org_status::is_blocked(org_id)
    }

    async fn endpoint_decision(&self, row: &HookRequest) -> Result<ClaimDecision, anyhow::Error> {
        let rw = get_orm_client_rw().await;
        Ok(endpoint_decision_in(rw, &row.trigger_id, &row.credential_id).await?)
    }

    fn start_run(&self, row: HookRequest) {
        let (node_uuid, limits) = (self.node_uuid.clone(), self.limits);
        spawn_run(row.id, self.wake.clone(), move |cancel| {
            run_claimed(row, node_uuid, limits, cancel)
        });
    }
}

/// Holds a run's ledger id and cancel token in `IN_FLIGHT` until its task ends, a panic included.
struct InFlight {
    id: i64,
    cancel: CancellationToken,
    wake: Arc<Notify>,
}

impl InFlight {
    fn enter(id: i64, wake: Arc<Notify>) -> Self {
        let cancel = CancellationToken::new();
        IN_FLIGHT.lock().insert(id, cancel.clone());
        Self { id, cancel, wake }
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        IN_FLIGHT.lock().remove(&self.id);
        // A run ending can free a slot; waiting for the tick caps a backlog at per_org per 2 s.
        self.wake.notify_one();
    }
}

/// The ledger keeps a stable code that callers poll; the error text goes to run history only.
#[derive(Debug, PartialEq, Eq)]
struct RunEnd {
    status: HookRunStatus,
    code: Option<&'static str>,
    detail: Option<String>,
}

impl RunEnd {
    fn failed(code: &'static str, detail: String) -> Self {
        Self {
            status: HookRunStatus::Failed,
            code: Some(code),
            detail: Some(detail),
        }
    }
}

struct ClaimPass {
    node_uuid: String,
    limits: WorkerLimits,
    now_us: i64,
    live_nodes: Option<HashSet<String>>,
    in_flight: HashSet<i64>,
}

/// The loop's side effects, so the tick and leadership timing are testable without a cluster.
#[async_trait]
trait WorkerEnv: Send + Sync {
    async fn hold_lock(&self) -> bool;
    async fn claim_pass(&self, cursor: &mut usize) -> Result<usize, anyhow::Error>;
    /// False while the previous maintenance is still running, so the caller retries later.
    async fn maintain(&self, anti_entropy: bool) -> bool;
}

struct LiveWorker {
    node_uuid: String,
    limits: WorkerLimits,
    maintaining: Arc<AtomicBool>,
    wake: Arc<Notify>,
}

#[async_trait]
impl WorkerEnv for LiveWorker {
    async fn hold_lock(&self) -> bool {
        let Some(_claiming) = claim_guard().await else {
            return false;
        };
        let held = match get_nats_lock(WORKER_LOCK_KEY.to_string()).await {
            Ok(owner) if owner == self.node_uuid => {
                if let Err(e) = write_heartbeat(&self.node_uuid).await {
                    log::error!("[WORKFLOW_HOOK] heartbeat write failed: {e}");
                }
                true
            }
            Ok(_) => false,
            Err(e) => {
                log::error!("[WORKFLOW_HOOK] worker lock check failed: {e}");
                false
            }
        };
        HOLDING.store(held, Ordering::Release);
        held
    }

    async fn claim_pass(&self, cursor: &mut usize) -> Result<usize, anyhow::Error> {
        let Some(_claiming) = claim_guard().await else {
            return Ok(0);
        };
        claim_cycle(&self.node_uuid, self.limits, &self.wake, cursor).await
    }

    /// Detached, so a long anti-entropy pass never delays the heartbeat past its 15 s.
    async fn maintain(&self, anti_entropy: bool) -> bool {
        if self.maintaining.swap(true, Ordering::AcqRel) {
            return false;
        }
        let maintaining = self.maintaining.clone();
        tokio::task::spawn(async move {
            if let Err(e) = tokio::task::spawn(maintain_once(anti_entropy)).await {
                log::error!("[WORKFLOW_HOOK] maintenance panicked: {e}");
            }
            maintaining.store(false, Ordering::Release);
        });
        true
    }
}

pub fn decide_at_claim(
    received_at_us: i64,
    now_us: i64,
    ttl: Duration,
    workflow_enabled: Option<bool>,
) -> ClaimDecision {
    let ttl_us = i64::try_from(ttl.as_micros()).unwrap_or(i64::MAX);
    if now_us.saturating_sub(received_at_us) > ttl_us {
        return ClaimDecision::Expire;
    }
    match workflow_enabled {
        Some(true) => ClaimDecision::Run,
        _ => ClaimDecision::WorkflowDisabled,
    }
}

/// One entry per slot to fill, starting after the org served last, within both caps.
pub fn pick_round_robin(
    orgs_with_queued: &[String],
    running: &RunningCounts,
    limits: &WorkerLimits,
    cursor: &mut usize,
) -> Vec<String> {
    let orgs = orgs_with_queued;
    if orgs.is_empty() {
        return Vec::new();
    }
    let mut total = running.total;
    let mut taken: Vec<u64> = orgs
        .iter()
        .map(|org| running.by_org.get(org).copied().unwrap_or_default())
        .collect();
    let start = *cursor % orgs.len();
    let mut picks = Vec::new();
    let mut last = None;
    let mut progressed = true;
    while progressed && total < limits.global {
        progressed = false;
        for step in 0..orgs.len() {
            let i = (start + step) % orgs.len();
            if total < limits.global && taken[i] < limits.per_org {
                taken[i] += 1;
                total += 1;
                picks.push(orgs[i].clone());
                last = Some(i);
                progressed = true;
            }
        }
    }
    if let Some(i) = last {
        *cursor = i + 1;
    }
    picks
}

/// The sweeper stores a retiring credential's natural expiry as revoked at exactly `expires_at`.
pub fn revoked_explicitly(
    state: CredentialState,
    expires_at: Option<i64>,
    revoked_at: Option<i64>,
) -> bool {
    state == CredentialState::Revoked && (expires_at.is_none() || revoked_at != expires_at)
}

pub fn heartbeat_is_fresh_at(heartbeat: Option<&Heartbeat>, now_us: i64) -> bool {
    heartbeat.is_some_and(|heartbeat| now_us - heartbeat.ts <= HEARTBEAT_STALE_SECS * 1_000_000)
}

pub async fn heartbeat_is_fresh() -> bool {
    let heartbeat = match MetaStore.get(HEARTBEAT_KEY).await {
        Ok(Some(value)) => serde_json::from_slice::<Heartbeat>(&value).ok(),
        Ok(None) => None,
        Err(e) => {
            log::warn!("[WORKFLOW_HOOK] heartbeat read failed: {e}");
            None
        }
    };
    heartbeat_is_fresh_at(heartbeat.as_ref(), now_micros())
}

/// Reads the RW handle: a replica may not have the payload committed a moment ago.
pub async fn load_run_input<C: ConnectionTrait>(
    rw: &C,
    row: &HookRequest,
) -> Result<Option<serde_json::Value>, anyhow::Error> {
    let payload = ledger::read_payload(rw, &row.org_id, &row.workflow_id, &row.run_id).await?;
    Ok(payload
        .map(|payload| serde_json::from_str(&payload))
        .transpose()?)
}

pub async fn run_supervisor() {
    let notify = Arc::new(Notify::new());
    let watched = notify.clone();
    tokio::task::spawn(async move {
        if let Err(e) = wake::watch_wakes(watched).await {
            log::error!("[WORKFLOW_HOOK] wake watch failed, the tick still claims: {e}");
        }
    });
    let node_uuid = LOCAL_NODE.uuid.clone();
    loop {
        let worker = tokio::task::spawn(run_worker(notify.clone()));
        let exit = supervise(&MetaStore, &node_uuid, worker).await;
        log::error!("[WORKFLOW_HOOK] worker exited ({exit}), restarting");
        tokio::time::sleep(RESTART_AFTER).await;
    }
}

/// On the worker's node: stops claims and runs, then fails what is left, within the shutdown cap.
pub async fn drain_on_shutdown() {
    let cap = Duration::from_secs(config::get_config().limit.http_shutdown_timeout.max(1));
    drain_in(
        get_orm_client_rw(),
        &MetaStore,
        &LOCAL_NODE.uuid,
        stop_claims(),
        &IN_FLIGHT,
        cap,
    )
    .await;
}

async fn run_worker(notify: Arc<Notify>) -> Result<(), anyhow::Error> {
    let env = LiveWorker {
        node_uuid: LOCAL_NODE.uuid.clone(),
        limits: WorkerLimits::from_config(),
        maintaining: Arc::new(AtomicBool::new(false)),
        wake: notify.clone(),
    };
    worker_loop(&env, notify).await
}

async fn worker_loop<E: WorkerEnv>(env: &E, notify: Arc<Notify>) -> Result<(), anyhow::Error> {
    let mut beat = tokio::time::interval(HEARTBEAT_EVERY);
    beat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut cursor = 0;
    let mut held = false;
    let mut maintained: Option<Instant> = None;
    let mut anti_entropy_at: Option<Instant> = None;
    loop {
        let check_lock = tokio::select! {
            biased;
            _ = beat.tick() => true,
            _ = tick.tick() => false,
            () = notify.notified() => false,
        };
        if check_lock {
            held = env.hold_lock().await;
            if !held {
                // A regained lock is a new holder's start, which re-emits every snapshot.
                anti_entropy_at = None;
                maintained = None;
            }
        }
        if !held {
            continue;
        }
        if maintained.is_none_or(|at| at.elapsed() >= MAINTENANCE_EVERY) {
            let anti_entropy =
                anti_entropy_at.is_none_or(|at| at.elapsed() >= sweeper::ANTI_ENTROPY_EVERY);
            if env.maintain(anti_entropy).await {
                maintained = Some(Instant::now());
                if anti_entropy {
                    anti_entropy_at = maintained;
                }
            }
        }
        drain(env, &mut cursor).await;
    }
}

async fn drain<E: WorkerEnv>(env: &E, cursor: &mut usize) {
    for _ in 0..MAX_PASSES_PER_WAKE {
        match env.claim_pass(cursor).await {
            Ok(0) => return,
            Ok(_) => {}
            Err(e) => {
                log::error!("[WORKFLOW_HOOK] claim pass failed: {e}");
                return;
            }
        }
    }
}

async fn claim_cycle(
    node_uuid: &str,
    limits: WorkerLimits,
    wake: &Arc<Notify>,
    cursor: &mut usize,
) -> Result<usize, anyhow::Error> {
    let nodes = infra::cluster::get_cached_nodes(|_| true)
        .await
        .map(|nodes| nodes.into_iter().map(|node| node.uuid).collect());
    let pass = ClaimPass {
        node_uuid: node_uuid.to_string(),
        limits,
        now_us: now_micros(),
        live_nodes: live_nodes_for_reap(nodes, node_uuid),
        in_flight: IN_FLIGHT.lock().keys().copied().collect(),
    };
    let hooks = LiveClaims {
        node_uuid: node_uuid.to_string(),
        limits,
        wake: wake.clone(),
    };
    claim_pass_in(get_orm_client_rw().await, &hooks, &pass, cursor).await
}

async fn claim_pass_in<C: ConnectionTrait, H: ClaimHooks>(
    db: &C,
    hooks: &H,
    pass: &ClaimPass,
    cursor: &mut usize,
) -> Result<usize, anyhow::Error> {
    let limits = &pass.limits;
    if let Some(live_nodes) = &pass.live_nodes {
        let run_timeout_us = i64::try_from(limits.run_timeout.as_micros()).unwrap_or(i64::MAX / 2);
        let local = LocalClaims {
            node_uuid: &pass.node_uuid,
            in_flight: &pass.in_flight,
            stale_before_us: pass.now_us - run_timeout_us - REAP_GRACE_SECS * 1_000_000,
        };
        ledger::reap(db, live_nodes, local, pass.now_us).await?;
    }
    let running = ledger::running_counts(db).await?;
    let orgs = ledger::orgs_with_queued(db).await?;
    let mut drained = HashSet::new();
    let mut handled = 0;
    for org in pick_round_robin(&orgs, &running, limits, cursor) {
        if drained.contains(&org) {
            continue;
        }
        let Some(row) = ledger::oldest_queued_for_org(db, &org).await? else {
            drained.insert(org);
            continue;
        };
        if claim_or_refuse(db, hooks, pass, row).await? {
            handled += 1;
        }
    }
    Ok(handled)
}

async fn claim_or_refuse<C: ConnectionTrait, H: ClaimHooks>(
    db: &C,
    hooks: &H,
    pass: &ClaimPass,
    row: HookRequest,
) -> Result<bool, anyhow::Error> {
    let refusal = match decide(hooks, pass, &row).await? {
        ClaimDecision::Run => {
            let claimed = ledger::claim(db, row.id, &pass.node_uuid, pass.now_us).await?;
            if claimed {
                hooks.start_run(HookRequest {
                    status: HookRunStatus::Running.as_str().to_string(),
                    claimed_by: Some(pass.node_uuid.clone()),
                    claimed_at: Some(pass.now_us),
                    ..row
                });
            }
            return Ok(claimed);
        }
        ClaimDecision::Expire => (HookRunStatus::Expired, None),
        ClaimDecision::WorkflowDisabled => (HookRunStatus::Failed, Some(ERR_WORKFLOW_DISABLED)),
        ClaimDecision::EndpointDisabled => (HookRunStatus::Failed, Some(ERR_ENDPOINT_DISABLED)),
        ClaimDecision::CredentialRevoked => (HookRunStatus::Failed, Some(ERR_CREDENTIAL_REVOKED)),
    };
    let ended = ledger::finish_unclaimed(db, row.id, refusal.0, refusal.1, pass.now_us).await?;
    if ended {
        delete_payload_in(db, &row).await?;
    }
    Ok(ended)
}

async fn decide<H: ClaimHooks>(
    hooks: &H,
    pass: &ClaimPass,
    row: &HookRequest,
) -> Result<ClaimDecision, anyhow::Error> {
    // A deleting org's rows never run; its cleanup removes them afterwards.
    if hooks.org_blocked(&row.org_id) {
        return Ok(ClaimDecision::Expire);
    }
    let enabled = hooks
        .workflow_enabled(&row.org_id, &row.workflow_id)
        .await?;
    match decide_at_claim(row.received_at, pass.now_us, pass.limits.queue_ttl, enabled) {
        ClaimDecision::Run => hooks.endpoint_decision(row).await,
        refused => Ok(refused),
    }
}

/// A missing credential row counts as revoked, as does a state this build cannot read.
async fn endpoint_decision_in<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
    credential_id: &str,
) -> Result<ClaimDecision, DbErr> {
    let endpoint_on = http_triggers::get(db, trigger_id)
        .await?
        .is_some_and(|endpoint| endpoint.enabled && endpoint.deleted_at.is_none());
    if !endpoint_on {
        return Ok(ClaimDecision::EndpointDisabled);
    }
    let credential = credentials::Entity::find_by_id(credential_id)
        .one(db)
        .await?;
    let revoked = credential.is_none_or(|credential| {
        CredentialState::parse(&credential.state).is_none_or(|state| {
            revoked_explicitly(state, credential.expires_at, credential.revoked_at)
        })
    });
    Ok(if revoked {
        ClaimDecision::CredentialRevoked
    } else {
        ClaimDecision::Run
    })
}

async fn maintain_once(anti_entropy: bool) {
    let now = now_micros();
    if let Err(e) = sweeper::expire_retiring(now).await {
        log::error!("[WORKFLOW_HOOK] credential expiry failed: {e}");
    }
    if let Err(e) = sweeper::sweep_tombstones(now).await {
        log::error!("[WORKFLOW_HOOK] tombstone sweep failed: {e}");
    }
    if anti_entropy && let Err(e) = sweeper::anti_entropy_emit(now).await {
        log::error!("[WORKFLOW_HOOK] anti-entropy emit failed: {e}");
    }
}

fn spawn_run<F>(id: i64, wake: Arc<Notify>, run: impl FnOnce(CancellationToken) -> F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    let in_flight = InFlight::enter(id, wake);
    let run = run(in_flight.cancel.clone());
    tokio::task::spawn(async move {
        let _in_flight = in_flight;
        run.await;
    });
}

async fn run_claimed(
    row: HookRequest,
    node_uuid: String,
    limits: WorkerLimits,
    cancel: CancellationToken,
) {
    let rw = get_orm_client_rw().await;
    let start = now_micros();
    let end = match load_run_input(rw, &row).await {
        Ok(Some(input)) => {
            let run = run_hook_workflow(
                &row.org_id,
                &row.workflow_id,
                &row.run_id,
                input,
                cancel.clone(),
            );
            let outcome = run_with_timeout(run, cancel.clone(), limits.run_timeout).await;
            // Only the shutdown drain cancels a run that then returns before its own timeout.
            let lost = cancel.is_cancelled()
                && !matches!(outcome, None | Some(Ok(WorkflowExecutionStatus::Success)));
            if lost {
                RunEnd::failed(
                    ERR_WORKER_LOST,
                    "the node shut down during the run".to_string(),
                )
            } else {
                run_outcome(outcome)
            }
        }
        Ok(None) => RunEnd::failed(ERR_PAYLOAD_MISSING, ERR_PAYLOAD_MISSING.to_string()),
        Err(e) => RunEnd::failed(ERR_RUN_FAILED, e.to_string()),
    };
    let end_time = now_micros();
    match ledger::finish(rw, row.id, &node_uuid, end.status, end.code, end_time).await {
        Ok(true) => {
            publish_hook_history(
                &row.org_id,
                &row.workflow_id,
                &row.trigger_id,
                &row.run_id,
                start,
                end_time,
                end.detail,
            );
            if let Err(e) =
                infra::table::workflows::delete_run_data(&row.org_id, &row.workflow_id, &row.run_id)
                    .await
            {
                log::error!(
                    "[WORKFLOW_HOOK] run {} payload delete failed: {e}",
                    row.run_id
                );
            }
        }
        Ok(false) => log::warn!(
            "[WORKFLOW_HOOK] run {} was reaped before it finished; keeping the stored status",
            row.run_id
        ),
        Err(e) => log::error!(
            "[WORKFLOW_HOOK] run {} finish write failed: {e}",
            row.run_id
        ),
    }
}

/// `None` on timeout, returned only once the cancelled run has drained.
async fn run_with_timeout<F>(
    run: F,
    cancel: CancellationToken,
    timeout: Duration,
) -> Option<F::Output>
where
    F: std::future::Future,
{
    tokio::pin!(run);
    tokio::select! {
        output = &mut run => Some(output),
        () = tokio::time::sleep(timeout) => {
            cancel.cancel();
            let _drained = run.await;
            None
        }
    }
}

fn run_outcome(outcome: Option<Result<WorkflowExecutionStatus, anyhow::Error>>) -> RunEnd {
    match outcome {
        None => RunEnd::failed(ERR_RUN_TIMEOUT, ERR_RUN_TIMEOUT.to_string()),
        Some(Ok(WorkflowExecutionStatus::Success)) => RunEnd {
            status: HookRunStatus::Succeeded,
            code: None,
            detail: None,
        },
        Some(Ok(WorkflowExecutionStatus::Errored)) => RunEnd::failed(
            ERR_NODE_ERRORED,
            "some node errored during execution".to_string(),
        ),
        Some(Ok(WorkflowExecutionStatus::Disabled)) => RunEnd::failed(
            ERR_WORKFLOW_DISABLED,
            "the workflow was disabled before the run started".to_string(),
        ),
        Some(Err(e)) => RunEnd::failed(ERR_RUN_FAILED, e.to_string()),
    }
}

/// `None` skips the reap: an unknown, empty or self-less view would fail live runs.
fn live_nodes_for_reap(
    nodes: Option<HashSet<String>>,
    local_uuid: &str,
) -> Option<HashSet<String>> {
    nodes.filter(|nodes| nodes.contains(local_uuid))
}

async fn write_heartbeat(node_uuid: &str) -> Result<(), anyhow::Error> {
    let heartbeat = Heartbeat {
        node_uuid: node_uuid.to_string(),
        ts: now_micros(),
    };
    MetaStore
        .put(HEARTBEAT_KEY, serde_json::to_vec(&heartbeat)?.into())
        .await
}

/// Frees an exited worker's keys, so another scheduler takes over without a lock timeout.
async fn supervise<S: HookMetaStore>(
    store: &S,
    node_uuid: &str,
    worker: JoinHandle<Result<(), anyhow::Error>>,
) -> String {
    let exit = match worker.await {
        Ok(Ok(())) => "returned".to_string(),
        Ok(Err(e)) => format!("error: {e}"),
        Err(e) => format!("panic: {e}"),
    };
    clear_worker_keys(store, node_uuid).await;
    exit
}

/// True when this node holds the worker lock or still runs claimed rows.
async fn stop_claims() -> bool {
    // Set on the first poll, before any wait, so a drain timeout cannot leave claiming on.
    STOPPING.store(true, Ordering::Release);
    let _settled = CLAIMING.lock().await;
    HOLDING.load(Ordering::Acquire) || !IN_FLIGHT.lock().is_empty()
}

/// `None` once claims are stopped; otherwise the claim lock, held for one pass or lock renewal.
async fn claim_guard() -> Option<tokio::sync::MutexGuard<'static, ()>> {
    if STOPPING.load(Ordering::Acquire) {
        return None;
    }
    let guard = CLAIMING.lock().await;
    (!STOPPING.load(Ordering::Acquire)).then_some(guard)
}

/// Cancels runs before failing their rows, so no task outlives its ledger row; all within `cap`.
async fn drain_in<'a, C: ConnectionTrait + 'a, S: HookMetaStore>(
    db: impl Future<Output = &'a C>,
    store: &S,
    node_uuid: &str,
    running_here: impl Future<Output = bool>,
    in_flight: &InFlightRuns,
    cap: Duration,
) {
    let started = Instant::now();
    let drain = async {
        // `db` stays unawaited here, so a node without the worker opens no connection on shutdown.
        if !running_here.await {
            return;
        }
        wait_idle(in_flight, started + cap.mul_f64(DRAIN_CANCEL_AT)).await;
        for cancel in in_flight.lock().values() {
            cancel.cancel();
        }
        wait_idle(in_flight, started + cap.mul_f64(DRAIN_CLEANUP_AT)).await;
        match ledger::fail_running_claimed_by(db.await, node_uuid, now_micros()).await {
            Ok(0) => {}
            Ok(lost) => {
                log::warn!("[WORKFLOW_HOOK] shutdown ended {lost} unfinished runs as worker_lost")
            }
            Err(e) => log::error!("[WORKFLOW_HOOK] shutdown could not end unfinished runs: {e}"),
        }
        clear_worker_keys(store, node_uuid).await;
    };
    if tokio::time::timeout(cap, drain).await.is_err() {
        log::error!(
            "[WORKFLOW_HOOK] shutdown drain passed its {cap:?} cap; the reaper ends the rest"
        );
    }
}

async fn wait_idle(in_flight: &InFlightRuns, until: Instant) {
    while !in_flight.lock().is_empty() && Instant::now() < until {
        tokio::time::sleep(DRAIN_POLL.min(until.saturating_duration_since(Instant::now()))).await;
    }
}

/// Only the local node's keys: a crashed non-holder must not unseat the live holder.
async fn clear_worker_keys<S: HookMetaStore>(store: &S, node_uuid: &str) {
    let heartbeat = store.get(HEARTBEAT_KEY).await.ok().flatten();
    let beats_here = heartbeat.is_some_and(|value| {
        serde_json::from_slice::<Heartbeat>(&value).is_ok_and(|beat| beat.node_uuid == node_uuid)
    });
    if beats_here && let Err(e) = store.delete(HEARTBEAT_KEY).await {
        log::error!("[WORKFLOW_HOOK] heartbeat delete failed: {e}");
    }
    let owner = store.get(WORKER_LOCK_KEY).await.ok().flatten();
    if owner.is_some_and(|owner| owner.as_ref() == node_uuid.as_bytes())
        && let Err(e) = store.delete(WORKER_LOCK_KEY).await
    {
        log::error!("[WORKFLOW_HOOK] worker lock release failed: {e}");
    }
}

async fn delete_payload_in<C: ConnectionTrait>(
    db: &C,
    row: &HookRequest,
) -> Result<(), anyhow::Error> {
    workflow_run_data::Entity::delete_many()
        .filter(workflow_run_data::Column::OrgId.eq(&row.org_id))
        .filter(workflow_run_data::Column::WorkflowId.eq(&row.workflow_id))
        .filter(workflow_run_data::Column::RunId.eq(&row.run_id))
        .exec(db)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Mutex, atomic::AtomicUsize},
    };

    use infra::table::{
        entity::workflow_http_triggers as triggers,
        workflow_http_trigger_requests::{ERR_WORKER_LOST, LedgerInsert, NewHookRequest},
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    const NOW: i64 = 1_760_000_000_000_000;
    const SEC: i64 = 1_000_000;
    const LOCAL: &str = "node-a";

    #[derive(Default)]
    struct FakeStore(Mutex<HashMap<String, Bytes>>);

    #[async_trait]
    impl HookMetaStore for FakeStore {
        async fn get(&self, key: &str) -> Result<Option<Bytes>, anyhow::Error> {
            Ok(self.0.lock().unwrap().get(key).cloned())
        }

        async fn put(&self, key: &str, value: Bytes) -> Result<(), anyhow::Error> {
            self.0.lock().unwrap().insert(key.to_string(), value);
            Ok(())
        }

        async fn delete(&self, key: &str) -> Result<(), anyhow::Error> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeClaims {
        enabled: HashMap<String, bool>,
        blocked: HashSet<String>,
        refused_endpoints: HashMap<String, ClaimDecision>,
        started: Mutex<Vec<HookRequest>>,
    }

    #[async_trait]
    impl ClaimHooks for FakeClaims {
        async fn workflow_enabled(
            &self,
            _org_id: &str,
            workflow_id: &str,
        ) -> Result<Option<bool>, anyhow::Error> {
            Ok(self.enabled.get(workflow_id).copied())
        }

        fn org_blocked(&self, org_id: &str) -> bool {
            self.blocked.contains(org_id)
        }

        async fn endpoint_decision(
            &self,
            row: &HookRequest,
        ) -> Result<ClaimDecision, anyhow::Error> {
            Ok(self
                .refused_endpoints
                .get(&row.trigger_id)
                .copied()
                .unwrap_or(ClaimDecision::Run))
        }

        fn start_run(&self, row: HookRequest) {
            self.started.lock().unwrap().push(row);
        }
    }

    #[derive(Default)]
    struct FakeWorker {
        locks: AtomicUsize,
        queued: AtomicBool,
        passes: AtomicUsize,
        claimed: AtomicUsize,
    }

    #[async_trait]
    impl WorkerEnv for FakeWorker {
        async fn hold_lock(&self) -> bool {
            self.locks.fetch_add(1, Ordering::SeqCst);
            true
        }

        async fn claim_pass(&self, _cursor: &mut usize) -> Result<usize, anyhow::Error> {
            self.passes.fetch_add(1, Ordering::SeqCst);
            if self.queued.swap(false, Ordering::SeqCst) {
                self.claimed.fetch_add(1, Ordering::SeqCst);
                return Ok(1);
            }
            Ok(0)
        }

        async fn maintain(&self, _anti_entropy: bool) -> bool {
            true
        }
    }

    /// A backlog behind a per-org cap whose runs end at once, started through `spawn_run`.
    struct BacklogWorker {
        queued: AtomicUsize,
        per_org: usize,
        running: Arc<AtomicUsize>,
        done: Arc<AtomicUsize>,
        all_done: Arc<Notify>,
        total: usize,
        wake: Arc<Notify>,
    }

    impl BacklogWorker {
        fn new(total: usize, per_org: usize, wake: Arc<Notify>) -> Self {
            Self {
                queued: AtomicUsize::new(total),
                per_org,
                running: Arc::default(),
                done: Arc::default(),
                all_done: Arc::default(),
                total,
                wake,
            }
        }
    }

    #[async_trait]
    impl WorkerEnv for BacklogWorker {
        async fn hold_lock(&self) -> bool {
            true
        }

        async fn claim_pass(&self, _cursor: &mut usize) -> Result<usize, anyhow::Error> {
            let free = self.per_org - self.running.load(Ordering::SeqCst);
            let claimed = free.min(self.queued.load(Ordering::SeqCst));
            for _ in 0..claimed {
                let left = self.queued.fetch_sub(1, Ordering::SeqCst) - 1;
                self.running.fetch_add(1, Ordering::SeqCst);
                let (running, done, all_done) = (
                    self.running.clone(),
                    self.done.clone(),
                    self.all_done.clone(),
                );
                let total = self.total;
                let id = i64::MAX - 1_000 - i64::try_from(left).unwrap();
                spawn_run(id, self.wake.clone(), move |_| async move {
                    running.fetch_sub(1, Ordering::SeqCst);
                    if done.fetch_add(1, Ordering::SeqCst) + 1 == total {
                        all_done.notify_one();
                    }
                });
            }
            Ok(claimed)
        }

        async fn maintain(&self, _anti_entropy: bool) -> bool {
            true
        }
    }

    fn limits(global: u64, per_org: u64) -> WorkerLimits {
        WorkerLimits {
            global,
            per_org,
            run_timeout: Duration::from_secs(900),
            queue_ttl: Duration::from_secs(3600),
        }
    }

    fn pass(limits: WorkerLimits, live_nodes: Option<&[&str]>) -> ClaimPass {
        ClaimPass {
            node_uuid: LOCAL.to_string(),
            limits,
            now_us: NOW,
            live_nodes: live_nodes.map(|nodes| nodes.iter().map(|n| n.to_string()).collect()),
            in_flight: HashSet::new(),
        }
    }

    fn counts(by_org: &[(&str, u64)]) -> RunningCounts {
        RunningCounts {
            total: by_org.iter().map(|(_, n)| n).sum(),
            by_org: by_org.iter().map(|(o, n)| (o.to_string(), *n)).collect(),
        }
    }

    fn orgs(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        ledger::create_tables_for_tests(&db).await.unwrap();
        db
    }

    async fn enqueue(db: &DatabaseConnection, org: &str, run_id: &str, received_at: i64) -> i64 {
        let request = NewHookRequest {
            trigger_id: format!("t-{org}"),
            org_id: org.to_string(),
            workflow_id: format!("wf-{org}"),
            run_id: run_id.to_string(),
            idem_key: None,
            body_sha256: "cd".repeat(32),
            body_bytes: 2,
            content_type: Some("application/json".to_string()),
            meta: "{}".to_string(),
            credential_id: "c1".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.7".to_string(),
            received_at,
        };
        let payload = format!(r#"{{"meta":{{"run_id":"{run_id}"}},"data":[1]}}"#);
        let inserted = ledger::enqueue(db, request, payload).await.unwrap();
        assert!(matches!(inserted, LedgerInsert::Inserted));
        row(db, org, run_id).await.id
    }

    async fn row(db: &DatabaseConnection, org: &str, run_id: &str) -> HookRequest {
        ledger::get_run(db, &format!("t-{org}"), run_id)
            .await
            .unwrap()
            .unwrap()
    }

    fn enabled(orgs: &[&str]) -> FakeClaims {
        FakeClaims {
            enabled: orgs.iter().map(|o| (format!("wf-{o}"), true)).collect(),
            ..Default::default()
        }
    }

    async fn seed_endpoint(db: &DatabaseConnection, enabled: bool, deleted_at: Option<i64>) {
        http_triggers::insert_trigger(
            db,
            triggers::Model {
                id: "t-a".to_string(),
                org_id: "a".to_string(),
                workflow_id: "wf-a".to_string(),
                enabled,
                auth_mode: "token".to_string(),
                max_body_bytes: 1_048_576,
                rate_limit_per_minute: 60,
                created_by: "a@x.io".to_string(),
                created_at: NOW - 100 * SEC,
                updated_at: NOW - 100 * SEC,
                version: 1,
                origin_cluster: "r1".to_string(),
                deleted_at,
                last_invoked_at: None,
                rejections: None,
            },
        )
        .await
        .unwrap();
    }

    async fn seed_credential(
        db: &DatabaseConnection,
        id: &str,
        state: CredentialState,
        expires_at: Option<i64>,
        revoked_at: Option<i64>,
    ) {
        http_triggers::insert_credential(
            db,
            credentials::Model {
                id: id.to_string(),
                trigger_id: "t-a".to_string(),
                org_id: "a".to_string(),
                kind: "token".to_string(),
                display_prefix: "o2wh_abcd…wxyz".to_string(),
                token_sha256: Some("ab".repeat(32)),
                secret_ref: None,
                state: state.as_str().to_string(),
                expires_at,
                revoked_at,
                created_by: "a@x.io".to_string(),
                created_at: NOW - 100 * SEC,
                updated_at: NOW - 100 * SEC,
                last_used_at: None,
            },
        )
        .await
        .unwrap();
    }

    /// Moves paused time, then lets the spawned loop see its fired timers.
    async fn advance(by: Duration) {
        tokio::time::advance(by).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    async fn crash() -> Result<(), anyhow::Error> {
        panic!("worker crashed")
    }

    fn heartbeat_bytes(node: &str) -> Bytes {
        serde_json::to_vec(&Heartbeat {
            node_uuid: node.to_string(),
            ts: NOW,
        })
        .unwrap()
        .into()
    }

    #[test]
    fn a_row_older_than_the_ttl_is_expired_at_claim_time() {
        let ttl = Duration::from_secs(3600);
        let received = NOW - 3600 * SEC - 1;
        assert_eq!(
            decide_at_claim(received, NOW, ttl, Some(true)),
            ClaimDecision::Expire
        );
        assert_eq!(
            decide_at_claim(NOW - 3600 * SEC, NOW, ttl, Some(true)),
            ClaimDecision::Run
        );
        assert_eq!(
            decide_at_claim(received, NOW, ttl, Some(false)),
            ClaimDecision::Expire,
            "an expired row is expired whatever its workflow"
        );
    }

    #[test]
    fn a_disabled_or_missing_workflow_is_refused_at_claim_time() {
        let ttl = Duration::from_secs(3600);
        assert_eq!(
            decide_at_claim(NOW, NOW, ttl, Some(false)),
            ClaimDecision::WorkflowDisabled
        );
        assert_eq!(
            decide_at_claim(NOW, NOW, ttl, None),
            ClaimDecision::WorkflowDisabled
        );
    }

    #[test]
    fn only_a_revoke_stored_at_the_expiry_counts_as_natural() {
        use CredentialState::{Active, Retiring, Revoked};
        assert!(revoked_explicitly(Revoked, None, Some(NOW)));
        assert!(revoked_explicitly(Revoked, Some(NOW), Some(NOW - 1)));
        assert!(revoked_explicitly(Revoked, Some(NOW), None));
        assert!(
            !revoked_explicitly(Revoked, Some(NOW), Some(NOW)),
            "the sweeper stores natural expiry at exactly expires_at"
        );
        assert!(
            revoked_explicitly(Revoked, Some(NOW), Some(NOW + 1)),
            "a revoke after expiry but before the sweep is explicit"
        );
        assert!(!revoked_explicitly(Retiring, Some(NOW - SEC), None));
        assert!(!revoked_explicitly(Active, None, None));
    }

    #[tokio::test]
    async fn a_missing_off_or_deleted_endpoint_refuses_its_queued_runs() {
        let missing = db().await;
        assert_eq!(
            endpoint_decision_in(&missing, "t-a", "c1").await.unwrap(),
            ClaimDecision::EndpointDisabled
        );
        for (enabled, deleted_at) in [(false, None), (true, Some(NOW - SEC))] {
            let db = db().await;
            seed_endpoint(&db, enabled, deleted_at).await;
            seed_credential(&db, "c1", CredentialState::Active, None, None).await;
            assert_eq!(
                endpoint_decision_in(&db, "t-a", "c1").await.unwrap(),
                ClaimDecision::EndpointDisabled,
                "enabled {enabled}, deleted_at {deleted_at:?}"
            );
        }
    }

    #[tokio::test]
    async fn only_an_explicitly_revoked_or_missing_credential_refuses_its_queued_runs() {
        use CredentialState::{Active, Retiring, Revoked};
        let db = db().await;
        seed_endpoint(&db, true, None).await;
        let credentials = [
            ("active", Active, None, None, ClaimDecision::Run),
            (
                "retiring",
                Retiring,
                Some(NOW + SEC),
                None,
                ClaimDecision::Run,
            ),
            (
                "retiring-past-expiry",
                Retiring,
                Some(NOW - SEC),
                None,
                ClaimDecision::Run,
            ),
            (
                "expired",
                Revoked,
                Some(NOW - 2 * SEC),
                Some(NOW - 2 * SEC),
                ClaimDecision::Run,
            ),
            (
                "revoked-after-expiry-before-the-sweep",
                Revoked,
                Some(NOW - 2 * SEC),
                Some(NOW - 2 * SEC + 1),
                ClaimDecision::CredentialRevoked,
            ),
            (
                "revoked",
                Revoked,
                None,
                Some(NOW - SEC),
                ClaimDecision::CredentialRevoked,
            ),
            (
                "revoked-while-retiring",
                Revoked,
                Some(NOW + SEC),
                Some(NOW - SEC),
                ClaimDecision::CredentialRevoked,
            ),
        ];
        for (id, state, expires_at, revoked_at, _) in credentials {
            seed_credential(&db, id, state, expires_at, revoked_at).await;
        }
        for (id, _, _, _, expected) in credentials {
            assert_eq!(
                endpoint_decision_in(&db, "t-a", id).await.unwrap(),
                expected,
                "{id}"
            );
        }
        assert_eq!(
            endpoint_decision_in(&db, "t-a", "gone").await.unwrap(),
            ClaimDecision::CredentialRevoked
        );
    }

    #[test]
    fn round_robin_serves_two_orgs_alternately() {
        let orgs = orgs(&["a", "b"]);
        let one_slot = limits(1, 2);
        let mut cursor = 0;
        let mut served = Vec::new();
        for _ in 0..4 {
            served.extend(pick_round_robin(
                &orgs,
                &counts(&[]),
                &one_slot,
                &mut cursor,
            ));
        }
        assert_eq!(served, ["a", "b", "a", "b"]);

        let mut cursor = 0;
        assert_eq!(
            pick_round_robin(&orgs, &counts(&[]), &limits(8, 2), &mut cursor),
            ["a", "b", "a", "b"]
        );
    }

    #[test]
    fn round_robin_respects_the_per_org_and_global_caps() {
        let orgs = orgs(&["a", "b", "c"]);
        let mut cursor = 0;
        assert_eq!(
            pick_round_robin(&orgs, &counts(&[("a", 2)]), &limits(8, 2), &mut cursor),
            ["b", "c", "b", "c"]
        );
        let mut cursor = 0;
        assert_eq!(
            pick_round_robin(&orgs, &counts(&[("x", 7)]), &limits(8, 2), &mut cursor),
            ["a"]
        );
        let mut cursor = 0;
        assert!(
            pick_round_robin(&orgs, &counts(&[("x", 8)]), &limits(8, 2), &mut cursor).is_empty()
        );
        assert!(pick_round_robin(&[], &counts(&[]), &limits(8, 2), &mut cursor).is_empty());
    }

    #[test]
    fn a_heartbeat_older_than_fifteen_seconds_is_stale() {
        let at = |ts| Heartbeat {
            node_uuid: LOCAL.to_string(),
            ts,
        };
        assert!(heartbeat_is_fresh_at(Some(&at(NOW - 15 * SEC)), NOW));
        assert!(!heartbeat_is_fresh_at(Some(&at(NOW - 15 * SEC - 1)), NOW));
        assert!(!heartbeat_is_fresh_at(None, NOW));
    }

    #[test]
    fn reap_is_skipped_when_nodes_are_unknown() {
        assert_eq!(live_nodes_for_reap(None, LOCAL), None);
        assert_eq!(live_nodes_for_reap(Some(HashSet::new()), LOCAL), None);
        let without_local = HashSet::from(["node-b".to_string()]);
        assert_eq!(live_nodes_for_reap(Some(without_local), LOCAL), None);
        let live = HashSet::from([LOCAL.to_string(), "node-b".to_string()]);
        assert_eq!(live_nodes_for_reap(Some(live.clone()), LOCAL), Some(live));
    }

    #[tokio::test]
    async fn a_pass_without_a_node_view_leaves_running_rows_alone() {
        let db = db().await;
        for (run_id, claimed_at) in [("fresh", NOW), ("overdue", NOW - 2000 * SEC)] {
            let id = enqueue(&db, "a", run_id, claimed_at).await;
            assert!(
                ledger::claim(&db, id, "gone-node", claimed_at)
                    .await
                    .unwrap()
            );
        }
        let hooks = enabled(&["a"]);
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), None), &mut 0)
            .await
            .unwrap();
        assert_eq!(row(&db, "a", "overdue").await.status, "running");
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        let reaped = row(&db, "a", "overdue").await;
        assert_eq!(
            (reaped.status.as_str(), reaped.error.as_deref()),
            ("failed", Some("worker_lost"))
        );
        assert_eq!(
            row(&db, "a", "fresh").await.status,
            "running",
            "a claimer missing from the node view may be slow, not gone"
        );
    }

    #[tokio::test]
    async fn an_overdue_run_still_draining_keeps_its_slot() {
        let db = db().await;
        let claimed_at = NOW - 2000 * SEC;
        let mut ids = HashMap::new();
        for (run_id, claimer) in [
            ("draining", LOCAL),
            ("abandoned", LOCAL),
            ("peer", "node-b"),
        ] {
            let id = enqueue(&db, "a", run_id, claimed_at).await;
            assert!(ledger::claim(&db, id, claimer, claimed_at).await.unwrap());
            ids.insert(run_id, id);
        }
        let mut pass = pass(limits(8, 8), Some(&[LOCAL, "node-b"]));
        pass.in_flight = HashSet::from([ids["draining"]]);
        claim_pass_in(&db, &enabled(&["a"]), &pass, &mut 0)
            .await
            .unwrap();
        assert_eq!(row(&db, "a", "draining").await.status, "running");
        assert_eq!(
            row(&db, "a", "peer").await.status,
            "running",
            "a live peer may still be draining its run"
        );
        assert_eq!(row(&db, "a", "abandoned").await.status, "failed");
    }

    #[tokio::test]
    async fn a_run_task_leaves_in_flight_when_it_ends_or_panics() {
        let id = i64::MAX - 7;
        let wake = Arc::new(Notify::new());
        let guard = InFlight::enter(id, wake.clone());
        assert!(IN_FLIGHT.lock().contains_key(&id));
        let task = tokio::task::spawn(async move {
            let _guard = guard;
            panic!("run panicked");
        });
        assert!(task.await.is_err());
        assert!(!IN_FLIGHT.lock().contains_key(&id));
        let woken = tokio::time::timeout(Duration::from_millis(50), wake.notified()).await;
        assert!(woken.is_ok(), "a panicked run still wakes the worker");
    }

    #[tokio::test]
    async fn a_new_holder_does_not_exceed_the_caps_after_failover() {
        let db = db().await;
        for (i, org) in ["a", "a", "b", "b", "c", "c", "d", "d"].iter().enumerate() {
            let id = enqueue(&db, org, &format!("running-{i}"), NOW - SEC).await;
            assert!(ledger::claim(&db, id, "node-b", NOW - SEC).await.unwrap());
        }
        enqueue(&db, "e", "queued-e", NOW).await;
        enqueue(&db, "a", "queued-a", NOW).await;
        let hooks = enabled(&["a", "b", "c", "d", "e"]);
        let claimed = claim_pass_in(
            &db,
            &hooks,
            &pass(limits(8, 2), Some(&[LOCAL, "node-b"])),
            &mut 0,
        )
        .await
        .unwrap();
        assert_eq!(claimed, 0);
        assert!(hooks.started.lock().unwrap().is_empty());
        assert_eq!(row(&db, "e", "queued-e").await.status, "queued");
        assert_eq!(
            ledger::running_counts(&db).await.unwrap().total,
            8,
            "the old holder's runs keep their slots"
        );
    }

    #[tokio::test]
    async fn a_claim_pass_starts_the_oldest_row_of_each_org_in_turn() {
        let db = db().await;
        enqueue(&db, "a", "a-old", NOW - 2 * SEC).await;
        enqueue(&db, "a", "a-new", NOW - SEC).await;
        enqueue(&db, "b", "b-old", NOW - SEC).await;
        let hooks = enabled(&["a", "b"]);
        let claimed = claim_pass_in(&db, &hooks, &pass(limits(2, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        assert_eq!(claimed, 2);
        let started: Vec<String> = hooks
            .started
            .lock()
            .unwrap()
            .iter()
            .map(|r| r.run_id.clone())
            .collect();
        assert_eq!(started, ["a-old", "b-old"]);
        let running = row(&db, "a", "a-old").await;
        assert_eq!(running.status, "running");
        assert_eq!(running.claimed_by.as_deref(), Some(LOCAL));
        assert_eq!(running.claimed_at, Some(NOW));
        assert_eq!(row(&db, "a", "a-new").await.status, "queued");
    }

    #[tokio::test]
    async fn a_row_older_than_the_ttl_is_expired_and_never_run() {
        let db = db().await;
        enqueue(&db, "a", "stale", NOW - 3601 * SEC).await;
        let hooks = enabled(&["a"]);
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        let expired = row(&db, "a", "stale").await;
        assert_eq!(expired.status, "expired");
        assert_eq!(expired.finished_at, Some(NOW));
        assert!(hooks.started.lock().unwrap().is_empty());
        assert_eq!(
            ledger::read_payload(&db, "a", "wf-a", "stale")
                .await
                .unwrap(),
            None,
            "a row that never runs keeps no payload"
        );
    }

    #[tokio::test]
    async fn a_row_for_a_disabled_workflow_fails_with_workflow_disabled() {
        let db = db().await;
        enqueue(&db, "a", "disabled", NOW).await;
        enqueue(&db, "b", "gone", NOW).await;
        let hooks = FakeClaims {
            enabled: HashMap::from([("wf-a".to_string(), false)]),
            ..Default::default()
        };
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        for (org, run_id) in [("a", "disabled"), ("b", "gone")] {
            let refused = row(&db, org, run_id).await;
            assert_eq!(
                (refused.status.as_str(), refused.error.as_deref()),
                ("failed", Some(ERR_WORKFLOW_DISABLED)),
                "{run_id}"
            );
        }
        assert!(hooks.started.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_row_for_a_turned_off_endpoint_or_revoked_credential_never_runs() {
        let db = db().await;
        enqueue(&db, "a", "endpoint-off", NOW).await;
        enqueue(&db, "b", "revoked", NOW).await;
        enqueue(&db, "c", "workflow-off", NOW).await;
        enqueue(&db, "d", "stale", NOW - 3601 * SEC).await;
        enqueue(&db, "e", "live", NOW).await;
        let hooks = FakeClaims {
            enabled: HashMap::from([
                ("wf-a".to_string(), true),
                ("wf-b".to_string(), true),
                ("wf-c".to_string(), false),
                ("wf-d".to_string(), true),
                ("wf-e".to_string(), true),
            ]),
            refused_endpoints: HashMap::from([
                ("t-a".to_string(), ClaimDecision::EndpointDisabled),
                ("t-b".to_string(), ClaimDecision::CredentialRevoked),
                ("t-c".to_string(), ClaimDecision::EndpointDisabled),
                ("t-d".to_string(), ClaimDecision::CredentialRevoked),
            ]),
            ..Default::default()
        };
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        for (org, run_id, status, code) in [
            ("a", "endpoint-off", "failed", Some(ERR_ENDPOINT_DISABLED)),
            ("b", "revoked", "failed", Some(ERR_CREDENTIAL_REVOKED)),
            ("c", "workflow-off", "failed", Some(ERR_WORKFLOW_DISABLED)),
            ("d", "stale", "expired", None),
        ] {
            let refused = row(&db, org, run_id).await;
            assert_eq!(
                (refused.status.as_str(), refused.error.as_deref()),
                (status, code),
                "{run_id}"
            );
            assert_eq!(load_run_input(&db, &refused).await.unwrap(), None);
        }
        let started: Vec<String> = hooks
            .started
            .lock()
            .unwrap()
            .iter()
            .map(|row| row.run_id.clone())
            .collect();
        assert_eq!(started, ["live"]);
    }

    #[tokio::test]
    async fn a_deleting_orgs_queued_rows_expire_without_running() {
        let db = db().await;
        enqueue(&db, "a", "deleting", NOW).await;
        enqueue(&db, "b", "live", NOW).await;
        let hooks = FakeClaims {
            blocked: HashSet::from(["a".to_string()]),
            ..enabled(&["a", "b"])
        };
        claim_pass_in(&db, &hooks, &pass(limits(8, 2), Some(&[LOCAL])), &mut 0)
            .await
            .unwrap();
        let refused = row(&db, "a", "deleting").await;
        assert_eq!(
            (refused.status.as_str(), refused.error.as_deref()),
            ("expired", None)
        );
        assert_eq!(
            load_run_input(&db, &refused).await.unwrap(),
            None,
            "the refused run's payload goes with it"
        );
        let started: Vec<String> = hooks
            .started
            .lock()
            .unwrap()
            .iter()
            .map(|row| row.org_id.clone())
            .collect();
        assert_eq!(started, ["b"]);
    }

    #[tokio::test]
    async fn the_payload_loader_reads_the_rw_handle_not_the_replica() {
        let rw = db().await;
        let replica = db().await;
        enqueue(&rw, "a", "r1", NOW).await;
        let claimed = row(&rw, "a", "r1").await;
        let input = load_run_input(&rw, &claimed).await.unwrap().unwrap();
        assert_eq!(input["meta"]["run_id"], "r1");
        assert_eq!(input["data"][0], 1);
        assert_eq!(load_run_input(&replica, &claimed).await.unwrap(), None);
    }

    #[tokio::test]
    async fn an_unreadable_payload_is_an_error() {
        let rw = db().await;
        enqueue(&rw, "a", "r1", NOW).await;
        workflow_run_data::Entity::update_many()
            .col_expr(
                workflow_run_data::Column::Data,
                sea_orm::sea_query::Expr::value("not json"),
            )
            .exec(&rw)
            .await
            .unwrap();
        let claimed = row(&rw, "a", "r1").await;
        assert!(load_run_input(&rw, &claimed).await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn a_timed_out_run_is_recorded_only_after_the_run_future_completes() {
        let cancel = CancellationToken::new();
        let drained = Arc::new(AtomicBool::new(false));
        let (token, done) = (cancel.clone(), drained.clone());
        let run = async move {
            token.cancelled().await;
            tokio::time::sleep(Duration::from_secs(3)).await;
            done.store(true, Ordering::SeqCst);
            "drained"
        };
        let started = Instant::now();
        let outcome = run_with_timeout(run, cancel.clone(), Duration::from_secs(10)).await;
        assert_eq!(outcome, None);
        assert!(cancel.is_cancelled());
        assert!(
            drained.load(Ordering::SeqCst),
            "the timeout returned before the cancelled run drained"
        );
        assert_eq!(started.elapsed(), Duration::from_secs(13));
        assert_eq!(run_outcome(None).code, Some(ERR_RUN_TIMEOUT));
    }

    #[tokio::test(start_paused = true)]
    async fn a_run_inside_the_timeout_returns_its_output() {
        let cancel = CancellationToken::new();
        let run = async {
            tokio::time::sleep(Duration::from_secs(1)).await;
            7
        };
        assert_eq!(
            run_with_timeout(run, cancel.clone(), Duration::from_secs(10)).await,
            Some(7)
        );
        assert!(!cancel.is_cancelled());
    }

    #[test]
    fn run_results_map_to_ledger_statuses() {
        let clean = run_outcome(Some(Ok(WorkflowExecutionStatus::Success)));
        assert_eq!((clean.status, clean.code), (HookRunStatus::Succeeded, None));
        let disabled = run_outcome(Some(Ok(WorkflowExecutionStatus::Disabled)));
        assert_eq!(
            (disabled.status, disabled.code),
            (HookRunStatus::Failed, Some(ERR_WORKFLOW_DISABLED))
        );
        let errored = run_outcome(Some(Ok(WorkflowExecutionStatus::Errored)));
        assert_eq!(
            (errored.status, errored.code),
            (HookRunStatus::Failed, Some(ERR_NODE_ERRORED))
        );
        let failed = run_outcome(Some(Err(anyhow::anyhow!("db password rejected"))));
        assert_eq!(failed.code, Some(ERR_RUN_FAILED));
        assert_eq!(
            failed.detail.as_deref(),
            Some("db password rejected"),
            "the text reaches history, never the polled ledger row"
        );
    }

    #[tokio::test]
    async fn the_supervisor_clears_heartbeat_and_lock_owner_when_the_worker_exits() {
        let store = FakeStore::default();
        store
            .put(HEARTBEAT_KEY, heartbeat_bytes(LOCAL))
            .await
            .unwrap();
        store
            .put(WORKER_LOCK_KEY, Bytes::from(LOCAL))
            .await
            .unwrap();
        let worker = tokio::spawn(crash());
        let exit = supervise(&store, LOCAL, worker).await;
        assert!(exit.starts_with("panic"), "{exit}");
        assert_eq!(store.get(HEARTBEAT_KEY).await.unwrap(), None);
        assert_eq!(store.get(WORKER_LOCK_KEY).await.unwrap(), None);

        store
            .put(HEARTBEAT_KEY, heartbeat_bytes(LOCAL))
            .await
            .unwrap();
        store
            .put(WORKER_LOCK_KEY, Bytes::from(LOCAL))
            .await
            .unwrap();
        let worker = tokio::spawn(async { Err(anyhow::anyhow!("db gone")) });
        supervise(&store, LOCAL, worker).await;
        assert_eq!(store.get(HEARTBEAT_KEY).await.unwrap(), None);
        assert_eq!(store.get(WORKER_LOCK_KEY).await.unwrap(), None);
    }

    /// A claimed local row with a run task that, once cancelled, records its row's status then.
    async fn running_task(
        db: &Arc<DatabaseConnection>,
        in_flight: &Arc<InFlightRuns>,
        run_id: &str,
        ends_on_cancel: bool,
    ) -> (CancellationToken, tokio::sync::oneshot::Receiver<String>) {
        let id = enqueue(db, "a", run_id, NOW).await;
        assert!(ledger::claim(db.as_ref(), id, LOCAL, NOW).await.unwrap());
        let cancel = CancellationToken::new();
        in_flight.lock().insert(id, cancel.clone());
        let (seen, seen_rx) = tokio::sync::oneshot::channel();
        let (db, in_flight, token) = (db.clone(), in_flight.clone(), cancel.clone());
        let run_id = run_id.to_string();
        tokio::task::spawn(async move {
            token.cancelled().await;
            let _ = seen.send(row(&db, "a", &run_id).await.status);
            if ends_on_cancel {
                let succeeded = HookRunStatus::Succeeded;
                ledger::finish(db.as_ref(), id, LOCAL, succeeded, None, NOW + 1)
                    .await
                    .unwrap();
                in_flight.lock().remove(&id);
            }
        });
        (cancel, seen_rx)
    }

    #[tokio::test]
    async fn a_shutdown_drain_cancels_runs_before_failing_what_is_left_and_frees_the_keys() {
        let shared = Arc::new(db().await);
        let in_flight = Arc::new(InFlightRuns::default());
        let (wrapped_up, wrapped_up_seen) =
            running_task(&shared, &in_flight, "wraps-up", true).await;
        let (stubborn, stubborn_seen) = running_task(&shared, &in_flight, "stubborn", false).await;
        let db: &DatabaseConnection = &shared;
        let peer = enqueue(db, "a", "peer", NOW).await;
        assert!(ledger::claim(db, peer, "node-b", NOW).await.unwrap());
        let store = FakeStore::default();
        store
            .put(HEARTBEAT_KEY, heartbeat_bytes(LOCAL))
            .await
            .unwrap();
        store
            .put(WORKER_LOCK_KEY, Bytes::from(LOCAL))
            .await
            .unwrap();
        let cap = Duration::from_millis(600);
        let started = Instant::now();
        let running_here = std::future::ready(true);
        drain_in(
            std::future::ready(db),
            &store,
            LOCAL,
            running_here,
            &in_flight,
            cap,
        )
        .await;
        assert!(started.elapsed() >= cap.mul_f64(DRAIN_CLEANUP_AT));
        assert!(wrapped_up.is_cancelled() && stubborn.is_cancelled());
        assert_eq!(
            (wrapped_up_seen.await.unwrap(), stubborn_seen.await.unwrap()),
            ("running".to_string(), "running".to_string()),
            "every run is cancelled while its row still says running"
        );
        assert_eq!(row(db, "a", "wraps-up").await.status, "succeeded");
        let lost = row(db, "a", "stubborn").await;
        assert_eq!(
            (lost.status.as_str(), lost.error.as_deref()),
            ("failed", Some(ERR_WORKER_LOST))
        );
        assert_eq!(row(db, "a", "peer").await.status, "running");
        assert_eq!(store.get(HEARTBEAT_KEY).await.unwrap(), None);
        assert_eq!(store.get(WORKER_LOCK_KEY).await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_shutdown_drain_stops_waiting_once_runs_end_on_their_own() {
        let db = db().await;
        let id = enqueue(&db, "a", "abandoned", NOW).await;
        assert!(ledger::claim(&db, id, LOCAL, NOW).await.unwrap());
        let in_flight = Arc::new(InFlightRuns::default());
        let own = CancellationToken::new();
        in_flight.lock().insert(i64::MAX, own.clone());
        let ending = in_flight.clone();
        tokio::task::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            ending.lock().remove(&i64::MAX);
        });
        let started = Instant::now();
        drain_in(
            std::future::ready(&db),
            &FakeStore::default(),
            LOCAL,
            std::future::ready(true),
            &in_flight,
            Duration::from_secs(60),
        )
        .await;
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(
            !own.is_cancelled(),
            "a run that ends in time is not cancelled"
        );
        assert_eq!(row(&db, "a", "abandoned").await.status, "failed");
    }

    #[tokio::test]
    async fn a_shutdown_drain_never_outlasts_its_cap_when_the_meta_store_stalls() {
        let store = FakeStore::default();
        store
            .put(WORKER_LOCK_KEY, Bytes::from(LOCAL))
            .await
            .unwrap();
        let cap = Duration::from_millis(100);
        let started = Instant::now();
        let stalled_db = std::future::pending::<&DatabaseConnection>();
        let running_here = std::future::ready(true);
        let in_flight = InFlightRuns::default();
        drain_in(stalled_db, &store, LOCAL, running_here, &in_flight, cap).await;
        let stalled_stop = std::future::pending::<bool>();
        let never = std::future::pending::<&DatabaseConnection>();
        drain_in(never, &store, LOCAL, stalled_stop, &in_flight, cap).await;
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn a_drain_timed_out_on_a_stalled_claim_pass_still_stops_claiming() {
        let stalled_pass = CLAIMING.lock().await;
        let worker = Arc::new(LiveWorker {
            node_uuid: LOCAL.to_string(),
            limits: limits(8, 2),
            maintaining: Arc::default(),
            wake: Arc::new(Notify::new()),
        });
        let queued_worker = worker.clone();
        let queued = tokio::spawn(async move { queued_worker.claim_pass(&mut 0).await.unwrap() });
        tokio::task::yield_now().await;
        let never = std::future::pending::<&DatabaseConnection>();
        let cap = Duration::from_millis(100);
        let in_flight = InFlightRuns::default();
        drain_in(
            never,
            &FakeStore::default(),
            LOCAL,
            stop_claims(),
            &in_flight,
            cap,
        )
        .await;
        let at_once = Duration::from_secs(1);
        let claimed = tokio::time::timeout(at_once, worker.claim_pass(&mut 0)).await;
        assert_eq!(
            claimed
                .expect("claim_pass waited on the stalled pass")
                .unwrap(),
            0
        );
        let held = tokio::time::timeout(at_once, worker.hold_lock()).await;
        assert!(!held.expect("hold_lock waited on the stalled pass"));
        drop(stalled_pass);
        assert_eq!(
            tokio::time::timeout(at_once, queued)
                .await
                .unwrap()
                .unwrap(),
            0,
            "a pass queued behind the stalled one rechecks the stop"
        );
    }

    #[tokio::test]
    async fn a_shutdown_drain_is_a_no_op_on_a_node_not_running_the_worker() {
        let db = db().await;
        let id = enqueue(&db, "a", "r1", NOW).await;
        assert!(ledger::claim(&db, id, LOCAL, NOW).await.unwrap());
        let store = FakeStore::default();
        store
            .put(WORKER_LOCK_KEY, Bytes::from(LOCAL))
            .await
            .unwrap();
        let in_flight = InFlightRuns::default();
        let token = CancellationToken::new();
        in_flight.lock().insert(id, token.clone());
        let started = Instant::now();
        let never = std::future::pending::<&DatabaseConnection>();
        drain_in(
            never,
            &store,
            LOCAL,
            std::future::ready(false),
            &in_flight,
            Duration::from_secs(60),
        )
        .await;
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!token.is_cancelled());
        assert_eq!(row(&db, "a", "r1").await.status, "running");
        assert!(store.get(WORKER_LOCK_KEY).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn the_supervisor_keeps_the_keys_of_another_holder() {
        let store = FakeStore::default();
        store
            .put(HEARTBEAT_KEY, heartbeat_bytes("node-b"))
            .await
            .unwrap();
        store
            .put(WORKER_LOCK_KEY, Bytes::from("node-b"))
            .await
            .unwrap();
        let worker = tokio::spawn(crash());
        supervise(&store, LOCAL, worker).await;
        assert!(store.get(HEARTBEAT_KEY).await.unwrap().is_some());
        assert_eq!(
            store.get(WORKER_LOCK_KEY).await.unwrap(),
            Some(Bytes::from("node-b"))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_queued_row_without_a_wake_is_claimed_by_the_tick() {
        let env = Arc::new(FakeWorker::default());
        let notify = Arc::new(Notify::new());
        let running = env.clone();
        tokio::spawn(async move { worker_loop(running.as_ref(), notify).await });
        advance(Duration::from_millis(10)).await;
        assert!(env.passes.load(Ordering::SeqCst) >= 1, "a pass at start");
        env.queued.store(true, Ordering::SeqCst);
        advance(Duration::from_secs(1)).await;
        assert_eq!(env.claimed.load(Ordering::SeqCst), 0);
        advance(Duration::from_millis(1100)).await;
        assert_eq!(env.claimed.load(Ordering::SeqCst), 1, "the 2 s tick claims");
    }

    #[tokio::test(start_paused = true)]
    async fn the_holder_renews_the_lock_and_heartbeat_every_five_seconds() {
        let env = Arc::new(FakeWorker::default());
        let running = env.clone();
        tokio::spawn(async move { worker_loop(running.as_ref(), Arc::new(Notify::new())).await });
        advance(Duration::from_millis(10)).await;
        assert_eq!(env.locks.load(Ordering::SeqCst), 1);
        advance(Duration::from_secs(5)).await;
        assert_eq!(env.locks.load(Ordering::SeqCst), 2);
        advance(Duration::from_secs(5)).await;
        assert_eq!(env.locks.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_finished_run_wakes_the_next_claim_without_waiting_for_the_tick() {
        let notify = Arc::new(Notify::new());
        let env = Arc::new(BacklogWorker::new(40, 2, notify.clone()));
        let (running, all_done) = (env.clone(), env.all_done.clone());
        let start = Instant::now();
        tokio::spawn(async move { worker_loop(running.as_ref(), notify).await });
        let drained = tokio::time::timeout(Duration::from_secs(120), all_done.notified()).await;
        assert!(drained.is_ok(), "the backlog never drained");
        let elapsed = start.elapsed();
        assert_eq!(env.done.load(Ordering::SeqCst), 40);
        assert!(
            elapsed < TICK,
            "40 instant runs at 2 per org took {elapsed:?}, the tick rate is 20 x 2 s"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_wake_runs_a_pass_before_the_tick() {
        let env = Arc::new(FakeWorker::default());
        let notify = Arc::new(Notify::new());
        let (running, wake) = (env.clone(), notify.clone());
        tokio::spawn(async move { worker_loop(running.as_ref(), wake).await });
        advance(Duration::from_millis(10)).await;
        env.queued.store(true, Ordering::SeqCst);
        notify.notify_one();
        advance(Duration::from_millis(10)).await;
        assert_eq!(env.claimed.load(Ordering::SeqCst), 1);
    }
}
