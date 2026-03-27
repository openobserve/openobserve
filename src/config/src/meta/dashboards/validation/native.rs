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

//! Layer 2: Native validation for rules that JSON Schema cannot express.
//! These MUST match the FE custom ajv keyword implementations exactly.
//! Shared test fixtures verify parity.

use std::collections::HashSet;

use serde_json::Value;

use super::function_validation;

/// Layer 2 validation entry point.
pub fn validate(json: &Value) -> Vec<super::ValidationError> {
    let mut errors = Vec::new();

    validate_unique_ids(json, &mut errors);
    validate_table_fields(json, &mut errors);
    validate_filter_conditions(json, &mut errors);
    function_validation::validate_all_function_args(json, &mut errors);

    errors
}

// --- Uniqueness checks ---
// Matches FE custom keywords: uniqueTabIds, uniquePanelIds, uniqueLayoutI

fn validate_unique_ids(dashboard: &Value, errors: &mut Vec<super::ValidationError>) {
    let tabs = match dashboard.get("tabs").and_then(|t| t.as_array()) {
        Some(tabs) => tabs,
        None => return,
    };

    let mut tab_ids = HashSet::new();
    let mut panel_ids = HashSet::new();

    for tab in tabs {
        if let Some(tab_id) = tab.get("tabId").and_then(|t| t.as_str())
            && !tab_ids.insert(tab_id.to_string())
        {
            errors.push(super::ValidationError {
                path: String::new(),
                message: format!("Duplicate tab ID found: {}", tab_id),
                code: "DUPLICATE_TAB_ID".into(),
            });
        }

        let panels = tab.get("panels").and_then(|p| p.as_array());
        let mut layout_is = HashSet::new();

        if let Some(panels) = panels {
            for panel in panels {
                if let Some(panel_id) = panel.get("id").and_then(|i| i.as_str())
                    && !panel_ids.insert(panel_id.to_string())
                {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!("Duplicate panel ID found: {}", panel_id),
                        code: "DUPLICATE_PANEL_ID".into(),
                    });
                }

                if let Some(layout_i) = panel
                    .get("layout")
                    .and_then(|l| l.get("i"))
                    .map(|i| i.to_string())
                {
                    let tab_id = tab.get("tabId").and_then(|t| t.as_str()).unwrap_or("");
                    if !layout_is.insert(layout_i.clone()) {
                        errors.push(super::ValidationError {
                            path: String::new(),
                            message: format!(
                                "Duplicate layout.i value in tab {}: {}",
                                tab_id, layout_i
                            ),
                            code: "DUPLICATE_LAYOUT_I".into(),
                        });
                    }
                }
            }
        }
    }
}

// --- Table chart cross-field check ---
// Matches FE custom keyword: tableMinFields

fn validate_table_fields(dashboard: &Value, errors: &mut Vec<super::ValidationError>) {
    let tabs = match dashboard.get("tabs").and_then(|t| t.as_array()) {
        Some(tabs) => tabs,
        None => return,
    };

    for tab in tabs {
        let panels = tab.get("panels").and_then(|p| p.as_array());
        if let Some(panels) = panels {
            for panel in panels {
                let panel_type = panel.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if panel_type != "table" {
                    continue;
                }

                let query = match panel.get("queries").and_then(|q| q.get(0)) {
                    Some(q) => q,
                    None => continue,
                };

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

                let x_len = fields
                    .get("x")
                    .and_then(|x| x.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                let y_len = fields
                    .get("y")
                    .and_then(|y| y.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);

                if x_len + y_len == 0 {
                    let panel_id = panel
                        .get("id")
                        .and_then(|i| i.as_str())
                        .unwrap_or("unknown");
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "Panel {}: Add at least one field on First Column or Other Columns",
                            panel_id
                        ),
                        code: "TABLE_EMPTY_FIELDS".into(),
                    });
                }
            }
        }
    }
}

// --- Filter operator-dependent value check ---
// Matches FE custom keyword: validateFilterValues

fn validate_filter_conditions(dashboard: &Value, errors: &mut Vec<super::ValidationError>) {
    let tabs = match dashboard.get("tabs").and_then(|t| t.as_array()) {
        Some(tabs) => tabs,
        None => return,
    };

    for tab in tabs {
        let panels = tab.get("panels").and_then(|p| p.as_array());
        if let Some(panels) = panels {
            for panel in panels {
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

                        if let Some(conditions) = query
                            .get("fields")
                            .and_then(|f| f.get("filter"))
                            .and_then(|f| f.get("conditions"))
                            .and_then(|c| c.as_array())
                        {
                            validate_conditions_recursive(conditions, errors);
                        }
                    }
                }
            }
        }
    }
}

fn validate_conditions_recursive(conditions: &[Value], errors: &mut Vec<super::ValidationError>) {
    for condition in conditions {
        let filter_type = condition
            .get("filterType")
            .and_then(|f| f.as_str())
            .unwrap_or("");

        if filter_type == "group" {
            if let Some(nested) = condition.get("conditions").and_then(|c| c.as_array()) {
                validate_conditions_recursive(nested, errors);
            }
        } else if filter_type == "condition" {
            let cond_type = condition.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let column = condition
                .get("column")
                .and_then(|c| c.get("field").and_then(|f| f.as_str()))
                .or_else(|| condition.get("column").and_then(|c| c.as_str()))
                .unwrap_or("unknown");

            if cond_type == "list" {
                let values_len = condition
                    .get("values")
                    .and_then(|v| v.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                if values_len == 0 {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!(
                            "Filter: {}: Select at least 1 item from the list",
                            column
                        ),
                        code: "FILTER_LIST_EMPTY".into(),
                    });
                }
            }

            if cond_type == "condition" {
                let operator = condition.get("operator").and_then(|o| o.as_str());
                if operator.is_none() {
                    errors.push(super::ValidationError {
                        path: String::new(),
                        message: format!("Filter: {}: Operator selection required", column),
                        code: "FILTER_MISSING_OPERATOR".into(),
                    });
                }

                let is_null_op = matches!(operator, Some("Is Null") | Some("Is Not Null"));
                if !is_null_op {
                    let value = condition.get("value");
                    let is_empty = value.is_none()
                        || value == Some(&Value::Null)
                        || value.and_then(|v| v.as_str()) == Some("");
                    if is_empty {
                        errors.push(super::ValidationError {
                            path: String::new(),
                            message: format!("Filter: {}: Condition value required", column),
                            code: "FILTER_MISSING_VALUE".into(),
                        });
                    }
                }
            }
        }
    }
}
