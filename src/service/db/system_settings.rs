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

//! System Settings Service Layer
//!
//! Provides cached access to system settings with multi-level resolution.
//! Cache is populated on startup and updated on write operations.
//! Watch mechanism ensures cache is synchronized across cluster nodes.

use std::sync::Arc;

use config::meta::system_settings::{SettingScope, SystemSetting};
use infra::{errors::Result, table::system_settings as db};

use crate::common::infra::config::SYSTEM_SETTINGS;

/// Watcher prefix for system settings events
const SYSTEM_SETTINGS_WATCHER_PREFIX: &str = "/system_settings/";

/// Generate a cache key for a system setting
fn cache_key(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> String {
    let org = org_id.unwrap_or("_");
    let user = user_id.unwrap_or("_");
    format!("{}:{}:{}:{}", scope.as_str(), org, user, key)
}

/// Get a single setting from cache or database
pub async fn get(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<Option<SystemSetting>> {
    let cache_k = cache_key(scope, org_id, user_id, key);

    // Check cache first
    if let Some(setting) = SYSTEM_SETTINGS.read().await.get(&cache_k) {
        return Ok(Some(setting.clone()));
    }

    // Get from database
    let setting = db::get(scope, org_id, user_id, key)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Cache the result if found
    if let Some(ref s) = setting {
        SYSTEM_SETTINGS.write().await.insert(cache_k, s.clone());
    }

    Ok(setting)
}

/// Get a resolved setting by checking all levels (user -> org -> system)
/// Returns the most specific setting found
pub async fn get_resolved(
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<Option<SystemSetting>> {
    // Check user level first if user_id provided
    if let (Some(org), Some(user)) = (org_id, user_id)
        && let Some(setting) = get(&SettingScope::User, Some(org), Some(user), key).await?
    {
        return Ok(Some(setting));
    }

    // Check org level if org_id provided
    if let Some(org) = org_id
        && let Some(setting) = get(&SettingScope::Org, Some(org), None, key).await?
    {
        return Ok(Some(setting));
    }

    // Check system level
    get(&SettingScope::System, None, None, key).await
}

/// List all settings for a given scope
pub async fn list(
    scope: Option<&SettingScope>,
    org_id: Option<&str>,
    user_id: Option<&str>,
    category: Option<&str>,
) -> Result<Vec<SystemSetting>> {
    db::list(scope, org_id, user_id, category)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))
}

/// List all resolved settings for org/user (merging all levels)
pub async fn list_resolved(
    org_id: Option<&str>,
    user_id: Option<&str>,
    category: Option<&str>,
) -> Result<std::collections::HashMap<String, SystemSetting>> {
    db::list_resolved(org_id, user_id, category)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))
}

/// Create or update a setting (upsert)
pub async fn set(setting: &SystemSetting) -> Result<SystemSetting> {
    let result = db::set(setting)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Update local cache
    let cache_k = cache_key(
        &result.scope,
        result.org_id.as_deref(),
        result.user_id.as_deref(),
        &result.setting_key,
    );
    SYSTEM_SETTINGS
        .write()
        .await
        .insert(cache_k.clone(), result.clone());

    // Emit event to update cache on other cluster nodes
    let event_key = format!("{}{}", SYSTEM_SETTINGS_WATCHER_PREFIX, cache_k);
    if let Err(e) = infra::coordinator::system_settings::emit_put_event(&event_key).await {
        log::error!("Failed to emit system settings put event: {}", e);
    }

    Ok(result)
}

/// Delete a setting
pub async fn delete(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) -> Result<bool> {
    let result = db::delete(scope, org_id, user_id, key)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Remove from local cache
    let cache_k = cache_key(scope, org_id, user_id, key);
    SYSTEM_SETTINGS.write().await.remove(&cache_k);

    // Emit event to update cache on other cluster nodes
    let event_key = format!("{}{}", SYSTEM_SETTINGS_WATCHER_PREFIX, cache_k);
    if let Err(e) = infra::coordinator::system_settings::emit_delete_event(&event_key).await {
        log::error!("Failed to emit system settings delete event: {}", e);
    }

    Ok(result)
}

