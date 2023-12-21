// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{get, HttpResponse};
use ahash::AHashMap as HashMap;
use datafusion::arrow::datatypes::{Field, Schema};
use serde::Serialize;
use utoipa::ToSchema;
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::jwt::{process_token, verify_decode_token},
    crate::handler::http::auth::validator::{ACCESS_TOKEN, PKCE_STATE_ORG, REFRESH_TOKEN},
    actix_web::{cookie::Cookie, http::header, web, HttpRequest},
    o2_enterprise::enterprise::{
        common::infra::config::O2_CONFIG,
        dex::service::auth::{exchange_code, get_dex_login, get_jwks, refresh_token},
    },
    std::io::ErrorKind,
};

use crate::{
    common::{
        infra::{cache, cluster, config::*, file_list},
        meta::functions::ZoFunction,
        utils::json,
    },
    service::{db, search::datafusion::DEFAULT_FUNCTIONS},
};

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
    sql_base64_enabled: bool,
    timestamp_column: String,
    syslog_enabled: bool,
    data_retention_days: i64,
    restricted_routes_on_empty_data: bool,
    dex_enabled: bool,
}

/// Healthz
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
    #[cfg(feature = "enterprise")]
    let dex_enabled = O2_CONFIG.dex.dex_enabled;
    #[cfg(not(feature = "enterprise"))]
    let dex_enabled = false;

    Ok(HttpResponse::Ok().json(ConfigResponse {
        version: VERSION.to_string(),
        instance: INSTANCE_ID.get("instance_id").unwrap().to_string(),
        commit_hash: COMMIT_HASH.to_string(),
        build_date: BUILD_DATE.to_string(),
        functions_enabled: HAS_FUNCTIONS,
        telemetry_enabled: CONFIG.common.telemetry_enabled,
        default_fts_keys: SQL_FULL_TEXT_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_functions: DEFAULT_FUNCTIONS.to_vec(),
        lua_fn_enabled: false,
        sql_base64_enabled: CONFIG.common.ui_sql_base64_enabled,
        timestamp_column: CONFIG.common.column_timestamp.clone(),
        syslog_enabled: *SYSLOG_ENABLED.read(),
        data_retention_days: CONFIG.compact.data_retention_days,
        restricted_routes_on_empty_data: CONFIG.common.restricted_routes_on_empty_data,
        dex_enabled,
    }))
}

#[get("/cache/status")]
pub async fn cache_status() -> Result<HttpResponse, Error> {
    let mut stats: HashMap<&str, json::Value> = HashMap::default();
    stats.insert(
        "LOCAL_NODE_UUID",
        json::json!(cluster::LOCAL_NODE_UUID.clone()),
    );
    stats.insert("LOCAL_NODE_NAME", json::json!(&CONFIG.common.instance_name));
    stats.insert("LOCAL_NODE_ROLE", json::json!(&CONFIG.common.node_role));
    let nodes = cluster::get_cached_online_nodes();
    stats.insert("NODE_LIST", json::json!(nodes));

    let (stream_num, stream_schema_num, mem_size) = get_stream_schema_status();
    stats.insert("STREAM_SCHEMA", json::json!({"stream_num": stream_num,"stream_schema_num": stream_schema_num, "mem_size": mem_size}));

    let stream_num = cache::stats::get_stream_stats_len();
    let mem_size = cache::stats::get_stream_stats_in_memory_size();
    stats.insert(
        "STREAM_STATS",
        json::json!({"stream_num": stream_num, "mem_size": mem_size}),
    );

    let mem_file_num = cache::file_data::memory::len().await;
    let (mem_max_size, mem_cur_size) = cache::file_data::memory::stats().await;
    let disk_file_num = cache::file_data::disk::len().await;
    let (disk_max_size, disk_cur_size) = cache::file_data::disk::stats().await;
    stats.insert(
        "FILE_DATA",
        json::json!({
            "memory":{"cache_files":mem_file_num, "cache_limit":mem_max_size,"cache_bytes": mem_cur_size},
            "disk":{"cache_files":disk_file_num, "cache_limit":disk_max_size,"cache_bytes": disk_cur_size}
        }),
    );

    let file_list_num = file_list::len().await;
    let file_list_max_id = file_list::get_max_pk_value().await.unwrap_or_default();
    stats.insert(
        "FILE_LIST",
        json::json!({"num":file_list_num,"max_id": file_list_max_id}),
    );

    let tmpfs_mem_size = cache::tmpfs::stats().unwrap();
    stats.insert("TMPFS", json::json!({ "mem_size": tmpfs_mem_size }));

    let last_file_list_offset = db::compact::file_list::get_offset().await.unwrap();
    stats.insert(
        "COMPACT",
        json::json!({"file_list_offset": last_file_list_offset}),
    );

    Ok(HttpResponse::Ok().json(stats))
}

