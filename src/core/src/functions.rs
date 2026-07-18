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

use std::{error::Error, fmt};

use config::{
    meta::{
        function::{FunctionList, RESULT_ARRAY, TestVRLResponse, Transform},
        pipeline::{PipelineDependencyItem, PipelineDependencyResponse},
    },
    utils::json::Value,
};
use transform::{compile_vrl_function, js::compile_js_function};

use crate::{
    common::{
        meta::authz::Authz,
        utils::auth::{remove_ownership, set_ownership},
    },
    db,
};

mod transform_test;

const FN_IN_USE: &str =
    "Function is associated with streams, please remove association from streams before deleting:";

#[derive(Debug)]
pub enum FunctionError {
    NameEmpty,
    BodyEmpty,
    JavaScriptRestricted,
    AlreadyExists,
    NotFound,
    InvalidTransformType,
    Compilation(String),
    Storage(String),
    AssociatedPipelineUpdate {
        pipeline_id: String,
        pipeline_name: String,
        message: String,
    },
    TestRun(String),
}

impl fmt::Display for FunctionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NameEmpty => formatter.write_str("Function name cannot be empty"),
            Self::BodyEmpty => formatter.write_str("Function body cannot be empty"),
            Self::JavaScriptRestricted => formatter.write_str(
                "JavaScript functions are only allowed in the '_meta' organization. Please use VRL functions for other organizations.",
            ),
            Self::AlreadyExists => formatter.write_str("Function already exist"),
            Self::NotFound => formatter.write_str("Function not found"),
            Self::InvalidTransformType => {
                formatter.write_str("Invalid transform type. Use 0 for VRL or 1 for JS.")
            }
            Self::Compilation(message) | Self::Storage(message) | Self::TestRun(message) => {
                formatter.write_str(message)
            }
            Self::AssociatedPipelineUpdate {
                pipeline_id,
                pipeline_name,
                message,
            } => write!(
                formatter,
                "Failed to update associated pipeline({pipeline_id}/{pipeline_name}): {message}"
            ),
        }
    }
}

impl Error for FunctionError {}

#[derive(Debug, PartialEq)]
pub enum FunctionUpdateResult {
    Saved,
    Unchanged(Transform),
}

#[derive(Debug)]
pub enum FunctionDeleteError {
    NotFound,
    FunctionInUse(String),
    PipelineDependencies(String),
}

pub async fn save_function(org_id: String, mut func: Transform) -> Result<(), FunctionError> {
    if func.name.is_empty() {
        return Err(FunctionError::NameEmpty);
    }
    if func.function.is_empty() {
        return Err(FunctionError::BodyEmpty);
    }
    let func_trans_type = func.trans_type.unwrap_or(0);

    // JavaScript functions are only allowed in _meta org (for SSO claim parsing)
    if func_trans_type == 1 && org_id != "_meta" {
        return Err(FunctionError::JavaScriptRestricted);
    }

    if let Some(_existing_fn) = check_existing_fn(&org_id, &func.name).await {
        Err(FunctionError::AlreadyExists)
    } else {
        // Only append "." for VRL functions, not JS
        if func_trans_type == 0 && !func.function.ends_with('.') {
            func.function = format!("{} \n .", func.function);
        }
        // Validate function based on type
        match func_trans_type {
            0 => {
                // VRL function
                if let Err(e) = compile_vrl_function(func.function.as_str(), &org_id) {
                    return Err(FunctionError::Compilation(e.to_string()));
                }
            }
            1 => {
                // JS function
                if let Err(e) = compile_js_function(func.function.as_str(), &org_id) {
                    return Err(FunctionError::Compilation(e.to_string()));
                }
            }
            _ => {
                return Err(FunctionError::InvalidTransformType);
            }
        }
        extract_num_args(&mut func);
        catalog::functions::set(&org_id, &func.name, &func)
            .await
            .map_err(|error| FunctionError::Storage(error.to_string()))?;
        set_ownership(&org_id, "functions", Authz::new(&func.name)).await;

        Ok(())
    }
}

#[tracing::instrument(skip(org_id, function, trans_type))]
pub async fn test_run_function(
    org_id: &str,
    function: String,
    events: Vec<Value>,
    trans_type: Option<u8>,
) -> Result<TestVRLResponse, FunctionError> {
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
        return Err(FunctionError::JavaScriptRestricted);
    }

    transform_test::run(org_id, function, events, trans_type)
        .await
        .map_err(|error| FunctionError::TestRun(error.to_string()))
}

