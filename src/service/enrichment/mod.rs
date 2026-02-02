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

use std::{collections::BTreeMap, sync::Arc};

use async_trait::async_trait;
use config::utils::time::{now_micros, parse_str_to_time};
use vector_enrichment::{Case, IndexHandle, Table};
use vrl::value::{KeyString, ObjectMap, Value};

use crate::service::db::enrichment_table;

pub mod storage;

#[derive(Clone)]
pub struct StreamTableConfig {}

#[derive(Debug, Clone)]
pub struct StreamTable {
    pub org_id: String,
    pub stream_name: String,
    pub data: Arc<Vec<vrl::value::Value>>,
}

impl StreamTable {}

#[async_trait]
impl Table for StreamTable {
    fn find_table_row(
        &self,
        case: vector_enrichment::Case,
        conditions: &[vector_enrichment::Condition],
        select: Option<&[String]>,
        _wildcard: Option<&Value>,
        _index: Option<vector_enrichment::IndexHandle>,
    ) -> Result<ObjectMap, String> {
        let resp = get_data(self, conditions, select, case);
        let record = if resp.is_empty() {
            ObjectMap::new()
        } else {
            resp.first().unwrap().clone()
        };

        Ok(record)
    }

    fn find_table_rows(
        &self,
        case: vector_enrichment::Case,
        conditions: &[vector_enrichment::Condition],
        select: Option<&[String]>,
        _wildcard: Option<&Value>,
        _index: Option<vector_enrichment::IndexHandle>,
    ) -> Result<Vec<ObjectMap>, String> {
        let resp = get_data(self, conditions, select, case);
        Ok(resp)
    }

    fn add_index(
        &mut self,
        _case: vector_enrichment::Case,
        _fields: &[&str],
    ) -> Result<vector_enrichment::IndexHandle, String> {
        Ok(IndexHandle(1))
    }

    fn index_fields(&self) -> Vec<(vector_enrichment::Case, Vec<String>)> {
        Vec::new()
    }

    fn needs_reload(&self) -> bool {
        false
    }
}

