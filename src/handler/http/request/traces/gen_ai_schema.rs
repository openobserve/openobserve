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

//! Schema validation and fixed column names for GenAI trace streams.
//!
//! OpenObserve's GenAI observability handlers adhere to the OTEL GenAI semantic
//! convention field names (`gen_ai_*`, `user.id`, `gen_ai_conversation_id`).

use std::fmt;

use arrow_schema::Schema;

use crate::service::traces::otel::attributes::OtelAttributes;

pub(super) const GEN_AI_SESSION_ID_COL: &str = "gen_ai_conversation_id";
pub(super) const GEN_AI_USER_ID_COL: &str = OtelAttributes::USER_ID;

const GEN_AI_INPUT_MESSAGES_COL: &str = "gen_ai_input_messages";
const GEN_AI_TOTAL_TOKENS_COL: &str = "gen_ai_usage_total_tokens";
const GEN_AI_CACHE_READ_INPUT_TOKENS_COL: &str = "gen_ai_usage_cache_read_input_tokens";
const GEN_AI_CACHE_CREATION_INPUT_TOKENS_COL: &str = "gen_ai_usage_cache_creation_input_tokens";
const GEN_AI_COST_CACHE_READ_INPUT_COL: &str = "gen_ai_usage_cost_cache_read_input";
const GEN_AI_COST_CACHE_CREATION_INPUT_COL: &str = "gen_ai_usage_cost_cache_creation_input";
const GEN_AI_COST_ESTIMATED_WITHOUT_CACHE_COL: &str = "gen_ai_usage_cost_estimated_without_cache";
const GEN_AI_COST_CACHE_READ_SAVINGS_COL: &str = "gen_ai_usage_cost_cache_read_savings";
const GEN_AI_COST_NET_CACHE_IMPACT_COL: &str = "gen_ai_usage_cost_net_cache_impact";

const REQUIRED_GEN_AI_FIELDS: &[&str] = &[
    "gen_ai_usage_input_tokens",
    "gen_ai_usage_output_tokens",
    "gen_ai_usage_cost",
    "gen_ai_response_model",
];

/// Validated schema metadata for a GenAI trace stream.
///
/// Callers use this to build SQL queries that reference only optional columns
/// that actually exist. Required fields are checked during validation.
#[derive(Debug, Clone)]
pub(super) struct GenAiSchema {
    pub(super) has_input_messages: bool,
    pub(super) has_total_tokens: bool,
    pub(super) has_cache_read_input_tokens: bool,
    pub(super) has_cache_creation_input_tokens: bool,
    pub(super) has_cost_cache_read_input: bool,
    pub(super) has_cost_cache_creation_input: bool,
    pub(super) has_cost_estimated_without_cache: bool,
    pub(super) has_cost_cache_read_savings: bool,
    pub(super) has_cost_net_cache_impact: bool,
}

impl GenAiSchema {
    /// Create a default fallback when no cached schema is available.
    ///
    /// Assumes required fields are present (the stream was marked GenAI) and
    /// marks optional fields as absent to avoid referencing unknown columns.
    pub(super) fn fallback() -> Self {
        Self {
            has_input_messages: false,
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
pub(super) struct GenAiSchemaError {
    pub field_name: &'static str,
    pub stream_name: String,
}

impl fmt::Display for GenAiSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Missing required GenAI field '{}' in stream '{}'",
            self.field_name, self.stream_name
        )
    }
}

/// Validate that a stream's schema has all required GenAI fields.
///
/// Returns an error if any required GenAI field is missing. Optional fields are
/// reported so callers can omit them from SQL when absent.
pub(super) fn validate_gen_ai_schema(
    schema: &Schema,
    stream_name: &str,
) -> Result<GenAiSchema, GenAiSchemaError> {
    for &field in REQUIRED_GEN_AI_FIELDS {
        if schema.field_with_name(field).is_err() {
            return Err(GenAiSchemaError {
                field_name: field,
                stream_name: stream_name.to_string(),
            });
        }
    }

    Ok(GenAiSchema {
        has_input_messages: has_field(schema, GEN_AI_INPUT_MESSAGES_COL),
        has_total_tokens: has_field(schema, GEN_AI_TOTAL_TOKENS_COL),
        has_cache_read_input_tokens: has_field(schema, GEN_AI_CACHE_READ_INPUT_TOKENS_COL),
        has_cache_creation_input_tokens: has_field(schema, GEN_AI_CACHE_CREATION_INPUT_TOKENS_COL),
        has_cost_cache_read_input: has_field(schema, GEN_AI_COST_CACHE_READ_INPUT_COL),
        has_cost_cache_creation_input: has_field(schema, GEN_AI_COST_CACHE_CREATION_INPUT_COL),
        has_cost_estimated_without_cache: has_field(
            schema,
            GEN_AI_COST_ESTIMATED_WITHOUT_CACHE_COL,
        ),
        has_cost_cache_read_savings: has_field(schema, GEN_AI_COST_CACHE_READ_SAVINGS_COL),
        has_cost_net_cache_impact: has_field(schema, GEN_AI_COST_NET_CACHE_IMPACT_COL),
    })
}

fn has_field(schema: &Schema, field: &str) -> bool {
    schema.field_with_name(field).is_ok()
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
    fn exposes_gen_ai_identity_columns() {
        assert_eq!(GEN_AI_SESSION_ID_COL, "gen_ai_conversation_id");
        // user.id is the OTEL attribute name — the search layer resolves it
        // to the flattened column.
        assert_eq!(GEN_AI_USER_ID_COL, OtelAttributes::USER_ID);
        assert_eq!(GEN_AI_USER_ID_COL, "user.id");
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
        let result = validate_gen_ai_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert!(v.has_input_messages);
    }

    #[test]
    fn missing_required_gen_ai_field_returns_error() {
        // Missing gen_ai_usage_cost
        let schema = schema_with(&[
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_response_model",
        ]);
        let result = validate_gen_ai_schema(&schema, "my_stream");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.field_name, "gen_ai_usage_cost");
        assert_eq!(err.stream_name, "my_stream");
        assert!(err.to_string().contains("gen_ai_usage_cost"));
        assert!(err.to_string().contains("my_stream"));
    }

    #[test]
    fn optional_gen_ai_fields_missing_are_reported_as_absent() {
        // All required fields present, but no optional fields.
        let schema = schema_with(&[
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_output_tokens",
            "gen_ai_usage_cost",
            "gen_ai_response_model",
        ]);
        let result = validate_gen_ai_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert!(!v.has_input_messages);
    }

    #[test]
    fn fallback_assumes_required_present_optional_absent() {
        let fallback = GenAiSchema::fallback();
        assert!(!fallback.has_input_messages);
    }
}
