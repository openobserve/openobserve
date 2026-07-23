// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Compatibility re-exports for call sites (alerts, HTTP handlers) that mix
// these with `MetricsQueryRequest` and `search`. New code should depend on the
// `promql` crate directly.
use config::meta::search::SearchEventType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct MetricsQueryRequest {
    pub query: String,
    pub start: i64,
    pub end: i64,
    pub step: i64,
    pub query_exemplars: bool,
    pub use_cache: Option<bool>,
    pub search_type: Option<SearchEventType>,
    pub regions: Vec<String>,
    pub clusters: Vec<String>,
}

impl From<MetricsQueryRequest> for proto::cluster_rpc::MetricsQueryRequest {
    fn from(req: MetricsQueryRequest) -> Self {
        let query = proto::cluster_rpc::MetricsQueryStmt {
            query: req.query,
            start: req.start,
            end: req.end,
            step: req.step,
            query_exemplars: req.query_exemplars,
            query_data: false,
            label_selector: vec![],
        };
        let trace_id = config::ider::generate_trace_id();
        Self {
            job: Some(proto::cluster_rpc::Job {
                trace_id: trace_id.clone(),
                job: trace_id[..7].to_string(),
                stage: 0,
                partition: 0,
            }),
            org_id: String::new(),
            need_wal: false,
            query: Some(query),
            use_cache: req.use_cache.unwrap_or(true),
            timeout: 0,
            search_event_type: req
                .search_type
                .map(|value| value.to_string())
                .unwrap_or_default(),
            regions: req.regions,
            clusters: req.clusters,
            is_super_cluster: false,
        }
    }
}
