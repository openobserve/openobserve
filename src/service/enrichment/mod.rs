use async_trait::async_trait;
use std::collections::BTreeMap;
use vector_enrichment::{Case, IndexHandle, Table};
use vrl::value::Value;

use crate::common::time::parse_str_to_time;

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
    ) -> std::result::Result<BTreeMap<std::string::String, vrl::value::Value>, std::string::String>
    {
        let resp = get_data(self, conditions, select, case);
        let record = if resp.is_empty() {
            BTreeMap::new()
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
    ) -> Result<Vec<BTreeMap<String, vrl::value::Value>>, String> {
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
) -> Vec<BTreeMap<String, vrl::value::Value>> {
    let mut resp = vec![];
    let filtered: Vec<&vrl::value::Value> = table
        .data
        .iter()
        .filter(|v| {
            if let vrl::value::Value::Object(map) = v {
                for cond in condition {
                    match cond {
                        vector_enrichment::Condition::Equals { field, value } => match case {
                            Case::Insensitive => {
                                if let Some(Value::Bytes(bytes1)) = map.get(field.to_owned()) {
                                    if let Value::Bytes(bytes2) = value {
                                        match (
                                            std::str::from_utf8(bytes1),
                                            std::str::from_utf8(bytes2),
                                        ) {
                                            (Ok(s1), Ok(s2)) => {
                                                return s1.eq_ignore_ascii_case(s2);
                                            }
                                            (Err(_), Err(_)) => return bytes1 == bytes2,
                                            _ => return false,
                                        }
                                    }
                                }
                            }
                            Case::Sensitive => {
                                if let Some(v) = map.get(field.to_owned()) {
                                    if v.clone() == value.clone() {
                                        return true;
                                    }
                                }
                            }
                        },
                        vector_enrichment::Condition::BetweenDates { field, from, to } => {
                            if let Some(v) = map.get(field.to_owned()) {
                                if let Some(v) = v.as_str() {
                                    if let Ok(v) = parse_str_to_time(&v) {
                                        if v >= *from && v <= *to {
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            false
        })
        .collect();

    match select {
        Some(val) => {
            for value in filtered {
                if let Some(map) = value.as_object() {
                    let mut btree_map = BTreeMap::new();
                    for field in val {
                        if let Some(v) = map.get(field) {
                            btree_map.insert(field.to_owned(), v.clone());
                        }
                    }
                    resp.push(btree_map);
                };
            }
        }
        None => {
            for value in filtered {
                if let Value::Object(map) = value {
                    let btree_map: BTreeMap<String, Value> = map
                        .iter()
                        .map(|(k, v)| (k.to_owned(), v.clone()))
                        .collect::<BTreeMap<String, vrl::value::Value>>();
                    resp.push(btree_map);
                };
            }
        }
    };

    resp
}
