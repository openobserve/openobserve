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

//! Layer 1: JSON Schema validation for v8 dashboards.
//! Uses the same dashboard-v8.schema.json file as the FE (ajv).
//!
//! Note: The schema contains custom keywords (uniqueTabIds, validateFunctionArgs, etc.)
//! that the jsonschema crate will ignore. Those are handled by native.rs (Layer 2).

use std::sync::LazyLock as Lazy;

use serde_json::Value;

/// The JSON Schema for v8 dashboards.
/// Loaded once at startup via include_str! — same file used by FE.
static SCHEMA_V8: Lazy<jsonschema::Validator> = Lazy::new(|| {
    let schema_str = include_str!("../../../../../../schemas/dashboard-v8.schema.json");
    let schema_value: Value =
        serde_json::from_str(schema_str).expect("Invalid dashboard-v8.schema.json");
    jsonschema::validator_for(&schema_value).expect("Failed to compile dashboard JSON Schema")
});

/// Shared error messages — loaded from the SAME errorMessages.json used by FE.
static ERROR_MESSAGES: Lazy<Value> = Lazy::new(|| {
    let json_str = include_str!("../../../../../../schemas/errorMessages.json");
    serde_json::from_str(json_str).expect("Invalid errorMessages.json")
});

/// Validates dashboard JSON against the v8 JSON Schema.
/// Same schema file used by FE (ajv). Identical rules for the ~70% that schema can express.
pub fn validate(json: &Value) -> Vec<super::ValidationError> {
    SCHEMA_V8
        .iter_errors(json)
        .map(|e| {
            let path = e.instance_path.to_string();
            // Extract the terminal JSON Schema keyword from the schema path
            // (e.g. ".../minItems" -> "minItems"). This is stable across crate versions,
            // unlike format!("{:?}", e.kind) which relies on internal Debug repr.
            let schema_path_str = e.schema_path.to_string();
            let keyword = schema_path_str
                .split('/')
                .next_back()
                .unwrap_or("")
                .to_string();
            let message = map_error_message(&path, &keyword, &e.to_string(), json);
            super::ValidationError {
                path,
                message,
                code: "SCHEMA_VALIDATION".into(),
            }
        })
        .collect()
}

/// Maps raw jsonschema errors to user-friendly messages using errorMessages.json.
fn map_error_message(path: &str, keyword: &str, raw_message: &str, dashboard: &Value) -> String {
    // Extract panel info from path
    if let Some(info) = extract_panel_info(path, dashboard) {
        // Try chart-type specific messages
        let field = path.split('/').next_back().unwrap_or("");

        // Map JSON Schema keywords (lowercase) to our error key format.
        // keyword is the last segment of schema_path, e.g. "minItems", "required", "enum".
        let error_key = if keyword == "minItems" {
            format!("{}:minItems", field)
        } else if keyword == "maxItems" {
            format!("{}:maxItems", field)
        } else if keyword == "required" {
            // For required errors, instance_path points to the parent object, not the missing
            // property. Parse the property name from the error message instead.
            let prop = raw_message.split('"').nth(1).unwrap_or(field);
            format!("{}:required", prop)
        } else if keyword == "enum" {
            format!("{}:enum", field)
        } else if keyword == "minLength" {
            format!("{}:minLength", field)
        } else {
            String::new()
        };

        if !error_key.is_empty()
            && let Some(msg) = ERROR_MESSAGES
                .get("chartErrors")
                .and_then(|c| c.get(&info.chart_type))
                .and_then(|m| m.get(&error_key))
                .and_then(|v| v.as_str())
        {
            return msg.to_string();
        }

        // Panel structure errors
        if keyword == "enum" && path.ends_with("/type") {
            return format!("Panel {}: Chart type is not supported.", info.id);
        }
    }

    // Dashboard-level errors
    if (path.is_empty() || path == "/") && keyword == "required" && raw_message.contains("title") {
        return "Dashboard title is required".to_string();
    }

    if keyword == "minItems" && path.ends_with("/tabs") {
        return "Dashboard must have at least one tab".to_string();
    }

    // Fallback: use raw message
    raw_message.to_string()
}

struct PanelInfo {
    id: String,
    chart_type: String,
}

