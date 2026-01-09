// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Super-cluster queue processor for incident synchronization.
//!
//! Synchronizes alert correlation incidents across regions including:
//! - Incident creation with correlation keys
//! - Status updates (open/acknowledged/resolved)
//! - Alert additions to existing incidents
//!
//! Idempotency: Checks for existing incidents before creation to prevent duplicates.

use infra::{errors::Result, table::alert_incidents};
use o2_enterprise::enterprise::super_cluster::queue::{IncidentMessage, Message};

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[INCIDENTS] Failed to deserialize: {e}"))
    })?;
    process_msg(msg).await
}

pub(crate) async fn process_msg(msg: IncidentMessage) -> Result<()> {
    match msg {
        IncidentMessage::Create {
            org_id,
            correlation_key,
            severity,
            stable_dimensions,
            first_alert_at,
            title,
        } => {
            if alert_incidents::find_open_by_correlation_key(&org_id, &correlation_key)
                .await?
                .is_some()
            {
                log::debug!(
                    "[SUPER_CLUSTER:incidents] Incident already exists org={org_id} key={correlation_key}"
                );
                return Ok(());
            }
            log::debug!(
                "[SUPER_CLUSTER:incidents] Create incident org={org_id}  key={correlation_key}"
            );
            alert_incidents::create(
                &org_id,
                &correlation_key,
                &severity,
                stable_dimensions,
                first_alert_at,
                title,
            )
            .await?;
        }
        IncidentMessage::UpdateStatus {
            org_id,
            incident_id,
            status,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Update status org={org_id} id={incident_id} status={status}"
            );
            alert_incidents::update_status(&org_id, &incident_id, &status).await?;
        }
        IncidentMessage::AddAlert {
            org_id,
            incident_id,
            alert_id,
            alert_name,
            alert_fired_at,
            correlation_reason,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Add alert to org_id={org_id} incident id={incident_id} alert={alert_id}",
            );
            alert_incidents::add_alert_to_incident(
                &incident_id,
                &alert_id,
                &alert_name,
                alert_fired_at,
                &correlation_reason,
            )
            .await?;
        }
    }
    Ok(())
}
