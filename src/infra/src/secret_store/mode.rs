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

use config::meta::secret_store::{SecretErrorCode, StoreMode};
use parking_lot::RwLock;

static MODE: RwLock<StoreMode> = RwLock::new(StoreMode::SingleCluster);

pub fn mode() -> StoreMode {
    MODE.read().clone()
}

pub fn set_super_cluster(enabled: bool, region: &str) {
    *MODE.write() = if enabled {
        StoreMode::SuperCluster {
            region: region.to_owned(),
        }
    } else {
        StoreMode::SingleCluster
    };
}

pub fn require_single_cluster() -> Result<(), SecretErrorCode> {
    match &*MODE.read() {
        StoreMode::SingleCluster => Ok(()),
        StoreMode::SuperCluster { .. } => Err(SecretErrorCode::StoreDisabled),
    }
}

pub fn region() -> String {
    match mode() {
        StoreMode::SingleCluster => String::new(),
        StoreMode::SuperCluster { region } => region,
    }
}

#[cfg(test)]
mod tests {
    use parking_lot::Mutex;

    use super::*;

    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn single_cluster_is_enabled_by_default() {
        let _guard = TEST_LOCK.lock();
        assert_eq!(mode(), StoreMode::SingleCluster);
        assert_eq!(require_single_cluster(), Ok(()));
        assert_eq!(region(), "");
    }

    #[test]
    fn super_cluster_disables_the_store_until_reset() {
        let _guard = TEST_LOCK.lock();
        set_super_cluster(true, "east");
        assert_eq!(
            mode(),
            StoreMode::SuperCluster {
                region: "east".into()
            }
        );
        assert_eq!(region(), "east");
        assert_eq!(
            require_single_cluster(),
            Err(SecretErrorCode::StoreDisabled)
        );
        set_super_cluster(false, "east");
        assert_eq!(require_single_cluster(), Ok(()));
        assert_eq!(region(), "");
    }
}
