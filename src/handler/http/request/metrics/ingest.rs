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

use actix_web::{http, post, web, HttpResponse};
use std::io::Error;

use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::service::metrics;

/** _json ingestion API */
#[utoipa::path(
    context_path = "/api",
    tag = "Metrics",
    operation_id = "MetricsIngestionJson",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = String, description = "Ingest data (json array)", content_type = "application/json", example = json!([{"__name__":"metrics stream name","__type__":"counter / gauge / histogram / summary","label_name1":"label_value1","label_name2":"label_value2", "_timestamp":1687175143,"value":1.2}])),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = IngestionResponse, example = json!({"code": 200,"status": [{"name": "up","successful": 3,"failed": 0}]})),
        (status = 500, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/ingest/metrics/_json")]
pub async fn json(
    org_id: web::Path<String>,
    body: web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    Ok(
        match metrics::json::ingest(&org_id, body, **thread_id).await {
            Ok(v) => HttpResponse::Ok().json(v),
            Err(e) => HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )),
        },
    )
}
