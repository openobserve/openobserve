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

use std::sync::Arc;

// #[cfg(feature = "cloud")]
// use o2_enterprise::enterprise::cloud::org_usage::{self, OrgUsageRecord};
use common::{
    infra::config::{ORGANIZATION_SETTING, ORGANIZATIONS},
    meta::organization::{Organization, OrganizationSetting},
};
use config::{
    get_config,
    meta::stream::{
        DataRetentionDefaults, MAX_DATA_RETENTION_DAYS, RETENTION_STREAM_TYPES, StreamType,
    },
    utils::{
        json,
        util::{DISTINCT_STREAM_PREFIX, TRACE_TIME_INDEX_STREAM_PREFIX},
    },
};
use infra::{
    coordinator::org_status::{STATUS_DELETED, STATUS_DELETING, STATUS_PENDING_DELETION},
    db::{delete_from_db_coordinator, put_into_db_coordinator},
    errors::{self, Error},
    table::organizations,
};

use crate as db;

// DBKey to set settings for an org
pub const ORG_SETTINGS_KEY_PREFIX: &str = "/organization/setting";

pub const ORG_KEY_PREFIX: &str = "/organization/org/";

pub async fn set_org_setting(org_name: &str, setting: &OrganizationSetting) -> errors::Result<()> {
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_name}");
    db::put(
        &key,
        json::to_vec(&setting).unwrap().into(),
        db::NEED_WATCH,
        None,
    )
    .await?;

    // cache the org setting
    ORGANIZATION_SETTING
        .clone()
        .write()
        .await
        .insert(key.to_string(), setting.clone());
    Ok(())
}

pub async fn get_org_setting(org_id: &str) -> Result<OrganizationSetting, Error> {
    #[cfg(not(feature = "cloud"))]
    let trial_period_expiry = None;
    #[cfg(feature = "cloud")]
    let trial_period_expiry = {
        use o2_enterprise::enterprise::{
            cloud::billings, common::config::get_config as get_o2_config,
        };
        let o2_config = get_o2_config();

        // if trial period check is disabled, everything is free trial period
        if !o2_config.cloud.trial_period_enabled || org_id == "_meta" {
            None
        } else {
            // first check if the org is
            let subscription = billings::get_billing_by_org_id(org_id).await.ok();
            match subscription {
                None | Some(None) => match infra::table::organizations::get(org_id).await {
                    Ok(org) => Some(org.trial_ends_at),
                    Err(_) => None,
                },
                Some(Some(s)) if s.subscription_type.is_free_sub() => {
                    match infra::table::organizations::get(org_id).await {
                        Ok(org) => Some(org.trial_ends_at),
                        Err(_) => None,
                    }
                }
                _ => None,
            }
        }
    };

    let mut settings = read_org_setting(org_id, OrganizationSetting::clone).await?;
    settings.free_trial_expiry = trial_period_expiry;
    Ok(settings)
}

/// Picks from the org's cached settings, caching the stored or default settings on a miss.
pub async fn read_org_setting<T>(
    org_id: &str,
    pick: impl FnOnce(&OrganizationSetting) -> T,
) -> Result<T, Error> {
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
    if let Some(v) = ORGANIZATION_SETTING.read().await.get(&key) {
        return Ok(pick(v));
    }

    let settings: OrganizationSetting = match db::get(&key).await {
        Ok(settings) => json::from_slice(&settings)?,
        Err(Error::DbError(infra::errors::DbError::KeyNotExists(_))) => {
            OrganizationSetting::default()
        }
        Err(e) => return Err(e),
    };
    let picked = pick(&settings);
    ORGANIZATION_SETTING.write().await.insert(key, settings);
    Ok(picked)
}

/// Days a stream keeps data, resolved on read; 0 keeps it forever.
pub async fn stream_retention_days(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    stream_days: i64,
) -> Result<i64, Error> {
    match stream_type {
        StreamType::Index => index_stream_retention_days(org_id, stream_name).await,
        StreamType::Metadata => {
            metadata_stream_retention_days(org_id, stream_name, stream_days).await
        }
        _ => data_stream_retention_days(org_id, stream_type, stream_days).await,
    }
}

/// The global levels alone, for a caller that only estimates and can live with a failed org read.
pub fn global_retention_days(stream_type: StreamType) -> i64 {
    default_retention_days(
        stream_type,
        &DataRetentionDefaults::default(),
        &global_retention_defaults(),
    )
}

/// The org's stored defaults; a failed read is an error, never the possibly shorter global value.
#[cfg(feature = "enterprise")]
pub async fn org_retention_defaults(org_id: &str) -> Result<DataRetentionDefaults, Error> {
    read_org_setting(org_id, org_setting_retention_defaults).await
}

/// The org layer is not compiled in, so it has nothing to say.
#[cfg(not(feature = "enterprise"))]
pub async fn org_retention_defaults(_org_id: &str) -> Result<DataRetentionDefaults, Error> {
    Ok(DataRetentionDefaults::default())
}

/// What a stream of each type with no value of its own resolves to under these org values.
pub fn resolved_retention_defaults(org: &DataRetentionDefaults) -> DataRetentionDefaults {
    let global = global_retention_defaults();
    let days = |stream_type| default_retention_days(stream_type, org, &global);
    DataRetentionDefaults {
        default: first_positive(&[org.default, global.default]),
        logs: days(StreamType::Logs),
        metrics: days(StreamType::Metrics),
        traces: days(StreamType::Traces),
        profiles: days(StreamType::Profiles),
    }
}

