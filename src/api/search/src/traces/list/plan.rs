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

use arrow_schema::Schema;
use config::{
    TIMESTAMP_COL_NAME,
    meta::search::{Query, Request, SearchEventType},
    utils::time::now_micros,
};
use hashbrown::HashMap;

use super::{
    query::{build_llm_trace_query, build_trace_query, trace_id_list_sql},
    response::TraceResponseItem,
};
use crate::{common::utils::http::get_use_cache_from_request, traces::schema_compat};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TraceListMode {
    Complete,
    Streaming,
}

pub struct TraceListPlan {
    pub options: TraceListOptions,
    pub sort: TraceSort,
    pub columns: TraceColumns,
    pub llm_schema: Option<schema_compat::ValidatedLlmSchema>,
    pub mode: TraceListMode,
}

impl TraceListPlan {
    pub fn request(&self, stream_name: &str) -> Request {
        Request {
            query: Query {
                sql: self.sql(stream_name),
                from: self.options.from,
                size: self.options.size,
                start_time: self.options.range.0,
                end_time: self.options.range.1,
                ..Default::default()
            },
            timeout: self.options.timeout,
            use_cache: self.options.use_cache,
            search_type: match self.mode {
                TraceListMode::Complete => None,
                TraceListMode::Streaming => Some(SearchEventType::UI),
            },
            ..Default::default()
        }
    }

    /// Re-aggregates the selected traces over all their spans in `range`, without the filter.
    pub fn summary_request(
        &self,
        stream_name: &str,
        base_request: &Request,
        trace_ids: &[String],
        range: (i64, i64),
    ) -> Request {
        let mut request = base_request.clone();
        request.query.sql = format!(
            "{} WHERE trace_id IN ({}) GROUP BY trace_id",
            self.select_sql(stream_name),
            trace_id_list_sql(trace_ids)
        );
        request.query.from = 0;
        request.query.size = trace_ids.len() as i64;
        request.query.start_time = range.0;
        request.query.end_time = range.1;
        request
    }

    pub fn is_filtered(&self) -> bool {
        !self.filter().is_empty()
    }

    // Heap rows of the streamed duration sort are per-partition aggregates.
    pub fn recompute_all(&self) -> bool {
        self.is_filtered() || (self.mode == TraceListMode::Streaming && self.sort.by_duration)
    }

    fn sql(&self, stream_name: &str) -> String {
        let sql = self.select_sql(stream_name);
        let filter = self.filter();
        let order = self.sort.sql();
        if filter.is_empty() {
            format!("{sql} GROUP BY trace_id ORDER BY {order}")
        } else {
            format!("{sql} WHERE {filter} GROUP BY trace_id ORDER BY {order}")
        }
    }

    fn select_sql(&self, stream_name: &str) -> String {
        let extra_selects = self.columns.aggregate_selects();
        match &self.llm_schema {
            Some(llm_schema) => build_llm_trace_query(stream_name, llm_schema, &extra_selects),
            None => build_trace_query(stream_name, &extra_selects),
        }
    }

    fn filter(&self) -> String {
        match self.mode {
            TraceListMode::Complete => self.options.filter.clone(),
            TraceListMode::Streaming => self
                .options
                .filter
                .replace("--", "")
                .replace(';', "")
                .trim()
                .to_string(),
        }
    }
}

pub struct TraceListOptions {
    pub filter: String,
    pub from: i64,
    pub size: i64,
    pub range: (i64, i64),
    timeout: i64,
    pub use_cache: bool,
    pub range_error: String,
}

