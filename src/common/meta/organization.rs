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

use config::meta::user::UserRole;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(feature = "cloud")]
use super::user::InviteStatus;

pub const DEFAULT_ORG: &str = "default";
pub const CUSTOM: &str = "custom";
pub const USER_DEFAULT: &str = "user_default";
pub const THRESHOLD: i64 = 9383939382;

use config::meta::cluster::Node;

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct Organization {
    #[serde(default)]
    pub identifier: String,
    pub name: String,
    #[serde(default)]
    pub org_type: String,
}

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct OrgRenameBody {
    pub new_name: String,
}

#[cfg(feature = "cloud")]
#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct OrganizationInvites {
    #[serde(default)]
    pub invites: Vec<String>, // user emails
    pub role: UserRole,
}

#[cfg(feature = "cloud")]
#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct OrganizationInviteResponse {
    #[serde(default)]
    pub data: OrganizationInviteResponseData, // user emails
    pub message: String,
}

#[cfg(feature = "cloud")]
#[derive(Serialize, Deserialize, Default, ToSchema, Clone, Debug)]
pub struct OrganizationInviteResponseData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_members: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_members: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invalid_email: Option<String>,
}

#[cfg(feature = "cloud")]
#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct OrganizationInviteUserRecord {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub role: String,
    pub status: InviteStatus,
    pub expires_at: i64,
    pub is_external: bool,
}

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
pub struct OrgRoleMapping {
    pub org_id: String,
    pub org_name: String,
    pub role: UserRole,
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
    #[serde(default)]
    pub plan: i32,
}

#[derive(Serialize, ToSchema)]
pub struct AllOrgListDetails {
    pub id: i64,
    pub identifier: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(rename = "type")]
    pub org_type: String,
    #[serde(default)]
    pub plan: i32,
    pub trial_expires_at: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct OrganizationResponse {
    pub data: Vec<OrgDetails>,
}

#[derive(Serialize, ToSchema)]
pub struct AllOrganizationResponse {
    pub data: Vec<AllOrgListDetails>,
}

