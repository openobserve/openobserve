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

use std::cmp::Ordering;

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::{
    meta::stream::{StreamType, TimeRange, UpdateStreamSettings},
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
            stream::{ListStream, StreamCreate, StreamDeleteFields, StreamUpdateFields},
        },
        utils::{
            auth::UserEmail,
            http::{get_stream_type_from_request, get_ts_from_request_with_key},
        },
    },
    handler::http::extractors::Headers,
    service::stream,
};

/// GetSchema
#[utoipa::path(
    get,
    path = "/{org_id}/streams/{stream_name}/schema",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamSchema",
    summary = "Get stream schema",
    description = "Retrieves the schema definition for a specific stream, including field types and metadata. Supports filtering by keyword and pagination",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get stream schema", "category": "streams"}))
    )
)]
pub async fn schema(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let mut stream_name = stream_name;
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let schema = stream::get_stream(&org_id, &stream_name, stream_type).await;
    let Some(mut schema) = schema else {
        return (
            StatusCode::NOT_FOUND,
            Json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND,
                "stream not found",
            )),
        )
            .into_response();
    };
    if !schema.settings.defined_schema_fields.is_empty() {
        let mut schema_fields = schema
            .schema
            .iter()
            .map(|f| (&f.name, f))
            .collect::<HashMap<_, _>>();
        schema.uds_schema = schema
            .settings
            .defined_schema_fields
            .iter()
            .filter_map(|f| schema_fields.remove(f))
            .cloned()
            .collect::<Vec<_>>();
    }

    // filter by keyword
    if let Some(keyword) = query.get("keyword")
        && !keyword.is_empty()
    {
        schema.schema.retain(|f| f.name.contains(keyword));
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

    (StatusCode::OK, Json(schema)).into_response()
}

