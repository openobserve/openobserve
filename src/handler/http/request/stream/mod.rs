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
use config::{
    meta::stream::{StreamSettings, StreamType, UpdateStreamSettings},
    utils::schema::format_stream_name,
};
use hashbrown::HashMap;

use crate::{
    common::{
        meta::{
            self,
            http::HttpResponse as MetaHttpResponse,
            stream::{ListStream, StreamDeleteFields},
        },
        utils::http::get_stream_type_from_request,
    },
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
            StatusCode::NOT_FOUND,
            "stream not found",
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
    let config = config::get_config();
    if !config.common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    if stream_type == StreamType::EnrichmentTables || stream_type == StreamType::Index {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("Stream type '{}' not allowed", stream_type),
            )),
        );
    }
    
    let mut settings = settings.into_inner();
    settings.store_original_data = settings.store_original_data || config.pipeline.store_original_data;
    
    stream::save_stream_settings(&org_id, &stream_name, stream_type, settings).await
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
                http::StatusCode::BAD_REQUEST,
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
            http::StatusCode::OK,
            "fields deleted",
        ))),
        Err(e) => Ok(HttpResponse::BadRequest()
            .json(MetaHttpResponse::error(http::StatusCode::BAD_REQUEST, e))),
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
            http::StatusCode::BAD_REQUEST,
            "Result Cache is disabled",
        )));
    }
    let (org_id, mut stream_name) = path.into_inner();
    if !config::get_config().common.skip_formatting_stream_name {
        stream_name = format_stream_name(&stream_name);
    }
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = get_stream_type_from_request(&query).unwrap_or_default();
    let path = if stream_name.eq("_all") {
        org_id
    } else {
        format!("{}/{}/{}", org_id, stream_type, stream_name)
    };

    match crate::service::search::cluster::cacher::delete_cached_results(path).await {
        true => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "cache deleted",
        ))),
        false => Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "Error deleting cache, please retry",
        ))),
    }
}
