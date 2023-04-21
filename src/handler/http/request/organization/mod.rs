// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{get, http, put, route, web, HttpResponse, Responder, Result};
use actix_web_httpauth::extractors::basic::BasicAuth;
use std::collections::HashSet;
use std::io::Error;

use crate::common::auth::is_root_user;
use crate::infra::config::USERS;
use crate::meta::organization::{
    OrgDetails, OrgUser, OrganizationResponse, PasscodeResponse, CUSTOM, DEFAULT_ORG, THRESHOLD,
};
use crate::service::organization::get_passcode;
use crate::service::organization::{self, update_passcode};

/** Get user organizations */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetUserOrganizations",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = OrganizationResponse),
    )
)]
#[get("/{org_id}/organizations")]
pub async fn organizations(credentials: BasicAuth) -> Result<HttpResponse, Error> {
    let user_id = credentials.user_id();
    let mut id = 0;

    let mut orgs: Vec<OrgDetails> = vec![];
    let mut org_names = HashSet::new();
    let user_detail = OrgUser {
        first_name: user_id.to_string(),
        last_name: user_id.to_string(),
        email: user_id.to_string(),
    };

    let is_root_user = is_root_user(user_id).await;
    if is_root_user {
        id += 1;
        org_names.insert(DEFAULT_ORG.to_string());
        orgs.push(OrgDetails {
            id,
            identifier: DEFAULT_ORG.to_string(),
            name: DEFAULT_ORG.to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: DEFAULT_ORG.to_string(),
            user_obj: user_detail.clone(),
        });
    }

    for user in USERS.iter() {
        if !user.key().contains('/') {
            continue;
        }
        if !is_root_user && !user.key().ends_with(&format!("/{user_id}")) {
            continue;
        }

        id += 1;
        let org = OrgDetails {
            id,
            identifier: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            name: user.key().split('/').collect::<Vec<&str>>()[0].to_string(),
            user_email: user_id.to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: CUSTOM.to_string(),
            user_obj: user_detail.clone(),
        };
        if !org_names.contains(&org.identifier) {
            org_names.insert(org.identifier.clone());
            orgs.push(org)
        }
    }

    let org_response = OrganizationResponse { data: orgs };

    Ok(HttpResponse::Ok().json(org_response))
}

/** Get organization summary */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationSummary",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = OrgSummary),
    )
)]
#[get("/{org_id}/summary")]
async fn org_summary(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let org_summary = organization::get_summary(&org).await;
    Ok(HttpResponse::Ok().json(org_summary))
}

/** Get ingest token for current user */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "GetOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = PasscodeResponse),
    )
)]
#[get("/{org_id}/organizations/passcode")]
async fn get_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id).await {
        org_id = None;
    }
    let passcode = get_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}

/** Update ingest token for current user */
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "UpdateOrganizationUserIngestToken",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = PasscodeResponse),
    )
)]
#[put("/{org_id}/organizations/passcode")]
async fn update_user_passcode(
    credentials: BasicAuth,
    org_id: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let org = org_id.into_inner();
    let user_id = credentials.user_id();
    let mut org_id = Some(org.as_str());
    if is_root_user(user_id).await {
        org_id = None;
    }
    let passcode = update_passcode(org_id, user_id).await;
    Ok(HttpResponse::Ok().json(PasscodeResponse { data: passcode }))
}

#[get("/{org_id}/")]
async fn org_es_index(_org_id: web::Path<String>) -> impl Responder {
    // eg.1: User-Agent:[elastic-transport-ruby/8.0.1 (RUBY_VERSION: 3.1.2; linux x86_64; Faraday v1.10.0)]
    // eg.2: Elastic-filebeat/7.17.1 (linux; arm64; 1d05ba86138cfc9a5ae5c0acc64a57b8d81678ff; 2022-02-24 01:00:19 +0000 UTC)
    let version = "8.1.0";
    let es_info = r#"{"name":"opensearch","cluster_name":"opensearch-cluster","cluster_uuid":"h3nGzoJ1R12fZz","version":{"number":"0.0.0","build_flavor":"default","build_hash":"0","build_date":"0","build_snapshot":false,"lucene_version":"8.9.0","minimum_wire_version":"7.10.0","minimum_index_compatibility":"8.1.0"},"tagline":"You Know, for Search"}"#;
    let es_info = es_info.replace("0.0.0", version);
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[get("/{org_id}/_license")]
async fn org_es_license(_org_id: web::Path<String>) -> impl Responder {
    let es_info = r#"{"status":"active"}"#;
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[get("/{org_id}/_xpack")]
async fn org_es_xpack(_org_id: web::Path<String>) -> impl Responder {
    let es_info = r#"{"build":{},"features":{},"license":{"status":"active"}}"#;
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[route("/{org_id}/_index_template/{name}", method = "GET", method = "HEAD")]
async fn org_es_index_template(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"index_patterns":["log-*"],"name":"logs","priority":1,"template":{"mappings":{"properties":{"_timestamp":{"aggregatable":false,"highlightable":false,"index":true,"sortable":false,"store":false,"type":"date"}}},"settings":{"number_of_replicas":1,"number_of_shards":3}}}"#;
    let es_info = es_info.replace("logs", &name);
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[put("/{org_id}/_index_template/{name}")]
async fn org_es_index_template_create(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"name":"logs","message":"ok"}"#;
    let es_info = es_info.replace("logs", &name);
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[route("/{org_id}/_data_stream/{name}", method = "GET", method = "HEAD")]
async fn org_es_data_stream(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"data_streams":{"name":"logs","timestamp_field":{"name":"_timestamp"}}}"#;
    let es_info = es_info.replace("logs", &name);
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}

#[put("/{org_id}/_data_stream/{name}")]
async fn org_es_data_stream_create(path: web::Path<(String, String)>) -> impl Responder {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"name":"logs","message":"ok"}"#;
    let es_info = es_info.replace("logs", &name);
    HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info)
}
