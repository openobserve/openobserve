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
    RwHashMap,
    meta::{
        alerts::alert::Alert,
        destinations::{Destination, Template},
        folder::Folder,
        function::Transform,
        pipeline::Pipeline,
        promql::ClusterLeader,
        ratelimit::CachedUserRoles,
        stream::StreamParams,
        system_settings::SystemSetting,
        user::User,
    },
};
use infra::table::short_urls::ShortUrlRecord;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use vector_enrichment::TableRegistry;

use crate::{
    common::meta::{
        maxmind::MaxmindClient,
        organization::{Organization, OrganizationSetting},
    },
    service::{
        db::scheduler as db_scheduler, enrichment::StreamTable, enrichment_table::geoip::Geoip,
        pipeline::batch_execution::ExecutablePipeline,
    },
};

// global cache variables
pub static KVS: Lazy<RwHashMap<String, bytes::Bytes>> = Lazy::new(Default::default);
pub static QUERY_FUNCTIONS: Lazy<RwHashMap<String, Transform>> = Lazy::new(Default::default);
pub static USERS: Lazy<RwHashMap<String, infra::table::users::UserRecord>> =
    Lazy::new(Default::default);
pub static ORG_USERS: Lazy<RwHashMap<String, infra::table::org_users::OrgUserRecord>> =
    Lazy::new(Default::default);
pub static USERS_RUM_TOKEN: Lazy<RwHashMap<String, infra::table::org_users::OrgUserRecord>> =
    Lazy::new(Default::default);
pub static ROOT_USER: Lazy<RwHashMap<String, User>> = Lazy::new(Default::default);
pub static ORGANIZATION_SETTING: Lazy<RwHashMap<String, OrganizationSetting>> =
    Lazy::new(Default::default);
pub static ORGANIZATIONS: Lazy<RwHashMap<String, Organization>> = Lazy::new(Default::default);
pub static PASSWORD_HASH: Lazy<RwHashMap<String, String>> = Lazy::new(Default::default);
pub static METRIC_CLUSTER_MAP: Lazy<RwHashMap<String, Vec<String>>> = Lazy::new(Default::default);
pub static METRIC_CLUSTER_LEADER: Lazy<RwHashMap<String, ClusterLeader>> =
    Lazy::new(Default::default);
pub static STREAM_ALERTS: Lazy<RwHashMap<String, Vec<String>>> = Lazy::new(Default::default);
pub static ALERTS: Lazy<RwHashMap<String, (Folder, Alert)>> = Lazy::new(Default::default);
// Key for realtime alert triggers cache is org/alert_id
pub static REALTIME_ALERT_TRIGGERS: Lazy<RwHashMap<String, db_scheduler::Trigger>> =
    Lazy::new(Default::default);
pub static ALERTS_TEMPLATES: Lazy<RwHashMap<String, Template>> = Lazy::new(Default::default);
pub static DESTINATIONS: Lazy<RwHashMap<String, Destination>> = Lazy::new(Default::default);
pub static ENRICHMENT_TABLES: Lazy<RwHashMap<String, StreamTable>> = Lazy::new(Default::default);
pub static ENRICHMENT_REGISTRY: Lazy<Arc<TableRegistry>> =
    Lazy::new(|| Arc::new(TableRegistry::default()));

pub static MAXMIND_DB_CLIENT: Lazy<Arc<tokio::sync::RwLock<Option<MaxmindClient>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(None)));

pub static GEOIP_CITY_TABLE: Lazy<Arc<RwLock<Option<Geoip>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

pub static GEOIP_ASN_TABLE: Lazy<Arc<RwLock<Option<Geoip>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

#[cfg(feature = "enterprise")]
pub static GEOIP_ENT_TABLE: Lazy<Arc<RwLock<Option<Geoip>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

pub static STREAM_EXECUTABLE_PIPELINES: Lazy<RwHashMap<StreamParams, ExecutablePipeline>> =
    Lazy::new(Default::default);
pub static PIPELINE_STREAM_MAPPING: Lazy<RwHashMap<String, StreamParams>> =
    Lazy::new(Default::default);

pub static SCHEDULED_PIPELINES: Lazy<RwHashMap<String, Pipeline>> = Lazy::new(Default::default);
pub static USER_SESSIONS: Lazy<RwHashMap<String, String>> = Lazy::new(Default::default);
pub static SHORT_URLS: Lazy<RwHashMap<String, ShortUrlRecord>> = Lazy::new(Default::default);
pub static USER_ROLES_CACHE: Lazy<RwHashMap<String, CachedUserRoles>> = Lazy::new(Default::default);

