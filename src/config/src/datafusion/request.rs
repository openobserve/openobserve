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

use proto::cluster_rpc::{self, IndexInfo, QueryIdentifier, SearchInfo, SuperClusterInfo};

use crate::meta::{search::default_use_cache, stream::StreamType};

#[derive(Debug, Clone)]
pub struct Request {
    pub trace_id: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub timeout: i64,
    pub user_id: Option<String>,
    pub work_group: Option<String>,
    pub time_range: Option<(i64, i64)>,
    pub search_event_type: Option<String>, // node rule
    pub streaming_output: bool,
    pub streaming_id: Option<String>,
    pub local_mode: Option<bool>,
    pub use_cache: bool,
    pub overwrite_cache: bool,
    pub histogram_interval: i64,
}

impl Default for Request {
    fn default() -> Self {
        Self {
            trace_id: "".to_string(),
            org_id: "".to_string(),
            stream_type: StreamType::default(),
            timeout: 0,
            user_id: None,
            work_group: None,
            time_range: None,
            search_event_type: None,
            streaming_output: false,
            streaming_id: None,
            local_mode: None,
            use_cache: default_use_cache(),
            overwrite_cache: false,
            histogram_interval: 0,
        }
    }
}

impl Request {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        trace_id: String,
        org_id: String,
        stream_type: StreamType,
        timeout: i64,
        user_id: Option<String>,
        time_range: Option<(i64, i64)>,
        search_event_type: Option<String>,
        histogram_interval: i64,
        overwrite_cache: bool,
    ) -> Self {
        Self {
            trace_id,
            org_id,
            stream_type,
            timeout,
            user_id,
            work_group: None,
            time_range,
            search_event_type,
            streaming_output: false,
            streaming_id: None,
            local_mode: None,
            use_cache: default_use_cache(),
            overwrite_cache,
            histogram_interval,
        }
    }

    pub fn add_work_group(&mut self, work_group: Option<String>) {
        self.work_group = work_group;
    }

    pub fn set_streaming_output(&mut self, streaming_output: bool, streaming_id: Option<String>) {
        self.streaming_output = streaming_output;
        self.streaming_id = streaming_id;
    }

    pub fn set_local_mode(&mut self, local_mode: Option<bool>) {
        self.local_mode = local_mode;
    }

    pub fn set_use_cache(&mut self, use_cache: bool) {
        self.use_cache = use_cache;
    }
}

