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

//! Synthetic monitoring: check CRUD, scheduling, dispatch and result handling.
//!
//! Lives in OSS. The private-VPC-agent path — `job_api::lease`, agent register
//! and heartbeat, private locations and the agent install flow — stays in
//! `o2_enterprise` and calls in here.
//!
//! ## Why this is its own crate
//!
//! The super-cluster applier (`super_cluster_queue`) must be structurally
//! incapable of re-publishing a message it has just applied, or region A
//! applying region B's write echoes it back forever. Today that is guaranteed
//! by the crate graph rather than by convention: the applier writes through
//! `infra::table`, and `infra` cannot reference `o2_enterprise`.
//!
//! This crate publishes (behind `#[cfg(feature = "enterprise")]`), so
//! **`super_cluster_queue` must never depend on it.** Putting these modules in
//! `openobserve-core` would have broken that — `super_cluster_queue` depends on
//! core — and demoted a compile-time impossibility to a lint.

/// Tests that swap the global config race without this; tokio so async tests can hold it.
#[cfg(test)]
pub(crate) static CONFIG_SWAP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Whether THIS crate was compiled with the `cloud` feature — the fixture for
/// the compile-time guard against SPEC §11 **F6**.
///
/// `openobserve-synthetics` had no `cloud` feature at all, so every
/// `#[cfg(feature = "cloud")]` written inside it compiled to nothing, silently:
/// no error, no log, no metric, just a revenue number that never moves. So the
/// check is made at COMPILE time by the crates that know the answer — `src/jobs`
/// and `src/api/management` each carry
/// `#[cfg(feature = "cloud")] const _: () = assert!(BUILT_WITH_CLOUD);`.
///
/// **It must stay `cfg!`, never `#[cfg]`.** The macro form always evaluates, so
/// the constant exists in every build shape and is simply `false` without
/// `cloud`; the attribute form would delete it from exactly those builds, and
/// each downstream assertion would then fail on a missing item rather than on
/// the condition — or be "fixed" by another `#[cfg]`, which is silent absence
/// one level further out.
///
/// Known limit: those downstream assertions are themselves
/// `#[cfg(feature = "cloud")]`, so a root that stopped forwarding `cloud` to
/// either crate would not compile them at all — only a `--features cloud` build
/// of `openobserve-jobs` and `openobserve-api-management` covers that (T39).
pub const BUILT_WITH_CLOUD: bool = cfg!(feature = "cloud");

pub mod alerting;
pub mod callback_endpoint;
pub mod dispatcher;
pub mod job_api;
pub mod pool;
pub mod reaper;
pub mod scheduler;
pub mod service;
pub mod status_pages;

/// One row per execution — the record the UI's run list and run detail read.
pub const RESULTS_STREAM: &str = "synthetics_results";

/// One row per (execution, step) — the step-grain stream (B10).
///
/// Exists because the Steps tab cannot be answered from `RESULTS_STREAM`: its
/// per-step numbers live inside the `last_attempt_steps` JSON array, and o2
/// cannot `unnest` a JSON array. Lifting the values into columns is not an
/// option either — step count is unbounded, so there is no fixed vocabulary to
/// denormalise into. The tab therefore downloaded up to 5 000 rows and tallied
/// them in the browser, which both truncated the window (18 069 rows over 7 days
/// on the worst check — 28 % of the stated range) and shipped ~18 MB of blob.
///
/// One row per step makes the whole tab a `GROUP BY step_id` over the FULL
/// window. Correctness first: the numbers stop being a recency-biased sample.
///
/// `RESULTS_STREAM` keeps `last_attempt_steps` — run detail's per-step timeline
/// reads it, and removing it would force a second query there. Two sources for
/// one release was judged the cheaper mistake.
pub const STEP_RESULTS_STREAM: &str = "synthetics_step_results";

/// Max times the control plane will try to *dispatch* a job to a runner before
/// dead-lettering it — covers both an invoked-but-never-acked timeout (reaper)
/// and a rejected/failed invoke call (dispatcher). Shared so both paths draw
/// from the same budget instead of the dispatcher having an implicit budget of
/// 1 (see `synthetics_jobs.dispatch_attempts`). Unrelated to Playwright-level
/// journey retries (`Synthetic.retries`) — see docs/synthetics-lcl/
/// broswer-testing/2026-07-15-retry-attempts-naming-and-dispatch-fix.md.
pub const MAX_DISPATCH_ATTEMPTS: i32 = 3;

