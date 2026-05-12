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

    // For UI display config keys: serve embedded defaults directly, bypassing the system-level
    // DB/cache lookup. This avoids stale empty rows written by older builds, and means no
    // DB seeding is ever needed. Org-level overrides (checked above) still take precedence.
    #[cfg(feature = "enterprise")]
    {
        use config::meta::system_settings::SystemSetting;
        use o2_enterprise::enterprise::common::{
            config::{O2_FIELD_GROUPING_SETTING_KEY, O2_KEY_FIELDS_SETTING_KEY},
            semantic_config::{load_field_grouping, load_key_fields},
        };

        let value = if key == O2_KEY_FIELDS_SETTING_KEY {
            Some(serde_json::to_value(load_key_fields())?)
        } else if key == O2_FIELD_GROUPING_SETTING_KEY {
            Some(serde_json::to_value(load_field_grouping())?)
        } else {
            None
        };

        if let Some(v) = value {
            return Ok(Some(SystemSetting::new_system(key, v)));
        }
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

/// Get semantic field groups for an organization
///
/// Resolution order:
/// 1. Check settings v2 for org-level setting
/// 2. Fall back to enterprise defaults from JSON file
///
/// Returns empty vec for OSS builds.
pub async fn get_semantic_field_groups(org_id: &str) -> Vec<config::meta::correlation::FieldAlias> {
    use config::meta::{correlation::FieldAlias, system_settings::keys::SEMANTIC_FIELD_GROUPS};

    // Try to get from settings v2 (org level)
    if let Ok(Some(setting)) = get_resolved(Some(org_id), None, SEMANTIC_FIELD_GROUPS).await
        && let Ok(groups) = serde_json::from_value::<Vec<FieldAlias>>(setting.setting_value)
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
pub fn get_default_semantic_field_groups() -> Vec<config::meta::correlation::FieldAlias> {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::semantic_config::load_defaults_from_file()
    }
    #[cfg(not(feature = "enterprise"))]
    {
        vec![]
    }
}

/// Normalize a semantic group category name to a consistent identity set ID
///
/// Converts category names to lowercase, dash-separated format while maintaining
/// consistency to prevent duplicate groups in the UI.
///
/// Examples:
/// - "Kubernetes" -> "kubernetes"
/// - "AWS EC2" -> "aws-ec2"
/// - "Common" -> "common"
fn normalize_category_to_id(category: &str) -> String {
    category.to_lowercase().replace(' ', "-")
}

/// Normalize a semantic group category name to a consistent label format
///
/// Uses title case to ensure consistent display in the UI.
/// This ensures that auto-generated identity sets have consistent casing
/// with manually defined semantic groups.
///
/// Examples:
/// - "kubernetes" -> "Kubernetes"
/// - "aws ec2" -> "Aws Ec2"
/// - "COMMON" -> "Common"
fn normalize_category_to_label(category: &str) -> String {
    // Convert to title case: first letter of each word capitalized, rest lowercase
    // Special case for common acronyms to match frontend expectations
    category
        .split_whitespace()
        .map(|word| {
            let upper_word = word.to_uppercase();
            match upper_word.as_str() {
                "AWS" | "GCP" => upper_word,
                _ => {
                    let mut chars = word.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => {
                            first.to_uppercase().collect::<String>()
                                + &chars.collect::<String>().to_lowercase()
                        }
                    }
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Load the service identity config for an org, applying env-default tracked_alias_ids
/// when the stored config has an empty list (pre-migration records or first run).
/// Also applies auto-config when sets is empty but tracked_alias_ids is not empty.
pub async fn get_service_identity_config(
    org_id: &str,
) -> config::meta::correlation::ServiceIdentityConfig {
    use config::meta::{
        correlation::{IdentitySet, ServiceIdentityConfig},
        system_settings::SettingScope,
    };

    // Intentionally kept here since there's no way to satisfy non-enterprise path
    // TODO: move the entire module to enterprise so that there's no access restrictions
    #[cfg_attr(not(feature = "enterprise"), allow(unused_mut))]
    let mut config = match db::get(&SettingScope::Org, Some(org_id), None, "service_identity").await
    {
        Ok(Some(s)) => serde_json::from_value::<ServiceIdentityConfig>(s.setting_value)
            .unwrap_or_else(|_| ServiceIdentityConfig::new_default()),
        _ => ServiceIdentityConfig::new_default(),
    };

    // If tracked_alias_ids is empty (old stored config or default), populate from env default
    #[cfg(feature = "enterprise")]
    if config.tracked_alias_ids.is_empty() {
        config.tracked_alias_ids = o2_enterprise::enterprise::common::config::get_config()
            .service_streams
            .tracked_alias_ids
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }

    // Auto-config: if sets is empty but tracked_alias_ids is not empty, create category-based sets.
    // Only aliases with is_workload_type=true are used as distinguish_by fields — this prevents
    // HTTP, Database, System, Observability, and Network aliases from being treated as workload
    // identity discriminators.
    if config.sets.is_empty() && !config.tracked_alias_ids.is_empty() {
        // Group tracked alias IDs by their semantic categories.
        // If the DB-stored groups predate the is_workload_type field (all false/missing), patch
        // them from the defaults file by ID so user-customised fields are preserved.
        let mut semantic_groups = get_semantic_field_groups(org_id).await;
        let has_workload_types = semantic_groups.iter().any(|g| g.is_workload_type);
        if !has_workload_types {
            log::debug!(
                "[ServiceIdentityConfig] DB semantic groups for org {} have no is_workload_type=true entries (stale), patching from defaults",
                org_id
            );
            let default_groups = get_default_semantic_field_groups();
            let default_workload: std::collections::HashMap<&str, bool> = default_groups
                .iter()
                .map(|g| (g.id.as_str(), g.is_workload_type))
                .collect();
            for group in &mut semantic_groups {
                if let Some(&is_workload) = default_workload.get(group.id.as_str()) {
                    group.is_workload_type = is_workload;
                }
            }
        }
        let mut category_groups = std::collections::HashMap::new();

        // Only include aliases that are explicitly marked as workload-type dimensions.
        // The group field on those aliases is used as the identity set id/label.
        for alias_id in &config.tracked_alias_ids {
            if let Some(group) = semantic_groups
                .iter()
                .find(|g| g.id == *alias_id && g.is_workload_type)
            {
                let category = group.group.as_deref().unwrap_or("Common").to_string();
                category_groups
                    .entry(category)
                    .or_insert_with(Vec::new)
                    .push(alias_id.clone());
            }
        }

        // Create identity sets for each category that has tracked aliases
        // Sort categories to ensure deterministic order
        let mut categories: Vec<_> = category_groups.keys().cloned().collect();
        categories.sort();

        for category in categories {
            let alias_ids = category_groups.remove(&category).unwrap();
            if !alias_ids.is_empty() {
                let set_id = normalize_category_to_id(&category);
                let normalized_label = normalize_category_to_label(&category);
                let identity_set = IdentitySet {
                    id: set_id,
                    label: normalized_label,
                    distinguish_by: alias_ids,
                };
                config.sets.push(identity_set);
            }
        }

        log::debug!(
            "[ServiceIdentityConfig] Auto-configured {} identity sets for org {}: categories {:?}",
            config.sets.len(),
            org_id,
            config.sets.iter().map(|s| &s.label).collect::<Vec<_>>()
        );
    }

    config
}

/// Get the updated_at timestamp for semantic_field_groups setting
///
/// Returns the timestamp (in microseconds since epoch) when the semantic field groups
/// configuration was last updated. This is used for time-based FQN selection to prefer
/// services that were processed after the most recent configuration change.
///
/// Returns 0 if no org-level setting exists (uses defaults).
pub async fn get_semantic_field_groups_updated_at(org_id: &str) -> i64 {
    use config::meta::system_settings::keys::SEMANTIC_FIELD_GROUPS;

    // Get the settings record (not just the value)
    if let Ok(Some(setting)) = get_resolved(Some(org_id), None, SEMANTIC_FIELD_GROUPS).await {
        setting.updated_at
    } else {
        // No org-level setting found - using defaults (return 0 = epoch)
        0
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

    #[test]
    fn test_normalize_category_to_id() {
        assert_eq!(normalize_category_to_id("Kubernetes"), "kubernetes");
        assert_eq!(normalize_category_to_id("AWS EC2"), "aws-ec2");
        assert_eq!(normalize_category_to_id("Common"), "common");
        assert_eq!(normalize_category_to_id("GCP"), "gcp");
        assert_eq!(
            normalize_category_to_id("Custom Category"),
            "custom-category"
        );
        assert_eq!(normalize_category_to_id("UPPERCASE"), "uppercase");
        assert_eq!(normalize_category_to_id("mixed CaSe"), "mixed-case");
    }

    #[test]
    fn test_normalize_category_to_label() {
        assert_eq!(normalize_category_to_label("kubernetes"), "Kubernetes");
        assert_eq!(normalize_category_to_label("aws ec2"), "AWS Ec2");
        assert_eq!(normalize_category_to_label("Common"), "Common");
        assert_eq!(normalize_category_to_label("GCP"), "GCP");
        assert_eq!(
            normalize_category_to_label("custom category"),
            "Custom Category"
        );
        assert_eq!(normalize_category_to_label("UPPERCASE"), "Uppercase");
        assert_eq!(normalize_category_to_label("mixed CaSe"), "Mixed Case");
        // Test edge cases
        assert_eq!(normalize_category_to_label(""), "");
        assert_eq!(normalize_category_to_label("a"), "A");
        assert_eq!(normalize_category_to_label("a b"), "A B");
    }

    #[test]
    fn test_category_normalization_consistency() {
        // Ensure that normalizing a category to ID and then back creates consistent results
        let test_cases = vec![
            "Kubernetes",
            "AWS EC2",
            "Common",
            "GCP",
            "Custom Category",
            "kubernetes", // Already lowercase
            "mixed CaSe",
        ];

        for category in test_cases {
            let id = normalize_category_to_id(category);
            let label = normalize_category_to_label(category);

            // ID should always be lowercase with dashes
            assert!(
                !id.contains(char::is_uppercase),
                "ID '{}' contains uppercase",
                id
            );
            assert!(!id.contains(' '), "ID '{}' contains spaces", id);

            // Label should be title case
            let words: Vec<&str> = label.split_whitespace().collect();
            for word in words {
                let first_char = word.chars().next().unwrap();
                assert!(
                    first_char.is_uppercase(),
                    "Label '{}' word '{}' should start with uppercase",
                    label,
                    word
                );
            }
        }
    }

    #[test]
    fn test_service_identity_config_no_auto_config_when_sets_exist() {
        // Test that auto-config doesn't run when sets already exist
        // (This condition check still applies in the new logic)
        use config::meta::correlation::{IdentitySet, ServiceIdentityConfig};

        let mut config = ServiceIdentityConfig::new_default();
        config.tracked_alias_ids = vec!["service".to_string(), "environment".to_string()];
        config.sets = vec![IdentitySet {
            id: "existing".to_string(),
            label: "Existing Set".to_string(),
            distinguish_by: vec!["service".to_string()],
        }];

        let original_sets_len = config.sets.len();

        // Test the condition that prevents auto-config (still relevant)
        let should_auto_config = config.sets.is_empty() && !config.tracked_alias_ids.is_empty();
        assert!(
            !should_auto_config,
            "Auto-config should not run when sets already exist"
        );

        // Verify sets are unchanged
        assert_eq!(config.sets.len(), original_sets_len);
        assert_eq!(config.sets[0].id, "existing");
    }

    #[test]
    fn test_service_identity_config_default_from_env_has_defaults() {
        // new_default() returns an intentionally empty config — sets and tracked_alias_ids are
        // populated dynamically at runtime by get_service_identity_config(), not hardcoded here.
        use config::meta::correlation::ServiceIdentityConfig;

        let config = ServiceIdentityConfig::new_default();

        assert_eq!(config.sets.len(), 0);
        assert_eq!(config.tracked_alias_ids.len(), 0);
    }

    #[test]
    fn test_auto_config_category_grouping_simulation() {
        // Test that demonstrates the new category-based grouping logic
        // (This simulates the behavior without requiring async calls)
        use std::collections::HashMap;

        use config::meta::correlation::{FieldAlias, IdentitySet};

        // Simulate semantic groups that would be loaded
        let semantic_groups = [
            FieldAlias::with_group("environment", "Environment", "Common", &["env"]),
            FieldAlias::with_group("region", "Region", "Common", &["region"]),
            FieldAlias::with_group("k8s-cluster", "K8s Cluster", "Kubernetes", &["cluster"]),
            FieldAlias::with_group(
                "k8s-namespace",
                "K8s Namespace",
                "Kubernetes",
                &["namespace"],
            ),
            FieldAlias::with_group("aws-ecs-cluster", "ECS Cluster", "AWS", &["ecs_cluster"]),
            FieldAlias::with_group("gcp-instance", "GCP Instance", "GCP", &["gcp_instance"]),
        ];

        let tracked_alias_ids = vec![
            "environment".to_string(),
            "region".to_string(),
            "k8s-cluster".to_string(),
            "k8s-namespace".to_string(),
            "aws-ecs-cluster".to_string(),
            "gcp-instance".to_string(),
        ];

        // Simulate the new category-based grouping logic
        let mut category_groups = HashMap::new();

        for alias_id in &tracked_alias_ids {
            if let Some(group) = semantic_groups.iter().find(|g| g.id == *alias_id) {
                let category = group.group.as_deref().unwrap_or("Common");
                category_groups
                    .entry(category)
                    .or_insert_with(Vec::new)
                    .push(alias_id.clone());
            }
        }

        let mut identity_sets = Vec::new();
        for (category, alias_ids) in category_groups {
            if !alias_ids.is_empty() {
                let set_id = normalize_category_to_id(category);
                let normalized_label = normalize_category_to_label(category);
                let identity_set = IdentitySet {
                    id: set_id,
                    label: normalized_label,
                    distinguish_by: alias_ids,
                };
                identity_sets.push(identity_set);
            }
        }

        // Verify the expected category-based grouping
        assert_eq!(identity_sets.len(), 4); // Common, Kubernetes, AWS, GCP

        // Check that we have the expected categories
        let set_ids: Vec<&str> = identity_sets.iter().map(|s| s.id.as_str()).collect();
        assert!(set_ids.contains(&"common"));
        assert!(set_ids.contains(&"kubernetes"));
        assert!(set_ids.contains(&"aws"));
        assert!(set_ids.contains(&"gcp"));

        // Check the Common category contains environment and region
        let common_set = identity_sets.iter().find(|s| s.id == "common").unwrap();
        assert!(
            common_set
                .distinguish_by
                .contains(&"environment".to_string())
        );
        assert!(common_set.distinguish_by.contains(&"region".to_string()));

        // Check the Kubernetes category contains k8s fields
        let k8s_set = identity_sets.iter().find(|s| s.id == "kubernetes").unwrap();
        assert!(k8s_set.distinguish_by.contains(&"k8s-cluster".to_string()));
        assert!(
            k8s_set
                .distinguish_by
                .contains(&"k8s-namespace".to_string())
        );

        // Verify that labels are normalized to title case
        let labels: Vec<&str> = identity_sets.iter().map(|s| s.label.as_str()).collect();
        assert!(labels.contains(&"Common"));
        assert!(labels.contains(&"Kubernetes"));
        assert!(labels.contains(&"AWS"));
        assert!(labels.contains(&"GCP"));
    }

    #[test]
    fn test_category_normalization_prevents_duplicates() {
        // Test that demonstrates how normalization prevents duplicate categories
        // This addresses the issue where auto-config creates "kubernetes" (lowercase ID)
        // while semantic groups have "Kubernetes" (capitalized), causing UI duplicates
        use std::collections::{HashMap, HashSet};

        // Simulate mixed-case category input that could cause duplicates
        let mixed_case_categories = vec![
            "Kubernetes",  // From semantic group
            "kubernetes",  // From potential auto-config without normalization
            "AWS",         // Uppercase
            "aws",         // Lowercase
            "Common",      // Title case
            "COMMON",      // All caps
            "custom test", // Lowercase with space
            "Custom Test", // Title case with space
        ];

        // Normalize all categories and verify no duplicates
        let mut normalized_ids = HashSet::new();
        let mut normalized_labels = HashMap::new();

        for category in mixed_case_categories {
            let id = normalize_category_to_id(category);
            let label = normalize_category_to_label(category);

            // Store the first occurrence for comparison
            normalized_labels.entry(id.clone()).or_insert(label.clone());
            normalized_ids.insert(id);
        }

        // Should have only 4 unique categories after normalization
        assert_eq!(normalized_ids.len(), 4);
        assert!(normalized_ids.contains("kubernetes"));
        assert!(normalized_ids.contains("aws"));
        assert!(normalized_ids.contains("common"));
        assert!(normalized_ids.contains("custom-test"));

        // All labels should be consistently title case
        assert_eq!(normalized_labels["kubernetes"], "Kubernetes");
        assert_eq!(normalized_labels["aws"], "AWS");
        assert_eq!(normalized_labels["common"], "Common");
        assert_eq!(normalized_labels["custom-test"], "Custom Test");
    }
}
