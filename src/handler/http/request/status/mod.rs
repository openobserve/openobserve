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

use std::{io::Error, sync::Arc};

use actix_web::{
    HttpResponse, cookie,
    cookie::{Cookie, SameSite},
    get, head,
    http::header,
    post, put, web,
};
use arrow_schema::Schema;
use config::{
    Config, META_ORG_ID, QUICK_MODEL_FIELDS, SQL_FULL_TEXT_SEARCH_FIELDS,
    SQL_SECONDARY_INDEX_SEARCH_FIELDS, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config, get_instance_id,
    meta::{
        cluster::{NodeStatus, Role, RoleGroup},
        function::ZoFunction,
        search::{HashFileRequest, HashFileResponse},
    },
    utils::{base64, json, schema_ext::SchemaExt},
};
use hashbrown::HashMap;
use infra::{
    cache, file_list,
    schema::{STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST},
};
use serde::Serialize;
use utoipa::ToSchema;
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::{auth::extract_auth_str, jwt::verify_decode_token},
    crate::handler::http::auth::{
        jwt::process_token,
        validator::{ID_TOKEN_HEADER, PKCE_STATE_ORG, get_user_email_from_auth_str},
    },
    crate::service::self_reporting::audit,
    config::{ider, utils::time::now_micros},
    o2_dex::{
        config::{get_config as get_dex_config, refresh_config as refresh_dex_config},
        service::auth::{exchange_code, get_dex_jwks, get_dex_login, refresh_token},
    },
    o2_enterprise::enterprise::common::{
        auditor::{AuditMessage, Protocol, ResponseMeta},
        config::{get_config as get_o2_config, refresh_config as refresh_o2_config},
        settings::{get_logo, get_logo_dark, get_logo_text},
    },
    o2_openfga::config::{
        get_config as get_openfga_config, refresh_config as refresh_openfga_config,
    },
};

use crate::{
    common::{
        infra::cluster,
        meta::{
            http::HttpResponse as MetaHttpResponse,
            user::{AuthTokens, AuthTokensExt},
        },
    },
    service::{
        db,
        search::{
            datafusion::{storage::file_statistics_cache, udf::DEFAULT_FUNCTIONS},
            grpc::tantivy_result_cache,
        },
    },
};

#[derive(Serialize, serde::Deserialize, ToSchema)]
pub struct HealthzResponse {
    status: String,
}

#[cfg(feature = "enterprise")]
pub fn reload_enterprise_config() -> Result<(), anyhow::Error> {
    refresh_o2_config()
        .and_then(|_| refresh_dex_config())
        .and_then(|_| refresh_openfga_config())
}

#[derive(Serialize)]
struct ConfigResponse<'a> {
    version: String,
    instance: String,
    commit_hash: String,
    build_date: String,
    build_type: String,
    default_fts_keys: Vec<String>,
    default_secondary_index_fields: Vec<String>,
    default_quick_mode_fields: Vec<String>,
    telemetry_enabled: bool,
    default_functions: Vec<ZoFunction<'a>>,
    sql_base64_enabled: bool,
    timestamp_column: String,
    data_retention_days: i64,
    extended_data_retention_days: i64,
    restricted_routes_on_empty_data: bool,
    sso_enabled: bool,
    native_login_enabled: bool,
    saml_enabled: bool,
    saml_default_auth: String,
    rbac_enabled: bool,
    super_cluster_enabled: bool,
    query_on_stream_selection: bool,
    show_stream_stats_doc_num: bool,
    custom_logo_text: String,
    custom_slack_url: String,
    custom_docs_url: String,
    rum: Rum,
    custom_logo_img: Option<String>,
    custom_logo_dark_img: Option<String>,
    custom_hide_menus: String,
    custom_hide_self_logo: bool,
    meta_org: String,
    quick_mode_enabled: bool,
    user_defined_schemas_enabled: bool,
    user_defined_schema_max_fields: usize,
    all_fields_name: String,
    usage_enabled: bool,
    usage_publish_interval: i64,
    ingestion_url: String,
    #[cfg(feature = "enterprise")]
    streaming_aggregation_enabled: bool,
    min_auto_refresh_interval: u32,
    query_default_limit: i64,
    max_dashboard_series: usize,
    actions_enabled: bool,
    streaming_enabled: bool,
    histogram_enabled: bool,
    max_query_range: i64,
    ai_enabled: bool,
    dashboard_placeholder: String,
    dashboard_show_symbol_enabled: bool,
    ingest_flatten_level: u32,
    #[cfg(feature = "enterprise")]
    license_expiry: i64,
    #[cfg(feature = "enterprise")]
    license_server_url: String,
    #[cfg(feature = "enterprise")]
    ingestion_quota_used: f64,
    log_page_default_field_list: String,
    query_values_default_num: i64,
}

#[derive(Serialize, serde::Deserialize)]
struct Rum {
    pub enabled: bool,
    pub client_token: String,
    pub application_id: String,
    pub site: String,
    pub service: String,
    pub env: String,
    pub version: String,
    pub organization_identifier: String,
    pub api_version: String,
    pub insecure_http: bool,
}

/// Healthz
#[utoipa::path(
    path = "/healthz",
    tag = "Meta",
    operation_id = "HealthCheck",
    summary = "System health check",
    description = "Performs a basic health check to verify that the OpenObserve service is running and responding to \
                   requests. Returns a simple status indicator that can be used by load balancers, monitoring systems, \
                   and orchestration platforms to determine service availability and readiness.",
    responses(
        (status = 200, description="Status OK", content_type = "application/json", body = inline(HealthzResponse), example = json!({"status": "ok"}))
    )
)]
#[get("/healthz")]
pub async fn healthz() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().json(HealthzResponse {
        status: "ok".to_string(),
    }))
}

/// Healthz HEAD
/// Vector pipeline healthcheck support
#[head("/healthz")]
pub async fn healthz_head() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Ok().finish())
}

