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

use std::io::Error;

use axum::{
    Json, http,
    response::{IntoResponse, Response as HttpResponse},
};
use config::{
    meta::{
        function::{
            FunctionList, RESULT_ARRAY, TestVRLResponse, Transform, VRLResult, VRLResultResolver,
        },
        pipeline::{PipelineDependencyItem, PipelineDependencyResponse},
    },
    utils::json::Value,
};

use crate::{
    common::{
        self,
        meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
        utils::auth::{remove_ownership, set_ownership},
    },
    handler::http::{
        request::search::error_utils::map_error_to_http_response, router::ERROR_HEADER,
    },
    service::{db, ingestion::compile_vrl_function},
};

const FN_SUCCESS: &str = "Function saved successfully";
const FN_NOT_FOUND: &str = "Function not found";
const FN_ALREADY_EXIST: &str = "Function already exist";
const FN_IN_USE: &str =
    "Function is associated with streams, please remove association from streams before deleting:";

pub enum FunctionDeleteError {
    NotFound,
    FunctionInUse(String),
    PipelineDependencies(String),
}

pub async fn save_function(org_id: String, mut func: Transform) -> Result<HttpResponse, Error> {
    // JavaScript functions are only allowed in _meta org (for SSO claim parsing)
    if func.trans_type.unwrap_or(0) == 1 && org_id != "_meta" {
        return Ok(MetaHttpResponse::bad_request(
            "JavaScript functions are only allowed in the '_meta' organization. Please use VRL functions for other organizations.",
        ));
    }

    if let Some(_existing_fn) = check_existing_fn(&org_id, &func.name).await {
        Ok(MetaHttpResponse::bad_request(FN_ALREADY_EXIST))
    } else {
        // Only append "." for VRL functions, not JS
        if func.trans_type.unwrap() == 0 && !func.function.ends_with('.') {
            func.function = format!("{} \n .", func.function);
        }
        // Validate function based on type
        match func.trans_type.unwrap() {
            0 => {
                // VRL function
                if let Err(e) = compile_vrl_function(func.function.as_str(), &org_id) {
                    return Ok(MetaHttpResponse::bad_request(e));
                }
            }
            1 => {
                // JS function
                if let Err(e) =
                    crate::service::ingestion::compile_js_function(func.function.as_str(), &org_id)
                {
                    return Ok(MetaHttpResponse::bad_request(e));
                }
            }
            _ => {
                return Ok(MetaHttpResponse::bad_request(
                    "Invalid transform type. Use 0 for VRL or 1 for JS.",
                ));
            }
        }
        extract_num_args(&mut func);
        if let Err(error) = db::functions::set(&org_id, &func.name, &func).await {
            Ok(map_error_to_http_response(&error.into(), None))
        } else {
            set_ownership(&org_id, "functions", Authz::new(&func.name)).await;

            Ok(MetaHttpResponse::ok(FN_SUCCESS))
        }
    }
}

#[tracing::instrument(skip(org_id, function, trans_type))]
pub async fn test_run_function(
    org_id: &str,
    function: String,
    events: Vec<Value>,
    trans_type: Option<u8>,
) -> Result<HttpResponse, anyhow::Error> {
    // Auto-detect transform type if not provided
    let trans_type = trans_type
        .or_else(|| {
            // Simple heuristic: if function contains VRL-specific syntax, assume VRL
            // Otherwise, assume JS
            if function.contains('!')
                || function.trim().starts_with('.')
                || function.contains("parse_")
                || RESULT_ARRAY.is_match(&function)
            {
                Some(0) // VRL
            } else {
                Some(1) // JS
            }
        })
        .unwrap_or(0); // Default to VRL for backward compatibility

    // JavaScript functions are only allowed in _meta org (for SSO claim parsing)
    if trans_type == 1 && org_id != "_meta" {
        return Ok(MetaHttpResponse::bad_request(
            "JavaScript functions are only allowed in the '_meta' organization. Please use VRL functions for other organizations.",
        ));
    }

    match trans_type {
        0 => test_run_vrl_function(org_id, function, events).await,
        1 => test_run_js_function(org_id, function, events).await,
        _ => Ok(MetaHttpResponse::bad_request(
            "Invalid transform type. Use 0 for VRL or 1 for JS.",
        )),
    }
}

