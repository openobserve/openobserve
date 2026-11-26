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

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, Default, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "incident_recovery_checks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub incident_id: String,
    pub attempt_id: String,
    pub source: String,
    pub source_ref: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub target: String,
    #[sea_orm(column_type = "Text")]
    pub measure: String,
    pub baseline_volume: Option<f64>,
    pub volume_floor_pct: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub scope: Option<String>,
    pub comparator: String,
    pub alert_threshold: f64,
    pub recover_threshold: f64,
    pub baseline: Option<f64>,
    pub pass_window_secs: i32,
    pub passes: i32,
    pub pass_started_at: Option<i64>,
    pub flap_period_secs: Option<i32>,
    pub soak_secs: i32,
    pub state: String,
    pub state_reason: Option<String>,
    pub trigger_at: i64,
    pub expect_effect_secs: i32,
    pub effect_from_at: i64,
    pub deadline_at: i64,
    pub verified_at: Option<i64>,
    pub soak_until: Option<i64>,
    pub last_value: Option<f64>,
    pub last_checked_at: Option<i64>,
    #[sea_orm(column_type = "Text")]
    pub recent_samples: String,
    pub created_by: String,
    pub generation: i64,
    pub deleted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