/// Healthz of the node for scheduled status
#[utoipa::path(
    path = "/schedulez",
    tag = "Meta",
    operation_id = "SchedulerHealthCheck",
    summary = "Scheduler node health check",
    description = "Checks the health and scheduling availability of the current node. Returns success only if the node \
                   is both online and enabled for task scheduling. Used by cluster management systems to determine \
                   which nodes are available for workload distribution and background job processing.",
    responses(
        (status = 200, description="Status OK", content_type = "application/json", body = inline(HealthzResponse), example = json!({"status": "ok"})),
        (status = 404, description="Status Not OK", content_type = "application/json", body = inline(HealthzResponse), example = json!({"status": "not ok"})),
    )
)]
#[get("/schedulez")]
pub async fn schedulez() -> Result<HttpResponse, Error> {
    let node_id = LOCAL_NODE.uuid.clone();
    let Some(node) = cluster::get_node_by_uuid(&node_id).await else {
        return Ok(HttpResponse::NotFound().json(HealthzResponse {
            status: "not ok".to_string(),
        }));
    };
    Ok(if node.scheduled && node.status == NodeStatus::Online {
        HttpResponse::Ok().json(HealthzResponse {
            status: "ok".to_string(),
        })
    } else {
        HttpResponse::NotFound().json(HealthzResponse {
            status: "not ok".to_string(),
        })
    })
}

#[get("")]
pub async fn zo_config() -> Result<HttpResponse, Error> {
    let cfg = get_config();
    #[cfg(feature = "enterprise")]
    let o2cfg = get_o2_config();
    #[cfg(feature = "enterprise")]
    let dex_cfg = get_dex_config();
    #[cfg(feature = "enterprise")]
    let openfga_cfg = get_openfga_config();
    #[cfg(feature = "enterprise")]
    let sso_enabled = dex_cfg.dex_enabled;
    #[cfg(not(feature = "enterprise"))]
    let sso_enabled = false;
    #[cfg(feature = "enterprise")]
    let native_login_enabled = dex_cfg.native_login_enabled;
    #[cfg(not(feature = "enterprise"))]
    let native_login_enabled = true;

    #[cfg(feature = "enterprise")]
    let rbac_enabled = openfga_cfg.enabled;
    #[cfg(not(feature = "enterprise"))]
    let rbac_enabled = false;

    #[cfg(feature = "enterprise")]
    let actions_enabled = o2cfg.actions.enabled;
    #[cfg(not(feature = "enterprise"))]
    let actions_enabled = false;

    #[cfg(feature = "enterprise")]
    let super_cluster_enabled = o2cfg.super_cluster.enabled;
    #[cfg(not(feature = "enterprise"))]
    let super_cluster_enabled = false;

    #[cfg(feature = "enterprise")]
    let custom_logo_text = match get_logo_text().await {
        Some(data) => data,
        None => o2cfg.common.custom_logo_text.clone(),
    };
    #[cfg(not(feature = "enterprise"))]
    let custom_logo_text = "".to_string();
    #[cfg(feature = "enterprise")]
    let custom_slack_url = &o2cfg.common.custom_slack_url;
    #[cfg(not(feature = "enterprise"))]
    let custom_slack_url = "";
    #[cfg(feature = "enterprise")]
    let custom_docs_url = &o2cfg.common.custom_docs_url;
    #[cfg(not(feature = "enterprise"))]
    let custom_docs_url = "";

    #[cfg(feature = "enterprise")]
    let logo = get_logo().await;

    #[cfg(not(feature = "enterprise"))]
    let logo = None;

    #[cfg(feature = "enterprise")]
    let logo_dark = get_logo_dark().await;

    #[cfg(not(feature = "enterprise"))]
    let logo_dark = None;

    #[cfg(feature = "enterprise")]
    let custom_hide_menus = &o2cfg.common.custom_hide_menus;
    #[cfg(not(feature = "enterprise"))]
    let custom_hide_menus = "";

    #[cfg(feature = "enterprise")]
    let custom_hide_self_logo = o2cfg.common.custom_hide_self_logo;
    #[cfg(not(feature = "enterprise"))]
    let custom_hide_self_logo = false;

    #[cfg(feature = "enterprise")]
    let ai_enabled = o2cfg.ai.enabled;
    #[cfg(not(feature = "enterprise"))]
    let ai_enabled = false;

    #[cfg(all(feature = "cloud", not(feature = "enterprise")))]
    let build_type = "cloud";
    #[cfg(feature = "enterprise")]
    let build_type = "enterprise";
    #[cfg(not(any(feature = "cloud", feature = "enterprise")))]
    let build_type = "opensource";

    #[cfg(feature = "enterprise")]
    let expiry_time = o2_enterprise::enterprise::license::get_expiry_time().await;
    #[cfg(feature = "enterprise")]
    let license_server_url = o2cfg.common.license_server_url.to_string();
    #[cfg(feature = "enterprise")]
    let ingestion_quota_used = o2_enterprise::enterprise::license::ingestion_used() * 100.0;

    #[cfg(feature = "enterprise")]
    let usage_enabled = true;
    #[cfg(not(feature = "enterprise"))]
    let usage_enabled = cfg.common.usage_enabled;

    // max usage reporting interval can be 10 mins, because we
    // need relatively recent data for usage calculations
    #[cfg(feature = "enterprise")]
    let usage_publish_interval = (10 * 60).min(cfg.common.usage_publish_interval);
    #[cfg(not(feature = "enterprise"))]
    let usage_publish_interval = cfg.common.usage_publish_interval;

    Ok(HttpResponse::Ok().json(ConfigResponse {
        version: config::VERSION.to_string(),
        instance: get_instance_id(),
        commit_hash: config::COMMIT_HASH.to_string(),
        build_date: config::BUILD_DATE.to_string(),
        build_type: build_type.to_string(),
        telemetry_enabled: cfg.common.telemetry_enabled,
        default_fts_keys: SQL_FULL_TEXT_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_secondary_index_fields: SQL_SECONDARY_INDEX_SEARCH_FIELDS
            .iter()
            .map(|s| s.to_string())
            .collect(),
        default_quick_mode_fields: QUICK_MODEL_FIELDS.to_vec(),
        default_functions: DEFAULT_FUNCTIONS.to_vec(),
        sql_base64_enabled: cfg.common.ui_sql_base64_enabled,
        timestamp_column: TIMESTAMP_COL_NAME.to_string(),
        data_retention_days: cfg.compact.data_retention_days,
        extended_data_retention_days: cfg.compact.extended_data_retention_days,
        restricted_routes_on_empty_data: cfg.common.restricted_routes_on_empty_data,
        sso_enabled,
        native_login_enabled,
        saml_enabled: crate::service::db::saml::is_enabled().await,
        saml_default_auth: cfg.auth.saml_default_auth.clone(),
        rbac_enabled,
        super_cluster_enabled,
        query_on_stream_selection: cfg.common.query_on_stream_selection,
        show_stream_stats_doc_num: cfg.common.show_stream_dates_doc_num,
        custom_logo_text,
        custom_slack_url: custom_slack_url.to_string(),
        custom_docs_url: custom_docs_url.to_string(),
        custom_logo_img: logo,
        custom_logo_dark_img: logo_dark,
        custom_hide_menus: custom_hide_menus.to_string(),
        custom_hide_self_logo,
        rum: Rum {
            enabled: cfg.rum.enabled,
            client_token: cfg.rum.client_token.to_string(),
            application_id: cfg.rum.application_id.to_string(),
            site: cfg.rum.site.to_string(),
            service: cfg.rum.service.to_string(),
            env: cfg.rum.env.to_string(),
            version: cfg.rum.version.to_string(),
            organization_identifier: cfg.rum.organization_identifier.to_string(),
            api_version: cfg.rum.api_version.to_string(),
            insecure_http: cfg.rum.insecure_http,
        },
        meta_org: META_ORG_ID.to_string(),
        quick_mode_enabled: cfg.limit.quick_mode_enabled,
        user_defined_schemas_enabled: cfg.common.allow_user_defined_schemas,
        user_defined_schema_max_fields: cfg.limit.user_defined_schema_max_fields,
        all_fields_name: cfg.common.column_all.to_string(),
        usage_enabled,
        usage_publish_interval,
        ingestion_url: cfg.common.ingestion_url.to_string(),
        #[cfg(feature = "enterprise")]
        streaming_aggregation_enabled: cfg.common.feature_query_streaming_aggs,
        min_auto_refresh_interval: cfg.common.min_auto_refresh_interval,
        query_default_limit: cfg.limit.query_default_limit,
        max_dashboard_series: cfg.limit.max_dashboard_series,
        actions_enabled,
        streaming_enabled: cfg.http_streaming.streaming_enabled,
        histogram_enabled: cfg.limit.histogram_enabled,
        max_query_range: cfg.limit.default_max_query_range_days * 24,
        ai_enabled,
        dashboard_placeholder: cfg.common.dashboard_placeholder.to_string(),
        dashboard_show_symbol_enabled: cfg.common.dashboard_show_symbol_enabled,
        ingest_flatten_level: cfg.limit.ingest_flatten_level,
        #[cfg(feature = "enterprise")]
        license_expiry: expiry_time,
        log_page_default_field_list: cfg.common.log_page_default_field_list.clone(),
        #[cfg(feature = "enterprise")]
        license_server_url,
        #[cfg(feature = "enterprise")]
        ingestion_quota_used,
        query_values_default_num: cfg.limit.query_values_default_num,
    }))
}

