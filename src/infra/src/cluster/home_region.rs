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

//! The region that runs org-wide work: the one holding the scheduler claim.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use parking_lot::Mutex;

use crate::errors::Result;

const CACHE_US: i64 = 30_000_000;

static RESOLVER: OnceLock<Arc<dyn HomeRegionResolver>> = OnceLock::new();
static CACHE: Mutex<Option<(i64, HomeRegion)>> = Mutex::new(None);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HomeRegion {
    pub name: String,
    pub is_local: bool,
}

/// Reads the scheduler claim; an error means "not home here" to every caller (fail closed).
#[async_trait]
pub trait HomeRegionResolver: Send + Sync {
    async fn resolve(&self) -> Result<HomeRegion>;
}

/// Installed once at start-up; false when one was already set.
pub fn set_home_region_resolver(resolver: Arc<dyn HomeRegionResolver>) -> bool {
    RESOLVER.set(resolver).is_ok()
}

/// Cached 30 s; with no resolver (no super cluster) this region is home.
pub async fn home_region() -> Result<HomeRegion> {
    let Some(resolver) = RESOLVER.get() else {
        return Ok(HomeRegion {
            name: config::get_cluster_name(),
            is_local: true,
        });
    };
    let now = config::utils::time::now_micros();
    if let Some((at, home)) = CACHE.lock().as_ref()
        && now - at < CACHE_US
    {
        return Ok(home.clone());
    }
    let home = resolver.resolve().await?;
    *CACHE.lock() = Some((now, home.clone()));
    Ok(home)
}
