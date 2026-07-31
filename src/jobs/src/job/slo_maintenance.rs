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

//! SLO reconciliation and budget expiry (`alerts_2.md` §6b.4c, S-14c).
//!
//! Both halves are **load-bearing, not hygiene**, and end-to-end testing is
//! what proved it: with reconciliation implemented but never invoked, a
//! 7-day SLO's `covered_slices` climbed past the 10,080 its window can hold
//! and kept going. Nothing else retires a slice that has aged out of a
//! **rolling** window — the ingest pass only ever adds.
//!
//! * **Reconciliation** rebuilds the running aggregate from the slices, which are the source of
//!   truth. That is what makes at-least-once publication safe (D64) *and* what makes the window
//!   actually roll.
//! * **Residual expiry** releases a retired generation's budget charge once its slices have aged
//!   past the horizon. Without it an org's row budget only ever shrinks, and an org that edits its
//!   SLOs a few times is permanently poorer.
//!
//! Leader-only, like the other sweeps: both are whole-SLO scans, and running
//! them on every node would multiply the writes and race the rebuilds against
//! each other.

use config::{cluster::LOCAL_NODE, get_config, spawn_pausable_job, utils::time::now_micros};

pub fn run() {
    if !LOCAL_NODE.is_alert_manager() {
        log::debug!("[SLO_MAINTENANCE] not an alert_manager node, skipping");
        return;
    }
    let cfg = get_config();
    if !cfg.slo.enabled {
        log::debug!("[SLO_MAINTENANCE] SLOs are disabled, skipping");
        return;
    }

    let interval = cfg.slo.reconcile_interval_secs.max(60) as u64;
    log::info!("[SLO_MAINTENANCE] initialized with interval: {interval}s");

    spawn_pausable_job!("slo_maintenance", interval, {
        let is_leader = match infra::cluster::get_cached_online_query_nodes(None).await {
            Some(mut nodes) if !nodes.is_empty() => {
                nodes.sort_by(|a, b| a.uuid.cmp(&b.uuid));
                nodes[0].uuid == LOCAL_NODE.uuid
            }
            // Same deliberate fallback as the other sweeps: with no cluster
            // view, assume single node and do the work rather than letting the
            // aggregate drift indefinitely.
            _ => true,
        };
        if !is_leader {
            log::debug!("[SLO_MAINTENANCE] not leader, skipping this pass");
            continue;
        }

        if let Err(e) = sweep().await {
            log::error!("[SLO_MAINTENANCE] sweep failed: {e}");
        }
    });
}

async fn sweep() -> Result<(), anyhow::Error> {
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;

    let slos = infra::table::slos::list_enabled(db)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    if slos.is_empty() {
        return Ok(());
    }

    let mut reconciled = 0usize;
    let mut orgs: std::collections::BTreeSet<String> = Default::default();
    for slo in &slos {
        orgs.insert(slo.org.clone());
        // One SLO's failure must not stop the sweep: the next SLO's aggregate
        // drifting is a worse outcome than a logged error.
        match openobserve_core::slo::reconcile::reconcile(slo).await {
            Ok(rows) if !rows.is_empty() => reconciled += 1,
            Ok(_) => {}
            Err(e) => log::warn!("[SLO_MAINTENANCE] reconcile failed for {}: {e}", slo.id),
        }
    }

    let now = now_micros() / 1_000_000;
    let mut freed = 0i64;
    for org in &orgs {
        match infra::table::slo_budget::expire_residuals(db, org, now).await {
            Ok(n) => freed += n,
            Err(e) => log::warn!("[SLO_MAINTENANCE] residual expiry failed for {org}: {e}"),
        }
    }

    log::info!(
        "[SLO_MAINTENANCE] swept {} SLOs across {} orgs: {reconciled} reconciled, {freed} budget rows released",
        slos.len(),
        orgs.len()
    );
    Ok(())
}
