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

use arrow_schema::Schema;
use config::meta::stream::StreamType;

use crate::service::traces::otel::attributes::OtelAttributes;

/// Sentinel column whose presence indicates the new `gen_ai_*` schema.
const GEN_AI_SENTINEL_COLUMN: &str = "gen_ai_usage_input_tokens";

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
///
/// Intentionally test-only today: production call sites read `has_gen_ai_fields`
/// from the cached schema asynchronously and pick the layout directly to avoid
/// reborrowing the `Arc<Schema>` (see `stream_has_gen_ai_fields`). This pure
/// helper exists so the mapping rule can be unit-tested against synthetic
/// schemas without touching the global cache.
#[cfg(test)]
fn columns_for(schema: &Schema) -> LlmColumns {
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
}
