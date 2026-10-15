// Copyright 2026 OpenObserve Inc.
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
use o2_enterprise::enterprise::super_cluster::queue::{
    IncidentMessage, IncidentUnmuteMessage, Message,
};

/// The kind an `AddAlert` from a region that predates `alert_kind` stands for.
const DEFAULT_ALERT_KIND: &str = "internal";

pub(crate) async fn process(msg: Message) -> Result<()> {
    let msg = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[INCIDENTS] Failed to deserialize: {e}"))
    })?;
    process_msg(msg).await
}

pub(crate) async fn process_unmute(msg: Message) -> Result<()> {
    let IncidentUnmuteMessage {
        org_id,
        incident_id,
    } = msg.try_into().map_err(|e| {
        infra::errors::Error::Message(format!("[INCIDENTS] Failed to deserialize unmute: {e}"))
    })?;
    log::debug!("[SUPER_CLUSTER:incidents] Unmute org={org_id} id={incident_id}");
    // The primary, not a lagging replica: a missing incident redelivers until its Create lands.
    let Some(incident) = alert_incidents::get_rw(&org_id, &incident_id).await? else {
        return Err(infra::errors::Error::Message(format!(
            "[INCIDENTS] unmute for {org_id}/{incident_id} arrived before the incident; retrying"
        )));
    };
    if let Some(downtime_id) = incident.muted_by_downtime_id {
        alert_incidents::clear_muted_by_downtime_id(&org_id, &incident_id, &downtime_id).await?;
    }
    Ok(())
}

pub(crate) async fn process_msg(msg: IncidentMessage) -> Result<()> {
    match msg {
        IncidentMessage::Create {
            org_id,
            correlation_key: key_type,
            severity,
            stable_dimensions: group_values,
            first_alert_at,
            title,
            muted_by_downtime_id,
            incident_id,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Create incident org={org_id} key_type={key_type} id={incident_id:?}"
            );
            // A sender that predates the id gets a local one, as before.
            let Some(incident_id) = incident_id else {
                alert_incidents::create_with_mute(
                    &org_id,
                    &severity,
                    group_values,
                    &key_type,
                    first_alert_at,
                    title,
                    muted_by_downtime_id,
                )
                .await?;
                return Ok(());
            };
            if !alert_incidents::create_with_id(
                &incident_id,
                &org_id,
                &severity,
                group_values,
                &key_type,
                first_alert_at,
                title,
                muted_by_downtime_id,
            )
            .await?
            {
                log::debug!(
                    "[SUPER_CLUSTER:incidents] incident {org_id}/{incident_id} already exists; create skipped"
                );
            }
        }
        IncidentMessage::UpdateStatus {
            org_id,
            incident_id,
            status,
            actor,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Update status org={org_id} id={incident_id} status={status}"
            );
            apply_status(&org_id, &incident_id, &status, actor.as_deref()).await?;
        }
        IncidentMessage::AddAlert {
            org_id,
            incident_id,
            alert_id,
            alert_name,
            alert_fired_at,
            correlation_reason,
            alert_kind,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Add alert to org_id={org_id} incident id={incident_id} alert={alert_id}",
            );
            alert_incidents::add_alert_to_incident(
                &incident_id,
                &alert_id,
                &alert_name,
                alert_kind.as_deref().unwrap_or(DEFAULT_ALERT_KIND),
                alert_fired_at,
                &correlation_reason,
            )
            .await?;
        }
        IncidentMessage::ResolveAlert {
            org_id,
            incident_id,
            alert_id,
            resolved_at,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Resolve alert org={org_id} incident={incident_id} alert={alert_id}"
            );
            alert_incidents::resolve_alert_firings(&incident_id, &alert_id, resolved_at).await?;
        }
    }
    Ok(())
}

/// An acknowledgement takes the guarded path so the replica's row names who acknowledged it.
async fn apply_status(
    org_id: &str,
    incident_id: &str,
    status: &str,
    actor: Option<&str>,
) -> Result<()> {
    let Some(actor) = actor.filter(|_| status == "acknowledged") else {
        alert_incidents::update_status(org_id, incident_id, status).await?;
        return Ok(());
    };
    if alert_incidents::acknowledge(org_id, incident_id, actor)
        .await?
        .is_none()
    {
        return Err(infra::errors::Error::Message(format!(
            "[INCIDENTS] acknowledge for {org_id}/{incident_id} arrived before the incident; retrying"
        )));
    }
    Ok(())
}
