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
#[sea_orm(table_name = "online_eval_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub description: Option<String>,
    pub stream: String,
    pub stream_type: String,
    pub target_scope: String,
    pub filter_condition: Json,
    pub scorers: Json,
    pub input_mapping: Option<Json>,
    pub span_selectors: Option<Json>,
    pub span_selector_bindings: Option<Json>,
    pub trace_config: Option<Json>,
    pub session_config: Option<Json>,
    pub sampling_mode: String,
    pub sampling_value: Json,
    pub status: String,
    pub version: i32,
    pub pipeline_id: Option<String>,
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
        let m = Model {
            id: "job-1".to_string(),
            org_id: "org".to_string(),
            name: "qa-eval".to_string(),
            description: Some("Evaluate QA pipeline traces".to_string()),
            stream: "production-logs".to_string(),
            stream_type: "traces".to_string(),
            target_scope: "span".to_string(),
            filter_condition: serde_json::json!({
                "type": "custom",
                "conditions": [
                    {"field": "service.name", "operator": "eq", "value": "rag-service"}
                ]
            }),
            scorers: serde_json::json!(["faithfulness_judge", "toxicity_check"]),
            input_mapping: None,
            span_selectors: None,
            span_selector_bindings: None,
            trace_config: None,
            session_config: None,
            sampling_mode: "rate".to_string(),
            sampling_value: serde_json::json!({"rate": 0.1}),
            status: "draft".to_string(),
            version: 1,
            pipeline_id: None,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.org_id, "org");
        assert_eq!(m.status, "draft");
        assert_eq!(m.version, 1);
        assert_eq!(m.sampling_mode, "rate");
    }
}