/// How often the job-cluster claim is re-read while this cluster does not hold
/// it. Matched to the keepalive cadence in
/// [`o2_enterprise::enterprise::super_cluster::kv::scheduler::register_job_cluster`]
/// (`min(10, node_heartbeat_ttl / 2)` seconds) — polling faster cannot see a
/// change that has not been written yet.
#[cfg(feature = "enterprise")]
const JOB_CLUSTER_POLL: std::time::Duration = std::time::Duration::from_secs(10);

/// Spawns the synthetics background tasks (scheduler + dispatcher + reaper +
/// orphan detection).
/// Must be called once on scheduler nodes at startup.
/// No-op when ZO_SYNTHETICS_ENABLED is false.
///
/// In a super cluster the workers additionally wait for this cluster to hold
/// the platform's job-cluster claim ([`should_start`]). Every region's Postgres
/// carries the same replicated `synthetics` rows, so a second scheduler-role
/// region would claim every due check from its own copy and execute the whole
/// fleet twice. Alerts and reports already defer through this key
/// (`jobs::job::scheduler::run`); this is synthetics joining them, not a
/// mechanism of its own.
///
/// **It reads the claim and never registers it.** Registering here would be a
/// regression, not a reinforcement: `init` is called at `jobs::job::mod.rs`
/// *before* `jobs::job::scheduler::run` is spawned, so writing the local name
/// would mean the alert scheduler's own check then reads a claim this process
/// planted moments earlier, always finds its own name, and always proceeds —
/// disabling the arbitration that already works for alerts, reports and search
/// jobs. Synthetics follows the election; it does not hold one.
///
/// The consequence of reading only is that the claim may be unset at the moment
/// `init` runs, which is why the wait is a poll rather than a single read. That
/// poll also earns its keep on the other side: when the claim moves (spec §6, a
/// scheduler relocated between regions) the new region starts synthetics
/// without a restart.
/// `step_pool` is SPEC §6's free step pool, item **2.3** — the scheduler's
/// gate 3.
///
/// A REQUIRED argument rather than a `OnceCell` the caller may forget to set:
/// §11 **F6** is a wiring mistake that produces no error and no log, just an
/// unmetered fleet, so the wiring is made impossible to omit. `None` is a valid
/// answer (an OSS build has no pool) and means the scheduler does not gate — see
/// [`pool`] for the fail-open reasoning.
pub async fn init(step_pool: Option<pool::StepPoolHooks>) {
    if !config::get_config().synthetics.enabled {
        tracing::info!("[synthetics] disabled via ZO_SYNTHETICS_ENABLED — workers not started");
        return;
    }

    // Before any worker is spawned: `scheduler::run` must not see a
    // half-installed pool on its first tick.
    if let Some(step_pool) = step_pool {
        pool::install(step_pool);
    }

    // Single cluster, or an OSS build where there is no such thing: start
    // exactly as before. Nothing below this line is reached, so no
    // super-cluster KV client is built and no NATS read is issued on this path
    // (spec §14 — super cluster off must be byte-identical).
    #[cfg(not(feature = "enterprise"))]
    drop(spawn_workers(StopToken::never()));

    #[cfg(feature = "enterprise")]
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        drop(spawn_workers(StopToken::never()));
        return;
    }

    #[cfg(feature = "enterprise")]
    tokio::spawn(ownership_supervisor());
}

/// Cooperative stop signal handed to every claim-gated worker.
///
/// A minimal `CancellationToken` on `tokio::sync::watch` (the crate has no
/// `tokio-util` dependency, and adding one is not worth a manifest change).
/// A dropped sender reads as cancelled, so a supervisor that goes away fails
/// closed rather than leaving workers running unsupervised.
#[derive(Clone)]
pub struct StopToken {
    rx: tokio::sync::watch::Receiver<bool>,
    // Only set by [`StopToken::never`]: keeps the channel open forever.
    _keep: Option<std::sync::Arc<tokio::sync::watch::Sender<bool>>>,
}

impl StopToken {
    /// A token plus the sender that cancels it.
    pub fn new() -> (tokio::sync::watch::Sender<bool>, Self) {
        let (tx, rx) = tokio::sync::watch::channel(false);
        (tx, Self { rx, _keep: None })
    }

