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
    collections::HashMap,
    sync::{Once, OnceLock},
    time::Duration,
};

use config::{cluster::LOCAL_NODE, get_config, utils::time::now_micros};
use serde::{Deserialize, Serialize};
use tokio::time::{MissedTickBehavior, interval};

use crate::{
    db::{Db, get_coordinator, nats},
    errors::Result,
};

pub const LEVEL_STORE: u32 = 1;
pub const LEVEL_P1_11: u32 = 2;
pub const NODE_LEVEL: u32 = LEVEL_P1_11;
// Raise the floor at the release cut to the first version that ships the store.
pub const STORE_FLOOR_VERSION: &str = "v1.3.0-rc1";
const PREFIX: &str = "/secret_store/sys/capability/";
const RENEW_INTERVAL: Duration = Duration::from_secs(20);
pub(super) const LEASE_US: i64 = 60_000_000;
static BOOTED_AT: OnceLock<i64> = OnceLock::new();
static RELEASE_FLOOR_WARNING: Once = Once::new();

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityRecord {
    pub level: u32,
    pub binary_version: String,
    pub booted_at: i64,
    pub refs_enabled: bool,
    pub fga_mode: FgaMode,
    pub renewed_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FgaMode {
    On,
    Off,
}

pub fn own_record(fga_mode: FgaMode, now_us: i64) -> CapabilityRecord {
    CapabilityRecord {
        level: NODE_LEVEL,
        binary_version: config::VERSION.to_owned(),
        booted_at: *BOOTED_AT.get_or_init(|| now_us),
        refs_enabled: get_config().common.secret_store_refs_enabled,
        fga_mode,
        renewed_at: now_us,
    }
}

pub fn is_fresh(record: &CapabilityRecord, now_us: i64) -> bool {
    now_us.saturating_sub(record.renewed_at) <= LEASE_US
}

pub fn meets_release_floor(version: &str, floor: &str) -> bool {
    release_floor_ignored() || crate::cluster::version_at_least(version, floor)
}

pub fn release_floor_ignored() -> bool {
    if !get_config().common.secret_store_ignore_release_floor {
        return false;
    }
    RELEASE_FLOOR_WARNING.call_once(|| {
        log::warn!(
            "O2_SECRET_STORE_IGNORE_RELEASE_FLOOR is enabled: bypassing secret store release floors; testing only, never use in production; set on every node"
        );
    });
    true
}

pub async fn write_record_in(
    db: &dyn Db,
    node_uuid: &str,
    record: &CapabilityRecord,
) -> Result<()> {
    let value = serde_json::to_vec(record)?.into();
    db.put(&format!("{PREFIX}{node_uuid}"), value, false, None)
        .await
}

pub async fn list_records_in(db: &dyn Db) -> Result<HashMap<String, CapabilityRecord>> {
    let mut records = HashMap::new();
    for (key, value) in db.list(PREFIX).await? {
        let Some(uuid) = key.strip_prefix(PREFIX) else {
            continue;
        };
        match serde_json::from_slice(&value) {
            Ok(record) => {
                records.insert(uuid.to_owned(), record);
            }
            Err(err) => log::warn!("invalid secret store capability record at {key}: {err}"),
        }
    }
    Ok(records)
}

pub async fn write_own_record(fga_mode: FgaMode) -> Result<()> {
    let db = coordinator().await?;
    write_record_in(db, &LOCAL_NODE.uuid, &own_record(fga_mode, now_micros())).await
}

pub async fn delete_own_record() -> Result<()> {
    let key = format!("{PREFIX}{}", LOCAL_NODE.uuid);
    coordinator()
        .await?
        .delete_if_exists(&key, false, false)
        .await
}

pub async fn run_writer(fga_mode: FgaMode) {
    let mut ticks = interval(RENEW_INTERVAL);
    ticks.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        ticks.tick().await;
        if let Err(err) = write_own_record(fga_mode).await {
            log::error!("failed to renew secret store capability record: {err}");
        }
    }
}

pub(super) async fn coordinator() -> Result<&'static dyn Db> {
    // First-use NATS connection errors must reach the heartbeat loops so they can retry.
    if !get_config().common.local_mode {
        nats::try_get_nats_client().await?;
    }
    Ok(get_coordinator().await.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::sqlite::SqliteDb, secret_store::gate::tests::isolated_store_test};

    fn record() -> CapabilityRecord {
        CapabilityRecord {
            level: NODE_LEVEL,
            binary_version: STORE_FLOOR_VERSION.to_owned(),
            booted_at: 1_000_000,
            refs_enabled: true,
            fga_mode: FgaMode::On,
            renewed_at: 20_000_000,
        }
    }

    #[test]
    fn store_release_floors_exceed_released_versions() {
        use crate::{cluster::version_at_least, secret_store::external::P1E1_RELEASE};

        let floors = [STORE_FLOOR_VERSION, P1E1_RELEASE];
        for floor in floors {
            assert!(version_at_least(floor, "v1.2.0"));
            assert!(!version_at_least("v1.2.0", floor));
        }
        let Ok(output) = std::process::Command::new("git")
            .args(["tag", "--list", "v*"])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output()
        else {
            return;
        };
        if !output.status.success() {
            return;
        }
        let Ok(tags) = std::str::from_utf8(&output.stdout) else {
            return;
        };
        let newest = tags
            .lines()
            .filter(|tag| version_at_least(tag, tag))
            .reduce(|newest, tag| {
                if version_at_least(tag, newest) {
                    tag
                } else {
                    newest
                }
            });
        if let Some(newest) = newest {
            for floor in floors {
                assert!(version_at_least(floor, newest), "{floor} <= {newest}");
                assert!(!version_at_least(newest, floor), "{floor} <= {newest}");
            }
        }
    }

    #[test]
    fn capability_record_expires_after_sixty_seconds() {
        let record = record();
        assert!(is_fresh(&record, record.renewed_at + 59_000_000));
        assert!(is_fresh(&record, record.renewed_at + 60_000_000));
        assert!(!is_fresh(&record, record.renewed_at + 61_000_000));
    }

    #[test]
    fn r13_45_coordinator_lists_full_records_and_skips_malformed_values() {
        isolated_store_test(
            "secret_store::capability::tests::r13_45_coordinator_lists_full_records_and_skips_malformed_values",
            async {
                crate::db::create_table().await.unwrap();
                let db = SqliteDb::default();
                let uuid = "r13-45-coordinator";
                let bad_uuid = "r13-45-invalid";
                let record = record();
                write_record_in(&db, uuid, &record).await.unwrap();
                db.put(
                    &format!("{PREFIX}{bad_uuid}"),
                    "invalid".into(),
                    false,
                    None,
                )
                .await
                .unwrap();
                let records = list_records_in(&db).await.unwrap();
                assert_eq!(records.get(uuid), Some(&record));
                assert!(!records.contains_key(bad_uuid));
            },
        );
    }

    #[test]
    fn r13_45_writer_avoids_the_value_stripping_coordinator_helper() {
        let source = include_str!("capability.rs");
        let (production, _) = source.split_once("#[cfg(test)]\nmod tests").unwrap();
        assert!(!production.contains(concat!("put_into_db_", "coordinator(")));
    }
}
