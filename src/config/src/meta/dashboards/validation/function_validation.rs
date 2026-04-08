// Copyright 2025 OpenObserve Inc.
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

//! Layer 2: Function argument validation driven by functionValidation.json.
//! Same logic as FE custom ajv keyword: validateFunctionArgs.
//! Same data file: schemas/functions/functionValidation.json.

use std::sync::LazyLock as Lazy;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionDef {
    pub function_name: Option<String>,
    #[serde(default)]
    pub args: Vec<ArgDef>,
    pub allow_add_arg_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ArgDef {
    #[serde(rename = "type")]
    pub types: Vec<ArgType>,
    #[serde(default)]
    pub required: Option<bool>,
    pub min: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct ArgType {
    pub value: String,
}

/// Load functionValidation.json once at startup — same file used by FE.
static FUNCTION_DEFS: Lazy<Vec<FunctionDef>> = Lazy::new(|| {
    let json_str =
        include_str!("../../../../../../schemas/functions/functionValidation.json");
    serde_json::from_str(json_str).expect("Invalid functionValidation.json")
});

/// Validates function args for all panels in the dashboard.
pub fn validate_all_function_args(
    dashboard: &Value,
    errors: &mut Vec<super::ValidationError>,
) {
    let tabs = match dashboard.get("tabs").and_then(|t| t.as_array()) {
        Some(tabs) => tabs,
        None => return,
    };

    for tab in tabs {
        let panels = tab.get("panels").and_then(|p| p.as_array());
        if let Some(panels) = panels {
            for panel in panels {
                let panel_type = panel.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if panel_type == "html" || panel_type == "markdown" {
                    continue;
                }

                let query_type =
                    panel.get("queryType").and_then(|q| q.as_str()).unwrap_or("");
                if query_type == "promql" || query_type == "promql-builder" {
                    continue;
                }

                let queries = panel.get("queries").and_then(|q| q.as_array());
                if let Some(queries) = queries {
                    for query in queries {
                        let is_custom = query
                            .get("customQuery")
                            .and_then(|c| c.as_bool())
                            .unwrap_or(false);
                        if is_custom {
                            continue;
                        }

                        let fields = match query.get("fields") {
                            Some(f) => f,
                            None => continue,
                        };

                        // Collect all field configs
                        let mut all_fields: Vec<&Value> = Vec::new();
                        for key in &["x", "y", "z", "breakdown"] {
                            if let Some(arr) = fields.get(*key).and_then(|a| a.as_array()) {
                                all_fields.extend(arr.iter());
                            }
                        }
                        for key in &[
                            "source",
                            "target",
                            "value",
                            "name",
                            "value_for_maps",
                            "latitude",
                            "longitude",
                        ] {
                            if let Some(field) = fields.get(*key) {
                                if !field.is_null() {
                                    all_fields.push(field);
                                }
                            }
                        }

                        // Filter out derived fields
                        let all_fields: Vec<&Value> = all_fields
                            .into_iter()
                            .filter(|f| {
                                !f.get("isDerived")
                                    .and_then(|d| d.as_bool())
                                    .unwrap_or(false)
                            })
                            .collect();

                        for field in all_fields {
                            let field_path = field
                                .get("alias")
                                .and_then(|a| a.as_str())
                                .unwrap_or("Field");
                            validate_function(field, field_path, errors);
                        }
                    }
                }
            }
        }
    }
}

/// Validates a single field's function configuration.
/// Same logic as FE validateFunction() in dashboardValidator.ts.
fn validate_function(
    func_config: &Value,
    field_path: &str,
    errors: &mut Vec<super::ValidationError>,
) {
    let field_type = func_config
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("");

    // Handle raw query fields
    if field_type == "raw" {
        let raw_query = func_config
            .get("rawQuery")
            .and_then(|r| r.as_str())
            .unwrap_or("");
        if raw_query.trim().is_empty() {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!("{}: Raw query cannot be empty", field_path),
                code: "RAW_QUERY_EMPTY".into(),
            });
        }
        return;
    }

    // Find function definition
    let func_name = func_config.get("functionName");
    let selected_fn = FUNCTION_DEFS.iter().find(|fd| match (&fd.function_name, func_name) {
        (None, None) => true,
        (None, Some(Value::Null)) => true,
        (Some(name), Some(Value::String(s))) => name == s,
        _ => false,
    });

    let selected_fn = match selected_fn {
        Some(f) => f,
        None => {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!("{}: Invalid aggregation function", field_path),
                code: "INVALID_FUNCTION".into(),
            });
            return;
        }
    };

    let args = func_config
        .get("args")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let args_def = &selected_fn.args;
    let has_variable_args = selected_fn.allow_add_arg_at.is_some();

    let variable_arg_position: i64 = if let Some(ref val) = selected_fn.allow_add_arg_at {
        if val == "n" {
            0
        } else if val.starts_with("n-") {
            let offset: i64 = val[2..].parse().unwrap_or(0);
            args_def.len() as i64 - offset
        } else {
            -1
        }
    } else {
        -1
    };

    // Min args check
    if let Some(min_def) = args_def.iter().find(|d| d.min.is_some()) {
        let min = min_def.min.unwrap_or(0);
        let min_position = args_def.iter().position(|d| d.min.is_some()).unwrap_or(0);
        let relevant_count =
            if has_variable_args && variable_arg_position <= min_position as i64 {
                args.len() as i64 - variable_arg_position + 1
            } else {
                args.len() as i64
            };
        if (relevant_count as usize) < min {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!("{}: Requires at least {} arguments", field_path, min),
                code: "MIN_ARGS".into(),
            });
        }
    }

    // Validate each arg
    for (index, arg) in args.iter().enumerate() {
        if arg.is_null() {
            continue;
        }

        let mut arg_def_index = index;
        if has_variable_args && index as i64 >= variable_arg_position {
            arg_def_index = variable_arg_position as usize;
        }
        if arg_def_index >= args_def.len() {
            if !has_variable_args {
                errors.push(super::ValidationError {
                    path: String::new(),
                    message: format!("{}: Too many arguments provided", field_path),
                    code: "TOO_MANY_ARGS".into(),
                });
                continue;
            }
            arg_def_index = variable_arg_position as usize;
        }

        let allowed_types: Vec<&str> = args_def[arg_def_index]
            .types
            .iter()
            .map(|t| t.value.as_str())
            .collect();

        let arg_type = arg.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if !allowed_types.contains(&arg_type) {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!(
                    "{}: Argument {} has invalid type (expected: {})",
                    field_path,
                    index + 1,
                    allowed_types.join(" or ")
                ),
                code: "INVALID_ARG_TYPE".into(),
            });
            continue;
        }

        match arg_type {
            "field" => {
                let has_field = arg
                    .get("value")
                    .and_then(|v| v.as_object())
                    .and_then(|o| o.get("field"))
                    .is_some();
                if !has_field {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "{}: Argument {} is a field but haven't selected any field",
                            field_path,
                            index + 1
                        ),
                        code: "FIELD_NOT_SELECTED".into(),
                    });
                }
            }
            "function" => match arg.get("value") {
                Some(nested) if nested.is_object() => {
                    let nested_path = format!("{} \u{2192} Arg {}", field_path, index + 1);
                    validate_function(nested, &nested_path, errors);
                }
                _ => {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "{}: Argument {} is a function but has invalid structure",
                            field_path,
                            index + 1
                        ),
                        code: "INVALID_FUNCTION_ARG".into(),
                    });
                }
            },
            "number" => {
                let is_valid = arg.get("value").map(|v| v.is_number()).unwrap_or(false);
                if !is_valid {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "{}: Argument {} must be a valid number",
                            field_path,
                            index + 1
                        ),
                        code: "INVALID_NUMBER".into(),
                    });
                }
            }
            "string" => {
                let is_valid = arg
                    .get("value")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                if !is_valid {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "{}: Argument {} must be a non-empty string",
                            field_path,
                            index + 1
                        ),
                        code: "INVALID_STRING".into(),
                    });
                }
            }
            "histogramInterval" => {
                let value = arg.get("value");
                let is_valid = value.is_none()
                    || value == Some(&Value::Null)
                    || value.and_then(|v| v.as_str()).is_some();
                if !is_valid {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "{}: Argument {} must be a valid histogram interval",
                            field_path,
                            index + 1
                        ),
                        code: "INVALID_HISTOGRAM_INTERVAL".into(),
                    });
                }
            }
            _ => {}
        }
    }

    // Check required args
    for (index, arg_def) in args_def.iter().enumerate() {
        if has_variable_args && index as i64 > variable_arg_position {
            break;
        }
        let is_required = arg_def.required.unwrap_or(false);
        if is_required && (index >= args.len() || args[index].is_null()) {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!(
                    "{}: Missing required argument at position {}",
                    field_path,
                    index + 1
                ),
                code: "MISSING_REQUIRED_ARG".into(),
            });
        }
    }
}