#[get("/status")]
pub async fn cache_status() -> Result<HttpResponse, Error> {
    let cfg = get_config();
    let mut stats: HashMap<&str, json::Value> = HashMap::default();
    stats.insert("LOCAL_NODE_UUID", json::json!(LOCAL_NODE.uuid.clone()));
    stats.insert("LOCAL_NODE_NAME", json::json!(&cfg.common.instance_name));
    stats.insert("LOCAL_NODE_ROLE", json::json!(&cfg.common.node_role));

    let (stream_num, stream_schema_num, mem_size) = get_stream_schema_status().await;
    stats.insert("STREAM_SCHEMA", json::json!({"stream_num": stream_num,"stream_schema_num": stream_schema_num, "mem_size": mem_size}));

    let stream_num = cache::stats::get_stream_stats_len();
    let mem_size = cache::stats::get_stream_stats_in_memory_size();
    stats.insert(
        "STREAM_STATS",
        json::json!({"stream_num": stream_num, "mem_size": mem_size}),
    );

    let mem_file_num = cache::file_data::memory::len().await;
    let (mem_max_size, mem_cur_size) = cache::file_data::memory::stats().await;
    let disk_file_num = cache::file_data::disk::len(cache::file_data::disk::FileType::Data).await;
    let (disk_max_size, disk_cur_size) =
        cache::file_data::disk::stats(cache::file_data::disk::FileType::Data).await;
    let disk_result_file_num =
        cache::file_data::disk::len(cache::file_data::disk::FileType::Result).await;
    let (disk_result_max_size, disk_result_cur_size) =
        cache::file_data::disk::stats(cache::file_data::disk::FileType::Result).await;
    stats.insert(
        "FILE_DATA",
        json::json!({
            "memory":{"cache_files":mem_file_num, "cache_limit":mem_max_size,"cache_bytes": mem_cur_size},
            "disk":{"cache_files":disk_file_num, "cache_limit":disk_max_size,"cache_bytes": disk_cur_size},
            "results":{"cache_files":disk_result_file_num, "cache_limit":disk_result_max_size,"cache_bytes": disk_result_cur_size}
        }),
    );

    let file_list_num = file_list::len().await;
    let file_list_last_update_at = file_list::get_max_update_at().await.unwrap_or_default();
    let (last_check_updated_at, _) = db::compact::stats::get_offset().await;

    stats.insert(
        "FILE_LIST",
        json::json!({
            "num":file_list_num,
            "last_update_at": file_list_last_update_at,
            "last_check_updated_at": last_check_updated_at,
        }),
    );

    stats.insert(
        "DATAFUSION",
        json::json!({"file_stat_cache": {
            "file_num": file_statistics_cache::GLOBAL_CACHE.len(),
            "mem_size": file_statistics_cache::GLOBAL_CACHE.memory_size()
        }}),
    );
    stats.insert(
        "INVERTED_INDEX",
        json::json!({"result_cache": {
            "file_num": tantivy_result_cache::GLOBAL_CACHE.len(),
            "mem_size": tantivy_result_cache::GLOBAL_CACHE.memory_size()
        }}),
    );

    #[cfg(feature = "enterprise")]
    let (total_count, expired_count) = crate::service::search::cardinality::get_cache_stats().await;
    #[cfg(not(feature = "enterprise"))]
    let (total_count, expired_count) = (0, 0);
    stats.insert(
        "CARDINALITY",
        json::json!({"total_count": total_count, "expired_count": expired_count}),
    );

    Ok(HttpResponse::Ok().json(stats))
}

