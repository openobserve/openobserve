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

use actix_web::{HttpRequest, HttpResponse, delete, get, http, post, put, web};
use infra::table::re_pattern::PatternEntry;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(feature = "enterprise")]
use crate::common::{
    meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    utils::auth::{remove_ownership, set_ownership},
};

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternCreateRequest {
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
    pub patterns: Vec<PatternInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternTestRequest {
    pattern: String,
    test_records: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
struct PatternTestResponse {
    results: Vec<String>,
}

/// Store a re_pattern in db
#[utoipa::path(
    post,
    context_path = "/api",
    request_body(
        content = PatternCreateRequest,
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
#[post("/{org_id}/re_patterns")]
pub async fn save(
    org_id: web::Path<String>,
    body: web::Bytes,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::{re_pattern::PatternEntry, re_pattern_stream_map::PatternPolicy};
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        let req: PatternCreateRequest = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        if req.name.contains(":") {
            return Ok(MetaHttpResponse::bad_request(
                "Pattern name cannot have ':' in it",
            ));
        }

        let user_id = match in_req
            .headers()
            .get("user_id")
            .and_then(|v| v.to_str().ok())
        {
            Some(id) => id,
            None => return Ok(MetaHttpResponse::bad_request("Invalid user_id in request")),
        };

        match PatternManager::test_pattern(
            req.pattern.clone(),
            "".to_string(),
            PatternPolicy::Redact,
        ) {
            Ok(_) => {}
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
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
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK,
                    "Pattern created successfully",
                )))
            }
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        drop(in_req);
        drop(body);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// get pattern with given id if present
#[utoipa::path(
    get,
    context_path = "/api",
    params(
        ("id" = String, Path, description = "id of the pattern to retrieve", example = "12345")
    ),
    responses(
        (
            status = 200,
            description = "Pattern info",
            body = PatternGetResponse,
            content_type = "application/json",
        ),
        (status = 404, description = "Pattern not found", content_type = "text/plain")
    ),
    tag = "RePattern"
)]
#[get("/{org_id}/re_patterns/{id}")]
pub async fn get(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let (_org_id, id) = path.into_inner();

        let pattern = match infra::table::re_pattern::get(&id).await {
            Ok(Some(k)) => k,
            Ok(None) => {
                return Ok(MetaHttpResponse::not_found(format!(
                    "Pattern with id {id} not found"
                )));
            }
            Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
        };

        let res: PatternGetResponse = pattern.into();
        Ok(HttpResponse::Ok().json(res))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// list all patterns for given org
#[utoipa::path(
    get,
    context_path = "/api",
    responses(
        (
            status = 200,
            description = "list all patterns in the org",
            body = PatternListResponse,
            content_type = "application/json",
        ),
    ),
    tag = "RePattern"
)]
#[get("/{org_id}/re_patterns")]
pub async fn list(path: web::Path<String>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        let org_id = path.into_inner();

        let patterns = match infra::table::re_pattern::list_by_org(&org_id).await {
            Ok(list) => list,
            Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
        };

        let patterns = patterns.into_iter().map(|p| p.into()).collect::<Vec<_>>();

        let res = PatternListResponse { patterns };
        Ok(HttpResponse::Ok().json(res))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// delete pattern with given id
#[utoipa::path(
    delete,
    context_path = "/api",
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
#[delete("/{org_id}/re_patterns/{id}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::re_patterns::get_pattern_manager;

        let (org_id, id) = path.into_inner();
        let mgr = match get_pattern_manager().await {
            Ok(m) => m,
            Err(e) => {
                return Ok(
                    HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Cannot get pattern manager : {e:?}"),
                    )),
                );
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
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("Cannot delete pattern, associated with {pattern_streams:?}{extra}",),
            )));
        }
        match crate::service::db::re_pattern::remove(&id).await {
            Ok(_) => {
                remove_ownership(&org_id, "re_patterns", Authz::new(&id)).await;
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK,
                    "Pattern removed successfully",
                )))
            }
            Err(e) => Ok(MetaHttpResponse::internal_error(e)),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// update the pattern for given id
#[utoipa::path(
    put,
    context_path = "/api",
    params(
        ("id" = String, Path, description = "id of the pattern to update", example = "12345")
    ),
    request_body(
        content = PatternCreateRequest,
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
#[put("/{org_id}/re_patterns/{id}")]
pub async fn update(
    path: web::Path<(String, String)>,
    body: web::Bytes,
) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::re_pattern_stream_map::PatternPolicy;
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        let (_org_id, id) = path.into_inner();
        let req: PatternCreateRequest = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        match infra::table::re_pattern::get(&id).await {
            Ok(Some(k)) => k,
            Ok(None) => {
                return Ok(MetaHttpResponse::not_found(format!(
                    "Pattern with id {id} not found"
                )));
            }
            Err(e) => return Ok(MetaHttpResponse::internal_error(e)),
        };

        match PatternManager::test_pattern(
            req.pattern.clone(),
            "".to_string(),
            PatternPolicy::Redact,
        ) {
            Ok(_) => {}
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        }

        // we can be fairly certain that in db we have proper json

        match crate::service::db::re_pattern::update(&id, &req.pattern).await {
            Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK,
                "Pattern updated successfully",
            ))),
            Err(e) => Ok(MetaHttpResponse::bad_request(e)),
        }
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(path);
        drop(body);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}

/// Store a re_pattern in db
#[utoipa::path(
    post,
    context_path = "/api",
    request_body(
        content = PatternTestRequest,
        description = "re_pattern to test and strings to test against",
        content_type = "application/json",
    ),
    responses(
        (
            status = 200,
            description = "array of strings",
            body = PatternTestResponse,
            content_type = "application/json",
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    tag = "RePattern"
)]
#[post("/{org_id}/re_patterns/test")]
pub async fn test(body: web::Bytes) -> Result<HttpResponse, Error> {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::re_pattern_stream_map::PatternPolicy;
        use o2_enterprise::enterprise::re_patterns::PatternManager;

        let req: PatternTestRequest = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return Ok(MetaHttpResponse::bad_request(e)),
        };

        let pattern = req.pattern;
        let inputs = req.test_records;
        let mut ret = Vec::with_capacity(inputs.len());
        for i in inputs {
            match PatternManager::test_pattern(pattern.clone(), i, PatternPolicy::Redact) {
                Ok(v) => {
                    ret.push(v);
                }
                Err(e) => {
                    return Ok(MetaHttpResponse::bad_request(format!(
                        "Error in testing pattern for input : {e}"
                    )));
                }
            }
        }

        Ok(HttpResponse::Ok().json(PatternTestResponse { results: ret }))
    }
    #[cfg(not(feature = "enterprise"))]
    {
        drop(body);
        Ok(MetaHttpResponse::forbidden("not supported"))
    }
}
