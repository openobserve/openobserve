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

use config::utils::json;
use hashbrown::HashMap;
use serde::Serialize;

use super::plan::{TraceListMode, TraceSort};

#[derive(Debug, Serialize)]
pub(in crate::traces) struct TraceResponseItem {
    pub(super) trace_id: String,
    pub(super) start_time: i64,
    pub(super) end_time: i64,
    pub(super) duration: i64,
    pub(super) spans: [u16; 2],
    pub(super) service_name: Vec<TraceServiceNameItem>,
    pub(super) first_event: serde_json::Value,
    pub(super) gen_ai_usage_input_tokens: i64,
    pub(super) gen_ai_usage_output_tokens: i64,
    pub(super) gen_ai_usage_total_tokens: i64,
    pub(super) gen_ai_usage_cost: f64,
    pub(super) gen_ai_input_messages: Option<serde_json::Value>,
    pub(super) models: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
pub(super) struct TraceServiceNameItem {
    pub(super) service_name: String,
    pub(super) count: u16,
    pub(super) duration: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) service_type: Option<String>,
}

pub(in crate::traces) struct TraceBatch {
    pub(super) traces: HashMap<String, TraceResponseItem>,
    pub(super) multi_service_ids: Vec<String>,
    pub(super) multi_service_total: i64,
    pub(super) range: (i64, i64),
}

