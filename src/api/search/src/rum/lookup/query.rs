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
    TIMESTAMP_COL_NAME,
    meta::{
        search::{
            Query, Request, RequestEncoding, Response as SearchResponse, SearchEventType,
            default_use_cache,
        },
        stream::StreamType,
        traces::session::{key_in_predicate, quote_identifier, quote_sql_string},
    },
    utils::json,
};
use search_service as SearchService;
use serde::Serialize;
use tokio::time::Instant;
use utoipa::ToSchema;

use super::{
    HOUR_US, RUM_DATA_STREAM,
    response::{RumQueryDiagnostics, RumQueryError, RumQueryErrorKind},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumQuery {
    TracedResources,
    Views,
    Actions,
    ContextEvents,
}

impl RumQuery {
    fn as_str(self) -> &'static str {
        match self {
            Self::TracedResources => "traced_resources",
            Self::Views => "views",
            Self::Actions => "actions",
            Self::ContextEvents => "context_events",
        }
    }

    fn limit(self) -> usize {
        match self {
            Self::TracedResources => 10,
            Self::Views => 50,
            Self::Actions | Self::ContextEvents => 250,
        }
    }

    /// `ids` are trace id variants for the traced resources, else view or action ids.
    fn sql(self, trace_columns: &[&str], ids: &[String]) -> String {
        let ids_in = |column: &str| key_in_predicate(column, ids.iter().map(String::as_str));
        let (filter, order) = match self {
            Self::TracedResources => {
                // OR of equalities rather than COALESCE so each column can use its own index.
                let any_id = trace_columns
                    .iter()
                    .flat_map(|column| {
                        ids.iter()
                            .map(move |id| format!("{column} = {}", quote_sql_string(id)))
                    })
                    .collect::<Vec<_>>()
                    .join(" OR ");
                (format!("({any_id})"), "ASC")
            }
            // Newest first: a view is re-sent on every update and only its last document is final.
            Self::Views => (format!("{} AND type = 'view'", ids_in("view_id")), "DESC"),
            Self::Actions => (
                format!("{} AND type = 'action'", ids_in("action_id")),
                "ASC",
            ),
            Self::ContextEvents => (
                format!(
                    "{} AND type IN ('error', 'resource', 'long_task', 'action')",
                    ids_in("view_id")
                ),
                "ASC",
            ),
        };
        format!(
            "SELECT * FROM {} WHERE {filter} ORDER BY {TIMESTAMP_COL_NAME} {order}",
            quote_identifier(RUM_DATA_STREAM)
        )
    }

    /// Asks for one row past the limit to detect truncation.
    fn request(self, sql: String, range: (i64, i64), budget: Duration) -> Request {
        Request {
            query: Query {
                sql,
                from: 0,
                size: self.limit() as i64 + 1,
                start_time: range.0,
                end_time: range.1,
                quick_mode: false,
                query_type: String::new(),
                track_total_hits: false,
                uses_zo_fn: false,
                query_fn: None,
                skip_wal: false,
                sampling_config: None,
                sampling_ratio: None,
                streaming_output: false,
                streaming_id: None,
                histogram_interval: 0,
                timezone: None,
            },
            encoding: RequestEncoding::Empty,
            regions: vec![],
            clusters: vec![],
            timeout: budget.as_millis().div_ceil(1000) as i64,
            search_type: Some(SearchEventType::RUM),
            search_event_context: None,
            use_cache: default_use_cache(),
            clear_cache: false,
            local_mode: None,
            agent_options: None,
        }
    }
}

pub(super) struct LookupContext {
    pub(super) org_id: String,
    pub(super) user_id: String,
    pub(super) trace_id: String,
    pub(super) trace_columns: Vec<&'static str>,
    pub(super) deadline: Instant,
    pub(super) max_query_range_us: i64,
}

