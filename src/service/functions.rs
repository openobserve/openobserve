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
use tracing::instrument;

use crate::meta::{
    functions::{StreamFunctionsList, StreamOrder},
    http::HttpResponse as MetaHttpResponse,
};
use crate::service::db;
use crate::{infra::config::STREAM_FUNCTIONS, meta::functions::Transform};
use crate::{meta::functions::FunctionList, meta::StreamType};

const FN_SUCCESS: &str = "Function saved successfully";
const FN_NOT_FOUND: &str = "Function not found";
const FN_ADDED: &str = "Function applied to stream";
const FN_REMOVED: &str = "Function removed from stream";
const FN_DELETED: &str = "Function deleted";
const FN_ALREADY_EXIST: &str = "Function already exist";
const FN_IN_USE: &str =
    "Function is used in a stream. Please remove it from the stream before deleting.";

#[instrument(skip(func))]
pub async fn save_function(org_id: String, mut func: Transform) -> Result<HttpResponse, Error> {
    if let Some(_existing_fn) = check_existing_fn(&org_id, &func.name).await {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.into(),
            FN_ALREADY_EXIST.to_string(),
        )))
    } else {
        extract_num_args(&mut func);
        let name = func.name.to_owned();
        if let Err(error) = db::functions::set(org_id.as_str(), name.as_str(), func).await {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    error.to_string(),
                )),
            );
        }
        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            FN_SUCCESS.to_string(),
        )))
    }
}

#[instrument(skip(func))]
pub async fn update_function(
    org_id: String,
    fn_name: String,
    mut func: Transform,
) -> Result<HttpResponse, Error> {
    let existing_fn = match check_existing_fn(&org_id, &fn_name).await {
        Some(function) => function,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                FN_NOT_FOUND.to_string(),
            )));
        }
    };
    if func == existing_fn {
        return Ok(HttpResponse::Ok().json(func));
    }

    // UI mostly like in 1st version wont send streams, so we need to add them back from existing function
    func.streams = existing_fn.streams;

    extract_num_args(&mut func);
    let name = func.name.to_owned();
    if let Err(error) = db::functions::set(org_id.as_str(), name.as_str(), func).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        FN_SUCCESS.to_string(),
    )))
}

#[instrument()]
pub async fn list_functions(org_id: String) -> Result<HttpResponse, Error> {
    if let Ok(functions) = db::functions::list(org_id.as_str()).await {
        Ok(HttpResponse::Ok().json(FunctionList { list: functions }))
    } else {
        Ok(HttpResponse::Ok().json(FunctionList { list: vec![] }))
    }
}

#[instrument()]
pub async fn delete_function(org_id: String, fn_name: String) -> Result<HttpResponse, Error> {
    let existing_fn = match check_existing_fn(&org_id, &fn_name).await {
        Some(function) => function,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                FN_NOT_FOUND.to_string(),
            )));
        }
    };
    if let Some(val) = existing_fn.streams {
        if !val.is_empty() {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                StatusCode::BAD_REQUEST.into(),
                FN_IN_USE.to_string(),
            )));
        }
    }
    let result = db::functions::delete(org_id.as_str(), fn_name.as_str()).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            FN_DELETED.to_string(),
        ))),
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            FN_NOT_FOUND.to_string(),
        ))),
    }
}

#[instrument()]
pub async fn list_stream_functions(
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
) -> Result<HttpResponse, Error> {
    if let Some(val) = STREAM_FUNCTIONS.get(&format!("{}/{}/{}", org_id, stream_type, stream_name))
    {
        Ok(HttpResponse::Ok().json(val.value()))
    } else {
        Ok(HttpResponse::Ok().json(StreamFunctionsList { list: vec![] }))
    }
}

#[instrument()]
pub async fn delete_stream_function(
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
    fn_name: String,
) -> Result<HttpResponse, Error> {
    let mut existing_fn = match check_existing_fn(&org_id, &fn_name).await {
        Some(function) => function,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                FN_NOT_FOUND.to_string(),
            )));
        }
    };

    if let Some(val) = existing_fn.streams.clone() {
        if val.len() == 1 && val.first().unwrap().stream == stream_name {
            existing_fn.streams = None;
        } else {
            existing_fn.streams = Some(
                val.into_iter()
                    .filter(|x| x.stream != stream_name)
                    .collect::<Vec<StreamOrder>>(),
            );
        }
        if let Err(error) = db::functions::set(org_id.as_str(), fn_name.as_str(), existing_fn).await
        {
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    error.to_string(),
                )),
            )
        } else {
            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                FN_REMOVED.to_string(),
            )))
        }
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            FN_NOT_FOUND.to_string(),
        )))
    }
}

#[instrument()]
pub async fn add_function_to_stream(
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
    fn_name: String,
    mut stream_order: StreamOrder,
) -> Result<HttpResponse, Error> {
    let mut existing_fn = match check_existing_fn(&org_id, &fn_name).await {
        Some(function) => function,
        None => {
            return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
                StatusCode::NOT_FOUND.into(),
                FN_NOT_FOUND.to_string(),
            )));
        }
    };

    stream_order.stream = stream_name;
    stream_order.stream_type = stream_type;

    if let Some(mut val) = existing_fn.streams {
        val.push(stream_order);
        existing_fn.streams = Some(val);
    } else {
        existing_fn.streams = Some(vec![stream_order]);
    }

    if let Err(error) = db::functions::set(org_id.as_str(), fn_name.as_str(), existing_fn).await {
        Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        )
    } else {
        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            FN_ADDED.to_string(),
        )))
    }
}

fn extract_num_args(func: &mut Transform) {
    let params = func.params.to_owned();
    func.num_args = params.split(',').collect::<Vec<&str>>().len() as u8;
}

async fn check_existing_fn(org_id: &str, fn_name: &str) -> Option<Transform> {
    match db::functions::get(org_id, fn_name).await {
        Ok(function) => Some(function),
        Err(_) => None,
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
            params: "row".to_owned(),
            streams: None,
            num_args: 0,
            trans_type: 1,
        };
        let res = save_function("nexus".to_owned(), trans).await;
        assert!(res.is_ok());

        let list_resp = list_functions("nexus".to_string()).await;
        assert!(list_resp.is_ok());

        let del_resp = delete_function("nexus".to_string(), "dummyfn".to_owned()).await;
        assert!(del_resp.is_ok());
    }
}
