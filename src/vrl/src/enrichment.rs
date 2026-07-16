// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock},
};

use async_trait::async_trait;
use config::{RwHashMap, stats::MemorySize, utils::time::parse_str_to_time};
use vector_enrichment::{Case, IndexHandle, Table};
use vrl::value::{KeyString, ObjectMap, Value};

pub static ENRICHMENT_TABLES: LazyLock<RwHashMap<String, StreamTable>> =
    LazyLock::new(Default::default);

#[derive(Debug, Clone)]
pub struct StreamTable {
    pub org_id: String,
    pub stream_name: String,
    pub data: Arc<Vec<Value>>,
}

impl MemorySize for StreamTable {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<StreamTable>()
            + self.org_id.mem_size()
            + self.stream_name.mem_size()
            + self.data.iter().map(|v| v.to_string().len()).sum::<usize>()
    }
}

#[async_trait]
impl Table for StreamTable {
    fn find_table_row(
        &self,
        case: Case,
        conditions: &[vector_enrichment::Condition],
        select: Option<&[String]>,
        _wildcard: Option<&Value>,
        _index: Option<IndexHandle>,
    ) -> Result<ObjectMap, vector_enrichment::Error> {
        let resp = get_data(self, conditions, select, case);
        Ok(resp.first().cloned().unwrap_or_default())
    }

    fn find_table_rows(
        &self,
        case: Case,
        conditions: &[vector_enrichment::Condition],
        select: Option<&[String]>,
        _wildcard: Option<&Value>,
        _index: Option<IndexHandle>,
    ) -> Result<Vec<ObjectMap>, vector_enrichment::Error> {
        Ok(get_data(self, conditions, select, case))
    }

    fn add_index(
        &mut self,
        _case: Case,
        _fields: &[&str],
    ) -> Result<IndexHandle, vector_enrichment::Error> {
        Ok(IndexHandle(1))
    }

    fn index_fields(&self) -> Vec<(Case, Vec<String>)> {
        Vec::new()
    }

    fn needs_reload(&self) -> bool {
        false
    }
}

fn get_data(
    table: &StreamTable,
    conditions: &[vector_enrichment::Condition],
    select: Option<&[String]>,
    case: Case,
) -> Vec<ObjectMap> {
    if conditions.is_empty() {
        return vec![];
    }

    let filtered = table.data.iter().filter(|value| {
        let Value::Object(map) = value else {
            return false;
        };

        conditions.iter().all(|condition| match condition {
            vector_enrichment::Condition::Equals { field, value } => match case {
                Case::Insensitive => match (map.get(*field), value) {
                    (Some(Value::Bytes(left)), Value::Bytes(right)) => {
                        match (std::str::from_utf8(left), std::str::from_utf8(right)) {
                            (Ok(left), Ok(right)) => left.eq_ignore_ascii_case(right),
                            (Err(_), Err(_)) => left == right,
                            _ => false,
                        }
                    }
                    _ => false,
                },
                Case::Sensitive => map.get(*field).is_some_and(|item| item == value),
            },
            vector_enrichment::Condition::FromDate { field, from } => map
                .get(*field)
                .and_then(|value| value.as_str())
                .and_then(|value| parse_str_to_time(value.as_ref()).ok())
                .is_some_and(|date| date >= *from),
            vector_enrichment::Condition::ToDate { field, to } => map
                .get(*field)
                .and_then(|value| value.as_str())
                .and_then(|value| parse_str_to_time(value.as_ref()).ok())
                .is_some_and(|date| date <= *to),
            vector_enrichment::Condition::BetweenDates { field, from, to } => map
                .get(*field)
                .and_then(|value| value.as_str())
                .and_then(|value| parse_str_to_time(value.as_ref()).ok())
                .is_some_and(|date| date >= *from && date <= *to),
        })
    });

    filtered
        .filter_map(Value::as_object)
        .map(|map| {
            if let Some(fields) = select {
                fields
                    .iter()
                    .filter_map(|field| map.get_key_value(field.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<BTreeMap<KeyString, Value>>()
            } else {
                map.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vector_enrichment::{Condition, Table};

    use super::*;

    fn table() -> StreamTable {
        StreamTable {
            org_id: "default".to_string(),
            stream_name: "users".to_string(),
            data: Arc::new(vec![
                json!({"name": "Alice", "country": "US", "role": "admin"}).into(),
                json!({"name": "Bob", "country": "GB", "role": "user"}).into(),
                Value::from("not an object"),
            ]),
        }
    }

    #[test]
    fn matches_rows_using_requested_case_sensitivity() {
        let conditions = [Condition::Equals {
            field: "name",
            value: Value::from("ALICE"),
        }];

        let sensitive = table()
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();
        let insensitive = table()
            .find_table_rows(Case::Insensitive, &conditions, None, None, None)
            .unwrap();

        assert!(sensitive.is_empty());
        assert_eq!(insensitive.len(), 1);
        assert_eq!(insensitive[0].get("name"), Some(&Value::from("Alice")));
    }

    #[test]
    fn combines_conditions_and_projects_selected_fields() {
        let conditions = [
            Condition::Equals {
                field: "country",
                value: Value::from("US"),
            },
            Condition::Equals {
                field: "role",
                value: Value::from("admin"),
            },
        ];
        let select = ["name".to_string()];

        let rows = table()
            .find_table_rows(Case::Sensitive, &conditions, Some(&select), None, None)
            .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].len(), 1);
        assert_eq!(rows[0].get("name"), Some(&Value::from("Alice")));
    }

    #[test]
    fn returns_no_rows_for_empty_conditions() {
        let rows = table()
            .find_table_rows(Case::Sensitive, &[], None, None, None)
            .unwrap();

        assert!(rows.is_empty());
    }
}
