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

use std::{
    cmp::Ordering,
    io::{Error, ErrorKind},
};

use actix_web::{
    HttpRequest, HttpResponse, Responder, delete, get, http, http::StatusCode, post, put, web,
};
use chrono::{TimeZone, Utc};
use config::{
    meta::stream::{StreamSettings, StreamType, TimeRange, UpdateStreamSettings},
    utils::schema::format_stream_name,
};
use hashbrown::HashMap;
use infra::table::compactor_manual_jobs::{
    CompactorManualJob, CompactorManualJobResEntry, CompactorManualJobStatusRes,
    Status as CompactorManualJobStatus,
};

use crate::{
    common::{
        meta::{
            self,
            http::HttpResponse as MetaHttpResponse,
            stream::{ListStream, StreamDeleteFields},
        },
        utils::http::{get_stream_type_from_request, get_ts_from_request_with_key},
    },
    handler::http::request::search::error_utils::map_error_to_http_response,
    service::stream,
};

/// GetSchema
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamSchema",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
        ("keyword" = String, Query, description = "Keyword"),
        ("offset" = u32, Query, description = "Offset"),
        ("limit" = u32, Query, description = "Limit"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Stream),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/streams/{stream_name}/schema")]
async fn schema(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let schema = stream::get_stream(&org_id, &stream_name, stream_type).await;
    let Some(mut schema) = schema else {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            "stream not found".to_string(),
        )));
    };
    if let Some(uds_fields) = schema.settings.defined_schema_fields.as_ref() {
        let mut schema_fields = schema
            .schema
            .iter()
            .map(|f| (&f.name, f))
            .collect::<HashMap<_, _>>();
        schema.uds_schema = Some(
            uds_fields
                .iter()
                .filter_map(|f| schema_fields.remove(f).map(|f| f.to_owned()))
                .collect::<Vec<_>>(),
        );
    }

    // filter by keyword
    if let Some(keyword) = query.get("keyword") {
        if !keyword.is_empty() {
            schema.schema.retain(|f| f.name.contains(keyword));
        }
    }

    // set total fields
    schema.total_fields = schema.schema.len();

    // Pagination
    let offset = query
        .get("offset")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = query
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if offset >= schema.schema.len() {
        schema.schema = vec![];
    } else if limit > 0 {
        let end = std::cmp::min(offset + limit, schema.schema.len());
        schema.schema = schema.schema[offset..end].to_vec();
    }

    Ok(HttpResponse::Ok().json(schema))
}

/// CreateStreamSettings
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"create"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamSettings",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = StreamSettings, description = "Stream settings", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/streams/{stream_name}/settings")]
async fn settings(
    path: web::Path<(String, String)>,
    settings: web::Json<StreamSettings>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    if stream_type == StreamType::EnrichmentTables || stream_type == StreamType::Index {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Stream type '{}' not allowed", stream_type),
            )),
        );
    }
    stream::save_stream_settings(&org_id, &stream_name, stream_type, settings.into_inner()).await
}

/// UpdateStreamSettings
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "UpdateStreamSettings",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = UpdateStreamSettings, description = "Stream settings", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/streams/{stream_name}/settings")]
async fn update_settings(
    path: web::Path<(String, String)>,
    stream_settings: web::Json<UpdateStreamSettings>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let cfg = config::get_config();
    let (org_id, mut stream_name) = path.into_inner();
    if !cfg.common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    if stream_type == StreamType::EnrichmentTables || stream_type == StreamType::Index {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Stream type '{}' not allowed", stream_type),
            )),
        );
    }
    let stream_settings: UpdateStreamSettings = stream_settings.into_inner();
    let main_stream_res =
        stream::update_stream_settings(&org_id, &stream_name, stream_type, stream_settings.clone())
            .await?;

    // sync the data retention to index stream
    if stream_type.is_basic_type() && stream_settings.data_retention.is_some() {
        #[allow(deprecated)]
        let index_stream_name =
            if cfg.common.inverted_index_old_format && stream_type == StreamType::Logs {
                stream_name.to_string()
            } else {
                format!("{}_{}", stream_name, stream_type)
            };
        if infra::schema::get(&org_id, &index_stream_name, StreamType::Index)
            .await
            .is_ok()
        {
            let index_stream_settings = UpdateStreamSettings {
                data_retention: stream_settings.data_retention,
                ..Default::default()
            };
            match stream::update_stream_settings(
                &org_id,
                &index_stream_name,
                StreamType::Index,
                index_stream_settings,
            )
            .await
            {
                Ok(_) => {
                    log::debug!(
                        "Data retention settings for {} synced to index stream {}",
                        stream_name,
                        index_stream_name
                    );
                }
                Err(e) => {
                    log::error!(
                        "Failed to sync data retention settings to index stream {}: {}",
                        index_stream_name,
                        e
                    );
                }
            }
        }
    }

    Ok(main_stream_res)
}

