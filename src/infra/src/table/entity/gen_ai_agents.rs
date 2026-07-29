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

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "gen_ai_agents")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub agent_key: String,
    pub org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub env: Option<String>,
    pub agent_version: Option<String>,
    pub identity_source: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let model = Model {
            agent_key: "k".to_string(),
            org_id: "org".to_string(),
            stream_type: "traces".to_string(),
            stream_name: "default".to_string(),
            agent_id: Some("agent-1".to_string()),
            agent_name: Some("support".to_string()),
            env: Some("production".to_string()),
            agent_version: Some("1.2.0".to_string()),
            identity_source: "agent_id".to_string(),
            first_seen: 10,
            last_seen: 20,
            created_at: 30,
            updated_at: 40,
        };

        assert_eq!(model.agent_id.as_deref(), Some("agent-1"));
        assert_eq!(model.stream_type, "traces");
    }
}
