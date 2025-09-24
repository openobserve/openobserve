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

use std::path::PathBuf;

use config::spawn_pausable_job;

/// This function will start the config file watcher and load the global config
/// this is because it uses the interval from config to determine the frequency
pub fn run() -> Option<tokio::task::JoinHandle<()>> {
    // Only start if config file path is set
    if config::config_path_manager::get_config_file_path().is_none() {
        log::debug!("[CONFIG_WATCHER] No config file specified, watcher not started");
        return None;
    }

    Some(config::spawn_pausable_job!(
        "config_watcher",
        config::get_config().common.env_watcher_interval,
        {
            if let Err(e) = check_and_reload_config_file() {
                log::error!("[CONFIG_WATCHER] Error checking config file: {}", e);
            }
        }
    ))
}

fn check_and_reload_config_file() -> Result<(), anyhow::Error> {
    let path = match config::config_path_manager::get_config_file_path() {
        Some(path) => path,
        None => return Ok(()), // No config file to watch
    };

    // Check if file exists
    if !path.exists() {
        log::warn!("[CONFIG_WATCHER] Config file does not exist: {path:?}");
        return Ok(());
    }

    // Calculate current hash
    let current_hash = config::calculate_config_file_hash(&path)?;
    let last_hash = config::config_path_manager::get_config_file_last_hash();

    // Compare hashes
    if Some(&current_hash) != last_hash.as_ref() {
        if last_hash.is_none() {
            log::info!("[CONFIG_WATCHER] Initial config file hash stored");
        } else {
            log::info!("[CONFIG_WATCHER] Config file hash changed, reloading config...");
        }

        if let Err(e) = reload_config(&path) {
            log::error!("[CONFIG_WATCHER] Failed to reload config file: {}", e);
        } else {
            // Update stored hash only on successful reload
            config::config_path_manager::update_config_file_last_hash(current_hash);
            log::info!("[CONFIG_WATCHER] Config file and config reloaded successfully");
        }
    }

    Ok(())
}

pub fn reload_config(path: &PathBuf) -> Result<(), anyhow::Error> {
    log::info!("[CONFIG_WATCHER] Reloading config file: {:?}", path);

    // Refresh config - this will read from the updated config file
    config::config::refresh_config()?;

    #[cfg(feature = "enterprise")]
    {
        use o2_dex::config::refresh_config as refresh_dex_config;
        use o2_enterprise::enterprise::common::config::refresh_config as refresh_o2_config;
        use o2_openfga::config::refresh_config as refresh_openfga_config;

        refresh_o2_config()
            .and_then(|_| refresh_dex_config())
            .and_then(|_| refresh_openfga_config())?;
    }

    log::info!("Config file and config reloaded successfully");
    Ok(())
}