/// The org's stored defaults; every level is 0 where the org layer is not compiled in.
pub fn org_setting_retention_defaults(setting: &OrganizationSetting) -> DataRetentionDefaults {
    #[cfg(feature = "enterprise")]
    {
        setting.data_retention
    }
    #[cfg(not(feature = "enterprise"))]
    {
        let _ = setting;
        DataRetentionDefaults::default()
    }
}

/// Applies `apply` to the settings in the store's `get_for_update`; true if it wrote them.
pub async fn update_org_setting<F>(org_id: &str, apply: F) -> Result<bool, anyhow::Error>
where
    F: FnOnce(&mut OrganizationSetting) -> bool + Send + 'static,
{
    let written = update_org_setting_in(infra::db::get_db().await.as_ref(), org_id, apply).await?;
    // The store write skips `db::put`, so the other regions only see what is queued here.
    #[cfg(feature = "enterprise")]
    if let Some(value) = &written {
        super_cluster::organization_setting_put(org_id, value.clone()).await?;
    }
    Ok(written.is_some())
}

/// The coordinator delete evicts `ORGANIZATION_SETTING` on every node.
pub async fn delete_org_setting(org_id: &str) -> errors::Result<()> {
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
    db::delete_if_exists(&key, false, db::NEED_WATCH).await?;
    ORGANIZATION_SETTING.write().await.remove(&key);
    Ok(())
}

/// Cache the existing org settings in the beginning
pub async fn org_settings_cache() -> Result<(), anyhow::Error> {
    let prefix = ORG_SETTINGS_KEY_PREFIX;
    let ret = db::list(prefix).await?;
    for (key, item_value) in ret {
        let json_val: OrganizationSetting = json::from_slice(&item_value).unwrap();
        ORGANIZATION_SETTING
            .clone()
            .write()
            .await
            .insert(key, json_val);
    }
    log::info!("Organization settings Cached");

    Ok(())
}

pub async fn org_settings_watch() -> Result<(), anyhow::Error> {
    let key = ORG_SETTINGS_KEY_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching organization settings");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_settings: event channel closed");
                return Ok(());
            }
        };

        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key;
                let json_val: OrganizationSetting = match db::get(&item_key).await {
                    Ok(val) => match json::from_slice(&val) {
                        Ok(val) => val,
                        Err(e) => {
                            log::error!("Error getting value: {e}");
                            continue;
                        }
                    },
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                };
                ORGANIZATION_SETTING
                    .clone()
                    .write()
                    .await
                    .insert(item_key, json_val);
            }
            db::Event::Delete(ev) => {
                ORGANIZATION_SETTING.write().await.remove(&ev.key);
            }
            db::Event::Empty => {}
        }
    }
}

/// Cache the existing orgs in the beginning
pub async fn cache() -> Result<(), anyhow::Error> {
    let orgs = list(None).await?;
    for org in orgs {
        ORGANIZATIONS
            .clone()
            .write()
            .await
            .insert(org.identifier.clone(), org);
    }
    log::info!("Organizations Cached");
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(ORG_KEY_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching organizations");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_orgs: event channel closed");
                return Ok(());
            }
        };

        apply_event(ev).await;
    }
}

pub async fn save_org(entry: &Organization) -> Result<(), anyhow::Error> {
    let org_name = entry.name.trim();
    if org_name.is_empty() {
        return Err(anyhow::anyhow!("Organization name cannot be empty"));
    }
    if let Err(e) = organizations::add(
        &entry.identifier,
        org_name,
        entry.org_type.as_str().parse().unwrap(),
    )
    .await
    {
        log::error!("Error saving org: {e}");
        return Err(anyhow::anyhow!("Error saving org: {}", e));
    }
    organizations::invalidate_cache(Some(&entry.identifier)).await;

    let key = format!("{}{}", ORG_KEY_PREFIX, entry.identifier);
    let _ = put_into_db_coordinator(&key, json::to_vec(entry).unwrap().into(), true, None).await;

    #[cfg(feature = "enterprise")]
    super_cluster::organization_add(&key, entry).await?;
    #[cfg(feature = "cloud")]
    o2_enterprise::enterprise::cloud::billings::sync_public_dashboard_links(&entry.identifier)
        .await;
    Ok(())
}

pub async fn rename_org(org_id: &str, new_name: &str) -> Result<Organization, anyhow::Error> {
    if new_name.trim().is_empty() {
        return Err(anyhow::anyhow!("Organization name cannot be empty"));
    }
    if let Err(e) = organizations::rename(org_id, new_name).await {
        log::error!("Error updating org: {e}");
        return Err(anyhow::anyhow!("Error updating org: {}", e));
    }
    organizations::invalidate_cache(Some(org_id)).await;
    let org = get_org(org_id).await?;
    let key = format!("{ORG_KEY_PREFIX}{org_id}");
    let _ = put_into_db_coordinator(&key, json::to_vec(&org).unwrap().into(), true, None).await;

    #[cfg(feature = "enterprise")]
    super_cluster::organization_rename(&key, &org).await?;
    Ok(org)
}

pub async fn get_org_from_db(org_id: &str) -> Result<Organization, anyhow::Error> {
    let org = organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting org: {}", e))?;
    Ok(Organization {
        identifier: org.identifier,
        name: org.org_name,
        org_type: org.org_type.to_string(),
        service_account: None,
    })
}

