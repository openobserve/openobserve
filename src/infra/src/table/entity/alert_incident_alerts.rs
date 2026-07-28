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

//! `SeaORM` Entity for alert_incident_alerts junction table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_incident_alerts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_fired_at: i64,

    pub alert_name: String,
    /// service_discovery, trace_based, scope_match, workload_match, alert_id
    pub correlation_reason: Option<String>,
    pub created_at: i64,
    /// Originating system for alerts pushed in over the external ingest
    /// webhook (e.g. "alertmanager", "datadog"). `None` for native
    /// OpenObserve alerts, which are resolvable from the `alerts` table.
    pub source: Option<String>,
    /// Deep link back into the originating system.
    pub external_url: Option<String>,
    /// Free-form annotations from the originating system, stored as a JSON
    /// object. Display only — never used for correlation.
    pub annotations: Option<String>,
    /// When the originating system reported this alert resolved.
    pub resolved_at: Option<i64>,
    /// Idempotency key supplied by the sender, used to recognise a redelivery
    /// of the same firing. Kept here rather than in `alert_dedup_state`, whose
    /// `alert_id` carries a foreign key to `alerts` that an externally-ingested
    /// alert can never satisfy.
    pub dedup_key: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::alert_incidents::Entity",
        from = "Column::IncidentId",
        to = "super::alert_incidents::Column::Id"
    )]
    Incident,
}

impl Related<super::alert_incidents::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Incident.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let m = Model {
            incident_id: "inc-1".to_string(),
            alert_id: "alert-1".to_string(),
            alert_fired_at: 1000,
            alert_name: "High Error Rate".to_string(),
            correlation_reason: Some("service_discovery".to_string()),
            created_at: 1000,
            source: None,
            external_url: None,
            annotations: None,
            resolved_at: None,
            dedup_key: None,
        };
        assert_eq!(m.incident_id, "inc-1");
        assert_eq!(m.alert_id, "alert-1");
        assert_eq!(m.alert_fired_at, 1000);
        assert_eq!(m.alert_name, "High Error Rate");
        assert!(m.correlation_reason.is_some());
        assert!(m.source.is_none(), "native alerts carry no source");
    }

    #[test]
    fn test_external_model_construction() {
        let m = Model {
            incident_id: "inc-1".to_string(),
            alert_id: "ext-alert-1".to_string(),
            alert_fired_at: 1000,
            alert_name: "HighErrorRate".to_string(),
            correlation_reason: Some("primary_match".to_string()),
            created_at: 1000,
            source: Some("alertmanager".to_string()),
            external_url: Some("https://alertmanager.example.com/#/alerts".to_string()),
            annotations: Some(r#"{"summary":"error rate above 5%"}"#.to_string()),
            resolved_at: None,
            dedup_key: None,
        };
        assert_eq!(m.source.as_deref(), Some("alertmanager"));
        assert!(m.external_url.is_some());
    }
}