/// System settings cache
/// Key format: "{scope}:{org_id}:{user_id}:{setting_key}" where org_id/user_id can be "_" if not
/// applicable
pub static SYSTEM_SETTINGS: Lazy<Arc<RwHashMap<String, SystemSetting>>> =
    Lazy::new(|| Arc::new(Default::default()));

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_static_variables_initialization() {
        // Test that all static variables can be accessed and are properly initialized

        // Test RwHashMap variables are initialized

        // Test Arc<RwLock> variables
        let users_rum_token = USERS_RUM_TOKEN.clone();
        assert_eq!(users_rum_token.len(), 0);

        // Test enrichment registry
        let registry = ENRICHMENT_REGISTRY.clone();
        assert!(!std::ptr::eq(registry.as_ref(), std::ptr::null()));
    }

    #[tokio::test]
    async fn test_organization_setting_access() {
        assert_eq!(ORGANIZATION_SETTING.pin().len(), 0);

        // Test write access
        ORGANIZATION_SETTING
            .pin()
            .insert("test_org".to_string(), OrganizationSetting::default());
        assert_eq!(ORGANIZATION_SETTING.pin().len(), 1);
        assert!(ORGANIZATION_SETTING.pin().contains_key("test_org"));
    }

    #[tokio::test]
    async fn test_organizations_access() {
        assert_eq!(ORGANIZATIONS.pin().len(), 0);

        // Test write access
        let org = Organization {
            identifier: "test_org".to_string(),
            name: "Test Organization".to_string(),
            org_type: "standard".to_string(),
        };
        ORGANIZATIONS.pin().insert("test_org".to_string(), org);
        assert_eq!(ORGANIZATIONS.pin().len(), 1);
        assert!(ORGANIZATIONS.pin().contains_key("test_org"));
    }

    #[tokio::test]
    async fn test_metric_cluster_map() {
        assert_eq!(METRIC_CLUSTER_MAP.pin().len(), 0);

        // Test write access
        METRIC_CLUSTER_MAP.pin().insert(
            "test_metric".to_string(),
            vec!["node1".to_string(), "node2".to_string()],
        );
        assert_eq!(METRIC_CLUSTER_MAP.pin().len(), 1);
        assert!(METRIC_CLUSTER_MAP.pin().contains_key("test_metric"));
        if let Some(nodes) = METRIC_CLUSTER_MAP.pin().get("test_metric") {
            assert_eq!(nodes.len(), 2);
            assert!(nodes.contains(&"node1".to_string()));
            assert!(nodes.contains(&"node2".to_string()));
        }
    }

    #[tokio::test]
    async fn test_metric_cluster_leader() {
        assert_eq!(METRIC_CLUSTER_LEADER.pin().len(), 0);

        // Test write access
        METRIC_CLUSTER_LEADER.pin().insert(
            "test_cluster".to_string(),
            ClusterLeader {
                name: "leader_node".to_string(),
                last_received: chrono::Utc::now().timestamp_micros(),
                updated_by: "test_node".to_string(),
            },
        );
        assert_eq!(METRIC_CLUSTER_LEADER.pin().len(), 1);
        assert!(METRIC_CLUSTER_LEADER.pin().contains_key("test_cluster"));
    }

    #[tokio::test]
    async fn test_maxmind_db_client() {
        let maxmind_client = MAXMIND_DB_CLIENT.clone();
        let read_guard = maxmind_client.read().await;
        assert!(read_guard.is_none());
        drop(read_guard);

        // Test write access - just test that we can write None/Some pattern
        let write_guard = maxmind_client.write().await;
        // We can't create a MaxmindClient without a database file, so just test the Option pattern
        assert!(write_guard.is_none());
        drop(write_guard);

        // Verify the state
        let read_guard = maxmind_client.read().await;
        assert!(read_guard.is_none());
    }

    #[test]
    fn test_geoip_tables() {
        // Test GEOIP_CITY_TABLE
        let city_table = GEOIP_CITY_TABLE.clone();
        let read_guard = city_table.read();
        assert!(read_guard.is_none());
        drop(read_guard);

        // Test GEOIP_ASN_TABLE
        let asn_table = GEOIP_ASN_TABLE.clone();
        let read_guard = asn_table.read();
        assert!(read_guard.is_none());
        drop(read_guard);

        #[cfg(feature = "enterprise")]
        {
            // Test GEOIP_ENT_TABLE (only available with enterprise feature)
            let ent_table = GEOIP_ENT_TABLE.clone();
            let read_guard = ent_table.read();
            assert!(read_guard.is_none());
        }
    }

    #[test]
    fn test_dashmap_operations() {
        // Test basic DashMap operations on KVS
        let test_key = "test_key".to_string();
        let test_value = bytes::Bytes::from("test_value");

        let map = KVS.pin();

        // Insert
        map.insert(test_key.clone(), test_value.clone());
        assert_eq!(map.len(), 1);

        // Get
        let retrieved = map.get(&test_key);
        assert!(retrieved.is_some());
        assert_eq!(*retrieved.unwrap(), test_value);

        // Remove
        map.remove(&test_key);
        assert_eq!(map.len(), 0);
    }

    #[test]
    fn test_query_functions_cache() {
        let test_key = "test_function".to_string();
        let test_transform = Transform {
            function: "test_function".to_string(),
            name: "test".to_string(),
            params: "".to_string(),
            num_args: 0,
            trans_type: Some(0),
            streams: None,
        };

        let map = QUERY_FUNCTIONS.pin();

        // Insert
        map.insert(test_key.clone(), test_transform.clone());
        assert_eq!(map.len(), 1);

        // Verify existence
        assert!(map.contains_key(&test_key));

        // Clean up
        map.remove(&test_key);
        assert_eq!(map.len(), 0);
    }
}
