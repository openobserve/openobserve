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

/// Sentinel column whose presence indicates the new `gen_ai_*` schema.
pub const GEN_AI_SENTINEL_COLUMN: &str = "gen_ai_usage_input_tokens";

/// Required fields for the new (gen_ai_*) schema. If any are missing, the
/// query is rejected with a clear error.
pub const REQUIRED_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_usage_input_tokens",
    "gen_ai_usage_output_tokens",
    "gen_ai_usage_cost",
    "gen_ai_response_model",
];

/// Optional fields for the new (gen_ai_*) schema. Missing optional fields
/// produce `None` in the API response; the column is omitted from SQL.
pub const OPTIONAL_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_input_messages",
    "gen_ai_output_messages",
    "gen_ai_usage_total_tokens",
    "gen_ai_usage_cache_read_input_tokens",
    "gen_ai_usage_cache_creation_input_tokens",
    "gen_ai_usage_cost_cache_read_input",
    "gen_ai_usage_cost_cache_creation_input",
    "gen_ai_usage_cost_estimated_without_cache",
    "gen_ai_usage_cost_cache_read_savings",
    "gen_ai_usage_cost_net_cache_impact",
];

/// Required fields for the legacy (llm_*) schema.
pub const REQUIRED_LLM_FIELDS: &[&str] = &[
    "llm_usage_tokens_input",
    "llm_usage_tokens_output",
    "llm_usage_cost_total",
    "llm_model_name",
];

/// Optional fields for the legacy (llm_*) schema.
pub const OPTIONAL_LLM_FIELDS: &[&str] = &["llm_input", "llm_output", "llm_usage_tokens_total"];

pub mod session {
    use std::collections::HashSet;

    use arrow_schema::Schema;
    use serde_json::Value;

    use crate::TIMESTAMP_COL_NAME;

    pub const SESSION_ID_COLUMNS: &[&str] = &[
        "session_id",
        "gen_ai_conversation_id",
        "llm_session_id",
        "gen_ai.conversation.id",
    ];

    pub fn session_id_columns(schema: &Schema) -> Vec<String> {
        SESSION_ID_COLUMNS
            .iter()
            .filter(|column| schema.field_with_name(column).is_ok())
            .map(|column| (*column).to_string())
            .collect()
    }

    pub fn trace_ids_sql(stream: &str, session_columns: &[String], session_id: &str) -> String {
        let escaped_session_id = escape_sql_string(session_id);
        let predicate = session_columns
            .iter()
            .map(|column| format!("{} = '{}'", quote_identifier(column), escaped_session_id))
            .collect::<Vec<_>>()
            .join(" OR ");
        format!(
            "SELECT trace_id, min({}) as zo_sql_timestamp \
             FROM {} \
             WHERE ({predicate}) \
             GROUP BY trace_id \
             ORDER BY zo_sql_timestamp DESC, trace_id ASC",
            quote_identifier(TIMESTAMP_COL_NAME),
            quote_identifier(stream),
        )
    }

    pub fn trace_ids_from_hits(hits: &[Value]) -> Vec<String> {
        let mut seen = HashSet::with_capacity(hits.len());
        let mut trace_ids = Vec::with_capacity(hits.len());
        for hit in hits {
            let Some(trace_id) = hit.get("trace_id").and_then(Value::as_str) else {
                continue;
            };
            if trace_id.trim().is_empty() || !seen.insert(trace_id.to_string()) {
                continue;
            }
            trace_ids.push(trace_id.to_string());
        }
        trace_ids
    }

    pub fn trace_id_predicate(trace_ids: &[String]) -> String {
        let values = trace_ids
            .iter()
            .map(|trace_id| format!("'{}'", escape_sql_string(trace_id)))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{} IN ({values})", quote_identifier("trace_id"))
    }

    pub fn span_rows_sql(stream: &str, trace_ids: &[String]) -> String {
        format!(
            "SELECT * FROM {} WHERE {} ORDER BY {} ASC, _o2_ingest_ts ASC, trace_id ASC, span_id ASC",
            quote_identifier(stream),
            trace_id_predicate(trace_ids),
            quote_identifier(TIMESTAMP_COL_NAME),
        )
    }

    pub fn quote_identifier(value: &str) -> String {
        format!("\"{}\"", value.replace('"', "\"\""))
    }

    pub fn escape_sql_string(value: &str) -> String {
        value.replace('\'', "''")
    }

    #[cfg(test)]
    mod tests {
        use arrow_schema::{DataType, Field};
        use serde_json::json;

        use super::*;

        #[test]
        fn resolves_all_supported_columns_in_mixed_schema() {
            let schema = Schema::new(vec![
                Field::new("gen_ai_conversation_id", DataType::Utf8, true),
                Field::new("llm_session_id", DataType::Utf8, true),
            ]);

            assert_eq!(
                session_id_columns(&schema),
                vec![
                    "gen_ai_conversation_id".to_string(),
                    "llm_session_id".to_string()
                ]
            );
        }

        #[test]
        fn phase_one_uses_exact_identity_across_supported_columns() {
            let sql = trace_ids_sql(
                "traces",
                &[
                    "gen_ai_conversation_id".to_string(),
                    "llm_session_id".to_string(),
                ],
                "session-'1",
            );

            assert!(sql.contains("\"gen_ai_conversation_id\" = 'session-''1'"));
            assert!(sql.contains("OR \"llm_session_id\" = 'session-''1'"));
            assert!(sql.contains("GROUP BY trace_id"));
            assert!(sql.contains("ORDER BY zo_sql_timestamp DESC, trace_id ASC"));
        }

        #[test]
        fn phase_two_selects_all_rows_for_discovered_traces() {
            let sql = span_rows_sql("traces", &["abc-123".to_string(), "def-456".to_string()]);

            assert!(sql.contains("SELECT *"));
            assert!(sql.contains("\"trace_id\" IN ('abc-123', 'def-456')"));
            assert!(!sql.contains("session_id"));
            assert!(sql.contains(
                "ORDER BY \"_timestamp\" ASC, _o2_ingest_ts ASC, trace_id ASC, span_id ASC"
            ));
        }

        #[test]
        fn trace_ids_remain_exact_and_are_deduplicated() {
            let hits = vec![
                json!({"trace_id": "abc-123"}),
                json!({"trace_id": "abc-123"}),
                json!({"trace_id": "bad';drop"}),
                json!({"trace_id": " exact-with-space "}),
            ];

            assert_eq!(
                trace_ids_from_hits(&hits),
                vec!["abc-123", "bad';drop", " exact-with-space "]
            );
            assert!(trace_id_predicate(&trace_ids_from_hits(&hits)).contains("'bad'';drop'"));
        }
    }
}
