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

//! Durable alert run state, plus its super-cluster fan-out.
//!
//! The same shape as [`crate::scheduler`]: the table functions live in `infra`
//! and this layer sits above them, so a write can be published to the other
//! regions once it has landed locally. The split is not stylistic — `infra` has
//! no dependency on the enterprise crate (the dependency runs the other way), so
//! the publish cannot live any lower. It is also what lets
//! `super_cluster_queue::alert_states` apply an incoming write through `infra`
//! directly and *not* re-publish it, which would otherwise have the regions
//! handing the same write around forever.
//!
//! **Every write path goes through here**; only reads go straight to `infra`.

use config::meta::alerts::{dispatch::DeliveryEpisode, grouping::GroupPlan, state::StateUpdate};
use infra::{errors::Result, table::alert_states::DeliveryOutcome};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    super_cluster::{self, queue::AlertStateMessage},
};

#[inline]
pub async fn persist(update: &StateUpdate) -> Result<()> {
    // Mirrors the early return in the table layer: nothing was written, so
    // there is nothing to replicate.
    if update.state.is_none() {
        return Ok(());
    }
    infra::table::alert_states::persist(update).await?;

    #[cfg(feature = "enterprise")]
    publish(AlertStateMessage::Persist {
        update: update.clone(),
    })
    .await;

    Ok(())
}

#[inline]
pub async fn persist_group_plan(plan: &GroupPlan, alert_id: &str) -> Result<()> {
    // Underscored because only the enterprise arm below reads it — the same
    // shape `scheduler.rs` uses for its super-cluster-only bindings.
    let _written = infra::table::alert_states::persist_group_plan(plan, alert_id).await?;

    // A plan the §5.3 opt-out gate refused wrote nothing here, and broadcasting
    // it would be worse than pointless: a region that has not yet seen the
    // opt-out would apply it and resurrect the rows the toggle just removed —
    // and with the reaper gated to the job cluster, nothing there would sweep
    // them back up.
    #[cfg(feature = "enterprise")]
    if _written {
        publish(AlertStateMessage::PersistGroupPlan {
            alert_id: alert_id.to_string(),
            plan: plan.clone(),
        })
        .await;
    }

    Ok(())
}

#[inline]
pub async fn advance_delivery_state(
    alert_id: &str,
    group_key: &str,
    episode: DeliveryEpisode,
    outcome: DeliveryOutcome,
) -> Result<bool> {
    let applied =
        infra::table::alert_states::advance_delivery_state(alert_id, group_key, episode, outcome)
            .await?;

    // A callback whose episode had already moved on wrote nothing here, and the
    // same guard would reject it everywhere else too.
    #[cfg(feature = "enterprise")]
    if applied {
        publish(AlertStateMessage::AdvanceDeliveryState {
            alert_id: alert_id.to_string(),
            group_key: group_key.to_string(),
            episode,
            outcome,
        })
        .await;
    }

    Ok(applied)
}

#[inline]
pub async fn delete_groups(alert_id: &str, group_keys: &[String]) -> Result<()> {
    if group_keys.is_empty() {
        return Ok(());
    }
    infra::table::alert_states::delete_groups(alert_id, group_keys).await?;

    #[cfg(feature = "enterprise")]
    publish(AlertStateMessage::DeleteGroups {
        alert_id: alert_id.to_string(),
        group_keys: group_keys.to_vec(),
    })
    .await;

    Ok(())
}

#[inline]
pub async fn delete_all_groups(alert_id: &str) -> Result<u64> {
    let deleted = infra::table::alert_states::delete_all_groups(alert_id).await?;

    // Published even when this region deleted nothing: opting out is a
    // configuration change, and another region may still be holding rows.
    #[cfg(feature = "enterprise")]
    publish(AlertStateMessage::DeleteAllGroups {
        alert_id: alert_id.to_string(),
    })
    .await;

    Ok(deleted)
}

#[inline]
pub async fn delete_by_alert(alert_id: &str) -> Result<()> {
    infra::table::alert_states::delete_by_alert(alert_id).await?;

    #[cfg(feature = "enterprise")]
    publish(AlertStateMessage::DeleteByAlert {
        alert_id: alert_id.to_string(),
    })
    .await;

    Ok(())
}

/// Fan one write out to the other regions, best-effort.
///
/// A publish failure is logged, never returned. The local write has already
/// committed, so surfacing it would tell the caller the *state write* failed —
/// and `persist_alert_run_state` reads that as "do not dispatch", which would
/// turn a queue hiccup into a group's page going missing.
///
/// What that costs: an evaluation write is re-sent by the next evaluation, so
/// the other regions converge on their own. A **delete** is not — a deleted
/// alert is never evaluated again — so a dropped delete message strands rows in
/// the regions that missed it. Accepted here: this layer has no retry, and one
/// is out of scope for this change.
#[cfg(feature = "enterprise")]
async fn publish(msg: AlertStateMessage) {
    if !get_o2_config().super_cluster.enabled {
        return;
    }
    if let Err(e) = super_cluster::queue::alert_states(msg).await {
        log::error!("[SUPER_CLUSTER:sync] Failed to publish alert state write: {e}");
    }
}
