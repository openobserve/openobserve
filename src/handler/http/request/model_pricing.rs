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

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::model_pricing::{BUILT_IN_ORG, META_ORG, ModelPricingDefinition, PricingSource};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::auth::{UserEmail, check_permissions},
    crate::handler::http::extractors::Headers,
};

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::db::model_pricing};

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
        "settings",
        "LIST",
        None,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    // Fetch org-specific entries
    let mut items = match model_pricing::list(&org_id).await {
        Ok(items) => items,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    // For non-meta orgs, also include inherited entries from the meta org.
    if org_id != META_ORG && org_id != BUILT_IN_ORG {
        match model_pricing::list(META_ORG).await {
            Ok(meta_items) => items.extend(meta_items),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    }

    // Include built-in entries (synced from GitHub).
    if org_id != BUILT_IN_ORG {
        match model_pricing::list(BUILT_IN_ORG).await {
            Ok(built_in_items) => items.extend(built_in_items),
            Err(e) => return MetaHttpResponse::internal_error(e),
        }
    }

    MetaHttpResponse::json(items)
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
        &model_id,
        &org_id,
        &user_email.user_id,
        "settings",
        "GET",
        None,
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
        "settings",
        "PUT",
        None,
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
        &model_id,
        &org_id,
        &user_email.user_id,
        "settings",
        "PUT",
        None,
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
        &model_id,
        &org_id,
        &user_email.user_id,
        "settings",
        "DELETE",
        None,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    match model_pricing::delete_by_id(&org_id, &model_id).await {
        Ok(true) => MetaHttpResponse::ok("Model pricing definition deleted"),
        Ok(false) => MetaHttpResponse::not_found("Model pricing definition not found"),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("Built-in") {
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
        "settings",
        "LIST",
        None,
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

    MetaHttpResponse::json(BuiltInModelPricingResponse {
        models,
        source_url,
        last_updated: chrono::Utc::now().timestamp(),
    })
}

/// Map errors from `model_pricing::set` to appropriate HTTP responses.
/// Duplicate-name errors are returned as 400 Bad Request; everything else is 500.
fn map_set_error(e: anyhow::Error) -> Response {
    let msg = e.to_string();
    if msg.contains("already exists") {
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
        "settings",
        "PUT",
        None,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }

    match crate::service::db::model_pricing_sync::sync_built_in_from_github(true).await {
        Ok(result) => MetaHttpResponse::json(result),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
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
        .size_limit(crate::service::db::model_pricing::REGEX_SIZE_LIMIT)
        .build()
    {
        return Err(format!("Invalid regex pattern: {e}"));
    }
    if item.tiers.is_empty() {
        return Err("At least one pricing tier is required".to_string());
    }
    for tier in &item.tiers {
        if let Some(ref cond) = tier.condition {
            if cond.usage_key.trim().is_empty() {
                return Err(format!(
                    "Tier '{}' has a condition with an empty usage_key",
                    tier.name
                ));
            }
            if cond.value.is_nan() || cond.value.is_infinite() {
                return Err(format!(
                    "Tier '{}' condition value must be a finite number, got {}",
                    tier.name, cond.value
                ));
            }
        }
        for (key, &price) in &tier.prices {
            if price.is_nan() || price.is_infinite() {
                return Err(format!(
                    "Price for '{}' in tier '{}' must be a finite number, got {}",
                    key, tier.name, price
                ));
            }
            if price < 0.0 {
                return Err(format!(
                    "Price for '{}' in tier '{}' must be >= 0, got {}",
                    key, tier.name, price
                ));
            }
        }
    }
    Ok(())
}
