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

use actix_web::{get, HttpResponse};
use serde::Serialize;
use std::io::Error;
use utoipa::ToSchema;

use crate::infra::config::{self, CONFIG, INSTANCE_ID};
use crate::meta::functions::ZoFunction;
use crate::service::search::datafusion::DEFAULT_FUNCTIONS;

#[derive(Serialize, ToSchema)]
pub struct HealthzResponse {
    status: String,
}

#[derive(Serialize)]
struct ConfigResponse<'a> {
    version: String,
    instance: String,
    commit_hash: String,
    build_date: String,
    functions_enabled: bool,
    default_fts_keys: Vec<String>,
    telemetry_enabled: bool,
    default_functions: Vec<ZoFunction<'a>>,
    lua_fn_enabled: bool,
}

/** healthz */
#[utoipa::path(
    path = "/healthz",
    tag = "Meta",
    responses(
        (status = 200, description="Staus OK", content_type = "application/json", body = HealthzResponse, example = json!({"status": "ok"}))
    )
)]
#[get("/healthz")]
pub async fn healthz() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(HealthzResponse {
        status: "ok".to_string(),
    }))
}

#[get("")]
pub async fn zo_config() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(ConfigResponse {
        version: config::VERSION.to_string(),
        instance: INSTANCE_ID.get("instance_id").unwrap().to_string(),
        commit_hash: config::COMMIT_HASH.to_string(),
        build_date: config::BUILD_DATE.to_string(),
        functions_enabled: config::HAS_FUNCTIONS,
        telemetry_enabled: CONFIG.common.telemetry_enabled,
        default_fts_keys: crate::common::stream::SQL_FULL_TEXT_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_functions: DEFAULT_FUNCTIONS.to_vec(),
        lua_fn_enabled: CONFIG.common.lua_fn_enabled,
    }))
}
