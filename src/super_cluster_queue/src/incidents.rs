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
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Create incident org={org_id} key_type={key_type}"
            );
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
                "internal",
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
            onset,
        } => {
            log::debug!(
                "[SUPER_CLUSTER:incidents] Resolve alert org={org_id} incident={incident_id} alert={alert_id}"
            );
            // An older node sends no onset, and then every open firing of the alert resolves.
            let (id, alert) = (&incident_id, &alert_id);
            alert_incidents::resolve_firings_fired_by(id, alert, onset, resolved_at).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use infra::table::entity::{alert_incident_alerts, alert_incidents as incident_rows};
    use sea_orm::{ConnectionTrait, Schema};

    use super::*;

    const ONSET: i64 = 1_793_784_600_000_000;
    const LATER: i64 = ONSET + 3_600_000_000;
    const RECOVERED: i64 = ONSET + 1_800_000_000;

    /// The meta store the consumer writes through: SQLite, or Postgres when `ZO_META_STORE` says.
    async fn meta_store() {
        static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        TABLES
            .get_or_init(|| async {
                std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
                let conn = infra::db::get_orm_client_rw().await;
                let backend = conn.get_database_backend();
                let schema = Schema::new(backend);
                for mut table in [
                    schema.create_table_from_entity(incident_rows::Entity),
                    schema.create_table_from_entity(alert_incident_alerts::Entity),
                ] {
                    conn.execute(backend.build(table.if_not_exists()))
                        .await
                        .unwrap();
                }
            })
            .await;
        let store = std::env::var("ZO_META_STORE").unwrap_or_default();
        eprintln!(
            "meta store: {}",
            if store.is_empty() { "sqlite" } else { &store }
        );
    }

    /// An incident holding two firings of one finding: at its onset, and one an hour later.
    async fn incident_with_a_later_firing(org: &str) -> String {
        let incident =
            alert_incidents::create(org, "P2", serde_json::json!({}), "AlertId", ONSET, None)
                .await
                .unwrap();
        for fired_at in [ONSET, LATER] {
            alert_incidents::add_alert_to_incident(
                &incident.id,
                "stream-silence-checkout",
                "checkout (logs) stopped sending data",
                "internal",
                fired_at,
                "same alert",
            )
            .await
            .unwrap();
        }
        incident.id
    }

    async fn resolved_by_firing(incident_id: &str) -> Vec<(i64, Option<i64>)> {
        let mut links: Vec<_> = alert_incidents::get_incident_alerts_rw(incident_id)
            .await
            .unwrap()
            .into_iter()
            .map(|link| (link.alert_fired_at, link.resolved_at))
            .collect();
        links.sort();
        links
    }

    fn resolve(incident_id: &str, onset: Option<i64>) -> IncidentMessage {
        IncidentMessage::ResolveAlert {
            org_id: "demo-org".to_string(),
            incident_id: incident_id.to_string(),
            alert_id: "stream-silence-checkout".to_string(),
            resolved_at: RECOVERED,
            onset,
        }
    }

    #[tokio::test]
    async fn a_remote_resolve_with_an_onset_keeps_a_later_firing_open_and_one_without_resolves_all()
    {
        meta_store().await;
        let with_onset = incident_with_a_later_firing("demo-org").await;
        process_msg(resolve(&with_onset, Some(ONSET)))
            .await
            .unwrap();
        assert_eq!(
            resolved_by_firing(&with_onset).await,
            vec![(ONSET, Some(RECOVERED)), (LATER, None)],
            "a firing that joined after the onset is another episode and stays open"
        );

        let from_an_older_node = incident_with_a_later_firing("demo-org").await;
        process_msg(resolve(&from_an_older_node, None))
            .await
            .unwrap();
        assert_eq!(
            resolved_by_firing(&from_an_older_node).await,
            vec![(ONSET, Some(RECOVERED)), (LATER, Some(RECOVERED))],
            "without an onset every open firing of the alert resolves, as before"
        );
    }
}
