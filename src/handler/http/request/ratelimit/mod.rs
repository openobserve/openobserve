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
    extract::{Path, Query},
    response::Response,
};
use serde::Deserialize;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::meta::http::HttpResponse as MetaHttpResponse,
        service::{ratelimit, ratelimit::rule::RatelimitError},
    },
    config::meta::ratelimit::{Interval, RatelimitRule, RatelimitRuleUpdater},
    infra::table::ratelimit::RuleEntry,
    o2_ratelimit::dataresource::{
        default_rules::{
            ApiGroupOperation, DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER,
            DEFAULT_THRESHOLD_NO_LIMIT_FRONTEND, RATELIMIT_API_MAPPING,
            get_ratelimit_global_default_api_info, has_group_name_and_operation,
        },
        default_rules_provider::get_default_rules,
    },
    std::collections::HashMap,
};
#[cfg(feature = "enterprise")]
const QUOTA_PAGE_REQUIRED_ORG: &str = "_meta";
#[cfg(feature = "enterprise")]
pub const QUOTA_PAGE_GLOBAL_RULES_ORG: &str = "global_rules";

#[cfg(feature = "enterprise")]
#[derive(Debug, Clone, Deserialize)]
pub struct QueryParams {
    pub org_id: String,
    pub update_type: Option<String>,
    pub user_role: Option<String>,
    pub interval: Option<String>, // second/minute/hour
}
#[cfg(feature = "enterprise")]
impl QueryParams {
    fn get_org_id(&self) -> String {
        match self.org_id.to_lowercase().as_str() {
            QUOTA_PAGE_GLOBAL_RULES_ORG => DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string(),
            _ => self.org_id.to_string(),
        }
    }

    fn get_update_type(&self) -> String {
        self.update_type.clone().unwrap_or_default()
    }
}

#[cfg(not(feature = "enterprise"))]
#[derive(Debug, Clone, Deserialize)]
pub struct QueryParams();

