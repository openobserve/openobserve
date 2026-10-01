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

//! Database migration module for migrating data between different database backends.
//!
//! This module provides three main commands:
//! - `init-db`: Initialize the database tables
//! - `migrate-meta`: Migrate all tables except file_list related tables
//! - `migrate-file-list`: Migrate file_list related tables only

use ::config::DB_SCHEMA_VERSION;
use infra::db::{get_orm_client_ddl, get_orm_client_ro, get_orm_client_rw};

mod adapter;
mod config;
mod migrator;
mod progress;

pub use config::MigrationConfig;
pub use migrator::{run_file_list, run_meta};

const DEFAULT_EXT_AUTH_SALT: &str = "openobserve";
const MIN_EXT_AUTH_SALT_LEN: usize = 16;
// argon2 hashes with a salt of 8 to 48 bytes and get_hash panics outside that
const MIN_ARGON2_SALT_LEN: usize = 8;
const MAX_EXT_AUTH_SALT_LEN: usize = 48;

pub async fn init_db() -> std::result::Result<(), anyhow::Error> {
    // warm both pools before the migration starts hitting them
    get_orm_client_ro().await;
    get_orm_client_rw().await;
    // a missing version is Ok(0), so an error here means the db is
    // unreachable or overloaded: never assume a fresh install, retry then abort
    const MAX_RETRIES: usize = 5;
    let mut db_schema_version = 0;
    let mut last_err = None;
    for attempt in 1..=MAX_RETRIES {
        match infra::get_db_schema_version().await {
            Ok(v) => {
                db_schema_version = v;
                last_err = None;
                break;
            }
            Err(e) => {
                log::warn!(
                    "error in getting db schema version (attempt {attempt}/{MAX_RETRIES}): {e}, retrying..."
                );
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_secs(attempt as u64 * 2)).await;
            }
        }
    }
    if let Some(e) = last_err {
        return Err(anyhow::anyhow!(
            "failed to get db schema version after {MAX_RETRIES} attempts: {e}; refusing to assume a fresh install and run the db upgrade against an unhealthy database"
        ));
    }
    // a missing version alone also matches installs older than the version key
    let fresh_install = db_schema_version == 0 && !infra::db_has_data().await?;
    check_ext_auth_salt(fresh_install, &::config::get_config().auth.ext_auth_salt)?;
    if db_schema_version == DB_SCHEMA_VERSION {
        // if version matches, we do not need to run update commands
        log::info!("DB_SCHEMA_VERSION match, skipping db upgrade");
        return Ok(());
    }
    log::info!(
        "DB_SCHEMA_VERSION mismatch : expected {}, found {db_schema_version}; running db upgrade",
        DB_SCHEMA_VERSION
    );

    // acquire lock for 1 hour for init or migration db
    let lock = infra::dist_lock::lock("/database/init", 3600).await?;

    if let Err(e) = infra::db_init().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    // we initialize both clients here to avoid potential deadlock afterwards
    get_orm_client_ddl().await;

    // migrate infra_sea_orm
    if let Err(e) = infra::table::migrate().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }
    // cloud-related migrations
    #[cfg(feature = "cloud")]
    if let Err(e) = o2_enterprise::enterprise::cloud::migrate().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    if let Err(e) = infra::set_db_schema_version().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    // release lock
    infra::dist_lock::unlock(&lock).await?;

    log::info!("DB upgrade completed to version {}", DB_SCHEMA_VERSION);

    Ok(())
}

