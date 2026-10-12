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
use infra::errors::{Error, ErrorCodes};
use serde::Serialize;
use utoipa::ToSchema;

use super::query::{QueryOutcome, RumQuery};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumLookupStatus {
    Found,
    NotFound,
    /// The stream is missing or has no trace id column, so nothing was queried.
    Unavailable,
    /// A query failed, timed out or returned partial results.
    Incomplete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RumQueryErrorKind {
    Timeout,
    Cancelled,
    Failed,
    Partial,
}

impl From<&Error> for RumQueryErrorKind {
    fn from(error: &Error) -> Self {
        match error {
            Error::ErrorCode(ErrorCodes::SearchTimeout(_)) => Self::Timeout,
            Error::ErrorCode(ErrorCodes::SearchCancelQuery(_)) => Self::Cancelled,
            _ => Self::Failed,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumQueryError {
    pub query: RumQuery,
    pub kind: RumQueryErrorKind,
    pub message: String,
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumBridge {
    #[schema(value_type = Vec<Object>)]
    pub traced_resources: Vec<json::Value>,
}

/// Which result sets hit their limit and were cut.
#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumLookupTruncated {
    pub traced_resources: bool,
    pub views: bool,
    pub actions: bool,
    pub context_events: bool,
}

impl RumLookupTruncated {
    fn any(&self) -> bool {
        self.traced_resources || self.views || self.actions || self.context_events
    }
}

#[derive(Debug, Default, Serialize, ToSchema)]
pub struct RumLookupDiagnostics {
    /// Wall time of the whole lookup, in milliseconds.
    pub took: usize,
    pub queries: Vec<RumQueryDiagnostics>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumQueryDiagnostics {
    pub query: RumQuery,
    pub start_time: i64,
    pub end_time: i64,
    /// Wall time of the sub-query as seen by the lookup, in milliseconds.
    pub took: usize,
    pub search_took: usize,
    pub wait_in_queue: usize,
    pub scan_files: usize,
    pub scan_size: usize,
    pub scan_records: usize,
    pub cached_ratio: usize,
    pub result_cache_ratio: usize,
    pub hits: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RumLookupResponse {
    pub status: RumLookupStatus,
    pub bridge: RumBridge,
    #[schema(value_type = Vec<Object>)]
    pub views: Vec<json::Value>,
    #[schema(value_type = Vec<Object>)]
    pub actions: Vec<json::Value>,
    #[schema(value_type = Vec<Object>)]
    pub context_events: Vec<json::Value>,
    /// Some result set is truncated or some query did not complete.
    pub partial: bool,
    pub truncated: RumLookupTruncated,
    pub errors: Vec<RumQueryError>,
    pub diagnostics: RumLookupDiagnostics,
}

impl RumLookupResponse {
    pub(super) fn new(status: RumLookupStatus) -> Self {
        Self {
            status,
            bridge: RumBridge::default(),
            views: Vec::new(),
            actions: Vec::new(),
            context_events: Vec::new(),
            partial: false,
            truncated: RumLookupTruncated::default(),
            errors: Vec::new(),
            diagnostics: RumLookupDiagnostics::default(),
        }
    }

    pub(super) fn record(&mut self, outcome: QueryOutcome) {
        let QueryOutcome {
            query,
            hits,
            truncated,
            error,
            diagnostics,
        } = outcome;
        match query {
            RumQuery::TracedResources => {
                self.bridge.traced_resources = hits;
                self.truncated.traced_resources = truncated;
            }
            RumQuery::Views => {
                self.views = hits;
                self.truncated.views = truncated;
            }
            RumQuery::Actions => {
                self.actions = hits;
                self.truncated.actions = truncated;
            }
            RumQuery::ContextEvents => {
                self.context_events = hits;
                self.truncated.context_events = truncated;
            }
        }
        self.errors.extend(error);
        self.diagnostics.queries.extend(diagnostics);
    }

    pub(super) fn finish(mut self, found: bool) -> Self {
        let incomplete = !self.errors.is_empty();
        self.status = match (found, incomplete) {
            (_, true) => RumLookupStatus::Incomplete,
            (true, false) => RumLookupStatus::Found,
            (false, false) => RumLookupStatus::NotFound,
        };
        self.partial = incomplete || self.truncated.any();
        self
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;
    use crate::rum::lookup::tests::search_response;

    #[test]
    fn test_finish_status() {
        let found = RumLookupResponse::new(RumLookupStatus::NotFound).finish(true);
        assert_eq!(found.status, RumLookupStatus::Found);
        assert!(!found.partial);

        let not_found = RumLookupResponse::new(RumLookupStatus::NotFound).finish(false);
        assert_eq!(not_found.status, RumLookupStatus::NotFound);

        let mut failed = RumLookupResponse::new(RumLookupStatus::NotFound);
        failed.record(QueryOutcome::failed(
            RumQuery::TracedResources,
            RumQueryErrorKind::Timeout,
            "timeout".to_string(),
        ));
        let failed = failed.finish(false);
        assert_eq!(failed.status, RumLookupStatus::Incomplete);
        assert!(failed.partial);

        let mut truncated = RumLookupResponse::new(RumLookupStatus::NotFound);
        truncated.record(QueryOutcome::from_response(
            RumQuery::ContextEvents,
            (1, 2),
            Duration::ZERO,
            search_response(251),
        ));
        let truncated = truncated.finish(true);
        assert_eq!(truncated.status, RumLookupStatus::Found);
        assert!(truncated.partial);
        assert!(truncated.truncated.context_events);
        assert_eq!(truncated.context_events.len(), 250);
    }

    #[test]
    fn test_response_shape() {
        let response =
            serde_json::to_value(RumLookupResponse::new(RumLookupStatus::Unavailable)).unwrap();
        assert_eq!(response["status"], "unavailable");
        assert_eq!(response["bridge"]["traced_resources"], json!([]));
        assert_eq!(response["truncated"]["context_events"], false);
        assert_eq!(response["errors"], json!([]));
    }
}
