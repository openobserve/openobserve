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

use axum::{extract::Path, response::Response};
use db::authz::{remove_ownership, set_ownership};
#[cfg(feature = "enterprise")]
use openobserve_core::auth::{UserEmail, is_ofga_object_visible};

#[cfg(feature = "enterprise")]
use crate::handler::http::extractors::Headers;
use crate::{
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    handler::http::models::score_configs::{
        ListScoreConfigVersionsResponseBody, ListScoreConfigsResponseBody, ScoreConfigRequestBody,
        ScoreConfigResponseBody, ScoreConfigUpdateRequestBody,
    },
    service::llm_evaluations::score_configs::{self, ScoreConfigError},
};

fn score_config_error_response(value: ScoreConfigError) -> Response {
    match value {
        ScoreConfigError::InfraError(err) => {
            log::error!("[ScoreConfig] internal error: {err}");
            MetaHttpResponse::internal_error("Internal server error")
        }
        ScoreConfigError::MissingName => {
            MetaHttpResponse::bad_request("Score config name cannot be empty")
        }
        ScoreConfigError::NotFound => MetaHttpResponse::not_found("Score config not found"),
        ScoreConfigError::DuplicateName => {
            MetaHttpResponse::conflict("Score config name already exists")
        }
        ScoreConfigError::InUseByScorer => MetaHttpResponse::conflict(value),
    }
}

/// ListScoreConfigs
#[utoipa::path(
    get,
    path = "/{org_id}/score_configs",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "ListScoreConfigs",
    summary = "List score configs",
    description = "Lists the latest active version of each score config in the organization.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, body = inline(ListScoreConfigsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "list"})),
    ),
)]
pub async fn list_score_configs(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "score_config",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    match score_configs::list_score_configs(&org_id).await {
        Ok(list) => {
            let list: Vec<infra::table::score_configs::ScoreConfig> = list
                .into_iter()
                .filter(|config| {
                    is_ofga_object_visible(
                        &org_id,
                        "score_config",
                        &config.entity_id,
                        permitted_objects.as_deref(),
                    )
                })
                .collect();
            let body: ListScoreConfigsResponseBody = list.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => score_config_error_response(err),
    }
}

/// CreateScoreConfig
#[utoipa::path(
    post,
    path = "/{org_id}/score_configs",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "CreateScoreConfig",
    summary = "Create score config (v1)",
    description = "Creates a new score config at version 1.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(ScoreConfigRequestBody), description = "Score config payload"),
    responses(
        (status = 200, body = inline(ScoreConfigResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "create"})),
    ),
)]
pub async fn create_score_config(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<ScoreConfigRequestBody>,
) -> Response {
    let config: infra::table::score_configs::ScoreConfig = body.into();
    match score_configs::save_score_config(&org_id, config).await {
        Ok(c) => {
            set_ownership(&org_id, "score_configs", Authz::new(&c.entity_id)).await;
            let resp: ScoreConfigResponseBody = c.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => score_config_error_response(err),
    }
}

/// GetScoreConfig
#[utoipa::path(
    get,
    path = "/{org_id}/score_configs/{entity_id}",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "GetScoreConfig",
    summary = "Get latest score config by entity id",
    description = "Retrieves the latest active version of a score config by stable entity id.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Score config stable entity id"),
    ),
    responses(
        (status = 200, body = inline(ScoreConfigResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "get"})),
    ),
)]
pub async fn get_score_config(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match score_configs::get_score_config(&org_id, &entity_id).await {
        Ok(c) => {
            let resp: ScoreConfigResponseBody = c.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => score_config_error_response(err),
    }
}

/// ListScoreConfigVersions
#[utoipa::path(
    get,
    path = "/{org_id}/score_configs/{entity_id}/versions",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "ListScoreConfigVersions",
    summary = "List all versions of a score config",
    description = "Lists every historical version of a score config by stable entity id, ordered by version descending.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Score config stable entity id"),
    ),
    responses(
        (status = 200, body = inline(ListScoreConfigVersionsResponseBody)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "list_versions"})),
    ),
)]
pub async fn list_score_config_versions(
    Path((org_id, entity_id)): Path<(String, String)>,
) -> Response {
    match score_configs::get_score_config_versions(&org_id, &entity_id).await {
        Ok(versions) => {
            let body: ListScoreConfigVersionsResponseBody = versions.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => score_config_error_response(err),
    }
}

/// UpdateScoreConfig
#[utoipa::path(
    put,
    path = "/{org_id}/score_configs/{entity_id}",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "UpdateScoreConfig",
    summary = "Update score config (version bump)",
    description = "Creates a new immutable version of the score config. data_type is preserved from the previous version.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Score config stable entity id"),
    ),
    request_body(content = inline(ScoreConfigUpdateRequestBody), description = "Score config payload"),
    responses(
        (status = 200, body = inline(ScoreConfigResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "update"})),
    ),
)]
pub async fn update_score_config(
    Path((org_id, entity_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<ScoreConfigUpdateRequestBody>,
) -> Response {
    let config: infra::table::score_configs::ScoreConfig = body.into();
    match score_configs::update_score_config(&org_id, &entity_id, config).await {
        Ok(c) => {
            let resp: ScoreConfigResponseBody = c.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => score_config_error_response(err),
    }
}

/// DeleteScoreConfig
#[utoipa::path(
    delete,
    path = "/{org_id}/score_configs/{entity_id}",
    context_path = "/api",
    tag = "ScoreConfigs",
    operation_id = "DeleteScoreConfig",
    summary = "Deactivate score config",
    description = "Soft-deletes the score config by deactivating all its versions.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("entity_id" = String, Path, description = "Score config stable entity id"),
    ),
    responses(
        (status = 200, description = "Deactivated", body = String),
        (status = 404, description = "Not Found", body = ()),
        (status = 409, description = "Conflict", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ScoreConfigs", "operation": "delete"})),
    ),
)]
pub async fn delete_score_config(Path((org_id, entity_id)): Path<(String, String)>) -> Response {
    match score_configs::delete_score_config(&org_id, &entity_id).await {
        Ok(()) => {
            remove_ownership(&org_id, "score_configs", Authz::new(&entity_id)).await;
            MetaHttpResponse::ok("Score config deactivated")
        }
        Err(err) => score_config_error_response(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_config_error_conversion() {
        let cases: Vec<(ScoreConfigError, u16)> = vec![
            (ScoreConfigError::MissingName, 400),
            (ScoreConfigError::NotFound, 404),
            (ScoreConfigError::DuplicateName, 409),
            (ScoreConfigError::InUseByScorer, 409),
        ];
        for (err, expected) in cases {
            let resp = score_config_error_response(err);
            assert_eq!(resp.status().as_u16(), expected);
        }
    }

    #[test]
    fn test_score_config_error_infra_is_500() {
        let err = ScoreConfigError::InfraError(infra::errors::Error::Message("db".to_string()));
        let resp = score_config_error_response(err);
        assert_eq!(resp.status().as_u16(), 500);
    }
}
