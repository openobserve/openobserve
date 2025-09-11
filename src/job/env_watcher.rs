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

use config::{
    calculate_env_file_hash, get_config, get_env_file_last_hash, get_env_file_path,
    spawn_pausable_job, update_env_file_last_hash,
};

pub fn run() -> Option<tokio::task::JoinHandle<()>> {
    // Only start if env file path is set
    if get_env_file_path().is_none() {
        log::debug!("[ENV_WATCHER] No env file specified, watcher not started");
        return None;
    }

    Some(spawn_pausable_job!(
        "env_watcher",
        get_config().common.env_watcher_interval,
        {
            if let Err(e) = check_and_reload_env_file() {
                log::error!("[ENV_WATCHER] Error checking env file: {}", e);
            }
        }
    ))
}

fn check_and_reload_env_file() -> Result<(), anyhow::Error> {
    let path = match get_env_file_path() {
        Some(path) => path,
        None => return Ok(()), // No env file to watch
    };

    // Check if file exists
    if !path.exists() {
        log::warn!("[ENV_WATCHER] Environment file does not exists: {path:?}");
        return Ok(());
    }

    // Calculate current hash
    let current_hash = calculate_env_file_hash(path)?;
    let last_hash = get_env_file_last_hash();

    // Compare hashes
    if Some(&current_hash) != last_hash.as_ref() {
        if last_hash.is_none() {
            log::info!("[ENV_WATCHER] Initial environment file hash stored");
        } else {
            log::info!("[ENV_WATCHER] Environment file hash changed, reloading config...");
        }

        if let Err(e) = reload_env_and_config(path) {
            log::error!("[ENV_WATCHER] Failed to reload environment file: {}", e);
        } else {
            // Update stored hash only on successful reload
            update_env_file_last_hash(current_hash);
            log::info!("[ENV_WATCHER] Environment file and config reloaded successfully");
        }
    }

    Ok(())
}

pub fn reload_env_and_config(path: &PathBuf) -> Result<(), anyhow::Error> {
    log::info!("[ENV_WATCHER] Reloading environment file: {:?}", path);

    // Refresh config - this will read from the updated environment
    config::refresh_config()?;

    #[cfg(feature = "enterprise")]
    {
        use o2_dex::config::refresh_config as refresh_dex_config;
        use o2_enterprise::enterprise::common::infra::config::refresh_config as refresh_o2_config;
        use o2_openfga::config::refresh_config as refresh_openfga_config;

        refresh_o2_config()
            .and_then(|_| refresh_dex_config())
            .and_then(|_| refresh_openfga_config())?;
    }

    log::info!("Environment and config reloaded successfully");
    Ok(())
}
