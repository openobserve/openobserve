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

//! Schema validation and column-name selection for GenAI trace streams.
//!
//! OpenObserve's GenAI observability handlers adhere to the OTEL GenAI semantic
//! convention field names (`gen_ai_*`, `user.id`, `gen_ai_conversation_id`).

use std::fmt;

use arrow_schema::Schema;

use crate::service::traces::otel::attributes::OtelAttributes;

/// Required fields for GenAI trace streams. If any are missing, the query is
/// rejected with a clear error.
pub(crate) const REQUIRED_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_usage_input_tokens",
    "gen_ai_usage_output_tokens",
    "gen_ai_usage_cost",
    "gen_ai_response_model",
];

/// Optional fields for GenAI trace streams. Missing optional fields produce
/// `None` in the API response; the column is omitted from SQL.
pub(crate) const OPTIONAL_GEN_AI_FIELDS: &[&str] = &[
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

/// Column names used by GenAI trace streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct LlmColumns {
    /// Per-trace conversation/session identifier.
    pub(super) session_id: &'static str,
    /// Per-trace user identifier.
    pub(super) user_id: &'static str,
}

impl LlmColumns {
    pub(super) const fn current() -> Self {
        Self {
            session_id: "gen_ai_conversation_id",
            user_id: OtelAttributes::USER_ID,
        }
    }
}

/// Validated schema metadata for an LLM trace stream.
///
/// Produced by [`validate_llm_schema`], this struct carries:
/// - the column-name layout (session_id, user_id)
/// - which optional fields are actually present
///
/// Callers use this to build SQL queries that reference only columns that
/// truly exist, and to decide whether to omit optional fields from the
/// API response.
#[derive(Debug, Clone)]
pub(super) struct ValidatedLlmSchema {
    pub(super) columns: LlmColumns,
    pub(super) has_input_messages: bool,
    #[allow(dead_code)]
    pub(super) has_output_messages: bool,
    pub(super) has_total_tokens: bool,
    pub(super) has_cache_read_input_tokens: bool,
    pub(super) has_cache_creation_input_tokens: bool,
    pub(super) has_cost_cache_read_input: bool,
    pub(super) has_cost_cache_creation_input: bool,
    pub(super) has_cost_estimated_without_cache: bool,
    pub(super) has_cost_cache_read_savings: bool,
    pub(super) has_cost_net_cache_impact: bool,
}

impl ValidatedLlmSchema {
    /// Create a default fallback when no cached schema is available.
    ///
    /// Assumes required fields are present (the stream was marked LLM) and
    /// marks optional fields as absent to avoid referencing unknown columns.
    pub(super) fn fallback() -> Self {
        Self {
            columns: LlmColumns::current(),
            has_input_messages: false,
            has_output_messages: false,
            has_total_tokens: false,
            has_cache_read_input_tokens: false,
            has_cache_creation_input_tokens: false,
            has_cost_cache_read_input: false,
            has_cost_cache_creation_input: false,
            has_cost_estimated_without_cache: false,
            has_cost_cache_read_savings: false,
            has_cost_net_cache_impact: false,
        }
    }
}

/// Error returned when a required GenAI field is missing from the stream schema.
#[derive(Debug)]
pub(super) struct LlmSchemaError {
    pub field_name: &'static str,
    pub stream_name: String,
}

impl fmt::Display for LlmSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Missing required GenAI field '{}' in stream '{}'",
            self.field_name, self.stream_name
        )
    }
}

/// Validate that an LLM stream's schema has all required GenAI fields.
///
/// Returns an error if any required GenAI field is missing. Optional fields are
/// reported so callers can omit them from SQL when absent.
pub(super) fn validate_llm_schema(
    schema: &Schema,
    stream_name: &str,
) -> Result<ValidatedLlmSchema, LlmSchemaError> {
    for &field in REQUIRED_GEN_AI_FIELDS {
        if schema.field_with_name(field).is_err() {
            return Err(LlmSchemaError {
                field_name: field,
                stream_name: stream_name.to_string(),
            });
        }
    }

    let has_input_messages = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[0]).is_ok();
    let has_output_messages = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[1]).is_ok();
    let has_total_tokens = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[2]).is_ok();
    let has_cache_read_input_tokens = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[3]).is_ok();
    let has_cache_creation_input_tokens = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[4]).is_ok();
    let has_cost_cache_read_input = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[5]).is_ok();
    let has_cost_cache_creation_input = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[6]).is_ok();
    let has_cost_estimated_without_cache =
        schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[7]).is_ok();
    let has_cost_cache_read_savings = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[8]).is_ok();
    let has_cost_net_cache_impact = schema.field_with_name(OPTIONAL_GEN_AI_FIELDS[9]).is_ok();

    Ok(ValidatedLlmSchema {
        columns: LlmColumns::current(),
        has_input_messages,
        has_output_messages,
        has_total_tokens,
        has_cache_read_input_tokens,
        has_cache_creation_input_tokens,
        has_cost_cache_read_input,
        has_cost_cache_creation_input,
        has_cost_estimated_without_cache,
        has_cost_cache_read_savings,
        has_cost_net_cache_impact,
    })
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};

    use super::*;

    fn schema_with(fields: &[&str]) -> Schema {
        let fields: Vec<Field> = fields
            .iter()
            .map(|n| Field::new(*n, DataType::Utf8, true))
            .collect();
        Schema::new(fields)
    }

    #[test]
    fn current_layout_uses_gen_ai_columns() {
        let cols = LlmColumns::current();
        assert_eq!(cols.session_id, "gen_ai_conversation_id");
        // user.id is the OTEL attribute name — the search layer resolves it
        // to the flattened column.
        assert_eq!(cols.user_id, OtelAttributes::USER_ID);
        assert_eq!(cols.user_id, "user.id");
    }

    #[test]
    fn valid_gen_ai_schema_passes_validation() {
        let schema = schema_with(&[
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_cost",
            "gen_ai_response_model",
            "gen_ai_conversation_id",
            "gen_ai_input_messages",
            "gen_ai_output_messages",
        ]);
        let result = validate_llm_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert_eq!(v.columns, LlmColumns::current());
        assert!(v.has_input_messages);
        assert!(v.has_output_messages);
    }

    #[test]
    fn missing_required_gen_ai_field_returns_error() {
        // Missing gen_ai_usage_cost
        let schema = schema_with(&[
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_response_model",
        ]);
        let result = validate_llm_schema(&schema, "my_stream");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.field_name, "gen_ai_usage_cost");
        assert_eq!(err.stream_name, "my_stream");
        assert!(err.to_string().contains("gen_ai_usage_cost"));
        assert!(err.to_string().contains("my_stream"));
    }

    #[test]
    fn optional_gen_ai_fields_missing_are_reported_as_absent() {
        // All required fields present, but no optional fields
        let schema = schema_with(&[
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_cost",
            "gen_ai_response_model",
        ]);
        let result = validate_llm_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert!(!v.has_input_messages);
        assert!(!v.has_output_messages);
    }

    #[test]
    fn fallback_assumes_required_present_optional_absent() {
        let fallback = ValidatedLlmSchema::fallback();
        assert_eq!(fallback.columns, LlmColumns::current());
        assert!(!fallback.has_input_messages);
        assert!(!fallback.has_output_messages);
    }
}