pub async fn get_org(org_id: &str) -> Result<Organization, anyhow::Error> {
    if let Some(org) = ORGANIZATIONS.read().await.get(org_id) {
        return Ok(org.clone());
    }
    let org = organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("Error getting org: {}", e))?;
    Ok(Organization {
        identifier: org.identifier,
        name: org.org_name,
        org_type: org.org_type.to_string(),
        service_account: None,
    })
}

pub async fn delete_org(org_id: &str) -> Result<(), anyhow::Error> {
    if let Err(e) = organizations::remove(org_id).await {
        log::error!("Error deleting org: {e}");
        return Err(anyhow::anyhow!("Error deleting org: {}", e));
    }
    organizations::invalidate_cache(Some(org_id)).await;
    ORGANIZATIONS.clone().write().await.remove(org_id);
    let key = format!("{ORG_KEY_PREFIX}{org_id}");
    delete_from_db_coordinator(&key, false, true, None).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::organization_delete(&key).await?;
    Ok(())
}

/// Turns a `deleting` org row into a `deleted` tombstone; true only for the call that flipped it.
pub async fn tombstone_org(org_id: &str) -> Result<bool, anyhow::Error> {
    let won = organizations::set_status_if(org_id, STATUS_DELETING, STATUS_DELETED)
        .await
        .map_err(|e| anyhow::anyhow!("Error tombstoning org: {e}"))?;
    if !won {
        // A retry after a later failure finds the tombstone already written.
        organizations::invalidate_cache(Some(org_id)).await;
        let status = organizations::get(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("Error tombstoning org: {e}"))?
            .status;
        if status != STATUS_DELETED {
            return Err(anyhow::anyhow!(
                "Cannot tombstone org {org_id} in status {status}"
            ));
        }
    }
    Ok(won)
}

/// Drops a tombstoned org from every node's org caches; safe to repeat on a step retry.
pub async fn evict_org(org_id: &str) -> Result<(), anyhow::Error> {
    organizations::invalidate_cache(Some(org_id)).await;
    ORGANIZATIONS.clone().write().await.remove(org_id);
    let key = format!("{ORG_KEY_PREFIX}{org_id}");
    delete_from_db_coordinator(&key, false, true, None).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::organization_delete(&key).await?;
    Ok(())
}

/// Lists live orgs; tombstones stay out so caches, jobs and the org list never see them.
pub async fn list(limit: Option<i64>) -> Result<Vec<Organization>, anyhow::Error> {
    Ok(list_with_created_at(limit)
        .await?
        .into_iter()
        .map(|(org, _)| org)
        .collect())
}

/// Same as [`list`], paired with each org's creation time in microseconds.
pub async fn list_with_created_at(
    limit: Option<i64>,
) -> Result<Vec<(Organization, i64)>, anyhow::Error> {
    let filter = organizations::ListFilter {
        exclude_deleted: true,
        ..organizations::ListFilter::with_limit(limit)
    };
    let orgs = organizations::list(filter)
        .await
        .map_err(|e| anyhow::anyhow!("Error listing orgs: {}", e))?;
    Ok(orgs
        .into_iter()
        .map(|org| {
            let created_at = org.created_at;
            (to_organization(org), created_at)
        })
        .collect())
}

/// Orgs whose row and this node's status cache are both clear of pending, deleting and deleted.
pub async fn list_unblocked() -> Result<Vec<Organization>, anyhow::Error> {
    let filter = organizations::ListFilter {
        exclude_deleted: true,
        ..organizations::ListFilter::default()
    };
    let orgs = organizations::list(filter)
        .await
        .map_err(|e| anyhow::anyhow!("Error listing orgs: {}", e))?;
    Ok(orgs
        .into_iter()
        .filter(|org| {
            ![STATUS_PENDING_DELETION, STATUS_DELETING, STATUS_DELETED]
                .contains(&org.status.as_str())
                && !crate::org_status::is_blocked(&org.identifier)
        })
        .map(to_organization)
        .collect())
}