#[get("")]
pub async fn config_reload() -> Result<HttpResponse, Error> {
    if let Err(e) = config::refresh_config() {
        return Ok(
            HttpResponse::InternalServerError().json(serde_json::json!({"status": e.to_string()}))
        );
    }
    #[cfg(feature = "enterprise")]
    if let Err(e) = reload_enterprise_config() {
        return Ok(
            HttpResponse::InternalServerError().json(serde_json::json!({"status": e.to_string()}))
        );
    }
    let status = "successfully reloaded config";
    // Audit this event
    #[cfg(feature = "enterprise")]
    audit(AuditMessage {
        // Since this is not a protected route, there is no way to get the user email
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "GET".to_string(),
            http_path: "/config/reload".to_string(),
            http_query_params: "".to_string(),
            http_body: "".to_string(),
            http_response_code: 200,
            error_msg: None,
            trace_id: None,
        },
    })
    .await;
    Ok(HttpResponse::Ok().json(serde_json::json!({"status": status})))
}

fn hide_sensitive_fields(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = value.as_object_mut() {
        for (key, val) in obj.iter_mut() {
            let key_lower = key.to_lowercase();

            // Simple rule: contains any of these sensitive keywords
            let is_sensitive = key_lower.contains("password")
                || key_lower.contains("secret")
                || key_lower.contains("key")
                || key_lower.contains("auth")
                || key_lower.contains("token")
                || key_lower.contains("credential");

            if is_sensitive {
                if let Some(s) = val.as_str() {
                    *val = if s.is_empty() {
                        serde_json::Value::String("[not set]".to_string())
                    } else {
                        serde_json::Value::String("[hidden]".to_string())
                    };
                }
            } else if val.is_object() {
                *val = hide_sensitive_fields(val.clone());
            }
        }
    }
    value
}

#[get("/runtime")]
pub async fn config_runtime() -> Result<HttpResponse, Error> {
    let cfg = get_config();
    let mut config_value = serde_json::to_value(cfg.as_ref())
        .map_err(|e| Error::other(format!("Failed to serialize config: {e}")))?;

    config_value = hide_sensitive_fields(config_value);

    let mut final_response = serde_json::Map::new();
    final_response.insert(
        "_metadata".to_string(),
        json::json!({
            "version": config::VERSION,
            "commit_hash": config::COMMIT_HASH,
            "build_date": config::BUILD_DATE,
            "instance_id": get_instance_id(),
        }),
    );

    if let Some(config_obj) = config_value.as_object() {
        for (key, value) in config_obj {
            final_response.insert(key.clone(), value.clone());
        }
    }

    Ok(HttpResponse::Ok().json(final_response))
}

async fn get_stream_schema_status() -> (usize, usize, usize) {
    let mut stream_num = 0;
    let mut stream_schema_num = 0;
    let mut mem_size = std::mem::size_of::<HashMap<String, Vec<Schema>>>();
    let r = STREAM_SCHEMAS.read().await;
    for (key, val) in r.iter() {
        stream_num += 1;
        mem_size += std::mem::size_of::<Vec<Schema>>();
        mem_size += std::mem::size_of::<String>() + key.len();
        for schema in val.iter() {
            stream_schema_num += 1;
            mem_size += std::mem::size_of::<i64>();
            mem_size += schema.1.size();
        }
    }
    drop(r);
    let r = STREAM_SCHEMAS_LATEST.read().await;
    for (key, schema) in r.iter() {
        mem_size += std::mem::size_of::<String>() + key.len();
        mem_size += schema.size();
    }
    drop(r);
    (stream_num, stream_schema_num, mem_size)
}

#[cfg(feature = "enterprise")]
#[get("/redirect")]
pub async fn redirect(req: actix_web::HttpRequest) -> Result<HttpResponse, Error> {
    use config::meta::user::UserRole;

    use crate::common::meta::user::AuthTokens;

    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let code = match query.get("code") {
        Some(code) => code,
        None => {
            return Err(Error::other("no code in request"));
        }
    };
    let mut audit_message = AuditMessage {
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "GET".to_string(),
            http_path: "/config/redirect".to_string(),
            http_body: "".to_string(),
            http_query_params: req.query_string().to_string(),
            http_response_code: 302,
            error_msg: None,
            trace_id: None,
        },
    };

    match query.get("state") {
        Some(code) => match crate::service::kv::get(PKCE_STATE_ORG, code).await {
            Ok(_) => {
                let _ = crate::service::kv::delete(PKCE_STATE_ORG, code).await;
            }
            Err(_) => {
                // Bad Request
                audit_message.response_meta.http_response_code = 400;
                audit(audit_message).await;
                return Err(Error::other("invalid state in request"));
            }
        },

        None => {
            // Bad Request
            audit_message.response_meta.http_response_code = 400;
            audit(audit_message).await;
            return Err(Error::other("no state in request"));
        }
    };

    log::info!("entering exchange_code: {code}");

    match exchange_code(code).await {
        Ok(login_data) => {
            let login_url;
            let access_token = login_data.access_token;
            let keys = get_dex_jwks().await;
            let token_ver = verify_decode_token(
                &access_token,
                &keys,
                &get_dex_config().client_id,
                true,
                true,
            );
            let id_token;
            match token_ver {
                Ok(res) => {
                    // check for service accounts , do not to allow login
                    if let Some(db_user) = db::user::get_user_by_email(&res.0.user_email).await
                        && db_user
                            .organizations
                            .iter()
                            .any(|org| org.role.eq(&UserRole::ServiceAccount))
                    {
                        return Ok(HttpResponse::Unauthorized()
                            .json("Service accounts are not allowed to login".to_string()));
                    }

                    // Check if email is allowed by domain management system
                    #[cfg(feature = "enterprise")]
                    match o2_enterprise::enterprise::domain_management::is_email_allowed(
                        &res.0.user_email,
                    )
                    .await
                    {
                        Ok(allowed) => {
                            if !allowed {
                                audit_message.response_meta.http_response_code = 403;
                                audit_message._timestamp = now_micros();
                                audit(audit_message).await;
                                return Ok(
                                    HttpResponse::Unauthorized().json("Unauthorized".to_string())
                                );
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to check domain management: {e}");
                            // Fail open - allow access if domain management check fails
                            // This prevents system lockouts due to configuration errors
                        }
                    }

                    audit_message.user_email = res.0.user_email.clone();
                    id_token = json::to_string(&json::json!({
                        "email": res.0.user_email,
                        "name": res.0.user_name,
                        "family_name": res.0.family_name,
                        "given_name": res.0.given_name,
                        "is_valid": res.0.is_valid,
                    }))
                    .unwrap();
                    let url_params = match process_token(res).await {
                        Ok(v) => v.map(|(new_user, pending_invites)| {
                            format!("&new_user_login={new_user}&pending_invites={pending_invites}")
                        }),
                        Err(_) => {
                            return Ok(HttpResponse::Unauthorized()
                                .json("Email Domain not allowed".to_string()));
                        }
                    };
                    login_url = format!(
                        "{}#id_token={}.{}{}",
                        login_data.url,
                        ID_TOKEN_HEADER,
                        base64::encode(&id_token),
                        url_params.unwrap_or_default()
                    );
                }
                Err(e) => {
                    audit_message.response_meta.http_response_code = 400;
                    audit_message._timestamp = now_micros();
                    audit(audit_message).await;
                    return Ok(HttpResponse::Unauthorized().json(e.to_string()));
                }
            }

            // generate new UUID for access token & store token in DB
            let session_id = ider::uuid();

            if access_token.is_empty() {
                audit_message.response_meta.http_response_code = 400;
                audit_message._timestamp = now_micros();
                audit(audit_message).await;
                return Ok(HttpResponse::Unauthorized().json("access token is empty".to_string()));
            }

            // store session_id in cluster co-ordinator
            let _ = crate::service::session::set_session(&session_id, &access_token).await;

            let access_token = format!("session {session_id}");

            let tokens = json::to_string(&AuthTokens {
                access_token,
                refresh_token: login_data.refresh_token,
            })
            .unwrap();
            let cfg = get_config();
            let tokens = base64::encode(&tokens);
            let mut auth_cookie = Cookie::new("auth_tokens", tokens);
            auth_cookie.set_expires(
                cookie::time::OffsetDateTime::now_utc()
                    + cookie::time::Duration::seconds(cfg.auth.cookie_max_age),
            );
            auth_cookie.set_http_only(true);
            auth_cookie.set_secure(cfg.auth.cookie_secure_only);
            auth_cookie.set_path("/");
            if cfg.auth.cookie_same_site_lax {
                auth_cookie.set_same_site(SameSite::Lax);
            } else {
                auth_cookie.set_same_site(SameSite::None);
            }
            log::info!("Redirecting user after processing token");

            audit_message._timestamp = now_micros();
            audit(audit_message).await;
            Ok(HttpResponse::Found()
                .append_header((header::LOCATION, login_url))
                .cookie(auth_cookie)
                .finish())
        }
        Err(e) => {
            audit_message.response_meta.http_response_code = 400;
            audit_message._timestamp = now_micros();
            audit(audit_message).await;
            Ok(HttpResponse::Unauthorized().json(e.to_string()))
        }
    }
}

