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

//! Organization-level alert configuration storage
//!
//! This module provides functions to store and retrieve org-level alert configs
//! using the existing key-value DB interface.

use config::meta::{
    alerts::deduplication::GlobalDeduplicationConfig, correlation::SemanticFieldGroup,
};
use infra::db;

const MODULE: &str = "alert_config";
const DEDUPLICATION_KEY: &str = "deduplication";

/// Get deduplication config for an organization
pub async fn get_deduplication_config(
    org_id: &str,
) -> Result<Option<GlobalDeduplicationConfig>, anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let db = db::get_db().await;

    match db.get(&key).await {
        Ok(bytes) => {
            let config: GlobalDeduplicationConfig = serde_json::from_slice(&bytes)?;
            Ok(Some(config))
        }
        Err(infra::errors::Error::DbError(infra::errors::DbError::KeyNotExists(_))) => Ok(None),
        Err(e) => Err(anyhow::anyhow!("Failed to get deduplication config: {e}")),
    }
}

/// Set deduplication config for an organization
pub async fn set_deduplication_config(
    org_id: &str,
    config: &GlobalDeduplicationConfig,
) -> Result<(), anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let value = serde_json::to_vec(config)?;
    let db = db::get_db().await;

    db.put(&key, value.into(), db::NO_NEED_WATCH, None)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to set deduplication config: {e}"))?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::semantic_groups_put(
            org_id,
            config.clone(),
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish semantic_groups put: {e}");
    }

    Ok(())
}

/// Delete deduplication config for an organization
pub async fn delete_deduplication_config(org_id: &str) -> Result<(), anyhow::Error> {
    let key = db::build_key(MODULE, org_id, DEDUPLICATION_KEY, 0);
    let db = db::get_db().await;

    db.delete_if_exists(&key, false, db::NO_NEED_WATCH)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to delete deduplication config: {e}"))?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !config::get_config().common.local_mode
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::semantic_groups_delete(org_id).await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish semantic_groups delete: {e}");
    }

    Ok(())
}

/// Get semantic field groups for an organization
///
/// Returns the semantic field groups stored in the organization's deduplication config.
/// If no config exists, initializes with default groups from JSON file/hardcoded presets.
///
/// # Returns
/// - `Ok(Vec<SemanticFieldGroup>)` - Semantic groups for the organization
pub async fn get_semantic_groups(org_id: &str) -> Result<Vec<SemanticFieldGroup>, anyhow::Error> {
    match get_deduplication_config(org_id).await? {
        Some(config) => Ok(config.semantic_field_groups),
        None => {
            // No config exists, initialize with defaults
            #[cfg(feature = "enterprise")]
            let defaults =
                o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file();

            #[cfg(not(feature = "enterprise"))]
            let defaults = SemanticFieldGroup::load_defaults_from_file();

            // Auto-initialize for this org
            let config = GlobalDeduplicationConfig {
                enabled: false, // Start disabled
                semantic_field_groups: defaults.clone(),
                alert_dedup_enabled: false,
                alert_fingerprint_groups: vec![],
                time_window_minutes: None,
                fqn_priority_dimensions: GlobalDeduplicationConfig::default_fqn_priority(),
            };

            // Try to save, but don't fail if it doesn't work
            if let Err(e) = set_deduplication_config(org_id, &config).await {
                log::warn!("Failed to auto-initialize semantic groups for org {org_id}: {e}");
            }

            Ok(defaults)
        }
    }
}

/// Initialize semantic field groups for a new organization
///
/// Called during organization creation to set up default semantic groups.
/// Loads defaults from JSON file (or hardcoded fallback) and stores them.
///
/// # Returns
/// - `Ok(())` if initialization succeeded
/// - `Err` if failed to save configuration
pub async fn initialize_semantic_groups(org_id: &str) -> Result<(), anyhow::Error> {
    // Check if already initialized
    if get_deduplication_config(org_id).await?.is_some() {
        log::debug!("Semantic groups already initialized for org {org_id}");
        return Ok(());
    }

    #[cfg(feature = "enterprise")]
    let defaults = o2_enterprise::enterprise::alerts::semantic_config::load_defaults_from_file();

    #[cfg(not(feature = "enterprise"))]
    let defaults = SemanticFieldGroup::load_defaults_from_file();
    let config = GlobalDeduplicationConfig {
        enabled: false,
        semantic_field_groups: defaults,
        alert_dedup_enabled: false,
        alert_fingerprint_groups: vec![],
        time_window_minutes: None,
        fqn_priority_dimensions: GlobalDeduplicationConfig::default_fqn_priority(),
    };

    set_deduplication_config(org_id, &config).await?;
    log::info!("Initialized semantic groups for org {org_id}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_key() {
        let key = db::build_key(MODULE, "org123", DEDUPLICATION_KEY, 0);
        assert_eq!(key, "/alert_config/org123/deduplication");
    }
}