#[tracing::instrument(skip(org_id, function))]
async fn test_run_vrl_function(
    org_id: &str,
    mut function: String,
    events: Vec<Value>,
) -> Result<HttpResponse, anyhow::Error> {
    // Append a dot at the end of the function if it doesn't exist
    if !function.ends_with('.') {
        function = format!("{function} \n .");
    }

    let apply_over_hits = RESULT_ARRAY.is_match(&function);

    let runtime_config = match compile_vrl_function(&function, org_id) {
        Ok(program) => {
            let registry = program
                .config
                .get_custom::<vector_enrichment::TableRegistry>()
                .unwrap();
            registry.finish_load();
            program
        }
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    let mut runtime = common::utils::functions::init_vrl_runtime();
    let fields = runtime_config.fields;
    let program = runtime_config.program;

    let mut transformed_events = vec![];
    if apply_over_hits {
        let (ret_val, err) = crate::service::ingestion::apply_vrl_fn(
            &mut runtime,
            &VRLResultResolver {
                program: program.clone(),
                fields: fields.clone(),
            },
            Value::Array(events),
            org_id,
            &[String::new()],
        );

        if err.is_some() {
            return Ok(MetaHttpResponse::bad_request(err.unwrap()));
        }

        ret_val
            .as_array()
            .unwrap()
            .iter()
            .for_each(|record| match record {
                Value::Object(hit) => transformed_events.push(VRLResult::new(
                    "",
                    config::utils::flatten::flatten(Value::Object(hit.clone())).unwrap(),
                )),
                Value::Array(hits) => hits.iter().for_each(|hit| {
                    if let Value::Object(hit) = hit {
                        transformed_events.push(VRLResult::new(
                            "",
                            config::utils::flatten::flatten(Value::Object(hit.clone())).unwrap(),
                        ))
                    }
                }),
                _ => {}
            });
    } else {
        events.into_iter().for_each(|event| {
            let (ret_val, err) = crate::service::ingestion::apply_vrl_fn(
                &mut runtime,
                &config::meta::function::VRLResultResolver {
                    program: program.clone(),
                    fields: fields.clone(),
                },
                event.clone(),
                org_id,
                &[String::new()],
            );
            if let Some(err) = err {
                transformed_events.push(VRLResult::new(&err, event));
                return;
            }

            let transform = if !ret_val.is_null() && ret_val.is_object() {
                config::utils::flatten::flatten(ret_val).unwrap_or("".into())
            } else {
                "".into()
            };
            transformed_events.push(VRLResult::new("", transform));
        });
    }

    let results = TestVRLResponse {
        results: transformed_events,
    };

    Ok(MetaHttpResponse::json(results))
}

#[tracing::instrument(skip(org_id, function))]
async fn test_run_js_function(
    org_id: &str,
    function: String,
    events: Vec<Value>,
) -> Result<HttpResponse, anyhow::Error> {
    // Check if function uses #ResultArray# marker
    let apply_over_array = RESULT_ARRAY.is_match(&function);

    // Compile the JS function
    let js_config = match crate::service::ingestion::compile_js_function(&function, org_id) {
        Ok(config) => config,
        Err(e) => {
            return Ok(MetaHttpResponse::bad_request(e));
        }
    };

    let mut transformed_events = vec![];

    if apply_over_array {
        // #ResultArray# mode: apply function once over entire array
        let (ret_val, err) = crate::service::ingestion::apply_js_fn(
            &js_config,
            Value::Array(events),
            org_id,
            &[String::new()],
        );

        if let Some(err) = err {
            transformed_events.push(VRLResult::new(&err, Value::Null));
        } else if ret_val.is_array() {
            // Result is an array - flatten each element
            let result_array = ret_val.as_array().unwrap();
            for item in result_array {
                let transform = if item.is_object() {
                    config::utils::flatten::flatten(item.clone()).unwrap_or("".into())
                } else {
                    item.clone()
                };
                transformed_events.push(VRLResult::new("", transform));
            }
        } else {
            // Result is not an array - return as single result
            let transform = if ret_val.is_object() {
                config::utils::flatten::flatten(ret_val).unwrap_or("".into())
            } else {
                ret_val
            };
            transformed_events.push(VRLResult::new("", transform));
        }
    } else {
        // Normal mode: apply function to each event
        for event in events {
            let (ret_val, err) = crate::service::ingestion::apply_js_fn(
                &js_config,
                event.clone(),
                org_id,
                &[String::new()],
            );

            if let Some(err) = err {
                transformed_events.push(VRLResult::new(&err, event));
            } else {
                let transform = if !ret_val.is_null() && ret_val.is_object() {
                    config::utils::flatten::flatten(ret_val).unwrap_or("".into())
                } else {
                    "".into()
                };
                transformed_events.push(VRLResult::new("", transform));
            }
        }
    }

    let results = TestVRLResponse {
        results: transformed_events,
    };

    Ok(MetaHttpResponse::json(results))
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
            return Ok(MetaHttpResponse::not_found(FN_NOT_FOUND));
        }
    };

    // JavaScript functions are only allowed in _meta org (for SSO claim parsing)
    if func.trans_type.unwrap_or(0) == 1 && org_id != "_meta" {
        return Ok(MetaHttpResponse::bad_request(
            "JavaScript functions are only allowed in the '_meta' organization. Please use VRL functions for other organizations.",
        ));
    }

    if func == existing_fn {
        return Ok(MetaHttpResponse::json(func));
    }

    // Only append "." for VRL functions, not JS
    if func.trans_type.unwrap() == 0 && !func.function.ends_with('.') {
        func.function = format!("{} \n .", func.function);
    }
    // Validate function based on type
    match func.trans_type.unwrap() {
        0 => {
            // VRL function
            if let Err(e) = compile_vrl_function(&func.function, org_id) {
                return Ok(MetaHttpResponse::bad_request(e));
            }
        }
        1 => {
            // JS function
            if let Err(e) = crate::service::ingestion::compile_js_function(&func.function, org_id) {
                return Ok(MetaHttpResponse::bad_request(e));
            }
        }
        _ => {
            return Ok(MetaHttpResponse::bad_request(
                "Invalid transform type. Use 0 for VRL or 1 for JS.",
            ));
        }
    }
    extract_num_args(&mut func);

    if let Err(error) = db::functions::set(org_id, &func.name, &func).await {
        return Ok(map_error_to_http_response(&(error.into()), None));
    }

    // update associated pipelines
    if let Ok(associated_pipelines) = db::pipeline::list_by_org(org_id).await {
        for pipeline in associated_pipelines {
            if pipeline.contains_function(&func.name)
                && let Err(e) = db::pipeline::update(&pipeline, None).await
            {
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(ERROR_HEADER, e.to_string())],
                    Json(MetaHttpResponse::message(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!(
                            "Failed to update associated pipeline({}/{}): {}",
                            pipeline.id, pipeline.name, e
                        ),
                    )),
                )
                    .into_response());
            }
        }
    }

    Ok(MetaHttpResponse::ok(FN_SUCCESS))
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
                    .contains(&format!("function:{}", &function.name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("function:_all_{org_id}"))
            {
                result.push(function);
            }
        }

        Ok(MetaHttpResponse::json(FunctionList { list: result }))
    } else {
        Ok(MetaHttpResponse::json(FunctionList { list: vec![] }))
    }
}