#[cfg(feature = "enterprise")]
#[get("/dex_login")]
pub async fn dex_login() -> Result<HttpResponse, Error> {
    use o2_dex::meta::auth::PreLoginData;

    let login_data: PreLoginData = get_dex_login();
    let state = login_data.state;
    let _ = crate::service::kv::set(PKCE_STATE_ORG, &state, state.to_owned().into()).await;

    Ok(HttpResponse::Ok().json(login_data.url))
}

#[cfg(feature = "enterprise")]
#[get("/dex_refresh")]
async fn refresh_token_with_dex(req: actix_web::HttpRequest) -> HttpResponse {
    let mut audit_message = AuditMessage {
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "GET".to_string(),
            http_path: "/config/dex_refresh".to_string(),
            http_body: "".to_string(),
            http_query_params: req.query_string().to_string(),
            http_response_code: 302,
            error_msg: None,
            trace_id: None,
        },
    };
    let token = if let Some(cookie) = req.cookie("auth_tokens") {
        let decoded_cookie = config::utils::base64::decode(cookie.value()).unwrap_or_default();
        let auth_tokens: AuthTokens = json::from_str(&decoded_cookie).unwrap_or_default();

        // remove old session id from cluster co-ordinator

        let access_token = auth_tokens.access_token;
        if access_token.starts_with("session") {
            crate::service::session::remove_session(access_token.strip_prefix("session ").unwrap())
                .await;
        }

        auth_tokens.refresh_token
    } else {
        return HttpResponse::Unauthorized().finish();
    };

    // Exchange the refresh token for a new access token
    match refresh_token(&token).await {
        Ok((access_token, refresh_token)) => {
            // generate new UUID for access token & store token in DB
            let session_id = ider::uuid();

            if access_token.is_empty() {
                audit_message.response_meta.http_response_code = 400;
                audit_message._timestamp = now_micros();
                audit(audit_message).await;
                return HttpResponse::Unauthorized().json("access token is empty".to_string());
            }

            // store session_id in cluster co-ordinator
            let _ = crate::service::session::set_session(&session_id, &access_token).await;

            let access_token = format!("session {session_id}");

            let tokens = json::to_string(&AuthTokens {
                access_token,
                refresh_token,
            })
            .unwrap();
            let conf = get_config();
            let tokens = base64::encode(&tokens);
            let mut auth_cookie = Cookie::new("auth_tokens", tokens);
            auth_cookie.set_expires(
                cookie::time::OffsetDateTime::now_utc()
                    + cookie::time::Duration::seconds(conf.auth.cookie_max_age),
            );
            auth_cookie.set_http_only(true);
            auth_cookie.set_secure(conf.auth.cookie_secure_only);
            auth_cookie.set_path("/");
            if conf.auth.cookie_same_site_lax {
                auth_cookie.set_same_site(SameSite::Lax);
            } else {
                auth_cookie.set_same_site(SameSite::None);
            }

            HttpResponse::Ok().cookie(auth_cookie).finish()
        }
        Err(_) => {
            let conf = get_config();
            let tokens = json::to_string(&AuthTokens::default()).unwrap();
            let tokens = base64::encode(&tokens);
            let mut auth_cookie = Cookie::new("auth_tokens", tokens);
            auth_cookie.set_expires(
                cookie::time::OffsetDateTime::now_utc()
                    + cookie::time::Duration::seconds(conf.auth.cookie_max_age),
            );
            auth_cookie.set_http_only(true);
            auth_cookie.set_secure(conf.auth.cookie_secure_only);
            auth_cookie.set_path("/");
            if conf.auth.cookie_same_site_lax {
                auth_cookie.set_same_site(SameSite::Lax);
            } else {
                auth_cookie.set_same_site(SameSite::None);
            }

            HttpResponse::Unauthorized()
                .append_header((header::LOCATION, "/"))
                .cookie(auth_cookie)
                .finish()
        }
    }
}

