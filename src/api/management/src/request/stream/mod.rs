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
use enrichment_data::enrichment_table::cleanup_enrichment_table_resources;
use hashbrown::HashMap;
use infra::table::compactor_manual_jobs::{
    CompactorManualJob, CompactorManualJobResEntry, CompactorManualJobStatusRes,
    Status as CompactorManualJobStatus,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, stream as stream_orchestrator};
use stream as stream_service;

use crate::common::{
    meta::{
        self,
        http::HttpResponse as MetaHttpResponse,
        stream::{ListStream, StreamCreate, StreamDeleteFields, StreamUpdateFields},
    },
    utils::http::{get_stream_type_from_request, get_ts_from_request_with_key},
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
        ("keyword" = Option<String>, Query, description = "Keyword filter for field names (default: empty)"),
        ("offset" = Option<u32>, Query, description = "Pagination offset (default: 0)"),
        ("limit" = Option<u32>, Query, description = "Pagination limit (default: 0 = all)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get stream schema", "category": "streams", "pinned": true}))
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
    // Hidden like it is from listing and search: its schema is not for users.
    let schema = if config::meta::self_reporting::ai_chat::is_protected_ai_chat_stream(&stream_name)
    {
        None
    } else {
        stream_service::get_stream(&org_id, &stream_name, stream_type).await
    };
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
        // internal columns are implicit in the UDS even when not persisted
        let internal_columns = schema.settings.uds_internal_columns();
        schema.uds_schema = schema
            .settings
            .defined_schema_fields
            .iter()
            .chain(internal_columns.iter())
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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
    match stream_service::create_stream(&org_id, &stream_name, stream_type, stream).await {
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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
        ("x-o2-mcp" = json!({"description": "Update stream settings", "category": "streams", "requires_confirmation": true}))
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
    match stream_service::update_stream_settings(
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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
    match stream_service::update_fields_type(&org_id, &stream_name, stream_type, &payload.fields)
        .await
    {
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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
    match stream_service::delete_fields(&org_id, &stream_name, stream_type, &fields.fields).await {
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
        ("delete_all" = bool, Query, description = "Delete all related feature resources"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete a stream", "category": "streams", "requires_confirmation": true}))
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
    match stream_orchestrator::delete_stream(
        &org_id,
        &stream_name,
        stream_type,
        del_related_feature_resources,
        |org_id, stream_name, stream_type| async move {
            cleanup_enrichment_table_resources(&org_id, &stream_name, stream_type).await;
        },
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
    description = "Retrieves a paginated list of streams within the organization, with optional filtering by type and keyword. Supports sorting by various metrics. Streams written by OpenObserve itself carry `is_internal: true`; the field is omitted for user streams.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
        ("keyword" = Option<String>, Query, description = "Keyword"),
        ("offset" = Option<u32>, Query, description = "Offset"),
        ("limit" = Option<u32>, Query, description = "Limit"),
        ("sort" = Option<String>, Query, description = "Sort"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ListStream)),
        (status = 400, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Streams", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all streams in the organization, you can filter by type and keyword. is_internal marks streams OpenObserve writes itself and is omitted when false.",
            "category": "streams",
            "summary_fields": ["name", "stream_type", "stats.storage_size", "is_internal"],
            "pinned": true
        }))
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
            match openobserve_api_common::auth::validator::list_objects_for_user(
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
                    return common::meta::http::HttpResponse::forbidden(e.to_string());
                }
            }
        }
        // Get List of allowed objects ends
    }

    #[cfg(feature = "enterprise")]
    let listed_by_permission = _stream_list_from_rbac.is_some();
    let mut indices = stream_service::get_streams(
        org_id.as_str(),
        stream_type,
        fetch_schema,
        _stream_list_from_rbac,
    )
    .await;

    // The AI chat-events stream is internal: readable only through the Chat
    // API, so it is not offered in the streams UI/API either.
    indices
        .retain(|s| !config::meta::self_reporting::ai_chat::is_protected_ai_chat_stream(&s.name));

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

    #[cfg(feature = "enterprise")]
    if !listed_by_permission
        && !db::user::is_root_user(&_user_email.user_id)
        && openobserve_core::authz::rbac_enforced().await
    {
        let (org_id, user_id) = (org_id.as_str(), _user_email.user_id.as_str());
        let role = openobserve_core::users::get_user(Some(org_id), user_id)
            .await
            .map(|user| user.role.to_string());
        let granted = granted_ids_by_type(&indices, |stream_type| {
            list_readable_stream_ids(org_id, user_id, role.as_deref(), stream_type)
        })
        .await;
        hide_unreadable_schemas(&mut indices, |s| is_readable(&granted, org_id, s));
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

/// Keeps only the name and stats of each stream `can_read` refuses: settings name fields too.
#[cfg(any(feature = "enterprise", test))]
fn hide_unreadable_schemas(
    streams: &mut [meta::stream::Stream],
    can_read: impl Fn(&meta::stream::Stream) -> bool,
) {
    for stream in streams.iter_mut().filter(|s| !can_read(s)) {
        stream.schema.clear();
        stream.uds_schema.clear();
        stream.total_fields = 0;
        stream.settings = Default::default();
        stream.pattern_associations.clear();
    }
}

/// Granted object ids per stream type, looked up once per type present in `streams`.
#[cfg(any(feature = "enterprise", test))]
async fn granted_ids_by_type<F, Fut>(
    streams: &[meta::stream::Stream],
    list_granted: F,
) -> HashMap<StreamType, Vec<String>>
where
    F: Fn(StreamType) -> Fut,
    Fut: std::future::Future<Output = Vec<String>>,
{
    let mut granted = HashMap::new();
    for stream in streams {
        if !granted.contains_key(&stream.stream_type) {
            let ids = list_granted(stream.stream_type).await;
            granted.insert(stream.stream_type, ids);
        }
    }
    granted
}

/// Mirrors `check_stream_permissions`: a grant on the stream or on all streams of its type.
#[cfg(any(feature = "enterprise", test))]
fn is_readable(
    granted: &HashMap<StreamType, Vec<String>>,
    org_id: &str,
    stream: &meta::stream::Stream,
) -> bool {
    let Some(ids) = granted.get(&stream.stream_type) else {
        return false;
    };
    let all = format!("_all_{org_id}");
    let own = config::utils::str::into_ofga_supported_format(&stream.name);
    ids.iter().any(|id| *id == all || *id == own)
}

/// An unknown user or a failed lookup grants nothing, as the per-stream check denies both.
#[cfg(feature = "enterprise")]
async fn list_readable_stream_ids(
    org_id: &str,
    user_id: &str,
    role: Option<&str>,
    stream_type: StreamType,
) -> Vec<String> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    let Some(role) = role else {
        return vec![];
    };
    let object_type = OFGA_MODELS
        .get(stream_type.as_str())
        .map_or(stream_type.as_str(), |model| model.key);
    match o2_openfga::authorizer::authz::list_objects(user_id, "GET", object_type, org_id, role)
        .await
    {
        Ok(objects) => objects
            .into_iter()
            .filter_map(|object| object.split_once(':').map(|(_, id)| id.to_string()))
            .collect(),
        Err(e) => {
            log::warn!("stream list: listing {object_type} grants for {user_id} failed: {e}");
            vec![]
        }
    }
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
        "mindex_size" => a
            .stats
            .mindex_size
            .partial_cmp(&b.stats.mindex_size)
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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

    match search_service::cluster::cacher::delete_cached_results(path, delete_ts).await {
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
        ("type" = Option<String>, Query, description = "Stream type. one of: logs, metrics, traces. Defaults to logs."),
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
    let job_id = match stream_service::delete_stream_data_by_time_range(
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
    Path((org_id, _stream_name, data_id)): Path<(String, String, String)>,
) -> Response {
    // Check if super cluster is enabled
    #[cfg(feature = "enterprise")]
    let response = if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        // Super cluster is enabled, get status from all regions
        match get_super_cluster_delete_status(&data_id).await {
            Ok(res) => {
                if !job_belongs_to_org(&res, &org_id) {
                    return (
                        StatusCode::NOT_FOUND,
                        Json(MetaHttpResponse::error(
                            StatusCode::NOT_FOUND,
                            "job not found".to_string(),
                        )),
                    )
                        .into_response();
                }
                res
            }
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
        let res = get_local_delete_status(&data_id).await;
        if !job_belongs_to_org(&res, &org_id) {
            return (
                StatusCode::NOT_FOUND,
                Json(MetaHttpResponse::error(
                    StatusCode::NOT_FOUND,
                    "job not found".to_string(),
                )),
            )
                .into_response();
        }
        res
    };

    #[cfg(not(feature = "enterprise"))]
    let response = {
        let res = get_local_delete_status(&data_id).await;
        if !job_belongs_to_org(&res, &org_id) {
            return (
                StatusCode::NOT_FOUND,
                Json(MetaHttpResponse::error(
                    StatusCode::NOT_FOUND,
                    "job not found".to_string(),
                )),
            )
                .into_response();
        }
        res
    };

    (StatusCode::OK, Json(response)).into_response()
}

fn job_belongs_to_org(res: &CompactorManualJobStatusRes, org_id: &str) -> bool {
    let org_prefix = format!("{org_id}/");
    res.metadata
        .iter()
        .all(|entry| entry.job.key.starts_with(&org_prefix))
}

async fn get_local_delete_status(id: &str) -> CompactorManualJobStatusRes {
    let job = match db::compact::compactor_manual_jobs::get_job(id).await {
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
        match openobserve_node::cluster_info::get_super_cluster_delete_job_status(
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

#[cfg(test)]
mod tests {
    use config::meta::stream::{StreamStats, StreamType};

    use super::*;

    fn make_stream(
        name: &str,
        doc_num: i64,
        storage_size: f64,
        compressed_size: f64,
        index_size: f64,
    ) -> meta::stream::Stream {
        meta::stream::Stream {
            name: name.to_string(),
            storage_type: "s3".to_string(),
            stream_type: StreamType::Logs,
            stats: StreamStats {
                doc_num,
                storage_size,
                compressed_size,
                index_size,
                ..Default::default()
            },
            schema: vec![],
            uds_schema: vec![],
            settings: Default::default(),
            metrics_meta: None,
            total_fields: 0,
            pattern_associations: vec![],
            is_derived: None,
            is_internal: false,
        }
    }

    #[tokio::test]
    async fn listing_drops_the_fields_of_streams_the_caller_cannot_read() {
        let field = config::meta::stream::StreamField {
            name: "card_bin".to_string(),
            r#type: "Utf8".to_string(),
        };
        let mut streams = vec![
            make_stream("hidden", 3, 1.0, 1.0, 0.0),
            make_stream("readable", 3, 1.0, 1.0, 0.0),
        ];
        for s in streams.iter_mut() {
            s.schema = vec![field.clone()];
            s.total_fields = 1;
        }
        hide_unreadable_schemas(&mut streams, |s| s.name == "readable");
        assert_eq!(streams[0].name, "hidden");
        assert!(streams[0].schema.is_empty());
        assert_eq!(streams[0].total_fields, 0);
        assert_eq!(streams[0].stats.doc_num, 3);
        assert_eq!(streams[1].schema.len(), 1);
        assert_eq!(streams[1].total_fields, 1);
    }

    #[test]
    fn listing_drops_the_settings_of_streams_the_caller_cannot_read() {
        let field = config::meta::stream::StreamField {
            name: "card_bin".to_string(),
            r#type: "Utf8".to_string(),
        };
        let mut streams = vec![
            make_stream("hidden", 3, 1.0, 1.0, 0.0),
            make_stream("readable", 3, 1.0, 1.0, 0.0),
        ];
        for s in streams.iter_mut() {
            s.uds_schema = vec![field.clone()];
            s.settings.partition_keys =
                vec![config::meta::stream::StreamPartition::new("card_bin")];
            s.settings.full_text_search_keys = vec!["card_bin".to_string()];
            s.settings.index_fields = vec!["card_bin".to_string()];
            s.settings.bloom_filter_fields = vec!["card_bin".to_string()];
            s.settings.defined_schema_fields = vec!["card_bin".to_string()];
            s.settings.data_retention = 7;
        }
        let readable_settings = streams[1].settings.clone();
        hide_unreadable_schemas(&mut streams, |s| s.name == "readable");
        assert_eq!(streams[0].settings, Default::default());
        assert!(streams[0].uds_schema.is_empty());
        assert!(!format!("{:?}", streams[0]).contains("card_bin"));
        assert_eq!(streams[0].name, "hidden");
        assert_eq!(streams[0].stats.doc_num, 3);
        assert_eq!(streams[1].settings, readable_settings);
        assert_eq!(streams[1].uds_schema.len(), 1);
    }

    fn typed_stream(name: &str, stream_type: StreamType) -> meta::stream::Stream {
        let mut stream = make_stream(name, 1, 1.0, 1.0, 0.0);
        stream.stream_type = stream_type;
        stream
    }

    #[tokio::test]
    async fn stream_list_looks_up_grants_once_per_stream_type() {
        let types = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
        let mut streams: Vec<_> = (0..30)
            .map(|i| typed_stream(&format!("s{i}"), types[i % 3]))
            .collect();
        streams.push(typed_stream("http:requests", StreamType::Metrics));
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let granted = granted_ids_by_type(&streams, |stream_type| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let ids: Vec<String> = match stream_type {
                StreamType::Logs => vec!["_all_org1".into()],
                StreamType::Metrics => vec!["s1".into(), "s4".into(), "http.requests".into()],
                _ => vec!["_all_org2".into(), "s2x".into()],
            };
            async move { ids }
        })
        .await;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), types.len());

        let per_stream_check = |s: &meta::stream::Stream| match s.stream_type {
            StreamType::Logs => true,
            StreamType::Metrics => ["s1", "s4", "http:requests"].contains(&s.name.as_str()),
            _ => false,
        };
        for stream in &streams {
            assert_eq!(
                is_readable(&granted, "org1", stream),
                per_stream_check(stream),
                "{}",
                stream.name
            );
        }
    }

    #[test]
    fn a_stream_type_without_a_grant_lookup_is_unreadable() {
        let granted = HashMap::new();
        assert!(!is_readable(
            &granted,
            "org1",
            &typed_stream("a", StreamType::Logs)
        ));
    }

    #[test]
    fn stream_list_checks_read_permission_before_returning_schemas() {
        let text = include_str!("mod.rs");
        let start = text.find("pub async fn list(").expect("list handler");
        let body = &text[start..];
        let body = &body[..body.find("\n}\n").expect("handler end")];
        assert!(body.contains("hide_unreadable_schemas("));
        assert!(
            !body.contains("if fetch_schema"),
            "settings carry field names, so the guard runs with or without fetchSchema"
        );
    }

    #[test]
    fn test_comparator_by_name_asc() {
        let a = make_stream("alpha", 0, 0.0, 0.0, 0.0);
        let b = make_stream("beta", 0, 0.0, 0.0, 0.0);
        assert_eq!(stream_comparator(&a, &b, "name", true), Ordering::Less);
        assert_eq!(stream_comparator(&b, &a, "name", true), Ordering::Greater);
    }

    #[test]
    fn test_comparator_by_name_desc() {
        let a = make_stream("alpha", 0, 0.0, 0.0, 0.0);
        let b = make_stream("beta", 0, 0.0, 0.0, 0.0);
        assert_eq!(stream_comparator(&a, &b, "name", false), Ordering::Greater);
    }

    #[test]
    fn test_comparator_by_doc_num_asc() {
        let a = make_stream("a", 100, 0.0, 0.0, 0.0);
        let b = make_stream("b", 200, 0.0, 0.0, 0.0);
        assert_eq!(stream_comparator(&a, &b, "doc_num", true), Ordering::Less);
        assert_eq!(
            stream_comparator(&b, &a, "doc_num", true),
            Ordering::Greater
        );
    }

    #[test]
    fn test_comparator_by_storage_size() {
        let a = make_stream("a", 0, 1.0, 0.0, 0.0);
        let b = make_stream("b", 0, 2.0, 0.0, 0.0);
        assert_eq!(
            stream_comparator(&a, &b, "storage_size", true),
            Ordering::Less
        );
    }

    #[test]
    fn test_comparator_by_compressed_size() {
        let a = make_stream("a", 0, 0.0, 5.0, 0.0);
        let b = make_stream("b", 0, 0.0, 10.0, 0.0);
        assert_eq!(
            stream_comparator(&a, &b, "compressed_size", true),
            Ordering::Less
        );
    }

    #[test]
    fn test_comparator_by_index_size() {
        let a = make_stream("a", 0, 0.0, 0.0, 3.0);
        let b = make_stream("b", 0, 0.0, 0.0, 7.0);
        assert_eq!(
            stream_comparator(&a, &b, "index_size", true),
            Ordering::Less
        );
    }

    #[test]
    fn test_comparator_unknown_sort_falls_back_to_name() {
        let a = make_stream("aardvark", 0, 0.0, 0.0, 0.0);
        let b = make_stream("zebra", 0, 0.0, 0.0, 0.0);
        assert_eq!(
            stream_comparator(&a, &b, "unknown_field", true),
            Ordering::Less
        );
    }

    #[test]
    fn test_comparator_equal_names() {
        let a = make_stream("same", 0, 0.0, 0.0, 0.0);
        let b = make_stream("same", 0, 0.0, 0.0, 0.0);
        assert_eq!(stream_comparator(&a, &b, "name", true), Ordering::Equal);
    }
    #[test]
    fn test_comparator_by_mindex_size() {
        let mut a = make_stream("a", 0, 0.0, 0.0, 100.0);
        let mut b = make_stream("b", 0, 0.0, 0.0, 100.0);
        a.stats.mindex_size = 19.0;
        b.stats.mindex_size = 7.0;
        assert_eq!(
            stream_comparator(&a, &b, "mindex_size", true),
            Ordering::Greater
        );
        assert_eq!(
            stream_comparator(&a, &b, "mindex_size", false),
            Ordering::Less
        );
    }
}