impl TraceBatch {
    pub(super) fn from_hits(hits: &[json::Value], range: (i64, i64), mode: TraceListMode) -> Self {
        let mut batch = Self {
            traces: HashMap::with_capacity(hits.len()),
            multi_service_ids: Vec::new(),
            multi_service_total: 0,
            range,
        };
        for item in hits {
            let (trace_id, trace_start_time, trace_end_time) = match mode {
                TraceListMode::Complete => {
                    let id = item.get("trace_id").unwrap().as_str().unwrap().to_string();
                    let start = json::get_int_value(item.get("trace_start_time").unwrap());
                    let end = json::get_int_value(item.get("trace_end_time").unwrap());
                    let _duration = json::get_int_value(item.get("zo_sql_duration").unwrap());
                    (id, start, end)
                }
                TraceListMode::Streaming => (
                    item.get("trace_id")
                        .and_then(json::Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    json::get_int_value(item.get("trace_start_time").unwrap_or_default()),
                    json::get_int_value(item.get("trace_end_time").unwrap_or_default()),
                ),
            };
            batch.expand_range(trace_start_time, trace_end_time, mode);
            if mode == TraceListMode::Streaming && trace_id.is_empty() {
                continue;
            }
            insert_summary(&mut batch, item, trace_id, trace_start_time, trace_end_time);
        }
        batch
    }

    pub(super) fn fill_services(&mut self, hits: Vec<json::Value>) {
        for item in hits {
            let tid = item
                .get("trace_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_name = item
                .get("service_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let svc_count = json::get_int_value(item.get("svc_count").unwrap_or_default());
            let svc_duration = json::get_int_value(item.get("svc_duration").unwrap_or_default());
            let svc_type = item
                .get("service_type")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from);
            if let Some(trace) = self.traces.get_mut(&tid) {
                trace.service_name.push(TraceServiceNameItem {
                    service_name: svc_name,
                    count: svc_count.try_into().unwrap_or_default(),
                    duration: svc_duration,
                    service_type: svc_type,
                });
            }
        }
    }

    pub(in crate::traces) fn into_sorted_items(self, sort: TraceSort) -> Vec<TraceResponseItem> {
        let mut traces = self.traces.into_values().collect::<Vec<_>>();
        sort.sort(&mut traces);
        traces
    }

    fn expand_range(&mut self, start: i64, end: i64, mode: TraceListMode) {
        match mode {
            TraceListMode::Complete => {
                if start / 1000 < self.range.0 {
                    self.range.0 = start / 1000;
                }
                if end / 1000 > self.range.1 {
                    self.range.1 = end / 1000 + 1;
                }
            }
            TraceListMode::Streaming => {
                if start > 0 && start / 1000 < self.range.0 {
                    self.range.0 = start / 1000;
                }
                if end > 0 && end / 1000 + 1 > self.range.1 {
                    self.range.1 = end / 1000 + 1;
                }
            }
        }
    }
}

fn insert_summary(
    batch: &mut TraceBatch,
    item: &json::Value,
    trace_id: String,
    trace_start_time: i64,
    trace_end_time: i64,
) {
    let span_count = json::get_int_value(item.get("span_count").unwrap_or_default());
    let error_count = json::get_int_value(item.get("error_count").unwrap_or_default());
    let max_duration = json::get_int_value(item.get("max_duration").unwrap_or_default());
    let service_count = json::get_int_value(item.get("service_count").unwrap_or_default());
    let root_service_name = item
        .get("root_service_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let root_operation_name = item
        .get("root_operation_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let first_service_name = item
        .get("first_service_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let first_operation_name = item
        .get("first_operation_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let event_service_name = if !root_service_name.is_empty() {
        root_service_name
    } else {
        first_service_name
    };
    let event_operation_name = if !root_operation_name.is_empty() {
        root_operation_name
    } else {
        first_operation_name
    };

    let mut svc_list = Vec::new();
    if service_count <= 1 {
        if !event_service_name.is_empty() {
            svc_list.push(TraceServiceNameItem {
                service_name: event_service_name.clone(),
                count: span_count.try_into().unwrap_or_default(),
                duration: max_duration,
                service_type: None,
            });
        }
    } else {
        batch.multi_service_ids.push(trace_id.clone());
        batch.multi_service_total += service_count;
    }

    let computed_duration = if trace_end_time - trace_start_time > max_duration * 1000 {
        (trace_end_time - trace_start_time) / 1000
    } else {
        max_duration
    };

    batch.traces.insert(
        trace_id.clone(),
        TraceResponseItem {
            trace_id,
            start_time: trace_start_time,
            end_time: trace_end_time,
            duration: computed_duration,
            spans: [
                span_count.try_into().unwrap_or_default(),
                error_count.try_into().unwrap_or_default(),
            ],
            service_name: svc_list,
            first_event: serde_json::json!({
                "service_name": event_service_name,
                "operation_name": event_operation_name,
            }),
            gen_ai_usage_input_tokens: json::get_int_value(
                item.get("gen_ai_usage_details_input").unwrap_or_default(),
            ),
            gen_ai_usage_output_tokens: json::get_int_value(
                item.get("gen_ai_usage_details_output").unwrap_or_default(),
            ),
            gen_ai_usage_total_tokens: json::get_int_value(
                item.get("gen_ai_usage_details_total").unwrap_or_default(),
            ),
            gen_ai_usage_cost: json::get_float_value(
                item.get("gen_ai_usage_cost_details").unwrap_or_default(),
            ),
            gen_ai_input_messages: item.get("gen_ai_input_messages").cloned(),
            models: item
                .get("gen_ai_response_models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trace_service_name_item_default() {
        let item = TraceServiceNameItem::default();
        assert_eq!(item.service_name, "");
        assert_eq!(item.count, 0);
        assert_eq!(item.duration, 0);
        assert_eq!(item.service_type, None);
    }

    #[test]
    fn test_trace_service_name_item_fields() {
        let item = TraceServiceNameItem {
            service_name: "my-service".to_string(),
            count: 42,
            duration: 1000,
            service_type: None,
        };
        assert_eq!(item.service_name, "my-service");
        assert_eq!(item.count, 42);
        assert_eq!(item.duration, 1000);
    }

    #[test]
    fn test_trace_service_name_item_inferred_serializes_service_type() {
        let instrumented = TraceServiceNameItem {
            service_name: "checkout".to_string(),
            count: 3,
            duration: 100,
            service_type: None,
        };
        let json = serde_json::to_value(&instrumented).unwrap();
        assert!(!json.as_object().unwrap().contains_key("service_type"));

        let inferred = TraceServiceNameItem {
            service_name: "redis-master.prod".to_string(),
            count: 5,
            duration: 200,
            service_type: Some("database".to_string()),
        };
        let json = serde_json::to_value(&inferred).unwrap();
        assert_eq!(
            json.get("service_type").and_then(|v| v.as_str()),
            Some("database")
        );
    }

    fn summary(trace_id: &str, services: i64) -> json::Value {
        json::json!({
            "trace_id": trace_id, "trace_start_time": 100_000, "trace_end_time": 150_000,
            "zo_sql_duration": 50_000, "span_count": 3, "error_count": 1,
            "max_duration": 40, "service_count": services,
            "root_service_name": "gateway", "root_operation_name": "",
            "first_service_name": "api", "first_operation_name": "request",
            "gen_ai_usage_details_input": 10, "gen_ai_usage_details_output": 20,
            "gen_ai_usage_details_total": 30, "gen_ai_usage_cost_details": 0.5,
            "gen_ai_input_messages": "hello", "gen_ai_response_models": ["model", null]
        })
    }

    #[test]
    fn summary_conversion_preserves_labels_duration_and_llm_fields() {
        for mode in [TraceListMode::Complete, TraceListMode::Streaming] {
            let batch = TraceBatch::from_hits(&[summary("a", 1)], (100, 150), mode);
            let hit = json::to_value(&batch.traces["a"]).unwrap();
            assert_eq!(
                hit,
                json::json!({
                    "trace_id": "a", "start_time": 100_000, "end_time": 150_000,
                    "duration": 50, "spans": [3, 1],
                    "service_name": [{"service_name": "gateway", "count": 3, "duration": 40}],
                    "first_event": {"service_name": "gateway", "operation_name": "request"},
                    "gen_ai_usage_input_tokens": 10, "gen_ai_usage_output_tokens": 20,
                    "gen_ai_usage_total_tokens": 30, "gen_ai_usage_cost": 0.5,
                    "gen_ai_input_messages": "hello", "models": ["model"]
                })
            );
        }
    }

    #[test]
    fn multi_service_rows_are_filled_only_into_selected_traces() {
        let mut batch = TraceBatch::from_hits(
            &[summary("a", 2), summary("b", 1)],
            (100, 150),
            TraceListMode::Complete,
        );
        assert_eq!(batch.multi_service_ids, ["a"]);
        assert_eq!(batch.multi_service_total, 2);
        batch.fill_services(vec![
            json::json!({"trace_id": "a", "service_name": "db", "svc_count": 2, "svc_duration": 20, "service_type": "database"}),
            json::json!({"trace_id": "a", "service_name": "api", "svc_count": 1, "svc_duration": 40, "service_type": ""}),
            json::json!({"trace_id": "unselected", "service_name": "other"}),
        ]);
        let services = json::to_value(&batch.traces["a"].service_name).unwrap();
        assert_eq!(
            services,
            json::json!([
                {"service_name": "db", "count": 2, "duration": 20, "service_type": "database"},
                {"service_name": "api", "count": 1, "duration": 40}
            ])
        );
        assert_eq!(batch.traces["b"].service_name.len(), 1);
    }

    #[test]
    fn conversion_preserves_range_boundaries_and_count_overflow() {
        let mut hit = summary("a", 1);
        hit["span_count"] = json::json!(65_536);
        let complete = TraceBatch::from_hits(&[hit.clone()], (100, 150), TraceListMode::Complete);
        let streaming = TraceBatch::from_hits(&[hit], (100, 150), TraceListMode::Streaming);
        assert_eq!(complete.range, (100, 150));
        assert_eq!(streaming.range, (100, 151));
        assert_eq!(complete.traces["a"].spans[0], 0);
        assert_eq!(streaming.traces["a"].spans[0], 0);
    }

    #[test]
    fn streaming_still_skips_missing_ids_after_expanding_the_range() {
        let batch = TraceBatch::from_hits(
            &[json::json!({"trace_start_time": 50_000, "trace_end_time": 200_000})],
            (100, 150),
            TraceListMode::Streaming,
        );
        assert!(batch.traces.is_empty());
        assert_eq!(batch.range, (50, 201));
    }

    #[test]
    fn final_sort_uses_computed_duration_or_span_start_time() {
        let first = summary("a", 1);
        let mut second = summary("b", 1);
        second["trace_start_time"] = json::json!(110_000);
        second["max_duration"] = json::json!(100);
        for (by_duration, ascending, expected) in [
            (false, true, ["a", "b"]),
            (false, false, ["b", "a"]),
            (true, true, ["a", "b"]),
            (true, false, ["b", "a"]),
        ] {
            let batch = TraceBatch::from_hits(
                &[first.clone(), second.clone()],
                (100, 150),
                TraceListMode::Complete,
            );
            let hits = batch.into_sorted_items(TraceSort {
                by_duration,
                ascending,
            });
            assert_eq!(
                hits.iter()
                    .map(|hit| hit.trace_id.as_str())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }
}