    /// A token that is never cancelled: the single-cluster path, where there
    /// is no ownership to lose.
    pub fn never() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(false);
        Self {
            rx,
            _keep: Some(std::sync::Arc::new(tx)),
        }
    }

    pub fn is_cancelled(&self) -> bool {
        *self.rx.borrow() || (self._keep.is_none() && self.rx.has_changed().is_err())
    }

    pub async fn cancelled(&self) {
        let mut rx = self.rx.clone();
        // Err = sender dropped, which also means stop.
        let _ = rx.wait_for(|v| *v).await;
    }

    /// Sleeps for `d`; returns `true` when cancelled first (the caller exits
    /// its loop at this tick boundary, never mid-pass).
    pub async fn sleep(&self, d: std::time::Duration) -> bool {
        tokio::select! {
            _ = self.cancelled() => true,
            _ = tokio::time::sleep(d) => self.is_cancelled(),
        }
    }
}

/// Result of one read of the job-cluster claim. A failed read is `Unknown`,
/// never "held": the supervisor fails closed.
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaimRead {
    Held,
    NotHeld,
    Unknown,
}

#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupervisorAction {
    Start,
    Stop,
    Hold,
}

/// The supervisor's whole decision: a pure function of whether a worker
/// generation is running and what the claim read returned. Workers run exactly
/// while the claim is provably held here; `NotHeld` and `Unknown` both stop a
/// running generation (same fail-closed rule as the anomaly supervisor in
/// `jobs::job::mod.rs`).
#[cfg_attr(not(feature = "enterprise"), allow(dead_code))]
fn supervisor_action(running: bool, claim: ClaimRead) -> SupervisorAction {
    match (running, claim) {
        (false, ClaimRead::Held) => SupervisorAction::Start,
        (true, ClaimRead::NotHeld | ClaimRead::Unknown) => SupervisorAction::Stop,
        _ => SupervisorAction::Hold,
    }
}

/// Start/Stop supervisor for the claim-gated workers (o2-enterprise#3190).
///
/// Replaces the old start-only latch, which spawned the workers once on
/// gaining the claim and never stopped them when the claim moved away, so two
/// regions could schedule, dispatch and reap the same checks. Each generation
/// gets its own [`StopToken`]; Stop cancels it and JOINS every worker before
/// the next Start can happen, so there are never two generations at once.
#[cfg(feature = "enterprise")]
async fn ownership_supervisor() {
    let mut generation: u64 = 0;
    let mut running: Option<(
        tokio::sync::watch::Sender<bool>,
        Vec<tokio::task::JoinHandle<()>>,
    )> = None;
    let mut last_claim: Option<ClaimRead> = None;
    loop {
        let claim = read_job_cluster_claim().await;
        if last_claim != Some(claim) && claim == ClaimRead::NotHeld && running.is_none() {
            tracing::info!(
                "[synthetics] another cluster holds the job-cluster claim (or none is registered \
                 yet) — workers not running here, re-checking every {}s",
                JOB_CLUSTER_POLL.as_secs()
            );
        }
        last_claim = Some(claim);
        match supervisor_action(running.is_some(), claim) {
            SupervisorAction::Start => {
                generation += 1;
                tracing::info!(
                    generation,
                    "[synthetics] ownership acquired — starting workers"
                );
                let (tx, token) = StopToken::new();
                running = Some((tx, spawn_workers(token)));
            }
            SupervisorAction::Stop => {
                if claim == ClaimRead::Unknown {
                    tracing::warn!(
                        generation,
                        "[synthetics] ownership unknown (claim read failed) — stopping workers"
                    );
                } else {
                    tracing::info!(generation, "[synthetics] ownership lost — stopping workers");
                }
                if let Some((tx, handles)) = running.take() {
                    let _ = tx.send(true);
                    for h in handles {
                        if let Err(e) = h.await {
                            tracing::error!(generation, "[synthetics] worker join failed: {e}");
                        }
                    }
                }
                tracing::info!(generation, "[synthetics] workers stopped");
            }
            SupervisorAction::Hold => {}
        }
        tokio::time::sleep(JOB_CLUSTER_POLL).await;
    }
}

#[cfg(feature = "enterprise")]
async fn read_job_cluster_claim() -> ClaimRead {
    match holds_job_cluster_claim().await {
        Some(true) => ClaimRead::Held,
        Some(false) => ClaimRead::NotHeld,
        None => ClaimRead::Unknown,
    }
}

