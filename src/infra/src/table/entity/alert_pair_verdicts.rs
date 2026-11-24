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

//! `SeaORM` Entity for alert_pair_verdicts: the per-org memory of an (opener, joiner) alert pair.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "alert_pair_verdicts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    /// The lesser alert id of the unordered pair.
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_a: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_b: String,
    /// related, or separate once the alert moved out
    pub verdict: String,
    #[sea_orm(column_type = "Text")]
    pub reason: String,
    /// rule or ai
    pub decided_by: String,
    pub signal: Option<String>,
    pub expires_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
