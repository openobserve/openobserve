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

#[cfg(feature = "enterprise")]
use actix_http::StatusCode;
use actix_web::{HttpRequest, HttpResponse, get, web};
use config::{
    get_config,
    meta::{
        search::{Query, SearchEventType},
        stream::StreamType,
    },
};
use serde::{Deserialize, Serialize};
use serde_json;
use tracing::{Instrument, Span};

#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::utils::check_stream_permissions;
#[cfg(feature = "enterprise")]
use crate::service::search::sql::get_cipher_key_names;
use crate::{
    common::{
        meta,
        utils::{
            http::{get_or_create_trace_id, get_use_cache_from_request},
            stream::get_settings_max_query_range,
        },
    },
    handler::http::request::search::error_utils,
    service::{
        search::inspector::{SearchInspectorFields, extract_search_inspector_fields},
        self_reporting::http_report_metrics,
    },
};

/// GetSearchProfile
///
/// #{"ratelimit_module":"Search", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Search",
    operation_id = "GetSearchProfile",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("trace_id" = Option<String>, Query, description = "trace_id, eg: trace_id=684a4e5dac43429a86a0a2ef9adf62c2"),
        ("start_time" = i64, Query, description = "start time"),
        ("end_time" = i64, Query, description = "end time"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SearchResponse, example = json!({
          "sql": "SELECT count(*) FROM \"default\" WHERE match_all('m')",
          "start_time": "1744168877746000",
          "end_time": "1744773677746000",
          "total_duration": 2407,
          "events": [
            {
              "timestamp": "1744773679038683087",
              "node_role": [
                "Ingester"
              ],
              "node_name": "usertest-openobserve-ingester-0",
              "search_role": "follower",
              "region": "us-east-1",
              "cluster": "cluster-0",
              "duration": 0,
              "component": "wal:memtable load",
              "desc": "wal mem search load groups 1, files 6, scan_size 16.01 MB, compressed_size 16.85 MB"
            }]})),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/search/profile")]
