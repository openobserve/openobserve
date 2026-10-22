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

use std::time::Duration;

use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        search::{Request, Response},
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
    utils::json,
};
use hashbrown::HashMap;
use infra::errors::Error;
use tokio::time::Instant;

use super::{
    plan::{TraceColumns, TraceListPlan},
    response::TraceBatch,
};
use crate::traces::{
    schema_compat,
    time_index::{self, TraceTimeRange},
};

// The lookup only widens summaries, so a slow index must not hold back the page.
const RANGE_LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

pub struct TraceSearchContext {
    pub org_id: String,
    pub stream_name: String,
    pub user_id: String,
    pub trace_id: String,
}

impl TraceSearchContext {
    pub fn new(org_id: String, stream_name: String, user_id: String, trace_id: String) -> Self {
        Self {
            org_id,
            stream_name,
            user_id,
            trace_id,
        }
    }

    pub async fn search(&self, request: &Request) -> Result<Response, Error> {
        search_service::cache::search(
            &self.trace_id,
            &self.org_id,
            StreamType::Traces,
            Some(self.user_id.clone()),
            request,
            String::new(),
            false,
            None,
            false,
        )
        .await
    }

    /// Swaps each hit's partial aggregates for its trace's aggregates over every indexed span.
    pub async fn summarize_traces(
        &self,
        plan: &TraceListPlan,
        base_request: &Request,
        hits: Vec<json::Value>,
        range: (i64, i64),
    ) -> Result<Vec<json::Value>, Error> {
        let ids = sanitize_trace_ids(
            hits.iter()
                .filter_map(|hit| hit.get("trace_id").and_then(json::Value::as_str)),
        );
        if ids.is_empty() {
            return Ok(hits);
        }
        let lookup_started = std::time::Instant::now();
        let indexed = self.index_ranges(&ids, range).await;
        let lookup_took = lookup_started.elapsed();
        let scope = summary_scope(&ids, &indexed, range, plan.recompute_all());
        let summary_window = scope.as_ref().map(|(_, window)| *window);
        let mut recomputed = 0;
        let mut summary_took = Duration::ZERO;
        let hits = match scope {
            Some((selected, window)) => {
                recomputed = selected.len();
                let request =
                    plan.summary_request(&self.stream_name, base_request, &selected, window);
                let summary_started = std::time::Instant::now();
                let response = self.search(&request).await?;
                summary_took = summary_started.elapsed();
                merge_summaries(hits, response.hits)
            }
            None => hits,
        };
        // Filtered pages ran the summary before the index: only lookup and the widening are new.
        log::info!(
            "[TRACES_LIST trace_id {}] page cost: lookup={}ms summary={}ms filtered={} ids={} indexed={} recomputed={} window={range:?} summary_window={summary_window:?}",
            self.trace_id,
            lookup_took.as_millis(),
            summary_took.as_millis(),
            plan.is_filtered(),
            ids.len(),
            indexed.len(),
            recomputed,
        );
        Ok(hits)
    }

    pub async fn fill_services(
        &self,
        batch: &mut TraceBatch,
        base_request: &Request,
        columns: &TraceColumns,
        range: (i64, i64),
    ) -> Result<(), Error> {
        if batch.multi_service_ids.is_empty() {
            return Ok(());
        }
        let request = service_request(&self.stream_name, batch, base_request, columns, range);
        let response = self.search(&request).await?;
        batch.fill_services(response.hits);
        Ok(())
    }

