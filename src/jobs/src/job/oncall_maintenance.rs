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

//! Leader-only sweeps: abandoned escalation timers, coming-week schedule gaps, and retention.

use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};

/// A lost timer is not urgent, and a pass over a healthy org costs two queries.
const INTERVAL_SECS: u64 = 60;

/// The walk reads every schedule in the deployment, against a seven-day horizon.
const COVERAGE_INTERVAL_SECS: u64 = 15 * 60;

/// A looping warning stops being read, so an unfixed gap waits for the next working day.
const COVERAGE_RENOTIFY_MICROS: i64 = 12 * 60 * 60 * 1_000_000;

/// Hourly is what makes the `DISTINCT` the sweep leans on affordable.
const RETENTION_INTERVAL_SECS: u64 = 60 * 60;

const MICROS_PER_DAY: i64 = 24 * 60 * 60 * 1_000_000;

/// A guard, not a policy: `days * MICROS_PER_DAY` on an operator-typed `i64` overflows.
const MAX_RETENTION_DAYS: i64 = 3_650;

/// An unbounded batch defeats the point; a zero one makes the sweep a no-op that reads set.
const MAX_RETENTION_BATCH: u64 = 10_000;

/// `None` when retention is switched off, and never a cutoff in the future.
fn retention_cutoff(days: i64, now: i64) -> Option<i64> {
    if days <= 0 {
        return None;
    }
    Some(now - days.min(MAX_RETENTION_DAYS) * MICROS_PER_DAY)
}

fn retention_batch(configured: u64) -> u64 {
    configured.clamp(1, MAX_RETENTION_BATCH)
}

pub fn run() {
    if !LOCAL_NODE.is_scheduler() {
        log::debug!("[ONCALL_MAINTENANCE] not a scheduler node, skipping");
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

    log::info!("[ONCALL_RETENTION] initialized with interval: {RETENTION_INTERVAL_SECS}s");

    // Separate jobs, not counters in one loop: a failed pass must not stop the others running.
    spawn_pausable_job!("oncall_retention", RETENTION_INTERVAL_SECS, {
        if !is_leader().await {
            log::debug!("[ONCALL_RETENTION] not leader, skipping this pass");
            continue;
        }

        if let Err(e) = retention_sweep(now_micros()).await {
            log::error!("[ONCALL_RETENTION] sweep failed: {e}");
        }
    });

    log::info!("[ONCALL_COVERAGE] initialized with interval: {COVERAGE_INTERVAL_SECS}s");

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

/// From the alert-manager set: the query set excludes the asking node, so sweeps never ran.
async fn is_leader() -> bool {
    crate::job::leader::is_alert_manager_leader().await
}

async fn sweep() -> Result<(), anyhow::Error> {
    let orgs = db::organization::list(None).await?;

    let mut changed = 0usize;
    for org in &orgs {
        // One org's failure must not stop the sweep: pages left abandoned is the worse outcome.
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

    if changed > 0 {
        log::info!(
            "[ONCALL_MAINTENANCE] swept {} orgs: {changed} abandoned records reconciled",
            orgs.len()
        );
    }
    Ok(())
}

/// Prunes `oncall_response_events` only: prior causes live on `oncall_responses` and must stay.
async fn retention_sweep(now: i64) -> Result<(), anyhow::Error> {
    let cfg = &o2_enterprise::enterprise::common::config::get_config().oncall;
    let Some(cutoff) = retention_cutoff(cfg.event_retention_days, now) else {
        log::debug!("[ONCALL_RETENTION] retention is switched off; skipping");
        return Ok(());
    };
    let (records, events) = infra::table::oncall_responses::prune_events(
        cutoff,
        retention_batch(cfg.event_retention_batch),
    )
    .await?;
    if events > 0 {
        log::info!(
            "[ONCALL_RETENTION] pruned {events} timeline rows from {records} records closed              before {cutoff}"
        );
    }
    Ok(())
}

/// Per-node and in-memory: the sweep is leader-only, so losing the map costs one extra warning.
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
            // One org's failure must not stop the rest: an uncovered team is the worse outcome.
            Err(e) => {
                log::warn!("[ONCALL_COVERAGE] could not walk {}: {e}", org.identifier);
                continue;
            }
        };

        for gap in gaps {
            found += 1;
            // Counted outside the cooldown, or the gauge would read as fixed for twelve hours.
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

/// Non-fatal throughout: an SMTP failure must not stop the walk finding the next team.
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
            // Nobody to tell is itself the finding.
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
                // No alert behind this one, so no runbook to follow.
                runbook_url: None,
                investigation: vec![],
            },
            recipient: recipient.clone(),
            channel: config::meta::oncall::Channel::Email,
            // A warning that a page would not arrive is not a page, so there is nothing to ack.
            ack_url: None,
        };
        if let Err(e) = notify::EmailNotifier.send(&addressed, &rendered).await {
            log::warn!("[ONCALL_COVERAGE] could not warn {recipient} about {org_id}: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_the_cutoff_is_the_window_behind_now() {
        let now = 1_000 * MICROS_PER_DAY;
        assert_eq!(
            retention_cutoff(90, now),
            Some(now - 90 * MICROS_PER_DAY),
            "a record closed inside the window keeps its timeline"
        );
    }

    /// An operator who keeps everything gets a no-op sweep, not a default picked for them.
    #[test]
    fn test_zero_or_negative_switches_the_sweep_off() {
        let now = 1_000 * MICROS_PER_DAY;
        assert_eq!(retention_cutoff(0, now), None);
        assert_eq!(retention_cutoff(-1, now), None);
        assert_eq!(retention_cutoff(i64::MIN, now), None);
    }

    /// An overflowed cutoff deletes everything once, and that is not recoverable.
    #[test]
    fn test_an_absurd_window_cannot_overflow_into_deleting_everything() {
        let now = 1_000 * MICROS_PER_DAY;
        let cutoff = retention_cutoff(i64::MAX, now).expect("a huge window is still a window");
        assert!(
            cutoff < now,
            "the cutoff must stay in the past, not wrap into the future"
        );
        assert_eq!(cutoff, now - MAX_RETENTION_DAYS * MICROS_PER_DAY);
    }

    /// A cutoff in the future deletes the timeline of the page most likely to be read.
    #[test]
    fn test_the_cutoff_is_never_in_the_future() {
        for days in [1, 7, 90, 365, MAX_RETENTION_DAYS, i64::MAX] {
            let now = 10_000 * MICROS_PER_DAY;
            assert!(retention_cutoff(days, now).unwrap() < now, "{days}");
        }
    }

    #[test]
    fn test_the_batch_is_clamped_into_something_that_bounds_and_progresses() {
        assert_eq!(retention_batch(0), 1, "a pass must make progress");
        assert_eq!(retention_batch(500), 500);
        assert_eq!(retention_batch(u64::MAX), MAX_RETENTION_BATCH);
    }
}
