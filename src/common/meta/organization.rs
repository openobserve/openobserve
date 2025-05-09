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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const DEFAULT_ORG: &str = "default";
pub const CUSTOM: &str = "custom";
pub const THRESHOLD: i64 = 9383939382;

use config::meta::cluster::Node;

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct Organization {
    pub identifier: String,
    pub label: String,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct OrgUser {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
}

#[derive(Serialize, ToSchema)]
pub struct OrgDetails {
    pub id: i64,
    pub identifier: String,
    pub name: String,
    pub user_email: String,
    pub ingest_threshold: i64,
    pub search_threshold: i64,
    #[serde(rename = "type")]
    pub org_type: String,
    #[serde(rename = "UserObj")]
    pub user_obj: OrgUser,
}

#[derive(Serialize, ToSchema)]
pub struct OrganizationResponse {
    pub data: Vec<OrgDetails>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct OrgSummary {
    pub streams: StreamSummary,
    pub pipelines: PipelineSummary,
    pub alerts: AlertSummary,
    pub total_functions: i64,
    pub total_dashboards: i64,
}

#[derive(Default, Serialize, Deserialize, ToSchema)]
pub struct StreamSummary {
    pub num_streams: i64,
    pub total_records: i64,
    pub total_storage_size: f64,
    pub total_compressed_size: f64,
    pub total_index_size: f64,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct PipelineSummary {
    pub num_realtime: i64,
    pub num_scheduled: i64,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct AlertSummary {
    pub num_realtime: i64,
    pub num_scheduled: i64,
}

/// A container for passcodes and rumtokens
#[derive(Serialize, ToSchema)]
pub enum IngestionTokensContainer {
    Passcode(IngestionPasscode),
    RumToken(RumIngestionToken),
}

#[derive(Serialize, ToSchema)]
pub struct IngestionPasscode {
    pub passcode: String,
    pub user: String,
}

#[derive(Serialize, ToSchema)]
pub struct PasscodeResponse {
    pub data: IngestionPasscode,
}

#[derive(Serialize, ToSchema)]
pub struct RumIngestionToken {
    pub user: String,
    pub rum_token: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct RumIngestionResponse {
    pub data: RumIngestionToken,
}

fn default_scrape_interval() -> u32 {
    config::get_config().common.default_scrape_interval
}

fn default_auto_refresh_interval() -> u32 {
    config::get_config().common.min_auto_refresh_interval
}

fn default_trace_id_field_name() -> String {
    "trace_id".to_string()
}

fn default_span_id_field_name() -> String {
    "span_id".to_string()
}

fn default_toggle_ingestion_logs() -> bool {
    false
}

fn default_enable_websocket_search() -> bool {
    false
}

fn default_enable_streaming_search() -> bool {
    false
}

#[derive(Serialize, ToSchema, Deserialize, Debug, Clone)]
pub struct OrganizationSettingPayload {
    /// Ideally this should be the same as prometheus-scrape-interval (in
    /// seconds).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrape_interval: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id_field_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id_field_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toggle_ingestion_logs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_websocket_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_auto_refresh_interval: Option<u32>,
}

#[derive(Serialize, ToSchema, Deserialize, Debug, Clone)]
pub struct OrganizationSetting {
    /// Ideally this should be the same as prometheus-scrape-interval (in
    /// seconds).
    #[serde(default = "default_scrape_interval")]
    pub scrape_interval: u32,
    #[serde(default = "default_trace_id_field_name")]
    pub trace_id_field_name: String,
    #[serde(default = "default_span_id_field_name")]
    pub span_id_field_name: String,
    #[serde(default = "default_toggle_ingestion_logs")]
    pub toggle_ingestion_logs: bool,
    #[serde(default = "default_enable_websocket_search")]
    pub enable_websocket_search: bool,
    #[serde(default = "default_enable_streaming_search")]
    pub enable_streaming_search: bool,
    #[serde(default = "default_auto_refresh_interval")]
    pub min_auto_refresh_interval: u32,
}

impl Default for OrganizationSetting {
    fn default() -> Self {
        Self {
            scrape_interval: default_scrape_interval(),
            trace_id_field_name: default_trace_id_field_name(),
            span_id_field_name: default_span_id_field_name(),
            toggle_ingestion_logs: default_toggle_ingestion_logs(),
            enable_websocket_search: default_enable_websocket_search(),
            enable_streaming_search: default_enable_streaming_search(),
            min_auto_refresh_interval: default_auto_refresh_interval(),
        }
    }
}

#[derive(Serialize, ToSchema, Deserialize, Debug, Clone)]
pub struct OrganizationSettingResponse {
    pub data: OrganizationSetting,
}

/// Request struct for node listing with region filtering
///
/// Regions can be provided in the request body to filter nodes by region.
/// If no regions are provided, all nodes will be returned.
#[derive(Serialize, Deserialize, Default)]
pub struct NodeListRequest {
    /// List of region names to filter by
    pub regions: Vec<String>,
}
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct RegionInfo<T> {
    #[serde(flatten)]
    pub clusters: std::collections::HashMap<String, T>,
}

/// Response struct for node listing with nested hierarchy
///
/// Contains a three-level hierarchy with a flat format:
/// 1. Regions at the top level as object keys
/// 2. Clusters within each region as object keys
/// 3. Nodes as arrays directly under each cluster
#[derive(Serialize, Deserialize, Default)]
pub struct NodeListResponse {
    #[serde(flatten)]
    pub regions: std::collections::HashMap<String, RegionInfo<Vec<Node>>>,
}

impl NodeListResponse {
    pub fn new() -> Self {
        Self {
            regions: std::collections::HashMap::new(),
        }
    }

    /// Adds a node to the appropriate region and cluster
    ///
    /// This method will create the region and cluster if they don't exist
    pub fn add_node(&mut self, node: Node, region_name: String, cluster_name: String) {
        let region_entry = self
            .regions
            .entry(region_name.clone())
            .or_insert_with(|| RegionInfo {
                clusters: std::collections::HashMap::new(),
            });

        let cluster_entry = region_entry
            .clusters
            .entry(cluster_name.clone())
            .or_default();

        cluster_entry.push(node);
    }

    /// Adds multiple nodes to the response structure
    pub fn add_nodes(&mut self, nodes: Vec<(Node, String, String)>) {
        for (node, region, cluster) in nodes {
            self.add_node(node, region, cluster);
        }
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct ClusterInfo {
    pub pending_jobs: u64,
}

/// Response struct for cluster info
///
/// Contains a three-level hierarchy with a flat format:
/// 1. Regions at the top level as object keys
/// 2. Clusters within each region as object keys
#[derive(Serialize, Deserialize, Default)]
pub struct ClusterInfoResponse {
    pub regions: std::collections::HashMap<String, RegionInfo<ClusterInfo>>,
}

impl ClusterInfoResponse {
    pub fn add_cluster_info(
        &mut self,
        cluster_info: ClusterInfo,
        cluster_name: String,
        region_name: String,
    ) {
        let region_entry = self
            .regions
            .entry(region_name)
            .or_insert_with(|| RegionInfo {
                clusters: std::collections::HashMap::new(),
            });

        region_entry.clusters.insert(cluster_name, cluster_info);
    }
}