/// DeleteStreamFields
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteFields",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = StreamDeleteFields, description = "Stream delete fields", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/streams/{stream_name}/delete_fields")]
async fn delete_fields(
    path: web::Path<(String, String)>,
    fields: web::Json<StreamDeleteFields>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query);
    match stream::delete_fields(
        &org_id,
        &stream_name,
        stream_type,
        &fields.into_inner().fields,
    )
    .await
    {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "fields deleted".to_string(),
        ))),
        Err(e) => Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            e.to_string(),
        ))),
    }
}

/// DeleteStream
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDelete",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/streams/{stream_name}")]
async fn delete(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    stream::delete_stream(&org_id, &stream_name, stream_type).await
}

/// ListStreams
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("type" = String, Query, description = "Stream type"),
        ("keyword" = String, Query, description = "Keyword"),
        ("offset" = u32, Query, description = "Offset"),
        ("limit" = u32, Query, description = "Limit"),
        ("sort" = String, Query, description = "Sort"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = ListStream),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/streams")]
async fn list(org_id: web::Path<String>, req: HttpRequest) -> impl Responder {
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query);

    let fetch_schema = match query.get("fetchSchema") {
        Some(s) => match s.to_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => {
                return Err(Error::new(
                    ErrorKind::Other,
                    " 'fetchSchema' query param with value 'true' or 'false' allowed",
                ));
            }
        },
        None => false,
    };
    let mut _stream_list_from_rbac = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        let user_id = req.headers().get("user_id").unwrap();
        if let Some(s_type) = &stream_type {
            let stream_type_str = s_type.to_string();
            match crate::handler::http::auth::validator::list_objects_for_user(
                &org_id,
                user_id.to_str().unwrap(),
                "GET",
                OFGA_MODELS
                    .get(stream_type_str.as_str())
                    .map_or(stream_type_str.as_str(), |model| model.key),
            )
            .await
            {
                Ok(stream_list) => {
                    _stream_list_from_rbac = stream_list;
                }
                Err(e) => {
                    return Ok(crate::common::meta::http::HttpResponse::forbidden(
                        e.to_string(),
                    ));
                }
            }
        }
        // Get List of allowed objects ends
    }

    let mut indices = stream::get_streams(
        org_id.as_str(),
        stream_type,
        fetch_schema,
        _stream_list_from_rbac,
    )
    .await;

    // filter by keyword
    if let Some(keyword) = query.get("keyword") {
        if !keyword.is_empty() {
            indices.retain(|s| s.name.contains(keyword));
        }
    }

    // sort by
    let mut sort = "name".to_string();
    if let Some(s) = query.get("sort") {
        let s = s.to_lowercase();
        if !s.is_empty() {
            sort = s;
        }
    }
    let asc = if let Some(asc) = query.get("asc") {
        asc.to_lowercase() == "true" || asc.to_lowercase() == "1"
    } else {
        true
    };
    indices.sort_by(|a, b| match (sort.as_str(), asc) {
        ("name", true) => a.name.cmp(&b.name),
        ("name", false) => b.name.cmp(&a.name),
        ("doc_num", true) => a.stats.doc_num.cmp(&b.stats.doc_num),
        ("doc_num", false) => b.stats.doc_num.cmp(&a.stats.doc_num),
        ("storage_size", true) => a
            .stats
            .storage_size
            .partial_cmp(&b.stats.storage_size)
            .unwrap_or(Ordering::Equal),
        ("storage_size", false) => b
            .stats
            .storage_size
            .partial_cmp(&a.stats.storage_size)
            .unwrap_or(Ordering::Equal),
        ("compressed_size", true) => a
            .stats
            .compressed_size
            .partial_cmp(&b.stats.compressed_size)
            .unwrap_or(Ordering::Equal),
        ("compressed_size", false) => b
            .stats
            .compressed_size
            .partial_cmp(&a.stats.compressed_size)
            .unwrap_or(Ordering::Equal),
        ("index_size", true) => a
            .stats
            .index_size
            .partial_cmp(&b.stats.index_size)
            .unwrap_or(Ordering::Equal),
        ("index_size", false) => b
            .stats
            .index_size
            .partial_cmp(&a.stats.index_size)
            .unwrap_or(Ordering::Equal),
        _ => a.name.cmp(&b.name),
    });

    // set total streams
    let total = indices.len();

    // Pagination
    let offset = query
        .get("offset")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let limit = query
        .get("limit")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if offset >= indices.len() {
        indices = vec![];
    } else if limit > 0 {
        let end = std::cmp::min(offset + limit, indices.len());
        indices = indices[offset..end].to_vec();
    }
    Ok(HttpResponse::Ok().json(ListStream {
        list: indices,
        total,
    }))
}

