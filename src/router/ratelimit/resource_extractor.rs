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

use std::collections::HashMap;

use config::meta::ratelimit::{RatelimitRule, RatelimitRuleType, get_resource_from_params};
use futures_util::future::BoxFuture;
use http::Method;
use o2_ratelimit::{
    dataresource::{
        db::RATELIMIT_RULES_CACHE,
        default_rules::{
            DEFAULT_GLOBAL_ORG_IDENTIFIER, DEFAULT_GLOBAL_USER_ID_IDENTIFIER,
            DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER, find_group_by_openapi,
        },
    },
    middleware::{ExtractorRule, ExtractorRuleResult, handle_rules},
};
use regex::Regex;
use utoipa::OpenApi;

use crate::handler::http::{
    auth::validator::get_user_email_from_auth_str, request::ratelimit::QUOTA_PAGE_GLOBAL_RULES_ORG,
    router::openapi::ApiDoc,
};

fn extract_org_id(path: &str) -> String {
    let path_columns = path.split('/').collect::<Vec<&str>>();
    if path_columns.len() <= 1 {
        return QUOTA_PAGE_GLOBAL_RULES_ORG.to_string();
    }

    if path.starts_with("v1/") || path.starts_with("v2/") || path.starts_with("v3/") {
        path_columns
            .get(1)
            .map(|s| s.to_string())
            .unwrap_or_default()
    } else {
        path_columns
            .first()
            .map(|s| s.to_string())
            .unwrap_or_default()
    }
}

pub async fn ws_extractor(
    trace_id: &str,
    auth_str: String,
    local_path: String,
    method: &Method,
) -> anyhow::Result<()> {
    handle_rules(trace_id, rule_extractor(auth_str, local_path, method).await)
}

fn rule_extractor(
    auth_str: String,
    local_path: String,
    method: &Method,
) -> BoxFuture<'_, ExtractorRuleResult> {
    let path = match local_path
        .strip_prefix(format!("{}/api/", config::get_config().common.base_uri).as_str())
    {
        Some(path) => path,
        None => local_path.strip_prefix("/").unwrap_or(&local_path),
    };

    let (path, org_id) = (path.to_string(), extract_org_id(path));
    let openapi_path = extract_openapi_path(&local_path, method);
    Box::pin(async move {
        let user_email = get_user_email_from_auth_str(&auth_str)
            .await
            .unwrap_or_default();
        let user_roles =
            crate::service::users::get_user_roles(user_email.as_str(), Some(&org_id)).await;
        log::debug!("found user_roles: {:?}", &user_roles);
        let openapi_path = openapi_path.unwrap_or(path);
        // find the group of the openapi_path
        match find_group_by_openapi(&openapi_path).await {
            Some(group) => {
                let (api_group_name, api_group_operation) = group;
                let default_resource = get_resource_from_params(
                    DEFAULT_GLOBAL_ORG_IDENTIFIER,
                    RatelimitRuleType::Exact.to_string().as_str(),
                    DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER,
                    api_group_name.as_str(),
                    api_group_operation.as_str(),
                    DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER,
                );
                let (default_rule, custom_rules) = find_default_and_custom_rules(
                    &org_id,
                    user_roles.clone(),
                    api_group_name.as_str(),
                    api_group_operation.as_str(),
                    &user_email,
                    default_resource.as_str(),
                )
                .await;
                log::debug!(
                    "org_id{}, user_roles:{:?}, api_group_name:{}, api_group_operation:{}, user_email:{}, default_resource:{}, found default_rule: {:?}, custom_rules: {:?}",
                    &org_id,
                    user_roles,
                    api_group_name,
                    api_group_operation.as_str(),
                    user_email,
                    default_resource,
                    &default_rule,
                    &custom_rules
                );
                // Select the final rule based on priority
                select_final_rule_resource(default_rule, custom_rules, user_email.as_str())
            }
            None => (
                ExtractorRule::DefaultOrgGlobal(None),
                ExtractorRule::OrgLevel(None),
                ExtractorRule::UserRole(None),
                ExtractorRule::UserId(None),
            ),
        }
    })
}