    // An unanswered lookup degrades to the aggregates already in hand, never to an error.
    async fn index_ranges(
        &self,
        ids: &[String],
        range: (i64, i64),
    ) -> HashMap<String, TraceTimeRange> {
        if !get_config().common.trace_list_time_index_enabled {
            return HashMap::new();
        }
        let around = TraceTimeRange {
            start_time: range.0,
            end_time: range.1,
        };
        let deadline = Instant::now() + RANGE_LOOKUP_TIMEOUT;
        match time_index::lookup_trace_ranges(
            &self.org_id,
            &self.stream_name,
            ids,
            around,
            deadline,
        )
        .await
        {
            Ok(ranges) => ranges.unwrap_or_default(),
            Err(error) => {
                log::warn!(
                    "[trace_id {}] trace time index lookup failed for {}/{}: {error}",
                    self.trace_id,
                    self.org_id,
                    self.stream_name
                );
                HashMap::new()
            }
        }
    }
}

pub fn build_llm_trace_query(
    stream_name: &str,
    validated: &schema_compat::ValidatedLlmSchema,
    extra_selects: &str,
) -> String {
    let stream_ident = quote_identifier(stream_name);
    let first_msg_clause = if validated.has_gen_ai {
        if validated.has_input_messages {
            format!(
                "FIRST_VALUE(gen_ai_input_messages ORDER BY {TIMESTAMP_COL_NAME} ASC) FILTER (WHERE gen_ai_input_messages IS NOT NULL AND gen_ai_input_messages != '')"
            )
        } else {
            "''".to_string()
        }
    } else if validated.has_input_messages {
        format!(
            "FIRST_VALUE(llm_input ORDER BY {TIMESTAMP_COL_NAME} ASC) FILTER (WHERE llm_input IS NOT NULL AND llm_input != '')"
        )
    } else {
        "''".to_string()
    };

    if validated.has_gen_ai {
        let total_tokens_expr = if validated.has_total_tokens {
            "sum(gen_ai_usage_total_tokens) as gen_ai_usage_details_total"
        } else {
            "0 as gen_ai_usage_details_total"
        };
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            sum(gen_ai_usage_input_tokens) as gen_ai_usage_details_input, \
            sum(gen_ai_usage_output_tokens) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(gen_ai_usage_cost) as gen_ai_usage_cost_details, \
            array_agg(DISTINCT gen_ai_response_model) FILTER (WHERE gen_ai_response_model IS NOT NULL AND gen_ai_response_model != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {extra_selects} \
            FROM {stream_ident}"
        )
    } else {
        let total_tokens_expr = if validated.has_total_tokens {
            "sum(llm_usage_tokens_total) as gen_ai_usage_details_total"
        } else {
            "0 as gen_ai_usage_details_total"
        };
        format!(
            "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
            min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
            (max(end_time) - min(start_time)) as zo_sql_duration, \
            sum(llm_usage_tokens_input) as gen_ai_usage_details_input, \
            sum(llm_usage_tokens_output) as gen_ai_usage_details_output, \
            {total_tokens_expr}, \
            sum(llm_usage_cost_total) as gen_ai_usage_cost_details, \
            array_agg(DISTINCT llm_model_name) FILTER (WHERE llm_model_name IS NOT NULL AND llm_model_name != '') as gen_ai_response_models, \
            {first_msg_clause} as gen_ai_input_messages, \
            {extra_selects} \
            FROM {stream_ident}"
        )
    }
}

pub fn build_trace_query(stream_name: &str, extra_selects: &str) -> String {
    format!(
        "SELECT trace_id, min({TIMESTAMP_COL_NAME}) as zo_sql_timestamp, \
        min(start_time) as trace_start_time, max(end_time) as trace_end_time, \
        (max(end_time) - min(start_time)) as zo_sql_duration, \
        {extra_selects} \
        FROM {}",
        quote_identifier(stream_name)
    )
}

pub fn build_partition_query(stream_name: &str) -> String {
    format!("SELECT * FROM {}", quote_identifier(stream_name))
}

pub fn trace_id_list_sql(trace_ids: &[String]) -> String {
    trace_ids
        .iter()
        .map(|id| quote_sql_string(id))
        .collect::<Vec<_>>()
        .join(",")
}

