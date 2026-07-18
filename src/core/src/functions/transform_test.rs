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

//! Domain use case for compiling and testing transforms against sample events.

use std::{error::Error, fmt};

use config::{
    meta::function::{RESULT_ARRAY, TestVRLResponse, VRLResult, VRLResultResolver},
    utils::json::Value,
};
use transform::{
    apply_vrl_fn, compile_vrl_function, init_vrl_runtime,
    js::{apply_js_fn, compile_js_function},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FunctionTestError(String);

impl FunctionTestError {
    fn new(message: impl ToString) -> Self {
        Self(message.to_string())
    }
}

impl fmt::Display for FunctionTestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for FunctionTestError {}

pub async fn run(
    org_id: &str,
    function: String,
    events: Vec<Value>,
    trans_type: u8,
) -> Result<TestVRLResponse, FunctionTestError> {
    match trans_type {
        0 => run_vrl(org_id, function, events),
        1 => run_js(org_id, function, events),
        _ => Err(FunctionTestError::new(
            "Invalid transform type. Use 0 for VRL or 1 for JS.",
        )),
    }
}

fn run_vrl(
    org_id: &str,
    mut function: String,
    events: Vec<Value>,
) -> Result<TestVRLResponse, FunctionTestError> {
    if !function.ends_with('.') {
        function = format!("{function} \n .");
    }

    let apply_over_hits = RESULT_ARRAY.is_match(&function);
    let runtime_config = compile_vrl_function(&function, org_id).map_err(FunctionTestError::new)?;
    let registry = runtime_config
        .config
        .get_custom::<vector_enrichment::TableRegistry>()
        .expect("VRL compiler config must include an enrichment table registry");
    registry.finish_load();

    let mut runtime = init_vrl_runtime();
    let resolver = VRLResultResolver {
        program: runtime_config.program,
        fields: runtime_config.fields,
    };
    let mut transformed_events = vec![];

    if apply_over_hits {
        let (ret_val, error) = apply_vrl_fn(
            &mut runtime,
            &resolver,
            Value::Array(events),
            org_id,
            &[String::new()],
        );
        if let Some(error) = error {
            return Err(FunctionTestError::new(error));
        }

        if let Some(records) = ret_val.as_array() {
            for record in records {
                match record {
                    Value::Object(hit) => transformed_events.push(VRLResult::new(
                        "",
                        config::utils::flatten::flatten(Value::Object(hit.clone()))
                            .unwrap_or_else(|_| Value::Object(hit.clone())),
                    )),
                    Value::Array(hits) => {
                        for hit in hits {
                            if let Value::Object(hit) = hit {
                                transformed_events.push(VRLResult::new(
                                    "",
                                    config::utils::flatten::flatten(Value::Object(hit.clone()))
                                        .unwrap_or_else(|_| Value::Object(hit.clone())),
                                ));
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    } else {
        for event in events {
            let (ret_val, error) = apply_vrl_fn(
                &mut runtime,
                &resolver,
                event.clone(),
                org_id,
                &[String::new()],
            );
            if let Some(error) = error {
                transformed_events.push(VRLResult::new(&error, event));
                continue;
            }

            let transform = if !ret_val.is_null() && ret_val.is_object() {
                config::utils::flatten::flatten(ret_val)
                    .unwrap_or_else(|_| Value::String(String::new()))
            } else {
                Value::String(String::new())
            };
            transformed_events.push(VRLResult::new("", transform));
        }
    }

    Ok(TestVRLResponse {
        results: transformed_events,
    })
}

fn run_js(
    org_id: &str,
    function: String,
    events: Vec<Value>,
) -> Result<TestVRLResponse, FunctionTestError> {
    let apply_over_array = RESULT_ARRAY.is_match(&function);
    let js_config = compile_js_function(&function, org_id).map_err(FunctionTestError::new)?;
    let mut transformed_events = vec![];

    if apply_over_array {
        let (ret_val, error) =
            apply_js_fn(&js_config, Value::Array(events), org_id, &[String::new()]);

        if let Some(error) = error {
            transformed_events.push(VRLResult::new(&error, Value::Null));
        } else if let Some(result_array) = ret_val.as_array() {
            for item in result_array {
                let transform = if item.is_object() {
                    config::utils::flatten::flatten(item.clone())
                        .unwrap_or_else(|_| Value::String(String::new()))
                } else {
                    item.clone()
                };
                transformed_events.push(VRLResult::new("", transform));
            }
        } else {
            let transform = if ret_val.is_object() {
                config::utils::flatten::flatten(ret_val)
                    .unwrap_or_else(|_| Value::String(String::new()))
            } else {
                ret_val
            };
            transformed_events.push(VRLResult::new("", transform));
        }
    } else {
        for event in events {
            let (ret_val, error) = apply_js_fn(&js_config, event.clone(), org_id, &[String::new()]);

            if let Some(error) = error {
                transformed_events.push(VRLResult::new(&error, event));
            } else {
                let transform = if !ret_val.is_null() && ret_val.is_object() {
                    config::utils::flatten::flatten(ret_val)
                        .unwrap_or_else(|_| Value::String(String::new()))
                } else {
                    Value::String(String::new())
                };
                transformed_events.push(VRLResult::new("", transform));
            }
        }
    }

    Ok(TestVRLResponse {
        results: transformed_events,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn runs_vrl_without_http_types() {
        let response = run(
            "default",
            ".answer = 42".to_string(),
            vec![json!({"message": "hello"})],
            0,
        )
        .await
        .unwrap();

        assert_eq!(response.results[0].event["answer"], 42);
    }

    #[tokio::test]
    async fn rejects_unknown_transform_type() {
        let error = run("default", ".".to_string(), vec![], 9)
            .await
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Invalid transform type. Use 0 for VRL or 1 for JS."
        );
    }
}