fn extract_panel_info(path: &str, dashboard: &Value) -> Option<PanelInfo> {
    let parts: Vec<&str> = path.split('/').collect();
    // Path format: /tabs/0/panels/1/...
    if parts.len() < 5 || parts.get(1)? != &"tabs" || parts.get(3)? != &"panels" {
        return None;
    }
    let tab_idx: usize = parts[2].parse().ok()?;
    let panel_idx: usize = parts[4].parse().ok()?;

    let panel = dashboard
        .get("tabs")?
        .get(tab_idx)?
        .get("panels")?
        .get(panel_idx)?;

    Some(PanelInfo {
        id: panel
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("unknown")
            .to_string(),
        chart_type: panel
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_validate_valid_dashboard() {
        let json_str = include_str!("../../../../../../test-fixtures/valid/minimal-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_validate_missing_title() {
        let json_str = include_str!("../../../../../../test-fixtures/invalid/missing-title.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(!errors.is_empty());
        assert!(
            errors
                .iter()
                .any(|e| e.message.contains("title") || e.message.contains("required"))
        );
    }

    #[test]
    fn test_validate_invalid_chart_type() {
        let json_str =
            include_str!("../../../../../../test-fixtures/invalid/invalid-chart-type.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(!errors.is_empty());
    }

    #[test]
    fn test_validate_promql_dashboard() {
        let json_str = include_str!("../../../../../../test-fixtures/valid/promql-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_validate_maps_dashboard() {
        let json_str =
            include_str!("../../../../../../test-fixtures/valid/maps-custom-query-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(errors.is_empty(), "Expected no errors, got: {:?}", errors);
    }

    #[test]
    fn test_validate_empty_object() {
        let json = json!({});
        let errors = validate(&json);
        // Should have schema errors (missing required fields)
        assert!(!errors.is_empty());
    }

    #[test]
    fn test_validate_error_has_schema_validation_code() {
        let json = json!({});
        let errors = validate(&json);
        assert!(errors.iter().all(|e| e.code == "SCHEMA_VALIDATION"));
    }

    #[test]
    fn test_extract_panel_info_valid_path() {
        let dashboard = json!({
            "tabs": [{
                "panels": [{
                    "id": "panel-1",
                    "type": "line"
                }]
            }]
        });
        let info = extract_panel_info("/tabs/0/panels/0/queries", &dashboard);
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.id, "panel-1");
        assert_eq!(info.chart_type, "line");
    }

    #[test]
    fn test_extract_panel_info_short_path() {
        let dashboard = json!({"tabs": []});
        let info = extract_panel_info("/tabs/0", &dashboard);
        assert!(info.is_none());
    }

    #[test]
    fn test_extract_panel_info_wrong_structure() {
        let dashboard = json!({"tabs": []});
        let info = extract_panel_info("/foo/0/bar/0/baz", &dashboard);
        assert!(info.is_none());
    }

    #[test]
    fn test_extract_panel_info_invalid_index() {
        let dashboard = json!({"tabs": [{"panels": []}]});
        let info = extract_panel_info("/tabs/0/panels/99/field", &dashboard);
        assert!(info.is_none());
    }

    #[test]
    fn test_extract_panel_info_missing_id() {
        let dashboard = json!({
            "tabs": [{
                "panels": [{"type": "bar"}]
            }]
        });
        let info = extract_panel_info("/tabs/0/panels/0/queries", &dashboard);
        assert!(info.is_some());
        assert_eq!(info.unwrap().id, "unknown");
    }

    #[test]
    fn test_map_error_message_dashboard_title_required() {
        let msg = map_error_message(
            "",
            "required",
            "\"title\" is a required property",
            &json!({}),
        );
        assert_eq!(msg, "Dashboard title is required");
    }

    #[test]
    fn test_map_error_message_root_slash_title_required() {
        let msg = map_error_message(
            "/",
            "required",
            "\"title\" is a required property",
            &json!({}),
        );
        assert_eq!(msg, "Dashboard title is required");
    }

    #[test]
    fn test_map_error_message_tabs_min_items() {
        let msg = map_error_message("/tabs", "minItems", "raw error text", &json!({}));
        assert_eq!(msg, "Dashboard must have at least one tab");
    }

    #[test]
    fn test_map_error_message_panel_unsupported_chart_type() {
        let dashboard = json!({
            "tabs": [{
                "panels": [{
                    "id": "p1",
                    "type": "invalid"
                }]
            }]
        });
        let msg = map_error_message("/tabs/0/panels/0/type", "enum", "raw error", &dashboard);
        assert!(msg.contains("Panel p1"));
        assert!(msg.contains("not supported"));
    }

    #[test]
    fn test_map_error_message_fallback() {
        let msg = map_error_message("/some/random/path", "unknown", "raw error text", &json!({}));
        assert_eq!(msg, "raw error text");
    }

    #[test]
    fn test_map_error_message_no_panel_context() {
        let msg = map_error_message("/description", "minLength", "raw error text", &json!({}));
        assert_eq!(msg, "raw error text");
    }

    #[test]
    fn test_validate_pie_wrong_fields() {
        let json_str =
            include_str!("../../../../../../test-fixtures/invalid/pie-wrong-fields.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate(&json);
        assert!(!errors.is_empty());
    }
}