fn build_service_breakdown_query(
    stream_name: &str,
    service_key_expr: &str,
    svc_type_select: &str,
    trace_ids: &[String],
) -> String {
    format!(
        "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
         count(*) AS svc_count, max(duration) AS svc_duration \
         FROM {} WHERE trace_id IN ({}) \
         GROUP BY trace_id, {service_key_expr}",
        quote_identifier(stream_name),
        trace_id_list_sql(trace_ids)
    )
}

// Trace IDs come from stored rows, so they are reduced to hex and '-' before reaching SQL.
fn sanitize_trace_ids<'a>(ids: impl Iterator<Item = &'a str>) -> Vec<String> {
    ids.map(|id| {
        id.chars()
            .filter(|c| c.is_ascii_hexdigit() || *c == '-')
            .collect::<String>()
    })
    .filter(|id| !id.is_empty())
    .collect()
}

/// Traces to re-aggregate and the range covering their spans; only crossers unless `all`.
fn summary_scope(
    ids: &[String],
    indexed: &HashMap<String, TraceTimeRange>,
    range: (i64, i64),
    all: bool,
) -> Option<(Vec<String>, (i64, i64))> {
    let mut scope = range;
    let mut selected = Vec::new();
    for id in ids {
        // max_ts is the last span's end in micros; the search end bound is exclusive.
        let span = indexed
            .get(id)
            .map(|r| (r.start_time, r.end_time.saturating_add(1)));
        let crossing = span.is_some_and(|(start, end)| start < range.0 || end > range.1);
        if !all && !crossing {
            continue;
        }
        selected.push(id.clone());
        if let Some((start, end)) = span {
            scope.0 = scope.0.min(start);
            scope.1 = scope.1.max(end);
        }
    }
    (!selected.is_empty()).then_some((selected, scope))
}

// A hit missing from the full summary keeps its filtered aggregates rather than vanishing.
fn merge_summaries(hits: Vec<json::Value>, full: Vec<json::Value>) -> Vec<json::Value> {
    let mut full = full
        .into_iter()
        .filter_map(|hit| {
            let id = hit.get("trace_id")?.as_str()?.to_string();
            Some((id, hit))
        })
        .collect::<HashMap<_, _>>();
    hits.into_iter()
        .map(|hit| {
            hit.get("trace_id")
                .and_then(json::Value::as_str)
                .and_then(|id| full.remove(id))
                .unwrap_or(hit)
        })
        .collect()
}

