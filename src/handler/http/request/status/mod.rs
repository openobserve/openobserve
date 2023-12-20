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
#[cfg(feature = "enterprise")]
use std::io::ErrorKind;

use actix_web::{get, HttpResponse};
#[cfg(feature = "enterprise")]
use actix_web::{http::header, web, HttpRequest};
use ahash::AHashMap as HashMap;
use datafusion::arrow::datatypes::{Field, Schema};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::dex::service::{
    auth as dex_auth,
    auth::{exchange_code, get_jwks},
};
#[cfg(feature = "enterprise")]
use regex::bytes::Regex;
use serde::Serialize;
use utoipa::ToSchema;

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
    use o2_enterprise::enterprise::common::infra::config::O2_CONFIG;

    use crate::{
        common::{
            meta::user::{DBUser, UserOrg},
            utils::jwt::verify_decode_token,
        },
        service::users,
    };

    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let code = match query.get("code") {
        Some(code) => code,
        None => {
            return Err(Error::new(ErrorKind::Other, "no code in request"));
        }
    };

    // TODO Validate state from db
    let state = match query.get("state") {
        Some(code) => code,
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
                Ok(res) => {
                    let dec_token = res.1.unwrap();
                    let groups = dec_token.claims.get("groups").unwrap().as_array().unwrap();
                    let name = dec_token.claims.get("name").unwrap().as_str().unwrap();
                    let user_email = res.0.user_email.to_owned();
                    let mut source_orgs: Vec<UserOrg> = vec![];
                    for group in groups {
                        let test = parse_dn(group.as_str().unwrap()).unwrap();

                        let role = if test.0.contains("admin") {
                            crate::common::meta::user::UserRole::Admin
                        } else {
                            crate::common::meta::user::UserRole::Member
                        };
                        source_orgs.push(UserOrg {
                            role,
                            name: test.1,
                            ..UserOrg::default()
                        });
                    }
                    // Check if the user exists in the database
                    let db_user = db::user::get_user_by_email(&user_email).await;
                    let updated_db_user = if db_user.is_none() {
                        log::info!("User does not exist in the database");
                        DBUser {
                            email: user_email.to_owned(),
                            first_name: name.to_owned(),
                            last_name: "".to_owned(),
                            password: "".to_owned(),
                            salt: "".to_owned(),
                            organizations: source_orgs,
                            is_external: true,
                        }
                    } else {
                        log::info!("User exists in the database perform check for role change");
                        let existing_db_user = db_user.unwrap();
                        let mut existing_orgs = existing_db_user.organizations;

                        // Find and remove users from cache
                        for org in existing_orgs.iter() {
                            if !source_orgs.iter().any(|src_org| src_org.name == org.name) {
                                USERS.remove(&format!("{}/{}", org.name, user_email));
                            }
                        }

                        // 1. Remove organizations not in source_orgs
                        existing_orgs.retain(|org| {
                            source_orgs.iter().any(|src_org| src_org.name == org.name)
                        });
                        // 2. Update roles for existing organizations
                        for org in existing_orgs.iter_mut() {
                            if let Some(src_org) =
                                source_orgs.iter().find(|src_org| src_org.name == org.name)
                            {
                                org.role = src_org.role.clone();
                            }
                        }
                        // 3. Add new organizations from source_orgs
                        for src_org in source_orgs {
                            if !existing_orgs.iter().any(|org| org.name == src_org.name) {
                                existing_orgs.push(src_org.clone());
                            }
                        }

                        DBUser {
                            email: user_email.to_owned(),
                            first_name: name.to_owned(),
                            last_name: "".to_owned(),
                            password: existing_db_user.password,
                            salt: existing_db_user.salt,
                            organizations: existing_orgs,
                            is_external: true,
                        }
                    };
                    let _ = users::update_db_user(updated_db_user).await;
                }
                Err(e) => return Ok(HttpResponse::Unauthorized().json(e.to_string())),
            }

            Ok(HttpResponse::Found()
                .append_header((header::LOCATION, login_data.url))
                .finish())
        }
        Err(e) => Ok(HttpResponse::Unauthorized().json(e.to_string())),
    }
}

#[cfg(feature = "enterprise")]
#[get("/dex_login")]
pub async fn dex_login() -> Result<HttpResponse, Error> {
    use o2_enterprise::enterprise::dex::meta::PreLoginData;

    let login_data: PreLoginData = dex_auth::get_dex_login();
    let state = login_data.state;

    Ok(HttpResponse::Ok().json(login_data.url))
}

#[cfg(feature = "enterprise")]
fn parse_dn(dn: &str) -> Option<(String, String)> {
    let re = Regex::new(r"cn=(?P<role>[^,]+),ou=(?P<team>[^,]+)").unwrap();

    re.captures(dn.as_bytes()).map(|caps| {
        let role = String::from_utf8_lossy(caps.name("role").unwrap().as_bytes()).to_string();
        let team = String::from_utf8_lossy(caps.name("team").unwrap().as_bytes()).to_string();
        (role, team)
    })
}
