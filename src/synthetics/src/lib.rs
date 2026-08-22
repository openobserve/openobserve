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

/// Serialises the tests that swap the process-global `config::CONFIG`.
///
/// Two of them pin the same property from opposite ends of the crate — that the
/// synthetics config is read at point of use, not captured at boot — and both
/// have to install a config to prove it. Without this they race, and the loser
/// reads the winner's value. Poisoning is ignored so one failed test does not
/// cascade into `PoisonError`s.
#[cfg(test)]
pub(crate) static CONFIG_SWAP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub mod alerting;
pub mod dispatcher;
pub mod job_api;
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
pub async fn init() {
    if !config::get_config().synthetics.enabled {
        tracing::info!("[synthetics] disabled via ZO_SYNTHETICS_ENABLED — workers not started");
        return;
    }

    // Single cluster, or an OSS build where there is no such thing: start
    // exactly as before. Nothing below this line is reached, so no
    // super-cluster KV client is built and no NATS read is issued on this path
    // (spec §14 — super cluster off must be byte-identical).
    #[cfg(not(feature = "enterprise"))]
    spawn_workers();

    #[cfg(feature = "enterprise")]
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        spawn_workers();
        return;
    }

    #[cfg(feature = "enterprise")]
    tokio::spawn(async move {
        let mut announced = false;
        while !holds_job_cluster_claim().await {
            if !announced {
                // Once, not per poll: a region that legitimately does not hold
                // the claim is the steady state for the whole life of the
                // process, and an every-10s line would bury it.
                tracing::info!(
                    "[synthetics] another cluster holds the job-cluster claim (or none is \
                     registered yet) — workers not started, re-checking every {}s",
                    JOB_CLUSTER_POLL.as_secs()
                );
                announced = true;
            }
            tokio::time::sleep(JOB_CLUSTER_POLL).await;
        }
        tracing::info!("[synthetics] this cluster holds the job-cluster claim — starting workers");
        spawn_workers();
    });
}

