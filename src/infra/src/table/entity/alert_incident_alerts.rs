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
    /// service_discovery, manual_extraction, temporal
    pub correlation_reason: Option<String>,
    pub created_at: i64,
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
