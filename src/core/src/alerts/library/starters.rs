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

//! Built-in starters: filter-mode skeletons whose slots fill from the schema by data type.

use arrow_schema::DataType;
use serde::Serialize;
use serde_json::{Value, json};
use utoipa::ToSchema;

const MAX_CANDIDATES: usize = 50;
const CONDITION: &str = "/query_condition/conditions/conditions/conditions/0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StarterShape {
    RareValue,
    MoreThanUsual,
    Percentile,
    PerGroup,
}

impl StarterShape {
    pub fn id(&self) -> &'static str {
        match self {
            Self::RareValue => "starter:rare_value",
            Self::MoreThanUsual => "starter:more_than_usual",
            Self::Percentile => "starter:percentile",
            Self::PerGroup => "starter:per_group",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SlotName {
    Category,
    Value,
    Measure,
    Group,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SlotType {
    String,
    Number,
}

#[derive(Clone, Debug, PartialEq, Serialize, ToSchema)]
pub struct Slot {
    pub name: SlotName,
    pub data_type: SlotType,
    pub candidates: Vec<String>,
    /// RFC 6901 pointer into the prefill where the chosen field or value goes.
    pub pointer: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Starter {
    pub shape: StarterShape,
    pub slots: Vec<Slot>,
    pub prefill: Value,
}

/// Every starter whose field slots this schema can fill, in a fixed order.
pub fn starters(
    stream_type: &str,
    stream_name: &str,
    fields: &[(String, DataType)],
) -> Vec<Starter> {
    let strings = candidates(fields, is_string);
    let numbers = candidates(fields, is_number);
    let category = || slot(SlotName::Category, SlotType::String, &strings, "/column");
    let value = || slot(SlotName::Value, SlotType::String, &[], "/value");
    let mut out = Vec::new();
    if !strings.is_empty() {
        out.push(starter(
            StarterShape::RareValue,
            vec![category(), value()],
            stream_type,
            stream_name,
        ));
        out.push(starter(
            StarterShape::MoreThanUsual,
            vec![category(), value()],
            stream_type,
            stream_name,
        ));
    }
    if !numbers.is_empty() {
        let measure = Slot {
            name: SlotName::Measure,
            data_type: SlotType::Number,
            candidates: numbers,
            pointer: "/query_condition/aggregation/having/column".to_string(),
        };
        out.push(starter(
            StarterShape::Percentile,
            vec![measure],
            stream_type,
            stream_name,
        ));
    }
    if !strings.is_empty() {
        let group = Slot {
            name: SlotName::Group,
            data_type: SlotType::String,
            candidates: strings.clone(),
            pointer: "/query_condition/aggregation/group_by/0".to_string(),
        };
        out.push(starter(
            StarterShape::PerGroup,
            vec![category(), value(), group],
            stream_type,
            stream_name,
        ));
    }
    out
}

fn slot(name: SlotName, data_type: SlotType, candidates: &[String], at: &str) -> Slot {
    Slot {
        name,
        data_type,
        candidates: candidates.to_vec(),
        pointer: format!("{CONDITION}{at}"),
    }
}

/// Schema fields of one type in schema order; internal `_`-prefixed columns are not data.
fn candidates(fields: &[(String, DataType)], keep: fn(&DataType) -> bool) -> Vec<String> {
    fields
        .iter()
        .filter(|(name, t)| !name.starts_with('_') && keep(t))
        .map(|(name, _)| name.clone())
        .take(MAX_CANDIDATES)
        .collect()
}

fn is_string(t: &DataType) -> bool {
    matches!(t, DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View)
}

fn is_number(t: &DataType) -> bool {
    t.is_integer() || t.is_floating()
}

fn starter(shape: StarterShape, slots: Vec<Slot>, stream_type: &str, stream_name: &str) -> Starter {
    let filter = json!({
        "version": 2,
        "conditions": {
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [{"filterType": "condition", "column": "", "operator": "=", "value": "", "logicalOperator": "AND"}]
        }
    });
    let no_filter = json!({
        "version": 2,
        "conditions": {"filterType": "group", "logicalOperator": "AND", "conditions": []}
    });
    let (conditions, aggregation) = match shape {
        StarterShape::RareValue | StarterShape::MoreThanUsual => (filter, Value::Null),
        StarterShape::Percentile => (
            no_filter,
            json!({"group_by": [], "function": "p95", "having": {"column": "", "operator": ">", "value": ""}}),
        ),
        StarterShape::PerGroup => (
            filter,
            json!({"group_by": [""], "function": "count", "having": {"column": "", "operator": ">=", "value": 1}, "multi_alert": true}),
        ),
    };
    let prefill = json!({
        "stream_type": stream_type,
        "stream_name": stream_name,
        "is_real_time": false,
        "query_condition": {
            "type": "custom",
            "conditions": conditions,
            "sql": null,
            "promql": null,
            "aggregation": aggregation,
            "vrl_function": null,
            "multi_time_range": []
        },
        "trigger_condition": {"period": 5, "operator": ">=", "threshold": 1, "frequency": 5, "frequency_type": "minutes", "silence": 10}
    });
    Starter {
        shape,
        slots,
        prefill,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starters_need_a_field_of_their_slot_type_and_point_into_the_prefill() {
        let field = |n: &str, t: DataType| (n.to_string(), t);
        let mixed = [
            field("_timestamp", DataType::Int64),
            field("f_text", DataType::Utf8),
            field("f_num", DataType::Float64),
        ];
        let numbers_only = [
            field("_timestamp", DataType::Int64),
            field("f_num", DataType::Int64),
        ];
        let shapes = |fields: &[(String, DataType)]| -> Vec<StarterShape> {
            starters("logs", "s", fields)
                .iter()
                .map(|s| s.shape)
                .collect()
        };
        use StarterShape::*;
        assert_eq!(
            shapes(&mixed),
            vec![RareValue, MoreThanUsual, Percentile, PerGroup]
        );
        assert_eq!(shapes(&numbers_only), vec![Percentile]);
        assert!(shapes(&[field("_timestamp", DataType::Int64)]).is_empty());

        for s in starters("logs", "s", &mixed) {
            for slot in s.slots.iter() {
                assert!(
                    s.prefill.pointer(&slot.pointer).is_some(),
                    "{:?} {}",
                    s.shape,
                    slot.pointer
                );
                assert!(!slot.candidates.iter().any(|c| c.starts_with('_')));
            }
        }
    }
}
