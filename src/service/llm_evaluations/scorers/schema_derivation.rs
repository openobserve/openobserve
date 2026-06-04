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
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Clone)]
pub struct DerivedSchema {
    pub json_schema: Value,
    pub value_field: String,
    pub metadata_fields: Vec<String>,
}

pub const SCORE_FIELD: &str = "score";
pub const REASONING_FIELD: &str = "reasoning";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExtraMetadataFieldType {
    #[default]
    String,
    Number,
    Boolean,
}

impl ExtraMetadataFieldType {
    fn json_schema_type(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Number => "number",
            Self::Boolean => "boolean",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ExtraMetadataField {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: ExtraMetadataFieldType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

pub fn derive_output_schema(
    data_type: ScoreConfigDataType,
    numeric_range: Option<&Value>,
    categories: Option<&Value>,
    extra_metadata_fields: &[ExtraMetadataField],
    include_reasoning: bool,
) -> Result<DerivedSchema> {
    let value_schema = match data_type {
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
            schema
        }
        ScoreConfigDataType::Categorical => {
            let allowed: Vec<&str> = categories
                .and_then(|c| c.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();
            if allowed.is_empty() {
                anyhow::bail!("categories must be provided for categorical data_type");
            }
            serde_json::json!({
                "type": "string",
                "enum": allowed,
                "description": "The categorical score value"
            })
        }
        ScoreConfigDataType::Boolean => serde_json::json!({
            "type": "boolean",
            "description": "The boolean pass/fail result"
        }),
    };

    let mut properties = serde_json::json!({});
    properties[SCORE_FIELD] = value_schema;

    if include_reasoning {
        properties[REASONING_FIELD] = serde_json::json!({
            "type": "string",
            "description": "Brief explanation of the score"
        });
    }

    let mut metadata_fields = Vec::new();
    for field in extra_metadata_fields {
        let sanitized = field
            .name
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        if !sanitized.is_empty() && sanitized != SCORE_FIELD && sanitized != REASONING_FIELD {
            metadata_fields.push(sanitized.clone());
            let description = field
                .description
                .as_deref()
                .filter(|description| !description.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Additional metadata: {}", field.name));
            properties[&sanitized] = serde_json::json!({
                "type": field.data_type.json_schema_type(),
                "description": description
            });
        }
    }

    let mut required_fields = vec![SCORE_FIELD.to_string()];
    if include_reasoning {
        required_fields.push(REASONING_FIELD.to_string());
    }

    Ok(DerivedSchema {
        json_schema: serde_json::json!({
            "type": "object",
            "properties": properties,
            "required": required_fields,
            "additionalProperties": false
        }),
        value_field: SCORE_FIELD.to_string(),
        metadata_fields,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata_field(
        name: &str,
        data_type: ExtraMetadataFieldType,
        description: Option<&str>,
    ) -> ExtraMetadataField {
        ExtraMetadataField {
            name: name.to_string(),
            data_type,
            description: description.map(str::to_string),
        }
    }

    #[test]
    fn derives_numeric_score_schema_from_range() {
        let schema = derive_output_schema(
            ScoreConfigDataType::Numeric,
            Some(&serde_json::json!({"min": 0.0, "max": 1.0})),
            None,
            &[metadata_field(
                "failure_mode",
                ExtraMetadataFieldType::String,
                Some("Reason for low score"),
            )],
            true,
        )
        .unwrap();

        assert_eq!(schema.value_field, "score");
        assert_eq!(schema.json_schema["properties"]["score"]["type"], "number");
        assert_eq!(schema.json_schema["properties"]["score"]["minimum"], 0.0);
        assert_eq!(schema.json_schema["properties"]["score"]["maximum"], 1.0);
        assert_eq!(
            schema.json_schema["required"],
            serde_json::json!(["score", "reasoning"])
        );
        assert_eq!(schema.metadata_fields, vec!["failure_mode".to_string()]);
        assert_eq!(
            schema.json_schema["properties"]["failure_mode"],
            serde_json::json!({
                "type": "string",
                "description": "Reason for low score"
            })
        );
    }

    #[test]
    fn derives_categorical_score_schema_from_categories() {
        let schema = derive_output_schema(
            ScoreConfigDataType::Categorical,
            None,
            Some(&serde_json::json!(["low", "medium", "high"])),
            &[],
            false,
        )
        .unwrap();

        assert_eq!(schema.json_schema["properties"]["score"]["type"], "string");
        assert_eq!(
            schema.json_schema["properties"]["score"]["enum"],
            serde_json::json!(["low", "medium", "high"])
        );
        assert_eq!(schema.json_schema["required"], serde_json::json!(["score"]));
    }

    #[test]
    fn derives_boolean_score_schema() {
        let schema = derive_output_schema(
            ScoreConfigDataType::Boolean,
            None,
            None,
            &[
                metadata_field("score", ExtraMetadataFieldType::String, None),
                metadata_field("reasoning", ExtraMetadataFieldType::String, None),
                metadata_field("debug flag", ExtraMetadataFieldType::Boolean, None),
            ],
            true,
        )
        .unwrap();

        assert_eq!(schema.json_schema["properties"]["score"]["type"], "boolean");
        assert_eq!(schema.metadata_fields, vec!["debug_flag".to_string()]);
        assert_eq!(
            schema.json_schema["properties"]["debug_flag"],
            serde_json::json!({
                "type": "boolean",
                "description": "Additional metadata: debug flag"
            })
        );
    }

    #[test]
    fn rejects_string_metadata_field_entries() {
        let result: Result<ExtraMetadataField, _> =
            serde_json::from_value(serde_json::json!("confidence"));

        assert!(result.is_err());
    }

    #[test]
    fn derives_number_metadata_field_schema() {
        let schema = derive_output_schema(
            ScoreConfigDataType::Numeric,
            None,
            None,
            &[metadata_field(
                "confidence",
                ExtraMetadataFieldType::Number,
                Some("Judge confidence from 0.0 to 1.0"),
            )],
            true,
        )
        .unwrap();

        assert_eq!(
            schema.json_schema["properties"]["confidence"],
            serde_json::json!({
                "type": "number",
                "description": "Judge confidence from 0.0 to 1.0"
            })
        );
    }
}
