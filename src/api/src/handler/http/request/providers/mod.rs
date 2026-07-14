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

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::UserEmail;
#[cfg(feature = "enterprise")]
use crate::handler::http::extractors::Headers;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::providers::{
        ListProvidersResponseBody, ProviderRequestBody, ProviderResponseBody,
    },
    service::providers::{self, ProviderError},
};

/// ListProviders
#[utoipa::path(
    get,
    path = "/{org_id}/providers",
    context_path = "/api",
    tag = "Providers",
    operation_id = "ListProviders",
    summary = "List LLM providers",
    description = "Lists all configured LLM providers for the organization. Auth credentials are masked in responses.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", body = inline(ListProvidersResponseBody)),
        (status = 500, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "list"})),
    ),
)]
pub async fn list_providers(
    Path(org_id): Path<String>,
    #[cfg(feature = "enterprise")] Headers(user_email): Headers<UserEmail>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let permitted_objects = {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &user_email.user_id,
            "GET",
            "provider",
        )
        .await
        {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::forbidden(e.to_string()),
        }
    };
    #[cfg(not(feature = "enterprise"))]
    let permitted_objects = None;

    match providers::list_providers(&org_id, permitted_objects).await {
        Ok(list) => {
            let body: ListProvidersResponseBody = list.into();
            MetaHttpResponse::json(body)
        }
        Err(err) => err.into(),
    }
}

/// CreateProvider
#[utoipa::path(
    post,
    path = "/{org_id}/providers",
    context_path = "/api",
    tag = "Providers",
    operation_id = "CreateProvider",
    summary = "Create LLM provider",
    description = "Creates a new LLM provider configuration. The auth_config field is write-once and cannot be retrieved after creation.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(ProviderRequestBody), description = "Provider configuration"),
    responses(
        (status = 200, description = "Success", body = inline(ProviderResponseBody)),
        (status = 400, description = "Bad Request", body = ()),
        (status = 500, description = "Internal Server Error", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "create"})),
    ),
)]
pub async fn create_provider(
    Path(org_id): Path<String>,
    axum::Json(body): axum::Json<ProviderRequestBody>,
) -> Response {
    let mut provider: infra::table::providers::Provider = body.into();
    provider.org_id = org_id.clone();
    let now = chrono::Utc::now().timestamp_millis();
    provider.created_at = now;
    provider.updated_at = now;

    match providers::save_provider(&org_id, provider).await {
        Ok(p) => {
            let resp: ProviderResponseBody = p.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// GetProvider
#[utoipa::path(
    get,
    path = "/{org_id}/providers/{provider_id}",
    context_path = "/api",
    tag = "Providers",
    operation_id = "GetProvider",
    summary = "Get LLM provider by ID",
    description = "Retrieves a single LLM provider. The auth_config is masked.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider ID"),
    ),
    responses(
        (status = 200, body = inline(ProviderResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "get"})),
    ),
)]
pub async fn get_provider(Path((org_id, provider_id)): Path<(String, String)>) -> Response {
    match providers::get_provider(&org_id, &provider_id).await {
        Ok(p) => {
            let resp: ProviderResponseBody = p.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// UpdateProvider
#[utoipa::path(
    put,
    path = "/{org_id}/providers/{provider_id}",
    context_path = "/api",
    tag = "Providers",
    operation_id = "UpdateProvider",
    summary = "Update LLM provider",
    description = "Updates an existing LLM provider configuration.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider ID"),
    ),
    request_body(content = inline(ProviderRequestBody), description = "Updated provider configuration"),
    responses(
        (status = 200, description = "Updated", body = inline(ProviderResponseBody)),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "update"})),
    ),
)]
pub async fn update_provider(
    Path((org_id, provider_id)): Path<(String, String)>,
    axum::Json(body): axum::Json<ProviderRequestBody>,
) -> Response {
    let mut provider: infra::table::providers::Provider = body.into();
    provider.org_id = org_id.clone();
    provider.updated_at = chrono::Utc::now().timestamp_millis();

    match providers::update_provider(&org_id, &provider_id, provider).await {
        Ok(p) => {
            let resp: ProviderResponseBody = p.into();
            MetaHttpResponse::json(resp)
        }
        Err(err) => err.into(),
    }
}

/// DeleteProvider
#[utoipa::path(
    delete,
    path = "/{org_id}/providers/{provider_id}",
    context_path = "/api",
    tag = "Providers",
    operation_id = "DeleteProvider",
    summary = "Delete LLM provider",
    description = "Permanently deletes the LLM provider configuration.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider ID"),
    ),
    responses(
        (status = 200, description = "Deleted", body = String),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "delete"})),
    ),
)]
pub async fn delete_provider(Path((org_id, provider_id)): Path<(String, String)>) -> Response {
    match providers::delete_provider(&org_id, &provider_id).await {
        Ok(()) => MetaHttpResponse::ok("Provider deleted"),
        Err(err) => err.into(),
    }
}

/// TestProvider
#[utoipa::path(
    post,
    path = "/{org_id}/providers/{provider_id}/test",
    context_path = "/api",
    tag = "Providers",
    operation_id = "TestProvider",
    summary = "Test LLM provider connection",
    description = "Tests connectivity to the configured provider endpoint by making a lightweight API call.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("provider_id" = String, Path, description = "Provider ID"),
    ),
    responses(
        (status = 200, description = "Test result", body = String),
        (status = 404, description = "Not Found", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Providers", "operation": "test"})),
    ),
)]
pub async fn test_provider(Path((org_id, provider_id)): Path<(String, String)>) -> Response {
    match test_provider_connection(&org_id, &provider_id).await {
        Ok(msg) => MetaHttpResponse::ok(msg),
        Err(err) => err.into(),
    }
}

async fn test_provider_connection(
    org_id: &str,
    provider_id: &str,
) -> Result<String, ProviderError> {
    #[cfg(feature = "enterprise")]
    {
        let provider = providers::get_provider(org_id, provider_id).await?;
        let provider =
            o2_enterprise::enterprise::llm_evaluations::provider::PreparedProvider::parse(
                (&provider).into(),
            )
            .map_err(|e| ProviderError::InvalidConfig(e.to_string()))?;
        provider
            .test_connection()
            .await
            .map_err(|e| ProviderError::InfraError(infra::errors::Error::Message(e.to_string())))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = (org_id, provider_id);
        Err(ProviderError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_error_conversion() {
        let cases: Vec<(ProviderError, u16)> = vec![
            (ProviderError::MissingName, 400),
            (ProviderError::ProviderNameAlreadyExists, 400),
            (ProviderError::NotFound, 404),
            (
                ProviderError::InvalidConfig("bad endpoint".to_string()),
                400,
            ),
            (ProviderError::ProviderInUse("judge".to_string()), 409),
        ];
        for (err, expected) in cases {
            let resp: Response = err.into();
            assert_eq!(resp.status().as_u16(), expected);
        }
    }

    #[test]
    fn test_provider_error_infra_is_500() {
        let err = ProviderError::InfraError(infra::errors::Error::Message("db".to_string()));
        let resp: Response = err.into();
        assert_eq!(resp.status().as_u16(), 500);
    }
}
