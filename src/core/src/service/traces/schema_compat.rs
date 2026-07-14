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
