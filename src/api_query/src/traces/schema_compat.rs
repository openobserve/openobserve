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

//! Schema-version detection and column-name selection for LLM trace streams.
//!
//! OpenObserve supports two generations of LLM trace schemas:
//!
//! - **New (`gen_ai_*`)** — emitted since PR #11626 ("refactor llm attribute trace"). Tokens, cost,
//!   model, user, session id all use the OTEL Gen-AI spec names: `gen_ai_usage_input_tokens`,
//!   `gen_ai_response_model`, `user.id` (queried as `user.id`), `gen_ai_conversation_id`, etc.
//! - **Legacy (`_o2_llm`)** — pre-PR #11626. Tokens live under
//!   `llm_usage_tokens_{input,output,total}`, cost under `llm_usage_cost_total`, model under
//!   `llm_model_name`, and user/session ids under `llm_user_id`/`llm_session_id`.
//!
//! For streams ingested across the migration boundary the handler must pick
//! the right column names at query time. We detect the generation by looking
//! for a sentinel new-schema column (`gen_ai_usage_input_tokens`) in the
//! cached Arrow schema.

use std::fmt;

use arrow_schema::Schema;
use config::meta::stream::StreamType;
use openobserve_core::traces::otel::attributes::OtelAttributes;
pub(crate) use openobserve_core::traces::schema_compat::{
    GEN_AI_SENTINEL_COLUMN, OPTIONAL_GEN_AI_FIELDS, OPTIONAL_LLM_FIELDS, REQUIRED_GEN_AI_FIELDS,
    REQUIRED_LLM_FIELDS,
};

/// Column names that vary between the new and legacy LLM schemas.
///
/// `Default` returns the new-schema names so call sites that don't care about
/// legacy compatibility (or that lack a cached schema) keep working unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct LlmColumns {
    /// Per-trace conversation/session identifier.
    pub(super) session_id: &'static str,
    /// Per-trace user identifier.
    pub(super) user_id: &'static str,
}

impl LlmColumns {
    /// Column layout for the current (`gen_ai_*`) schema.
    pub(super) const fn current() -> Self {
        Self {
            session_id: "gen_ai_conversation_id",
            user_id: OtelAttributes::USER_ID,
        }
    }

    /// Column layout for the legacy (`_o2_llm`) schema.
    pub(super) const fn legacy() -> Self {
        Self {
            session_id: "llm_session_id",
            user_id: "llm_user_id",
        }
    }
}

/// Decide which schema generation an Arrow schema belongs to.
///
/// Returns `true` when the new `gen_ai_*` columns are present (i.e. the stream
/// was ingested after PR #11626), `false` for legacy `_o2_llm` streams.
pub(super) fn has_gen_ai_fields(schema: &Schema) -> bool {
    schema.field_with_name(GEN_AI_SENTINEL_COLUMN).is_ok()
}

/// Pick the column-name layout for a given schema.
#[allow(dead_code)]
pub(super) fn columns_for(schema: &Schema) -> LlmColumns {
    if has_gen_ai_fields(schema) {
        LlmColumns::current()
    } else {
        LlmColumns::legacy()
    }
}

/// Fetch the stream's Arrow schema from cache and decide whether it uses the
/// new `gen_ai_*` columns. Streams missing from the cache default to `false`
/// (legacy) so query SQL never references columns that aren't there for an
/// unknown stream.
pub(super) async fn stream_has_gen_ai_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> bool {
    infra::schema::get_stream_schema_from_cache(org_id, stream_name, stream_type)
        .await
        .map(|s| has_gen_ai_fields(&s))
        .unwrap_or(false)
}

/// Validated schema metadata for an LLM trace stream.
///
/// Produced by [`validate_llm_schema`], this struct carries:
/// - the schema generation (gen_ai vs legacy)
/// - the column-name layout (session_id, user_id)
/// - which optional fields are actually present
///
/// Callers use this to build SQL queries that reference only columns that
/// truly exist, and to decide whether to omit optional fields from the
/// API response.
#[derive(Debug, Clone)]
pub(super) struct ValidatedLlmSchema {
    pub(super) has_gen_ai: bool,
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
    pub(super) fn fallback(has_gen_ai: bool) -> Self {
        Self {
            has_gen_ai,
            columns: if has_gen_ai {
                LlmColumns::current()
            } else {
                LlmColumns::legacy()
            },
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

/// Error returned when a required LLM field is missing from the stream schema.
#[derive(Debug)]
pub(super) struct LlmSchemaError {
    pub field_name: &'static str,
    pub stream_name: String,
}

impl fmt::Display for LlmSchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Missing required LLM field '{}' in stream '{}'",
            self.field_name, self.stream_name
        )
    }
}

