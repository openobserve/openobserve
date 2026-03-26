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

use once_cell::sync::Lazy;
use serde_json::Value;

/// The JSON Schema for v8 dashboards.
/// Loaded once at startup via include_str! — same file used by FE.
static SCHEMA_V8: Lazy<jsonschema::Validator> = Lazy::new(|| {
    let schema_str = include_str!("../../../../../../../schemas/dashboard-v8.schema.json");
    let schema_value: Value =
        serde_json::from_str(schema_str).expect("Invalid dashboard-v8.schema.json");
    jsonschema::validator_for(&schema_value).expect("Failed to compile dashboard JSON Schema")
});

/// Shared error messages — loaded from the SAME errorMessages.json used by FE.
static ERROR_MESSAGES: Lazy<Value> = Lazy::new(|| {
    let json_str = include_str!("../../../../../../../schemas/errorMessages.json");
    serde_json::from_str(json_str).expect("Invalid errorMessages.json")
});

/// Validates dashboard JSON against the v8 JSON Schema.
/// Same schema file used by FE (ajv). Identical rules for the ~70% that schema can express.
pub fn validate(json: &Value) -> Vec<super::ValidationError> {
    let result = SCHEMA_V8.validate(json);
    match result {
        Ok(()) => vec![],
        Err(errors) => errors
            .map(|e| {
                let path = e.instance_path.to_string();
                let keyword = format!("{:?}", e.kind);
                let message = map_error_message(&path, &keyword, &e.to_string(), json);
                super::ValidationError {
                    path,
                    message,
                    code: "SCHEMA_VALIDATION".into(),
                }
            })
            .collect(),
    }
}

/// Maps raw jsonschema errors to user-friendly messages using errorMessages.json.
fn map_error_message(
    path: &str,
    keyword: &str,
    raw_message: &str,
    dashboard: &Value,
) -> String {
    // Extract panel info from path
    if let Some(info) = extract_panel_info(path, dashboard) {
        // Try chart-type specific messages
        let field = path.split('/').last().unwrap_or("");

        // Map jsonschema error kinds to our key format
        let error_key = if keyword.contains("MinItems") {
            format!("{}:minItems", field)
        } else if keyword.contains("MaxItems") {
            format!("{}:maxItems", field)
        } else if keyword.contains("Required") {
            // For required errors, the missing property is often in the raw message
            format!("{}:required", field)
        } else if keyword.contains("Enum") {
            format!("{}:enum", field)
        } else if keyword.contains("MinLength") {
            format!("{}:minLength", field)
        } else {
            String::new()
        };

        if !error_key.is_empty() {
            if let Some(msg) = ERROR_MESSAGES
                .get("chartErrors")
                .and_then(|c| c.get(&info.chart_type))
                .and_then(|m| m.get(&error_key))
                .and_then(|v| v.as_str())
            {
                return msg.to_string();
            }
        }

        // Panel structure errors
        if keyword.contains("Enum") && path.ends_with("/type") {
            return format!(
                "Panel {}: Chart type is not supported.",
                info.id
            );
        }
    }

    // Dashboard-level errors
    if path.is_empty() || path == "/" {
        if keyword.contains("Required") {
            if raw_message.contains("title") {
                return "Dashboard title is required".to_string();
            }
        }
    }

    if keyword.contains("MinItems") && path.ends_with("/tabs") {
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