impl LookupContext {
    /// Skipped, returning `None`, when there is no id to filter on.
    pub(super) async fn run(
        &self,
        query: RumQuery,
        ids: &[String],
        range: (i64, i64),
    ) -> Option<QueryOutcome> {
        if ids.is_empty() {
            return None;
        }
        let started = Instant::now();
        let remaining = self.deadline.saturating_duration_since(started);
        if remaining.is_zero() {
            return Some(QueryOutcome::failed(
                query,
                RumQueryErrorKind::Timeout,
                "lookup deadline passed before the query started".to_string(),
            ));
        }
        let (range, range_error) = self.clamp_range(range);
        let sql = query.sql(&self.trace_columns, ids);
        let request = query.request(sql, range, remaining);
        let trace_id = format!("{}-{}", self.trace_id, query.as_str());
        let search = SearchService::cache::search(
            &trace_id,
            &self.org_id,
            StreamType::Logs,
            Some(self.user_id.clone()),
            &request,
            range_error,
            false,
            None,
            false,
        );
        // The search's own timeout starts only at execution, after file listing and queueing.
        let Ok(response) = tokio::time::timeout(remaining, search).await else {
            self.cancel(trace_id);
            return Some(QueryOutcome::failed(
                query,
                RumQueryErrorKind::Timeout,
                format!(
                    "no result within the {} ms left of the lookup budget",
                    remaining.as_millis()
                ),
            ));
        };
        Some(match response {
            Ok(response) => QueryOutcome::from_response(query, range, started.elapsed(), response),
            Err(e) => QueryOutcome::failed(query, RumQueryErrorKind::from(&e), e.to_string()),
        })
    }

    /// Dropping a search skips its cleanup, so a timed-out one is cancelled to free its slot.
    fn cancel(&self, trace_id: String) {
        #[cfg(feature = "enterprise")]
        {
            let org_id = self.org_id.clone();
            tokio::spawn(async move {
                if let Err(e) = SearchService::cancel_query(&org_id, &trace_id).await {
                    log::warn!(
                        "[trace_id {trace_id}] rum lookup could not cancel a timed-out query: {e}"
                    );
                }
            });
        }
        #[cfg(not(feature = "enterprise"))]
        let _ = trace_id;
    }

    fn clamp_range(&self, range: (i64, i64)) -> ((i64, i64), String) {
        let max_range_us = self.max_query_range_us;
        if max_range_us <= 0 || range.1.saturating_sub(range.0) <= max_range_us {
            return (range, String::new());
        }
        (
            (range.1 - max_range_us, range.1),
            format!(
                "Query duration is modified due to query range restriction of {} hours",
                max_range_us / HOUR_US
            ),
        )
    }
}

pub(super) struct QueryOutcome {
    pub(super) query: RumQuery,
    pub(super) hits: Vec<json::Value>,
    pub(super) truncated: bool,
    pub(super) error: Option<RumQueryError>,
    pub(super) diagnostics: Option<RumQueryDiagnostics>,
}

impl QueryOutcome {
    pub(super) fn failed(query: RumQuery, kind: RumQueryErrorKind, message: String) -> Self {
        Self {
            query,
            hits: Vec::new(),
            truncated: false,
            error: Some(RumQueryError {
                query,
                kind,
                message,
            }),
            diagnostics: None,
        }
    }

