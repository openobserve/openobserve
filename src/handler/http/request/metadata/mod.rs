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

use actix_multipart::Multipart;
use actix_web::{post, web, HttpRequest, HttpResponse};
use std::io::Error;

use crate::service::lookup_table::save_metadata;

#[post("/{org_id}/metadata/{table_name}")]
pub async fn save_enrichment_table(
    path: web::Path<(String, String)>,
    payload: Multipart,
    req: HttpRequest,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let (org_id, table_name) = path.into_inner();
    for header in req.headers() {
        println!("{}: {:?}", header.0, header.1);
    }
    let _content_type = req.headers().get("content-type").unwrap();
    //if content_type == "text/csv" {
    save_metadata(&org_id, &table_name, payload, thread_id).await
    /*  } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Bad Request".to_string(),
            )),
        )
    } */
}