fn prepare_empty_cookie<'a, T: Serialize + ?Sized>(
    cookie_name: &'a str,
    token_struct: &T,
    conf: &Arc<Config>,
) -> Cookie<'a> {
    let tokens = json::to_string(token_struct).unwrap();
    let tokens = base64::encode(&tokens);
    let mut auth_cookie = Cookie::new(cookie_name, tokens);
    auth_cookie.set_expires(
        cookie::time::OffsetDateTime::now_utc()
            + cookie::time::Duration::seconds(conf.auth.cookie_max_age),
    );
    auth_cookie.set_http_only(true);
    auth_cookie.set_secure(conf.auth.cookie_secure_only);
    auth_cookie.set_path("/");
    if conf.auth.cookie_same_site_lax {
        auth_cookie.set_same_site(SameSite::Lax);
    } else {
        auth_cookie.set_same_site(SameSite::None);
    }
    auth_cookie
}

#[get("/logout")]
async fn logout(req: actix_web::HttpRequest) -> HttpResponse {
    // remove the session
    let conf = get_config();

    #[cfg(feature = "enterprise")]
    let auth_str = extract_auth_str(&req).await;
    // Only get the user email from the auth_str, no need to check for permissions and others
    #[cfg(feature = "enterprise")]
    let user_email = get_user_email_from_auth_str(&auth_str).await;

    if let Some(cookie) = req.cookie("auth_tokens") {
        let val = config::utils::base64::decode_raw(cookie.value()).unwrap_or_default();
        let auth_tokens: AuthTokens =
            json::from_str(std::str::from_utf8(&val).unwrap_or_default()).unwrap_or_default();
        let access_token = auth_tokens.access_token;

        if access_token.starts_with("session") {
            crate::service::session::remove_session(access_token.strip_prefix("session ").unwrap())
                .await;
        }
    };
    let auth_cookie = prepare_empty_cookie("auth_tokens", &AuthTokens::default(), &conf);
    let auth_ext_cookie = prepare_empty_cookie("auth_ext", &AuthTokensExt::default(), &conf);

    #[cfg(feature = "enterprise")]
    if let Some(user_email) = user_email {
        audit(AuditMessage {
            user_email,
            org_id: "".to_string(),
            _timestamp: now_micros(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method: "GET".to_string(),
                http_path: "/config/logout".to_string(),
                http_query_params: req.query_string().to_string(),
                http_body: "".to_string(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
        })
        .await;
    }

    HttpResponse::Ok()
        .append_header((header::LOCATION, "/"))
        .cookie(auth_cookie)
        .cookie(auth_ext_cookie)
        .finish()
}

#[put("/enable")]
async fn enable_node(
    web::Query(query): web::Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    let node_id = LOCAL_NODE.uuid.clone();
    let Some(mut node) = cluster::get_node_by_uuid(&node_id).await else {
        return Ok(MetaHttpResponse::not_found("node not found"));
    };

    let enable = match query.get("value").and_then(|v| v.parse::<bool>().ok()) {
        Some(v) => v,
        None => {
            return Ok(MetaHttpResponse::bad_request(
                "invalid or missing 'value' query parameter (expected true or false)",
            ));
        }
    };
    node.scheduled = enable;
    if !node.scheduled {
        // release all the searching files
        crate::common::infra::wal::clean_lock_files().await;

        #[cfg(feature = "enterprise")]
        {
            log::info!("[NODE] Disabling node, initiating graceful drain");

            // If this is an ingester node, set draining mode and flush
            if LOCAL_NODE.is_ingester() {
                // Flush memory to WAL
                if let Err(e) = ingester::flush_all().await {
                    log::error!("[NODE] Error flushing ingester during disable: {e}");
                    return Ok(MetaHttpResponse::internal_error(e));
                }
                // Set draining flag to trigger immediate S3 upload after flush memory to disk
                o2_enterprise::enterprise::drain::set_draining(true);
                log::info!("[NODE] Ingester flushed successfully, S3 upload will be prioritized");
            }
        }
    } else {
        #[cfg(feature = "enterprise")]
        {
            // Re-enabling the node
            if LOCAL_NODE.is_ingester() {
                o2_enterprise::enterprise::drain::set_draining(false);
            }
        }
    }
    match cluster::update_local_node(&node).await {
        Ok(_) => Ok(MetaHttpResponse::json(true)),
        Err(e) => Ok(MetaHttpResponse::internal_error(e)),
    }
}

#[put("/flush")]
async fn flush_node() -> Result<HttpResponse, Error> {
    if !LOCAL_NODE.is_ingester() {
        return Ok(MetaHttpResponse::not_found("local node is not an ingester"));
    };

    // release all the searching files
    crate::common::infra::wal::clean_lock_files().await;

    match ingester::flush_all().await {
        Ok(_) => Ok(MetaHttpResponse::json(true)),
        Err(e) => Ok(MetaHttpResponse::internal_error(e)),
    }
}

#[cfg(feature = "enterprise")]
#[get("/drain_status")]
async fn drain_status() -> Result<HttpResponse, Error> {
    let is_ingester = LOCAL_NODE.is_ingester();
    let response = o2_enterprise::enterprise::drain::get_drain_status(is_ingester);
    Ok(MetaHttpResponse::json(response))
}

#[get("/list")]
async fn list_node() -> Result<HttpResponse, Error> {
    let nodes = cluster::get_cached_nodes(|_| true).await;
    Ok(MetaHttpResponse::json(nodes))
}

#[get("/metrics")]
async fn node_metrics() -> Result<HttpResponse, Error> {
    let metrics = config::utils::sysinfo::get_node_metrics();
    Ok(MetaHttpResponse::json(metrics))
}

#[post("/consistent_hash")]
async fn consistent_hash(body: web::Json<HashFileRequest>) -> Result<HttpResponse, Error> {
    let mut ret = HashFileResponse::default();
    for file in body.files.iter() {
        let mut nodes = HashMap::new();
        nodes.insert(
            "querier_interactive".to_string(),
            cluster::get_node_from_consistent_hash(
                file,
                &Role::Querier,
                Some(RoleGroup::Interactive),
            )
            .await
            .unwrap_or_default(),
        );
        nodes.insert(
            "querier_background".to_string(),
            cluster::get_node_from_consistent_hash(
                file,
                &Role::Querier,
                Some(RoleGroup::Background),
            )
            .await
            .unwrap_or_default(),
        );
        ret.files.insert(file.clone(), nodes);
    }
    Ok(MetaHttpResponse::json(ret))
}

#[get("/refresh_nodes_list")]
async fn refresh_nodes_list() -> Result<HttpResponse, Error> {
    match cluster::cache_node_list().await {
        Ok(node_ids) => Ok(MetaHttpResponse::json(node_ids)),
        Err(e) => {
            log::error!("[CLUSTER] refresh_node_list failed: {}", e);
            Ok(MetaHttpResponse::internal_error(e.to_string()))
        }
    }
}

#[get("/refresh_user_sessions")]
async fn refresh_user_sessions() -> Result<HttpResponse, Error> {
    let _ = db::session::cache().await.map_err(|e| {
        log::error!("[CLUSTER] refresh_user_sessions failed: {}", e);
        e
    });
    Ok(MetaHttpResponse::json("user sessions refreshed"))
}

#[cfg(test)]
mod tests {
    use serde_json;

    use super::*;

    #[test]
    fn test_healthz_response_different_status() {
        let response = HealthzResponse {
            status: "not ok".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"not ok\""));
    }

    #[test]
    fn test_healthz_response_empty_status() {
        let response = HealthzResponse {
            status: "".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"\""));
    }

    #[test]
    fn test_rum_serialization() {
        let rum = Rum {
            enabled: true,
            client_token: "test_token".to_string(),
            application_id: "test_app".to_string(),
            site: "test_site".to_string(),
            service: "test_service".to_string(),
            env: "test_env".to_string(),
            version: "1.0.0".to_string(),
            organization_identifier: "test_org".to_string(),
            api_version: "v1".to_string(),
            insecure_http: false,
        };

        let json = serde_json::to_string(&rum).unwrap();
        assert!(json.contains("\"enabled\":true"));
        assert!(json.contains("\"client_token\":\"test_token\""));
        assert!(json.contains("\"application_id\":\"test_app\""));
        assert!(json.contains("\"insecure_http\":false"));
    }

    #[test]
    fn test_rum_serialization_disabled() {
        let rum = Rum {
            enabled: false,
            client_token: "".to_string(),
            application_id: "".to_string(),
            site: "".to_string(),
            service: "".to_string(),
            env: "".to_string(),
            version: "".to_string(),
            organization_identifier: "".to_string(),
            api_version: "".to_string(),
            insecure_http: true,
        };

        let json = serde_json::to_string(&rum).unwrap();
        assert!(json.contains("\"enabled\":false"));
        assert!(json.contains("\"insecure_http\":true"));
    }

    #[test]
    fn test_rum_with_special_characters() {
        let rum = Rum {
            enabled: true,
            client_token: "token_with_special_chars!@#$%".to_string(),
            application_id: "app-id.with.dots".to_string(),
            site: "site with spaces".to_string(),
            service: "service/with/slashes".to_string(),
            env: "env_with_underscores".to_string(),
            version: "1.0.0-beta+build.1".to_string(),
            organization_identifier: "org-123-test".to_string(),
            api_version: "v2.1".to_string(),
            insecure_http: false,
        };

        let json = serde_json::to_string(&rum).unwrap();
        assert!(json.contains("token_with_special_chars!@#$%"));
        assert!(json.contains("app-id.with.dots"));
        assert!(json.contains("site with spaces"));
        assert!(json.contains("service/with/slashes"));
        assert!(json.contains("1.0.0-beta+build.1"));
    }

    #[test]
    fn test_healthz_response_structure() {
        // Test that we can create and serialize a HealthzResponse
        let response = HealthzResponse {
            status: "ok".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"status\":\"ok\""));
    }

    #[test]
    fn test_prepare_empty_cookie_basic() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct TestToken {
            value: String,
        }

        let test_token = TestToken {
            value: "test_value".to_string(),
        };

        let config = Arc::new(Config::default());
        let cookie = prepare_empty_cookie("test_cookie", &test_token, &config);

        assert_eq!(cookie.name(), "test_cookie");
        assert!(!cookie.value().is_empty());
        assert_eq!(cookie.path(), Some("/"));
        assert_eq!(cookie.http_only(), Some(true));
    }

    #[test]
    fn test_prepare_empty_cookie_security_settings() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct EmptyToken {}

        let empty_token = EmptyToken {};
        let config = Arc::new(Config::default());
        let cookie = prepare_empty_cookie("auth_cookie", &empty_token, &config);

        assert_eq!(cookie.http_only(), Some(true));
        assert_eq!(cookie.path(), Some("/"));
        assert!(cookie.expires().is_some());
    }

    #[test]
    fn test_prepare_empty_cookie_different_names() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct TestData {
            id: i32,
        }

        let test_data = TestData { id: 42 };
        let config = Arc::new(Config::default());

        let cookie1 = prepare_empty_cookie("cookie1", &test_data, &config);
        let cookie2 = prepare_empty_cookie("cookie2", &test_data, &config);

        assert_eq!(cookie1.name(), "cookie1");
        assert_eq!(cookie2.name(), "cookie2");
        assert_eq!(cookie1.value(), cookie2.value()); // Same data, same encoded value
    }

    #[tokio::test]
    async fn test_get_stream_schema_status_empty() {
        let (_stream_num, _stream_schema_num, mem_size) = get_stream_schema_status().await;

        // Should return some values, even if caches are empty
        assert!(mem_size > 0); // At least the size of empty HashMap
    }

    #[test]
    fn test_rum_deserialization() {
        let json = r#"{
            "enabled": true,
            "client_token": "token123",
            "application_id": "app123",
            "site": "site123",
            "service": "service123",
            "env": "prod",
            "version": "2.0.0",
            "organization_identifier": "org123",
            "api_version": "v2",
            "insecure_http": true
        }"#;

        let rum: Rum = serde_json::from_str(json).unwrap();
        assert!(rum.enabled);
        assert_eq!(rum.client_token, "token123");
        assert_eq!(rum.application_id, "app123");
        assert!(rum.insecure_http);
    }

    #[test]
    fn test_rum_round_trip_serialization() {
        let original = Rum {
            enabled: false,
            client_token: "round_trip_token".to_string(),
            application_id: "round_trip_app".to_string(),
            site: "round_trip_site".to_string(),
            service: "round_trip_service".to_string(),
            env: "staging".to_string(),
            version: "0.1.0".to_string(),
            organization_identifier: "round_trip_org".to_string(),
            api_version: "v1.5".to_string(),
            insecure_http: false,
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: Rum = serde_json::from_str(&json).unwrap();

        assert_eq!(original.enabled, deserialized.enabled);
        assert_eq!(original.client_token, deserialized.client_token);
        assert_eq!(original.application_id, deserialized.application_id);
        assert_eq!(original.site, deserialized.site);
        assert_eq!(original.service, deserialized.service);
        assert_eq!(original.env, deserialized.env);
        assert_eq!(original.version, deserialized.version);
        assert_eq!(
            original.organization_identifier,
            deserialized.organization_identifier
        );
        assert_eq!(original.api_version, deserialized.api_version);
        assert_eq!(original.insecure_http, deserialized.insecure_http);
    }

    #[test]
    fn test_healthz_response_round_trip_serialization() {
        let original = HealthzResponse {
            status: "healthy".to_string(),
        };

        let json = serde_json::to_string(&original).unwrap();
        let deserialized: HealthzResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(original.status, deserialized.status);
    }

    #[test]
    fn test_prepare_empty_cookie_with_complex_data() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct ComplexData {
            nested: NestedData,
            array: Vec<String>,
            flag: bool,
        }

        #[derive(Serialize)]
        struct NestedData {
            id: u64,
            name: String,
        }

        let complex_data = ComplexData {
            nested: NestedData {
                id: 12345,
                name: "test_nested".to_string(),
            },
            array: vec!["item1".to_string(), "item2".to_string()],
            flag: true,
        };

        let config = Arc::new(Config::default());
        let cookie = prepare_empty_cookie("complex_cookie", &complex_data, &config);

        assert_eq!(cookie.name(), "complex_cookie");
        assert!(!cookie.value().is_empty());

        // Verify the cookie value is base64 encoded JSON
        let decoded_str = base64::decode(cookie.value()).unwrap();
        let json_str = decoded_str;
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed["nested"]["id"], 12345);
        assert_eq!(parsed["nested"]["name"], "test_nested");
        assert_eq!(parsed["flag"], true);
        assert_eq!(parsed["array"][0], "item1");
    }

    #[test]
    fn test_rum_with_unicode_characters() {
        let rum = Rum {
            enabled: true,
            client_token: "тестовый_токен".to_string(),
            application_id: "应用程序_id".to_string(),
            site: "サイト名".to_string(),
            service: "خدمة_اختبار".to_string(),
            env: "環境_test".to_string(),
            version: "1.0.0-α".to_string(),
            organization_identifier: "org_测试".to_string(),
            api_version: "v1.0-β".to_string(),
            insecure_http: false,
        };

        let json = serde_json::to_string(&rum).unwrap();
        let deserialized: Rum = serde_json::from_str(&json).unwrap();

        assert_eq!(rum.client_token, deserialized.client_token);
        assert_eq!(rum.application_id, deserialized.application_id);
        assert_eq!(rum.site, deserialized.site);
        assert_eq!(rum.version, deserialized.version);
    }

    #[test]
    fn test_healthz_response_with_long_status() {
        let long_status = "a".repeat(1000);
        let response = HealthzResponse {
            status: long_status.clone(),
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: HealthzResponse = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.status, long_status);
    }

    #[test]
    fn test_rum_default_values() {
        let rum = Rum {
            enabled: false,
            client_token: String::new(),
            application_id: String::new(),
            site: String::new(),
            service: String::new(),
            env: String::new(),
            version: String::new(),
            organization_identifier: String::new(),
            api_version: String::new(),
            insecure_http: false,
        };

        let json = serde_json::to_string(&rum).unwrap();
        assert!(json.contains("\"enabled\":false"));
        assert!(json.contains("\"client_token\":\"\""));
        assert!(json.contains("\"insecure_http\":false"));
    }

    #[test]
    fn test_prepare_empty_cookie_with_empty_data() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct EmptyStruct;

        let empty_data = EmptyStruct;
        let config = Arc::new(Config::default());
        let cookie = prepare_empty_cookie("empty_cookie", &empty_data, &config);

        assert_eq!(cookie.name(), "empty_cookie");
        assert!(!cookie.value().is_empty()); // Even empty struct gets base64 encoded

        // Verify it's valid base64 encoded JSON
        let decoded_str = base64::decode(cookie.value()).unwrap();
        let json_str = decoded_str;
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        // Empty structs serialize as null in serde, not as objects
        assert!(parsed.is_null() || parsed.is_object());
    }

    #[test]
    fn test_prepare_empty_cookie_serialization_error_handling() {
        use std::sync::Arc;

        use serde::Serialize;

        #[derive(Serialize)]
        struct ValidData {
            value: String,
        }

        let valid_data = ValidData {
            value: "test".to_string(),
        };
        let config = Arc::new(Config::default());
        let cookie = prepare_empty_cookie("valid_cookie", &valid_data, &config);

        // Should not panic and should produce valid cookie
        assert_eq!(cookie.name(), "valid_cookie");
        assert!(!cookie.value().is_empty());
    }

    #[tokio::test]
    async fn test_get_stream_schema_status_returns_valid_data() {
        let (_stream_num, _stream_schema_num, mem_size) = get_stream_schema_status().await;

        // All values should be non-negative integers
        assert!(mem_size > 0); // Memory size should always be positive
    }

    #[test]
    fn test_rum_field_types() {
        let rum = Rum {
            enabled: true,
            client_token: "token".to_string(),
            application_id: "app".to_string(),
            site: "site".to_string(),
            service: "service".to_string(),
            env: "env".to_string(),
            version: "1.0".to_string(),
            organization_identifier: "org".to_string(),
            api_version: "v1".to_string(),
            insecure_http: false,
        };

        // Test that all boolean fields work correctly
        assert!(rum.enabled);
        assert!(!rum.insecure_http);

        // Test that all string fields are properly set
        assert!(!rum.client_token.is_empty());
        assert!(!rum.application_id.is_empty());
        assert!(!rum.site.is_empty());
        assert!(!rum.service.is_empty());
        assert!(!rum.env.is_empty());
        assert!(!rum.version.is_empty());
        assert!(!rum.organization_identifier.is_empty());
        assert!(!rum.api_version.is_empty());
    }
}
