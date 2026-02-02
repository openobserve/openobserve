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

//! `SeaORM` Entity for alert_dedup_state table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_dedup_state")]
pub struct Model {
    /// Fingerprint hash (primary key)
    #[sea_orm(primary_key, auto_increment = false)]
    pub fingerprint: String,
    /// Alert ID reference
    pub alert_id: String,
    /// Organization ID
    pub org_id: String,
    /// First time this fingerprint was seen (microseconds)
    pub first_seen_at: i64,
    /// Last time this fingerprint was seen (microseconds)
    pub last_seen_at: i64,
    /// Number of occurrences
    pub occurrence_count: i64,
    /// Whether notification was sent
    pub notification_sent: bool,
    /// Created timestamp (microseconds)
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::alerts::Entity",
        from = "Column::AlertId",
        to = "super::alerts::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Alerts,
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
            fingerprint: "test_fingerprint_123".to_string(),
            alert_id: "alert_id_456".to_string(),
            org_id: "org_123".to_string(),
            first_seen_at: 1234567890_000000,
            last_seen_at: 1234567890_000000,
            occurrence_count: 1,
            notification_sent: false,
            created_at: 1234567890_000000,
        };

        assert_eq!(model.fingerprint, "test_fingerprint_123");
        assert_eq!(model.alert_id, "alert_id_456");
        assert_eq!(model.org_id, "org_123");
        assert_eq!(model.occurrence_count, 1);
        assert!(!model.notification_sent);
    }
}