impl From<FlightSearchRequest> for Request {
    fn from(req: FlightSearchRequest) -> Self {
        Self {
            trace_id: req.query_identifier.trace_id,
            org_id: req.query_identifier.org_id,
            stream_type: StreamType::from(req.query_identifier.stream_type.as_str()),
            timeout: req.search_info.timeout,
            user_id: req.super_cluster_info.user_id,
            work_group: req.super_cluster_info.work_group,
            time_range: Some((req.search_info.start_time, req.search_info.end_time)),
            search_event_type: req.super_cluster_info.search_event_type,
            streaming_output: false,
            streaming_id: None,
            local_mode: req.super_cluster_info.local_mode,
            use_cache: req.search_info.use_cache,
            overwrite_cache: req.search_info.clear_cache,
            histogram_interval: req.search_info.histogram_interval,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FlightSearchRequest {
    pub query_identifier: QueryIdentifier,
    pub search_info: SearchInfo,
    pub index_info: IndexInfo,
    pub super_cluster_info: SuperClusterInfo,
}

impl FlightSearchRequest {
    // used in RemoteScanExec
    pub fn set_partition(&mut self, partition: usize) {
        self.query_identifier.partition = partition as u32;
    }

    // used in RemoteScanExec
    pub fn set_job_id(&mut self, job_id: String) {
        self.query_identifier.job_id = job_id;
    }
}

impl From<cluster_rpc::FlightSearchRequest> for FlightSearchRequest {
    fn from(request: cluster_rpc::FlightSearchRequest) -> Self {
        Self {
            query_identifier: request.query_identifier.unwrap(),
            search_info: request.search_info.unwrap(),
            index_info: request.index_info.unwrap(),
            super_cluster_info: request.super_cluster_info.unwrap(),
        }
    }
}

impl From<FlightSearchRequest> for cluster_rpc::FlightSearchRequest {
    fn from(request: FlightSearchRequest) -> Self {
        Self {
            query_identifier: Some(request.query_identifier),
            search_info: Some(request.search_info),
            index_info: Some(request.index_info),
            super_cluster_info: Some(request.super_cluster_info),
        }
    }
}

#[cfg(test)]
mod tests {
    use proto::cluster_rpc::{IndexInfo, QueryIdentifier, SearchInfo, SuperClusterInfo};

    use super::*;

    fn make_flight_request() -> FlightSearchRequest {
        FlightSearchRequest {
            query_identifier: QueryIdentifier {
                trace_id: "trace-1".to_string(),
                org_id: "myorg".to_string(),
                stream_type: "logs".to_string(),
                ..Default::default()
            },
            search_info: SearchInfo {
                start_time: 1_000,
                end_time: 2_000,
                timeout: 30,
                use_cache: true,
                clear_cache: false,
                histogram_interval: 60,
                ..Default::default()
            },
            index_info: IndexInfo::default(),
            super_cluster_info: SuperClusterInfo {
                user_id: Some("alice".to_string()),
                work_group: Some("wg1".to_string()),
                local_mode: Some(true),
                ..Default::default()
            },
        }
    }

    #[test]
    fn test_from_flight_request_to_request_maps_fields() {
        let flight = make_flight_request();
        let req = Request::from(flight);
        assert_eq!(req.trace_id, "trace-1");
        assert_eq!(req.org_id, "myorg");
        assert_eq!(req.timeout, 30);
        assert_eq!(req.time_range, Some((1_000, 2_000)));
        assert!(req.use_cache);
        assert!(!req.overwrite_cache);
        assert_eq!(req.histogram_interval, 60);
        assert_eq!(req.user_id, Some("alice".to_string()));
        assert_eq!(req.work_group, Some("wg1".to_string()));
        assert_eq!(req.local_mode, Some(true));
        assert!(!req.streaming_output);
        assert!(req.streaming_id.is_none());
    }

    #[test]
    fn test_from_flight_to_proto_and_back_roundtrip() {
        let original = make_flight_request();
        let proto: cluster_rpc::FlightSearchRequest = original.clone().into();
        let recovered = FlightSearchRequest::from(proto);
        assert_eq!(recovered.query_identifier.trace_id, "trace-1");
        assert_eq!(recovered.search_info.start_time, 1_000);
        assert_eq!(
            recovered.super_cluster_info.user_id,
            Some("alice".to_string())
        );
    }

    #[test]
    fn test_from_flight_to_proto_wraps_in_some() {
        let flight = make_flight_request();
        let proto: cluster_rpc::FlightSearchRequest = flight.into();
        assert!(proto.query_identifier.is_some());
        assert!(proto.search_info.is_some());
        assert!(proto.index_info.is_some());
        assert!(proto.super_cluster_info.is_some());
    }

    #[test]
    fn test_add_work_group_sets_field() {
        let mut req = Request::default();
        assert!(req.work_group.is_none());
        req.add_work_group(Some("my_group".to_string()));
        assert_eq!(req.work_group, Some("my_group".to_string()));
    }

    #[test]
    fn test_add_work_group_clears_field() {
        let mut req = Request::default();
        req.add_work_group(Some("group".to_string()));
        req.add_work_group(None);
        assert!(req.work_group.is_none());
    }

    #[test]
    fn test_set_streaming_output_sets_both_fields() {
        let mut req = Request::default();
        assert!(!req.streaming_output);
        assert!(req.streaming_id.is_none());
        req.set_streaming_output(true, Some("stream_123".to_string()));
        assert!(req.streaming_output);
        assert_eq!(req.streaming_id, Some("stream_123".to_string()));
    }

    #[test]
    fn test_set_local_mode_sets_field() {
        let mut req = Request::default();
        assert!(req.local_mode.is_none());
        req.set_local_mode(Some(true));
        assert_eq!(req.local_mode, Some(true));
        req.set_local_mode(None);
        assert!(req.local_mode.is_none());
    }

    #[test]
    fn test_set_use_cache_overrides_default() {
        let mut req = Request::default();
        req.set_use_cache(true);
        assert!(req.use_cache);
        req.set_use_cache(false);
        assert!(!req.use_cache);
    }

    #[test]
    fn test_set_partition_stores_value() {
        let mut req = make_flight_request();
        req.set_partition(7);
        assert_eq!(req.query_identifier.partition, 7);
    }

    #[test]
    fn test_set_job_id_stores_value() {
        let mut req = make_flight_request();
        req.set_job_id("job-123".to_string());
        assert_eq!(req.query_identifier.job_id, "job-123");
    }

    #[test]
    fn test_from_proto_flight_to_flight_roundtrip() {
        let original = make_flight_request();
        let proto: cluster_rpc::FlightSearchRequest = original.clone().into();
        let restored = FlightSearchRequest::from(proto);
        assert_eq!(
            restored.query_identifier.trace_id,
            original.query_identifier.trace_id
        );
        assert_eq!(
            restored.search_info.start_time,
            original.search_info.start_time
        );
    }
}
