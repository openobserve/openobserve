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

pub mod function_validation;
pub mod native;
pub mod schema;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize, Clone)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
    pub code: String,
}

/// Main validation entry point called by API handler.
/// Runs Layer 1 (JSON Schema) + Layer 2 (native checks).
/// Returns empty vec if dashboard is valid.
pub fn validate_dashboard(json: &Value) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    // Layer 1: JSON Schema validation
    errors.extend(schema::validate(json));

    // Layer 2: Native checks (uniqueness, function args, table, filter)
    errors.extend(native::validate(json));

    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_minimal_dashboard() {
        let json_str = include_str!("../../../../../../test-fixtures/valid/minimal-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(
            errors.is_empty(),
            "Expected valid dashboard, got errors: {:?}",
            errors
        );
    }

    #[test]
    fn test_invalid_missing_title() {
        let json_str = include_str!("../../../../../../test-fixtures/invalid/missing-title.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(
            !errors.is_empty(),
            "Expected errors for missing title dashboard"
        );
    }

    #[test]
    fn test_invalid_chart_type() {
        let json_str =
            include_str!("../../../../../../test-fixtures/invalid/invalid-chart-type.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(!errors.is_empty(), "Expected errors for invalid chart type");
    }

    #[test]
    fn test_valid_maps_custom_query() {
        let json_str =
            include_str!("../../../../../../test-fixtures/valid/maps-custom-query-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(
            errors.is_empty(),
            "Expected valid maps dashboard, got errors: {:?}",
            errors
        );
    }

    #[test]
    fn test_maps_panel_roundtrip_validation() {
        // Simulate what the backend does: deserialize into v8 structs, re-serialize, validate
        use crate::meta::dashboards::v8;

        let json_str =
            include_str!("../../../../../../test-fixtures/valid/maps-custom-query-dashboard.json");
        let dashboard: v8::Dashboard = serde_json::from_str(json_str).unwrap();

        // Re-serialize (this is what the backend does before validation)
        let re_serialized = serde_json::to_value(&dashboard).unwrap();

        // Check that the panel type round-trips correctly
        let panel_type = re_serialized
            .get("tabs")
            .and_then(|t| t.get(0))
            .and_then(|t| t.get("panels"))
            .and_then(|p| p.get(0))
            .and_then(|p| p.get("type"))
            .and_then(|t| t.as_str())
            .unwrap();
        assert_eq!(panel_type, "maps", "Panel type should round-trip as 'maps'");

        let errors = validate_dashboard(&re_serialized);
        assert!(
            errors.is_empty(),
            "Expected valid maps dashboard after round-trip, got errors: {:?}",
            errors
        );
    }

    #[test]
    fn test_html_panel_empty_query_type_roundtrip() {
        // The FE sends queryType: "" for HTML panels — the backend must accept it.
        use crate::meta::dashboards::v8;

        let json_str = r#"{
            "dashboardId": "test-html",
            "title": "HTML Test",
            "version": 8,
            "description": "",
            "tabs": [{
                "tabId": "tab-1",
                "name": "Default",
                "panels": [{
                    "id": "panel-1",
                    "type": "html",
                    "title": "Test",
                    "description": "",
                    "htmlContent": "<h1>Hello</h1>",
                    "queryType": "",
                    "layout": { "x": 0, "y": 0, "w": 96, "h": 20, "i": 1 },
                    "queries": [{
                        "query": "",
                        "customQuery": false,
                        "fields": {
                            "stream": "",
                            "stream_type": "logs",
                            "x": [], "y": [], "z": [],
                            "filter": {
                                "filterType": "group",
                                "logicalOperator": "AND",
                                "conditions": []
                            }
                        },
                        "config": { "promql_legend": "" }
                    }],
                    "config": { "show_legends": true }
                }]
            }]
        }"#;

        // Must deserialize without error
        let dashboard: v8::Dashboard = serde_json::from_str(json_str)
            .expect("HTML panel with empty queryType should deserialize");

        // queryType should default to Sql
        let re_serialized = serde_json::to_value(&dashboard).unwrap();
        let query_type = re_serialized
            .get("tabs")
            .and_then(|t| t.get(0))
            .and_then(|t| t.get("panels"))
            .and_then(|p| p.get(0))
            .and_then(|p| p.get("queryType"))
            .and_then(|t| t.as_str())
            .unwrap();
        assert_eq!(
            query_type, "sql",
            "Empty queryType should round-trip as 'sql'"
        );

        let errors = validate_dashboard(&re_serialized);
        assert!(
            errors.is_empty(),
            "HTML panel should validate after round-trip, got errors: {:?}",
            errors
        );
    }

    #[test]
    fn test_group_filter_roundtrip_preserves_conditions() {
        // Regression test: with `#[serde(untagged)]` on PanelFilter,
        // `#[serde(default)]` on FilterCondition caused group filters to be
        // incorrectly deserialized as Condition (losing the conditions array).
        use crate::meta::dashboards::v8;

        let json_str = r#"{
            "dashboardId": "test-filter-rt",
            "title": "Filter Roundtrip",
            "version": 8,
            "description": "",
            "tabs": [{
                "tabId": "tab-1",
                "name": "Default",
                "panels": [{
                    "id": "panel-1",
                    "type": "line",
                    "title": "Test",
                    "description": "",
                    "queryType": "sql",
                    "layout": { "x": 0, "y": 0, "w": 96, "h": 20, "i": 1 },
                    "queries": [{
                        "query": "",
                        "customQuery": false,
                        "fields": {
                            "stream": "e2e_automate",
                            "stream_type": "logs",
                            "x": [{ "label": "_timestamp", "alias": "x_axis_1", "type": "build", "functionName": "histogram", "args": [{ "type": "field", "value": { "field": "_timestamp", "streamAlias": null } }] }],
                            "y": [{ "label": "count", "alias": "y_axis_1", "type": "build", "functionName": "count", "args": [{ "type": "field", "value": { "field": "kubernetes_pod_name", "streamAlias": null } }] }],
                            "z": [],
                            "filter": {
                                "filterType": "group",
                                "logicalOperator": "AND",
                                "conditions": [{
                                    "type": "condition",
                                    "values": [],
                                    "column": { "field": "kubernetes_namespace_name" },
                                    "operator": "=",
                                    "value": "$myvar",
                                    "logicalOperator": "AND",
                                    "filterType": "condition"
                                }]
                            }
                        },
                        "config": { "promql_legend": "" }
                    }],
                    "config": { "show_legends": true }
                }]
            }]
        }"#;

        // Deserialize → re-serialize → check conditions survive
        let dashboard: v8::Dashboard =
            serde_json::from_str(json_str).expect("Should deserialize panel with group filter");
        let re_serialized = serde_json::to_value(&dashboard).unwrap();

        // Navigate to filter
        let filter = re_serialized
            .pointer("/tabs/0/panels/0/queries/0/fields/filter")
            .expect("filter must exist");

        assert_eq!(
            filter.get("filterType").and_then(|v| v.as_str()),
            Some("group"),
            "Top-level filter must remain a group, got: {}",
            serde_json::to_string_pretty(filter).unwrap()
        );

        let conditions = filter
            .get("conditions")
            .and_then(|v| v.as_array())
            .expect("Group filter must have conditions array");

        assert_eq!(
            conditions.len(),
            1,
            "Group filter must preserve its condition, got: {}",
            serde_json::to_string_pretty(filter).unwrap()
        );

        // Verify the condition inside
        let cond = &conditions[0];
        assert_eq!(
            cond.get("filterType").and_then(|v| v.as_str()),
            Some("condition")
        );
        assert_eq!(cond.get("operator").and_then(|v| v.as_str()), Some("="));
        assert_eq!(cond.get("value").and_then(|v| v.as_str()), Some("$myvar"));

        // Also validate against schema
        let errors = validate_dashboard(&re_serialized);
        assert!(
            errors.is_empty(),
            "Panel with filter should validate after round-trip, got: {:?}",
            errors
        );
    }

    #[test]
    fn test_invalid_pie_wrong_fields() {
        let json_str =
            include_str!("../../../../../../test-fixtures/invalid/pie-wrong-fields.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(
            !errors.is_empty(),
            "Expected errors for pie with wrong field counts"
        );
    }
}