#[cfg(feature = "cloud")]
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ExtendTrialPeriodRequest {
    pub org_id: String,
    pub new_end_date: i64,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct OrgSummary {
    pub streams: StreamSummary,
    pub pipelines: PipelineSummary,
    pub alerts: AlertSummary,
    pub total_functions: i64,
    pub total_dashboards: i64,
}

#[derive(Default, Clone, Serialize, Deserialize, ToSchema)]
pub struct StreamSummary {
    pub num_streams: i64,
    pub total_records: i64,
    pub total_storage_size: f64,
    pub total_compressed_size: f64,
    pub total_index_size: f64,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
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

#[derive(Serialize, ToSchema, Clone)]
pub struct IngestionPasscode {
    pub passcode: String,
    pub user: String,
}

#[derive(Serialize, ToSchema)]
pub struct PasscodeResponse {
    pub data: IngestionPasscode,
}

#[derive(Serialize, ToSchema, Clone)]
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

fn default_enable_streaming_aggregation() -> bool {
    #[cfg(feature = "enterprise")]
    {
        config::get_config().common.feature_query_streaming_aggs
    }
    #[cfg(not(feature = "enterprise"))]
    {
        false
    }
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
    pub streaming_aggregation_enabled: Option<bool>,
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
    #[serde(default = "default_enable_streaming_aggregation")]
    pub streaming_aggregation_enabled: bool,
    #[serde(default = "default_enable_streaming_search")]
    pub enable_streaming_search: bool,
    #[serde(default = "default_auto_refresh_interval")]
    pub min_auto_refresh_interval: u32,
    // we skip this as this is actually stored in another table
    // and only applicable for cloud
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_trial_expiry: Option<i64>,
}

impl Default for OrganizationSetting {
    fn default() -> Self {
        Self {
            scrape_interval: default_scrape_interval(),
            trace_id_field_name: default_trace_id_field_name(),
            span_id_field_name: default_span_id_field_name(),
            toggle_ingestion_logs: default_toggle_ingestion_logs(),
            streaming_aggregation_enabled: default_enable_streaming_aggregation(),
            enable_streaming_search: default_enable_streaming_search(),
            min_auto_refresh_interval: default_auto_refresh_interval(),
            free_trial_expiry: None,
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
#[derive(Serialize, Deserialize, Default, ToSchema)]
pub struct NodeListResponse {
    #[serde(flatten)]
    #[schema(value_type = Object)]
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

#[derive(Serialize, Deserialize, Default, Clone, Debug, ToSchema)]
pub struct ClusterInfo {
    pub pending_jobs: u64,
}

/// Response struct for cluster info
///
/// Contains a three-level hierarchy with a flat format:
/// 1. Regions at the top level as object keys
/// 2. Clusters within each region as object keys
#[derive(Serialize, Deserialize, Default, ToSchema)]
pub struct ClusterInfoResponse {
    #[schema(value_type = Object)]
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

#[cfg(test)]
mod tests {
    use config::meta::cluster::Node;

    use super::*;

    #[test]
    fn test_organization_setting_defaults() {
        let setting = OrganizationSetting::default();
        assert_eq!(setting.trace_id_field_name, "trace_id");
        assert_eq!(setting.span_id_field_name, "span_id");
        assert!(!setting.toggle_ingestion_logs);
        assert!(!setting.enable_streaming_search);
    }

    #[test]
    fn test_node_list_response_add_node() {
        let node = Node {
            name: "node-1".into(),
            ..Default::default()
        };

        let mut response = NodeListResponse::new();
        response.add_node(node.clone(), "us-east".into(), "cluster-a".into());

        let nodes = &response
            .regions
            .get("us-east")
            .unwrap()
            .clusters
            .get("cluster-a")
            .unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "node-1");
    }

    #[test]
    fn test_node_list_response_add_nodes() {
        let node1 = Node {
            name: "node-1".into(),
            ..Default::default()
        };
        let node2 = Node {
            name: "node-2".into(),
            ..Default::default()
        };

        let mut response = NodeListResponse::new();
        response.add_nodes(vec![
            (node1.clone(), "us-west".into(), "cluster-x".into()),
            (node2.clone(), "us-west".into(), "cluster-x".into()),
        ]);

        let nodes = &response
            .regions
            .get("us-west")
            .unwrap()
            .clusters
            .get("cluster-x")
            .unwrap();
        assert_eq!(nodes.len(), 2);
    }

    #[test]
    fn test_cluster_info_response_add() {
        let mut response = ClusterInfoResponse::default();
        let info = ClusterInfo { pending_jobs: 5 };

        response.add_cluster_info(info.clone(), "cluster-1".into(), "eu".into());

        let cluster = response
            .regions
            .get("eu")
            .unwrap()
            .clusters
            .get("cluster-1")
            .unwrap();
        assert_eq!(cluster.pending_jobs, 5);
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_organization_invite_response_data_serialization() {
        let data = OrganizationInviteResponseData {
            valid_members: Some(vec!["user1@example.com".into(), "user2@example.com".into()]),
            existing_members: Some(vec!["existing@example.com".into()]),
            invalid_email: Some("bad-email".into()),
        };

        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("user1@example.com"));
        assert!(json.contains("bad-email"));
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_organization_invites_creation() {
        // what does this test exactly?
        let invites = OrganizationInvites {
            invites: vec!["a@example.com".into(), "b@example.com".into()],
            role: UserRole::User,
        };

        assert_eq!(invites.invites.len(), 2);
        assert_eq!(invites.role, UserRole::User);
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_organization_invite_user_record() {
        // what does this test exactly?
        let record = OrganizationInviteUserRecord {
            email: "user@example.com".into(),
            first_name: "First".into(),
            last_name: "Last".into(),
            role: "admin".into(),
            status: InviteStatus::Pending,
            expires_at: 999999,
            is_external: true,
        };

        assert_eq!(record.status, InviteStatus::Pending);
        assert!(record.is_external);
    }

    #[test]
    fn test_organization_default_values() {
        let org = Organization {
            identifier: Default::default(),
            name: "Test Org".to_string(),
            org_type: Default::default(),
        };

        assert_eq!(org.identifier, "");
        assert_eq!(org.name, "Test Org");
        assert_eq!(org.org_type, "");
    }

    #[test]
    fn test_all_org_list_details_default_plan() {
        let details = AllOrgListDetails {
            id: 123,
            identifier: "org-123".to_string(),
            name: "Test Org".to_string(),
            created_at: 1640995200,
            updated_at: 1640995260,
            org_type: "standard".to_string(),
            plan: Default::default(),
            trial_expires_at: None,
        };

        assert_eq!(details.plan, 0);
        assert_eq!(details.trial_expires_at, None);
    }

    #[test]
    fn test_organization_response() {
        let user = OrgUser {
            first_name: "Test".to_string(),
            last_name: "User".to_string(),
            email: "test@example.com".to_string(),
        };

        let org_details = OrgDetails {
            id: 1,
            identifier: "org-1".to_string(),
            name: "Org One".to_string(),
            user_email: "admin1@example.com".to_string(),
            ingest_threshold: THRESHOLD,
            search_threshold: THRESHOLD,
            org_type: "basic".to_string(),
            user_obj: user,
            plan: 0,
        };

        let response = OrganizationResponse {
            data: vec![org_details],
        };

        assert_eq!(response.data.len(), 1);
        assert_eq!(response.data[0].identifier, "org-1");
        assert_eq!(response.data[0].ingest_threshold, THRESHOLD);
    }

    #[test]
    fn test_all_organization_response() {
        let details1 = AllOrgListDetails {
            id: 1,
            identifier: "org-1".to_string(),
            name: "Org One".to_string(),
            created_at: 1640995200,
            updated_at: 1640995260,
            org_type: "basic".to_string(),
            plan: 0,
            trial_expires_at: None,
        };

        let details2 = AllOrgListDetails {
            id: 2,
            identifier: "org-2".to_string(),
            name: "Org Two".to_string(),
            created_at: 1640995300,
            updated_at: 1640995360,
            org_type: "premium".to_string(),
            plan: 1,
            trial_expires_at: Some(1641081600),
        };

        let response = AllOrganizationResponse {
            data: vec![details1, details2],
        };

        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].name, "Org One");
        assert_eq!(response.data[1].name, "Org Two");
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_extend_trial_period_request() {
        let request = ExtendTrialPeriodRequest {
            org_id: "org-trial".to_string(),
            new_end_date: 1641081600,
        };

        assert_eq!(request.org_id, "org-trial");
        assert_eq!(request.new_end_date, 1641081600);
    }

    #[test]
    fn test_org_summary() {
        let stream_summary = StreamSummary {
            num_streams: 10,
            total_records: 1000000,
            total_storage_size: 1024.0 * 1024.0 * 100.0, // 100MB
            total_compressed_size: 1024.0 * 1024.0 * 25.0, // 25MB
            total_index_size: 1024.0 * 1024.0 * 5.0,     // 5MB
        };

        let pipeline_summary = PipelineSummary {
            num_realtime: 5,
            num_scheduled: 3,
        };

        let alert_summary = AlertSummary {
            num_realtime: 12,
            num_scheduled: 8,
        };

        let summary = OrgSummary {
            streams: stream_summary,
            pipelines: pipeline_summary,
            alerts: alert_summary,
            total_functions: 25,
            total_dashboards: 15,
        };

        assert_eq!(summary.streams.num_streams, 10);
        assert_eq!(summary.streams.total_records, 1000000);
        assert_eq!(summary.pipelines.num_realtime, 5);
        assert_eq!(summary.pipelines.num_scheduled, 3);
        assert_eq!(summary.alerts.num_realtime, 12);
        assert_eq!(summary.alerts.num_scheduled, 8);
        assert_eq!(summary.total_functions, 25);
        assert_eq!(summary.total_dashboards, 15);
    }

    #[test]
    fn test_organization_setting_with_trial_expiry() {
        let setting = OrganizationSetting {
            free_trial_expiry: Some(1641081600),
            ..Default::default()
        };

        assert_eq!(setting.free_trial_expiry, Some(1641081600));
        assert_eq!(setting.trace_id_field_name, "trace_id");
        assert_eq!(setting.span_id_field_name, "span_id");
    }

    #[test]
    fn test_organization_setting_response() {
        let setting = OrganizationSetting::default();
        let response = OrganizationSettingResponse {
            data: setting.clone(),
        };

        assert_eq!(
            response.data.trace_id_field_name,
            setting.trace_id_field_name
        );
        assert_eq!(response.data.span_id_field_name, setting.span_id_field_name);
    }

    #[test]
    fn test_node_list_response_multiple_regions() {
        let node1 = Node {
            name: "node-1".to_string(),
            ..Default::default()
        };

        let node2 = Node {
            name: "node-2".to_string(),
            ..Default::default()
        };

        let mut response = NodeListResponse::new();
        response.add_node(
            node1.clone(),
            "us-east".to_string(),
            "cluster-a".to_string(),
        );
        response.add_node(
            node2.clone(),
            "eu-west".to_string(),
            "cluster-b".to_string(),
        );

        assert_eq!(response.regions.len(), 2);
        assert!(response.regions.contains_key("us-east"));
        assert!(response.regions.contains_key("eu-west"));

        let us_nodes = &response
            .regions
            .get("us-east")
            .unwrap()
            .clusters
            .get("cluster-a")
            .unwrap();
        assert_eq!(us_nodes.len(), 1);
        assert_eq!(us_nodes[0].name, "node-1");

        let eu_nodes = &response
            .regions
            .get("eu-west")
            .unwrap()
            .clusters
            .get("cluster-b")
            .unwrap();
        assert_eq!(eu_nodes.len(), 1);
        assert_eq!(eu_nodes[0].name, "node-2");
    }

    #[test]
    fn test_cluster_info_response_multiple_clusters() {
        let mut response = ClusterInfoResponse::default();

        let info1 = ClusterInfo { pending_jobs: 5 };
        let info2 = ClusterInfo { pending_jobs: 10 };

        response.add_cluster_info(
            info1.clone(),
            "cluster-1".to_string(),
            "us-east".to_string(),
        );
        response.add_cluster_info(
            info2.clone(),
            "cluster-2".to_string(),
            "us-east".to_string(),
        );

        assert_eq!(response.regions.len(), 1);
        let region = response.regions.get("us-east").unwrap();
        assert_eq!(region.clusters.len(), 2);
        assert_eq!(region.clusters.get("cluster-1").unwrap().pending_jobs, 5);
        assert_eq!(region.clusters.get("cluster-2").unwrap().pending_jobs, 10);
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_organization_invite_response() {
        let data = OrganizationInviteResponseData {
            valid_members: Some(vec!["user1@example.com".to_string()]),
            existing_members: None,
            invalid_email: None,
        };

        let response = OrganizationInviteResponse {
            data,
            message: "Invitation sent successfully".to_string(),
        };

        assert_eq!(response.message, "Invitation sent successfully");
        assert!(response.data.valid_members.is_some());
        assert_eq!(response.data.valid_members.as_ref().unwrap().len(), 1);
    }
}
