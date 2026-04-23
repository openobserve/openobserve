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

    #[test]
    fn test_valid_promql_dashboard() {
        let json_str = include_str!("../../../../../../test-fixtures/valid/promql-dashboard.json");
        let json: Value = serde_json::from_str(json_str).unwrap();
        let errors = validate_dashboard(&json);
        assert!(
            errors.is_empty(),
            "Expected valid PromQL dashboard, got errors: {:?}",
            errors
        );
    }
}
