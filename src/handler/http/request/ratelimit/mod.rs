// Copyright 2025 OpenObserve Inc.
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

use std::io::Error;

use actix_multipart::Multipart;
use actix_web::{HttpResponse, get, put, web};
use config::meta::ratelimit::RatelimitRuleUpdater;
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::meta::http::HttpResponse as MetaHttpResponse,
        service::{ratelimit, ratelimit::rule::RatelimitError},
    },
    actix_web::http,
    futures_util::{StreamExt, TryStreamExt},
    infra::table::ratelimit::RuleEntry,
    o2_ratelimit::dataresource::{
        default_rules::{
            ApiGroupOperation, DEFAULT_GLOBAL_ORG_IDENTIFIER, DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER,
            DEFAULT_THRESHOLD_NO_LIMIT_FRONTEND, RATELIMIT_API_MAPPING,
            get_ratelimit_global_default_api_info, has_group_name_and_operation,
        },
        default_rules_provider::get_default_rules,
    },
    std::io::Write,
};

#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Deserialize)]
struct UpdateQueryParams {
    update_type: String,
    user_role: Option<String>,
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Clone, Deserialize)]
struct UpdateQueryParams();

#[cfg(feature = "enterprise")]
async fn validate_ratelimit_updater(rules: &RatelimitRuleUpdater) -> Result<(), anyhow::Error> {
    for (api_group_name, operations) in rules.iter() {
        for (operation, threshold) in operations.iter() {
            // Validate operation format
            let operation = ApiGroupOperation::try_from(operation.as_str());
            if operation.is_err() {
                return Err(anyhow::anyhow!(
                    "rule operation_name is err, {:?}",
                    operation
                ));
            }
            let operation = operation.unwrap();

            // Validate group name and operation combination
            if !has_group_name_and_operation(api_group_name, operation).await {
                return Err(anyhow::anyhow!(
                    "rule module_name and operation_name is not found, module_name: {:?} operation_name: {:?}",
                    api_group_name,
                    operation,
                ));
            }

            // Validate threshold
            if *threshold < DEFAULT_THRESHOLD_NO_LIMIT_FRONTEND {
                return Err(anyhow::anyhow!(
                    "threshold must be greater than or equal to {}, got {}",
                    DEFAULT_THRESHOLD_NO_LIMIT_FRONTEND,
                    threshold
                ));
            }
        }
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
impl From<RatelimitError> for HttpResponse {
    fn from(value: RatelimitError) -> Self {
        match value {
            RatelimitError::NotFound(_) => MetaHttpResponse::not_found(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}

/// listApiModule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listApiModule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/ratelimit/api_modules")]
pub async fn api_modules(_path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let info = get_ratelimit_global_default_api_info().await;
        let all_group = info.get_all_groups();

        Ok(HttpResponse::Ok().json(all_group))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// listModuleRatelimitRule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listModuleRatelimitRule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/ratelimit/module_list")]
pub async fn list_module_ratelimit(path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let global_default_rules = get_default_rules()
            .await
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        // module-level is org-level, we first look for the custom org-level rules
        let mut all_rules = infra::table::ratelimit::fetch_rules(
            global_default_rules.clone(),
            Some(org_id.clone()),
            Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
        )
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        // if we have no custom org-level, look for the global org-level
        if all_rules.is_empty() {
            all_rules = infra::table::ratelimit::fetch_rules(
                global_default_rules,
                Some(DEFAULT_GLOBAL_ORG_IDENTIFIER.to_string()),
                Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
            )
            .await
            .unwrap();
        }

        let info = get_ratelimit_global_default_api_info().await;
        let api_group_info = info.api_groups(Some(org_id.as_str()), all_rules).await;
        // let res = RatelimitList { api_group_info };

        Ok(HttpResponse::Ok().json(api_group_info))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// listRoleRatelimitRule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listRoleRatelimitRule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
        ("user_role" = String, Path, description = "User Role Name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/ratelimit/role_list/{user_role}")]
pub async fn list_role_ratelimit(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, user_role) = path.into_inner();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let global_default_rules = get_default_rules().await.unwrap();
        let all_rules = infra::table::ratelimit::fetch_rules(
            global_default_rules,
            Some(org_id.clone()),
            Some(user_role),
        )
        .await
        .unwrap();

        let info = get_ratelimit_global_default_api_info().await;
        let api_group_info = info.api_groups(Some(org_id.as_str()), all_rules).await;
        // let res = RatelimitList { api_group_info };

        Ok(HttpResponse::Ok().json(api_group_info))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// UpdateRatelimitRule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "UpdateRatelimitRule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("update_type" = String, Query, description = "Update Type"),
        ("user_role" = Option<String>, Query, description = "UserRole name"),
    ),
    request_body(content = String, description = "json array", content_type = "application/json", example = json!({"Key Values": {"list": 0,"create": 0,"delete": 0,"get": 0},"Service Accounts": {"update": 0,"list": 0,"create": 0,"delete": 0,"get": 0}})),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/ratelimit/update")]
pub async fn update_ratelimit(
    path: web::Path<String>,
    query: web::Query<UpdateQueryParams>,
    updater: web::Json<RatelimitRuleUpdater>,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();
        let query = query.into_inner();

        let updater = updater.into_inner();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        if let Err(e) = validate_ratelimit_updater(&updater).await {
            return Ok(MetaHttpResponse::bad_request(format!(
                "validate ratelimit updater error: {}",
                e,
            )));
        }

        let user_role = match query.update_type.as_str() {
            "module" => DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string(),
            "role" => {
                if query.user_role.is_none() {
                    return Ok(MetaHttpResponse::bad_request(
                        "user_role param is required when update_type=role".to_string(),
                    ));
                } else {
                    query.user_role.clone().unwrap()
                }
            }
            _ => {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "update_type is incorrect: {}, only support module or role",
                    query.update_type,
                )));
            }
        };

        let rules = RatelimitRule::from_updater(org_id.as_str(), user_role.as_str(), &updater);
        match ratelimit::rule::update(RuleEntry::UpsertBatch(rules)).await {
            Ok(()) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                "Ratelimit rule updated successfully".to_string(),
            ))),
            Err(e) => Ok(e.into()),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        let _ = query;
        drop(updater);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// UploadRatelimitRule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "UploadRatelimitRule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("update_type" = String, Query, description = "Update Type"),
        ("user_role" = Option<String>, Query, description = "UserRole name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/ratelimit/upload")]