impl TraceListOptions {
    pub fn parse(query: &HashMap<String, String>, mode: TraceListMode) -> Result<Self, String> {
        let filter = query.get("filter").cloned().unwrap_or_default();
        // Streaming rejects a bad filter before any other 400; complete checks it last in prepare.
        if mode == TraceListMode::Streaming {
            validate_filter(&filter)?;
        }
        let start = query
            .get("start_time")
            .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
        if start == 0 {
            return Err("start_time is empty".to_string());
        }
        let end = query
            .get("end_time")
            .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
        if end == 0 {
            return Err("end_time is empty".to_string());
        }
        let mut options = Self {
            filter,
            from: query
                .get("from")
                .map_or(0, |v| v.parse::<i64>().unwrap_or(0)),
            size: query
                .get("size")
                .map_or(10, |v| v.parse::<i64>().unwrap_or(10)),
            range: (start, end),
            timeout: query
                .get("timeout")
                .map_or(0, |v| v.parse::<i64>().unwrap_or(0)),
            use_cache: get_use_cache_from_request(query),
            range_error: String::new(),
        };
        let trace_time = query
            .get("trace_id")
            .cloned()
            .or_else(|| {
                options
                    .filter
                    .split("trace_id=")
                    .nth(1)
                    .and_then(|value| value.split('&').next())
                    .and_then(|value| value.split(' ').next())
                    .map(|value| value.replace(['\'', '"'], ""))
                    .filter(|value| !value.is_empty())
            })
            .and_then(|id| config::ider::get_start_time_from_trace_id(&id))
            .unwrap_or(0);
        options.apply_trace_time(trace_time, mode, now_micros());
        Ok(options)
    }

    pub fn restrict_range(&mut self, max_hours: i64) {
        if max_hours > 0 && (self.range.1 - self.range.0) > max_hours * 3600 * 1_000_000 {
            self.range.0 = self.range.1 - max_hours * 3600 * 1_000_000;
            self.range_error = format!(
                "Query duration is modified due to query range restriction of {max_hours} hours"
            );
        }
    }

