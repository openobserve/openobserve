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

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// One replayable client request, retained for a bounded window.
///
/// `scope` narrows the key's namespace so the same client-generated key can be
/// reused against a different resource: Dataset upserts scope to their Dataset,
/// Experiment creation scopes to the organization alone.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "llm_idempotency_records")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub scope: String,
    pub idempotency_key: String,
    /// Hex SHA-256 of the canonical request body. A different hash under the
    /// same key is a conflict, never a replay.
    pub request_hash: String,
    pub response: Json,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
