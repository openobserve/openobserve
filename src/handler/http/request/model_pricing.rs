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
    response::Response,
};
use config::meta::model_pricing::{META_ORG, ModelPricingDefinition};
use serde::{Deserialize, Serialize};
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::auth::{UserEmail, check_permissions},
    crate::handler::http::extractors::Headers,
};

use crate::{common::meta::http::HttpResponse as MetaHttpResponse, service::db::model_pricing};

/// A model pricing definition enriched with an `inherited` flag for the API response.
/// When `inherited` is true, this definition comes from the `_meta` org and applies
/// as a fallback. The org can override it by creating their own definition for the same model.
#[derive(Serialize)]
struct ModelPricingResponse {
    #[serde(flatten)]
    definition: ModelPricingDefinition,
    /// True if this definition is inherited from the `_meta` org (not org-specific).
    inherited: bool,
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
        "settings",
        "LIST",
        None,
    )
    .await
    {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    // Fetch org-specific entries
    let org_items = match model_pricing::list(&org_id).await {
        Ok(items) => items,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    // For the default org itself, no inheritance — just return its own entries.
    if org_id == META_ORG {
        let response: Vec<ModelPricingResponse> = org_items
            .into_iter()
            .map(|d| ModelPricingResponse {
                definition: d,
                inherited: false,
            })
            .collect();
        return MetaHttpResponse::json(response);
    }

    // Fetch default org entries as inherited fallbacks.
    let default_items = match model_pricing::list(META_ORG).await {
        Ok(items) => items,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };

    let mut response: Vec<ModelPricingResponse> = org_items
        .into_iter()
        .map(|d| ModelPricingResponse {
            definition: d,
            inherited: false,
        })
        .collect();
    response.extend(default_items.into_iter().map(|d| ModelPricingResponse {
        definition: d,
        inherited: true,
    }));

    MetaHttpResponse::json(response)
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
        Ok(Some(item)) if item.org_id == org_id => MetaHttpResponse::json(item),
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
        (status = 200, description = "Success", content_type = "application/json", body = ModelPricingDefinition),
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
    item.org_id = org_id;
    item.id = None; // Force new ID generation

    if let Err(e) = validate_definition(&item) {
        return MetaHttpResponse::bad_request(e);
    }

    match model_pricing::set(item).await {
        Ok(saved) => MetaHttpResponse::json(saved),
        Err(e) => MetaHttpResponse::internal_error(e),
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
            // Preserve the ID and org_id
            item.id = existing.id;
            item.org_id = org_id;
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
        Err(e) => MetaHttpResponse::internal_error(e),
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
    match model_pricing::get_by_id(&model_id).await {
        Ok(Some(item)) if item.org_id == org_id => {}
        Ok(Some(_)) | Ok(None) => {
            return MetaHttpResponse::not_found("Model pricing definition not found");
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    match model_pricing::delete_by_id(&org_id, &model_id).await {
        Ok(_) => MetaHttpResponse::ok("Model pricing definition deleted"),
        Err(e) => MetaHttpResponse::internal_error(e),
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
    Query(query): Query<BuiltInQuery>,
) -> Response {
    use crate::service::github::GitHubDataService;

    let source_url = config::get_config().common.model_pricing_source_url.clone();

    let github_service = GitHubDataService::new();

    let models: Vec<BuiltInModelPricingEntry> = match github_service
        .fetch_json::<Vec<BuiltInModelPricingEntry>>(&source_url)
        .await
    {
        Ok(m) => m,
        Err(e) => {
            log::error!("[model_pricing] failed to fetch built-in models from {source_url}: {e}");
            return MetaHttpResponse::internal_error(format!(
                "Failed to fetch built-in model pricing: {e}"
            ));
        }
    };

    let search = query.search.to_lowercase();
    let models = if search.is_empty() {
        models
    } else {
        models
            .into_iter()
            .filter(|m| {
                m.name.to_lowercase().contains(&search)
                    || m.provider.to_lowercase().contains(&search)
                    || m.description.to_lowercase().contains(&search)
            })
            .collect()
    };

    MetaHttpResponse::json(BuiltInModelPricingResponse {
        models,
        source_url,
        last_updated: chrono::Utc::now().timestamp(),
    })
}

/// Max compiled NFA size for user-supplied regex patterns (64 KB).
/// Prevents excessive memory/CPU usage from complex patterns.
const REGEX_SIZE_LIMIT: usize = 1 << 16;

fn validate_definition(item: &ModelPricingDefinition) -> Result<(), String> {
    if item.name.trim().is_empty() {
        return Err("Model name is required".to_string());
    }
    if item.match_pattern.trim().is_empty() {
        return Err("Match pattern is required".to_string());
    }
    if item.match_pattern.len() > 512 {
        return Err("Match pattern must be 512 characters or fewer".to_string());
    }
    if let Err(e) = regex::RegexBuilder::new(&item.match_pattern)
        .size_limit(REGEX_SIZE_LIMIT)
        .build()
    {
        return Err(format!("Invalid regex pattern: {e}"));
    }
    if item.tiers.is_empty() {
        return Err("At least one pricing tier is required".to_string());
    }
    for tier in &item.tiers {
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
