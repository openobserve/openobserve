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

use async_trait::async_trait;
use config::utils::time::parse_str_to_time;
use vector_enrichment::{Case, IndexHandle, Table};
use vrl::value::{ObjectMap, Value};

pub mod storage;

#[derive(Clone)]
pub struct StreamTableConfig {}

#[derive(Debug, Clone)]
pub struct StreamTable {
    pub org_id: String,
    pub stream_name: String,
    pub data: Vec<vrl::value::Value>,
}

impl StreamTable {}

#[async_trait]
impl Table for StreamTable {
    fn find_table_row(
        &self,
        case: vector_enrichment::Case,
        conditions: &[vector_enrichment::Condition],
        select: Option<&[String]>,
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
    let mut resp = vec![];
    let filtered: Vec<&vrl::value::Value> = table
        .data
        .iter()
        .filter(|v| {
            if let vrl::value::Value::Object(map) = v {
                // Default to false for empty conditions array
                if condition.is_empty() {
                    return false;
                }

                // Check that ALL conditions match (AND logic)
                condition.iter().all(|cond| match cond {
                    vector_enrichment::Condition::Equals { field, value } => match case {
                        Case::Insensitive => {
                            if let Some(Value::Bytes(bytes1)) = map.get(field.to_owned()) {
                                if let Value::Bytes(bytes2) = value {
                                    match (std::str::from_utf8(bytes1), std::str::from_utf8(bytes2))
                                    {
                                        (Ok(s1), Ok(s2)) => s1.eq_ignore_ascii_case(s2),
                                        (Err(_), Err(_)) => bytes1 == bytes2,
                                        _ => false,
                                    }
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        }
                        Case::Sensitive => {
                            if let Some(v) = map.get(field.to_owned()) {
                                v.clone() == value.clone()
                            } else {
                                false
                            }
                        }
                    },
                    vector_enrichment::Condition::BetweenDates { field, from, to } => {
                        if let Some(v) = map.get(field.to_owned()) {
                            if let Some(v) = v.as_str() {
                                if let Ok(v) = parse_str_to_time(&v) {
                                    v >= *from && v <= *to
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    }
                })
            } else {
                false
            }
        })
        .collect();

    match select {
        Some(val) => {
            for value in filtered {
                if let Some(map) = value.as_object() {
                    let mut btree_map = ObjectMap::new();
                    for field in val {
                        if let Some(v) = map.get(field.as_str()) {
                            btree_map.insert(field.to_owned().into(), v.clone());
                        }
                    }
                    resp.push(btree_map);
                };
            }
        }
        None => {
            for value in filtered {
                if let Value::Object(map) = value {
                    let btree_map: ObjectMap = map
                        .iter()
                        .map(|(k, v)| (k.to_owned(), v.clone()))
                        .collect::<ObjectMap>();
                    resp.push(btree_map);
                };
            }
        }
    };

    resp
}

// Global state for caching
// static METADATA_CACHE: Lazy<Arc<RwLock<HashMap<String, EnrichmentTableMetadata>>>> =
//     Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Retrieve enrichment table data
pub async fn get_enrichment_table(
    org_id: &str,
    table_name: &str,
) -> Result<Vec<vrl::value::Value>, anyhow::Error> {
    let records = get_enrichment_table_json(org_id, table_name).await?;

    Ok(records
        .iter()
        .map(crate::service::db::enrichment_table::convert_to_vrl)
        .collect())
}

pub async fn get_enrichment_table_json(
    org_id: &str,
    table_name: &str,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    let mut records = vec![];
    let db_stats = crate::service::db::enrichment_table::get_meta_table_stats(org_id, table_name)
        .await
        .unwrap_or_default();
    let local_stats_last_updated = storage::local::get_last_updated_at(org_id, table_name)
        .await
        .unwrap_or_default();

    if db_stats.end_time > local_stats_last_updated {
        //
        let data = crate::service::db::enrichment_table::get_enrichment_table_data(org_id, table_name).await?;
        records.extend(data);
    } else {
        // fetch from local cache and put into records
        let data = storage::local::retrieve(org_id, table_name).await?;
        records.extend(data);
    }

    records.sort_by(|a, b| {
        a.get("_timestamp")
            .unwrap()
            .as_i64()
            .unwrap()
            .cmp(&b.get("_timestamp").unwrap().as_i64().unwrap())
    });
    if records.is_empty() {
        return Ok(vec![]);
    }
    let last_updated_at = records
        .last()
        .unwrap()
        .get("_timestamp")
        .unwrap()
        .as_i64()
        .unwrap();
    storage::local::store_data_if_needed_background(org_id, table_name, &records, last_updated_at)
        .await?;

    Ok(records)
}
