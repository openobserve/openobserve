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

use config::meta::system_settings::{SettingScope, SystemSetting};
use infra::{errors::Result, table::system_settings as db};

use crate::common::infra::config::SYSTEM_SETTINGS;

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

    // Update cache
    let cache_k = cache_key(
        &result.scope,
        result.org_id.as_deref(),
        result.user_id.as_deref(),
        &result.setting_key,
    );
    SYSTEM_SETTINGS
        .write()
        .await
        .insert(cache_k, result.clone());

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

    // Remove from cache
    let cache_k = cache_key(scope, org_id, user_id, key);
    SYSTEM_SETTINGS.write().await.remove(&cache_k);

    Ok(result)
}

/// Delete all settings for an organization
pub async fn delete_org_settings(org_id: &str) -> Result<u64> {
    let result = db::delete_org_settings(org_id)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Clear org settings from cache
    let mut cache = SYSTEM_SETTINGS.write().await;
    let keys_to_remove: Vec<String> = cache
        .iter()
        .filter(|(k, _)| k.split(':').nth(1) == Some(org_id))
        .map(|(k, _)| k.clone())
        .collect();
    for key in keys_to_remove {
        cache.remove(&key);
    }

    Ok(result)
}

/// Delete all settings for a user in an organization
pub async fn delete_user_settings(org_id: &str, user_id: &str) -> Result<u64> {
    let result = db::delete_user_settings(org_id, user_id)
        .await
        .map_err(|e| infra::errors::Error::Message(e.to_string()))?;

    // Clear user settings from cache
    let mut cache = SYSTEM_SETTINGS.write().await;
    let keys_to_remove: Vec<String> = cache
        .iter()
        .filter(|(k, _)| {
            let parts: Vec<&str> = k.split(':').collect();
            parts.len() >= 3 && parts[1] == org_id && parts[2] == user_id
        })
        .map(|(k, _)| k.clone())
        .collect();
    for key in keys_to_remove {
        cache.remove(&key);
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
