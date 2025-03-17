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
use config::meta::ratelimit::RatelimitRule;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::meta::http::HttpResponse as MetaHttpResponse,
        service::{ratelimit, ratelimit::rule::RatelimitError},
    },
    actix_web::http,
    config::meta::ratelimit::RatelimitRuleType,
    futures_util::{StreamExt, TryStreamExt},
    infra::table::ratelimit::RuleEntry,
    o2_ratelimit::dataresource::default_rules::{
        ApiGroupOperation, DEFAULT_GLOBAL_ORG_IDENTIFIER, has_group_name_and_operation,
    },
    o2_ratelimit::dataresource::{
        default_rules::{
            ApiGroup, DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER, RATELIMIT_API_MAPPING,
            get_ratelimit_global_default_api_info,
        },
        default_rules_provider::get_default_rules,
    },
    std::collections::HashMap,
    std::io::Write,
};

#[cfg(feature = "enterprise")]
async fn validate_ratelimit_rule(rule: &RatelimitRule) -> Result<(), anyhow::Error> {
    // Validate required fields
    if rule.org.is_empty() || rule.api_group_name.is_none() || rule.api_group_operation.is_none() {
        return Err(anyhow::anyhow!("rule fields is empty"));
    }

    // Validate rule type
    if let Some(rule_type) = &rule.rule_type {
        if rule_type != RatelimitRuleType::Exact.to_string().as_str()
            && rule_type != RatelimitRuleType::Regex.to_string().as_str()
        {
            return Err(anyhow::anyhow!("rule type error"));
        }
    } else {
        return Err(anyhow::anyhow!("no rule type"));
    }

    let operation = ApiGroupOperation::try_from(rule.api_group_operation.as_deref().unwrap());
    if operation.is_err() {
        return Err(anyhow::anyhow!(
            "rule api_group_operation is err, {:?}",
            operation
        ));
    }

    if !has_group_name_and_operation(rule.api_group_name.as_deref().unwrap(), operation.unwrap())
        .await
    {
        return Err(anyhow::anyhow!(
            "rule api_group_name and operation is err, {:?}",
            rule
        ));
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
#[cfg(feature = "enterprise")]
#[derive(serde::Serialize)]
struct RatelimitList {
    pub api_group_info: HashMap<String, HashMap<ApiGroupOperation, ApiGroup>>,
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

        let global_default_rules = get_default_rules().await.unwrap();
        // module-level is org-level, we first look for the custom org-level rules
        let mut all_rules = infra::table::ratelimit::fetch_rules(
            global_default_rules.clone(),
            Some(org_id.clone()),
            Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
        )
        .await
        .unwrap();

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
        let res = RatelimitList { api_group_info };

        Ok(HttpResponse::Ok().json(res))
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
        let res = RatelimitList { api_group_info };

        Ok(HttpResponse::Ok().json(res))
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
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/ratelimit/update")]
pub async fn update_ratelimit(
    path: web::Path<String>,
    rules: web::Json<Vec<RatelimitRule>>,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();
        let rules = rules.into_inner();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        // rules org field must eq current org_id
        for rule in rules.iter() {
            if let Err(e) = validate_ratelimit_rule(rule).await {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "validate ratelimit rule error: {}",
                    e,
                )));
            }

            if rule.org == DEFAULT_GLOBAL_ORG_IDENTIFIER {
                if org_id != "_meta" {
                    return Ok(MetaHttpResponse::bad_request(format!(
                        "No access to update global org-level: {}, api_group_name: {:?}, api_group_operation: {:?}",
                        DEFAULT_GLOBAL_ORG_IDENTIFIER,
                        rule.api_group_name,
                        rule.api_group_operation
                    )));
                }
            } else if rule.org != org_id {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "Organization ID mismatch: expected '{}', found '{}' in rule",
                    org_id, rule.org
                )));
            }
        }

        match ratelimit::rule::update(RuleEntry::Batch(rules)).await {
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
        drop(rules);
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
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/ratelimit/upload")]
pub async fn upload_org_ratelimit(
    path: web::Path<String>,
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

                // Parse JSON data into Vec<RatelimitRule>
                match serde_json::from_slice::<Vec<RatelimitRule>>(&json_data) {
                    Ok(mut rules) => {
                        // Validate rules
                        for rule in rules.iter_mut() {
                            // -1 means no limit, no need to update
                            if rule.threshold == -1 {
                                continue;
                            }

                            if rule.rule_id.is_none() {
                                rule.rule_id = Some(config::ider::generate());
                            }

                            if rule.rule_type.is_none() {
                                rule.rule_type = Some(RatelimitRuleType::Exact.to_string())
                            }
                            // Set or validate org_id
                            if rule.org.is_empty() {
                                rule.org = org_id.clone();
                            } else if rule.org == DEFAULT_GLOBAL_ORG_IDENTIFIER {
                                if org_id != "_meta" {
                                    return Ok(MetaHttpResponse::bad_request(format!(
                                        "No access to update global org-level: {}, api_group_name: {:?}, api_group_operation: {:?}",
                                        DEFAULT_GLOBAL_ORG_IDENTIFIER,
                                        rule.api_group_name,
                                        rule.api_group_operation
                                    )));
                                }
                            } else if rule.org != org_id {
                                return Ok(MetaHttpResponse::bad_request(format!(
                                    "Organization ID mismatch: expected '{}', found '{}' in rule",
                                    org_id, rule.org
                                )));
                            }

                            // Validate rule fields
                            if let Err(e) = validate_ratelimit_rule(rule).await {
                                return Ok(MetaHttpResponse::bad_request(format!(
                                    "Invalid rule data for rule: {:?}, err: {}",
                                    rule, e
                                )));
                            }
                        }

                        // Save rules
                        match ratelimit::rule::save_batch(RuleEntry::UpsertBatch(rules)).await {
                            Ok(_) => {
                                return Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                                    http::StatusCode::OK.into(),
                                    "Ratelimit rule upload successfully".to_string(),
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
        let _ = payload;
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

/// DownloadRatelimitRule
///
/// #{"ratelimit_module":"Ratelimit", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "DownloadRatelimitRule",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/ratelimit/download_template")]
pub async fn download_ratelimit_template(path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let global_default_rules = get_default_rules().await.unwrap();
        let all_rules = infra::table::ratelimit::fetch_rules(
            global_default_rules,
            Some(org_id.clone()),
            Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
        )
        .await
        .unwrap();

        let info = get_ratelimit_global_default_api_info().await;
        let api_group_info = info.api_groups(Some(org_id.as_str()), all_rules).await;

        let mut rules = Vec::new();
        for (group_name, operations) in api_group_info.iter() {
            for (operation, api_group) in operations.iter() {
                let rule = RatelimitRule {
                    org: org_id.clone(),
                    rule_type: Some(RatelimitRuleType::Exact.to_string()),
                    rule_id: Some(config::ider::generate()),
                    user_role: Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
                    user_id: Some(".*".to_string()),
                    api_group_name: Some(group_name.clone()),
                    api_group_operation: Some(operation.as_str().to_string()),
                    threshold: api_group.threshold,
                };
                rules.push(rule);
            }
        }

        // Convert to pretty JSON
        let json_string = serde_json::to_string_pretty(&rules)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        Ok(HttpResponse::Ok()
            .insert_header(("Content-Type", "application/json"))
            .insert_header((
                "Content-Disposition",
                format!(
                    "attachment; filename=\"template_ratelimit_rules_{}.json\"",
                    org_id
                ),
            ))
            .body(json_string))
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(HttpResponse::Forbidden().json("Not Supported"))
    }
}

#[cfg(feature = "enterprise")]
#[cfg(test)]
mod tests {
    use actix_web::test;
    use bytes::Bytes;

    use super::*;
    #[actix_web::test]
    async fn test_upload_ratelimit_rules() {
        // Create test app
        let app = test::init_service(
            actix_web::App::new().service(web::scope("/api").service(upload_org_ratelimit)),
        )
        .await;

        // Create test multipart data
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
        let body = format!(
            "--{boundary}\r\n\
             Content-Disposition: form-data; name=\"rules\"\r\n\
             Content-Type: application/json\r\n\r\n\
             [{{\
                \"org\": \".*\",\
                \"rule_type\": \"exact\",\
                \"user_role\": \".*\",\
                \"user_id\": \".*\",\
                \"api_group_name\": \"search\",\
                \"api_group_operation\": \"create\",\
                \"threshold\": 101\
             }},\
             {{\
                \"org\": \".*\",\
                \"rule_type\": \"exact\",\
                \"user_role\": \".*\",\
                \"user_id\": \".*\",\
                \"api_group_name\": \"search\",\
                \"api_group_operation\": \"delete\",\
                \"threshold\": 200\
             }}]\r\n\
             --{boundary}--\r\n",
        );

        // Create test request
        let req = test::TestRequest::put()
            .uri("/api/test_org/ratelimit/upload")
            .insert_header((
                "Content-Type",
                format!("multipart/form-data; boundary={}", boundary),
            ))
            .set_payload(Bytes::from(body))
            .to_request();

        // Execute request
        let resp = test::call_service(&app, req).await;
        // Verify response
        assert_eq!(resp.status(), 200);

        // Verify response body
        let body = test::read_body(resp).await;
        let response: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(response["code"], 200);
        assert_eq!(response["message"], "Ratelimit rules uploaded successfully");
    }
    #[test]
    async fn test_validate_ratelimit_rule() {
        let valid_rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("regex".to_string()),
            threshold: 100,
            rule_id: Some("test_rule".to_string()),
            ..Default::default()
        };
        assert!(validate_ratelimit_rule(&valid_rule).await.is_ok());

        let invalid_rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: None,
            threshold: 0,
            rule_id: None,
            ..Default::default()
        };
        assert!(!validate_ratelimit_rule(&invalid_rule).await.is_ok());
    }
}