/// Validate that an LLM stream's schema has all required fields.
///
/// Checks for the schema-appropriate required fields (gen_ai_* or llm_*)
/// and returns an error if any are missing. Optional fields are reported
/// so callers can omit them from SQL when absent.
pub(super) fn validate_llm_schema(
    schema: &Schema,
    stream_name: &str,
) -> Result<ValidatedLlmSchema, LlmSchemaError> {
    let has_gen_ai = has_gen_ai_fields(schema);
    let (required_fields, optional_fields) = if has_gen_ai {
        (REQUIRED_GEN_AI_FIELDS, OPTIONAL_GEN_AI_FIELDS)
    } else {
        (REQUIRED_LLM_FIELDS, OPTIONAL_LLM_FIELDS)
    };

    for &field in required_fields {
        if schema.field_with_name(field).is_err() {
            return Err(LlmSchemaError {
                field_name: field,
                stream_name: stream_name.to_string(),
            });
        }
    }

    let has_input_messages = schema.field_with_name(optional_fields[0]).is_ok();
    let has_output_messages = schema.field_with_name(optional_fields[1]).is_ok();
    let has_total_tokens = schema.field_with_name(optional_fields[2]).is_ok();
    let has_cache_read_input_tokens =
        has_gen_ai && schema.field_with_name(optional_fields[3]).is_ok();
    let has_cache_creation_input_tokens =
        has_gen_ai && schema.field_with_name(optional_fields[4]).is_ok();
    let has_cost_cache_read_input =
        has_gen_ai && schema.field_with_name(optional_fields[5]).is_ok();
    let has_cost_cache_creation_input =
        has_gen_ai && schema.field_with_name(optional_fields[6]).is_ok();
    let has_cost_estimated_without_cache =
        has_gen_ai && schema.field_with_name(optional_fields[7]).is_ok();
    let has_cost_cache_read_savings =
        has_gen_ai && schema.field_with_name(optional_fields[8]).is_ok();
    let has_cost_net_cache_impact =
        has_gen_ai && schema.field_with_name(optional_fields[9]).is_ok();

    Ok(ValidatedLlmSchema {
        has_gen_ai,
        columns: if has_gen_ai {
            LlmColumns::current()
        } else {
            LlmColumns::legacy()
        },
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
    fn detects_new_schema_via_sentinel() {
        let schema = schema_with(&[
            "trace_id",
            "gen_ai_usage_input_tokens",
            "gen_ai_usage_total_tokens",
        ]);
        assert!(has_gen_ai_fields(&schema));
        assert_eq!(columns_for(&schema), LlmColumns::current());
    }

    #[test]
    fn detects_legacy_schema_when_sentinel_missing() {
        let schema = schema_with(&[
            "trace_id",
            "llm_usage_tokens_input",
            "llm_usage_tokens_total",
            "llm_user_id",
            "llm_session_id",
        ]);
        assert!(!has_gen_ai_fields(&schema));
        assert_eq!(columns_for(&schema), LlmColumns::legacy());
    }

    #[test]
    fn legacy_layout_uses_llm_prefixed_columns() {
        let cols = LlmColumns::legacy();
        assert_eq!(cols.session_id, "llm_session_id");
        assert_eq!(cols.user_id, "llm_user_id");
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
    fn empty_schema_is_treated_as_legacy() {
        let schema = Schema::empty();
        assert!(!has_gen_ai_fields(&schema));
        assert_eq!(columns_for(&schema), LlmColumns::legacy());
    }

    #[test]
    fn schema_with_only_partial_new_columns_still_detected_via_sentinel() {
        // A schema missing the sentinel but containing other gen_ai_* columns
        // should be classified as legacy — we trust the single sentinel rather
        // than guess from partial migrations.
        let schema = schema_with(&["trace_id", "gen_ai_usage_cost"]);
        assert!(!has_gen_ai_fields(&schema));
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
        assert!(v.has_gen_ai);
        assert_eq!(v.columns, LlmColumns::current());
        assert!(v.has_input_messages);
        assert!(v.has_output_messages);
    }

    #[test]
    fn valid_legacy_schema_passes_validation() {
        let schema = schema_with(&[
            "llm_usage_tokens_input",
            "llm_usage_tokens_output",
            "llm_usage_cost_total",
            "llm_model_name",
            "llm_session_id",
            "llm_input",
        ]);
        let result = validate_llm_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert!(!v.has_gen_ai);
        assert_eq!(v.columns, LlmColumns::legacy());
        assert!(v.has_input_messages);
        assert!(!v.has_output_messages);
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
    fn missing_required_legacy_field_returns_error() {
        // Missing llm_model_name
        let schema = schema_with(&[
            "llm_usage_tokens_input",
            "llm_usage_tokens_output",
            "llm_usage_cost_total",
            "llm_session_id",
        ]);
        let result = validate_llm_schema(&schema, "legacy_stream");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.field_name, "llm_model_name");
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
        assert!(v.has_gen_ai);
        assert!(!v.has_input_messages);
        assert!(!v.has_output_messages);
    }

    #[test]
    fn optional_legacy_fields_missing_are_reported_as_absent() {
        let schema = schema_with(&[
            "llm_usage_tokens_input",
            "llm_usage_tokens_output",
            "llm_usage_cost_total",
            "llm_model_name",
        ]);
        let result = validate_llm_schema(&schema, "test_stream");
        assert!(result.is_ok());
        let v = result.unwrap();
        assert!(!v.has_gen_ai);
        assert!(!v.has_input_messages);
        assert!(!v.has_output_messages);
    }

    #[test]
    fn fallback_assumes_required_present_optional_absent() {
        let fallback = ValidatedLlmSchema::fallback(true);
        assert!(fallback.has_gen_ai);
        assert_eq!(fallback.columns, LlmColumns::current());
        assert!(!fallback.has_input_messages);
        assert!(!fallback.has_output_messages);
    }

    #[test]
    fn fallback_legacy_uses_llm_columns() {
        let fallback = ValidatedLlmSchema::fallback(false);
        assert!(!fallback.has_gen_ai);
        assert_eq!(fallback.columns, LlmColumns::legacy());
    }
}