fn get_stream_schema_status() -> (usize, usize, usize) {
    let mut stream_num = 0;
    let mut stream_schema_num = 0;
    let mut mem_size = 0;
    for item in STREAM_SCHEMAS.iter() {
        stream_num += 1;
        mem_size += std::mem::size_of::<Vec<Schema>>();
        mem_size += item.key().len();
        for schema in item.value().iter() {
            stream_schema_num += 1;
            for (key, val) in schema.metadata.iter() {
                mem_size += std::mem::size_of::<HashMap<String, String>>();
                mem_size += key.len() + val.len();
            }
            mem_size += std::mem::size_of::<Vec<Field>>();
            for field in schema.fields() {
                mem_size += std::mem::size_of::<Field>();
                mem_size += field.name().len();
            }
        }
    }
    (stream_num, stream_schema_num, mem_size)
}

#[cfg(feature = "enterprise")]
#[get("/callback")]
pub async fn callback(req: HttpRequest) -> Result<HttpResponse, Error> {
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let code = match query.get("code") {
        Some(code) => code,
        None => {
            return Err(Error::new(ErrorKind::Other, "no code in request"));
        }
    };

    match query.get("state") {
        Some(code) => match crate::service::kv::get(PKCE_STATE_ORG, code).await {
            Ok(_) => {
                let _ = crate::service::kv::delete(PKCE_STATE_ORG, code).await;
            }
            Err(_) => {
                return Err(Error::new(ErrorKind::Other, "invalid state in request"));
            }
        },

        None => {
            return Err(Error::new(ErrorKind::Other, "no state in request"));
        }
    };

    match exchange_code(code).await {
        Ok(login_data) => {
            let token = login_data.access_token;
            let keys = get_jwks().await;
            let token_ver =
                verify_decode_token(&token, &keys, &O2_CONFIG.dex.client_id, true).await;

            match token_ver {
                Ok(res) => process_token(res).await,
                Err(e) => return Ok(HttpResponse::Unauthorized().json(e.to_string())),
            }

            let mut access_token_cookie = Cookie::new(ACCESS_TOKEN, token);
            access_token_cookie.set_http_only(true);
            access_token_cookie.set_secure(true);
            access_token_cookie.set_path("/");
            access_token_cookie.set_same_site(actix_web::cookie::SameSite::Lax);

            let mut refresh_token_cookie = Cookie::new(REFRESH_TOKEN, login_data.refresh_token);
            refresh_token_cookie.set_http_only(true);
            refresh_token_cookie.set_secure(true);
            refresh_token_cookie.set_path("/");
            refresh_token_cookie.set_same_site(actix_web::cookie::SameSite::Lax);

            Ok(HttpResponse::Found()
                .append_header((header::LOCATION, login_data.url))
                .cookie(access_token_cookie)
                .cookie(refresh_token_cookie)
                .finish())
        }
        Err(e) => Ok(HttpResponse::Unauthorized().json(e.to_string())),
    }
}

#[cfg(feature = "enterprise")]
#[get("/dex_login")]
pub async fn dex_login() -> Result<HttpResponse, Error> {
    use o2_enterprise::enterprise::dex::meta::auth::PreLoginData;

    let login_data: PreLoginData = get_dex_login();
    let state = login_data.state;
    let _ = crate::service::kv::set(PKCE_STATE_ORG, &state, state.to_owned().into()).await;

    Ok(HttpResponse::Ok().json(login_data.url))
}

#[cfg(feature = "enterprise")]
#[get("/dex_refresh")]
async fn refresh_token_with_dex(req: actix_web::HttpRequest) -> HttpResponse {
    let token = if let Some(cookie) = req.cookie("refresh_token") {
        cookie.value().to_string()
    } else {
        return HttpResponse::Unauthorized().finish();
    };

    // Exchange the refresh token for a new access token

    match refresh_token(&token).await {
        Ok(token_response) => {
            // Set the new access token in the cookie
            let mut access_token_cookie = Cookie::new(ACCESS_TOKEN, token_response);
            access_token_cookie.set_http_only(true);
            access_token_cookie.set_secure(true);
            access_token_cookie.set_path("/");
            access_token_cookie.set_same_site(actix_web::cookie::SameSite::Lax);

            HttpResponse::Ok().cookie(access_token_cookie).finish()
        }
        Err(_) => {
            let access_cookie = Cookie::new(ACCESS_TOKEN, "");
            let refresh_cookie = Cookie::new(REFRESH_TOKEN, "");
            let mut response = HttpResponse::Unauthorized().finish();
            response.add_removal_cookie(&access_cookie).unwrap();
            response.add_removal_cookie(&refresh_cookie).unwrap();
            response
        }
    }
}