/// Delete all settings for an organization
pub async fn delete_org_settings(org_id: &str) -> Result<u64> {
    let result = db::delete_org_settings(org_id)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Clear org settings from cache, then emit events after releasing lock
    let keys_to_remove: Vec<String> = {
        let mut cache = SYSTEM_SETTINGS.write().await;
        let keys: Vec<String> = cache
            .iter()
            .filter(|(k, _)| k.split(':').nth(1) == Some(org_id))
            .map(|(k, _)| k.clone())
            .collect();
        for key in &keys {
            cache.remove(key);
        }
        keys
    }; // Lock released here

    // Emit events without holding lock
    for key in &keys_to_remove {
        let event_key = format!("{}{}", SYSTEM_SETTINGS_WATCHER_PREFIX, key);
        if let Err(e) = infra::coordinator::system_settings::emit_delete_event(&event_key).await {
            log::error!(
                "Failed to emit system settings delete event for {}: {}",
                key,
                e
            );
        }
    }

    Ok(result)
}

/// Delete all settings for a user in an organization
pub async fn delete_user_settings(org_id: &str, user_id: &str) -> Result<u64> {
    let result = db::delete_user_settings(org_id, user_id)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Clear user settings from cache, then emit events after releasing lock
    let keys_to_remove: Vec<String> = {
        let mut cache = SYSTEM_SETTINGS.write().await;
        let keys: Vec<String> = cache
            .iter()
            .filter(|(k, _)| {
                let parts: Vec<&str> = k.split(':').collect();
                parts.len() >= 3 && parts[1] == org_id && parts[2] == user_id
            })
            .map(|(k, _)| k.clone())
            .collect();
        for key in &keys {
            cache.remove(key);
        }
        keys
    }; // Lock released here

    // Emit events without holding lock
    for key in &keys_to_remove {
        let event_key = format!("{}{}", SYSTEM_SETTINGS_WATCHER_PREFIX, key);
        if let Err(e) = infra::coordinator::system_settings::emit_delete_event(&event_key).await {
            log::error!(
                "Failed to emit system settings delete event for {}: {}",
                key,
                e
            );
        }
    }

    Ok(result)
}

/// Initialize cache with all system settings from database
pub async fn cache() -> Result<()> {
    let settings = db::list(None, None, None, None)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    let mut cache = SYSTEM_SETTINGS.write().await;
    for setting in settings {
        let cache_k = cache_key(
            &setting.scope,
            setting.org_id.as_deref(),
            setting.user_id.as_deref(),
            &setting.setting_key,
        );
        cache.insert(cache_k, setting);
    }
    log::info!("System settings cached");
    Ok(())
}

/// Watch for system settings changes from other cluster nodes
pub async fn watch() -> Result<()> {
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator
        .watch(SYSTEM_SETTINGS_WATCHER_PREFIX)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching system settings");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_system_settings: event channel closed");
                break;
            }
        };
        match ev {
            super::Event::Put(ev) => {
                let cache_k = match ev.key.strip_prefix(SYSTEM_SETTINGS_WATCHER_PREFIX) {
                    Some(k) => k,
                    None => {
                        log::error!("Invalid system settings event key: {}", ev.key);
                        continue;
                    }
                };
                // Parse cache key: scope:org:user:key
                let parts: Vec<&str> = cache_k.split(':').collect();
                if parts.len() != 4 {
                    log::error!("Invalid cache key format: {}", cache_k);
                    continue;
                }
                let scope = match parts[0].parse::<SettingScope>() {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("Invalid scope in cache key: {} - {}", parts[0], e);
                        continue;
                    }
                };
                let org_id = if parts[1] == "_" {
                    None
                } else {
                    Some(parts[1])
                };
                let user_id = if parts[2] == "_" {
                    None
                } else {
                    Some(parts[2])
                };
                let key = parts[3];

                // Fetch from database and update cache
                match db::get(&scope, org_id, user_id, key).await {
                    Ok(Some(setting)) => {
                        SYSTEM_SETTINGS
                            .write()
                            .await
                            .insert(cache_k.to_string(), setting);
                        log::debug!("Updated system setting in cache: {}", cache_k);
                    }
                    Ok(None) => {
                        log::warn!("System setting not found in db: {}", cache_k);
                    }
                    Err(e) => {
                        log::error!("Error fetching system setting from db: {}", e);
                    }
                }
            }
            super::Event::Delete(ev) => {
                let cache_k = match ev.key.strip_prefix(SYSTEM_SETTINGS_WATCHER_PREFIX) {
                    Some(k) => k,
                    None => {
                        log::error!("Invalid system settings delete event key: {}", ev.key);
                        continue;
                    }
                };
                SYSTEM_SETTINGS.write().await.remove(cache_k);
                log::debug!("Removed system setting from cache: {}", cache_k);
            }
            super::Event::Empty => {}
        }
    }
    Ok(())
}