pub async fn upload_org_ratelimit(
    path: web::Path<String>,
    query: web::Query<UpdateQueryParams>,
    #[cfg_attr(not(feature = "enterprise"), allow(unused_mut))] mut payload: Multipart,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();

        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let user_role = match query.update_type.as_str() {
            "module" => DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string(),
            "role" => {
                if query.user_role.is_none() {
                    return Ok(MetaHttpResponse::bad_request(
                        "user_role param is required when update_type=role".to_string(),
                    ));
                } else {
                    query.user_role.clone().unwrap()
                }
            }
            _ => {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "update_type is incorrect: {}, only support module or role",
                    query.update_type,
                )));
            }
        };

        // Process multipart payload
        while let Ok(Some(mut field)) = payload.try_next().await {
            // Check if this is the JSON field
            if field.name() == Some("rules") {
                // Collect field data
                let mut json_data = Vec::new();
                while let Some(chunk) = field.next().await {
                    let data = chunk.unwrap();
                    json_data.write_all(&data)?;
                }

                // Parse JSON data into RatelimitRuleUpdater
                match serde_json::from_slice::<RatelimitRuleUpdater>(&json_data) {
                    Ok(updater) => {
                        // Validate updater
                        if let Err(e) = validate_ratelimit_updater(&updater).await {
                            return Ok(MetaHttpResponse::bad_request(format!(
                                "validate ratelimit updater error: {}",
                                e,
                            )));
                        }

                        let rules = RatelimitRule::from_updater(
                            org_id.as_str(),
                            user_role.as_str(),
                            &updater,
                        );
                        // Save rules
                        match ratelimit::rule::save_batch(RuleEntry::UpsertBatch(rules)).await {
                            Ok(_) => {
                                return Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                                    http::StatusCode::OK.into(),
                                    "Ratelimit rule uploaded successfully".to_string(),
                                )));
                            }
                            Err(e) => {
                                return Ok(MetaHttpResponse::internal_error(format!(
                                    "Failed to save ratelimit rules: {}",
                                    e
                                )));
                            }
                        }
                    }
                    Err(e) => {
                        return Ok(MetaHttpResponse::internal_error(format!(
                            "Ratelimit rule upload error {:?}",
                            e
                        )));
                    }
                }
            }
        }

        // If we get here, we didn't find the expected JSON field
        Ok(MetaHttpResponse::bad_request(
            "Ratelimit rule missing".to_string(),
        ))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        let _ = query;
        let _ = payload;
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}