#[cfg(feature = "enterprise")]
mod super_cluster {
    use common::meta::organization::Organization;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    pub async fn organization_add(
        key: &str,
        org: &Organization,
    ) -> Result<(), infra::errors::Error> {
        let value = config::utils::json::to_vec(org)?.into();
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_add(
                key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn organization_rename(
        key: &str,
        org: &Organization,
    ) -> Result<(), infra::errors::Error> {
        let value = config::utils::json::to_vec(org)?.into();
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_rename(
                key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn organization_delete(key: &str) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::organization_delete(
                key,
                infra::db::NEED_WATCH,
                None,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    pub async fn organization_setting_put(
        org_id: &str,
        value: bytes::Bytes,
    ) -> Result<(), anyhow::Error> {
        if get_o2_config().super_cluster.enabled {
            let key = format!("{}/{org_id}", super::ORG_SETTINGS_KEY_PREFIX);
            o2_enterprise::enterprise::super_cluster::queue::put(
                &key,
                value,
                infra::db::NEED_WATCH,
                None,
            )
            .await?;
        }
        Ok(())
    }
}

fn to_organization(org: organizations::OrganizationRecord) -> Organization {
    Organization {
        identifier: org.identifier,
        name: org.org_name,
        org_type: org.org_type.to_string(),
        service_account: None,
    }
}

/// Returns the stored bytes when it wrote, the full value the other regions must receive.
async fn update_org_setting_in<F>(
    store: &dyn infra::db::Db,
    org_id: &str,
    apply: F,
) -> Result<Option<bytes::Bytes>, anyhow::Error>
where
    F: FnOnce(&mut OrganizationSetting) -> bool + Send + 'static,
{
    let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
    let written = Arc::new(std::sync::Mutex::new(None));
    let (slot, insert_key) = (written.clone(), key.clone());
    // The store reads and writes the key under its own lock, so no other writer lands in between.
    store
        .get_for_update(
            &key,
            infra::db::NEED_WATCH,
            None,
            Box::new(move |stored| {
                let existed = stored.is_some();
                let mut settings = match stored {
                    Some(value) => json::from_slice(&value)?,
                    None => OrganizationSetting::default(),
                };
                if !apply(&mut settings) {
                    return Ok(None);
                }
                let value: bytes::Bytes = json::to_vec(&settings)?.into();
                *slot.lock().unwrap() = Some((settings, value.clone()));
                // NATS can only create a missing key through the insert slot.
                Ok(Some(if existed {
                    (Some(value), None)
                } else {
                    (None, Some((insert_key, value, None)))
                }))
            }),
        )
        .await?;
    let Some((settings, value)) = written.lock().unwrap().take() else {
        return Ok(None);
    };
    ORGANIZATION_SETTING.write().await.insert(key, settings);
    Ok(Some(value))
}

async fn apply_event(ev: db::Event) {
    match ev {
        db::Event::Put(ev) => {
            let Some(item_key) = ev.key.strip_prefix(ORG_KEY_PREFIX) else {
                return;
            };
            // Invalidate before reading, or the cache-first read copies the stale row back.
            organizations::invalidate_cache(Some(item_key)).await;
            let json_val: Organization = if !config::get_config().common.local_mode {
                match get_org_from_db(item_key).await {
                    Ok(val) => val,
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        return;
                    }
                }
            } else {
                match ev.value.as_deref().map(json::from_slice::<Organization>) {
                    Some(Ok(val)) => val,
                    Some(Err(e)) => {
                        log::error!("[ORGANIZATION] bad value for {item_key}: {e}");
                        return;
                    }
                    None => {
                        log::error!("[ORGANIZATION] put event for {item_key} has no value");
                        return;
                    }
                }
            };
            ORGANIZATIONS
                .clone()
                .write()
                .await
                .insert(item_key.to_string(), json_val);
        }
        db::Event::Delete(ev) => {
            let Some(item_key) = ev.key.strip_prefix(ORG_KEY_PREFIX) else {
                return;
            };
            organizations::invalidate_cache(Some(item_key)).await;
            ORGANIZATIONS.clone().write().await.remove(item_key);
        }
        db::Event::Empty => {}
    }
}

async fn data_stream_retention_days(
    org_id: &str,
    stream_type: StreamType,
    stream_days: i64,
) -> Result<i64, Error> {
    if stream_days > 0 {
        return Ok(stream_days.min(MAX_DATA_RETENTION_DAYS));
    }
    let org = org_retention_defaults(org_id).await?;
    Ok(default_retention_days(
        stream_type,
        &org,
        &global_retention_defaults(),
    ))
}

/// An index stream has no value of its own: it expires with the stream it was derived from.
async fn index_stream_retention_days(org_id: &str, index_stream: &str) -> Result<i64, Error> {
    let Some((source, source_type)) = index_stream_source(index_stream) else {
        log::warn!(
            "[RETENTION] index stream {org_id}/{index_stream} has no recognizable source, keeping it"
        );
        return Ok(0);
    };
    let source_days = stored_retention_days(org_id, source, source_type).await?;
    if source_type == StreamType::Metadata {
        return metadata_stream_retention_days(org_id, source, source_days).await;
    }
    data_stream_retention_days(org_id, source_type, source_days).await
}

/// A derived metadata stream has no default of its own: it expires with the stream it describes.
async fn metadata_stream_retention_days(
    org_id: &str,
    metadata_stream: &str,
    stream_days: i64,
) -> Result<i64, Error> {
    if stream_days > 0 {
        return data_stream_retention_days(org_id, StreamType::Metadata, stream_days).await;
    }
    let Some((source, source_type)) = metadata_stream_source(metadata_stream) else {
        return data_stream_retention_days(org_id, StreamType::Metadata, 0).await;
    };
    let source_days = stored_retention_days(org_id, source, source_type).await?;
    data_stream_retention_days(org_id, source_type, source_days).await
}

/// A stream with no stored schema has no value; a failed read is an error, never a default.
async fn stored_retention_days(
    org_id: &str,
    stream: &str,
    stream_type: StreamType,
) -> Result<i64, Error> {
    let key = format!("{org_id}/{stream_type}/{stream}");
    if let Some(settings) = infra::schema::get_stream_settings_atomic(&key) {
        return Ok(settings.data_retention);
    }
    let schema = infra::schema::get(org_id, stream, stream_type).await?;
    Ok(infra::schema::unwrap_stream_settings(&schema).map_or(0, |s| s.data_retention))
}

/// Index streams are named `<source stream>_<source type>`.
fn index_stream_source(index_stream: &str) -> Option<(&str, StreamType)> {
    RETENTION_STREAM_TYPES
        .into_iter()
        .chain([StreamType::Metadata])
        .find_map(|source_type| {
            let source = index_stream.strip_suffix(source_type.as_str())?;
            let source = source.strip_suffix('_')?;
            (!source.is_empty()).then_some((source, source_type))
        })
}

/// Metadata streams are named `distinct_values_<source type>_<source>` or
/// `trace_time_index_<source>`.
fn metadata_stream_source(metadata_stream: &str) -> Option<(&str, StreamType)> {
    if let Some(source) = metadata_stream.strip_prefix(TRACE_TIME_INDEX_STREAM_PREFIX) {
        return (!source.is_empty()).then_some((source, StreamType::Traces));
    }
    let typed_source = metadata_stream.strip_prefix(DISTINCT_STREAM_PREFIX)?;
    RETENTION_STREAM_TYPES.into_iter().find_map(|source_type| {
        let source = typed_source.strip_prefix(source_type.as_str())?;
        let source = source.strip_prefix('_')?;
        (!source.is_empty()).then_some((source, source_type))
    })
}

fn global_retention_defaults() -> DataRetentionDefaults {
    get_config().compact.data_retention
}

/// Scope wins first (org over global), then type over generic inside a scope.
fn default_retention_days(
    stream_type: StreamType,
    org: &DataRetentionDefaults,
    global: &DataRetentionDefaults,
) -> i64 {
    first_positive(&[
        org.for_type(stream_type),
        org.default,
        global.for_type(stream_type),
        global.default,
    ])
}

fn first_positive(levels: &[i64]) -> i64 {
    levels
        .iter()
        .find(|days| **days > 0)
        .map_or(0, |days| (*days).min(MAX_DATA_RETENTION_DAYS))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use bytes::Bytes;
    use hashbrown::HashMap;
    use infra::db::{Db, Event, Stats, UpdateFn};
    use tokio::sync::mpsc;

    use super::*;

    /// Shaped like nats.rs `get_for_update`: a missing key cannot take the value slot.
    #[derive(Default)]
    struct NatsShapedStore {
        stored: std::sync::Mutex<Option<Bytes>>,
        unreadable: bool,
        wrote: AtomicBool,
    }

    #[async_trait::async_trait]
    impl Db for NatsShapedStore {
        async fn create_table(&self) -> errors::Result<()> {
            Ok(())
        }

        async fn stats(&self) -> errors::Result<Stats> {
            unimplemented!()
        }

        async fn get(&self, key: &str) -> errors::Result<Bytes> {
            if self.unreadable {
                return Err(Error::Message("read failed".to_string()));
            }
            self.stored.lock().unwrap().clone().ok_or_else(|| {
                Error::DbError(infra::errors::DbError::KeyNotExists(key.to_string()))
            })
        }

        async fn put(
            &self,
            _key: &str,
            value: Bytes,
            _need_watch: bool,
            _start_dt: Option<i64>,
        ) -> errors::Result<()> {
            self.wrote.store(true, Ordering::SeqCst);
            *self.stored.lock().unwrap() = Some(value);
            Ok(())
        }

        async fn get_for_update(
            &self,
            key: &str,
            need_watch: bool,
            start_dt: Option<i64>,
            update_fn: Box<UpdateFn>,
        ) -> errors::Result<()> {
            let old = match self.get(key).await {
                Ok(value) => Some((key.to_string(), value)),
                Err(Error::DbError(infra::errors::DbError::KeyNotExists(_))) => None,
                Err(e) => return Err(e),
            };
            let old_key = old.as_ref().map(|(k, _)| k.clone());
            if let Some((value, insert)) = update_fn(old.map(|(_, v)| v))? {
                if let Some(value) = value {
                    self.put(&old_key.unwrap(), value, need_watch, start_dt)
                        .await?;
                }
                if let Some((key, value, start_dt)) = insert {
                    self.put(&key, value, need_watch, start_dt).await?;
                }
            }
            Ok(())
        }

        async fn delete(
            &self,
            _key: &str,
            _with_prefix: bool,
            _need_watch: bool,
            _start_dt: Option<i64>,
        ) -> errors::Result<()> {
            unimplemented!()
        }

        async fn list(&self, _prefix: &str) -> errors::Result<HashMap<String, Bytes>> {
            unimplemented!()
        }

        async fn list_keys(&self, _prefix: &str) -> errors::Result<Vec<String>> {
            unimplemented!()
        }

        async fn list_values(&self, _prefix: &str) -> errors::Result<Vec<Bytes>> {
            unimplemented!()
        }

        async fn list_values_by_start_dt(
            &self,
            _prefix: &str,
            _start_dt: Option<(i64, i64)>,
        ) -> errors::Result<Vec<(i64, Bytes)>> {
            unimplemented!()
        }

        async fn count(&self, _prefix: &str) -> errors::Result<i64> {
            unimplemented!()
        }

        async fn watch(&self, _prefix: &str) -> errors::Result<Arc<mpsc::Receiver<Event>>> {
            unimplemented!()
        }

        async fn close(&self) -> errors::Result<()> {
            Ok(())
        }

        async fn add_start_dt_column(&self) -> errors::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_org_settings_key_prefix_value() {
        assert_eq!(ORG_SETTINGS_KEY_PREFIX, "/organization/setting");
    }

    #[test]
    fn test_org_key_prefix_value() {
        assert_eq!(ORG_KEY_PREFIX, "/organization/org/");
    }

    #[tokio::test]
    async fn test_failed_settings_read_neither_completes_cleanup_nor_writes() {
        let org_id = "unreadablesettingsorg";
        let store = NatsShapedStore {
            unreadable: true,
            ..Default::default()
        };
        let applied = Arc::new(AtomicBool::new(false));
        let ran = applied.clone();
        // Shaped like delete_org_domain_mappings, whose mappings field exists only under cloud.
        let cleanup = update_org_setting_in(&store, org_id, move |settings| {
            ran.store(true, Ordering::SeqCst);
            let before = settings.cross_links.len();
            settings.cross_links.clear();
            settings.cross_links.len() != before
        })
        .await;
        assert!(cleanup.is_err(), "cleanup reported done: {cleanup:?}");
        assert!(
            !applied.load(Ordering::SeqCst),
            "cleanup ran on default settings"
        );

        let ran = applied.clone();
        let update = update_org_setting_in(&store, org_id, move |settings| {
            ran.store(true, Ordering::SeqCst);
            settings.scrape_interval += 1;
            true
        })
        .await;
        assert!(update.is_err(), "update reported done: {update:?}");
        assert!(
            !applied.load(Ordering::SeqCst),
            "update ran on default settings"
        );
        assert!(!store.wrote.load(Ordering::SeqCst));
        let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
        assert!(!ORGANIZATION_SETTING.read().await.contains_key(&key));
    }

    #[tokio::test]
    async fn test_settings_update_creates_then_rewrites_the_key() {
        let org_id = "firstsettingsorg";
        let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
        let store = NatsShapedStore::default();
        let created = update_org_setting_in(&store, org_id, |s| {
            s.scrape_interval = 7;
            true
        })
        .await
        .unwrap();
        assert_eq!(created, store.stored.lock().unwrap().clone());
        assert!(created.is_some());
        let updated = update_org_setting_in(&store, org_id, |s| {
            s.scrape_interval += 1;
            true
        })
        .await
        .unwrap();
        let stored_bytes = store.stored.lock().unwrap().clone();
        assert_eq!(updated, stored_bytes, "regions would get another value");
        let stored: OrganizationSetting = json::from_slice(&stored_bytes.unwrap()).unwrap();
        assert_eq!(stored.scrape_interval, 8);
        assert_eq!(
            ORGANIZATION_SETTING
                .read()
                .await
                .get(&key)
                .unwrap()
                .scrape_interval,
            8
        );

        store.wrote.store(false, Ordering::SeqCst);
        let unchanged = update_org_setting_in(&store, org_id, |_| false)
            .await
            .unwrap();
        assert!(unchanged.is_none(), "a no-op apply has nothing to sync");
        assert!(!store.wrote.load(Ordering::SeqCst), "a no-op apply wrote");
    }

    #[tokio::test]
    async fn test_concurrent_settings_writers_do_not_lose_updates() {
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        infra::db_init().await.expect("meta store");
        let org_id = format!("lostupdorg{}", config::utils::time::now_micros());
        let writers: Vec<_> = (0..16)
            .map(|i| {
                let org_id = org_id.clone();
                tokio::spawn(async move {
                    update_org_setting(&org_id, move |s| {
                        s.cross_links.push(config::meta::stream::CrossLink {
                            name: format!("link{i}"),
                            url: "https://example.com".to_string(),
                            fields: vec![],
                        });
                        true
                    })
                    .await
                    .unwrap()
                })
            })
            .collect();
        for writer in writers {
            assert!(writer.await.unwrap());
        }
        let key = format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}");
        let stored: OrganizationSetting =
            json::from_slice(&infra::db::get_db().await.get(&key).await.unwrap()).unwrap();
        assert_eq!(stored.cross_links.len(), 16, "concurrent writes were lost");
        delete_org_setting(&org_id).await.unwrap();
    }

    #[tokio::test]
    async fn test_org_watch_delete_evicts_organizations_cache() {
        let org_id = "watchdelorg";
        ORGANIZATIONS.clone().write().await.insert(
            org_id.to_string(),
            Organization {
                identifier: org_id.to_string(),
                name: org_id.to_string(),
                org_type: "default".to_string(),
                service_account: None,
            },
        );
        apply_event(db::Event::Delete(infra::db::EventData {
            key: format!("{ORG_KEY_PREFIX}{org_id}"),
            value: None,
            start_dt: None,
        }))
        .await;
        assert!(!ORGANIZATIONS.read().await.contains_key(org_id));
    }

    #[tokio::test]
    async fn test_org_watch_put_without_a_readable_value_is_skipped() {
        if !config::get_config().common.local_mode {
            return;
        }
        let org_id = "watchbadputorg";
        for value in [None, Some(Bytes::from_static(b"not json"))] {
            apply_event(db::Event::Put(infra::db::EventData {
                key: format!("{ORG_KEY_PREFIX}{org_id}"),
                value,
                start_dt: None,
            }))
            .await;
        }
        assert!(!ORGANIZATIONS.read().await.contains_key(org_id));
    }

    #[test]
    fn test_org_key_format() {
        let org_id = "myorg";
        let key = format!("{ORG_KEY_PREFIX}{org_id}");
        assert_eq!(key, "/organization/org/myorg");
    }

    #[tokio::test]
    async fn test_backfills_list_only_orgs_neither_their_row_nor_the_cache_blocks() {
        use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        let base = format!("t_unblocked_{}", config::utils::time::now_micros());
        let orgs = [
            ("active", "active"),
            ("pending", "pending_deletion"),
            ("deleting", "deleting"),
            ("deleted", "deleted"),
            ("cached", "active"),
        ]
        .map(|(suffix, status)| (format!("{base}_{suffix}"), status));
        for (org, status) in &orgs {
            organizations::add(
                org,
                org,
                config::meta::organization::OrganizationType::Custom,
            )
            .await
            .unwrap();
            organizations::set_status(org, status).await.unwrap();
        }
        // Another node's broadcast reached this node before its row read caught up.
        ORG_STATUS_CACHE.insert(orgs[4].0.clone(), OrgStatus::PendingDeletion);

        let listed: Vec<String> = list_unblocked()
            .await
            .unwrap()
            .into_iter()
            .map(|org| org.identifier)
            .filter(|id| id.starts_with(&base))
            .collect();
        ORG_STATUS_CACHE.remove(&orgs[4].0);
        for (org, _) in &orgs {
            organizations::remove(org).await.unwrap();
        }

        assert_eq!(listed, [orgs[0].0.clone()]);
    }

    fn levels(default: i64, logs: i64, metrics: i64, traces: i64) -> DataRetentionDefaults {
        DataRetentionDefaults {
            default,
            logs,
            metrics,
            traces,
            ..Default::default()
        }
    }

    #[test]
    fn retention_defaults_resolve_scope_first_then_type() {
        let none = levels(0, 0, 0, 0);
        let global = levels(100, 10, 20, 30);
        let org_generic = levels(40, 0, 0, 0);
        let org_typed = levels(40, 4, 5, 6);
        let global_generic = levels(100, 0, 0, 0);
        let org_metrics = levels(0, 0, 7, 0);
        let global_profiles = DataRetentionDefaults {
            profiles: 15,
            ..global
        };
        let org_profiles = DataRetentionDefaults {
            profiles: 8,
            ..none
        };

        // (stream type, org, global, expected)
        let cases = [
            (StreamType::Logs, none, none, 0),
            (StreamType::Metrics, none, none, 0),
            (StreamType::Traces, none, none, 0),
            (StreamType::Profiles, none, none, 0),
            // global default only
            (StreamType::Logs, none, global_generic, 100),
            (StreamType::Metrics, none, global_generic, 100),
            (StreamType::Traces, none, global_generic, 100),
            (StreamType::Profiles, none, global_generic, 100),
            (StreamType::ServiceGraph, none, global_generic, 100),
            // a global per-type value beats the global default
            (StreamType::Logs, none, global, 10),
            (StreamType::Metrics, none, global, 20),
            (StreamType::Traces, none, global, 30),
            (StreamType::Profiles, none, global, 100),
            (StreamType::Profiles, none, global_profiles, 15),
            // the org default beats a global per-type value
            (StreamType::Metrics, org_generic, global, 40),
            (StreamType::Profiles, org_generic, global_profiles, 40),
            // the org value for the type beats the org default
            (StreamType::Logs, org_typed, global, 4),
            (StreamType::Metrics, org_typed, global, 5),
            (StreamType::Traces, org_typed, global, 6),
            (StreamType::Profiles, org_typed, global, 40),
            (StreamType::Profiles, org_profiles, global_profiles, 8),
            // only one type set in the org: the others fall through to the global layer
            (StreamType::Metrics, org_metrics, global, 7),
            (StreamType::Logs, org_metrics, global, 10),
            // global default off, a per-type value still applies
            (StreamType::Metrics, none, levels(0, 0, 20, 0), 20),
            (StreamType::Logs, none, levels(0, 0, 20, 0), 0),
            // org default with the global default off
            (StreamType::Logs, org_generic, none, 40),
        ];
        for (stream_type, org, global, expected) in cases {
            assert_eq!(
                default_retention_days(stream_type, &org, &global),
                expected,
                "{stream_type} org={org:?} global={global:?}"
            );
        }
    }

    #[test]
    fn retention_defaults_clamp_huge_levels() {
        let none = levels(0, 0, 0, 0);
        assert_eq!(
            default_retention_days(StreamType::Logs, &levels(i64::MAX, 0, 0, 0), &none),
            MAX_DATA_RETENTION_DAYS
        );
    }

    #[test]
    fn index_stream_source_comes_from_its_name() {
        assert_eq!(
            index_stream_source("app_logs"),
            Some(("app", StreamType::Logs))
        );
        assert_eq!(
            index_stream_source("app_logs_metrics"),
            Some(("app_logs", StreamType::Metrics))
        );
        assert_eq!(
            index_stream_source("a_b_metadata"),
            Some(("a_b", StreamType::Metadata))
        );
        assert_eq!(index_stream_source("app"), None);
        assert_eq!(index_stream_source("logs"), None);
        assert_eq!(index_stream_source("_logs"), None);
        assert_eq!(index_stream_source("app_file_list"), None);
    }

    #[test]
    fn metadata_stream_source_comes_from_its_name() {
        assert_eq!(
            metadata_stream_source(&config::utils::util::get_trace_time_index_stream_name(
                "a_b"
            )),
            Some(("a_b", StreamType::Traces))
        );
        for stream_type in RETENTION_STREAM_TYPES {
            assert_eq!(
                metadata_stream_source(&config::utils::util::get_distinct_stream_name(
                    stream_type,
                    "a_logs"
                )),
                Some(("a_logs", stream_type))
            );
        }
        assert_eq!(metadata_stream_source("trace_time_index_"), None);
        assert_eq!(metadata_stream_source("distinct_values_logs_"), None);
        assert_eq!(metadata_stream_source("distinct_values_unknown_a"), None);
        assert_eq!(metadata_stream_source("app"), None);
    }

    #[test]
    fn resolved_defaults_answer_each_stream_type() {
        // these org values leave no level to the global layer, whatever the environment sets
        let org = DataRetentionDefaults {
            profiles: 8,
            ..levels(40, 0, 7, 0)
        };
        assert_eq!(
            resolved_retention_defaults(&org),
            DataRetentionDefaults {
                default: 40,
                logs: 40,
                metrics: 7,
                traces: 40,
                profiles: 8,
            }
        );

        let global = get_config().compact.data_retention;
        let resolved = resolved_retention_defaults(&levels(0, 0, 0, 0));
        assert_eq!(resolved.default, first_positive(&[global.default]));
        assert_eq!(
            resolved.metrics,
            first_positive(&[global.metrics, global.default])
        );
    }

    #[test]
    fn the_global_levels_ignore_the_org() {
        let global = get_config().compact.data_retention;
        assert_eq!(
            global_retention_days(StreamType::Traces),
            first_positive(&[global.traces, global.default])
        );
    }

    #[tokio::test]
    async fn the_stream_value_wins_without_reading_org_settings() {
        // no org settings or store exist for this org, so a lookup would fail
        assert_eq!(
            stream_retention_days("no-such-org", StreamType::Metrics, "s", 5)
                .await
                .unwrap(),
            5
        );
    }

    #[tokio::test]
    async fn a_metadata_stream_follows_the_stream_it_was_derived_from() {
        let org = "metadata_follows_source";
        let days = |data_retention| {
            std::sync::Arc::new(config::meta::stream::StreamSettings {
                data_retention,
                ..Default::default()
            })
        };
        let resolve = |stream_type, stream| stream_retention_days(org, stream_type, stream, 0);
        infra::schema::put_stream_settings(format!("{org}/traces/own"), days(77)).await;
        infra::schema::put_stream_settings(format!("{org}/metadata/trace_time_index_own"), days(0))
            .await;

        for stream in ["trace_time_index_own", "distinct_values_traces_own"] {
            assert_eq!(resolve(StreamType::Metadata, stream).await.unwrap(), 77);
        }
        assert_eq!(
            resolve(StreamType::Index, "trace_time_index_own_metadata")
                .await
                .unwrap(),
            77
        );
        // a value synced from the source wins without reading the source
        assert_eq!(
            stream_retention_days(org, StreamType::Metadata, "trace_time_index_own", 5)
                .await
                .unwrap(),
            5
        );
    }

    #[tokio::test]
    async fn an_unreadable_source_fails_instead_of_falling_back_to_a_default() {
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return;
        }
        infra::db_init().await.expect("meta store");
        infra::table::migrate().await.expect("migrations");
        let org = "unreadable_source_org";
        let key = infra::schema::mk_key(org, StreamType::Traces, "app");
        infra::db::get_db()
            .await
            .put(&key, "not json".into(), infra::db::NO_NEED_WATCH, None)
            .await
            .unwrap();

        for (stream_type, stream) in [
            (StreamType::Metadata, "trace_time_index_app"),
            (StreamType::Metadata, "distinct_values_traces_app"),
            (StreamType::Index, "app_traces"),
        ] {
            assert!(
                stream_retention_days(org, stream_type, stream, 0)
                    .await
                    .is_err(),
                "{stream}"
            );
        }
        // a source that was never written has nothing to read, so it is no failure
        assert!(
            stream_retention_days(org, StreamType::Metadata, "trace_time_index_absent", 0)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn an_index_stream_with_no_known_source_is_kept() {
        assert_eq!(
            stream_retention_days("no-such-org", StreamType::Index, "app", 5)
                .await
                .unwrap(),
            0
        );
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn only_the_global_levels_apply_outside_enterprise() {
        let global = get_config().compact.data_retention;
        assert_eq!(
            stream_retention_days("no-such-org", StreamType::Metrics, "s", 0)
                .await
                .unwrap(),
            first_positive(&[global.metrics, global.default])
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn org_settings_apply_in_enterprise() {
        let org_id = "retention_defaults_test_org";
        let setting = OrganizationSetting {
            data_retention: levels(40, 0, 7, 0),
            ..Default::default()
        };
        ORGANIZATION_SETTING
            .write()
            .await
            .insert(format!("{ORG_SETTINGS_KEY_PREFIX}/{org_id}"), setting);
        let days = |t, d| stream_retention_days(org_id, t, "s", d);
        assert_eq!(days(StreamType::Metrics, 0).await.unwrap(), 7);
        assert_eq!(days(StreamType::Logs, 0).await.unwrap(), 40);
        assert_eq!(days(StreamType::Metrics, 90).await.unwrap(), 90);
        // an index stream of a metrics source follows that type's value
        assert_eq!(
            stream_retention_days(org_id, StreamType::Index, "s_metrics", 0)
                .await
                .unwrap(),
            7
        );
    }
}