pub async fn get_search_profile(
    path: web::Path<String>,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let (org_id, stream_name) = (path.into_inner(), "default".to_string());
    let mut range_error = String::new();
    let http_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
        tracing::info_span!(
            "/api/{org_id}/{stream_name}/search/profile",
            org_id = org_id.clone()
        )
    } else {
        Span::none()
    };

    let trace_id = get_or_create_trace_id(in_req.headers(), &http_span);
    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let query =
        match web::Query::<hashbrown::HashMap<String, String>>::from_query(in_req.query_string()) {
            Ok(q) => q,
            Err(_) => {
                return Ok(meta::http::HttpResponse::bad_request(
                    "Invalid query parameters",
                ));
            }
        };
    let stream_type = StreamType::Traces;

    // Validate required parameters
    let (query_trace_id, start_time, end_time) = match (
        query.get("trace_id"),
        query.get("start_time"),
        query.get("end_time"),
    ) {
        (Some(query_trace_id), Some(start_time), Some(end_time)) => {
            if query_trace_id.is_empty() || start_time.is_empty() || end_time.is_empty() {
                return Ok(meta::http::HttpResponse::bad_request(
                    "trace_id/start_time/end_time cannot be empty",
                ));
            }
            let start_time = start_time.parse::<i64>().unwrap_or(0);
            let end_time = end_time.parse::<i64>().unwrap_or(0);
            if start_time == 0 || end_time == 0 {
                return Ok(meta::http::HttpResponse::bad_request(
                    "start_time/end_time must be valid i64",
                ));
            }
            (query_trace_id, start_time, end_time)
        }
        _ => {
            return Ok(meta::http::HttpResponse::bad_request(
                "trace_id/start_time/end_time is required",
            ));
        }
    };

    let use_cache = cfg.common.result_cache_enabled && get_use_cache_from_request(&query);
    // handle encoding for query and aggs
    let mut req: config::meta::search::Request = config::meta::search::Request {
        query: Query {
            sql: format!(
                "SELECT _timestamp, events FROM default WHERE trace_id = '{}' ORDER BY start_time",
                query_trace_id
            ),
            start_time,
            end_time,
            from: 0,
            size: 2500,
            ..Default::default()
        },
        search_type: Some(SearchEventType::UI),
        ..Default::default()
    };

    if let Err(e) = req.decode() {
        return Ok(meta::http::HttpResponse::bad_request(e));
    }
    req.use_cache = Some(use_cache);

    // get stream settings
    if let Some(settings) = infra::schema::get_settings(&org_id, &stream_name, stream_type).await {
        let max_query_range =
            get_settings_max_query_range(settings.max_query_range, &org_id, Some(&user_id)).await;
        if max_query_range > 0
            && (req.query.end_time - req.query.start_time) > max_query_range * 3600 * 1_000_000
        {
            req.query.start_time = req.query.end_time - max_query_range * 3600 * 1_000_000;
            range_error = format!(
                "Query duration is modified due to query range restriction of {} hours",
                max_query_range
            );
        }
    }

    // Check permissions on stream
    #[cfg(feature = "enterprise")]
    if let Some(res) = check_stream_permissions(&stream_name, &org_id, &user_id, &stream_type).await
    {
        return Ok(res);
    }

    #[cfg(feature = "enterprise")]
    {
        let keys_used = match get_cipher_key_names(&req.query.sql) {
            Ok(v) => v,
            Err(e) => {
                return Ok(
                    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                        StatusCode::BAD_REQUEST.into(),
                        e.to_string(),
                    )),
                );
            }
        };
        if !keys_used.is_empty() {
            log::info!("keys used : {:?}", keys_used);
        }
        for key in keys_used {
            // Check permissions on keys
            {
                use o2_openfga::meta::mapping::OFGA_MODELS;

                use crate::common::{
                    infra::config::USERS,
                    utils::auth::{AuthExtractor, is_root_user},
                };

                if !is_root_user(&user_id) {
                    let user: meta::user::User = match USERS.get(&format!("{org_id}/{}", user_id)) {
                        Some(u) => u.clone(),
                        None => return Ok(meta::http::HttpResponse::forbidden("User not found")),
                    };

                    if !crate::handler::http::auth::validator::check_permissions(
                        &user_id,
                        AuthExtractor {
                            auth: "".to_string(),
                            method: "GET".to_string(),
                            o2_type: format!(
                                "{}:{}",
                                OFGA_MODELS
                                    .get("cipher_keys")
                                    .map_or("cipher_keys", |model| model.key),
                                key
                            ),
                            org_id: org_id.clone(),
                            bypass_check: false,
                            parent_id: "".to_string(),
                        },
                        user.role,
                        user.is_external,
                    )
                    .await
                    {
                        return Ok(crate::common::meta::http::HttpResponse::forbidden(
                            "Unauthorized Access to key",
                        ));
                    }
                    // Check permissions on key ends
                }
            }
        }
    }

    // run search with cache
    let res = crate::service::search::cache::search(
        &trace_id,
        &org_id,
        stream_type,
        Some(user_id),
        &req,
        range_error,
    )
    .instrument(http_span)
    .await;
    match res {
        Ok(res) => {
            let mut events = Vec::new();
            let mut si = SearchInspector {
                sql: "".to_string(),
                start_time: "".to_string(),
                end_time: "".to_string(),
                total_duration: 0,
                events: vec![],
            };

            for hit in res.hits {
                if let Some(events_str) = hit.get("events") {
                    if let Ok(parsed_events) = serde_json::from_str::<Vec<SearchInspectorEvent>>(
                        events_str.as_str().unwrap_or("[]"),
                    ) {
                        let mut inspectors = vec![];
                        let _: Vec<_> = parsed_events
                            .into_iter()
                            .map(|event| {
                                if let Some(mut fields) =
                                    extract_search_inspector_fields(event.name.as_str())
                                {
                                    if fields.component == Some("summary".to_string()) {
                                        si.sql = fields.sql.unwrap();
                                        let time_range = fields.time_range.unwrap_or_default();
                                        si.start_time = time_range.0;
                                        si.end_time = time_range.1;
                                        si.total_duration = fields.duration.unwrap_or_default();
                                    } else {
                                        fields.timestamp = Some(event._timestamp.to_string());
                                        inspectors.push(fields);
                                    }
                                }
                            })
                            .collect();

                        events.extend(inspectors);
                    }
                }
            }

            si.events = events;

            Ok(HttpResponse::Ok().json(si))
        }
        Err(err) => {
            let search_type = req
                .search_type
                .map(|t| t.to_string())
                .unwrap_or("".to_string());
            http_report_metrics(
                start,
                &org_id,
                stream_type,
                "500",
                "search/profile",
                &search_type,
                "",
            );
            log::error!("[trace_id {trace_id}] search error: {}", err);
            Ok(error_utils::map_error_to_http_response(&err, trace_id))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchInspectorEvent {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspector: Option<SearchInspectorFields>,
    pub _timestamp: i64,
    pub code_namespace: Option<String>,
    pub target: Option<String>,
    pub code_filepath: Option<String>,
    pub code_lineno: Option<String>,
    pub level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchInspector {
    pub sql: String,
    pub start_time: String,
    pub end_time: String,
    pub total_duration: usize,
    pub events: Vec<SearchInspectorFields>,
}
