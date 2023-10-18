// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{delete, get, http, post, web, HttpRequest, HttpResponse, Responder};
use ahash::AHashMap as HashMap;
use std::io::{Error, ErrorKind};

use crate::common::meta::{
    self,
    http::HttpResponse as MetaHttpResponse,
    stream::{ListStream, StreamDeleteFields, StreamSettings},
    StreamType,
};
use crate::common::utils::http::get_stream_type_from_request;
use crate::service::stream;

/** GetSchema */
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
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = Stream),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/{stream_name}/schema")]
async fn schema(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    stream::get_stream(&org_id, &stream_name, stream_type).await
}

/** UpdateStreamSettings */
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
    ),
    request_body(content = StreamSettings, description = "Stream settings", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/settings")]
async fn settings(
    path: web::Path<(String, String)>,
    settings: web::Json<StreamSettings>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => {
            if let Some(s_type) = v {
                if s_type == StreamType::EnrichmentTables {
                    return Ok(
                        HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                            http::StatusCode::BAD_REQUEST.into(),
                            "Stream type 'EnrichmentTable' not allowed".to_string(),
                        )),
                    );
                }
                Some(s_type)
            } else {
                v
            }
        }
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    stream::save_stream_settings(&org_id, &stream_name, stream_type, settings.into_inner()).await
}

/** DeleteStreamFields */
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
    ),
    request_body(content = StreamDeleteFields, description = "Stream delete fields", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/delete_fields")]
async fn delete_fields(
    path: web::Path<(String, String)>,
    fields: web::Json<StreamDeleteFields>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
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

/** DeleteStream */
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
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/{stream_name}")]
async fn delete(
    path: web::Path<(String, String)>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    stream::delete_stream(&org_id, &stream_name, stream_type).await
}

/** ListStreams */
#[utoipa::path(
    context_path = "/api",
    tag = "Streams",
    operation_id = "StreamList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = ListStream),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[get("/{org_id}/streams")]
async fn list(org_id: web::Path<String>, req: HttpRequest) -> impl Responder {
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let stream_type = match get_stream_type_from_request(&query) {
        Ok(v) => v,
        Err(e) => {
            return Ok(
                HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )),
            )
        }
    };

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

    let mut indices = stream::get_streams(org_id.as_str(), stream_type, fetch_schema).await;
    indices.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(HttpResponse::Ok().json(ListStream { list: indices }))
}