#[cfg(feature = "enterprise")]
async fn validate_ratelimit_updater(
    org_id: &str,
    update_type: &str,
    rules: &RatelimitRuleUpdater,
) -> Result<(), anyhow::Error> {
    let global_default_rules = get_default_rules().await.map_err(std::io::Error::other)?;

    // module-level is org-level
    let org_level_rules = infra::table::ratelimit::fetch_rules(
        global_default_rules.clone(),
        Some(org_id.to_string()),
        Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
    )
    .await
    .map_err(std::io::Error::other)?;

    let org_level_thresholds: HashMap<(String, ApiGroupOperation), i32> = org_level_rules
        .into_iter()
        .filter_map(|rule| {
            let group_name = rule.api_group_name?;
            let operation = ApiGroupOperation::try_from(rule.api_group_operation?.as_str()).ok()?;
            Some(((group_name, operation), rule.threshold))
        })
        .collect();

    for (api_group_name, operations) in rules.0.iter() {
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

            if update_type == "role" {
                let compare_threshold =
                    org_level_thresholds.get(&(api_group_name.to_string(), operation));
                if let Some(compare_threshold) = compare_threshold
                    && *compare_threshold < *threshold
                {
                    return Err(anyhow::anyhow!(
                        "{}:{} threshold must be lower than or equal to {:?}, got {}, because module-level rule limit {}:{} is {:?}",
                        api_group_name,
                        operation.as_str(),
                        compare_threshold,
                        threshold,
                        api_group_name,
                        operation.as_str(),
                        compare_threshold,
                    ));
                }
            }
        }
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
impl From<RatelimitError> for Response {
    fn from(value: RatelimitError) -> Self {
        match value {
            RatelimitError::NotFound(_) => MetaHttpResponse::not_found(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}

/// listApiModule

#[utoipa::path(
    get,
    path = "/{org_id}/ratelimit/api_modules",
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listApiModule",
    summary = "List API modules",
    description = "Retrieves all available API modules that can have rate limiting rules applied. Used for configuring rate limits at the module level",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ratelimit", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn api_modules(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id != QUOTA_PAGE_REQUIRED_ORG {
            return MetaHttpResponse::bad_request(format!("org_id: {org_id} has no access",));
        }

        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let info = get_ratelimit_global_default_api_info().await;
        let all_group = info.get_all_groups();
        MetaHttpResponse::json(all_group)
    }

    #[cfg(not(feature = "enterprise"))]
    {
        use axum::{
            body::Body,
            http::{StatusCode, header},
        };
        drop(org_id);
        Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap()
    }
}

/// listModuleRatelimitRule

#[utoipa::path(
    get,
    path = "/{org_id}/ratelimit/module_list",
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listModuleRatelimitRule",
    summary = "List module rate limit rules",
    description = "Retrieves rate limiting rules applied at the organization module level, including thresholds and configurations for different API groups",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
        ("org_id" = String, Query, description = "Organization Name"),
        ("interval" = Option<String>, Query, description = "Time interval: second/minute/hour (default: second)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ratelimit", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_module_ratelimit(
    Path(org_id): Path<String>,
    Query(query): Query<QueryParams>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id != QUOTA_PAGE_REQUIRED_ORG {
            return MetaHttpResponse::bad_request(format!("org_id: {org_id} has no access",));
        }

        let org_id = query.get_org_id();
        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let global_default_rules = match get_default_rules().await {
            Ok(rules) => rules,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };
        // module-level is org-level
        let all_rules = match infra::table::ratelimit::fetch_rules(
            global_default_rules.clone(),
            Some(org_id.clone()),
            Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
        )
        .await
        {
            Ok(rules) => rules,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        let info = get_ratelimit_global_default_api_info().await;
        let interval = if let Some(interval_str) = query.interval.as_deref() {
            match Interval::try_from(interval_str) {
                Ok(interval) => Some(interval.get_interval_ms()),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            }
        } else {
            None
        };
        let api_group_info = info
            .api_groups(Some(org_id.as_str()), all_rules, interval)
            .await;
        MetaHttpResponse::json(api_group_info)
    }

    #[cfg(not(feature = "enterprise"))]
    {
        use axum::{
            body::Body,
            http::{StatusCode, header},
        };
        drop(org_id);
        let _ = query;
        Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap()
    }
}

/// listRoleRatelimitRule

#[utoipa::path(
    get,
    path = "/{org_id}/ratelimit/role_list",
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "listRoleRatelimitRule",
    summary = "List role-based rate limit rules",
    description = "Retrieves rate limiting rules applied to specific user roles within the organization, showing how different roles have different API usage limits",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization Name"),
        ("org_id" = String, Query, description = "Organization Name"),
        ("user_role" = String, Query, description = "User Role Name"),
        ("interval" = Option<String>, Query, description = "Time interval: second/minute/hour (default: second)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ratelimit", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_role_ratelimit(
    Path(org_id): Path<String>,
    Query(query): Query<QueryParams>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id != QUOTA_PAGE_REQUIRED_ORG {
            return MetaHttpResponse::bad_request(format!("org_id: {org_id} has no access",));
        }

        let org_id = query.get_org_id();
        let user_role = query.user_role.unwrap_or_default();
        if user_role.is_empty() {
            return MetaHttpResponse::bad_request("user_role param is required".to_string());
        }

        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        let global_default_rules = match get_default_rules().await {
            Ok(rules) => rules,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        // module-level is org-level
        let org_level_rules = match infra::table::ratelimit::fetch_rules(
            global_default_rules.clone(),
            Some(org_id.clone()),
            Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()),
        )
        .await
        {
            Ok(rules) => rules,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        let role_level_rules = match infra::table::ratelimit::fetch_rules(
            org_level_rules,
            Some(org_id.clone()),
            Some(user_role),
        )
        .await
        {
            Ok(rules) => rules,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        let info = get_ratelimit_global_default_api_info().await;
        let interval = if let Some(interval_str) = query.interval.as_deref() {
            match Interval::try_from(interval_str) {
                Ok(interval) => Some(interval.get_interval_ms()),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            }
        } else {
            None
        };
        let api_group_info = info
            .api_groups(Some(org_id.as_str()), role_level_rules, interval)
            .await;
        MetaHttpResponse::json(api_group_info)
    }

    #[cfg(not(feature = "enterprise"))]
    {
        use axum::{
            body::Body,
            http::{StatusCode, header},
        };
        drop(org_id);
        let _ = query;
        Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap()
    }
}

/// UpdateRatelimitRule

#[utoipa::path(
    put,
    path = "/{org_id}/ratelimit/update",
    context_path = "/api",
    tag = "Ratelimit",
    operation_id = "UpdateRatelimitRule",
    summary = "Update rate limit rules",
    description = "Updates rate limiting rules for modules or user roles. Allows setting custom thresholds for different API operations and groups",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("org_id" = String, Query, description = "Organization name"),
        ("update_type" = String, Query, description = "Update Type"),
        ("user_role" = Option<String>, Query, description = "UserRole name"),
        ("interval" = Option<String>, Query, description = "Time interval: second/minute/hour (default: second)"),
    ),
    request_body(content = String, description = "json array", content_type = "application/json", example = json!({"Key Values": {"list": 0,"create": 0,"delete": 0,"get": 0},"Service Accounts": {"update": 0,"list": 0,"create": 0,"delete": 0,"get": 0}})),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ratelimit", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_ratelimit(
    Path(org_id): Path<String>,
    Query(query): Query<QueryParams>,
    body: axum::body::Bytes,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if org_id != QUOTA_PAGE_REQUIRED_ORG {
            return MetaHttpResponse::bad_request(format!("org_id: {org_id} has no access",));
        }

        let updater = match parse_and_validate_ratelimit_payload(body).await {
            Ok(updater) => updater,
            Err(e) => {
                return MetaHttpResponse::bad_request(e.to_string());
            }
        };

        let org_id = query.get_org_id();

        if RATELIMIT_API_MAPPING.read().await.is_empty() {
            let openapi_info = crate::handler::http::router::openapi::openapi_info().await;
            o2_ratelimit::dataresource::default_rules::init_ratelimit_api_mapping(openapi_info)
                .await;
        }

        if let Err(e) =
            validate_ratelimit_updater(org_id.as_str(), &query.get_update_type(), &updater).await
        {
            return MetaHttpResponse::bad_request(format!("validate ratelimit updater error: {e}"));
        }

        let user_role = match query.get_update_type().as_str() {
            "module" => DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string(),
            "role" => {
                if query.user_role.is_none() || query.user_role.eq(&Some("".to_string())) {
                    return MetaHttpResponse::bad_request(
                        "user_role param is required when update_type=role".to_string(),
                    );
                } else {
                    query.user_role.clone().unwrap()
                }
            }
            _ => {
                return MetaHttpResponse::bad_request(format!(
                    "update_type is incorrect: {}, only support module or role",
                    query.get_update_type()
                ));
            }
        };

        // Determine stat_interval_ms based on interval query param
        let stat_interval_ms = if let Some(interval_str) = query.interval.as_deref() {
            match Interval::try_from(interval_str) {
                Ok(interval) => Some(interval.get_interval_ms()),
                Err(e) => return MetaHttpResponse::bad_request(e.to_string()),
            }
        } else {
            None // Use default (1000ms)
        };

        let rules = RatelimitRule::from_updater(
            org_id.as_str(),
            user_role.as_str(),
            &updater,
            stat_interval_ms,
        );
        log::debug!("RatelimitRule::from_updater rules: {rules:?}");
        match ratelimit::rule::update(RuleEntry::UpsertBatch(rules)).await {
            Ok(()) => MetaHttpResponse::ok("Ratelimit rule updated successfully"),
            Err(e) => e.into(),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        use axum::{
            body::Body,
            http::{StatusCode, header},
        };
        drop(org_id);
        let _ = query;
        drop(body);
        Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap()
    }
}

#[cfg(feature = "enterprise")]
async fn parse_and_validate_ratelimit_payload(
    bytes: axum::body::Bytes,
) -> Result<RatelimitRuleUpdater, String> {
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse JSON: {e}"))?;

    let obj = value
        .as_object()
        .ok_or_else(|| "Root must be an object".to_string())?;

    let mut result = HashMap::new();

    for (outer_key, outer_value) in obj {
        let inner_obj = outer_value
            .as_object()
            .ok_or_else(|| format!("Value for key '{outer_key}' must be an object"))?;

        let mut inner_map = HashMap::new();

        for (inner_key, inner_value) in inner_obj {
            let number = inner_value.as_i64().ok_or_else(|| {
                format!("Value for key '{inner_key}' in group '{outer_key}' must be an i32")
            })?;

            if number > i32::MAX as i64 || number < 0 {
                return Err(format!(
                    "The Rate limit value of {number} for the key '{inner_key}' in group '{outer_key}' exceeds the allowed integer range of [{}, {}]",
                    0,
                    i32::MAX
                ));
            }

            inner_map.insert(inner_key.clone(), number as i32);
        }

        result.insert(outer_key.clone(), inner_map);
    }

    Ok(RatelimitRuleUpdater(result))
}