fn service_request(
    stream_name: &str,
    batch: &TraceBatch,
    base_request: &Request,
    columns: &TraceColumns,
    range: (i64, i64),
) -> Request {
    let ids = sanitize_trace_ids(batch.multi_service_ids.iter().map(String::as_str));
    // NULL for instrumented services, the inferred kind ("database", "queue", ...) otherwise.
    let service_type = if columns.has_inferred_service {
        ", max(infer_service_type) AS service_type"
    } else {
        ""
    };
    let mut request = base_request.clone();
    request.query.sql =
        build_service_breakdown_query(stream_name, columns.service_key(), service_type, &ids);
    request.query.from = 0;
    // The breakdown has at most one row per service counted in Q1, so one request fetches all.
    request.query.size = batch.multi_service_total;
    request.query.start_time = range.0;
    request.query.end_time = range.1;
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_llm_trace_query_quotes_stream_name() {
        for has_gen_ai in [true, false] {
            let validated = schema_compat::ValidatedLlmSchema::fallback(has_gen_ai);
            let sql = build_llm_trace_query("default", &validated, "count(*) AS span_count");
            assert!(sql.ends_with("FROM \"default\""), "{sql}");
        }
    }

    #[test]
    fn test_build_llm_trace_query_escapes_quote_in_stream_name() {
        for has_gen_ai in [true, false] {
            let validated = schema_compat::ValidatedLlmSchema::fallback(has_gen_ai);
            let sql = build_llm_trace_query("evil\" x", &validated, "count(*) AS span_count");
            assert!(sql.ends_with("FROM \"evil\"\" x\""), "{sql}");
        }
    }

    #[test]
    fn test_trace_builders_quote_stream_name() {
        assert!(
            build_trace_query("default", "count(*) AS span_count")
                .ends_with("count(*) AS span_count FROM \"default\"")
        );
        assert_eq!(
            build_service_breakdown_query(
                "default",
                "service_name",
                "",
                &["a".to_string(), "b".to_string()]
            ),
            "SELECT trace_id, service_name AS service_name, count(*) AS svc_count, \
             max(duration) AS svc_duration FROM \"default\" WHERE trace_id IN ('a','b') \
             GROUP BY trace_id, service_name"
        );
        assert_eq!(
            build_partition_query("default"),
            "SELECT * FROM \"default\""
        );
    }

    #[test]
    fn test_build_trace_query_escapes_quote_in_stream_name() {
        let sql = build_trace_query("evil\" x", "count(*) AS span_count");
        assert!(sql.ends_with("FROM \"evil\"\" x\""), "{sql}");
    }

    #[test]
    fn test_build_service_breakdown_query_escapes_quote_in_stream_name() {
        let sql = build_service_breakdown_query("evil\" x", "service_name", "", &["a".to_string()]);
        assert!(sql.contains("FROM \"evil\"\" x\" WHERE"), "{sql}");
    }

    #[test]
    fn test_build_service_breakdown_query_quotes_trace_ids() {
        let ids = ["a".to_string(), "x') OR ('1'='1".to_string()];
        let sql = build_service_breakdown_query("default", "service_name", "", &ids);
        assert!(
            sql.contains("WHERE trace_id IN ('a','x'') OR (''1''=''1') GROUP BY"),
            "{sql}"
        );
    }

    #[test]
    fn test_build_partition_query_escapes_quote_in_stream_name() {
        assert_eq!(
            build_partition_query("evil\" x"),
            "SELECT * FROM \"evil\"\" x\""
        );
    }

    #[test]
    fn full_summaries_replace_filtered_aggregates_in_page_order() {
        let filtered = vec![
            json::json!({"trace_id": "t", "trace_start_time": 20_000, "trace_end_time": 40_000,
                "span_count": 1, "error_count": 0, "service_count": 1,
                "first_service_name": "api"}),
            json::json!({"trace_id": "gone", "span_count": 1}),
        ];
        let full = vec![
            json::json!({"trace_id": "other", "span_count": 9}),
            json::json!({"trace_id": "t", "trace_start_time": 0, "trace_end_time": 100_000,
                "span_count": 3, "error_count": 1, "service_count": 3,
                "root_service_name": "gateway", "root_operation_name": "root"}),
        ];
        let merged = merge_summaries(filtered, full);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0]["span_count"], 3);
        assert_eq!(
            merged[1],
            json::json!({"trace_id": "gone", "span_count": 1})
        );

        let batch = TraceBatch::from_hits(&merged, (0, 1));
        assert_eq!(batch.multi_service_ids, ["t"]);
        let item = json::to_value(&batch.traces["t"]).unwrap();
        assert_eq!(item["spans"], json::json!([3, 1]));
        assert_eq!(item["duration"], 100);
        assert_eq!(item["first_event"]["service_name"], "gateway");
    }

    #[test]
    fn unfiltered_scope_recomputes_only_traces_the_index_places_outside_the_range() {
        let ids = ["inside", "older", "newer", "unindexed"]
            .map(String::from)
            .to_vec();
        let indexed = HashMap::from_iter([
            ("inside".to_string(), index_range(110, 140)),
            ("older".to_string(), index_range(90, 120)),
            ("newer".to_string(), index_range(130, 170)),
        ]);
        let (selected, range) = summary_scope(&ids, &indexed, (100, 150), false).unwrap();
        assert_eq!(selected, ["older", "newer"]);
        assert_eq!(range, (90, 171));

        let unindexed = HashMap::new();
        assert!(summary_scope(&ids, &unindexed, (100, 150), false).is_none());
        let contained = HashMap::from_iter([("inside".to_string(), index_range(100, 149))]);
        assert!(summary_scope(&ids, &contained, (100, 150), false).is_none());
    }

    #[test]
    fn filtered_scope_recomputes_every_trace_over_the_widened_range() {
        let ids = ["a", "b"].map(String::from).to_vec();
        let indexed = HashMap::from_iter([("b".to_string(), index_range(50, 120))]);
        let (selected, range) = summary_scope(&ids, &indexed, (100, 150), true).unwrap();
        assert_eq!(selected, ["a", "b"]);
        assert_eq!(range, (50, 150));
        let (selected, range) = summary_scope(&ids, &HashMap::new(), (100, 150), true).unwrap();
        assert_eq!(selected, ["a", "b"]);
        assert_eq!(range, (100, 150));
        assert!(summary_scope(&[], &indexed, (100, 150), true).is_none());
    }

    fn index_range(start_time: i64, end_time: i64) -> TraceTimeRange {
        TraceTimeRange {
            start_time,
            end_time,
        }
    }

    #[test]
    fn trace_ids_are_reduced_to_hex_and_dashes() {
        assert_eq!(
            sanitize_trace_ids(["a-B!", "x') OR 1=1", "zz"].into_iter()),
            ["a-B", "11"]
        );
    }

    #[test]
    fn service_followup_preserves_request_settings_and_uses_coordinator_range() {
        use config::{meta::search::SearchEventType, utils::json};
        use hashbrown::HashMap;

        use super::super::plan::{TraceListMode, TraceListOptions, TraceListPlan, TraceSort};

        let query = HashMap::from_iter([
            ("start_time".to_string(), "100".to_string()),
            ("end_time".to_string(), "150".to_string()),
            ("timeout".to_string(), "17".to_string()),
            ("use_cache".to_string(), "false".to_string()),
            ("from".to_string(), "10".to_string()),
            ("size".to_string(), "25".to_string()),
        ]);
        for mode in [TraceListMode::Complete, TraceListMode::Streaming] {
            let plan = TraceListPlan {
                options: TraceListOptions::parse(&query, mode).unwrap(),
                sort: TraceSort::parse(&query).unwrap(),
                columns: TraceColumns::default(),
                llm_schema: None,
                mode,
            };
            let base = plan.request("stream");
            assert_eq!(
                base.search_type,
                match mode {
                    TraceListMode::Complete => None,
                    TraceListMode::Streaming => Some(SearchEventType::UI),
                }
            );
            let batch = TraceBatch::from_hits(
                &[json::json!({
                    "trace_id": "a-b!", "trace_start_time": 50_000, "trace_end_time": 200_000,
                    "zo_sql_duration": 150_000, "service_count": 2,
                })],
                (100, 150),
            );
            let range = match mode {
                TraceListMode::Complete => (100, 150),
                TraceListMode::Streaming => batch.range,
            };
            let request = service_request("stream", &batch, &base, &plan.columns, range);
            assert_eq!(
                request.query.sql,
                "SELECT trace_id, service_name AS service_name, count(*) AS svc_count, max(duration) AS svc_duration FROM \"stream\" WHERE trace_id IN ('a-b') GROUP BY trace_id, service_name"
            );
            assert_eq!((request.query.from, request.query.size), (0, 2));
            assert_eq!((request.query.start_time, request.query.end_time), range);
            assert_eq!(request.timeout, 17);
            assert!(!request.use_cache);
            assert_eq!(request.search_type, base.search_type);
            assert_eq!((base.query.from, base.query.size), (10, 25));
            assert_eq!((base.query.start_time, base.query.end_time), (100, 150));
        }
    }
}