pub async fn delete_function(org_id: &str, fn_name: &str) -> Result<(), FunctionDeleteError> {
    let existing_fn = match check_existing_fn(org_id, fn_name).await {
        Some(function) => function,
        None => {
            return Err(FunctionDeleteError::NotFound);
        }
    };
    // TODO(taiming): Function Stream Association to be deprecated starting v0.13.1.
    // remove this check after migrating functions to its dedicated table
    if let Some(val) = existing_fn.streams
        && !val.is_empty()
    {
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
            return Err(FunctionDeleteError::FunctionInUse(format!(
                "{FN_IN_USE} {names}"
            )));
        }
    }
    let pipeline_dep = get_dependencies(org_id, fn_name).await;
    if !pipeline_dep.is_empty() {
        let pipeline_data = serde_json::to_string(&pipeline_dep).unwrap_or("[]".to_string());
        return Err(FunctionDeleteError::PipelineDependencies(format!(
            "Warning: Function '{}' has {} pipeline dependencies. Please remove these pipelines first: {}",
            fn_name,
            pipeline_dep.len(),
            pipeline_data
        )));
    }
    let result = db::functions::delete(org_id, fn_name).await;
    match result {
        Ok(_) => {
            remove_ownership(org_id, "functions", Authz::new(fn_name)).await;
            Ok(())
        }
        Err(_) => Err(FunctionDeleteError::NotFound),
    }
}

pub async fn get_pipeline_dependencies(
    org_id: &str,
    func_name: &str,
) -> Result<HttpResponse, Error> {
    let list = get_dependencies(org_id, func_name).await;
    Ok(MetaHttpResponse::json(PipelineDependencyResponse { list }))
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
    // For both VRL (0) and JS (1), extract from params field
    // JS doesn't use Lua-style function(args) syntax
    let params = func.params.to_owned();
    if params.trim().is_empty() {
        func.num_args = 0;
    } else {
        func.num_args = params
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .count() as u8;
    }
}

async fn check_existing_fn(org_id: &str, fn_name: &str) -> Option<Transform> {
    (db::functions::get(org_id, fn_name).await).ok()
}

#[cfg(test)]
mod tests {
    use config::meta::{function::StreamOrder, stream::StreamType};

    use super::*;

