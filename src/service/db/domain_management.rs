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

use config::utils::json;
use infra::errors::Error;

use crate::{
    common::{
        infra::config::DOMAIN_MANAGEMENT_CONFIG, meta::domain_management::DomainManagementConfig,
    },
    service::db,
};

/// Key for system-wide domain management configuration
pub const DOMAIN_MANAGEMENT_KEY: &str = "/domain_management/config";

/// Get system-wide domain management configuration
pub async fn get_domain_management_config() -> Result<DomainManagementConfig, Error> {
    // Check cache first
    if let Some(config) = DOMAIN_MANAGEMENT_CONFIG.get(DOMAIN_MANAGEMENT_KEY) {
        return Ok(config.clone());
    }

    // Get from DB
    match db::get(DOMAIN_MANAGEMENT_KEY).await {
        Ok(data) => {
            let config: DomainManagementConfig = json::from_slice(&data)?;
            // Cache the config
            DOMAIN_MANAGEMENT_CONFIG.insert(DOMAIN_MANAGEMENT_KEY.to_string(), config.clone());
            Ok(config)
        }
        Err(_) => {
            // Return default config if not found
            let default_config = DomainManagementConfig::default();
            Ok(default_config)
        }
    }
}

/// Set system-wide domain management configuration
pub async fn set_domain_management_config(config: &DomainManagementConfig) -> Result<(), Error> {
    let data = json::to_vec(config)?;
    db::put(DOMAIN_MANAGEMENT_KEY, data.into(), db::NEED_WATCH, None).await?;

    // Update cache
    DOMAIN_MANAGEMENT_CONFIG.insert(DOMAIN_MANAGEMENT_KEY.to_string(), config.clone());

    Ok(())
}

/// Upsert a domain configuration in the system-wide config
pub async fn upsert_domain_config(
    domain: &str,
    config: &crate::common::meta::domain_management::DomainConfig,
) -> Result<(), Error> {
    let mut domain_mgmt_config = get_domain_management_config().await?;

    // Find and update existing domain or add new one
    if let Some(existing) = domain_mgmt_config
        .domains
        .iter_mut()
        .find(|d| d.domain == domain)
    {
        *existing = config.clone();
    } else {
        domain_mgmt_config.domains.push(config.clone());
    }

    domain_mgmt_config.updated_at = config::utils::time::now_micros();
    set_domain_management_config(&domain_mgmt_config).await
}

/// Remove a domain configuration from the system-wide config
pub async fn remove_domain_config(domain: &str) -> Result<(), Error> {
    let mut domain_mgmt_config = get_domain_management_config().await?;

    domain_mgmt_config.domains.retain(|d| d.domain != domain);
    domain_mgmt_config.updated_at = config::utils::time::now_micros();

    set_domain_management_config(&domain_mgmt_config).await
}

/// Delete the entire system-wide domain management configuration
pub async fn delete_domain_management_config() -> Result<(), Error> {
    db::delete(DOMAIN_MANAGEMENT_KEY, false, db::NEED_WATCH, None).await?;

    // Remove from cache
    DOMAIN_MANAGEMENT_CONFIG.remove(DOMAIN_MANAGEMENT_KEY);

    Ok(())
}

/// Watch for changes to domain management configuration
pub async fn watch() -> Result<(), anyhow::Error> {
    let key = DOMAIN_MANAGEMENT_KEY;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();

    log::info!("Start watching domain management configuration");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_domain_management: event channel closed");
                return Ok(());
            }
        };

        match ev {
            db::Event::Put(ev) => {
                let item_key = ev.key.clone();
                match db::get(&item_key).await {
                    Ok(val) => {
                        if let Ok(config) = json::from_slice::<DomainManagementConfig>(&val) {
                            DOMAIN_MANAGEMENT_CONFIG.insert(key.to_string(), config);
                        }
                    }
                    Err(e) => {
                        log::error!("Error getting domain management config: {e}");
                    }
                }
            }
            db::Event::Delete(_ev) => {
                DOMAIN_MANAGEMENT_CONFIG.remove(key);
            }
            db::Event::Empty => {}
        }
    }
}

/// Initialize domain management cache
pub async fn cache() -> Result<(), anyhow::Error> {
    let config = get_domain_management_config().await.unwrap_or_default();
    DOMAIN_MANAGEMENT_CONFIG.insert(DOMAIN_MANAGEMENT_KEY.to_string(), config);
    log::info!("Domain management configuration cached");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::meta::domain_management::DomainConfig;

    #[tokio::test]
    async fn test_domain_management_config_roundtrip() {
        let domain_config = DomainConfig {
            domain: "example.com".to_string(),
            allow_all_users: true,
            allowed_emails: vec![],
            enabled: true,
            created_at: config::utils::time::now_micros(),
            updated_at: config::utils::time::now_micros(),
        };

        let config = DomainManagementConfig {
            enabled: true,
            domains: vec![domain_config],
            updated_at: config::utils::time::now_micros(),
        };

        // This test would require a proper database setup
        // For now, just test serialization/deserialization
        let serialized = json::to_vec(&config).unwrap();
        let deserialized: DomainManagementConfig = json::from_slice(&serialized).unwrap();

        assert_eq!(config.enabled, deserialized.enabled);
        assert_eq!(config.domains.len(), deserialized.domains.len());
        assert_eq!(config.domains[0].domain, deserialized.domains[0].domain);
    }
}
