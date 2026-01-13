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
use infra::table::re_pattern::PatternEntry;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(feature = "enterprise")]
use crate::common::{
    meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    utils::auth::{remove_ownership, set_ownership},
};
use crate::{
    common::utils::auth::UserEmail,
    handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
};

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PatternCreateRequest {
    name: String,
    description: String,
    pattern: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternGetResponse {
    id: String,
    name: String,
    description: String,
    pattern: String,
    created_at: i64,
    updated_at: i64,
}

impl From<PatternEntry> for PatternGetResponse {
    fn from(value: PatternEntry) -> Self {
        Self {
            id: value.id,
            name: value.name,
            description: value.description,
            pattern: value.pattern,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternInfo {
    id: String,
    name: String,
    pattern: String,
    description: String,
    created_at: i64,
    updated_at: i64,
}

impl From<PatternEntry> for PatternInfo {
    fn from(value: PatternEntry) -> Self {
        Self {
            id: value.id,
            name: value.name,
            pattern: value.pattern,
            description: value.description,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternListResponse {
    patterns: Vec<PatternInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct PatternTestRequest {
    pattern: String,
    test_records: Vec<String>,
    #[serde(default)]
    policy: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternTestResponse {
    results: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct BuiltInPatternsResponse {
    patterns: Vec<crate::service::github::adapters::BuiltInPatternResponse>,
    last_updated: i64,
    source_url: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BuiltInPatternsQuery {
    #[serde(default)]
    search: String,
    #[serde(default)]
    tags: Vec<String>,
}

/// Store a re_pattern in db
#[utoipa::path(
    post,
    path = "/{org_id}/re_patterns",
    context_path = "/api",
    summary = "Create a new regex pattern",
    description = "Stores a new regular expression pattern for log processing and data extraction",
    request_body(
        content = inline(PatternCreateRequest),
        description = "re_pattern to add",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "RePattern"
)]
pub async fn save(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<PatternCreateRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::{re_pattern::PatternEntry, re_pattern_stream_map::PatternPolicy};
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        if req.name.contains(":") {
            return MetaHttpResponse::bad_request("Pattern name cannot have ':' in it");
        }

        let user_id = &user_email.user_id;

        if let Err(e) =
            PatternManager::test_pattern(req.pattern.clone(), "".to_string(), PatternPolicy::Redact)
        {
            return MetaHttpResponse::bad_request(e);
        }

        match crate::service::db::re_pattern::add(PatternEntry::new(
            &org_id,
            &req.name,
            &req.description,
            &req.pattern,
            user_id,
        ))
        .await
        {
            Ok(entry) => {
                set_ownership(&org_id, "re_patterns", Authz::new(&entry.id)).await;
                MetaHttpResponse::ok("Pattern created successfully")
            }
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(user_email);
        drop(req);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// get pattern with given id if present
#[utoipa::path(
    get,
    path = "/{org_id}/re_patterns/{id}",
    context_path = "/api",
    summary = "Get regex pattern by ID",
    description = "Retrieves a specific regex pattern using its unique identifier",
    params(
        ("id" = String, Path, description = "id of the pattern to retrieve", example = "12345")
    ),
    responses(
        (
            status = 200,
            description = "Pattern info",
            body = inline(PatternGetResponse),
            content_type = "application/json",
        ),
        (status = 404, description = "Pattern not found", content_type = "text/plain")
    ),
    tag = "RePattern"
)]
pub async fn get(Path((_org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let pattern = match infra::table::re_pattern::get(&id).await {
            Ok(Some(k)) => k,
            Ok(None) => {
                return MetaHttpResponse::not_found(format!("Pattern with id {id} not found"));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        let res: PatternGetResponse = pattern.into();
        MetaHttpResponse::json(res)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        MetaHttpResponse::forbidden("not supported")
    }
}

/// list all patterns for given org
#[utoipa::path(
    get,
    path = "/{org_id}/re_patterns",
    context_path = "/api",
    summary = "List all regex patterns for organization",
    description = "Lists all regex patterns available within the specified organization",
    responses(
        (
            status = 200,
            description = "list all patterns in the org",
            body = inline(PatternListResponse),
            content_type = "application/json",
        ),
    ),
    tag = "RePattern"
)]
pub async fn list(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let patterns = match infra::table::re_pattern::list_by_org(&org_id).await {
            Ok(list) => list,
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        let patterns = patterns.into_iter().map(|p| p.into()).collect::<Vec<_>>();

        let res = PatternListResponse { patterns };
        MetaHttpResponse::json(res)
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// delete pattern with given id
#[utoipa::path(
    delete,
    path = "/{org_id}/re_patterns/{id}",
    context_path = "/api",
    summary = "Delete regex pattern by ID",
    description = "Removes a regex pattern from the system using its identifier",
    params(
        ("id" = String, Path, description = "id of the pattern to delete", example = "12345")
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
    ),
    tag = "RePattern"
)]
pub async fn delete(Path((org_id, id)): Path<(String, String)>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::re_patterns::get_pattern_manager;

        let mgr = match get_pattern_manager().await {
            Ok(m) => m,
            Err(e) => {
                return MetaHttpResponse::internal_error(format!(
                    "Cannot get pattern manager : {e:?}"
                ));
            }
        };
        let pattern_usage = mgr.get_pattern_usage(&id);
        let (pattern_streams, extra) = if pattern_usage.len() > 5 {
            (
                &pattern_usage[0..5],
                format!(" and {} more", pattern_usage.len() - 5),
            )
        } else {
            (&pattern_usage[0..], "".to_string())
        };
        if !pattern_usage.is_empty() {
            return MetaHttpResponse::bad_request(format!(
                "Cannot delete pattern, associated with {pattern_streams:?}{extra}",
            ));
        }
        match crate::service::db::re_pattern::remove(&id).await {
            Ok(_) => {
                remove_ownership(&org_id, "re_patterns", Authz::new(&id)).await;
                MetaHttpResponse::ok("Pattern removed successfully")
            }
            Err(e) => MetaHttpResponse::internal_error(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(id);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// delete pattern with given id
#[cfg(feature = "enterprise")]
#[utoipa::path(
    delete,
    path = "/{org_id}/re_patterns/bulk",
    context_path = "/api",
    summary = "Delete regex pattern in bulk",
    description = "Removes multiple regex patterns from the system using its identifiers",
    params(
        ("org_id" = String, Path, description = "org id of for the patterns to delete", example = "default")
    ),
    request_body(
        content = BulkDeleteRequest,
        description = "re_patterns to delete",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
    ),
    tag = "RePattern"
)]
pub async fn delete_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    use o2_enterprise::enterprise::re_patterns::get_pattern_manager;

    use crate::common::utils::auth::check_permissions;

    let user_id = user_email.user_id;
    let mgr = match get_pattern_manager().await {
        Ok(m) => m,
        Err(e) => {
            return MetaHttpResponse::internal_error(
                format!("Cannot get pattern manager : {e:?}",),
            );
        }
    };

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for id in &req.ids {
        if !check_permissions(id, &org_id, &user_id, "re_patterns", "DELETE", None).await {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
        let pattern_usage = mgr.get_pattern_usage(id);
        let (pattern_streams, extra) = if pattern_usage.len() > 5 {
            (
                &pattern_usage[0..5],
                format!(" and {} more", pattern_usage.len() - 5),
            )
        } else {
            (&pattern_usage[0..], "".to_string())
        };
        if !pattern_usage.is_empty() {
            unsuccessful.push(id.to_string());
            err = Some(format!(
                "Cannot delete pattern, associated with {pattern_streams:?}{extra}"
            ));
        }
    }
    if !unsuccessful.is_empty() {
        return MetaHttpResponse::json(BulkDeleteResponse {
            successful,
            unsuccessful,
            err,
        });
    }

    for id in req.ids {
        match crate::service::db::re_pattern::remove(&id).await {
            Ok(_) => {
                remove_ownership(&org_id, "re_patterns", Authz::new(&id)).await;
                successful.push(id);
            }
            Err(e) => {
                log::error!("error while deleting pattern {org_id}/{id} : {e}");
                unsuccessful.push(id);
                err = Some(e.to_string());
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// update the pattern for given id
#[utoipa::path(
    put,
    path = "/{org_id}/re_patterns/{id}",
    context_path = "/api",
    summary = "Update regex pattern by ID",
    description = "Modifies an existing regex pattern's configuration and rules",
    params(
        ("id" = String, Path, description = "id of the pattern to update", example = "12345")
    ),
    request_body(
        content = inline(PatternCreateRequest),
        description = "updated pattern data",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "Empty response",
            body = (),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "RePattern"
)]
pub async fn update(
    Path((_org_id, id)): Path<(String, String)>,
    Json(req): Json<PatternCreateRequest>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::re_pattern_stream_map::PatternPolicy;
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        match infra::table::re_pattern::get(&id).await {
            Ok(Some(k)) => k,
            Ok(None) => {
                return MetaHttpResponse::not_found(format!("Pattern with id {id} not found"));
            }
            Err(e) => return MetaHttpResponse::internal_error(e),
        };

        match PatternManager::test_pattern(
            req.pattern.clone(),
            "".to_string(),
            PatternPolicy::Redact,
        ) {
            Ok(_) => {}
            Err(e) => return MetaHttpResponse::bad_request(e),
        }

        // we can be fairly certain that in db we have proper json

        match crate::service::db::re_pattern::update(&id, &req.pattern).await {
            Ok(_) => MetaHttpResponse::ok("Pattern updated successfully"),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(id);
        drop(req);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// Store a re_pattern in db
#[utoipa::path(
    post,
    path = "/{org_id}/re_patterns/test",
    context_path = "/api",
    summary = "Test regex pattern against sample data",
    description = "Tests a regex pattern against sample input strings to validate pattern matching",
    request_body(
        content = inline(PatternTestRequest),
        description = "re_pattern to test and strings to test against",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "array of strings",
            body = inline(PatternTestResponse),
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "RePattern"
)]
pub async fn test(Json(req): Json<PatternTestRequest>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::re_pattern_stream_map::PatternPolicy;
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        let pattern = req.pattern;
        let inputs = req.test_records;
        // Default to Redact if policy not specified for backward compatibility
        let policy = req.policy.as_deref().unwrap_or("Redact");
        let policy = PatternPolicy::from(policy);

        let mut ret = Vec::with_capacity(inputs.len());
        for i in inputs {
            match PatternManager::test_pattern(pattern.clone(), i, policy) {
                Ok(v) => {
                    ret.push(v);
                }
                Err(e) => {
                    return MetaHttpResponse::bad_request(format!(
                        "Error in testing pattern for input : {e}"
                    ));
                }
            }
        }

        MetaHttpResponse::json(PatternTestResponse { results: ret })
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(req);
        MetaHttpResponse::forbidden("not supported")
    }
}

/// Get built-in patterns from GitHub (pyWhat)
#[utoipa::path(
    get,
    path = "/{org_id}/re_patterns/built-in",
    context_path = "/api",
    summary = "Get built-in regex patterns from GitHub",
    description = "Fetches curated regex patterns from the pyWhat project on GitHub. Supports search and tag filtering. Uses frontend caching only.",
    params(
        ("search" = Option<String>, Query, description = "Search query to filter patterns by name, description, or tags"),
        ("tags" = Option<Vec<String>>, Query, description = "Filter patterns by specific tags")
    ),
    responses(
        (
            status = 200,
            description = "Built-in patterns list",
            body = BuiltInPatternsResponse,
            content_type = "application/json",
        ),
        (status = 500, description = "Failed to fetch patterns", content_type = "application/json")
    ),
    tag = "RePattern"
)]
pub async fn get_built_in_patterns(
    Path(_org_id): Path<String>,
    Query(query): Query<BuiltInPatternsQuery>,
) -> Response {
    use crate::service::github::{GitHubDataService, adapters::PyWhatAdapter};

    // Create GitHub service
    let github_service = GitHubDataService::new();

    // Fetch patterns without backend caching
    let mut patterns = match PyWhatAdapter::fetch_built_in_patterns(&github_service).await {
        Ok(patterns) => patterns,
        Err(e) => {
            log::error!("Failed to fetch built-in patterns: {}", e);
            return MetaHttpResponse::internal_error(format!(
                "Failed to fetch built-in patterns: {}",
                e
            ));
        }
    };

    // Apply search filter
    if !query.search.is_empty() {
        patterns = PyWhatAdapter::filter_by_search(patterns, &query.search);
    }

    // Apply tag filter
    if !query.tags.is_empty() {
        patterns = PyWhatAdapter::filter_by_tags(patterns, &query.tags);
    }

    let config = config::get_config();
    let response = BuiltInPatternsResponse {
        patterns,
        last_updated: chrono::Utc::now().timestamp(),
        source_url: config.common.regex_patterns_source_url.clone(),
    };

    MetaHttpResponse::json(response)
}
