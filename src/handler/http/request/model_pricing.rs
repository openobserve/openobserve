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

use axum::{Json, extract::Path, response::Response};
use config::meta::model_pricing::{ModelPricingDefinition, PricingTierDefinition};

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
    description = "Returns all model pricing definitions (user-defined and built-in) for the organization.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Vec<ModelPricingDefinition>),
        (status = 500, description = "Internal server error"),
    ),
)]
pub async fn list(Path(org_id): Path<String>) -> Response {
    match model_pricing::list(&org_id).await {
        Ok(items) => MetaHttpResponse::json(items),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
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
pub async fn get(Path((org_id, model_id)): Path<(String, String)>) -> Response {
    match model_pricing::get_by_id(&model_id).await {
        Ok(Some(item)) if item.org_id == org_id => MetaHttpResponse::json(item),
        Ok(Some(_)) | Ok(None) => {
            MetaHttpResponse::not_found("Model pricing definition not found")
        }
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
    Json(mut item): Json<ModelPricingDefinition>,
) -> Response {
    item.org_id = org_id;
    item.id = None; // Force new ID generation

    if item.name.trim().is_empty() {
        return MetaHttpResponse::bad_request("Model name is required");
    }
    if item.match_pattern.len() > 512 {
        return MetaHttpResponse::bad_request("Match pattern must be 512 characters or fewer");
    }
    if let Err(e) = regex::Regex::new(&item.match_pattern) {
        return MetaHttpResponse::bad_request(format!("Invalid regex pattern: {e}"));
    }
    if item.tiers.is_empty() {
        return MetaHttpResponse::bad_request("At least one pricing tier is required");
    }
    if let Err(e) = validate_tier_prices(&item.tiers) {
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
    Json(mut item): Json<ModelPricingDefinition>,
) -> Response {
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

    if item.name.trim().is_empty() {
        return MetaHttpResponse::bad_request("Model name is required");
    }
    if item.match_pattern.len() > 512 {
        return MetaHttpResponse::bad_request("Match pattern must be 512 characters or fewer");
    }
    if let Err(e) = regex::Regex::new(&item.match_pattern) {
        return MetaHttpResponse::bad_request(format!("Invalid regex pattern: {e}"));
    }
    if item.tiers.is_empty() {
        return MetaHttpResponse::bad_request("At least one pricing tier is required");
    }
    if let Err(e) = validate_tier_prices(&item.tiers) {
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
pub async fn delete(Path((org_id, model_id)): Path<(String, String)>) -> Response {
    match model_pricing::get_by_id(&model_id).await {
        Ok(Some(item)) if item.org_id == org_id => {}
        Ok(Some(_)) | Ok(None) => {
            return MetaHttpResponse::not_found("Model pricing definition not found")
        }
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    match model_pricing::delete_by_id(&org_id, &model_id).await {
        Ok(_) => MetaHttpResponse::ok("Model pricing definition deleted"),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

fn validate_tier_prices(tiers: &[PricingTierDefinition]) -> Result<(), String> {
    for tier in tiers {
        for (key, &price) in &tier.prices {
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
