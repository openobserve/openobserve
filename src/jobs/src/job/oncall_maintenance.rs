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

//! Reconciliation for open on-call records whose escalation timer is gone.
//!
//! **Load-bearing, not hygiene**, and running the product is what proved it: on
//! a development instance, 472 of 473 open records had no scheduler row. Every
//! one of them rendered on the on-call home screen as a live page with a
//! countdown to a rung that would never fire. A responder cannot tell those
//! from the one record that was real.
//!
//! Timers are lost for real reasons — a node died between a `delete` and a
//! `push`, the feature was toggled off mid-ladder, a team was deleted out from
//! under an open page — so the fix is not to make loss impossible but to make
//! sitting in that state impossible to do unnoticed.
//! [`reconcile_abandoned`](o2_enterprise::enterprise::oncall::escalation::reconcile_abandoned)
//! arms the ladder again where it should still be climbing and records how it
//! ended where it should not.
//!
//! Leader-only, like the other sweeps: this is a whole-org scan, and running it
//! on every node would race the re-arms against each other and push duplicate
//! triggers for the same record.
//!
//! The second sweep here is the **coverage** one (`architecture/02` §8): it
//! walks each schedule over the coming week and warns before a gap costs
//! somebody a page. `teams_with_coverage_gaps` and `Schedule::is_staffed` had
//! answered "is anybody on call right now" since covers landed, and nothing ran
//! them on a timer — so the answer was available exactly when it was too late
//! to act on.

use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};

/// How often to sweep. A lost timer is not urgent — the record is already
/// stalled and one more minute changes nothing — but it must be bounded, and a
/// pass over an org with nothing wrong is one scheduler query and one response
/// query.
const INTERVAL_SECS: u64 = 60;

/// §8's cadence for the coverage sweep. Fifteen minutes against a seven-day
/// horizon: nothing about a rotation changes fast enough to need more, and the
/// walk reads every schedule in the deployment.
const COVERAGE_INTERVAL_SECS: u64 = 15 * 60;

/// How long the same team's gap stays quiet after it has been reported.
///
/// Twelve hours, so a gap that nobody has fixed is raised again on the next
/// working day rather than every fifteen minutes. Warning on a loop is how a
/// warning stops being read, and this one is about the failure §8 calls the
/// worst the system has.
const COVERAGE_RENOTIFY_MICROS: i64 = 12 * 60 * 60 * 1_000_000;

pub fn run() {
    if !LOCAL_NODE.is_alert_manager() {
        log::debug!("[ONCALL_MAINTENANCE] not an alert_manager node, skipping");
        return;
    }
    if !o2_enterprise::enterprise::oncall::is_enabled() {
        log::debug!("[ONCALL_MAINTENANCE] on-call is disabled, skipping");
        return;
    }

    log::info!("[ONCALL_MAINTENANCE] initialized with interval: {INTERVAL_SECS}s");

    spawn_pausable_job!("oncall_maintenance", INTERVAL_SECS, {
        if !is_leader().await {
            log::debug!("[ONCALL_MAINTENANCE] not leader, skipping this pass");
            continue;
        }

        if let Err(e) = sweep().await {
            log::error!("[ONCALL_MAINTENANCE] sweep failed: {e}");
        }
    });

    log::info!("[ONCALL_COVERAGE] initialized with interval: {COVERAGE_INTERVAL_SECS}s");

    // Its own job rather than a counter inside the one above: the two answer
    // different questions on different cadences, and a coverage walk that
    // failed must not stop abandoned records being reconciled.
    spawn_pausable_job!("oncall_coverage", COVERAGE_INTERVAL_SECS, {
        if !is_leader().await {
            log::debug!("[ONCALL_COVERAGE] not leader, skipping this pass");
            continue;
        }

        if let Err(e) = coverage_sweep(now_micros()).await {
            log::error!("[ONCALL_COVERAGE] sweep failed: {e}");
        }
    });
}

/// Whether this node does the whole-org work this pass.
async fn is_leader() -> bool {
    match infra::cluster::get_cached_online_query_nodes(None).await {
        Some(mut nodes) if !nodes.is_empty() => {
            nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
            nodes[0].uuid == LOCAL_NODE.uuid
        }
        // Same deliberate fallback as the other sweeps: with no cluster
        // view, assume single node and do the work. An abandoned page that
        // nobody reconciles is worse than a duplicated re-arm, which the
        // scheduler's claim lock collapses back to one anyway.
        _ => true,
    }
}

async fn sweep() -> Result<(), anyhow::Error> {
    let orgs = db::organization::list(None).await?;

    let mut changed = 0usize;
    for org in &orgs {
        // One org's failure must not stop the sweep — the next org's pages
        // staying abandoned is a worse outcome than a logged error.
        match o2_enterprise::enterprise::oncall::escalation::reconcile_abandoned(
            &org.identifier,
            now_micros(),
        )
        .await
        {
            Ok(n) => changed += n,
            Err(e) => log::warn!(
                "[ONCALL_MAINTENANCE] reconcile failed for {}: {e}",
                org.identifier
            ),
        }
    }

    // Only worth a line when it did something. A sweep that finds nothing is
    // the normal case and saying so every minute buries the case that matters.
    if changed > 0 {
        log::info!(
            "[ONCALL_MAINTENANCE] swept {} orgs: {changed} abandoned records reconciled",
            orgs.len()
        );
    }
    Ok(())
}

