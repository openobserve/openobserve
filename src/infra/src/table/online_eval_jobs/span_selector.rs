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

//! Span Selectors: named, filtered span-extraction schemas that trace eval
//! jobs bind to scorers consuming `{{ spans }}`.

use std::collections::BTreeMap;

use config::meta::{
    alerts::{ConditionGroup, ConditionList},
    pipeline::components::ConditionParams,
};
use serde::{Deserialize, Serialize};

pub type SpanSelectorBindings = BTreeMap<String, String>;

pub const DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS: usize = 5;
pub const SPAN_SELECTOR_FIELD_VALUE_MAX_CHARS: usize = 1_000;
pub const SPAN_SELECTOR_OUTPUT_MAX_CHARS: usize = 40_000;
pub const DEFAULT_SPAN_SELECTOR_FIELDS: [&str; 8] = [
    "name",
    "status",
    "gen_ai_tool_name",
    "gen_ai_tool_call_id",
    "gen_ai_tool_call_arguments",
    "gen_ai_tool_call_result",
    "gen_ai_input_messages",
    "gen_ai_output_messages",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanSelectorFieldMode {
    #[default]
    Default,
    Custom,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SpanSelector {
    pub id: String,
    pub name: String,
    pub filter_condition: serde_json::Value,
    pub field_mode: SpanSelectorFieldMode,
    pub fields: Vec<String>,
    pub maximum_spans: usize,
}

impl Default for SpanSelector {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            filter_condition: serde_json::json!({}),
            field_mode: SpanSelectorFieldMode::Default,
            fields: Vec::new(),
            maximum_spans: DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS,
        }
    }
}

impl SpanSelector {
    pub fn field_count(&self) -> usize {
        match self.field_mode {
            SpanSelectorFieldMode::Default => DEFAULT_SPAN_SELECTOR_FIELDS.len(),
            SpanSelectorFieldMode::Custom => self.fields.len(),
        }
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.id.trim().is_empty() {
            return Err("Span Selector id cannot be empty");
        }
        if self.name.trim().is_empty() {
            return Err("Span Selector name cannot be empty");
        }
        if self.maximum_spans == 0 {
            return Err("Span Selector maximumSpans must be greater than zero");
        }
        if !is_valid_selector_filter(&self.filter_condition) {
            return Err("Span Selector filterCondition is invalid");
        }

        if matches!(self.field_mode, SpanSelectorFieldMode::Custom) {
            if self.fields.is_empty() {
                return Err("Custom Span Selector schema requires at least one field");
            }
            let mut fields = std::collections::BTreeSet::new();
            for field in &self.fields {
                let field = field.trim();
                if field.is_empty() {
                    return Err("Span Selector field names cannot be empty");
                }
                if !fields.insert(field) {
                    return Err("Span Selector fields must be unique");
                }
            }
        }

        if self
            .maximum_spans
            .saturating_mul(self.field_count())
            .saturating_mul(SPAN_SELECTOR_FIELD_VALUE_MAX_CHARS)
            > SPAN_SELECTOR_OUTPUT_MAX_CHARS
        {
            return Err("Span Selector output budget exceeds 40000 characters");
        }
        Ok(())
    }
}

fn is_valid_selector_filter(filter: &serde_json::Value) -> bool {
    if filter.is_null()
        || filter.as_object().is_some_and(|value| value.is_empty())
        || filter
            .get("type")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("all"))
    {
        return true;
    }

    if let Ok(condition) = serde_json::from_value::<ConditionParams>(filter.clone()) {
        return match condition {
            ConditionParams::V1 { conditions } => conditions.has_conditions(),
            ConditionParams::V2 { conditions } => conditions.validate().is_ok(),
        };
    }
    if let Ok(conditions) = serde_json::from_value::<ConditionGroup>(filter.clone()) {
        return conditions.validate().is_ok();
    }
    serde_json::from_value::<ConditionList>(filter.clone())
        .is_ok_and(|conditions| conditions.has_conditions())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_span_selector_default_schema_and_camel_case_wire_shape() {
        let selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "default".to_string(),
            ..SpanSelector::default()
        };

        assert_eq!(selector.field_count(), DEFAULT_SPAN_SELECTOR_FIELDS.len());
        assert!(selector.validate().is_ok());

        let value = serde_json::to_value(selector).unwrap();
        assert_eq!(value["fieldMode"], "default");
        assert_eq!(value["maximumSpans"], DEFAULT_SPAN_SELECTOR_MAXIMUM_SPANS);
        assert!(value.get("filterCondition").is_some());
    }

    #[test]
    fn test_span_selector_rejects_invalid_custom_schema_and_output_budget() {
        let mut selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "custom".to_string(),
            field_mode: SpanSelectorFieldMode::Custom,
            fields: Vec::new(),
            maximum_spans: 1,
            ..SpanSelector::default()
        };

        assert_eq!(
            selector.validate(),
            Err("Custom Span Selector schema requires at least one field")
        );

        selector.fields = vec!["name".to_string(), "name".to_string()];
        assert_eq!(
            selector.validate(),
            Err("Span Selector fields must be unique")
        );

        selector.fields = (0..9).map(|idx| format!("field_{idx}")).collect();
        selector.maximum_spans = 5;
        assert_eq!(
            selector.validate(),
            Err("Span Selector output budget exceeds 40000 characters")
        );
    }

    #[test]
    fn test_span_selector_rejects_an_incomplete_filter_condition() {
        let selector = SpanSelector {
            id: "selector-1".to_string(),
            name: "invalid-filter".to_string(),
            filter_condition: serde_json::json!({
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [{
                    "filterType": "condition",
                    "column": "span_status",
                    "operator": "=",
                    "logicalOperator": "AND"
                }]
            }),
            ..SpanSelector::default()
        };

        assert_eq!(
            selector.validate(),
            Err("Span Selector filterCondition is invalid")
        );
    }
}