/// Existing installs only warn on a weak but usable salt: rotating it breaks logins derived from
/// it.
fn check_ext_auth_salt(fresh_install: bool, salt: &str) -> anyhow::Result<()> {
    if salt.len() > MAX_EXT_AUTH_SALT_LEN {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT is {} bytes, but argon2 accepts at most {MAX_EXT_AUTH_SALT_LEN}; set it to a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} characters (for example `openssl rand -hex 24`)",
            salt.len()
        ));
    }
    if salt != DEFAULT_EXT_AUTH_SALT && salt.len() >= MIN_EXT_AUTH_SALT_LEN {
        return Ok(());
    }
    if fresh_install {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT must be set to a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} characters on a new install (for example `openssl rand -hex 24`), and kept the same on every node and restart"
        ));
    }
    if salt.len() < MIN_ARGON2_SALT_LEN {
        return Err(anyhow::anyhow!(
            "ZO_EXT_AUTH_SALT is {} bytes, but argon2 needs at least {MIN_ARGON2_SALT_LEN}; set it to a random secret of {MIN_EXT_AUTH_SALT_LEN} to {MAX_EXT_AUTH_SALT_LEN} characters (for example `openssl rand -hex 24`)",
            salt.len()
        ));
    }
    log::warn!(
        "ZO_EXT_AUTH_SALT is the public default or shorter than {MIN_EXT_AUTH_SALT_LEN} characters; presigned and ext-token logins can be forged from a leaked database"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_install_refuses_a_missing_default_or_short_ext_auth_salt() {
        for salt in ["", DEFAULT_EXT_AUTH_SALT, "short-secret"] {
            let err = check_ext_auth_salt(true, salt).unwrap_err().to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{salt}: {err}");
        }
    }

    #[test]
    fn a_new_install_accepts_a_random_ext_auth_salt() {
        assert!(check_ext_auth_salt(true, "3f9c2a7e5b1d8c4f6a0e2b9d7c5a3f1e").is_ok());
    }

    #[test]
    fn an_accepted_ext_auth_salt_is_one_argon2_can_hash_with() {
        for len in 0..=96 {
            let salt = "a".repeat(len);
            let hashable =
                ::config::utils::hash::try_get_passcode_hash("Complexpass#123", &salt).is_some();
            for fresh_install in [true, false] {
                let accepted = check_ext_auth_salt(fresh_install, &salt).is_ok();
                assert!(
                    !accepted || hashable,
                    "len {len}, fresh {fresh_install}: accepted but argon2 refuses it"
                );
            }
        }
    }

    #[test]
    fn the_recommended_ext_auth_salt_is_accepted_and_a_hex_32_one_is_refused() {
        let hex_24 = "9f2c4e6a8b0d1f3e5c7a9b1d3f5e7c9a0b2d4f6e8a1c3e5f";
        assert_eq!(hex_24.len(), 48);
        assert!(check_ext_auth_salt(true, hex_24).is_ok());
        assert!(::config::utils::hash::try_get_passcode_hash("p", hex_24).is_some());
        let hex_32 = "9f2c4e6a8b0d1f3e5c7a9b1d3f5e7c9a0b2d4f6e8a1c3e5f7a9b0c1d2e3f4a5b";
        assert_eq!(hex_32.len(), 64);
        for fresh_install in [true, false] {
            let err = check_ext_auth_salt(fresh_install, hex_32)
                .unwrap_err()
                .to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{err}");
            assert!(err.contains("openssl rand -hex 24"), "{err}");
        }
    }

    #[test]
    fn the_new_install_refusal_recommends_a_salt_that_fits() {
        let err = check_ext_auth_salt(true, "").unwrap_err().to_string();
        assert!(err.contains("openssl rand -hex 24"), "{err}");
    }

    #[test]
    fn the_shipped_example_ext_auth_salts_are_refused_on_a_new_install() {
        let env_example = include_str!("../../.env.example")
            .lines()
            .find_map(|line| line.trim().strip_prefix("ZO_EXT_AUTH_SALT"))
            .and_then(|rest| rest.trim().strip_prefix('='))
            .map(|value| value.trim().trim_matches('"').to_string())
            .expect(".env.example sets ZO_EXT_AUTH_SALT");
        let k8s = include_str!("../../deploy/k8s/statefulset.yaml");
        let k8s = k8s
            .lines()
            .skip_while(|line| !line.contains("name: ZO_EXT_AUTH_SALT"))
            .find_map(|line| line.trim().strip_prefix("value:"))
            .map(|value| value.trim().trim_matches('"').to_string())
            .expect("statefulset.yaml sets ZO_EXT_AUTH_SALT");
        for salt in [env_example, k8s] {
            assert!(check_ext_auth_salt(true, &salt).is_err(), "{salt:?}");
        }
    }

    #[test]
    fn an_existing_install_keeps_starting_with_the_default_or_a_short_usable_ext_auth_salt() {
        for salt in [DEFAULT_EXT_AUTH_SALT, "eight888", "short-secret"] {
            assert!(check_ext_auth_salt(false, salt).is_ok(), "{salt:?}");
        }
    }

    #[test]
    fn an_existing_install_refuses_an_ext_auth_salt_argon2_cannot_use() {
        let too_long = "a".repeat(MAX_EXT_AUTH_SALT_LEN + 1);
        for salt in ["", "a", "abc", "seven77", too_long.as_str()] {
            assert!(
                ::config::utils::hash::try_get_passcode_hash("p", salt).is_none(),
                "{salt:?} is usable"
            );
            let err = check_ext_auth_salt(false, salt)
                .expect_err(salt)
                .to_string();
            assert!(err.contains("ZO_EXT_AUTH_SALT"), "{salt:?}: {err}");
            assert!(err.contains("openssl rand -hex 24"), "{salt:?}: {err}");
        }
    }
}