/// Spawns one generation of workers. Every worker takes `stop` and leaves its
/// loop at the next tick boundary once it is cancelled.
///
/// All of them are claim-gated, as they were under the old latch: the status
/// page task is still one loop (incident engine and snapshot together — the
/// per-region snapshot split is future work), and the domain verifier writes
/// shared verification state, so both stay owner-only.
fn spawn_workers(stop: StopToken) -> Vec<tokio::task::JoinHandle<()>> {
    let verifier_stop = stop.clone();
    vec![
        tokio::spawn(scheduler::run(stop.clone())),
        tokio::spawn(dispatcher::run(stop.clone())),
        tokio::spawn(reaper::run(stop.clone())),
        // Status pages ships with synthetics — no separate toggle.
        tokio::spawn(status_pages::run(stop.clone())),
        // The verifier lives in the enterprise crate and takes no token, so it
        // is dropped at its next await point on cancel.
        tokio::spawn(async move {
            tokio::select! {
                _ = verifier_stop.cancelled() => {}
                _ = status_pages::run_domain_verifier() => {}
            }
        }),
        // Its own task, not a step on the reaper's tick: a pass is up to a
        // thousand rows of outbound HTTP, and the reaper's lease bookkeeping
        // cannot wait behind it. Its own kill switch too, checked per pass.
        tokio::spawn(reaper::orphan::run(stop)),
    ]
}

/// One evaluation of [`should_start`] against the super-cluster KV.
///
/// Fails closed. Either read failing leaves the claim unknown, and starting on
/// ignorance is the duplicate execution this gate exists to prevent, where not
/// starting costs one poll interval — the caller retries, so a transient NATS
/// error is a delay and not an outage. A *sustained* one does stop synthetics
/// in every region, which is the same posture the platform already takes:
/// `jobs::job::scheduler::run` propagates the identical error with `?` and
/// schedules no alerts at all. It is visible from outside too — nothing
/// increments `SYNTHETICS_ORPHAN_SCANS_TOTAL` anywhere, which is exactly the
/// dead-region signal `reaper::orphan` documents.
#[cfg(feature = "enterprise")]
async fn holds_job_cluster_claim() -> Option<bool> {
    use o2_enterprise::enterprise::super_cluster::kv;

    let local = config::get_cluster_name();
    let claim = match kv::scheduler::get_job_cluster().await {
        Ok(name) => name,
        Err(e) => {
            tracing::error!("[synthetics] could not read the job cluster, not starting yet: {e}");
            return None;
        }
    };

    // Both settled without the cluster list, which is the more expensive read.
    // Must agree with `should_start`, which is where the rule is tested.
    if claim.is_empty() {
        return Some(false);
    }
    if claim == local {
        return Some(true);
    }

    let live = match kv::cluster::list_by_role_group(None).await {
        Ok(clusters) => clusters.into_iter().map(|c| c.name).collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!("[synthetics] could not list clusters, not starting yet: {e}");
            return None;
        }
    };
    Some(should_start(true, &claim, &local, &live))
}

/// Whether this cluster may start the synthetics workers.
///
/// `super_cluster_enabled` is the first arm and short-circuits everything: with
/// a single cluster there is no claim to read and nothing to arbitrate. [`init`]
/// implements that arm structurally — it returns before the poll task exists, so
/// the KV is not merely ignored but never reached — and this is where the rule
/// is written down and tested, which is why the parameter is here and not just a
/// branch up there.
///
/// The rest is the platform's existing job-cluster claim
/// ([`o2_enterprise::enterprise::super_cluster::kv::scheduler`]), which synthetics
/// *reads* and never writes — see [`init`] for why registering would be a
/// regression rather than a strengthening.
///
/// One arm differs from `alert_group_reaper::may_sweep`, which asks the same
/// question of the same key: **an unclaimed key does not start us.** That reaper
/// is a per-pass gate on a loop that is already running, so for it "nobody has
/// claimed" means "nobody is scheduling either, sweeping is safe". This is a
/// *start* gate, and it is evaluated before `jobs::job::scheduler::run` — the
/// only writer of the claim — has had a chance to register. Reading the
/// pre-election emptiness as consent is precisely the double-execution this gate
/// exists to prevent: on a fresh super cluster every region would see `""` and
/// every region would start. Waiting costs one poll interval, because the
/// election that resolves it happens in this very process.
#[cfg(feature = "enterprise")]
fn should_start(
    super_cluster_enabled: bool,
    claim: &str,
    local_cluster: &str,
    live_clusters: &[String],
) -> bool {
    if !super_cluster_enabled {
        return true;
    }
    !claim.is_empty()
        && !o2_enterprise::enterprise::super_cluster::kv::scheduler::claim_is_held_elsewhere(
            claim,
            local_cluster,
            live_clusters,
        )
}

