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

//! `SeaORM` Entity for alert_incident_alerts table (junction table)

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "alert_incident_alerts")]
pub struct Model {
    /// Incident ID reference
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,

    /// Alert ID reference
    pub alert_id: String,

    /// Unique trigger ID for this alert firing
    #[sea_orm(primary_key, auto_increment = false)]
    pub trigger_id: String,

    /// When the alert was triggered (microseconds)
    pub triggered_at: i64,

    /// When the alert was added to this incident (microseconds)
    pub added_at: i64,

    /// Match type: 'semantic_fields' or 'temporal_only'
    pub match_type: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::alert_incidents::Entity",
        from = "Column::IncidentId",
        to = "super::alert_incidents::Column::IncidentId",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    AlertIncidents,

    #[sea_orm(
        belongs_to = "super::alerts::Entity",
        from = "Column::AlertId",
        to = "super::alerts::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Alerts,
}

impl Related<super::alert_incidents::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AlertIncidents.def()
    }
}

impl Related<super::alerts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Alerts.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_creation() {
        let model = Model {
            incident_id: "incident_123".to_string(),
            alert_id: "alert_456".to_string(),
            trigger_id: "trigger_789".to_string(),
            triggered_at: 1234567890_000000,
            added_at: 1234567890_000001,
            match_type: "semantic_fields".to_string(),
        };

        assert_eq!(model.incident_id, "incident_123");
        assert_eq!(model.alert_id, "alert_456");
        assert_eq!(model.trigger_id, "trigger_789");
        assert_eq!(model.match_type, "semantic_fields");
    }
}