/// Invalidate cache for a specific setting
pub async fn invalidate_cache(
    scope: &SettingScope,
    org_id: Option<&str>,
    user_id: Option<&str>,
    key: &str,
) {
    let cache_k = cache_key(scope, org_id, user_id, key);
    SYSTEM_SETTINGS.write().await.remove(&cache_k);
}

/// Invalidate entire cache
pub async fn invalidate_all_cache() {
    SYSTEM_SETTINGS.write().await.clear();
}

/// Get FQN priority dimensions for an organization
///
/// Resolution order:
/// 1. Check settings v2 for org-level setting
/// 2. Fall back to system defaults from O2_FQN_PRIORITY_DIMENSIONS env var
///
/// Returns empty vec for OSS builds if env var is not set.
pub async fn get_fqn_priority_dimensions(org_id: &str) -> Vec<String> {
    use config::meta::system_settings::keys::FQN_PRIORITY_DIMENSIONS;

    // Try to get from settings v2 (org level)
    if let Ok(Some(setting)) = get_resolved(Some(org_id), None, FQN_PRIORITY_DIMENSIONS).await
        && let Ok(dims) = serde_json::from_value::<Vec<String>>(setting.setting_value)
        && !dims.is_empty()
    {
        return dims;
    }

    // Fall back to system defaults
    get_default_fqn_priority_dimensions()
}

/// Get the default FQN priority dimensions from config
///
/// For enterprise builds, uses O2_FQN_PRIORITY_DIMENSIONS env var.
/// For OSS builds, returns empty vec.
pub fn get_default_fqn_priority_dimensions() -> Vec<String> {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
        get_o2_config()
            .service_streams
            .get_fqn_priority_dimensions()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        vec![]
    }
}

/// Get semantic field groups for an organization
///
/// Resolution order:
/// 1. Check settings v2 for org-level setting
/// 2. Fall back to enterprise defaults from JSON file
///
/// Returns empty vec for OSS builds.
pub async fn get_semantic_field_groups(
    org_id: &str,
) -> Vec<config::meta::correlation::SemanticFieldGroup> {
    use config::meta::{
        correlation::SemanticFieldGroup, system_settings::keys::SEMANTIC_FIELD_GROUPS,
    };

    // Try to get from settings v2 (org level)
    if let Ok(Some(setting)) = get_resolved(Some(org_id), None, SEMANTIC_FIELD_GROUPS).await
        && let Ok(groups) = serde_json::from_value::<Vec<SemanticFieldGroup>>(setting.setting_value)
        && !groups.is_empty()
    {
        return groups;
    }

    // Fall back to enterprise defaults
    get_default_semantic_field_groups()
}

/// Get the default semantic field groups from enterprise config
///
/// For enterprise builds, loads from enterprise JSON file.
/// For OSS builds, returns empty vec.
pub fn get_default_semantic_field_groups() -> Vec<config::meta::correlation::SemanticFieldGroup> {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_key() {
        // System scope
        assert_eq!(
            cache_key(&SettingScope::System, None, None, "test_key"),
            "system:_:_:test_key"
        );

        // Org scope
        assert_eq!(
            cache_key(&SettingScope::Org, Some("default"), None, "test_key"),
            "org:default:_:test_key"
        );

        // User scope
        assert_eq!(
            cache_key(
                &SettingScope::User,
                Some("default"),
                Some("user@example.com"),
                "test_key"
            ),
            "user:default:user@example.com:test_key"
        );
    }
}