    fn apply_trace_time(&mut self, timestamp: i64, mode: TraceListMode, now: i64) {
        if timestamp <= 0 {
            return;
        }
        match mode {
            // Re-ingested spans can sit far from the trace_id's time; narrowing then finds nothing.
            TraceListMode::Complete if timestamp >= self.range.0 && timestamp <= self.range.1 => {
                self.range = (
                    timestamp - 60 * 1_000_000,
                    now.min(timestamp + 3600 * 1_000_000),
                );
            }
            TraceListMode::Streaming => {
                self.range = (timestamp - 60 * 1_000_000, timestamp + 3600 * 1_000_000);
            }
            TraceListMode::Complete => {}
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct TraceSort {
    pub by_duration: bool,
    pub ascending: bool,
}

impl TraceSort {
    pub fn parse(query: &HashMap<String, String>) -> Result<Self, String> {
        let field = query
            .get("sort_by")
            .map_or("start_time", String::as_str)
            .to_lowercase();
        let by_duration = match field.as_str() {
            "duration" => true,
            "start_time" | "_timestamp" => false,
            _ => {
                return Err(
                    "Invalid sort_by field, only support duration and start_time".to_string(),
                );
            }
        };
        let ascending = query
            .get("sort_order")
            .map_or("desc", String::as_str)
            .to_lowercase()
            == "asc";
        Ok(Self {
            by_duration,
            ascending,
        })
    }

    pub fn sql(self) -> String {
        let field = if self.by_duration {
            "zo_sql_duration"
        } else {
            "zo_sql_timestamp"
        };
        let order = if self.ascending { "ASC" } else { "DESC" };
        format!("{field} {order}")
    }

    pub fn sort(self, hits: &mut [TraceResponseItem]) {
        let key = |hit: &TraceResponseItem| {
            if self.by_duration {
                hit.duration
            } else {
                hit.start_time
            }
        };
        if self.ascending {
            hits.sort_by_key(key);
        } else {
            hits.sort_by_key(|hit| std::cmp::Reverse(key(hit)));
        }
    }
}

#[derive(Default)]
pub struct TraceColumns {
    has_ref_parent_id: bool,
    pub has_inferred_service: bool,
}

impl TraceColumns {
    pub fn from_schema(schema: Option<&Schema>) -> Self {
        Self {
            has_ref_parent_id: schema
                .is_some_and(|s| s.field_with_name("reference_parent_span_id").is_ok()),
            has_inferred_service: schema.is_some_and(|s| {
                s.field_with_name(openobserve_core::traces::inferred::INFER_SERVICE_NAME)
                    .is_ok()
            }),
        }
    }

    pub fn service_key(&self) -> &'static str {
        if self.has_inferred_service {
            "COALESCE(infer_service_name, service_name)"
        } else {
            "service_name"
        }
    }

    fn aggregate_selects(&self) -> String {
        let service_key = self.service_key();
        let (root_service, root_operation) = if self.has_ref_parent_id {
            (
                "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN service_name END)",
                "max(CASE WHEN reference_parent_span_id IS NULL OR reference_parent_span_id = '' THEN operation_name END)",
            )
        } else {
            ("null", "null")
        };
        format!(
            "count(*) AS span_count, \
             sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS error_count, \
             max(duration) AS max_duration, \
             count(DISTINCT {service_key}) AS service_count, \
             {root_service} AS root_service_name, \
             {root_operation} AS root_operation_name, \
             first_value(service_name ORDER BY {TIMESTAMP_COL_NAME} ASC, end_time DESC) AS first_service_name, \
             first_value(operation_name ORDER BY {TIMESTAMP_COL_NAME} ASC, end_time DESC) AS first_operation_name"
        )
    }
}

pub fn validate_filter(filter: &str) -> Result<(), String> {
    config::utils::sql::validate_optional_where_fragment(filter)
        .map_err(|error| format!("invalid filter: {error}"))
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field};

    use super::*;

    fn query() -> HashMap<String, String> {
        HashMap::from_iter([
            ("start_time".to_string(), "100000000".to_string()),
            ("end_time".to_string(), "200000000".to_string()),
        ])
    }

    #[test]
    fn parsing_preserves_defaults_and_unclamped_pagination() {
        for mode in [TraceListMode::Complete, TraceListMode::Streaming] {
            let mut query = query();
            let defaults = TraceListOptions::parse(&query, mode).unwrap();
            assert_eq!((defaults.from, defaults.size, defaults.timeout), (0, 10, 0));
            query.insert("from".to_string(), "-2".to_string());
            query.insert("size".to_string(), "-1".to_string());
            let options = TraceListOptions::parse(&query, mode).unwrap();
            assert_eq!((options.from, options.size), (-2, -1));
            query.insert("size".to_string(), "invalid".to_string());
            assert_eq!(TraceListOptions::parse(&query, mode).unwrap().size, 10);
        }
    }

    #[test]
    fn trace_time_keeps_distinct_window_rules() {
        let mut complete = TraceListOptions::parse(&query(), TraceListMode::Complete).unwrap();
        let mut streaming = TraceListOptions::parse(&query(), TraceListMode::Streaming).unwrap();
        complete.apply_trace_time(50_000_000, TraceListMode::Complete, 300_000_000);
        streaming.apply_trace_time(50_000_000, TraceListMode::Streaming, 300_000_000);
        assert_eq!(complete.range, (100_000_000, 200_000_000));
        assert_eq!(streaming.range, (-10_000_000, 3_650_000_000));

        complete.apply_trace_time(150_000_000, TraceListMode::Complete, 300_000_000);
        streaming.apply_trace_time(150_000_000, TraceListMode::Streaming, 300_000_000);
        assert_eq!(complete.range, (90_000_000, 300_000_000));
        assert_eq!(streaming.range, (90_000_000, 3_750_000_000));
    }

    #[test]
    fn range_restriction_keeps_the_end_and_reports_the_limit() {
        let mut options = TraceListOptions::parse(&query(), TraceListMode::Complete).unwrap();
        options.range = (1, 8_000_000_000);
        options.restrict_range(1);
        assert_eq!(options.range, (4_400_000_000, 8_000_000_000));
        assert_eq!(
            options.range_error,
            "Query duration is modified due to query range restriction of 1 hours"
        );
    }

    #[test]
    fn sql_preserves_filter_scope_and_schema_expressions() {
        let schema = Schema::new(vec![
            Field::new("reference_parent_span_id", DataType::Utf8, true),
            Field::new("infer_service_name", DataType::Utf8, true),
        ]);
        for mode in [TraceListMode::Complete, TraceListMode::Streaming] {
            let mut query = query();
            query.insert(
                "filter".to_string(),
                "service_name = 'api' OR span_status = 'ERROR'".to_string(),
            );
            query.insert("sort_by".to_string(), "DURATION".to_string());
            query.insert("sort_order".to_string(), "ASC".to_string());
            let plan = TraceListPlan {
                options: TraceListOptions::parse(&query, mode).unwrap(),
                sort: TraceSort::parse(&query).unwrap(),
                columns: TraceColumns::from_schema(Some(&schema)),
                llm_schema: None,
                mode,
            };
            let sql = plan.sql("trace\" stream");
            assert!(sql.contains(
                "count(DISTINCT COALESCE(infer_service_name, service_name)) AS service_count"
            ));
            assert!(
                sql.contains("reference_parent_span_id IS NULL OR reference_parent_span_id = ''")
            );
            assert!(sql.ends_with("FROM \"trace\"\" stream\" WHERE service_name = 'api' OR span_status = 'ERROR' GROUP BY trace_id ORDER BY zo_sql_duration ASC"));
        }
    }

    #[test]
    fn summary_request_drops_the_filter_and_keys_on_the_selected_traces() {
        let ids = ["t1".to_string(), "t2".to_string()];
        for mode in [TraceListMode::Complete, TraceListMode::Streaming] {
            let mut query = query();
            query.insert("timeout".to_string(), "17".to_string());
            query.insert("from".to_string(), "10".to_string());
            query.insert("size".to_string(), "25".to_string());
            let unfiltered = TraceListPlan {
                options: TraceListOptions::parse(&query, mode).unwrap(),
                sort: TraceSort::parse(&query).unwrap(),
                columns: TraceColumns::default(),
                llm_schema: None,
                mode,
            };
            assert!(!unfiltered.is_filtered());
            query.insert("filter".to_string(), "service_name = 'api'".to_string());
            let filtered = TraceListPlan {
                options: TraceListOptions::parse(&query, mode).unwrap(),
                ..unfiltered
            };
            assert!(filtered.is_filtered());
            let base = filtered.request("traces");
            let request = filtered.summary_request("traces", &base, &ids, (1, 2));
            assert!(!request.query.sql.contains("service_name = 'api'"));
            assert!(request.query.sql.contains("count(*) AS span_count"));
            assert!(
                request
                    .query
                    .sql
                    .ends_with("FROM \"traces\" WHERE trace_id IN ('t1','t2') GROUP BY trace_id")
            );
            assert_eq!((request.query.from, request.query.size), (0, 2));
            assert_eq!((request.query.start_time, request.query.end_time), (1, 2));
            assert_eq!(request.timeout, 17);
            assert_eq!(request.search_type, base.search_type);
        }
    }

    #[test]
    fn only_filtered_pages_and_the_streamed_duration_sort_recompute_every_trace() {
        for (sort_by, filter, expected) in [
            ("start_time", "", [false, false]),
            ("duration", "", [false, true]),
            ("start_time", "service_name = 'api'", [true, true]),
        ] {
            let mut query = query();
            query.insert("sort_by".to_string(), sort_by.to_string());
            if !filter.is_empty() {
                query.insert("filter".to_string(), filter.to_string());
            }
            for (mode, expected) in [TraceListMode::Complete, TraceListMode::Streaming]
                .into_iter()
                .zip(expected)
            {
                let plan = TraceListPlan {
                    options: TraceListOptions::parse(&query, mode).unwrap(),
                    sort: TraceSort::parse(&query).unwrap(),
                    columns: TraceColumns::default(),
                    llm_schema: None,
                    mode,
                };
                assert_eq!(
                    plan.recompute_all(),
                    expected,
                    "{sort_by} {filter:?} {mode:?}"
                );
            }
        }
    }

    #[test]
    fn streaming_filter_normalization_remains_separate() {
        let mut query = query();
        query.insert(
            "filter".to_string(),
            "operation_name = 'a;b--c'".to_string(),
        );
        for (mode, expected) in [
            (TraceListMode::Complete, "operation_name = 'a;b--c'"),
            (TraceListMode::Streaming, "operation_name = 'abc'"),
        ] {
            let plan = TraceListPlan {
                options: TraceListOptions::parse(&query, mode).unwrap(),
                sort: TraceSort::parse(&query).unwrap(),
                columns: TraceColumns::default(),
                llm_schema: None,
                mode,
            };
            assert!(plan.sql("traces").contains(expected));
        }
    }
}
