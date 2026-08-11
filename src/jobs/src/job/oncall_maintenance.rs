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

use config::{cluster::LOCAL_NODE, spawn_pausable_job, utils::time::now_micros};

/// How often to sweep. A lost timer is not urgent — the record is already
/// stalled and one more minute changes nothing — but it must be bounded, and a
/// pass over an org with nothing wrong is one scheduler query and one response
/// query.
const INTERVAL_SECS: u64 = 60;

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
        let is_leader = match infra::cluster::get_cached_online_query_nodes(None).await {
            Some(mut nodes) if !nodes.is_empty() => {
                nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                nodes[0].uuid == LOCAL_NODE.uuid
            }
            // Same deliberate fallback as the other sweeps: with no cluster
            // view, assume single node and do the work. An abandoned page that
            // nobody reconciles is worse than a duplicated re-arm, which the
            // scheduler's claim lock collapses back to one anyway.
            _ => true,
        };
        if !is_leader {
            log::debug!("[ONCALL_MAINTENANCE] not leader, skipping this pass");
            continue;
        }

        if let Err(e) = sweep().await {
            log::error!("[ONCALL_MAINTENANCE] sweep failed: {e}");
        }
    });
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
