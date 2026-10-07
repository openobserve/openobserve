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

use std::sync::{Arc, LazyLock};

use hashbrown::HashMap;
use infra::{
    coordinator::get_coordinator,
    db::Event,
    table::{
        entity::{org_domain_ownership::Model, status_page_custom_domains},
        org_domain_ownership::{OwnershipRecord, OwnershipState},
    },
};

static CACHE: LazyLock<config::RwAHashMap<String, String>> =
    LazyLock::new(|| tokio::sync::RwLock::new(HashMap::new()));

pub const ODO_PREFIX: &str = "/org_domain_ownership/";
const DOMAIN_EXPIRY_BUFFER_SEC: i64 = 60 * 30;

pub async fn init() {
    let items = match infra::table::org_domain_ownership::list_active_domain_org_map().await {
        Ok(v) => v,
        Err(e) => {
            log::error!("error in listing active domain mapping for init caching : {e}");
            return;
        }
    };
    let mut lock = CACHE.write().await;
    for (org, domain) in items {
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

pub async fn get_verified_org_for_domain(domain: &str) -> Result<Option<String>, anyhow::Error> {
    let lock = CACHE.read().await;
    let org = lock.get(domain);
    if let Some(org) = org {
        return Ok(Some(org.to_owned()));
    }
    drop(lock);
    infra::table::org_domain_ownership::get_verified_org_for_domain(domain).await
}

pub async fn save_org_domain_mapping(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    let record = OwnershipRecord {
        org_id: org_id.to_owned(),
        domain: domain.to_owned(),
        state: OwnershipState::Pending,
    };
    infra::table::org_domain_ownership::save_org_domain_mapping(record).await
}

pub async fn delete_linked_domain(record: Model) -> Result<(), anyhow::Error> {
    infra::table::org_domain_ownership::delete_linked_domain(&record.org_id, &record.domain)
        .await?;
    // only sync cache for domain which is verified
    // non verified domain is not going to be in cache
    if record.verification_state == OwnershipState::Verfied as i32 {
        let mut lock = CACHE.write().await;
        lock.remove(domain);
        emit_sync_event(org_id, domain).await;
    }
    Ok(())
}

pub async fn get_domain_org_record(
    org_id: &str,
    domain: &str,
) -> Result<Option<Model>, anyhow::Error> {
    let res = infra::table::org_domain_ownership::get_domain_org_record(org_id, domain).await?;
    Ok(res)
}

pub async fn verify(mut record: Model) -> Result<Model, anyhow::Error> {
    let res = o2_enterprise::enterprise::status_pages::domain_verifier::check_domain_ownership(
        status_page_custom_domains::Model {
            domain: record.domain.clone(),
            verification_token: record.verification_token.clone(),
            last_checked_at: record.last_checked_at,
            updated_at: record.updated_at,
            verification_state: record.verification_state,
            verification_failure_reason: record.verification_failure_reason,
            verified_at: record.verified_at,
            ..Default::default()
        },
        Some(DOMAIN_EXPIRY_BUFFER_SEC),
    )
    .await?;
    record.last_checked_at = res.last_checked_at;
    record.updated_at = res.updated_at;
    record.verification_state = res.verification_state;
    record.verification_failure_reason = res.verification_failure_reason;
    record.verified_at = res.verified_at;

    infra::table::org_domain_ownership::save_domain_org_record(record.clone()).await?;

    Ok(record)
}

pub async fn verify_domain_now(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    let record = infra::table::org_domain_ownership::get_domain_org_record(org_id, domain).await?;
    let Some(record) = record else {
        return Err(anyhow::anyhow!(
            "no mapping for domain {domain} foung for org {org_id}"
        ));
    };
    let updated_record = verify(record).await?;
    if updated_record.verification_state == OwnershipState::Verfied as i32 {
        let mut lock = CACHE.write().await;
        lock.insert(domain.to_owned(), org_id.to_owned());
    }
    emit_sync_event(org_id, domain).await;
    Ok(())
}

pub async fn update_state(org_id: &str, domain: &str, new_state: i32) -> Result<(), anyhow::Error> {
    let mut lock = CACHE.write().await;
    if new_state == OwnershipState::Verfied as i32 {
        lock.insert(domain.to_owned(), org_id.to_owned());
    } else {
        lock.remove(domain);
    }
    emit_sync_event(org_id, domain).await;
    Ok(())
}

pub async fn get_domains_for_org(org_id: &str) -> Result<Vec<Model>, anyhow::Error> {
    let records = infra::table::org_domain_ownership::get_domains_for_org(org_id).await?;
    Ok(records)
}

async fn emit_sync_event(org_id: &str, domain: &str) {
    let cluster_coordinator = get_coordinator().await;
    if let Err(e) = cluster_coordinator
        .put(
            &format!("{ODO_PREFIX}{org_id}/{domain}"),
            "".into(),
            true,
            None,
        )
        .await
    {
        log::error!(
            "error sending cluster sync message for org domain ownership sync for org {org_id} : {e}"
        );
    }
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = ::infra::db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(ODO_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching org_domain_ownership");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_org_domain_ownership: event channel closed");
                return Ok(());
            }
        };

        if let Event::Put(ev) = ev {
            let Some(key) = ev.key.strip_prefix(ODO_PREFIX) else {
                log::error!("unexpected key for org domain prefix watch : {}", ev.key);
                continue;
            };
            let Some((org, domain)) = key.split_once("/") else {
                log::error!(
                    "invalid key received for org domain ownership sync : {}",
                    ev.key
                );
                continue;
            };
            log::info!("received sync event for org domain ownership for org {org}");
            let record = match infra::table::org_domain_ownership::get_domain_org_record(
                org, domain,
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error in retrieving org domain ownership record from db for {org} domain {domain} : {e}"
                    );
                    continue;
                }
            };
            let mut lock = CACHE.write().await;
            match record {
                None => {
                    log::info!(
                        "removing org {org} domain {domain} from memory cache as record not found in db"
                    );
                    lock.remove(domain);
                }
                Some(v) => {
                    if v.verification_state == OwnershipState::Verfied as i32 {
                        log::info!(
                            "added org {org} domain {domain} from memory cache as verified in db"
                        );
                        lock.insert(domain.to_owned(), org.to_owned());
                    } else {
                        log::info!(
                            "removed org {org} domain {domain} from memory cache as not verified in db"
                        );
                        lock.remove(domain);
                    }
                }
            }
        }
    }
}
