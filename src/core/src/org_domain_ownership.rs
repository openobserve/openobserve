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

use std::sync::LazyLock;

use hashbrown::HashMap;

static CACHE: LazyLock<config::RwAHashMap<String, String>> =
    LazyLock::new(|| tokio::sync::RwLock::new(HashMap::new()));

pub async fn init() {
    let items = match infra::table::org_domain_ownership::list_active_domain_org_map().await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in listing active domain mapping for init caching : {e}");
            return;
        }
    };
    let mut lock = CACHE.write().await;
    for (domain, org) in items {
        lock.insert(domain, org);
    }
}

pub async fn get_cached_org_for_domain(domain: &str) -> Option<String> {
    let lock = CACHE.read().await;
    let org = lock.get(domain);
    org.map(ToOwned::to_owned)
}

pub async fn remove_domain_from_cache(domain: &str) {
    let mut lock = CACHE.write().await;
    lock.remove(domain);
}

pub async fn add_domain_to_cache(domain: &str, org: &str) {
    let mut lock = CACHE.write().await;
    lock.insert(domain.to_string(), org.to_string());
}
