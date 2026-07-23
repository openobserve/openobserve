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

pub mod auth;
pub mod flight;
pub mod request;

pub use common::meta::grpc::MetadataMap;
use proto::cluster_rpc;

#[cfg(test)]
mod tests {
    use promql::MetricsQueryRequest;

    use super::*;

    fn make_request() -> MetricsQueryRequest {
        MetricsQueryRequest {
            query: "up".to_string(),
            start: 1_000_000,
            end: 2_000_000,
            step: 15,
            query_exemplars: false,
            use_cache: None,
            search_type: None,
            regions: vec![],
            clusters: vec![],
        }
    }

    #[test]
    fn test_from_metrics_query_request_maps_query_fields() {
        let req = make_request();
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        let q = rpc.query.unwrap();
        assert_eq!(q.query, "up");
        assert_eq!(q.start, 1_000_000);
        assert_eq!(q.end, 2_000_000);
        assert_eq!(q.step, 15);
        assert!(!q.query_data);
    }

    #[test]
    fn test_from_metrics_query_request_use_cache_defaults_true_when_none() {
        let req = make_request(); // use_cache is None
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        assert!(rpc.use_cache);
    }

    #[test]
    fn test_from_metrics_query_request_use_cache_explicit_false() {
        let mut req = make_request();
        req.use_cache = Some(false);
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        assert!(!rpc.use_cache);
    }

    #[test]
    fn test_from_metrics_query_request_job_is_populated() {
        let req = make_request();
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        let job = rpc.job.unwrap();
        assert!(!job.trace_id.is_empty());
        assert_eq!(job.stage, 0);
        assert_eq!(job.partition, 0);
    }

    #[test]
    fn test_from_metrics_query_request_search_event_type_empty_when_none() {
        let req = make_request(); // search_type is None
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        assert_eq!(rpc.search_event_type, "");
    }

    #[test]
    fn test_from_metrics_query_request_regions_and_clusters_propagated() {
        let mut req = make_request();
        req.regions = vec!["us-east-1".to_string()];
        req.clusters = vec!["cluster-a".to_string()];
        let rpc: cluster_rpc::MetricsQueryRequest = req.into();
        assert_eq!(rpc.regions, vec!["us-east-1"]);
        assert_eq!(rpc.clusters, vec!["cluster-a"]);
    }
}