    /// Cuts the `limit + 1` sentinel row, which only signals truncation.
    pub(super) fn from_response(
        query: RumQuery,
        range: (i64, i64),
        took: Duration,
        mut response: SearchResponse,
    ) -> Self {
        let truncated = response.hits.len() > query.limit();
        response.hits.truncate(query.limit());
        let error = response.is_partial.then(|| RumQueryError {
            query,
            kind: RumQueryErrorKind::Partial,
            message: if response.function_error.is_empty() {
                "search returned partial results".to_string()
            } else {
                response.function_error.join("; ")
            },
        });
        let diagnostics = RumQueryDiagnostics {
            query,
            start_time: range.0,
            end_time: range.1,
            took: took.as_millis() as usize,
            search_took: response.took_detail.search_took,
            wait_in_queue: response.took_detail.wait_in_queue,
            scan_files: response.scan_files,
            scan_size: response.scan_size,
            scan_records: response.scan_records,
            cached_ratio: response.cached_ratio,
            result_cache_ratio: response.result_cache_ratio,
            hits: response.hits.len(),
        };
        Self {
            query,
            hits: response.hits,
            truncated,
            error,
            diagnostics: Some(diagnostics),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rum::lookup::tests::search_response;

    fn context(max_query_range_us: i64) -> LookupContext {
        LookupContext {
            org_id: String::new(),
            user_id: String::new(),
            trace_id: String::new(),
            trace_columns: vec![],
            deadline: Instant::now(),
            max_query_range_us,
        }
    }

    #[test]
    fn test_traced_resources_sql_covers_every_column_and_variant() {
        assert_eq!(
            RumQuery::TracedResources.sql(
                &["_o2_trace_id", "_oo_trace_id"],
                &["0abc".to_string(), "abc".to_string()]
            ),
            "SELECT * FROM \"_rumdata\" WHERE (_o2_trace_id = '0abc' OR _o2_trace_id = 'abc' OR _oo_trace_id = '0abc' OR _oo_trace_id = 'abc') ORDER BY _timestamp ASC"
        );
        assert_eq!(
            RumQuery::TracedResources.sql(&["_oo_trace_id"], &["it's".to_string()]),
            "SELECT * FROM \"_rumdata\" WHERE (_oo_trace_id = 'it''s') ORDER BY _timestamp ASC"
        );
    }

    #[test]
    fn test_page_queries_keep_their_filters_and_order() {
        let ids = vec!["v1".to_string(), "v'2".to_string()];
        assert_eq!(
            RumQuery::Views.sql(&[], &ids),
            "SELECT * FROM \"_rumdata\" WHERE \"view_id\" IN ('v1', 'v''2') AND type = 'view' ORDER BY _timestamp DESC"
        );
        assert_eq!(
            RumQuery::Actions.sql(&[], &["a1".to_string()]),
            "SELECT * FROM \"_rumdata\" WHERE \"action_id\" IN ('a1') AND type = 'action' ORDER BY _timestamp ASC"
        );
        assert_eq!(
            RumQuery::ContextEvents.sql(&[], &ids),
            "SELECT * FROM \"_rumdata\" WHERE \"view_id\" IN ('v1', 'v''2') AND type IN ('error', 'resource', 'long_task', 'action') ORDER BY _timestamp ASC"
        );
    }

    #[tokio::test]
    async fn test_run_skips_a_query_without_ids() {
        assert!(
            context(0)
                .run(RumQuery::Actions, &[], (1, 2))
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn test_run_reports_a_spent_budget_as_timeout() {
        let outcome = context(0)
            .run(RumQuery::Views, &["v1".to_string()], (1, 2))
            .await
            .unwrap();
        assert_eq!(outcome.error.unwrap().kind, RumQueryErrorKind::Timeout);
        assert!(outcome.hits.is_empty());
    }

    #[test]
    fn test_outcome_drops_the_sentinel_row() {
        let outcome = QueryOutcome::from_response(
            RumQuery::Views,
            (1, 2),
            Duration::ZERO,
            search_response(51),
        );
        assert!(outcome.truncated);
        assert_eq!(outcome.hits.len(), 50);
        assert!(outcome.error.is_none());

        let outcome = QueryOutcome::from_response(
            RumQuery::Views,
            (1, 2),
            Duration::ZERO,
            search_response(50),
        );
        assert!(!outcome.truncated);
        assert_eq!(outcome.hits.len(), 50);
    }

    #[test]
    fn test_partial_search_is_an_error() {
        let mut response = search_response(1);
        response.is_partial = true;
        response.function_error = vec!["range clamped".to_string()];
        let outcome =
            QueryOutcome::from_response(RumQuery::Actions, (1, 2), Duration::ZERO, response);
        let error = outcome.error.unwrap();
        assert_eq!(error.kind, RumQueryErrorKind::Partial);
        assert_eq!(error.message, "range clamped");
        assert_eq!(outcome.hits.len(), 1);
    }

    #[test]
    fn test_clamp_range() {
        assert_eq!(
            context(0).clamp_range((0, 3 * HOUR_US)),
            ((0, 3 * HOUR_US), String::new())
        );
        assert_eq!(
            context(3 * HOUR_US).clamp_range((0, 3 * HOUR_US)),
            ((0, 3 * HOUR_US), String::new())
        );
        let (range, message) = context(HOUR_US).clamp_range((0, 3 * HOUR_US));
        assert_eq!(range, (2 * HOUR_US, 3 * HOUR_US));
        assert!(message.contains("1 hours"));
    }
}
