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

use std::sync::Arc;

use ::datafusion::arrow::datatypes::Schema;
use config::{TIMESTAMP_COL_NAME, utils::json};
use hashbrown::HashMap;

pub mod cacher;
pub mod flight;
pub mod http;

pub fn handle_table_response(
    schema: Arc<Schema>,
    sources: Vec<json::Value>,
) -> (Vec<String>, Vec<json::Value>) {
    let columns = schema
        .fields()
        .iter()
        .map(|f| f.name().to_string())
        .collect::<Vec<_>>();
    let mut table = Vec::with_capacity(sources.len());
    for row in &sources {
        let mut new_row = Vec::with_capacity(columns.len());
        let row = row.as_object().unwrap();
        for column in &columns {
            let value = match row.get(column) {
                Some(v) => v.to_owned(),
                None => json::Value::Null,
            };
            new_row.push(value);
        }
        table.push(json::Value::Array(new_row));
    }
    (columns, table)
}

pub fn handle_metrics_response(sources: Vec<json::Value>) -> Vec<json::Value> {
    // handle metrics response
    let mut results_metrics: HashMap<String, json::Value> = HashMap::with_capacity(16);
    let mut results_values: HashMap<String, Vec<[json::Value; 2]>> = HashMap::with_capacity(16);
    for source in sources {
        let fields = source.as_object().unwrap();
        let mut key = Vec::with_capacity(fields.len());
        fields.iter().for_each(|(k, v)| {
            if *k != TIMESTAMP_COL_NAME && k != "value" {
                key.push(format!("{k}_{v}"));
            }
        });
        let key = key.join("_");
        if !results_metrics.contains_key(&key) {
            let mut fields = fields.clone();
            fields.remove(TIMESTAMP_COL_NAME);
            fields.remove("value");
            results_metrics.insert(key.clone(), json::Value::Object(fields));
        }
        let entry = results_values.entry(key).or_default();
        let value = [
            fields.get(TIMESTAMP_COL_NAME).unwrap().to_owned(),
            json::Value::String(fields.get("value").unwrap().to_string()),
        ];
        entry.push(value);
    }

    let mut new_sources = Vec::with_capacity(results_metrics.len());
    for (key, metrics) in results_metrics {
        new_sources.push(json::json!({
            "metrics": metrics,
            "values": results_values.get(&key).unwrap(),
        }));
    }

    new_sources
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use ::datafusion::arrow::datatypes::{DataType, Field, Schema};
    use serde_json as json;

    use super::*;

    #[test]
    fn test_handle_table_response() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("col1", DataType::Utf8, false),
            Field::new("col2", DataType::Int64, false),
        ]));
        let sources = vec![
            json::json!({"col1": "a", "col2": 1}),
            json::json!({"col1": "b", "col2": 2}),
        ];
        let (columns, table) = handle_table_response(schema, sources);
        assert_eq!(columns, vec!["col1", "col2"]);
        assert_eq!(table, vec![json::json!(["a", 1]), json::json!(["b", 2]),]);
    }

    #[test]
    fn test_handle_metrics_response() {
        // TIMESTAMP_COL_NAME is imported from config, but for test, we use the string directly
        let sources = vec![
            json::json!({"_timestamp": 123, "value": 10, "metric": "cpu", "host": "a"}),
            json::json!({"_timestamp": 124, "value": 20, "metric": "cpu", "host": "a"}),
            json::json!({"_timestamp": 123, "value": 30, "metric": "mem", "host": "b"}),
        ];
        let result = handle_metrics_response(sources);
        // Should group by metric and host
        assert_eq!(result.len(), 2);
        let mut found_cpu = false;
        let mut found_mem = false;
        for entry in result {
            let metrics = &entry["metrics"];
            let values = &entry["values"];
            if metrics["metric"] == "cpu" && metrics["host"] == "a" {
                found_cpu = true;
                assert_eq!(values, &json::json!([[123, "10"], [124, "20"]]));
            } else if metrics["metric"] == "mem" && metrics["host"] == "b" {
                found_mem = true;
                assert_eq!(values, &json::json!([[123, "30"]]));
            }
        }
        assert!(found_cpu && found_mem);
    }
}