#[tracing::instrument(skip(func))]
pub async fn update_function(
    org_id: &str,
    fn_name: &str,
    mut func: Transform,
) -> Result<FunctionUpdateResult, FunctionError> {
    if func.name.is_empty() {
        return Err(FunctionError::NameEmpty);
    }
    if func.function.is_empty() {
        return Err(FunctionError::BodyEmpty);
    }

    let existing_fn = match check_existing_fn(org_id, fn_name).await {
        Some(function) => function,
        None => {
            return Err(FunctionError::NotFound);
        }
    };

    let func_trans_type = func.trans_type.unwrap_or(0);

    // JavaScript functions are only allowed in _meta org (for SSO claim parsing)
    if func_trans_type == 1 && org_id != "_meta" {
        return Err(FunctionError::JavaScriptRestricted);
    }

    if func == existing_fn {
        return Ok(FunctionUpdateResult::Unchanged(func));
    }

    // Only append "." for VRL functions, not JS
    if func_trans_type == 0 && !func.function.ends_with('.') {
        func.function = format!("{} \n .", func.function);
    }
    // Validate function based on type
    match func_trans_type {
        0 => {
            // VRL function
            if let Err(e) = compile_vrl_function(&func.function, org_id) {
                return Err(FunctionError::Compilation(e.to_string()));
            }
        }
        1 => {
            // JS function
            if let Err(e) = compile_js_function(&func.function, org_id) {
                return Err(FunctionError::Compilation(e.to_string()));
            }
        }
        _ => {
            return Err(FunctionError::InvalidTransformType);
        }
    }
    extract_num_args(&mut func);
    catalog::functions::set(org_id, &func.name, &func)
        .await
        .map_err(|error| FunctionError::Storage(error.to_string()))?;

    // update associated pipelines
    if let Ok(associated_pipelines) = db::pipeline::list_by_org(org_id).await {
        for pipeline in associated_pipelines {
            if pipeline.contains_function(&func.name)
                && let Err(e) = db::pipeline::update(&pipeline, None).await
            {
                return Err(FunctionError::AssociatedPipelineUpdate {
                    pipeline_id: pipeline.id,
                    pipeline_name: pipeline.name,
                    message: e.to_string(),
                });
            }
        }
    }

    Ok(FunctionUpdateResult::Saved)
}

pub async fn list_functions(org_id: String, permitted: Option<Vec<String>>) -> FunctionList {
    if let Ok(functions) = catalog::functions::list(&org_id).await {
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
                    .contains(&format!("function:_all_{org_id}"))
            {
                result.push(function);
            }
        }

        FunctionList { list: result }
    } else {
        FunctionList { list: vec![] }
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
    let result = catalog::functions::delete(org_id, fn_name).await;
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
) -> PipelineDependencyResponse {
    let list = get_dependencies(org_id, func_name).await;
    PipelineDependencyResponse { list }
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
    (catalog::functions::get(org_id, fn_name).await).ok()
}

#[cfg(test)]
mod tests {
    use config::meta::{function::StreamOrder, stream::StreamType};

    use super::*;

    #[test]
    fn extracts_function_arguments() {
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
    }

    #[tokio::test]
    async fn validate_test_function_processing() {
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

        // Validate transformed events
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].message, "");
        assert_eq!(
            response.results[0].event,
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

        // JavaScript functions should be allowed in _meta org
        assert!(
            test_run_function(org_id, function, events, trans_type)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn test_js_function_blocked_in_regular_org() {
        use serde_json::json;

        let org_id = "default";
        let function = "function transform(row) { row.processed = true; return row; }".to_string();
        let events = vec![json!({"field": "value"})];
        let trans_type = Some(1); // JavaScript

        // JavaScript functions should be blocked in non-_meta orgs
        assert!(matches!(
            test_run_function(org_id, function, events, trans_type).await,
            Err(FunctionError::JavaScriptRestricted)
        ));
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
        assert!(matches!(response, Err(FunctionError::JavaScriptRestricted)));
    }

    #[tokio::test]
    async fn test_vrl_function_allowed_in_all_orgs() {
        use serde_json::json;

        // Test VRL in regular org
        let org_id = "default";
        let function = ". = {\"processed\": true}".to_string();
        let events = vec![json!({"field": "value"})];
        let trans_type = Some(0); // VRL

        let response =
            test_run_function(org_id, function.clone(), events.clone(), trans_type).await;

        assert!(response.is_ok());

        // Test VRL in _meta org
        let meta_response = test_run_function("_meta", function, events, trans_type).await;

        assert!(meta_response.is_ok());
    }
}
