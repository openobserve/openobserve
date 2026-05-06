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

use std::{
    path::PathBuf,
    sync::{LazyLock as Lazy, RwLock},
};

// Config file path management
#[derive(Debug, Clone, Default)]
pub struct ConfigManager {
    file_path: Option<PathBuf>,
    last_hash: Option<String>,
}

static CONFIG_MANAGER: Lazy<RwLock<ConfigManager>> =
    Lazy::new(|| RwLock::new(ConfigManager::default()));

// Config manager interface functions
pub fn set_config_file_path(path: PathBuf) -> Result<(), anyhow::Error> {
    // CLI validation: file MUST exist when provided via CLI
    if !path.exists() {
        return Err(anyhow::anyhow!(
            "Config file does not exist: {}",
            path.display()
        ));
    }

    let hash = super::calculate_config_file_hash(&path)?;

    // Update the config manager
    {
        let mut manager = CONFIG_MANAGER.write().unwrap();
        manager.file_path = Some(path.clone());
        manager.last_hash = Some(hash); // Reset hash when path changes
    }

    log::info!("Config manager: Set CLI config file path to {:?}", path);

    Ok(())
}

pub fn get_config_file_path() -> Option<PathBuf> {
    let manager = CONFIG_MANAGER.read().unwrap();
    manager.file_path.clone()
}

pub fn get_config_file_last_hash() -> Option<String> {
    let manager = CONFIG_MANAGER.read().unwrap();
    manager.last_hash.clone()
}

pub fn update_config_file_last_hash(hash: String) {
    let mut manager = CONFIG_MANAGER.write().unwrap();
    manager.last_hash = Some(hash);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_and_get_last_hash() {
        update_config_file_last_hash("abc123".to_string());
        let hash = get_config_file_last_hash();
        assert_eq!(hash.as_deref(), Some("abc123"));
    }

    #[test]
    fn test_update_last_hash_overwrites_previous() {
        update_config_file_last_hash("first".to_string());
        update_config_file_last_hash("second".to_string());
        let hash = get_config_file_last_hash();
        assert_eq!(hash.as_deref(), Some("second"));
    }

    #[test]
    fn test_set_config_file_path_nonexistent_returns_error() {
        let result = set_config_file_path(PathBuf::from("/nonexistent/path/config.toml"));
        assert!(result.is_err());
    }

    #[test]
    fn test_get_config_file_path_returns_option() {
        // just verify the fn returns without panic
        let _ = get_config_file_path();
    }

    #[test]
    fn test_update_last_hash_and_get() {
        update_config_file_last_hash("hash-xyz".to_string());
        let result = get_config_file_last_hash();
        assert!(result.is_some());
        assert_eq!(result.as_deref(), Some("hash-xyz"));
    }
}
