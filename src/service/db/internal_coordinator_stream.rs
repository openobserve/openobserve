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

use config::cluster::LOCAL_NODE;
use infra::{
    cluster_coordinator::{
        alerts::ALERT_WATCHER_PREFIX, events::InternalCoordinatorEvent,
        pipelines::PIPELINES_WATCH_PREFIX,
    },
    schema::SCHEMA_KEY,
};

#[cfg(feature = "enterprise")]
use super::keys::CIPHER_KEY_PREFIX;
#[cfg(feature = "enterprise")]
use super::ofga::OFGA_KEY_PREFIX;
#[cfg(feature = "enterprise")]
use super::session::USER_SESSION_KEY;
use crate::{
    common::infra::cluster::NODES_KEY,
    service::db::{
        alerts::{destinations::DESTINATION_WATCHER_PREFIX, templates::TEMPLATE_WATCHER_PREFIX},
        compact::retention::RETENTION_KEY,
        dashboards::reports::REPORTS_WATCHER_PREFIX,
        enrichment_table::ENRICHMENT_TABLE_WATCH_KEY,
        functions::FUNCTIONS_KEY,
        metrics::PROM_CLUSTER_LEADER_KEY,
        organization::ORG_SETTINGS_KEY_PREFIX,
        short_url::SHORT_URL_KEY,
        syslog::{SYSLOG_ROUTES_KEY, SYSLOG_SETTINGS_KEY},
        user::USER_KEY_PREFIX,
    },
};

pub async fn handle_internal_coordinator_event(payload: Vec<u8>) -> Result<(), anyhow::Error> {
    let event: InternalCoordinatorEvent = match serde_json::from_slice(&payload) {
        Ok(event) => event,
        Err(e) => {
            log::error!("Error deserializing internal coordinator event: {}", e);
            return Err(anyhow::anyhow!(
                "Error deserializing internal coordinator event: {}",
                e
            ));
        }
    };
    let InternalCoordinatorEvent::Meta(event) = event;
    match get_module_from_event(&event.key) {
        Module::Schema => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_SCHEMA_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::schema::handle_schema_event(event).await
            } else {
                Ok(())
            }
        }
        Module::User => {
            // All the nodes need User cache
            log::debug!(
                "[INTERNAL_COORDINATOR::HANDLE_USER_EVENT] handling meta coordinator event: {:?}",
                event
            );
            super::user::handle_user_event(event).await
        }
        Module::EnrichmentTable => {
            if LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier() || LOCAL_NODE.is_alert_manager()
            {
                super::enrichment_table::handle_enrichment_table_event(event).await
            } else {
                Ok(())
            }
        }
        Module::ShortUrl => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_SHORT_URL_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::short_url::handle_short_url_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Functions => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_FUNCTIONS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::functions::handle_functions_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Retention => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_RETENTION_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::compact::retention::handle_retention_event(event).await
            } else {
                Ok(())
            }
        }
        Module::MetricsLeader => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_METRICS_LEADER_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::metrics::handle_prom_cluster_leader_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Templates => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_TEMPLATES_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::alerts::templates::handle_template_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Destinations => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_DESTINATIONS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::alerts::destinations::handle_destination_event(event).await
            } else {
                Ok(())
            }
        }
        Module::RealtimeTriggers => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_REALTIME_TRIGGERS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::alerts::realtime_triggers::handle_realtime_triggers_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Alerts => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_ALERTS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::alerts::alert::handle_alert_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Reports => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_REPORTS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::dashboards::reports::handle_reports_event(event).await
            } else {
                Ok(())
            }
        }
        Module::OrgSettings => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_ORG_SETTINGS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::organization::handle_org_settings_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Pipeline => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_PIPELINE_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::pipeline::handle_pipeline_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Syslog => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_SYSLOG_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::syslog::handle_syslog_event(event).await
            } else {
                Ok(())
            }
        }
        Module::SyslogSettings => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_SYSLOG_SETTINGS_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::syslog::handle_syslog_settings_event(event).await
            } else {
                Ok(())
            }
        }
        Module::Node => {
            log::debug!(
                "[INTERNAL_COORDINATOR::HANDLE_NODE_EVENT] handling meta coordinator event: {:?}",
                event
            );
            crate::common::infra::cluster::handle_node_list_event(event).await
        }
        #[cfg(feature = "enterprise")]
        Module::UserSession => {
            if only_ingester_and_querier() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_USER_SESSION_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::session::handle_user_session_event(event).await
            } else {
                Ok(())
            }
        }
        #[cfg(feature = "enterprise")]
        Module::Cipher => {
            if not_router() {
                log::debug!(
                    "[INTERNAL_COORDINATOR::HANDLE_CIPHER_EVENT] handling meta coordinator event: {:?}",
                    event
                );
                super::keys::handle_cipher_key_event(event).await
            } else {
                Ok(())
            }
        }
        #[cfg(feature = "enterprise")]
        Module::Ofga => {
            log::debug!(
                "[INTERNAL_COORDINATOR::HANDLE_OFGA_EVENT] handling meta coordinator event: {:?}",
                event
            );
            super::ofga::handle_ofga_event(event).await
        }
        Module::Unknown => {
            log::warn!(
                "[INTERNAL_COORDINATOR::HANDLE_UNKNOWN_EVENT] handling meta coordinator event: {:?}",
                event
            );
            Ok(())
        }
    }
}