fn get_data(
    table: &StreamTable,
    condition: &[vector_enrichment::Condition],
    select: Option<&[String]>,
    case: vector_enrichment::Case,
) -> Vec<ObjectMap> {
    // Return early since nothing to filter
    if condition.is_empty() {
        return vec![];
    }
    let mut resp = vec![];
    let filtered = table.data.iter().filter(|v| {
        if let Value::Object(map) = v {
            // Check that ALL conditions match (AND logic)
            condition.iter().all(|cond| match cond {
                vector_enrichment::Condition::Equals { field, value } => match case {
                    Case::Insensitive => match (map.get(*field), value) {
                        (Some(Value::Bytes(bytes1)), Value::Bytes(bytes2)) => {
                            match (std::str::from_utf8(bytes1), std::str::from_utf8(bytes2)) {
                                (Ok(s1), Ok(s2)) => s1.eq_ignore_ascii_case(s2),
                                (Err(_), Err(_)) => bytes1 == bytes2,
                                _ => false,
                            }
                        }
                        _ => false,
                    },
                    Case::Sensitive => map.get(*field).is_some_and(|v| v == value),
                },
                vector_enrichment::Condition::FromDate { field, from } => map
                    .get(*field)
                    .and_then(|v| v.as_str())
                    .and_then(|v| parse_str_to_time(v.as_ref()).ok())
                    .is_some_and(|d| d >= *from),
                vector_enrichment::Condition::ToDate { field, to } => map
                    .get(*field)
                    .and_then(|v| v.as_str())
                    .and_then(|v| parse_str_to_time(v.as_ref()).ok())
                    .is_some_and(|d| d <= *to),
                vector_enrichment::Condition::BetweenDates { field, from, to } => map
                    .get(*field)
                    .and_then(|v| v.as_str())
                    .and_then(|v| parse_str_to_time(v.as_ref()).ok())
                    .is_some_and(|d| d >= *from && d <= *to),
            })
        } else {
            false
        }
    });

    for map in filtered.filter_map(|v| v.as_object()) {
        let btree_map = if let Some(val) = select {
            val.iter()
                .filter_map(|field| map.get_key_value(field.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<BTreeMap<KeyString, Value>>()
        } else {
            map.clone()
        };

        resp.push(btree_map);
    }

    resp
}

// Global state for caching
// static METADATA_CACHE: Lazy<Arc<RwLock<HashMap<String, EnrichmentTableMetadata>>>> =
//     Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Retrieve enrichment table data.
///
/// Be careful with `apply_primary_region_if_specified` boolean. If this value is true and the
/// primary region is specified, this will fetch enrichment table data only from the specified
/// primary region and will ignore the other regions. Ideally only for cache_enrichment_table
/// function used when starting a node, it should be used.
pub async fn get_enrichment_table(
    org_id: &str,
    table_name: &str,
    apply_primary_region_if_specified: bool,
) -> Result<Arc<Vec<vrl::value::Value>>, anyhow::Error> {
    let value_type =
        get_enrichment_table_inner(org_id, table_name, apply_primary_region_if_specified).await?;
    value_type.to_vrl()
}

/// Retrieve enrichment table data as Values (optimized version)
/// This function returns data in the most efficient format based on the source
pub async fn get_enrichment_table_inner(
    org_id: &str,
    table_name: &str,
    apply_primary_region_if_specified: bool,
) -> Result<storage::Values, anyhow::Error> {
    log::debug!("get_enrichment_table: {org_id}/{table_name}");
    let db_stats = enrichment_table::get_meta_table_stats(org_id, table_name)
        .await
        .unwrap_or_default();
    let local_last_updated = storage::local::get_last_updated_at(org_id, table_name)
        .await
        .unwrap_or_default();

    let values = if (db_stats.end_time > local_last_updated) || local_last_updated == 0 {
        log::debug!("get_enrichment_table: fetching from remote: {org_id}/{table_name}");
        // Use current timestamp if end_time is 0 (no meta stats exist)
        let end_time = if db_stats.end_time == 0 {
            now_micros()
        } else {
            db_stats.end_time + 1 // search query end time is not inclusive
        };
        enrichment_table::get_enrichment_table_data(
            org_id,
            table_name,
            apply_primary_region_if_specified,
            end_time,
        )
        .await?
    } else {
        log::debug!("get_enrichment_table: fetching from local: {org_id}/{table_name}");
        storage::local::retrieve(org_id, table_name).await?
    };

    // Store to local cache in background if needed
    if values.is_empty() {
        log::debug!("get_enrichment_table: empty data for {org_id}/{table_name}");
        return Ok(values);
    }

    let last_updated_at = values.last_updated_at();
    storage::local::store_data_if_needed_background(
        org_id,
        table_name,
        values.clone(),
        last_updated_at,
    )
    .await?;

    log::debug!("get_enrichment_table: fetched from {org_id}/{table_name}");
    Ok(values)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vector_enrichment::{Case, Condition};
    use vrl::value::Value;

    use super::*;

    // Helper function to create test VRL values
    fn create_test_data() -> Vec<Value> {
        vec![
            json!({
                "id": "1",
                "name": "Alice",
                "email": "alice@example.com",
                "country": "USA",
                "date": "2025-01-15T10:00:00Z",
                "score": 95
            }),
            json!({
                "id": "2",
                "name": "Bob",
                "email": "bob@example.com",
                "country": "UK",
                "date": "2025-02-20T15:30:00Z",
                "score": 87
            }),
            json!({
                "id": "3",
                "name": "charlie",
                "email": "charlie@example.com",
                "country": "Canada",
                "date": "2025-03-10T08:45:00Z",
                "score": 92
            }),
        ]
        .into_iter()
        .map(|v| crate::service::db::enrichment_table::convert_to_vrl(&v))
        .collect()
    }

    fn create_stream_table(data: Vec<Value>) -> StreamTable {
        StreamTable {
            org_id: "test_org".to_string(),
            stream_name: "test_stream".to_string(),
            data: Arc::new(data),
        }
    }

    #[test]
    fn test_enrichment_exact_match_sensitive() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert!(!result.is_empty());
        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "Alice");
        assert_eq!(result.get("id").unwrap().as_str().unwrap(), "1");
    }

    #[test]
    fn test_enrichment_exact_match_insensitive() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("ALICE"),
        }];

        let result = table
            .find_table_row(Case::Insensitive, &conditions, None, None, None)
            .unwrap();

        assert!(!result.is_empty());
        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "Alice");
    }

    #[test]
    fn test_enrichment_case_insensitive_lowercase() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("CHARLIE"),
        }];

        let result = table
            .find_table_row(Case::Insensitive, &conditions, None, None, None)
            .unwrap();

        assert!(!result.is_empty());
        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "charlie");
    }

    #[test]
    fn test_enrichment_case_sensitive_no_match() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("ALICE"),
        }];

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn test_enrichment_from_date() {
        let table = create_stream_table(create_test_data());
        let from_time = chrono::DateTime::parse_from_rfc3339("2025-02-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let conditions = vec![Condition::FromDate {
            field: "date",
            from: from_time,
        }];

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert_eq!(results.len(), 2); // Bob and Charlie
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Bob")
        );
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "charlie")
        );
    }

    #[test]
    fn test_enrichment_to_date() {
        let table = create_stream_table(create_test_data());
        let to_time = chrono::DateTime::parse_from_rfc3339("2025-02-25T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let conditions = vec![Condition::ToDate {
            field: "date",
            to: to_time,
        }];

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert_eq!(results.len(), 2); // Alice and Bob
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Alice")
        );
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Bob")
        );
    }

    #[test]
    fn test_enrichment_between_dates() {
        let table = create_stream_table(create_test_data());
        let from_time = chrono::DateTime::parse_from_rfc3339("2025-01-10T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let to_time = chrono::DateTime::parse_from_rfc3339("2025-02-25T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let conditions = vec![Condition::BetweenDates {
            field: "date",
            from: from_time,
            to: to_time,
        }];

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert_eq!(results.len(), 2); // Alice and Bob
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Alice")
        );
        assert!(
            results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Bob")
        );
        assert!(
            !results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "charlie")
        );
    }

    #[test]
    fn test_enrichment_empty_conditions() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![];

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        // Should return empty vector for empty conditions (early return optimization)
        assert!(results.is_empty());
    }

    #[test]
    fn test_enrichment_multiple_conditions_and_logic() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![
            Condition::Equals {
                field: "country",
                value: Value::from("USA"),
            },
            Condition::Equals {
                field: "name",
                value: Value::from("Alice"),
            },
        ];

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert!(!result.is_empty());
        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "Alice");
        assert_eq!(result.get("country").unwrap().as_str().unwrap(), "USA");
    }

    #[test]
    fn test_enrichment_multiple_conditions_no_match() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![
            Condition::Equals {
                field: "country",
                value: Value::from("USA"),
            },
            Condition::Equals {
                field: "name",
                value: Value::from("Bob"), // Bob is from UK, not USA
            },
        ];

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        // Should be empty because Bob is not from USA
        assert!(result.is_empty());
    }

    #[test]
    fn test_enrichment_field_selection() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];
        let select_fields = vec!["name".to_string(), "email".to_string()];

        let result = table
            .find_table_row(
                Case::Sensitive,
                &conditions,
                Some(&select_fields),
                None,
                None,
            )
            .unwrap();

        assert!(!result.is_empty());
        assert!(result.contains_key("name"));
        assert!(result.contains_key("email"));
        assert!(!result.contains_key("id"));
        assert!(!result.contains_key("country"));
        assert_eq!(result.len(), 2); // Only name and email
    }

    #[test]
    fn test_enrichment_field_selection_nonexistent() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];
        let select_fields = vec!["name".to_string(), "nonexistent_field".to_string()];

        let result = table
            .find_table_row(
                Case::Sensitive,
                &conditions,
                Some(&select_fields),
                None,
                None,
            )
            .unwrap();

        assert!(!result.is_empty());
        assert!(result.contains_key("name"));
        assert!(!result.contains_key("nonexistent_field"));
        assert_eq!(result.len(), 1); // Only name exists
    }

    #[test]
    fn test_enrichment_find_table_rows_multiple_results() {
        let table = create_stream_table(create_test_data());
        let conditions = vec![]; // Empty condition should return empty due to optimization

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn test_enrichment_wildcard_parameter() {
        // Test that wildcard parameter is accepted (currently unused but part of API)
        let table = create_stream_table(create_test_data());
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];
        let wildcard = Some(Value::from("*"));

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, wildcard.as_ref(), None)
            .unwrap();

        assert!(!result.is_empty());
        assert_eq!(result.get("name").unwrap().as_str().unwrap(), "Alice");
    }

    #[test]
    fn test_enrichment_index_operations() {
        let mut table = create_stream_table(create_test_data());

        // Test add_index
        let index_handle = table
            .add_index(Case::Sensitive, &["name", "country"])
            .unwrap();
        assert_eq!(index_handle.0, 1);

        // Test index_fields
        let fields = table.index_fields();
        assert!(fields.is_empty()); // Currently returns empty

        // Test needs_reload
        assert!(!table.needs_reload());
    }

    #[test]
    fn test_get_data_empty_table() {
        let table = create_stream_table(vec![]);
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];

        let results = get_data(&table, &conditions, None, Case::Sensitive);
        assert!(results.is_empty());
    }

    #[test]
    fn test_get_data_with_non_object_values() {
        // Create a table with non-object values (should be filtered out)
        let data = vec![
            Value::from("not an object"),
            Value::from(123),
            json!({"name": "Alice"}).into(),
        ];
        let table = create_stream_table(data);
        let conditions = vec![Condition::Equals {
            field: "name",
            value: Value::from("Alice"),
        }];

        let results = get_data(&table, &conditions, None, Case::Sensitive);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_enrichment_date_condition_invalid_format() {
        let mut data = create_test_data();
        // Add a record with invalid date format
        data.push(json!({"name": "Invalid", "date": "not-a-date"}).into());

        let table = create_stream_table(data);
        let from_time = chrono::DateTime::parse_from_rfc3339("2025-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);

        let conditions = vec![Condition::FromDate {
            field: "date",
            from: from_time,
        }];

        let results = table
            .find_table_rows(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        // Invalid date should be filtered out
        assert!(
            !results
                .iter()
                .any(|r| r.get("name").unwrap().as_str().unwrap() == "Invalid")
        );
    }

    #[test]
    fn test_enrichment_bytes_comparison() {
        // Test direct bytes comparison (both UTF-8)
        let data = vec![json!({"id": "1", "data": "test"}).into()];
        let table = create_stream_table(data);

        let conditions = vec![Condition::Equals {
            field: "data",
            value: Value::from("test"),
        }];

        let result = table
            .find_table_row(Case::Sensitive, &conditions, None, None, None)
            .unwrap();

        assert!(!result.is_empty());
    }
}
