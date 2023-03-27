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

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;
use tracing::info_span;

use crate::meta::functions::Transform;
use crate::meta::{self, http::HttpResponse as MetaHttpResponse};
use crate::service::db;
use crate::{meta::functions::FunctionList, meta::StreamType};

const SUCCESS: &str = "Function saved successfully";
const SPECIFY: &str = "Please specify ";
const STREAM: &str = "stream name ";
const ORDER: &str = "function order ";
const DELETED: &str = "Function deleted";

pub async fn register_function(
    org_id: String,
    stream_name: Option<String>,
    s_type: Option<StreamType>,
    name: String,
    mut trans: Transform,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:functions:register");
    let _guard = loc_span.enter();
    match stream_name {
        Some(stream_name) => {
            let mut is_err = false;
            let mut msg: String = String::from(SPECIFY);
            let stream_name = stream_name.trim();

            if stream_name.is_empty() {
                msg.push_str(STREAM);
                is_err = true;
            }
            if trans.order == 0 {
                msg.push_str(ORDER);
                is_err = true;
            }

            trans.stream_type = s_type;
            let js_func = trans.function.to_owned();
            if !js_func.contains('(') && !js_func.contains(')') {
                msg.push_str(" not valid function");
                is_err = true;
            }
            if is_err {
                Ok(
                    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        msg.to_string(),
                    )),
                )
            } else {
                trans.stream_name = stream_name.to_string();
                trans.name = name.to_string();
                extract_num_args(&mut trans);
                db::functions::set(
                    org_id.as_str(),
                    Some(stream_name.to_string()),
                    s_type,
                    name.as_str(),
                    trans,
                )
                .await
                .unwrap();
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK.into(),
                    SUCCESS.to_string(),
                )))
            }
        }
        None => {
            let mut is_err = false;
            trans.name = name.to_string();
            let js_func = trans.function.to_owned();
            if !js_func.contains('(') && !js_func.contains(')') {
                is_err = true;
            }
            if !is_err {
                extract_num_args(&mut trans);
                db::functions::set(org_id.as_str(), None, None, name.as_str(), trans)
                    .await
                    .unwrap();
                Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                    http::StatusCode::OK.into(),
                    SUCCESS.to_string(),
                )))
            } else {
                Ok(
                    HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                        http::StatusCode::BAD_REQUEST.into(),
                        "Not valid function".to_string(),
                    )),
                )
            }
        }
    }
}

pub async fn list_functions(
    org_id: String,
    stream_name: Option<String>,
    stream_type: Option<StreamType>,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:functions:list");
    let _guard = loc_span.enter();
    let udf_list = db::functions::list(org_id.as_str(), stream_name, stream_type)
        .await
        .unwrap();
    Ok(HttpResponse::Ok().json(FunctionList { list: udf_list }))
}

pub async fn delete_function(
    org_id: String,
    stream_name: Option<String>,
    stream_type: Option<StreamType>,
    name: String,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:functions:delete");
    let _guard = loc_span.enter();
    let result =
        db::functions::delete(org_id.as_str(), stream_name, stream_type, name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            DELETED.to_string(),
        ))),
        Err(e) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            e.to_string(),
        ))),
    }
}

fn extract_num_args(trans: &mut Transform) {
    let js_func = trans.function.to_owned();
    let start_stream = js_func.find('(').unwrap();
    let end_stream = js_func.find(')').unwrap();
    let args = &js_func[start_stream + 1..end_stream].trim();
    if args.is_empty() {
        trans.num_args = 0;
    } else {
        let args_vec = args.split(',');
        trans.num_args = args_vec.into_iter().count() as u8;

        /* let args_vec: Vec<_> = args.split(',').collect();
        trans.num_args = args_vec.len() as u8; */
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[actix_web::test]
    async fn test_functions() {
        let trans = Transform {
            function: "function (row)  row.square = row[\"Year\"]*row[\"Year\"]  return row end"
                .to_owned(),
            name: "dummyfn".to_owned(),
            order: 1,
            stream_name: "Test".to_owned(),
            num_args: 0,
            trans_type: 1,
            stream_type: None,
        };
        let res =
            register_function("nexus".to_owned(), None, None, trans.name.to_owned(), trans).await;
        assert!(res.is_ok());

        let list_resp = list_functions("nexus".to_string(), Some("Test".to_string()), None).await;
        assert!(list_resp.is_ok());

        let list_resp = list_functions("nexus".to_string(), None, None).await;
        assert!(list_resp.is_ok());

        let del_resp = delete_function(
            "nexus".to_string(),
            Some("Test".to_string()),
            None,
            "dummyfn".to_owned(),
        )
        .await;
        assert!(del_resp.is_ok());
    }
}
