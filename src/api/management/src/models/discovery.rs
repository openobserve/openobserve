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

use config::meta::self_reporting::llm_scores::LlmScoreTargetScope;
use openobserve_core::llm_evaluations::discovery::{
    DiscoveryItem, DiscoveryPage, DiscoveryQueueStatusFilter, ListDiscoveryItems,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Clone, Debug, Deserialize, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct ListDiscoveryItemsQuery {
    /// Target scope: `span`, `trace`, or `session`.
    #[param(value_type = String, example = "trace")]
    pub scope: LlmScoreTargetScope,
    /// Queue membership filter. Defaults to `not_enqueued`; also supports
    /// `enqueued`, `pending`, `reviewed`, and `all`.
    pub queue_status: Option<String>,
    /// Inclusive target timestamp lower bound, in microseconds.
    pub start_time: i64,
    /// Exclusive target timestamp upper bound, in microseconds.
    pub end_time: i64,
    /// Zero-based result offset. Defaults to 0.
    pub from: Option<usize>,
    /// Page size from 1 through 100. Defaults to 20.
    pub size: Option<usize>,
}

impl TryFrom<ListDiscoveryItemsQuery> for ListDiscoveryItems {
    type Error = openobserve_core::llm_evaluations::discovery::DiscoveryError;

    fn try_from(value: ListDiscoveryItemsQuery) -> Result<Self, Self::Error> {
        Ok(Self {
            scope: value.scope,
            queue_status: value
                .queue_status
                .as_deref()
                .map(DiscoveryQueueStatusFilter::try_from)
                .transpose()?
                .unwrap_or_default(),
            start_time: value.start_time,
            end_time: value.end_time,
            from: value.from.unwrap_or(0),
            size: value.size.unwrap_or(20),
        })
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryItemResponseBody {
    pub scope: String,
    pub target_id: String,
    pub trace_id: Option<String>,
    pub session_id: Option<String>,
    pub ref_timestamp: i64,
    pub source_stream: Option<String>,
    /// Derived quality: `issue` for one unhealthy dimension and `multiple` for
    /// two or more unhealthy dimensions.
    pub quality: String,
    pub issue_count: usize,
    /// One representative row from the target trace stream, fetched only after
    /// Discovery filtering and pagination.
    pub trace_details: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListDiscoveryItemsResponseBody {
    pub list: Vec<DiscoveryItemResponseBody>,
    pub total: usize,
    pub from: usize,
    pub size: usize,
}

impl From<DiscoveryItem> for DiscoveryItemResponseBody {
    fn from(value: DiscoveryItem) -> Self {
        Self {
            scope: value.scope.to_string(),
            target_id: value.target_id,
            trace_id: value.trace_id,
            session_id: value.session_id,
            ref_timestamp: value.ref_timestamp,
            source_stream: value.source_stream,
            quality: value.quality.as_str().to_string(),
            issue_count: value.issue_count,
            trace_details: value.trace_details,
        }
    }
}

impl From<DiscoveryPage> for ListDiscoveryItemsResponseBody {
    fn from(value: DiscoveryPage) -> Self {
        Self {
            list: value
                .items
                .into_iter()
                .map(DiscoveryItemResponseBody::from)
                .collect(),
            total: value.total,
            from: value.from,
            size: value.size,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_defaults_to_not_enqueued_and_standard_pagination() {
        let request = ListDiscoveryItems::try_from(ListDiscoveryItemsQuery {
            scope: LlmScoreTargetScope::Trace,
            queue_status: None,
            start_time: 10,
            end_time: 20,
            from: None,
            size: None,
        })
        .unwrap();

        assert_eq!(
            request.queue_status,
            DiscoveryQueueStatusFilter::NotEnqueued
        );
        assert_eq!(request.from, 0);
        assert_eq!(request.size, 20);
    }

    #[test]
    fn query_rejects_unknown_queue_status() {
        let result = ListDiscoveryItems::try_from(ListDiscoveryItemsQuery {
            scope: LlmScoreTargetScope::Span,
            queue_status: Some("open".to_string()),
            start_time: 10,
            end_time: 20,
            from: None,
            size: None,
        });

        assert!(result.is_err());
    }
}