/// StreamDeleteCache
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteCache",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
        ("ts" = i64, Query, description = "Timestamp in microseconds. If provided, must be > 0. Cache from this timestamp onwards will be retained, older cache will be deleted."),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/streams/{stream_name}/cache/results")]
async fn delete_stream_cache(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    if !config::get_config().common.result_cache_enabled {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Result Cache is disabled".to_string(),
        )));
    }
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let delete_ts = get_ts_from_request_with_key(&query, "ts").unwrap_or(0);

    let path = if stream_name.eq("_all") {
        org_id
    } else {
        format!("{}/{}/{}", org_id, stream_type, stream_name)
    };

    match crate::service::search::cluster::cacher::delete_cached_results(path, delete_ts).await {
        true => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "cache deleted".to_string(),
        ))),
        false => Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Error deleting cache, please retry".to_string(),
        ))),
    }
}

/// StreamDeleteDataByTimeRange
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"delete"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteDataByTimeRange",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
        ("start" = i64, Query, description = "Start timestamp in microseconds"),
        ("end" = i64, Query, description = "End timestamp in microseconds"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse, example = json!(
            {
                "time_range": "2025-06-01T00:00:00Z,2025-06-30T00:00:00Z"
            }
        )),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/streams/{stream_name}/data_by_time_range")]
async fn delete_stream_data_by_time_range(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let cfg = config::get_config();
    let (org_id, mut stream_name) = path.into_inner();
    if !cfg.common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let start = match get_ts_from_request_with_key(&query, "start") {
        Ok(ts) => ts,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e,
            )));
        }
    };
    let end = match get_ts_from_request_with_key(&query, "end") {
        Ok(ts) => ts,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e,
            )));
        }
    };
    let time_range = TimeRange::new(start, end);

    if time_range.start > time_range.end {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Start time must be less than end time".to_string(),
        )));
    }

    // Convert the time range to RFC3339 format
    // If this is a log stream, we use the hour part of the timestamp
    // If the timestamp is 10:15:00, we use only the hour part
    // If this is a non-log stream, we use only the day part of the timestamp
    let time_range_start = {
        let ts = Utc.timestamp_nanos(time_range.start * 1000);
        if stream_type.eq(&StreamType::Logs) {
            ts.format("%Y-%m-%dT%H:00:00Z").to_string()
        } else {
            ts.format("%Y-%m-%d").to_string()
        }
    };
    let time_range_end = {
        let ts = Utc.timestamp_nanos(time_range.end * 1000);
        if stream_type.eq(&StreamType::Logs) {
            ts.format("%Y-%m-%dT%H:00:00Z").to_string()
        } else {
            ts.format("%Y-%m-%d").to_string()
        }
    };
    if time_range_start >= time_range_end {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST.into(),
            "Invalid time range".to_string(),
        )));
    }

    log::debug!(
        "[COMPACTOR] delete_by_stream {org_id}/{stream_type}/{stream_name}/{time_range_start},{time_range_end}",
    );

    // Create a job to delete the data by the time range
    let key = match crate::service::db::compact::retention::delete_stream(
        &org_id,
        stream_type,
        &stream_name,
        Some((time_range_start.as_str(), time_range_end.as_str())),
    )
    .await
    {
        Ok(key) => key,
        Err(e) => {
            log::error!(
                "delete_by_stream {org_id}/{stream_type}/{stream_name}/{time_range_start},{time_range_end} error: {e}"
            );
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )));
        }
    };

    // Create a job in the compact manual jobs table
    let job = infra::table::compactor_manual_jobs::CompactorManualJob {
        id: config::ider::uuid(),
        key,
        status: CompactorManualJobStatus::Pending,
        created_at: Utc::now().timestamp_micros(),
        ended_at: 0,
    };
    let job_id = match crate::service::db::compact::compactor_manual_jobs::add_job(job).await {
        Ok(id) => id,
        Err(e) => {
            return Ok(map_error_to_http_response(&e, None));
        }
    };

    let res = serde_json::json!({ "id": job_id });
    Ok(HttpResponse::Ok().json(res))
}

