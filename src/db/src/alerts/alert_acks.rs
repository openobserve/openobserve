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

//! Ack writes that replicate (R-125); receivers apply through `infra`, so nothing re-broadcasts.

use config::meta::alerts::ack::AlertAck;
use infra::errors::Result;

/// Writes the ack with its outbox bump, then replicates the row.
pub async fn put(ack: &AlertAck) -> Result<u64> {
    let bumped = infra::table::alert_acks::put_with_outbox(ack).await?;
    publish(ack).await;
    Ok(bumped)
}

/// Writes the ack unless another one is in force on that firing; false when it lost.
pub async fn claim(ack: &AlertAck) -> Result<bool> {
    let won = infra::table::alert_acks::claim_with_outbox(ack)
        .await?
        .is_some();
    if won {
        publish(ack).await;
    }
    Ok(won)
}

/// Unacks the firing; on a change, replicates the row as it now stands.
pub async fn unack(
    org_id: &str,
    alert_id: &str,
    group_key: &str,
    firing_started_at: i64,
    unacked_by: &str,
    unacked_at: i64,
) -> Result<Option<AlertAck>> {
    if !infra::table::alert_acks::unack_with_outbox(
        org_id,
        alert_id,
        group_key,
        firing_started_at,
        unacked_by,
        unacked_at,
    )
    .await?
    {
        return Ok(None);
    }
    let row = infra::table::alert_acks::get(org_id, alert_id, group_key).await?;
    if let Some(row) = row.as_ref() {
        publish(row).await;
    }
    Ok(row)
}

#[cfg(feature = "enterprise")]
async fn publish(ack: &AlertAck) {
    if !o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        return;
    }
    if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::alert_acks_put(ack).await {
        log::error!(
            "[SUPER_CLUSTER:sync] Failed to publish the ack of {}/{}: {e}",
            ack.alert_id,
            ack.group_key
        );
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish(_ack: &AlertAck) {}
