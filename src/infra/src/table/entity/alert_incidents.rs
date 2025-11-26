// Copyright 2025 OpenObserve Inc.
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

//! `SeaORM` Entity for alert_incidents table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "alert_incidents")]
pub struct Model {
    /// Incident ID (KSUID, primary key)
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,

    /// Organization ID
    pub org_id: String,

    /// Incident status: 'open', 'acknowledged', 'resolved'
    pub status: String,

    /// When the incident was created (microseconds)
    pub created_at: i64,

    /// When the incident was last updated (microseconds)
    pub updated_at: i64,

    /// When the incident was resolved (microseconds, nullable)
    pub resolved_at: Option<i64>,

    /// Canonical dimensions extracted from semantic groups (JSON)
    /// Example: {"service": "api", "host": "prod-1"}
    pub canonical_dimensions: Json,

    /// Number of alerts in this incident
    pub alert_count: i32,

    /// Number of alerts added via temporal fallback only
    pub temporal_only_count: i32,

    /// Primary correlation type: 'semantic_fields', 'mixed', 'temporal_only'
    pub primary_correlation_type: Option<String>,

    /// Correlation confidence: 'high', 'medium', 'low'
    pub correlation_confidence: Option<String>,

    /// Root cause analysis (optional, for future RCA)
    pub root_cause: Option<String>,

    /// Recommended actions (JSON, optional)
    pub recommended_actions: Option<Json>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::alert_incident_alerts::Entity")]
    AlertIncidentAlerts,
}

impl Related<super::alert_incident_alerts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AlertIncidentAlerts.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_model_creation() {
        let model = Model {
            incident_id: "incident_123".to_string(),
            org_id: "org_456".to_string(),
            status: "open".to_string(),
            created_at: 1234567890_000000,
            updated_at: 1234567890_000000,
            resolved_at: None,
            canonical_dimensions: json!({"service": "api", "host": "prod-1"}),
            alert_count: 3,
            temporal_only_count: 1,
            primary_correlation_type: Some("semantic_fields".to_string()),
            correlation_confidence: Some("high".to_string()),
            root_cause: None,
            recommended_actions: None,
        };

        assert_eq!(model.incident_id, "incident_123");
        assert_eq!(model.org_id, "org_456");
        assert_eq!(model.status, "open");
        assert_eq!(model.alert_count, 3);
        assert_eq!(model.temporal_only_count, 1);
    }
}
