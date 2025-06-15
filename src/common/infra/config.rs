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
    RwAHashMap, RwHashMap,
    meta::{
        alerts::alert::Alert,
        dashboards::reports,
        destinations::{Destination, Template},
        folder::Folder,
        function::Transform,
        promql::ClusterLeader,
        ratelimit::CachedUserRoles,
        stream::StreamParams,
        user::User,
    },
};
use dashmap::DashMap;
use hashbrown::HashMap;
use infra::table::short_urls::ShortUrlRecord;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use tokio::sync::{RwLock as TokioRwLock, mpsc};
use vector_enrichment::TableRegistry;

use crate::{
    common::meta::{
        maxmind::MaxmindClient,
        organization::{Organization, OrganizationSetting},
        syslog::SyslogRoute,
    },
    handler::http::request::ws::session::WsSession,
    service::{
        db::scheduler as db_scheduler, enrichment::StreamTable, enrichment_table::geoip::Geoip,
        pipeline::batch_execution::ExecutablePipeline,
    },
};

// global cache variables
pub static KVS: Lazy<RwHashMap<String, bytes::Bytes>> = Lazy::new(Default::default);
pub static QUERY_FUNCTIONS: Lazy<RwHashMap<String, Transform>> = Lazy::new(DashMap::default);
pub static USERS: Lazy<RwHashMap<String, infra::table::users::UserRecord>> =
    Lazy::new(DashMap::default);
pub static ORG_USERS: Lazy<RwHashMap<String, infra::table::org_users::OrgUserRecord>> =
    Lazy::new(DashMap::default);
pub static USERS_RUM_TOKEN: Lazy<Arc<RwHashMap<String, infra::table::org_users::OrgUserRecord>>> =
    Lazy::new(|| Arc::new(DashMap::default()));
pub static ROOT_USER: Lazy<RwHashMap<String, User>> = Lazy::new(DashMap::default);
pub static ORGANIZATION_SETTING: Lazy<Arc<RwAHashMap<String, OrganizationSetting>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static ORGANIZATIONS: Lazy<Arc<RwAHashMap<String, Organization>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static PASSWORD_HASH: Lazy<RwHashMap<String, String>> = Lazy::new(DashMap::default);
pub static METRIC_CLUSTER_MAP: Lazy<Arc<RwAHashMap<String, Vec<String>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static METRIC_CLUSTER_LEADER: Lazy<Arc<RwAHashMap<String, ClusterLeader>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static STREAM_ALERTS: Lazy<RwAHashMap<String, Vec<String>>> = Lazy::new(Default::default);
pub static ALERTS: Lazy<RwAHashMap<String, (Folder, Alert)>> = Lazy::new(Default::default);
// Key for realtime alert triggers cache is org/alert_id
pub static REALTIME_ALERT_TRIGGERS: Lazy<RwAHashMap<String, db_scheduler::Trigger>> =
    Lazy::new(Default::default);
pub static ALERTS_TEMPLATES: Lazy<RwHashMap<String, Template>> = Lazy::new(Default::default);
pub static DESTINATIONS: Lazy<RwHashMap<String, Destination>> = Lazy::new(Default::default);
pub static DASHBOARD_REPORTS: Lazy<RwHashMap<String, reports::Report>> =
    Lazy::new(Default::default);
pub static SYSLOG_ROUTES: Lazy<RwHashMap<String, SyslogRoute>> = Lazy::new(Default::default);
pub static SYSLOG_ENABLED: Lazy<Arc<RwLock<bool>>> = Lazy::new(|| Arc::new(RwLock::new(false)));
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

pub static STREAM_EXECUTABLE_PIPELINES: Lazy<RwAHashMap<StreamParams, ExecutablePipeline>> =
    Lazy::new(Default::default);
pub static PIPELINE_STREAM_MAPPING: Lazy<RwAHashMap<String, StreamParams>> =
    Lazy::new(Default::default);
pub static USER_SESSIONS: Lazy<RwHashMap<String, String>> = Lazy::new(Default::default);
pub static SHORT_URLS: Lazy<RwHashMap<String, ShortUrlRecord>> = Lazy::new(DashMap::default);
// TODO: Implement rate limiting for maximum number of sessions
// Querier Connection Pool
pub static WS_SESSIONS: Lazy<RwAHashMap<String, Arc<TokioRwLock<WsSession>>>> =
    Lazy::new(Default::default);
pub static USER_ROLES_CACHE: Lazy<RwAHashMap<String, CachedUserRoles>> =
    Lazy::new(Default::default);

/// Refreshes in-memory cache in the event of NATs restart.
///
/// We should add all in-memory caches listed above that a CacheMiss is not followed by
/// reading from db, e.g. UserSession, Pipeline
pub(crate) async fn update_cache(mut nats_event_rx: mpsc::Receiver<infra::db::nats::NatsEvent>) {
    let mut first_conenction = true;
    while let Some(event) = nats_event_rx.recv().await {
        if let infra::db::nats::NatsEvent::Connected = event {
            // Skip refreshing if it's the first time connecting to the client
            if first_conenction {
                first_conenction = false;
                continue;
            }
            log::info!(
                "[infra::config] received NATs event: {event}, refreshing in-memory cache for Alerts, Pipelines, RealtimeTriggers, Schema, Users, and UserSessions"
            );
            match crate::service::db::session::cache().await {
                Ok(()) => log::info!(
                    "[infra::config] Successfully refreshed in-memory cache \"UserSessions\""
                ),
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"UserSessions\": {}",
                    e
                ),
            }
            match crate::service::db::user::cache().await {
                Ok(()) => {
                    log::info!("[infra::config] Successfully refreshed in-memory cache \"Users\"")
                }
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"Users\": {}",
                    e
                ),
            }
            match crate::service::db::pipeline::cache().await {
                Ok(()) => log::info!(
                    "[infra::config] Successfully refreshed in-memory cache \"Pipelines\""
                ),
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"Pipelines\": {}",
                    e
                ),
            }
            match crate::service::db::alerts::alert::cache().await {
                Ok(()) => {
                    log::info!("[infra::config] Successfully refreshed in-memory cache \"Alerts\"")
                }
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"Alerts\": {}",
                    e
                ),
            }
            match crate::service::db::alerts::realtime_triggers::cache().await {
                Ok(()) => log::info!(
                    "[infra::config] Successfully refreshed in-memory cache \"RealtimeTriggers\""
                ),
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"RealtimeTriggers\": {}",
                    e
                ),
            }
            match crate::service::db::schema::cache().await {
                Ok(()) => {
                    log::info!("[infra::config] Successfully refreshed in-memory cache \"Schema\"")
                }
                Err(e) => log::error!(
                    "[infra::config] Error refreshing in-memory cache \"Schema\": {}",
                    e
                ),
            }
        }
    }

    log::info!("[infra::config] stops to listen to NATs event to refresh in-memory caches");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_update_cache() {
        let (tx, rx) = mpsc::channel(100);
        tokio::spawn(async move { update_cache(rx).await });
        tx.send(infra::db::nats::NatsEvent::Connected)
            .await
            .unwrap();
    }
}