/// CreateStream
#[utoipa::path(
    post,
    path = "/{org_id}/streams/{stream_name}",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamCreate",
    summary = "Create new stream",
    description = "Creates a new stream with specified settings and schema definition. The stream will be used to store and organize data of the specified type",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = inline(StreamCreate), description = "Stream create", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a new stream", "category": "streams"}))
    )
)]
pub async fn create(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(stream): Json<StreamCreate>,
) -> Response {
    let mut stream_name = stream_name;
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    if stream_type == StreamType::EnrichmentTables || stream_type == StreamType::Index {
        return (
            StatusCode::BAD_REQUEST,
            Json(meta::http::HttpResponse::error(
                StatusCode::BAD_REQUEST,
                format!("Stream type '{stream_type}' not allowed"),
            )),
        )
            .into_response();
    }
    match stream::create_stream(&org_id, &stream_name, stream_type, stream).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// UpdateStreamSettings

#[utoipa::path(
    put,
    path = "/{org_id}/streams/{stream_name}/settings",
    context_path = "/api",
    tag = "Streams",
    operation_id = "UpdateStreamSettings",
    summary = "Update stream settings",
    description = "Updates configuration settings for an existing stream, including retention policies, partitioning, and other stream-specific options",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = inline(UpdateStreamSettings), description = "Stream settings", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update stream settings", "category": "streams"}))
    )
)]
pub async fn update_settings(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(stream_settings): Json<UpdateStreamSettings>,
) -> Response {
    let cfg = config::get_config();
    let mut stream_name = stream_name;
    if !cfg.common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    if stream_type == StreamType::EnrichmentTables || stream_type == StreamType::Index {
        return (
            StatusCode::BAD_REQUEST,
            Json(meta::http::HttpResponse::error(
                StatusCode::BAD_REQUEST,
                format!("Stream type '{stream_type}' not allowed"),
            )),
        )
            .into_response();
    }
    match stream::update_stream_settings(
        &org_id,
        &stream_name,
        stream_type,
        stream_settings.clone(),
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// UpdateStreamFields
///
/// #{"ratelimit_module":"Streams", "ratelimit_module_operation":"update"}#
#[utoipa::path(
    put,
    path = "/{org_id}/streams/{stream_name}/update_fields",
    context_path = "/api",
    tag = "Streams",
    operation_id = "UpdateStreamFields",
    security(("Authorization"= [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = inline(StreamUpdateFields), description = "Update stream fields to a specific data type", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn update_fields(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(payload): Json<StreamUpdateFields>,
) -> Response {
    let mut stream_name = stream_name;
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query);
    if payload.fields.is_empty() {
        return (
            StatusCode::OK,
            Json(MetaHttpResponse::message(
                StatusCode::OK,
                "no fields to update".to_string(),
            )),
        )
            .into_response();
    }
    match stream::update_fields_type(&org_id, &stream_name, stream_type, &payload.fields).await {
        Ok(_) => (
            StatusCode::OK,
            Json(MetaHttpResponse::message(
                StatusCode::OK,
                "fields updated".to_string(),
            )),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(MetaHttpResponse::error(
                StatusCode::BAD_REQUEST,
                e.to_string(),
            )),
        )
            .into_response(),
    }
}

/// DeleteStreamFields

#[utoipa::path(
    put,
    path = "/{org_id}/streams/{stream_name}/delete_fields",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteFields",
    summary = "Delete stream fields",
    description = "Removes specified fields from the stream schema. This operation will affect how future data is indexed and queried for this stream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
    ),
    request_body(content = inline(StreamDeleteFields), description = "Stream delete fields", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_fields(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(fields): Json<StreamDeleteFields>,
) -> Response {
    let mut stream_name = stream_name;
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query);
    match stream::delete_fields(&org_id, &stream_name, stream_type, &fields.fields).await {
        Ok(_) => (
            StatusCode::OK,
            Json(MetaHttpResponse::message(StatusCode::OK, "fields deleted")),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
        )
            .into_response(),
    }
}

/// DeleteStream

#[utoipa::path(
    delete,
    path = "/{org_id}/streams/{stream_name}",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDelete",
    summary = "Delete stream",
    description = "Permanently deletes a stream and all its associated data. Use delete_all parameter to remove related resources like alerts and dashboards",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("type" = String, Query, description = "Stream type"),
        ("delete_all" = bool, Query, description = "Delete all related feature resources"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a stream", "category": "streams"}))
    )
)]
pub async fn delete(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let del_related_feature_resources = query
        .get("delete_all")
        .and_then(|v| v.parse::<bool>().ok())
        .unwrap_or_default();
    match stream::delete_stream(
        &org_id,
        &stream_name,
        stream_type,
        del_related_feature_resources,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// ListStreams

#[utoipa::path(
    get,
    path = "/{org_id}/streams",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamList",
    summary = "List organization streams",
    description = "Retrieves a paginated list of streams within the organization, with optional filtering by type and keyword. Supports sorting by various metrics",
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
        (status = 200, description = "Success", content_type = "application/json", body = inline(ListStream)),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List all streams", "category": "streams"}))
    )
)]
pub async fn list(
    Path(org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let stream_type = get_stream_type_from_request(&query);

    let fetch_schema = match query.get("fetchSchema") {
        Some(s) => match s.to_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => {
                return MetaHttpResponse::bad_request(
                    " 'fetchSchema' query param with value 'true' or 'false' allowed",
                );
            }
        },
        None => false,
    };
    let mut _stream_list_from_rbac = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        if let Some(s_type) = &stream_type {
            let stream_type_str = s_type.to_string();
            match crate::handler::http::auth::validator::list_objects_for_user(
                &org_id,
                &_user_email.user_id,
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
                    return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
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
    if let Some(keyword) = query
        .get("keyword")
        .filter(|kw| !kw.is_empty())
        .map(|kw| kw.to_lowercase())
    {
        indices.retain(|s| s.name.to_lowercase().contains(&keyword));
    }

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

        return (
            StatusCode::OK,
            Json(ListStream {
                list: indices,
                total,
            }),
        )
            .into_response();
    }

    // sort by
    let sort = query
        .get("sort")
        .filter(|v| !v.is_empty())
        .map(String::to_string)
        .unwrap_or_else(|| "name".to_string());
    let asc = query
        .get("asc")
        .map(|asc| asc.eq_ignore_ascii_case("true") || asc.eq_ignore_ascii_case("1"))
        .unwrap_or(true);

    indices.sort_by(|a, b| stream_comparator(a, b, &sort, asc));

    if limit > 0 {
        let end = std::cmp::min(offset + limit, indices.len());
        indices.drain(end..);
        indices.drain(..offset);
    }

    (
        StatusCode::OK,
        Json(ListStream {
            list: indices,
            total,
        }),
    )
        .into_response()
}

/// Compares two streams for sorting based on the field and ASC/DESC
fn stream_comparator(
    a: &meta::stream::Stream,
    b: &meta::stream::Stream,
    sort: &str,
    asc: bool,
) -> Ordering {
    let ord = match sort {
        "name" => a.name.cmp(&b.name),
        "doc_num" => a.stats.doc_num.cmp(&b.stats.doc_num),
        "storage_size" => a
            .stats
            .storage_size
            .partial_cmp(&b.stats.storage_size)
            .unwrap_or(Ordering::Equal),
        "compressed_size" => a
            .stats
            .compressed_size
            .partial_cmp(&b.stats.compressed_size)
            .unwrap_or(Ordering::Equal),
        "index_size" => a
            .stats
            .index_size
            .partial_cmp(&b.stats.index_size)
            .unwrap_or(Ordering::Equal),
        _ => a.name.cmp(&b.name),
    };

    if asc { ord } else { ord.reverse() }
}

/// StreamDeleteCache

#[utoipa::path(
    delete,
    path = "/{org_id}/streams/{stream_name}/cache/results",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteCache",
    summary = "Delete stream result cache",
    description = "Clears cached search results for a stream. Optionally specify a timestamp to retain cache from that point forward and delete older cache",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_stream_cache(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if !config::get_config().common.result_cache_enabled {
        return (
            StatusCode::BAD_REQUEST,
            Json(MetaHttpResponse::error(
                StatusCode::BAD_REQUEST,
                "Result Cache is disabled",
            )),
        )
            .into_response();
    }
    let mut stream_name = stream_name;
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let delete_ts = get_ts_from_request_with_key(&query, "ts").unwrap_or(0);

    let path = if stream_name.eq("_all") {
        org_id
    } else {
        format!("{org_id}/{stream_type}/{stream_name}")
    };

    match crate::service::search::cluster::cacher::delete_cached_results(path, delete_ts).await {
        true => (
            StatusCode::OK,
            Json(MetaHttpResponse::message(
                StatusCode::OK,
                "cache deleted".to_string(),
            )),
        )
            .into_response(),
        false => (
            StatusCode::BAD_REQUEST,
            Json(MetaHttpResponse::error(
                StatusCode::BAD_REQUEST,
                "Error deleting cache, please retry".to_string(),
            )),
        )
            .into_response(),
    }
}

/// StreamDeleteDataByTimeRange

#[utoipa::path(
    delete,
    path = "/{org_id}/streams/{stream_name}/data_by_time_range",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteDataByTimeRange",
    summary = "Delete stream data by time range",
    description = "Creates a deletion job to permanently remove stream data within the specified time range. Returns a job ID to track the deletion progress",
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
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "delete"}))
    )
)]
pub async fn delete_stream_data_by_time_range(
    Path((org_id, stream_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let cfg = config::get_config();
    let mut stream_name = stream_name;
    if !cfg.common.skip_formatting_stream_name {
        stream_name = format_stream_name(stream_name);
    }
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let start = match get_ts_from_request_with_key(&query, "start") {
        Ok(ts) => ts,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
            )
                .into_response();
        }
    };
    let end = match get_ts_from_request_with_key(&query, "end") {
        Ok(ts) => ts,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(MetaHttpResponse::error(StatusCode::BAD_REQUEST, e)),
            )
                .into_response();
        }
    };
    let time_range = TimeRange::new(start, end);
    let job_id = match crate::service::stream::delete_stream_data_by_time_range(
        &org_id,
        stream_type,
        &stream_name,
        time_range.clone(),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "delete_stream_data_by_time_range {org_id}/{stream_type}/{stream_name}/{time_range} error: {e}",
            );
            return (
                StatusCode::BAD_REQUEST,
                Json(MetaHttpResponse::error(
                    StatusCode::BAD_REQUEST,
                    e.to_string(),
                )),
            )
                .into_response();
        }
    };

    let res = serde_json::json!({ "id": job_id });
    (StatusCode::OK, Json(res)).into_response()
}