    #[tokio::test]
    async fn test_functions() {
        // Test JavaScript function in _meta org (only org where JS is allowed)
        let mut trans = Transform {
            function: "row.square = row.Year * row.Year;".to_owned(),
            name: "dummyfn".to_owned(),
            params: "row".to_owned(),
            streams: None,
            num_args: 0,
            trans_type: Some(1), // JS function
        };

        let mut vrl_trans = Transform {
            name: "vrl_trans".to_owned(),
            function: ". = parse_aws_vpc_flow_log!(row.message) \n .".to_owned(),
            trans_type: Some(0), // VRL function
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

        // Use _meta org for JavaScript function (restriction)
        let res = save_function("_meta".to_string(), trans).await;
        assert!(res.is_ok());

        let list_resp = list_functions("_meta".to_string(), None).await;
        assert!(list_resp.is_ok());

        assert!(delete_function("_meta", "dummyfn").await.is_ok());
    }

    #[tokio::test]
    async fn validate_test_function_processing() {
        use http_body_util::BodyExt;
        use serde_json::json;

        let org_id = "test_org";
        let function = r#"
        . = {
            "new_field": "new_value",
            "nested": {
                "key": 42
            }
        }
        .
    "#
        .to_string();

        let events = vec![json!({
            "original_field": "original_value"
        })];

        let response = test_run_function(org_id, function, events, Some(0))
            .await
            .unwrap(); // VRL function
        assert_eq!(response.status(), http::StatusCode::OK);

        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: TestVRLResponse = serde_json::from_slice(&body_bytes).unwrap();

        // Validate transformed events
        assert_eq!(body.results.len(), 1);
        assert_eq!(body.results[0].message, "");
        assert_eq!(
            body.results[0].event,
            json! {{"nested_key":42,"new_field":"new_value"}}
        );
    }

    #[tokio::test]
    async fn test_js_function_allowed_in_meta_org() {
        use serde_json::json;

        let org_id = "_meta";
        let function = "function transform(row) { row.processed = true; return row; }".to_string();
        let events = vec![json!({"field": "value"})];
        let trans_type = Some(1); // JavaScript

        let response = test_run_function(org_id, function, events, trans_type)
            .await
            .unwrap();

        // JavaScript functions should be allowed in _meta org
        assert_eq!(response.status(), http::StatusCode::OK);
    }

    #[tokio::test]
    async fn test_js_function_blocked_in_regular_org() {
        use http_body_util::BodyExt;
        use serde_json::json;

        let org_id = "default";
        let function = "function transform(row) { row.processed = true; return row; }".to_string();
        let events = vec![json!({"field": "value"})];
        let trans_type = Some(1); // JavaScript

        let response = test_run_function(org_id, function, events, trans_type)
            .await
            .unwrap();

        // JavaScript functions should be blocked in non-_meta orgs
        assert_eq!(response.status(), http::StatusCode::BAD_REQUEST);

        // Verify error message
        let body_bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(
            body_str.contains("JavaScript functions are only allowed in the '_meta' organization")
        );
    }

    #[tokio::test]
    async fn test_save_js_function_allowed_in_meta_org() {
        let org_id = "_meta";
        let function = Transform {
            name: "test_js_fn".to_owned(),
            function: "function transform(row) { return row; }".to_owned(),
            params: "row".to_owned(),
            trans_type: Some(1), // JavaScript
            num_args: 1,
            streams: None,
        };

        let response = save_function(org_id.to_string(), function).await;

        // JavaScript functions should be allowed in _meta org
        assert!(response.is_ok());
        let resp = response.unwrap();
        assert_eq!(resp.status(), http::StatusCode::OK);

        // Clean up
        let _ = delete_function(org_id, "test_js_fn").await;
    }

    #[tokio::test]
    async fn test_save_js_function_blocked_in_regular_org() {
        let org_id = "default";
        let function = Transform {
            name: "test_js_fn_blocked".to_owned(),
            function: "function transform(row) { return row; }".to_owned(),
            params: "row".to_owned(),
            trans_type: Some(1), // JavaScript
            num_args: 1,
            streams: None,
        };

        let response = save_function(org_id.to_string(), function).await;

        // JavaScript functions should be blocked in non-_meta orgs
        assert!(response.is_ok());
        let resp = response.unwrap();
        assert_eq!(resp.status(), http::StatusCode::BAD_REQUEST);

        // Verify error message
        use http_body_util::BodyExt;
        let body_bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
        assert!(
            body_str.contains("JavaScript functions are only allowed in the '_meta' organization")
        );
    }

    #[tokio::test]
    async fn test_vrl_function_allowed_in_all_orgs() {
        use serde_json::json;

        // Test VRL in regular org
        let org_id = "default";
        let function = ". = {\"processed\": true}".to_string();
        let events = vec![json!({"field": "value"})];
        let trans_type = Some(0); // VRL

        let response = test_run_function(org_id, function.clone(), events.clone(), trans_type)
            .await
            .unwrap();

        assert_eq!(response.status(), http::StatusCode::OK);

        // Test VRL in _meta org
        let meta_response = test_run_function("_meta", function, events, trans_type)
            .await
            .unwrap();

        assert_eq!(meta_response.status(), http::StatusCode::OK);
    }
}