/// StreamDeleteDataByTimeRangeJobStatus
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"get"}#
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteDataByTimeRangeJobStatus",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description = "Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/streams/{stream_name}/data_by_time_range/status/{id}")]
async fn get_delete_stream_data_status(
    path: web::Path<(String, String, String)>,
    _req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (_, _, ksuid) = path.into_inner();

    // Check if super cluster is enabled
    #[cfg(feature = "enterprise")]
    let response = if o2_enterprise::enterprise::common::infra::config::get_config()
        .super_cluster
        .enabled
    {
        // Super cluster is enabled, get status from all regions
        match get_super_cluster_delete_status(&ksuid).await {
            Ok(res) => res,
            Err(e) => {
                log::error!("get_super_cluster_delete_status error: {e}");
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )));
            }
        }
    } else {
        // Super cluster not enabled, get local status
        get_local_delete_status(&ksuid).await
    };

    #[cfg(not(feature = "enterprise"))]
    let response = get_local_delete_status(&ksuid).await;

    Ok(HttpResponse::Ok().json(response))
}

async fn get_local_delete_status(id: &str) -> CompactorManualJobStatusRes {
    let job = match crate::service::db::compact::compactor_manual_jobs::get_job(id).await {
        Ok(job) => job,
        Err(e) => {
            log::error!("get_local_delete_status {id} error: {e}");

            return CompactorManualJobStatusRes {
                id: id.to_string(),
                status: CompactorManualJobStatus::Pending,
                metadata: vec![],
                errors: vec![e.to_string()],
            };
        }
    };

    let entry = CompactorManualJobResEntry {
        job: CompactorManualJob {
            id: job.id,
            key: job.key,
            created_at: job.created_at,
            ended_at: job.ended_at,
            status: job.status,
        },
        cluster: "".to_string(),
        region: "".to_string(),
    };

    CompactorManualJobStatusRes {
        id: id.to_string(),
        status: job.status,
        metadata: vec![entry],
        errors: vec![],
    }
}

#[cfg(feature = "enterprise")]
async fn get_super_cluster_delete_status(
    id: &str,
) -> Result<CompactorManualJobStatusRes, anyhow::Error> {
    // Get all clusters in the super cluster
    let clusters = match o2_enterprise::enterprise::super_cluster::search::get_cluster_nodes(
        &config::ider::generate_trace_id(),
        vec![], // pass empty vector to get all regions
        vec![], // pass empty vector to get all clusters
        Some(config::meta::cluster::RoleGroup::Interactive),
    )
    .await
    {
        Ok(nodes) => nodes,
        Err(e) => {
            log::error!("Failed to get super cluster nodes: {:?}", e);
            return Err(anyhow::anyhow!(
                "Failed to get super cluster nodes: {:?}",
                e
            ));
        }
    };

    // For each node in the super cluster, get the delete status
    let trace_id = config::ider::generate_trace_id();
    let mut results = Vec::new();
    let mut any_pending = false;
    let mut all_completed = true;
    let mut errors = Vec::new();

    for cluster in clusters {
        match crate::service::cluster_info::get_super_cluster_delete_job_status(
            &trace_id,
            cluster.clone(),
            id,
        )
        .await
        {
            Ok(response) => {
                let job_status = CompactorManualJobStatus::from(response.status);
                if job_status == CompactorManualJobStatus::Pending {
                    any_pending = true;
                } else if job_status != CompactorManualJobStatus::Completed {
                    all_completed = false;
                }
                let res = CompactorManualJobResEntry {
                    cluster: cluster.get_cluster(),
                    region: cluster.get_region(),
                    job: CompactorManualJob {
                        id: response.id,
                        key: response.key,
                        created_at: response.created_at,
                        ended_at: response.ended_at,
                        status: job_status,
                    },
                };
                results.push(res);
            }
            Err(e) => {
                log::error!(
                    "Failed to get delete job status from cluster {}: {:?}",
                    cluster.get_cluster(),
                    e
                );
                errors.push(e.to_string());
            }
        }
    }

    let status = if any_pending {
        CompactorManualJobStatus::Pending
    } else if all_completed && errors.is_empty() {
        CompactorManualJobStatus::Completed
    } else {
        CompactorManualJobStatus::Pending
    };

    let response = CompactorManualJobStatusRes {
        id: id.to_string(),
        status,
        metadata: results,
        errors,
    };

    Ok(response)
}
