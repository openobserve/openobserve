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

//! Schema derivation for LLM Judge output.

use anyhow::Result;
use infra::table::score_configs::ScoreConfigDataType;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct DerivedSchema {
    pub json_schema: Value,
    pub value_field: String,
    pub metadata_fields: Vec<String>,
}

pub fn derive_output_schema(
    data_type: ScoreConfigDataType,
    numeric_range: Option<&Value>,
    categories: Option<&Value>,
    extra_metadata_fields: &[String],
    include_reasoning: bool,
) -> Result<DerivedSchema> {
    let (value_schema, value_field) = match data_type {
        ScoreConfigDataType::Numeric => {
            let mut schema = serde_json::json!({
                "type": "number",
                "description": "The numeric score value"
            });
            if let Some(range) = numeric_range
                && let (Some(min), Some(max)) = (range["min"].as_f64(), range["max"].as_f64())
            {
                schema["minimum"] = serde_json::json!(min);
                schema["maximum"] = serde_json::json!(max);
            }
            (schema, "value_numeric")
        }
        ScoreConfigDataType::Categorical => {
            let allowed: Vec<&str> = categories
                .and_then(|c| c.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();
            if allowed.is_empty() {
                anyhow::bail!("categories must be provided for categorical data_type");
            }
            (
                serde_json::json!({
                    "type": "string",
                    "enum": allowed,
                    "description": "The categorical score value"
                }),
                "value_categorical",
            )
        }
        ScoreConfigDataType::Boolean => (
            serde_json::json!({
                "type": "boolean",
                "description": "The boolean pass/fail result"
            }),
            "value_boolean",
        ),
    };

    let mut properties = serde_json::json!({});
    properties[&value_field] = value_schema;

    if include_reasoning {
        properties["reasoning"] = serde_json::json!({
            "type": "string",
            "description": "Brief explanation of the score"
        });
    }

    let mut metadata_fields = Vec::new();
    for field_name in extra_metadata_fields {
        let sanitized = field_name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        if !sanitized.is_empty() && sanitized != value_field && sanitized != "reasoning" {
            metadata_fields.push(sanitized.clone());
            properties[&sanitized] = serde_json::json!({
                "type": "string",
                "description": format!("Additional metadata: {field_name}")
            });
        }
    }

    let mut required_fields = vec![value_field.to_string()];
    if include_reasoning {
        required_fields.push("reasoning".to_string());
    }

    Ok(DerivedSchema {
        json_schema: serde_json::json!({
            "type": "object",
            "properties": properties,
            "required": required_fields,
            "additionalProperties": false
        }),
        value_field: value_field.to_string(),
        metadata_fields,
    })
}
