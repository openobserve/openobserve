// Copyright 2025 OpenObserve Inc.
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

use std::sync::Arc;

use config::{
    datafusion::request::{FlightSearchRequest, Request},
    meta::{cluster::NodeInfo, sql::TableReferenceExt},
};
use datafusion::common::TableReference;
use hashbrown::HashMap;
use proto::cluster_rpc::{IndexInfo, KvItem, QueryIdentifier, SearchInfo, SuperClusterInfo};

#[derive(Debug, Clone)]
pub struct RemoteScanNodes {
    pub req: Request,
    pub nodes: Vec<Arc<dyn NodeInfo>>,
    pub file_id_lists: HashMap<TableReference, Vec<Vec<i64>>>,
    pub equal_keys: HashMap<TableReference, Vec<KvItem>>,
    pub is_leader: bool, // for super cluster
    pub opentelemetry_context: opentelemetry::Context,
    pub sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
}

impl RemoteScanNodes {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        req: Request,
        nodes: Vec<Arc<dyn NodeInfo>>,
        file_id_lists: HashMap<TableReference, Vec<Vec<i64>>>,
        equal_keys: HashMap<TableReference, Vec<KvItem>>,
        is_leader: bool,
        opentelemetry_context: opentelemetry::Context,
        sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
    ) -> Self {
        Self {
            req,
            nodes,
            file_id_lists,
            equal_keys,
            is_leader,
            opentelemetry_context,
            sampling_config,
        }
    }

    pub fn get_remote_node(&self, table_name: &TableReference) -> RemoteScanNode {
        let query_identifier = QueryIdentifier {
            trace_id: self.req.trace_id.clone(),
            org_id: self.req.org_id.clone(),
            stream_type: table_name.get_stream_type(self.req.stream_type).to_string(),
            partition: 0,           // set in FlightSearchRequest
            job_id: "".to_string(), // set in FlightSearchRequest
            enrich_mode: false,     // set in RemoteScanExec
        };

        let search_infos = SearchInfos {
            plan: vec![], // set in RemoteScanNode
            file_id_list: self
                .file_id_lists
                .get(table_name)
                .unwrap_or(&vec![])
                .clone(),
            start_time: self.req.time_range.as_ref().map(|x| x.0).unwrap_or(0),
            end_time: self.req.time_range.as_ref().map(|x| x.1).unwrap_or(0),
            timeout: self.req.timeout as u64,
            use_cache: self.req.use_cache,
            histogram_interval: self.req.histogram_interval,
            is_analyze: false, // set in distribute Analyze
            sampling_config: self.sampling_config.clone(),
            clear_cache: self.req.overwrite_cache,
        };

        let index_info = IndexInfo {
            equal_keys: self.equal_keys.get(table_name).unwrap_or(&vec![]).clone(),
            index_optimize_mode: None, // set in LeaderIndexOptimizerule
        };

        let super_cluster_info = SuperClusterInfo {
            is_super_cluster: self.is_leader,
            user_id: self.req.user_id.clone(),
            work_group: self.req.work_group.clone(),
            search_event_type: self.req.search_event_type.clone(),
            local_mode: self.req.local_mode,
        };

        RemoteScanNode {
            nodes: self.nodes.clone(),
            opentelemetry_context: self.opentelemetry_context.clone(),
            query_identifier,
            search_infos,
            index_info,
            super_cluster_info,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RemoteScanNode {
    pub nodes: Vec<Arc<dyn NodeInfo>>,
    pub opentelemetry_context: opentelemetry::Context,
    pub query_identifier: QueryIdentifier,
    pub search_infos: SearchInfos,
    pub index_info: IndexInfo,
    pub super_cluster_info: SuperClusterInfo,
}

impl RemoteScanNode {
    pub fn get_flight_search_request(&self, partition: usize) -> FlightSearchRequest {
        FlightSearchRequest {
            query_identifier: self.query_identifier.clone(),
            search_info: self.search_infos.get_search_info(partition), // add is_querier
            index_info: self.index_info.clone(),
            super_cluster_info: self.super_cluster_info.clone(),
        }
    }

    pub fn is_file_list_empty(&self, partition: usize) -> bool {
        let file_id_list = if self.search_infos.file_id_list.is_empty() {
            vec![]
        } else {
            self.search_infos.file_id_list[partition].clone()
        };
        file_id_list.is_empty()
    }

    // used in RemoteScanExec
    // need to set plan before send to follow
    pub fn set_plan(&mut self, plan: Vec<u8>) {
        self.search_infos.plan = plan;
    }

    // need to set to true when from super cluster leader to super cluster follower
    // otherwise set to false
    // used in super cluster follower.rs
    #[cfg(feature = "enterprise")]
    pub fn set_is_super_cluster(&mut self, is_leader: bool) {
        self.super_cluster_info.is_super_cluster = is_leader;
    }

    #[cfg(feature = "enterprise")]
    pub fn from_flight_search_request(
        request: &FlightSearchRequest,
        search_infos: SearchInfos,
        nodes: Vec<Arc<dyn NodeInfo>>,
        opentelemetry_context: opentelemetry::Context,
    ) -> Self {
        Self {
            nodes,
            opentelemetry_context,
            query_identifier: request.query_identifier.clone(),
            search_infos,
            index_info: request.index_info.clone(),
            super_cluster_info: request.super_cluster_info.clone(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct SearchInfos {
    pub plan: Vec<u8>,
    pub file_id_list: Vec<Vec<i64>>,
    pub start_time: i64,
    pub end_time: i64,
    pub timeout: u64,
    pub use_cache: bool,
    pub histogram_interval: i64,
    pub is_analyze: bool,
    pub sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
    pub clear_cache: bool,
}

impl SearchInfos {
    pub fn get_search_info(&self, partition: usize) -> SearchInfo {
        let file_id_list = if self.file_id_list.is_empty() {
            vec![]
        } else {
            self.file_id_list[partition].clone()
        };
        SearchInfo {
            plan: self.plan.clone(),
            file_id_list,
            start_time: self.start_time,
            end_time: self.end_time,
            timeout: self.timeout as i64,
            use_cache: self.use_cache,
            histogram_interval: self.histogram_interval,
            is_analyze: self.is_analyze,
            sampling_config: self.sampling_config.clone(),
            clear_cache: self.clear_cache,
        }
    }
}