#[cfg(all(test, feature = "enterprise"))]
mod job_cluster_gate_tests {
    use super::*;

    const LOCAL: &str = "eu-central";

    fn both() -> Vec<String> {
        vec!["us-west".to_string(), LOCAL.to_string()]
    }

    /// The §14 acceptance criterion, as a unit: with the super cluster off the
    /// verdict cannot depend on a claim at all. The real guarantee is
    /// structural — [`init`] returns before the poll task is ever spawned, so
    /// no KV client is constructed on this path — and this pins the arm that
    /// makes that safe to rely on.
    #[test]
    fn super_cluster_disabled_starts_whatever_the_claim_says() {
        assert!(should_start(false, "us-west", LOCAL, &both()));
        assert!(should_start(false, "", LOCAL, &[]));
    }

    /// Diverges from `may_sweep` on purpose — see [`should_start`].
    ///
    /// This is also the failure policy. A super-cluster KV read that fails
    /// leaves the claim *unknown*, and unknown is spelled the same way as
    /// unclaimed: both arms of [`holds_job_cluster_claim`]'s error handling
    /// return the verdict pinned here rather than guessing.
    #[test]
    fn a_claim_we_cannot_read_does_not_start_us_yet() {
        assert!(!should_start(true, "", LOCAL, &both()));
        assert!(!should_start(true, "", LOCAL, &[]));
    }

    #[test]
    fn the_job_cluster_starts() {
        assert!(should_start(true, LOCAL, LOCAL, &both()));
    }

    #[test]
    fn a_cluster_that_does_not_hold_the_claim_does_not_start() {
        assert!(!should_start(true, "us-west", LOCAL, &both()));
    }

    /// Takes over from a dead claimant, matching `jobs::job::scheduler::run`
    /// and `alert_group_reaper::may_sweep`. Without this a scheduler move
    /// (spec §6) would leave the claim pinned to a region that no longer
    /// exists and synthetics would never run again anywhere.
    #[test]
    fn a_claim_by_a_departed_cluster_does_not_block_the_start() {
        assert!(should_start(true, "us-west", LOCAL, &[LOCAL.to_string()]));
    }
}

#[cfg(test)]
mod tests {
    use super::{ClaimRead::*, StopToken, SupervisorAction::*, supervisor_action};

    #[test]
    fn starts_only_on_a_held_claim() {
        assert_eq!(supervisor_action(false, Held), Start);
        assert_eq!(supervisor_action(false, NotHeld), Hold);
        assert_eq!(supervisor_action(false, Unknown), Hold);
    }

    #[test]
    fn a_running_generation_stops_on_loss_or_read_error() {
        assert_eq!(supervisor_action(true, NotHeld), Stop);
        assert_eq!(supervisor_action(true, Unknown), Stop);
        assert_eq!(supervisor_action(true, Held), Hold);
    }

    /// Flapping claim: replay the reads through the decision function and
    /// check the generation never overlaps and every flip is acted on.
    #[test]
    fn flapping_claim_alternates_start_and_stop_without_overlap() {
        let reads = [Held, Held, NotHeld, Held, Unknown, Unknown, Held, NotHeld];
        let mut running = false;
        let mut starts = 0;
        let mut stops = 0;
        for r in reads {
            match supervisor_action(running, r) {
                Start => {
                    assert!(!running, "never two generations");
                    running = true;
                    starts += 1;
                }
                Stop => {
                    assert!(running);
                    running = false;
                    stops += 1;
                }
                Hold => {}
            }
        }
        assert_eq!((starts, stops), (3, 3));
        assert!(!running);
    }

    #[tokio::test]
    async fn stop_token_cancels_sleep_and_dropped_sender_fails_closed() {
        let (tx, token) = StopToken::new();
        assert!(!token.is_cancelled());
        tx.send(true).unwrap();
        assert!(token.sleep(std::time::Duration::from_secs(60)).await);

        let (tx, token) = StopToken::new();
        drop(tx);
        assert!(token.sleep(std::time::Duration::from_secs(60)).await);

        let never = StopToken::never();
        assert!(!never.sleep(std::time::Duration::from_millis(1)).await);
    }
}
