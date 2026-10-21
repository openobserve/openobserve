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

use std::collections::{BTreeSet, HashMap};

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::model_pricing::{
    BUILT_IN_ORG, META_ORG, MatchKind, ModelPricingDefinition, PricingSource, PricingTierDefinition,
};
use db::model_pricing::{self, CachedModelPricing};
use openobserve_core::traces::otel::pricing::{
    ResolvedPricing, model_canonical_names, resolve_pricing,
};
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;
#[cfg(feature = "enterprise")]
use {
    openobserve_api_common::extractors::Headers,
    openobserve_core::auth::{UserEmail, check_permissions},
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

fn source_priority(source: &PricingSource) -> u8 {
    match source {
        PricingSource::Org => 0,
        PricingSource::MetaOrg => 1,
        PricingSource::BuiltIn => 2,
    }
}

/// ListModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/llm/models",
    context_path = "/api",
    tag = "LLM",
    operation_id = "ListModelPricing",
    summary = "List all model pricing definitions",
    description = "Returns all model pricing definitions for the organization, including inherited definitions from the meta org.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<ModelPricingDefinition>),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn list(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "LIST",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    // Collect all items from all sources without deduplication.
    // We will group them by match_pattern and build a parent-children hierarchy.
    let mut all_items: Vec<ModelPricingDefinition> = Vec::new();

    // 1. Org-specific entries (all, enabled or not — UI needs to show disabled ones too).
    match model_pricing::list(&org_id).await {
        Ok(items) => all_items.extend(items),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    // 2. For non-meta orgs, include inherited entries from the meta org.
    if org_id != META_ORG && org_id != BUILT_IN_ORG {
        match model_pricing::list(META_ORG).await {
            Ok(meta_items) => all_items.extend(meta_items.into_iter().filter(|m| m.enabled)),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    }

    // 3. Include built-in entries. Filter disabled (soft-deleted from upstream).
    if org_id != BUILT_IN_ORG {
        match model_pricing::list(BUILT_IN_ORG).await {
            Ok(built_in_items) => {
                all_items.extend(built_in_items.into_iter().filter(|m| m.enabled))
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    }

    // Sort all items by priority: source (Org < MetaOrg < BuiltIn), then sort_order, then name.
    all_items.sort_by(|a, b| {
        source_priority(&a.source)
            .cmp(&source_priority(&b.source))
            .then_with(|| a.sort_order.cmp(&b.sort_order))
            .then_with(|| a.name.cmp(&b.name))
    });

    // An item nests under the parent the resolver would pick for the item's own name: the
    // higher-priority source first, then the better match kind; ties keep the earlier entry.
    let rank = |source: &PricingSource, kind: Option<MatchKind>| {
        (std::cmp::Reverse(source_priority(source)), kind)
    };
    let never_matches = regex::Regex::new("$^").unwrap();
    let mut parents: Vec<(ModelPricingDefinition, regex::Regex)> = Vec::new();

    for item in all_items {
        let compiled = regex::RegexBuilder::new(&item.match_pattern)
            .size_limit(db::model_pricing::REGEX_SIZE_LIMIT)
            .build()
            .unwrap_or_else(|_| never_matches.clone());
        let test_str = derive_test_string(&item.match_pattern);

        let parent_idx = if test_str.is_empty() {
            None
        } else {
            let own_rank = rank(&item.source, MatchKind::of(&compiled, &test_str));
            let mut best = None;
            for (idx, (parent, re)) in parents.iter().enumerate() {
                let Some(kind) = MatchKind::of(re, &test_str) else {
                    continue;
                };
                let parent_rank = rank(&parent.source, Some(kind));
                if parent_rank >= own_rank && best.is_none_or(|(_, b)| parent_rank > b) {
                    best = Some((idx, parent_rank));
                }
            }
            best.map(|(idx, _)| idx)
        };

        if let Some(idx) = parent_idx {
            parents[idx].0.children.push(item);
        } else {
            parents.push((item, compiled));
        }
    }

    let result: Vec<ModelPricingDefinition> = parents.into_iter().map(|(def, _)| def).collect();
    MetaHttpResponse::json(result)
}

/// GetModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    get,
    path = "/{org_id}/llm/models/{model_id}",
    context_path = "/api",
    tag = "LLM",
    operation_id = "GetModelPricing",
    summary = "Get a model pricing definition by ID",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("model_id" = String, Path, description = "Model pricing definition ID"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ModelPricingDefinition),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn get(
    Path((org_id, model_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "GET",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    match model_pricing::get_by_id(&model_id).await {
        Ok(Some(item))
            if item.org_id == org_id || item.org_id == META_ORG || item.org_id == BUILT_IN_ORG =>
        {
            MetaHttpResponse::json(item)
        }
        Ok(Some(_)) | Ok(None) => MetaHttpResponse::not_found("Model pricing definition not found"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// CreateModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    post,
    path = "/{org_id}/llm/models",
    context_path = "/api",
    tag = "LLM",
    operation_id = "CreateModelPricing",
    summary = "Create a new model pricing definition",
    description = "Create a new model pricing definition with regex match pattern and per-token pricing.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = ModelPricingDefinition, description = "Model pricing definition"),
    responses(
        (status = 201, description = "Created", content_type = "application/json", body = ModelPricingDefinition),
        (status = 400, description = "Bad request"),
    ),
)]
pub async fn create(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(mut item): Json<ModelPricingDefinition>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    // The built-in org is managed exclusively by the background GitHub sync job.
    if org_id == BUILT_IN_ORG {
        return MetaHttpResponse::forbidden(
            "Cannot create entries in the built-in org. Use the refresh endpoint to sync from upstream.",
        );
    }

    item.org_id = org_id.clone();
    item.id = None; // Force new ID generation
    item.source = if org_id == META_ORG {
        PricingSource::MetaOrg
    } else {
        PricingSource::Org
    };

    if let Err(e) = validate_definition(&item) {
        return MetaHttpResponse::bad_request(e);
    }

    // Reject if a definition with the same name already exists in this org.
    // The underlying `put()` does upsert-by-name (needed by the sync job),
    // so user-facing create must enforce uniqueness explicitly.
    match model_pricing::get_by_name(&org_id, &item.name).await {
        Ok(Some(_)) => {
            return MetaHttpResponse::bad_request(format!(
                "A model pricing definition with name '{}' already exists in this organization",
                item.name
            ));
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(e);
        }
        Ok(None) => {} // good — name is available
    }

    match model_pricing::set(item).await {
        Ok(saved) => (StatusCode::CREATED, Json(saved)).into_response(),
        Err(e) => map_set_error(e),
    }
}

/// UpdateModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    put,
    path = "/{org_id}/llm/models/{model_id}",
    context_path = "/api",
    tag = "LLM",
    operation_id = "UpdateModelPricing",
    summary = "Update a model pricing definition",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("model_id" = String, Path, description = "Model pricing definition ID"),
    ),
    request_body(content = ModelPricingDefinition, description = "Updated model pricing definition"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ModelPricingDefinition),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn update(
    Path((org_id, model_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(mut item): Json<ModelPricingDefinition>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    // Verify the model exists and belongs to this org
    match model_pricing::get_by_id(&model_id).await {
        Ok(Some(existing)) if existing.org_id == org_id => {
            if existing.source == PricingSource::BuiltIn {
                return MetaHttpResponse::forbidden(
                    "Built-in model pricing definitions are read-only. Clone to customize.",
                );
            }
            // Preserve the ID, org_id, and source
            item.id = existing.id;
            item.org_id = org_id;
            item.source = existing.source;
        }
        Ok(Some(_)) | Ok(None) => {
            return MetaHttpResponse::not_found("Model pricing definition not found");
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(e);
        }
    }

    if let Err(e) = validate_definition(&item) {
        return MetaHttpResponse::bad_request(e);
    }

    match model_pricing::set(item).await {
        Ok(saved) => MetaHttpResponse::json(saved),
        Err(e) => map_set_error(e),
    }
}

/// DeleteModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    delete,
    path = "/{org_id}/llm/models/{model_id}",
    context_path = "/api",
    tag = "LLM",
    operation_id = "DeleteModelPricing",
    summary = "Delete a model pricing definition",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("model_id" = String, Path, description = "Model pricing definition ID"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 404, description = "Not found"),
    ),
)]
pub async fn delete(
    Path((org_id, model_id)): Path<(String, String)>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "DELETE",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    match model_pricing::delete_by_id(&org_id, &model_id).await {
        Ok(true) => MetaHttpResponse::ok("Model pricing definition deleted"),
        Ok(false) => MetaHttpResponse::not_found("Model pricing definition not found"),
        Err(e) => {
            if let Some(infra::errors::Error::ReadOnly(msg)) =
                e.downcast_ref::<infra::errors::Error>()
            {
                MetaHttpResponse::forbidden(msg)
            } else {
                MetaHttpResponse::internal_error(e)
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct BuiltInQuery {
    #[serde(default)]
    pub search: String,
}

/// A model pricing entry from the community/built-in source.
#[derive(serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct BuiltInModelPricingEntry {
    pub name: String,
    pub match_pattern: String,
    pub tiers: Vec<config::meta::model_pricing::PricingTierDefinition>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub provider: String,
}

/// BuiltInModelPricingResponse
#[derive(serde::Serialize)]
pub struct BuiltInModelPricingResponse {
    pub models: Vec<BuiltInModelPricingEntry>,
    pub source_url: String,
    pub last_updated: i64,
}

/// GetBuiltInModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    get,
    path = "/{org_id}/llm/models/built-in",
    context_path = "/api",
    tag = "LLM",
    operation_id = "GetBuiltInModelPricing",
    summary = "Get built-in community model pricing definitions",
    description = "Fetches standard model pricing from the configured community source (GitHub). Results are cached on the frontend.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("search" = Option<String>, Query, description = "Filter by name"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn get_built_in(
    Path(_org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Query(query): Query<BuiltInQuery>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &_org_id,
        &_org_id,
        &user_email.user_id,
        "model_pricing",
        "LIST",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let source_url = config::get_config().common.model_pricing_source_url.clone();

    // Read from DB (synced by background job) instead of making a live HTTP call.
    let all_built_in = match model_pricing::list(BUILT_IN_ORG).await {
        Ok(items) => items,
        Err(e) => {
            log::error!("[model_pricing] failed to list built-in models from DB: {e}");
            return MetaHttpResponse::internal_error("Failed to load built-in model pricing.");
        }
    };

    let search = query.search.to_lowercase();
    let models: Vec<BuiltInModelPricingEntry> = all_built_in
        .into_iter()
        .filter(|m| m.enabled)
        .filter(|m| {
            search.is_empty()
                || m.name.to_lowercase().contains(&search)
                || m.provider.to_lowercase().contains(&search)
                || m.description.to_lowercase().contains(&search)
        })
        .map(|m| BuiltInModelPricingEntry {
            name: m.name,
            match_pattern: m.match_pattern,
            tiers: m.tiers,
            description: m.description,
            provider: m.provider,
        })
        .collect();

    let last_updated = openobserve_builtins::model_pricing::last_sync_timestamp();
    MetaHttpResponse::json(BuiltInModelPricingResponse {
        models,
        source_url,
        last_updated,
    })
}

/// Map errors from `model_pricing::set` to appropriate HTTP responses.
/// Duplicate-name errors are returned as 400 Bad Request; everything else is 500.
fn map_set_error(e: anyhow::Error) -> Response {
    if let Some(infra::errors::Error::DuplicateName(msg)) = e.downcast_ref::<infra::errors::Error>()
    {
        MetaHttpResponse::bad_request(msg)
    } else {
        MetaHttpResponse::internal_error(e)
    }
}

/// RefreshBuiltInModelPricing
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    post,
    path = "/{org_id}/llm/models/refresh-built-in",
    context_path = "/api",
    tag = "LLM",
    operation_id = "RefreshBuiltInModelPricing",
    summary = "Refresh built-in model pricing from upstream source",
    description = "Triggers an immediate sync of built-in model pricing definitions from the configured GitHub source.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn refresh_built_in(
    Path(_org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &_org_id,
        &_org_id,
        &user_email.user_id,
        "model_pricing",
        "PUT",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let last_sync = openobserve_builtins::model_pricing::last_sync_timestamp();
    if last_sync > 0 && chrono::Utc::now().timestamp() - last_sync < 60 {
        return MetaHttpResponse::too_many_requests("Rate limit: wait 60s between refreshes");
    }

    match openobserve_builtins::model_pricing::sync_built_in_from_github(true).await {
        Ok(result) => MetaHttpResponse::json(result),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// Strip leading inline flag groups like `(?i)`, `(?ms)`, `(?-i)` from a regex pattern.
fn strip_leading_flags(s: &str) -> &str {
    let mut rest = s;
    loop {
        if let Some(r) = rest.strip_prefix("(?")
            && let Some(end) = r.find(')')
        {
            let flags = &r[..end];
            if flags
                .chars()
                .all(|c| matches!(c, 'i' | 'm' | 's' | 'x' | 'u' | '-'))
            {
                rest = &r[end + 1..];
                continue;
            }
        }
        break;
    }
    rest
}

/// Strip one leading optional group such as `(?:[\w-]+[/.:])*` (a provider/route prefix like
/// `openai/` or `us.anthropic.`). Only a group quantified with `*` or `?` is stripped, because it
/// can match nothing; any other leading group is part of the model name and is kept.
fn strip_leading_optional_group(s: &str) -> &str {
    if !s.starts_with('(') {
        return s;
    }
    let mut depth = 0usize;
    let mut in_class = false;
    let mut chars = s.char_indices();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '[' if !in_class => in_class = true,
            ']' if in_class => in_class = false,
            '(' if !in_class => depth += 1,
            ')' if !in_class => {
                depth -= 1;
                if depth == 0 {
                    let rest = &s[i + 1..];
                    return match rest.strip_prefix(['*', '?']) {
                        Some(after) => after.strip_prefix('?').unwrap_or(after),
                        None => s,
                    };
                }
            }
            _ => {}
        }
    }
    s
}

/// Derive a testable literal string from a regex pattern.
///
/// Strips inline flags, leading `^` anchors and one leading optional prefix group, then walks the
/// pattern character by character collecting literal characters. Stops at the first unescaped
/// regex metacharacter (`(`, `)`, `[`, `]`, `{`, `}`, `*`, `+`, `?`, `|`, `$`, `^`, `.`).
/// Backslash-escaped characters are treated as their literal value (e.g. `\.` → `.`).
///
/// Examples:
///   `(?i)claude-3-haiku`              → `"claude-3-haiku"`
///   `(?i)gpt-4o(?:-\d{4}[-\d]*)?$`   → `"gpt-4o"`
///   `(?i)claude-3-sonnet$`            → `"claude-3-sonnet"`
///   `(?i)gpt-3\.5`                    → `"gpt-3.5"`
///   `(?i)^(?:[\w-]+[/.:])*gpt-5\.4(?:-\d{8})?$` → `"gpt-5.4"`
fn derive_test_string(pattern: &str) -> String {
    let s = strip_leading_flags(pattern.trim());
    let s = strip_leading_optional_group(s.trim_start_matches('^'));
    let mut result = String::new();
    let mut iter = s.chars().peekable();
    while let Some(c) = iter.next() {
        match c {
            '\\' => {
                if let Some(next) = iter.next() {
                    result.push(next);
                }
            }
            '(' | ')' | '[' | ']' | '{' | '}' | '*' | '+' | '?' | '|' | '$' | '^' | '.' => break,
            _ => result.push(c),
        }
    }
    result
}

/// Request body for the test-model-match endpoint.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TestModelMatchRequest {
    /// The model name to test (e.g. "gpt-4o", "claude-opus-3-5"). Empty skips the single-name
    /// test, e.g. when only previewing `match_pattern`.
    #[serde(default)]
    pub model_name: String,
    /// Optional token counts keyed by usage type (e.g. {"input": 1000, "output": 500}).
    /// When provided, cost is calculated using the matched pricing definition.
    #[serde(default)]
    pub usage: HashMap<String, i64>,
    /// Optional span timestamp in microseconds. When provided, only definitions
    /// whose `valid_from` <= timestamp are considered, and tiers restricted to
    /// recurring UTC time-of-day windows (peak / off-peak) are resolved against it.
    #[serde(default)]
    pub timestamp: Option<i64>,
    /// Optional span attributes (e.g. {"openai.response.service_tier": "flex"}) for tier rules.
    #[serde(default)]
    #[schema(value_type = HashMap<String, Object>)]
    pub attributes: HashMap<String, config::utils::json::Value>,
    /// An unsaved rule pattern to preview. When set, the response lists in `captured_models`
    /// every known model this pattern would price if it were saved in this org. The
    /// `model_name` test is unaffected and still runs against the saved rules.
    #[serde(default)]
    pub match_pattern: Option<String>,
    /// Id of the rule being edited. It is left out of the preview, so its saved pattern does
    /// not compete with the edited one.
    #[serde(default)]
    pub rule_id: Option<String>,
}

/// Response for the test-model-match endpoint.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct TestModelMatchResponse {
    /// The matched pricing definition, or null if no definition matched. A match from the
    /// compiled-in fallback table is shown as a built-in definition without an id.
    pub matched: Option<ModelPricingDefinition>,
    /// How the matched pattern covers the model name: `exact` when it matches the whole name,
    /// `approximate` when the name continues before or after the match (the price may belong
    /// to a different model). Null if nothing matched.
    pub match_kind: Option<MatchKind>,
    /// The name of the selected pricing tier, or null if no definition matched.
    pub tier: Option<String>,
    /// Index of the selected tier in `matched.tiers`, which stays unambiguous when names repeat.
    pub tier_index: Option<usize>,
    /// Per-usage-key costs (excluding "total").
    pub costs: HashMap<String, f64>,
    /// Sum of all per-key costs.
    pub total_cost: f64,
    /// The known models the previewed `match_pattern` would price, the model the pattern names
    /// first. Empty when no pattern was sent.
    pub captured_models: Vec<CapturedModel>,
}

/// A known model that a previewed rule pattern would price.
#[derive(Debug, PartialEq, Serialize, utoipa::ToSchema)]
pub struct CapturedModel {
    /// A model name some pricing rule or the compiled-in table is written for.
    pub model_name: String,
    /// How the previewed pattern covers this name.
    pub match_kind: MatchKind,
    /// True for the model the pattern itself names (its literal text); false for every other
    /// model the pattern also catches.
    pub primary: bool,
    /// The rule that prices this model today, which the previewed rule would replace.
    pub replaces: Option<PricingRuleRef>,
}

/// The name and source of a pricing rule.
#[derive(Debug, PartialEq, Serialize, utoipa::ToSchema)]
pub struct PricingRuleRef {
    pub name: String,
    pub source: PricingSource,
}

/// The known models `candidate` would price if it were added to `entries`.
///
/// Known models are the names the saved rules and the compiled-in table are written for (see
/// [`derive_test_string`]), plus the name the candidate itself spells out. A model counts as
/// captured only when the candidate would actually win it, so a model an equal-or-higher
/// source prices more precisely is left out. `candidate` must carry an id no entry has.
fn captured_models(
    entries: &[CachedModelPricing],
    candidate: &CachedModelPricing,
) -> Vec<CapturedModel> {
    let primary = derive_test_string(&candidate.definition.match_pattern);
    let names: BTreeSet<String> = entries
        .iter()
        .map(|e| derive_test_string(&e.definition.match_pattern))
        .chain(model_canonical_names().map(|(_, canonical)| canonical.to_string()))
        .chain(std::iter::once(primary.clone()))
        .filter(|name| !name.is_empty())
        .collect();
    let with_candidate: Vec<CachedModelPricing> = std::iter::once(candidate.clone())
        .chain(entries.iter().cloned())
        .collect();

    let mut captured: Vec<CapturedModel> = names
        .into_iter()
        .filter_map(|name| {
            let match_kind = MatchKind::of(&candidate.compiled_regex, &name)?;
            let wins = matches!(
                resolve_pricing(&with_candidate, &name, None),
                Some(r) if matches!(&r.pricing, ResolvedPricing::Definition(d) if d.id == candidate.definition.id)
            );
            if !wins {
                return None;
            }
            let replaces = resolve_pricing(entries, &name, None).map(|r| match r.pricing {
                ResolvedPricing::Definition(d) => PricingRuleRef {
                    name: d.name,
                    source: d.source,
                },
                ResolvedPricing::Compiled(p) => PricingRuleRef {
                    name: p.canonical.clone(),
                    source: PricingSource::BuiltIn,
                },
            });
            Some(CapturedModel {
                primary: name == primary,
                model_name: name,
                match_kind,
                replaces,
            })
        })
        .collect();
    captured.sort_by_key(|c| std::cmp::Reverse(c.primary));
    captured
}

/// TestModelMatch
///
/// #{"ratelimit_module":"ModelPricing", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    post,
    path = "/{org_id}/llm/models/test",
    context_path = "/api",
    tag = "LLM",
    operation_id = "TestModelMatch",
    summary = "Test which pricing definition matches a model name and calculate cost",
    description = "Simulates the pricing lookup for a given model name and optional usage data, returning the matched definition, selected tier, and cost breakdown. With `match_pattern`, also lists the known models that pattern would price if saved as a rule in this organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = TestModelMatchRequest, description = "Model name and optional usage to test"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = TestModelMatchResponse),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn test_model_match(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
    Json(req): Json<TestModelMatchRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    if !check_permissions(
        &org_id,
        &org_id,
        &user_email.user_id,
        "model_pricing",
        "LIST",
        None,
        true,
        false,
        false,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    let saved = model_pricing::get_org_pricing_entries(&org_id);

    let captured_models = match req.match_pattern.as_deref().map(str::trim) {
        Some(pattern) if !pattern.is_empty() => {
            let compiled_regex = match regex::RegexBuilder::new(pattern)
                .size_limit(model_pricing::REGEX_SIZE_LIMIT)
                .build()
            {
                Ok(re) => re,
                Err(e) => {
                    return MetaHttpResponse::bad_request(format!("Invalid regex pattern: {e}"));
                }
            };
            let others: Vec<CachedModelPricing> = saved
                .iter()
                .filter(|e| {
                    req.rule_id.is_none() || e.definition.id.map(|id| id.to_string()) != req.rule_id
                })
                .cloned()
                .collect();
            let candidate = CachedModelPricing {
                definition: ModelPricingDefinition {
                    id: Some(svix_ksuid::Ksuid::new(None, None)),
                    match_pattern: pattern.to_string(),
                    source: if org_id == META_ORG {
                        PricingSource::MetaOrg
                    } else {
                        PricingSource::Org
                    },
                    ..Default::default()
                },
                compiled_regex,
            };
            captured_models(&others, &candidate)
        }
        _ => Vec::new(),
    };

    let resolved = if req.model_name.is_empty() {
        None
    } else {
        resolve_pricing(&saved, &req.model_name, req.timestamp)
    };
    let match_kind = resolved.as_ref().map(|r| r.match_kind);
    let matched = resolved.map(|r| match r.pricing {
        ResolvedPricing::Definition(definition) => *definition,
        ResolvedPricing::Compiled(pricing) => pricing.to_definition(),
    });

    let (tier, tier_index, costs, total_cost) = if let Some(def) = &matched {
        let ctx = openobserve_core::traces::otel::processor::pricing_context_for_test_endpoint(
            def,
            &req.attributes,
        );
        let result =
            model_pricing::calculate_cost_from_definition(def, &req.usage, req.timestamp, &ctx);
        let total = result.cost.get("total").copied().unwrap_or(0.0);
        let costs = result
            .cost
            .into_iter()
            .filter(|(k, _)| k != "total")
            .collect();
        (Some(result.tier_name), result.tier_index, costs, total)
    } else {
        (None, None, HashMap::new(), 0.0)
    };

    MetaHttpResponse::json(TestModelMatchResponse {
        matched,
        match_kind,
        tier,
        tier_index,
        costs,
        total_cost,
        captured_models,
    })
}

fn validate_definition(item: &ModelPricingDefinition) -> Result<(), String> {
    if item.name.trim().is_empty() {
        return Err("Model name is required".to_string());
    }
    if item.name.len() > 256 {
        return Err("Model name must be 256 characters or fewer".to_string());
    }
    if item.match_pattern.trim().is_empty() {
        return Err("Match pattern is required".to_string());
    }
    if item.match_pattern.len() > 512 {
        return Err("Match pattern must be 512 characters or fewer".to_string());
    }
    if let Err(e) = regex::RegexBuilder::new(&item.match_pattern)
        .size_limit(db::model_pricing::REGEX_SIZE_LIMIT)
        .build()
    {
        return Err(format!("Invalid regex pattern: {e}"));
    }
    item.validate_tiers(false)?;
    // Builds without rules read a rule tier as unrestricted and would price with it.
    let first_default = item
        .tiers
        .iter()
        .position(PricingTierDefinition::is_default);
    if item
        .tiers
        .iter()
        .take(first_default.unwrap_or(0))
        .any(|t| !t.rules.is_empty())
    {
        return Err("The default tier must come before any tier with rules".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use config::meta::model_pricing::{
        ModelPricingDefinition, PricingSource, PricingTierDefinition,
    };

    use super::*;

    // ── source_priority ───────────────────────────────────────────────────────

    #[test]
    fn test_source_priority_org_is_lowest() {
        assert_eq!(source_priority(&PricingSource::Org), 0);
    }

    #[test]
    fn test_source_priority_meta_org_is_middle() {
        assert_eq!(source_priority(&PricingSource::MetaOrg), 1);
    }

    #[test]
    fn test_source_priority_built_in_is_highest() {
        assert_eq!(source_priority(&PricingSource::BuiltIn), 2);
    }

    // ── strip_leading_flags ───────────────────────────────────────────────────

    #[test]
    fn test_strip_leading_flags_case_insensitive() {
        assert_eq!(strip_leading_flags("(?i)claude-3"), "claude-3");
    }

    #[test]
    fn test_strip_leading_flags_multiline_and_dotall() {
        assert_eq!(strip_leading_flags("(?ms)test"), "test");
    }

    #[test]
    fn test_strip_leading_flags_negate_flag() {
        assert_eq!(strip_leading_flags("(?-i)test"), "test");
    }

    #[test]
    fn test_strip_leading_flags_stacked_groups() {
        assert_eq!(strip_leading_flags("(?i)(?m)pattern"), "pattern");
    }

    #[test]
    fn test_strip_leading_flags_no_flags() {
        assert_eq!(strip_leading_flags("gpt-4o"), "gpt-4o");
    }

    #[test]
    fn test_strip_leading_flags_invalid_group_not_stripped() {
        assert_eq!(strip_leading_flags("(?invalid)test"), "(?invalid)test");
    }

    #[test]
    fn test_strip_leading_flags_empty_string() {
        assert_eq!(strip_leading_flags(""), "");
    }

    // ── derive_test_string ────────────────────────────────────────────────────

    #[test]
    fn test_derive_test_string_simple_pattern() {
        assert_eq!(derive_test_string("(?i)claude-3-haiku"), "claude-3-haiku");
    }

    #[test]
    fn test_derive_test_string_stops_at_optional_group() {
        assert_eq!(
            derive_test_string("(?i)gpt-4o(?:-\\d{4}[-\\d]*)?$"),
            "gpt-4o"
        );
    }

    #[test]
    fn test_derive_test_string_stops_at_dollar() {
        assert_eq!(
            derive_test_string("(?i)claude-3-sonnet$"),
            "claude-3-sonnet"
        );
    }

    #[test]
    fn test_derive_test_string_backslash_escape() {
        assert_eq!(derive_test_string("(?i)gpt-3\\.5"), "gpt-3.5");
    }

    #[test]
    fn test_derive_test_string_strips_caret_anchor() {
        assert_eq!(derive_test_string("(?i)^model-name"), "model-name");
    }

    #[test]
    fn test_derive_test_string_no_flags_plain_literal() {
        assert_eq!(derive_test_string("my-model"), "my-model");
    }

    #[test]
    fn test_derive_test_string_stops_at_dot_metachar() {
        assert_eq!(derive_test_string("abc.def"), "abc");
    }

    #[test]
    fn test_derive_test_string_stops_at_pipe() {
        assert_eq!(derive_test_string("foo|bar"), "foo");
    }

    #[test]
    fn test_derive_test_string_skips_optional_provider_prefix_group() {
        assert_eq!(
            derive_test_string(
                r"(?i)^(?:[\w-]+[/.:])*gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2}|-\d{8})?$"
            ),
            "gpt-5.4-mini"
        );
        assert_eq!(derive_test_string(r"(?i)(?:openai/)?gpt-4o"), "gpt-4o");
    }

    #[test]
    fn test_derive_test_string_keeps_required_leading_group() {
        // A group that must match is part of the name; it stops literal collection.
        assert_eq!(derive_test_string(r"(?i)(gpt|o)-4"), "");
    }

    // ── validate_definition ───────────────────────────────────────────────────

    fn default_tier() -> PricingTierDefinition {
        PricingTierDefinition {
            name: "default".to_string(),
            condition: None,
            prices: Default::default(),
            utc_windows: Vec::new(),
            rules: Vec::new(),
            priority: 0,
        }
    }

    fn valid_definition() -> ModelPricingDefinition {
        ModelPricingDefinition {
            name: "GPT-4o".to_string(),
            match_pattern: "(?i)gpt-4o".to_string(),
            tiers: vec![default_tier()],
            ..Default::default()
        }
    }

    #[test]
    fn test_validate_definition_valid_passes() {
        assert!(validate_definition(&valid_definition()).is_ok());
    }

    #[test]
    fn test_validate_definition_empty_name_fails() {
        let mut def = valid_definition();
        def.name = "   ".to_string();
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("Model name is required"));
    }

    #[test]
    fn test_validate_definition_name_too_long_fails() {
        let mut def = valid_definition();
        def.name = "a".repeat(257);
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("256 characters or fewer"));
    }

    #[test]
    fn test_validate_definition_name_exactly_256_passes() {
        let mut def = valid_definition();
        def.name = "a".repeat(256);
        assert!(validate_definition(&def).is_ok());
    }

    #[test]
    fn test_validate_definition_empty_match_pattern_fails() {
        let mut def = valid_definition();
        def.match_pattern = "   ".to_string();
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("Match pattern is required"));
    }

    #[test]
    fn test_validate_definition_match_pattern_too_long_fails() {
        let mut def = valid_definition();
        def.match_pattern = "a".repeat(513);
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("512 characters or fewer"));
    }

    #[test]
    fn test_validate_definition_invalid_regex_fails() {
        let mut def = valid_definition();
        def.match_pattern = "[unclosed".to_string();
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("Invalid regex pattern"));
    }

    #[test]
    fn test_validate_definition_empty_tiers_fails() {
        let mut def = valid_definition();
        def.tiers = vec![];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("At least one pricing tier is required"));
    }

    #[test]
    fn test_validate_definition_all_conditional_tiers_fails() {
        use config::meta::model_pricing::TierCondition;
        let mut def = valid_definition();
        def.tiers = vec![PricingTierDefinition {
            name: "tier1".to_string(),
            condition: Some(TierCondition {
                usage_key: "input".to_string(),
                value: 100.0,
                ..Default::default()
            }),
            prices: Default::default(),
            utc_windows: Vec::new(),
            rules: Vec::new(),
            priority: 0,
        }];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("At least one tier must have no condition"));
    }

    #[test]
    fn test_validate_definition_all_time_windowed_tiers_fails() {
        use config::meta::model_pricing::UtcTimeWindow;
        let mut def = valid_definition();
        // Peak + "off-peak" both windowed leaves no tier for a span outside both.
        def.tiers = vec![
            PricingTierDefinition {
                name: "peak".to_string(),
                utc_windows: vec![UtcTimeWindow::from_hm((1, 0), (4, 0))],
                rules: Vec::new(),
                ..default_tier()
            },
            PricingTierDefinition {
                name: "off-peak".to_string(),
                utc_windows: vec![UtcTimeWindow::from_hm((10, 0), (1, 0))],
                rules: Vec::new(),
                ..default_tier()
            },
        ];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("no condition, no time window and no rule"));
    }

    #[test]
    fn test_validate_definition_all_rule_restricted_tiers_fails() {
        use config::meta::model_pricing::{RuleOp, TierRule};
        let mut def = valid_definition();
        // Only a Flex tier leaves no tier for a span sent on the standard service tier.
        def.tiers = vec![PricingTierDefinition {
            name: "flex".to_string(),
            rules: vec![TierRule::new(
                &["openai.request.service_tier"],
                RuleOp::In,
                &["flex"],
                None,
            )],
            ..default_tier()
        }];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("no rule"));
    }

    #[test]
    fn test_validate_definition_rejects_invalid_rule() {
        use config::meta::model_pricing::{RuleOp, TierRule};
        let mut def = valid_definition();
        def.tiers.push(PricingTierDefinition {
            name: "flex".to_string(),
            rules: vec![TierRule::new(&[" "], RuleOp::In, &["flex"], None)],
            ..default_tier()
        });
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("Tier 'flex'") && err.contains("attribute key"));

        def.tiers[1].rules[0].keys = vec!["openai.request.service_tier".to_string()];
        def.tiers[1].rules[0].values = vec!["".to_string()];
        assert!(
            validate_definition(&def)
                .unwrap_err()
                .contains("at least one value")
        );

        def.tiers[1].rules[0].values = vec!["flex".to_string()];
        assert!(validate_definition(&def).is_ok());
    }

    #[test]
    fn test_validate_definition_rule_tier_before_default_fails() {
        use config::meta::model_pricing::{RuleOp, TierRule};
        let mut def = valid_definition();
        def.tiers.insert(
            0,
            PricingTierDefinition {
                name: "flex".to_string(),
                rules: vec![TierRule::new(
                    &["service_tier"],
                    RuleOp::In,
                    &["flex"],
                    None,
                )],
                ..default_tier()
            },
        );
        assert!(
            validate_definition(&def)
                .unwrap_err()
                .contains("default tier")
        );
        def.tiers.swap(0, 1);
        assert!(validate_definition(&def).is_ok());
    }

    #[test]
    fn test_validate_definition_windowed_tier_with_default_passes() {
        use config::meta::model_pricing::UtcTimeWindow;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "peak".to_string(),
                utc_windows: vec![
                    UtcTimeWindow::from_hm((1, 0), (4, 0)),
                    UtcTimeWindow::from_hm((6, 0), (10, 0)),
                ],
                rules: Vec::new(),
                ..default_tier()
            },
            default_tier(),
        ];
        assert!(validate_definition(&def).is_ok());
    }

    #[test]
    fn test_validate_definition_window_out_of_range_fails() {
        use config::meta::model_pricing::UtcTimeWindow;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "peak".to_string(),
                utc_windows: vec![UtcTimeWindow {
                    start_minute: 60,
                    end_minute: 1441,
                }],
                ..default_tier()
            },
            default_tier(),
        ];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("within 0-1440 minutes"));
    }

    #[test]
    fn test_validate_definition_window_end_of_day_passes() {
        use config::meta::model_pricing::UtcTimeWindow;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "night".to_string(),
                utc_windows: vec![UtcTimeWindow::from_hm((22, 0), (24, 0))],
                ..default_tier()
            },
            default_tier(),
        ];
        assert!(validate_definition(&def).is_ok());
    }

    #[test]
    fn test_validate_definition_degenerate_window_fails() {
        use config::meta::model_pricing::UtcTimeWindow;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "peak".to_string(),
                utc_windows: vec![UtcTimeWindow {
                    start_minute: 300,
                    end_minute: 300,
                }],
                ..default_tier()
            },
            default_tier(),
        ];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("start and end are the same"));
    }

    #[test]
    fn test_validate_definition_tier_empty_condition_usage_key_fails() {
        use config::meta::model_pricing::TierCondition;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "conditional".to_string(),
                condition: Some(TierCondition {
                    usage_key: "  ".to_string(),
                    value: 1.0,
                    ..Default::default()
                }),
                prices: Default::default(),
                utc_windows: Vec::new(),
                rules: Vec::new(),
                priority: 0,
            },
            default_tier(),
        ];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("empty usage_key"));
    }

    #[test]
    fn test_validate_definition_tier_nan_condition_value_fails() {
        use config::meta::model_pricing::TierCondition;
        let mut def = valid_definition();
        def.tiers = vec![
            PricingTierDefinition {
                name: "cond".to_string(),
                condition: Some(TierCondition {
                    usage_key: "input".to_string(),
                    value: f64::NAN,
                    ..Default::default()
                }),
                prices: Default::default(),
                utc_windows: Vec::new(),
                rules: Vec::new(),
                priority: 0,
            },
            default_tier(),
        ];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("finite number"));
    }

    #[test]
    fn test_validate_definition_nan_price_fails() {
        let mut def = valid_definition();
        let mut tier = default_tier();
        tier.prices.insert("input".to_string(), f64::NAN);
        def.tiers = vec![tier];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains("finite number"));
    }

    #[test]
    fn test_validate_definition_negative_price_fails() {
        let mut def = valid_definition();
        let mut tier = default_tier();
        tier.prices.insert("input".to_string(), -0.001);
        def.tiers = vec![tier];
        let err = validate_definition(&def).unwrap_err();
        assert!(err.contains(">= 0"));
    }

    #[test]
    fn test_validate_definition_zero_price_passes() {
        let mut def = valid_definition();
        let mut tier = default_tier();
        tier.prices.insert("input".to_string(), 0.0);
        def.tiers = vec![tier];
        assert!(validate_definition(&def).is_ok());
    }

    // ── captured_models ───────────────────────────────────────────────────────

    fn entry(name: &str, pattern: &str, source: PricingSource) -> CachedModelPricing {
        CachedModelPricing {
            definition: ModelPricingDefinition {
                id: Some(svix_ksuid::Ksuid::new(None, None)),
                name: name.to_string(),
                match_pattern: pattern.to_string(),
                source,
                ..Default::default()
            },
            compiled_regex: regex::Regex::new(pattern).unwrap(),
        }
    }

    fn org_candidate(pattern: &str) -> CachedModelPricing {
        entry("", pattern, PricingSource::Org)
    }

    fn find<'a>(captured: &'a [CapturedModel], model: &str) -> Option<&'a CapturedModel> {
        captured.iter().find(|c| c.model_name == model)
    }

    fn built_in_gpt_4o() -> Vec<CachedModelPricing> {
        vec![
            entry("GPT-4o", r"(?i)^gpt-4o$", PricingSource::BuiltIn),
            entry("GPT-4o Mini", r"(?i)^gpt-4o-mini$", PricingSource::BuiltIn),
        ]
    }

    #[test]
    fn test_captured_models_prefix_rule_also_catches_other_models() {
        let captured = captured_models(&built_in_gpt_4o(), &org_candidate(r"(?i)^gpt-4o"));

        assert_eq!(
            captured.first(),
            Some(&CapturedModel {
                model_name: "gpt-4o".to_string(),
                match_kind: MatchKind::Exact,
                primary: true,
                replaces: Some(PricingRuleRef {
                    name: "GPT-4o".to_string(),
                    source: PricingSource::BuiltIn,
                }),
            })
        );
        assert_eq!(
            find(&captured, "gpt-4o-mini"),
            Some(&CapturedModel {
                model_name: "gpt-4o-mini".to_string(),
                match_kind: MatchKind::Approximate,
                primary: false,
                replaces: Some(PricingRuleRef {
                    name: "GPT-4o Mini".to_string(),
                    source: PricingSource::BuiltIn,
                }),
            })
        );
        assert!(find(&captured, "gpt-4").is_none());
    }

    #[test]
    fn test_captured_models_anchored_rule_catches_only_its_model() {
        let captured = captured_models(&built_in_gpt_4o(), &org_candidate(r"(?i)^gpt-4o$"));
        let names: Vec<&str> = captured.iter().map(|c| c.model_name.as_str()).collect();
        assert_eq!(names, ["gpt-4o"]);
    }

    #[test]
    fn test_captured_models_skips_models_a_same_source_rule_prices_exactly() {
        let mut entries = built_in_gpt_4o();
        entries.push(entry("org-mini", r"(?i)^gpt-4o-mini$", PricingSource::Org));

        let captured = captured_models(&entries, &org_candidate(r"(?i)^gpt-4o"));
        assert!(find(&captured, "gpt-4o").is_some());
        assert!(find(&captured, "gpt-4o-mini").is_none());
    }
}