fn not_router() -> bool {
    !LOCAL_NODE.is_router()
}

#[cfg(feature = "enterprise")]
fn only_ingester_and_querier() -> bool {
    LOCAL_NODE.is_ingester() || LOCAL_NODE.is_querier()
}

pub enum Module {
    Schema,
    User,
    EnrichmentTable,
    #[cfg(feature = "enterprise")]
    Ofga,
    ShortUrl,
    Functions,
    Retention,
    MetricsLeader,
    Templates,
    Destinations,
    RealtimeTriggers,
    Alerts,
    Reports,
    OrgSettings,
    Pipeline,
    #[cfg(feature = "enterprise")]
    UserSession,
    #[cfg(feature = "enterprise")]
    Cipher,
    Syslog,
    SyslogSettings,
    Node,
    Unknown,
}

pub fn get_module_from_event(event_key: &str) -> Module {
    #[cfg(feature = "enterprise")]
    if event_key.starts_with(OFGA_KEY_PREFIX) {
        return Module::Ofga;
    } else if event_key.starts_with(USER_SESSION_KEY) {
        return Module::UserSession;
    } else if event_key.starts_with(CIPHER_KEY_PREFIX) {
        return Module::Cipher;
    }
    let alert_key = format!(
        "{}{}/",
        infra::scheduler::TRIGGERS_KEY,
        config::meta::triggers::TriggerModule::Alert
    );
    if event_key.starts_with(SCHEMA_KEY) {
        Module::Schema
    } else if event_key.starts_with(USER_KEY_PREFIX) {
        Module::User
    } else if event_key.starts_with(ENRICHMENT_TABLE_WATCH_KEY) {
        Module::EnrichmentTable
    } else if event_key.starts_with(SHORT_URL_KEY) {
        Module::ShortUrl
    } else if event_key.starts_with(FUNCTIONS_KEY) {
        Module::Functions
    } else if event_key.starts_with(RETENTION_KEY) {
        Module::Retention
    } else if event_key.starts_with(PROM_CLUSTER_LEADER_KEY) {
        Module::MetricsLeader
    } else if event_key.starts_with(TEMPLATE_WATCHER_PREFIX) {
        Module::Templates
    } else if event_key.starts_with(DESTINATION_WATCHER_PREFIX) {
        Module::Destinations
    } else if event_key.starts_with(&alert_key) {
        Module::RealtimeTriggers
    } else if event_key.starts_with(ALERT_WATCHER_PREFIX) {
        Module::Alerts
    } else if event_key.starts_with(REPORTS_WATCHER_PREFIX) {
        Module::Reports
    } else if event_key.starts_with(ORG_SETTINGS_KEY_PREFIX) {
        Module::OrgSettings
    } else if event_key.starts_with(PIPELINES_WATCH_PREFIX) {
        Module::Pipeline
    } else if event_key.starts_with(SYSLOG_ROUTES_KEY) {
        Module::Syslog
    } else if event_key.starts_with(SYSLOG_SETTINGS_KEY) {
        Module::SyslogSettings
    } else if event_key.starts_with(NODES_KEY) {
        Module::Node
    } else {
        Module::Unknown
    }
}
