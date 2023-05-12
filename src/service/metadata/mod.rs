use actix_multipart::Multipart;
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
use actix_web::http::StatusCode;
use actix_web::{web, HttpResponse};
use futures::{StreamExt, TryStreamExt};

use crate::meta::http::HttpResponse as MetaHttpResponse;
use std::io::Error;

pub async fn save_metadata(
    org_id: &str,
    table_name: &str,
    mut payload: Multipart,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    while let Ok(Some(mut field)) = payload.try_next().await {
        let content_disposition = field.content_disposition();

        if content_disposition.get_filename().is_some() {
            while let Some(chunk) = field.next().await {
                let data = chunk.unwrap();
                println!("received part {:?}", data);
            }
        }
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::error(
        StatusCode::OK.into(),
        "Saved metadata".to_string(),
    )))
}