/// When each team's gap was last reported, so an unfixed one is not mailed out
/// every fifteen minutes.
///
/// Per-node and in-memory, like the delivery breaker: the sweep is leader-only,
/// so there is one writer at a time, and the cost of losing the map on a
/// restart is one extra warning about a gap that is genuinely still there.
static LAST_WARNED: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<(String, String), i64>>,
> = std::sync::LazyLock::new(Default::default);

/// Whether this team's gap is due to be reported again.
fn due_to_warn(org_id: &str, team_id: &str, now: i64) -> bool {
    let Ok(mut seen) = LAST_WARNED.lock() else {
        // A poisoned lock must not silence the one warning that matters most.
        return true;
    };
    let key = (org_id.to_string(), team_id.to_string());
    match seen.get(&key) {
        Some(at) if now - *at < COVERAGE_RENOTIFY_MICROS => false,
        _ => {
            seen.insert(key, now);
            true
        }
    }
}

/// Walks every schedule over the coming week and warns about the gaps
/// (`architecture/02` §8).
///
/// `now` is passed in rather than read here so the pass is one testable thing
/// with a clock at its edge.
async fn coverage_sweep(now: i64) -> Result<(), anyhow::Error> {
    use o2_enterprise::enterprise::oncall::service;

    let orgs = db::organization::list(None).await?;
    let mut found = 0usize;

    for org in &orgs {
        let gaps = match service::coverage_gaps_ahead(
            &org.identifier,
            now,
            service::COVERAGE_HORIZON_MICROS,
        )
        .await
        {
            Ok(gaps) => gaps,
            // One org's failure must not stop the rest: another org's team
            // being uncovered is the worse outcome.
            Err(e) => {
                log::warn!(
                    "[ONCALL_COVERAGE] could not walk {}: {e}",
                    org.identifier
                );
                continue;
            }
        };

        for gap in gaps {
            found += 1;
            // Counted every pass, warned about on a cooldown: the series is
            // what a dashboard reads, and a gauge that only moved when an email
            // went out would read as "fixed" for twelve hours at a time.
            config::metrics::oncall::coverage_gap(&org.identifier, "sweep");
            if !due_to_warn(&org.identifier, &gap.team.id, now) {
                continue;
            }
            log::warn!(
                "[ONCALL_COVERAGE] {}/{} pages nobody from {} — a page raised then would reach no one",
                org.identifier,
                gap.team.name,
                gap.at
            );
            warn_about(&org.identifier, &gap, now).await;
        }
    }

    if found > 0 {
        log::info!(
            "[ONCALL_COVERAGE] swept {} orgs: {found} team(s) with a gap in the next 7 days",
            orgs.len()
        );
    }
    Ok(())
}

/// Emails the team and the org's admins about one gap.
///
/// Non-fatal throughout. The log line above has already been written and the
/// metric already moved; an SMTP failure must not stop the walk finding the
/// next team, which may be worse off than this one.
async fn warn_about(
    org_id: &str,
    gap: &o2_enterprise::enterprise::oncall::service::CoverageGap,
    now: i64,
) {
    use o2_enterprise::enterprise::oncall::notify::{self, Notifier};

    let audience = match o2_enterprise::enterprise::oncall::service::coverage_gap_audience(
        org_id,
        &gap.team.id,
    )
    .await
    {
        Ok(a) if !a.is_empty() => a,
        Ok(_) => {
            // A team with no members and an org with no admins. There is
            // nobody to tell, which is itself the finding.
            log::warn!(
                "[ONCALL_COVERAGE] {org_id}/{} has a coverage gap and nobody to warn about it",
                gap.team.name
            );
            return;
        }
        Err(e) => {
            log::warn!("[ONCALL_COVERAGE] could not work out who to warn for {org_id}: {e}");
            return;
        }
    };

    let rendered = notify::render_coverage_gap_ahead(&gap.team.name, gap.at, gap.hours_away(now));
    for recipient in audience {
        let addressed = notify::Addressed {
            page: notify::Page {
                org_id: org_id.to_string(),
                response_id: String::new(),
                team_name: gap.team.name.clone(),
                title: "coverage gap".to_string(),
                priority: config::meta::alerts::priority::AlertPriority::P3,
                reason: "you are on this team, or an admin of this org".to_string(),
                detail_url: String::new(),
                investigation: vec![],
            },
            recipient: recipient.clone(),
            channel: config::meta::oncall::Channel::Email,
            // Nothing to acknowledge: this is not a page, it is a warning that
            // one would not arrive.
            ack_url: None,
        };
        if let Err(e) = notify::EmailNotifier.send(&addressed, &rendered).await {
            log::warn!("[ONCALL_COVERAGE] could not warn {recipient} about {org_id}: {e}");
        }
    }
}
