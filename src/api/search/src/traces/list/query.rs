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

use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        search::{Request, Response},
        stream::StreamType,
        traces::session::{quote_identifier, quote_sql_string},
    },
};
use infra::errors::Error;

use super::{plan::TraceSchema, response::TraceBatch};
use crate::traces::schema_compat;

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

    pub async fn fill_services(
        &self,
        batch: &mut TraceBatch,
        base_request: &Request,
        schema: &TraceSchema,
        range: (i64, i64),
    ) -> Result<(), Error> {
        if batch.multi_service_ids.is_empty() {
            return Ok(());
        }
        let request = service_request(&self.stream_name, batch, base_request, schema, range);
        let response = self.search(&request).await?;
        batch.fill_services(response.hits);
        Ok(())
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

fn build_service_breakdown_query(
    stream_name: &str,
    service_key_expr: &str,
    svc_type_select: &str,
    trace_ids: &[String],
) -> String {
    let trace_ids_sql = trace_ids
        .iter()
        .map(|id| quote_sql_string(id))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "SELECT trace_id, {service_key_expr} AS service_name{svc_type_select}, \
         count(*) AS svc_count, max(duration) AS svc_duration \
         FROM {} WHERE trace_id IN ({trace_ids_sql}) \
         GROUP BY trace_id, {service_key_expr}",
        quote_identifier(stream_name)
    )
}

pub fn build_partition_query(stream_name: &str) -> String {
    format!("SELECT * FROM {}", quote_identifier(stream_name))
}

fn service_request(
    stream_name: &str,
    batch: &TraceBatch,
    base_request: &Request,
    schema: &TraceSchema,
    range: (i64, i64),
) -> Request {
    let ids = batch
        .multi_service_ids
        .iter()
        .map(|id| {
            id.chars()
                .filter(|c| c.is_ascii_hexdigit() || *c == '-')
                .collect::<String>()
        })
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    let service_type = if schema.has_infer {
        ", max(infer_service_type) AS service_type"
    } else {
        ""
    };
    let mut request = base_request.clone();
    request.query.sql =
        build_service_breakdown_query(stream_name, schema.service_key(), service_type, &ids);
    request.query.from = 0;
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
                schema: TraceSchema::default(),
                validated: None,
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
                mode,
            );
            let range = match mode {
                TraceListMode::Complete => (100, 150),
                TraceListMode::Streaming => batch.range,
            };
            let request = service_request("stream", &batch, &base, &plan.schema, range);
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
