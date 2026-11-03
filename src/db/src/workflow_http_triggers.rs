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

//! Cache invalidation and super-cluster emit for HTTP triggers, each called after the local commit.

use bytes::Bytes;
use infra::{
    coordinator::get_coordinator,
    db::NEED_WATCH,
    table::workflow_http_triggers::{TriggerSnapshot, load_snapshot},
};

pub const TRIGGER_KEY_PREFIX: &str = "/workflow_http_trigger/";

pub async fn notify_local(trigger_id: &str) -> Result<(), anyhow::Error> {
    get_coordinator()
        .await
        .put(
            &format!("{TRIGGER_KEY_PREFIX}{trigger_id}"),
            Bytes::new(),
            NEED_WATCH,
            None,
        )
        .await?;
    Ok(())
}

/// Evicts a trigger whose rows are gone, then drops its key so the coordinator does not keep it.
pub async fn forget_local(trigger_id: &str) -> Result<(), anyhow::Error> {
    notify_local(trigger_id).await?;
    get_coordinator()
        .await
        .delete_if_exists(
            &format!("{TRIGGER_KEY_PREFIX}{trigger_id}"),
            false,
            NEED_WATCH,
        )
        .await?;
    Ok(())
}

pub async fn emit_snapshot(trigger_id: &str) -> Result<(), anyhow::Error> {
    notify_local(trigger_id).await?;
    if !super_cluster_enabled() {
        return Ok(());
    }
    match load_snapshot(trigger_id).await? {
        Some(snapshot) => emit_prepared(&snapshot).await,
        None => Ok(()),
    }
}

/// Publishes a snapshot built by the caller, for org delete whose rows are gone before any reload.
pub async fn emit_prepared(snapshot: &TriggerSnapshot) -> Result<(), anyhow::Error> {
    if !super_cluster_enabled() {
        return Ok(());
    }
    let trigger_id = snapshot.trigger.id.as_str();
    let sent =
        o2_enterprise::enterprise::super_cluster::queue::send_workflow_http_trigger_snapshot(
            trigger_id,
            serde_json::to_string(snapshot)?,
        )
        .await;
    if let Err(e) = &sent {
        log::error!(
            "[WORKFLOW_HOOK] snapshot emit failed for key /workflow_http_triggers/{trigger_id}: {e}"
        );
    }
    sent
}

fn super_cluster_enabled() -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
}