fn spawn_workers() {
    tokio::spawn(scheduler::run());
    tokio::spawn(dispatcher::run());
    tokio::spawn(reaper::run());
    // POC scope: single cluster. Multi-region needs this split — the
    // incident-engine half claim-gated, the snapshot half per region.
    if config::get_config().synthetics.status_pages_enabled {
        tokio::spawn(status_pages::run());
    }
    // Its own task, not a step on the reaper's tick: a pass is up to a thousand
    // rows of outbound HTTP, and the reaper's lease bookkeeping cannot wait
    // behind it. Its own kill switch too, checked per pass rather than here.
    tokio::spawn(reaper::orphan::run());
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
async fn holds_job_cluster_claim() -> bool {
    use o2_enterprise::enterprise::super_cluster::kv;

    let local = config::get_cluster_name();
    let claim = match kv::scheduler::get_job_cluster().await {
        Ok(name) => name,
        Err(e) => {
            tracing::error!("[synthetics] could not read the job cluster, not starting yet: {e}");
            return false;
        }
    };

    // Both settled without the cluster list, which is the more expensive read.
    // Must agree with `should_start`, which is where the rule is tested.
    if claim.is_empty() {
        return false;
    }
    if claim == local {
        return true;
    }

    let live = match kv::cluster::list_by_role_group(None).await {
        Ok(clusters) => clusters.into_iter().map(|c| c.name).collect::<Vec<_>>(),
        Err(e) => {
            tracing::error!("[synthetics] could not list clusters, not starting yet: {e}");
            return false;
        }
    };
    should_start(true, &claim, &local, &live)
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
    /// Every publish helper on the synthetics queue: checks and the two config
    /// tables. Assembled at runtime so the search cannot match its own text.
    fn any_publish_prefix() -> String {
        ["queue", "synthetics_"].join("::")
    }

    /// The check publish helpers share this prefix.
    fn publish_prefix() -> String {
        ["queue", "synthetics_check"].join("::")
    }

    /// Source with every whitespace character removed, so a guard counts the
    /// same whether rustfmt kept it on one line or wrapped it.
    ///
    /// The enterprise idiom fits on one line; the OSS one is
    /// `o2_enterprise::enterprise::common::config::get_config().super_cluster
    /// .enabled` and does not. Matching the formatted text would make this test
    /// a lint on line length, and it would go quiet — reading zero guards as
    /// "no publishes to guard" — exactly when a publish moved into a file where
    /// the call is longer.
    fn squeezed(source: &str) -> String {
        source.chars().filter(|c| !c.is_whitespace()).collect()
    }

    /// The OSS half of the enterprise `nothing_on_the_run_path_publishes`
    /// guarantee, and the reason replication traffic scales with *changes*
    /// rather than with runs.
    ///
    /// `claim_due` and `advance_schedule` live in `infra::table`, which cannot
    /// reach the enterprise crate at all, so the only place a per-run publish
    /// could be introduced is one of these callers. If one ever grows one,
    /// 1,000 checks on a 1-minute schedule become 1,000 messages a minute
    /// forever — and nothing else in the system would notice.
    ///
    /// The list is not "zero publishes" but a counted allowance per file,
    /// because the property being protected is the rate, not the location. The
    /// three run-path publishes below each sit behind a transition check and so
    /// cost nothing in the steady state; see the comment on the allowance table.
    ///
    /// The enterprise copy walks the files still in `o2_enterprise`; this walks
    /// the ones that have moved here, with the same allowance table. A file
    /// arriving in this crate must be added to one list or the other, never
    /// dropped from both.
    #[test]
    fn nothing_on_the_run_path_publishes() {
        let prefix = publish_prefix();
        let any = any_publish_prefix();
        // A slice rather than an array literal: the list grows a file per
        // migration step, and `for … in [one_thing]` is a clippy error today
        // that would be reverted tomorrow.
        let files: &[(&str, &str)] = &[
            ("alerting", include_str!("alerting.rs")),
            ("dispatcher", include_str!("dispatcher.rs")),
            ("job_api", include_str!("job_api.rs")),
            ("reaper", include_str!("reaper/mod.rs")),
            ("reaper::orphan", include_str!("reaper/orphan.rs")),
            ("scheduler", include_str!("scheduler.rs")),
        ];
        for (name, source) in files {
            let source = squeezed(source);
            // Exceptions are named, counted and guarded, never waved through by
            // raising the ceiling for the whole list.
            //
            // `checks` is the count of check publishes; `any` additionally
            // covers the locations and probe-token queues.
            //
            //  - `dispatcher` mints an org's default probe token when it has none — a once-per-org
            //    backfill for orgs older than the probe-token table, not a per-run event. That one
            //    is a probe-token publish, hence 0 checks but 1 of `any`.
            //  - `dispatcher`, `job_api` and `reaper` each replicate `last_check_status`, the badge
            //    the LIST renders. That column is written only where the check ran, so before this
            //    the other regions showed "Unknown" for a check their own detail page — federated
            //    search over the results stream — reported as passing.
            //
            //    This is the one publish on the run path, and it is safe for the
            //    reason this test exists to protect: it sits behind the bool from
            //    `update_last_check_status`, which is true only when the stored
            //    value CHANGED. So the rate is status flips, not runs — a check
            //    that passes 1,440 times a day publishes nothing. Anything that
            //    would fire once per run still belongs at 0 here, and the guard
            //    to add for it is a transition check, not another entry.
            let (checks, allowed) = match *name {
                "dispatcher" => (1, 2),
                "job_api" | "reaper" => (1, 1),
                _ => (0, 0),
            };
            assert_eq!(
                source.matches(&prefix).count(),
                checks,
                "{name} is off the user-CRUD path; it may publish a check exactly {checks} time(s)"
            );
            assert_eq!(
                source.matches(&any).count(),
                allowed,
                "{name} may publish exactly {allowed} time(s) on the synthetics queue"
            );
            assert_eq!(
                source
                    .matches(&["super_cluster", "enabled"].join("."))
                    .count(),
                allowed,
                "{name}'s publishes must each carry their own super-cluster guard"
            );
        }
    }
}
