// Copyright 2024 OpenObserve Inc.
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

use std::io::Error;

use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use config::meta::{
    function::{FunctionList, Transform},
    pipeline::{PipelineDependencyItem, PipelineDependencyResponse},
};

use crate::{
    common::{
        meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
        utils::auth::{remove_ownership, set_ownership},
    },
    service::{db, ingestion::compile_vrl_function},
};

const FN_SUCCESS: &str = "Function saved successfully";
const FN_NOT_FOUND: &str = "Function not found";
const FN_DELETED: &str = "Function deleted";
const FN_ALREADY_EXIST: &str = "Function already exist";
const FN_IN_USE: &str =
    "Function is associated with streams, please remove association from streams before deleting:";

pub async fn save_function(org_id: String, mut func: Transform) -> Result<HttpResponse, Error> {
    if let Some(_existing_fn) = check_existing_fn(&org_id, &func.name).await {
        Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            StatusCode::BAD_REQUEST.into(),
            FN_ALREADY_EXIST.to_string(),
        )))
    } else {
        if !func.function.ends_with('.') {
            func.function = format!("{} \n .", func.function);
        }
        if func.trans_type.unwrap() == 0 {
            if let Err(e) = compile_vrl_function(func.function.as_str(), &org_id) {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    StatusCode::BAD_REQUEST.into(),
                    e.to_string(),
                )));
            }
        }
        extract_num_args(&mut func);
        if let Err(error) = db::functions::set(&org_id, &func.name, &func).await {
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    error.to_string(),
                )),
            )
        } else {
            set_ownership(&org_id, "functions", Authz::new(&func.name)).await;

            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                FN_SUCCESS.to_string(),
            )))
        }
    }
}

#[tracing::instrument(skip(func))]
pub async fn update_function(
    org_id: &str,
    fn_name: &str,
    mut func: Transform,
) -> Result<HttpResponse, Error> {
    let existing_fn = match check_existing_fn(org_id, fn_name).await {
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

    if !func.function.ends_with('.') {
        func.function = format!("{} \n .", func.function);
    }
    if func.trans_type.unwrap() == 0 {
        if let Err(e) = compile_vrl_function(&func.function, org_id) {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                StatusCode::BAD_REQUEST.into(),
                e.to_string(),
            )));
        }
    }
    extract_num_args(&mut func);

    if let Err(error) = db::functions::set(org_id, &func.name, &func).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::message(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                error.to_string(),
            )),
        );
    }

    // update associated pipelines
    if let Ok(associated_pipelines) = db::pipeline::list_by_org(org_id).await {
        for pipeline in associated_pipelines {
            if pipeline.contains_function(&func.name) {
                if let Err(e) = db::pipeline::update(&pipeline, None).await {
                    return Ok(HttpResponse::InternalServerError().json(
                        MetaHttpResponse::message(
                            http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                            format!(
                                "Failed to update associated pipeline({}/{}): {}",
                                pipeline.id, pipeline.name, e
                            ),
                        ),
                    ));
                }
            }
        }
    }

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        FN_SUCCESS.to_string(),
    )))
}