/// StreamDeleteDataByTimeRangeJobStatus

#[utoipa::path(
    get,
    path = "/{org_id}/streams/{stream_name}/data_by_time_range/status/{id}",
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamDeleteDataByTimeRangeJobStatus",
    summary = "Get deletion job status",
    description = "Retrieves the current status of a stream data deletion job, including progress information and any errors encountered",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "get"}))
    )
)]
pub async fn get_delete_stream_data_status(
    Path((_org_id, _stream_name, data_id)): Path<(String, String, String)>,
) -> Response {
    // Check if super cluster is enabled
    #[cfg(feature = "enterprise")]
    let response = if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        // Super cluster is enabled, get status from all regions
        match get_super_cluster_delete_status(&data_id).await {
            Ok(res) => res,
            Err(e) => {
                log::error!("get_super_cluster_delete_status error: {e}");
                return (
                    StatusCode::BAD_REQUEST,
                    Json(MetaHttpResponse::error(
                        StatusCode::BAD_REQUEST,
                        e.to_string(),
                    )),
                )
                    .into_response();
            }
        }
    } else {
        // Super cluster not enabled, get local status
        get_local_delete_status(&data_id).await
    };

    #[cfg(not(feature = "enterprise"))]
    let response = get_local_delete_status(&data_id).await;

    (StatusCode::OK, Json(response)).into_response()
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
                errors: vec![serde_json::json!({
                    "error": e.to_string(),
                })],
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
            log::error!("Failed to get super cluster nodes: {e:?}");
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
                let err = serde_json::json!({
                    "cluster": cluster.get_cluster(),
                    "region": cluster.get_region(),
                    "error": e.to_string(),
                });
                errors.push(err);
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
