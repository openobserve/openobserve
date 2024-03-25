// Copyright 2023 Zinc Labs Inc.
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

use arrow_schema::Schema;
use config::{RwAHashMap, RwAHashSet, RwHashMap};
use dashmap::DashMap;
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use vector_enrichment::TableRegistry;

use crate::{
    common::meta::{
        alerts,
        dashboards::reports,
        functions::{StreamFunctionsList, Transform},
        maxmind::MaxmindClient,
        organization::OrganizationSetting,
        prom::ClusterLeader,
        stream::StreamSettings,
        syslog::SyslogRoute,
        user::User,
    },
    service::{enrichment::StreamTable, enrichment_table::geoip::Geoip},
};

// global version variables
pub static VERSION: &str = env!("GIT_VERSION");
pub static COMMIT_HASH: &str = env!("GIT_COMMIT_HASH");
pub static BUILD_DATE: &str = env!("GIT_BUILD_DATE");

// global cache variables
pub static KVS: Lazy<RwHashMap<String, bytes::Bytes>> = Lazy::new(Default::default);
pub static STREAM_SCHEMAS: Lazy<RwAHashMap<String, Vec<Schema>>> = Lazy::new(Default::default);
pub static STREAM_SCHEMAS_LATEST: Lazy<RwAHashMap<String, Schema>> = Lazy::new(Default::default);
pub static STREAM_SCHEMAS_FIELDS: Lazy<RwAHashMap<String, (i64, Vec<String>)>> =
    Lazy::new(Default::default);
pub static STREAM_SETTINGS: Lazy<RwAHashMap<String, StreamSettings>> = Lazy::new(Default::default);
pub static STREAM_FUNCTIONS: Lazy<RwHashMap<String, StreamFunctionsList>> =
    Lazy::new(DashMap::default);
pub static QUERY_FUNCTIONS: Lazy<RwHashMap<String, Transform>> = Lazy::new(DashMap::default);
pub static USERS: Lazy<RwHashMap<String, User>> = Lazy::new(DashMap::default);
pub static USERS_RUM_TOKEN: Lazy<Arc<RwHashMap<String, User>>> =
    Lazy::new(|| Arc::new(DashMap::default()));
pub static ROOT_USER: Lazy<RwHashMap<String, User>> = Lazy::new(DashMap::default);
pub static ORGANIZATION_SETTING: Lazy<Arc<RwAHashMap<String, OrganizationSetting>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static PASSWORD_HASH: Lazy<RwHashMap<String, String>> = Lazy::new(DashMap::default);
pub static METRIC_CLUSTER_MAP: Lazy<Arc<RwAHashMap<String, Vec<String>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static METRIC_CLUSTER_LEADER: Lazy<Arc<RwAHashMap<String, ClusterLeader>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));
pub static STREAM_ALERTS: Lazy<RwAHashMap<String, Vec<alerts::Alert>>> =
    Lazy::new(Default::default);
pub static ALERTS_TEMPLATES: Lazy<RwHashMap<String, alerts::templates::Template>> =
    Lazy::new(Default::default);
pub static ALERTS_DESTINATIONS: Lazy<RwHashMap<String, alerts::destinations::Destination>> =
    Lazy::new(Default::default);
pub static DASHBOARD_REPORTS: Lazy<RwHashMap<String, reports::Report>> =
    Lazy::new(Default::default);
pub static SYSLOG_ROUTES: Lazy<RwHashMap<String, SyslogRoute>> = Lazy::new(Default::default);
pub static SYSLOG_ENABLED: Lazy<Arc<RwLock<bool>>> = Lazy::new(|| Arc::new(RwLock::new(false)));
pub static ENRICHMENT_TABLES: Lazy<RwHashMap<String, StreamTable>> = Lazy::new(Default::default);
pub static ENRICHMENT_REGISTRY: Lazy<Arc<TableRegistry>> =
    Lazy::new(|| Arc::new(TableRegistry::default()));
pub static LOCAL_SCHEMA_LOCKER: Lazy<Arc<RwAHashMap<String, Arc<tokio::sync::RwLock<bool>>>>> =
    Lazy::new(|| Arc::new(Default::default)());

pub static MAXMIND_DB_CLIENT: Lazy<Arc<tokio::sync::RwLock<Option<MaxmindClient>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(None)));

pub static GEOIP_CITY_TABLE: Lazy<Arc<RwLock<Option<Geoip>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

pub static GEOIP_ASN_TABLE: Lazy<Arc<RwLock<Option<Geoip>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

// SEARCHING_FILES for searching files, in use, should not move to s3
pub static SEARCHING_FILES: Lazy<RwAHashSet<String>> =
    Lazy::new(|| tokio::sync::RwLock::new(Default::default()));
