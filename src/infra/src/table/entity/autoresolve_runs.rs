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

//! `SeaORM` Entity for the `autoresolve_runs` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "autoresolve_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub region: String,
    pub autoresolve_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub goal: String,
    /// A JSON array of the connection ids chosen at launch; every turn loads only these.
    #[sea_orm(column_type = "Text")]
    pub connection_ids: String,
    /// A JSON object of connection id to its name at launch.
    #[sea_orm(column_type = "Text")]
    pub connection_names: String,
    pub trigger_kind: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub trigger_context: Option<String>,
    pub requester: String,
    pub turn_identity: String,
    pub session_id: String,
    pub state: String,
    pub revision: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub plan: Option<String>,
    pub plan_fingerprint: Option<String>,
    pub chosen_option_id: Option<String>,
    pub approved_by: Option<String>,
    pub approved_at_us: Option<i64>,
    pub approval_channel: String,
    pub approval_deadline_us: Option<i64>,
    pub turn_deadline_us: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub slack_ref: Option<String>,
    pub outcome_verdict: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub outcome_explanation: Option<String>,
    pub prior_verdict: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    pub idempotency_key: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
    pub ended_at_us: Option<i64>,
    /// A JSON array of the correction ids the latest planning turn read.
    #[sea_orm(column_type = "Text", nullable)]
    pub plan_corrections: Option<String>,
    /// A JSON object: the person's verdict next to a snapshot of the agent's.
    #[sea_orm(column_type = "Text", nullable)]
    pub person_verdict: Option<String>,
    /// A JSON array of `{id, name, by, at_us}`, one per connection added after launch.
    #[sea_orm(column_type = "Text", nullable)]
    pub added_connections: Option<String>,
    /// When the current turn launched.
    pub turn_started_at_us: Option<i64>,
    /// When the run's check turn was retried; a run retries it once.
    pub check_retried_at_us: Option<i64>,
    /// A JSON array of every plan the agent proposed, oldest first (`PlanRevision`).
    #[sea_orm(column_type = "Text", nullable)]
    pub plan_history: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