// Commented out: This function uses actix-web types and is not currently used
/// Default extractor for axum Request
pub fn default_extractor(req: &axum::extract::Request) -> BoxFuture<'_, ExtractorRuleResult> {
    let auth_str = extract_basic_auth_str_axum(req);
    let local_path = req.uri().path().to_string();
    rule_extractor(auth_str, local_path, req.method())
}

/// Extract basic auth string from axum Request
fn extract_basic_auth_str_axum(req: &axum::extract::Request) -> String {
    req.headers()
        .get(http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

async fn find_default_and_custom_rules(
    org_id: &str,
    user_roles: Vec<String>,
    api_group_name: &str,
    api_group_operation: &str,
    user_id: &str,
    rule_resource: &str,
) -> (Option<RatelimitRule>, Vec<RatelimitRule>) {
    let default_rule = find_matching_rule(org_id, rule_resource, true).await;

    // custom_rules will includes custom org rules and custom role rules all
    let mut custom_rules = vec![];

    // Find role-level and user-level rules
    for role in user_roles.iter() {
        // user-level
        let resource = get_resource_from_params(
            org_id,
            RatelimitRuleType::Exact.to_string().as_str(),
            role,
            api_group_name,
            api_group_operation,
            user_id,
        );
        let custom_rule = find_matching_rule(org_id, &resource, false).await;
        if let Some(rule) = custom_rule {
            custom_rules.push(rule)
        }

        // role-level
        let resource = get_resource_from_params(
            org_id,
            RatelimitRuleType::Exact.to_string().as_str(),
            role,
            api_group_name,
            api_group_operation,
            DEFAULT_GLOBAL_USER_ID_IDENTIFIER,
        );
        let custom_rule = find_matching_rule(org_id, &resource, false).await;
        if let Some(rule) = custom_rule {
            custom_rules.push(rule)
        }
    }

    // Find org-level rule
    let org_level_resource = get_resource_from_params(
        org_id,
        RatelimitRuleType::Exact.to_string().as_str(),
        DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER,
        api_group_name,
        api_group_operation,
        DEFAULT_GLOBAL_USER_ID_IDENTIFIER,
    );
    if let Some(org_level_rule) =
        find_matching_rule(org_id, org_level_resource.as_str(), false).await
    {
        custom_rules.push(org_level_rule)
    }

    (default_rule, custom_rules)
}

fn select_final_rule_resource(
    default_rule: Option<RatelimitRule>,
    custom_rules: Vec<RatelimitRule>,
    user_email: &str,
) -> ExtractorRuleResult {
    if custom_rules.is_empty() {
        return (
            ExtractorRule::DefaultOrgGlobal(default_rule),
            ExtractorRule::OrgLevel(None),
            ExtractorRule::UserRole(None),
            ExtractorRule::UserId(None),
        );
    }

    // Find org-level and role-level rules
    let org_level_rule = custom_rules
        .iter()
        .find(|rule| {
            rule.user_role
                .eq(&Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()))
                && rule
                    .user_id
                    .eq(&Some(DEFAULT_GLOBAL_USER_ID_IDENTIFIER.to_string()))
        })
        .cloned();

    let user_role_rule = custom_rules
        .iter()
        .filter(|rule| {
            rule.user_role
                .ne(&Some(DEFAULT_GLOBAL_USER_ROLE_IDENTIFIER.to_string()))
                && rule
                    .user_id
                    .eq(&Some(DEFAULT_GLOBAL_USER_ID_IDENTIFIER.to_string()))
        })
        .max_by_key(|rule| rule.threshold)
        .cloned();

    let user_role = if let Some(user_role_rule) = &user_role_rule {
        user_role_rule.user_role.clone()
    } else {
        None
    };

    let user_id_rules = custom_rules
        .iter()
        .find(|rule| {
            user_role_rule.is_some()
                && rule.user_role.eq(&user_role)
                && rule.user_id.eq(&Some(user_email.to_string()))
        })
        .cloned();

    (
        ExtractorRule::DefaultOrgGlobal(default_rule),
        ExtractorRule::OrgLevel(org_level_rule),
        ExtractorRule::UserRole(user_role_rule),
        ExtractorRule::UserId(user_id_rules),
    )
}

async fn find_matching_rule(
    org: &str,
    resource: &str,
    search_default: bool,
) -> Option<RatelimitRule> {
    let rules = RATELIMIT_RULES_CACHE.read().await;

    let filter_rules: Vec<RatelimitRule> = if search_default {
        rules.iter().filter(|r| r.org == ".*").cloned().collect()
    } else {
        rules.iter().filter(|r| r.org == org).cloned().collect()
    };
    drop(rules);

    for rule in filter_rules {
        match rule.rule_type.as_deref() {
            Some(type_str) if type_str == RatelimitRuleType::Exact.to_string() => {
                if resource == rule.get_resource() {
                    log::debug!(
                        "Matching resource: {} with exact rule: {}",
                        resource,
                        rule.get_resource()
                    );
                    return Some(rule);
                }
            }
            Some(type_str) if type_str == RatelimitRuleType::Regex.to_string() => {
                if let Ok(re) = Regex::new(&rule.get_resource())
                    && re.is_match(resource)
                {
                    log::debug!(
                        "Matching resource: {resource} with regex rule: {}",
                        rule.get_resource()
                    );
                    return Some(rule);
                }
            }
            _ => continue,
        }
    }

    None
}

fn path_to_regex(path: &str) -> Regex {
    let re = Regex::new(r"\{[^}]+\}").unwrap();
    let replaced = re.replace_all(path, r"([^/]+)");
    Regex::new(&format!("^{replaced}$")).unwrap()
}

fn extract_openapi_path(path: &str, method: &Method) -> Option<String> {
    let api = ApiDoc::openapi();
    let path_patterns: HashMap<String, Regex> = {
        api.paths
            .paths
            .keys()
            .map(|path| {
                let pattern = path_to_regex(path);
                (path.clone(), pattern)
            })
            .collect()
    };

    // Find matching path
    for (openapi_path, path_item) in &api.paths.paths {
        // Check if path pattern matches
        if let Some(pattern) = path_patterns.get(openapi_path) {
            if !pattern.is_match(path) {
                continue;
            }

            // Check if method is supported for this path
            let method_exists = [
                (utoipa::openapi::HttpMethod::Get, path_item.get.as_ref()),
                (utoipa::openapi::HttpMethod::Post, path_item.post.as_ref()),
                (utoipa::openapi::HttpMethod::Put, path_item.put.as_ref()),
                (
                    utoipa::openapi::HttpMethod::Delete,
                    path_item.delete.as_ref(),
                ),
                (utoipa::openapi::HttpMethod::Patch, path_item.patch.as_ref()),
                (utoipa::openapi::HttpMethod::Head, path_item.head.as_ref()),
                (
                    utoipa::openapi::HttpMethod::Options,
                    path_item.options.as_ref(),
                ),
                (utoipa::openapi::HttpMethod::Trace, path_item.trace.as_ref()),
            ]
            .into_iter()
            .filter_map(|(http_method, op)| op.map(|_| http_method))
            .any(|op_method| {
                matches!(
                    (method, op_method),
                    (&Method::GET, utoipa::openapi::HttpMethod::Get)
                        | (&Method::POST, utoipa::openapi::HttpMethod::Post)
                        | (&Method::PUT, utoipa::openapi::HttpMethod::Put)
                        | (&Method::DELETE, utoipa::openapi::HttpMethod::Delete)
                        | (&Method::PATCH, utoipa::openapi::HttpMethod::Patch)
                        | (&Method::HEAD, utoipa::openapi::HttpMethod::Head)
                        | (&Method::OPTIONS, utoipa::openapi::HttpMethod::Options)
                        | (&Method::TRACE, utoipa::openapi::HttpMethod::Trace)
                )
            });

            if method_exists {
                log::debug!(
                    "Matched OpenAPI path: {openapi_path} for request path: {path} and method: {method}"
                );
                return Some(format!("{openapi_path}:{method}"));
            } else {
                log::debug!(
                    "Path matched but method {method} not supported for OpenAPI path: {openapi_path}"
                );
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use utoipa::{OpenApi, openapi::path::Operation};

    use super::*;
    use crate::handler::http::router::openapi::ApiDoc;

    #[tokio::test]
    async fn print_openapi_info_with() {
        let api = ApiDoc::openapi();

        println!("\nOpenAPI Documentation Info:");
        println!("==========================");

        // Print general info
        println!("Title: {}", api.info.title);
        println!("Version: {}", api.info.version);
        if let Some(description) = &api.info.description {
            println!("Description: {description}");
        }

        // Print all tags with descriptions
        if let Some(tags) = &api.tags {
            println!("\nGlobal Tags:");
            println!("============");
            for tag in tags {
                println!("Tag: {}", tag.name);
                if let Some(desc) = &tag.description {
                    println!("Description: {desc}");
                }
                if let Some(ext_docs) = &tag.external_docs {
                    println!(
                        "External Docs: {} ({})",
                        ext_docs.url,
                        ext_docs.description.as_deref().unwrap_or("")
                    );
                }
                println!();
            }
        }

        println!("\nAPI Endpoints:");
        println!("==============");

        // Group endpoints by tags with full operation details
        #[allow(clippy::type_complexity)]
        let mut tag_operations: HashMap<
            String,
            Vec<(String, String, Operation, Vec<String>)>,
        > = HashMap::new();

        for (path, path_item) in &api.paths.paths {
            for (method, operation) in [
                (utoipa::openapi::HttpMethod::Get, path_item.get.as_ref()),
                (utoipa::openapi::HttpMethod::Post, path_item.post.as_ref()),
                (utoipa::openapi::HttpMethod::Put, path_item.put.as_ref()),
                (
                    utoipa::openapi::HttpMethod::Delete,
                    path_item.delete.as_ref(),
                ),
                (utoipa::openapi::HttpMethod::Patch, path_item.patch.as_ref()),
                (utoipa::openapi::HttpMethod::Head, path_item.head.as_ref()),
                (
                    utoipa::openapi::HttpMethod::Options,
                    path_item.options.as_ref(),
                ),
                (utoipa::openapi::HttpMethod::Trace, path_item.trace.as_ref()),
            ]
            .into_iter()
            .filter_map(|(method, op)| op.map(|operation| (method, operation)))
            {
                let tags = operation
                    .tags
                    .clone()
                    .unwrap_or_else(|| vec!["untagged".to_string()]);

                let method = match method {
                    utoipa::openapi::HttpMethod::Get => "GET",
                    utoipa::openapi::HttpMethod::Post => "POST",
                    utoipa::openapi::HttpMethod::Put => "PUT",
                    utoipa::openapi::HttpMethod::Delete => "DELETE",
                    utoipa::openapi::HttpMethod::Patch => "PATCH",
                    utoipa::openapi::HttpMethod::Head => "HEAD",
                    utoipa::openapi::HttpMethod::Options => "OPTIONS",
                    utoipa::openapi::HttpMethod::Trace => "TRACE",
                };

                let operation_info = (
                    method.to_string(),
                    path.clone(),
                    operation.clone(),
                    tags.clone(),
                );

                for tag in tags {
                    tag_operations
                        .entry(tag)
                        .or_default()
                        .push(operation_info.clone());
                }
            }
        }

        // Print grouped operations with detailed information
        for (tag, operations) in tag_operations.iter() {
            println!("\n[{tag}]");
            println!("{}", "=".repeat(tag.len() + 2));

            for (method, path, operation, _) in operations {
                println!("\n{method} {path}");

                // Print operation ID if available
                if let Some(operation_id) = &operation.operation_id {
                    println!("Operation ID: {operation_id}");
                }

                // Print operation summary and description
                if let Some(summary) = &operation.summary {
                    println!("Summary: {summary}");
                }
                if let Some(description) = &operation.description {
                    println!("Description: {description}");
                } else {
                    println!("No description available");
                }

                println!("\n{}", "-".repeat(50));
            }
        }
    }

    fn create_rule(
        org: &str,
        user_role: Option<&str>,
        user_id: Option<&str>,
        threshold: i32,
    ) -> RatelimitRule {
        RatelimitRule {
            org: org.to_string(),
            rule_type: Some("exact".to_string()),
            user_role: user_role.map(String::from),
            user_id: user_id.map(String::from),
            threshold,
            ..Default::default()
        }
    }

    #[test]
    fn test_select_final_rule_empty_rules() {
        let result = select_final_rule_resource(None, vec![], "test@example.com");

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(None)));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(None)));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }

    #[test]
    fn test_select_final_rule_only_default() {
        let default_rule = create_rule(".*", None, None, 100);
        let result =
            select_final_rule_resource(Some(default_rule.clone()), vec![], "test@example.com");

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(Some(r)) if r.threshold == 100));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(None)));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }

    #[test]
    fn test_select_final_rule_org_level() {
        let default_rule = create_rule(".*", None, None, 100);
        let org_rule = create_rule("test_org", None, None, 50);
        let custom_rules = vec![org_rule.clone()];

        let result = select_final_rule_resource(
            Some(default_rule.clone()),
            custom_rules,
            "test@example.com",
        );

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(Some(r)) if r.threshold == 100));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(Some(r)) if r.threshold == 50));
        assert!(matches!(result.2, ExtractorRule::UserRole(None)));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }

    #[test]
    fn test_select_final_rule_user_role() {
        let default_rule = create_rule(".*", None, None, 100);
        let role_rule = create_rule("test_org", Some("admin"), Some(".*"), 75);
        let custom_rules = vec![role_rule.clone()];

        let result = select_final_rule_resource(
            Some(default_rule.clone()),
            custom_rules,
            "test@example.com",
        );

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(Some(r)) if r.threshold == 100));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(Some(r)) if r.threshold == 75));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }

    #[test]
    fn test_select_final_rule_user_id() {
        let default_rule = create_rule(".*", None, None, 100);
        let role_rule = create_rule("test_org", Some("admin"), Some(".*"), 75);
        let user_rule = create_rule("test_org", Some("admin"), Some("test@example.com"), 25);
        let custom_rules = vec![role_rule.clone(), user_rule.clone()];

        let result = select_final_rule_resource(
            Some(default_rule.clone()),
            custom_rules,
            "test@example.com",
        );

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(Some(r)) if r.threshold == 100));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(Some(r)) if r.threshold == 75));
        assert!(matches!(result.3, ExtractorRule::UserId(Some(r)) if r.threshold == 25));
    }

    #[test]
    fn test_select_final_rule_all_levels() {
        let default_rule = create_rule(".*", None, None, 100);
        let org_rule = create_rule("test_org", None, None, 80);
        let role_rule = create_rule("test_org", Some("admin"), Some(".*"), 60);
        let user_rule = create_rule("test_org", Some("admin"), Some("test@example.com"), 40);
        let custom_rules = vec![org_rule.clone(), role_rule.clone(), user_rule.clone()];

        let result = select_final_rule_resource(
            Some(default_rule.clone()),
            custom_rules,
            "test@example.com",
        );

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(Some(r)) if r.threshold == 100));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(Some(r)) if r.threshold == 80));
        assert!(matches!(result.2, ExtractorRule::UserRole(Some(r)) if r.threshold == 60));
        assert!(matches!(result.3, ExtractorRule::UserId(Some(r)) if r.threshold == 40));
    }

    #[test]
    fn test_select_final_rule_multiple_role_rules() {
        let role_rule1 = create_rule("test_org", Some("admin"), Some(".*"), 75);
        let role_rule2 = create_rule("test_org", Some("user"), Some(".*"), 50);
        let custom_rules = vec![role_rule1.clone(), role_rule2.clone()];

        let result = select_final_rule_resource(None, custom_rules, "test@example.com");

        // Should select the rule with higher threshold
        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(None)));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(Some(r)) if r.threshold == 75));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }

    #[test]
    fn test_select_final_rule_non_matching_user_id() {
        let role_rule = create_rule("test_org", Some("admin"), Some(".*"), 75);
        let user_rule = create_rule("test_org", Some("admin"), Some("other@example.com"), 25);
        let custom_rules = vec![role_rule.clone(), user_rule.clone()];

        let result = select_final_rule_resource(None, custom_rules, "test@example.com");

        assert!(matches!(result.0, ExtractorRule::DefaultOrgGlobal(None)));
        assert!(matches!(result.1, ExtractorRule::OrgLevel(None)));
        assert!(matches!(result.2, ExtractorRule::UserRole(Some(r)) if r.threshold == 75));
        assert!(matches!(result.3, ExtractorRule::UserId(None)));
    }
}