pub async fn list_functions(
    org_id: String,
    permitted: Option<Vec<String>>,
) -> Result<HttpResponse, Error> {
    if let Ok(functions) = db::functions::list(&org_id).await {
        let mut result = Vec::new();
        for function in functions {
            if permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("function:{}", function.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("function:_all_{}", org_id))
            {
                result.push(function);
            }
        }

        Ok(HttpResponse::Ok().json(FunctionList { list: result }))
    } else {
        Ok(HttpResponse::Ok().json(FunctionList { list: vec![] }))
    }
}

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
    // TODO(taiming): Function Stream Association to be deprecated starting v0.13.1.
    // remove this check after migrating functions to its dedicated table
    if let Some(val) = existing_fn.streams {
        if !val.is_empty() {
            let names = val
                .iter()
                .filter_map(|stream| {
                    if !stream.is_removed {
                        Some(stream.stream.to_owned())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            if !names.is_empty() {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    StatusCode::BAD_REQUEST.into(),
                    format!("{} {}", FN_IN_USE, names),
                )));
            }
        }
    }
    let pipeline_dep = get_dependencies(&org_id, &fn_name).await;
    if !pipeline_dep.is_empty() {
        let pipeline_data = serde_json::to_string(&pipeline_dep).unwrap_or("[]".to_string());
        return Ok(HttpResponse::Conflict().json(MetaHttpResponse::error(
            http::StatusCode::CONFLICT.into(),
            format!(
                "Warning: Function '{}' has {} pipeline dependencies. Please remove these pipelines first: {}",
                fn_name,
                pipeline_dep.len(),
                pipeline_data
            ),
        )));
    }
    let result = db::functions::delete(&org_id, &fn_name).await;
    match result {
        Ok(_) => {
            remove_ownership(&org_id, "functions", Authz::new(&fn_name)).await;

            Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
                http::StatusCode::OK.into(),
                FN_DELETED.to_string(),
            )))
        }
        Err(_) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            FN_NOT_FOUND.to_string(),
        ))),
    }
}

pub async fn get_pipeline_dependencies(
    org_id: &str,
    func_name: &str,
) -> Result<HttpResponse, Error> {
    let list = get_dependencies(org_id, func_name).await;
    Ok(HttpResponse::Ok().json(PipelineDependencyResponse { list }))
}

async fn get_dependencies(org_id: &str, func_name: &str) -> Vec<PipelineDependencyItem> {
    db::pipeline::list_by_org(org_id)
        .await
        .map_or(vec![], |mut pipelines| {
            pipelines.retain(|pl| pl.contains_function(func_name));
            pipelines
                .into_iter()
                .map(|pl| PipelineDependencyItem {
                    id: pl.id,
                    name: pl.name,
                })
                .collect()
        })
}

fn extract_num_args(func: &mut Transform) {
    if func.trans_type.unwrap() == 1 {
        let src: String = func.function.to_owned();
        let start_stream = src.find('(').unwrap();
        let end_stream = src.find(')').unwrap();
        let args = &src[start_stream + 1..end_stream].trim();
        if args.is_empty() {
            func.num_args = 0;
        } else {
            func.num_args = args.split(',').collect::<Vec<&str>>().len() as u8;
        }
    } else {
        let params = func.params.to_owned();
        func.num_args = params.split(',').collect::<Vec<&str>>().len() as u8;
    }
}

async fn check_existing_fn(org_id: &str, fn_name: &str) -> Option<Transform> {
    match db::functions::get(org_id, fn_name).await {
        Ok(function) => Some(function),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{function::StreamOrder, stream::StreamType};

    use super::*;

    #[tokio::test]
    async fn test_functions() {
        let mut trans = Transform {
            function: "function(row)  row.square = row[\"Year\"]*row[\"Year\"]  return row end"
                .to_owned(),
            name: "dummyfn".to_owned(),
            params: "row".to_owned(),
            streams: None,
            num_args: 0,
            trans_type: Some(1),
        };

        let mut vrl_trans = Transform {
            name: "vrl_trans".to_owned(),
            function: ". = parse_aws_vpc_flow_log!(row.message) \n .".to_owned(),
            trans_type: Some(1),
            params: "row".to_owned(),
            num_args: 0,
            streams: Some(vec![StreamOrder {
                stream: "test".to_owned(),
                stream_type: StreamType::Logs,
                order: 0,
                is_removed: false,
                apply_before_flattening: false,
            }]),
        };

        extract_num_args(&mut trans);
        extract_num_args(&mut vrl_trans);
        assert_eq!(trans.num_args, 1);
        assert_eq!(vrl_trans.num_args, 1);

        assert_eq!(trans.num_args, 1);

        let res = save_function("nexus".to_owned(), trans).await;
        assert!(res.is_ok());

        let list_resp = list_functions("nexus".to_string(), None).await;
        assert!(list_resp.is_ok());

        assert!(delete_function("nexus".to_string(), "dummyfn".to_owned())
            .await
            .is_ok());
    }
}
