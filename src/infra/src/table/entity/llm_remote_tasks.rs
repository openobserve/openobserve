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

/// The version a head's single mutable draft occupies. A draft carries no
/// version number of its own, and an Experiment may only pin `version >= 1`.
pub const DRAFT_VERSION: i32 = 0;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "llm_remote_tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub entity_id: String,
    pub name: String,
    pub version: i32,
    pub description: Option<String>,
    pub endpoint: String,
    pub http_method: String,
    pub auth: Json,
    pub custom_headers: Json,
    pub content_type: String,
    pub request_template: Option<String>,
    pub response_schema: String,
    pub timeout_ms: i64,
    pub retry_policy: Json,
    pub max_concurrency: i32,
    pub signing: Json,
    pub verification_status: String,
    pub verification_error: Option<String>,
    pub verified_at: Option<i64>,
    pub draft_source_version: Option<i32>,
    pub is_active: bool,
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
    fn a_draft_sits_below_every_publishable_version() {
        assert_eq!(DRAFT_VERSION, 0);
        assert!(DRAFT_VERSION < 1);
    }

    #[test]
    fn test_model_construction() {
        let m = Model {
            id: "rt-1".to_string(),
            org_id: "org".to_string(),
            entity_id: "rtask-entity-1".to_string(),
            name: "summarizer".to_string(),
            version: 1,
            description: Some("Customer summarization endpoint".to_string()),
            endpoint: "https://tasks.example.com/run".to_string(),
            http_method: "POST".to_string(),
            auth: serde_json::json!({"type": "none"}),
            custom_headers: serde_json::json!([]),
            content_type: "application/json".to_string(),
            request_template: None,
            response_schema: "$.output".to_string(),
            timeout_ms: 60_000,
            retry_policy: serde_json::json!({"max_attempts": 3}),
            max_concurrency: 4,
            signing: serde_json::json!({"enabled": false}),
            verification_status: "verified".to_string(),
            verification_error: None,
            verified_at: Some(1000),
            draft_source_version: None,
            is_active: true,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.entity_id, "rtask-entity-1");
        assert_eq!(m.version, 1);
        assert_eq!(m.response_schema, "$.output");
        assert!(m.is_active);
    }
}
