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
use infra::table::{
    entity::{org_domain_ownership::Model, status_page_custom_domains},
    org_domain_ownership::{OwnershipRecord, OwnershipState},
};

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

pub async fn get_org_for_domain(domain: &str) -> Result<Option<String>, anyhow::Error> {
    let lock = CACHE.read().await;
    let org = lock.get(domain);
    if let Some(org) = org {
        return Ok(Some(org.to_owned()));
    }
    drop(lock);
    infra::table::org_domain_ownership::get_org_for_domain(domain).await
}

pub async fn save_org_domain_mapping(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    let record = OwnershipRecord {
        org_id: org_id.to_owned(),
        domain: domain.to_owned(),
        state: OwnershipState::Pending,
    };
    infra::table::org_domain_ownership::save_org_domain_mapping(record).await
}

pub async fn delete_linked_domain(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    infra::table::org_domain_ownership::delete_linked_domain(org_id, domain).await?;
    let mut lock = CACHE.write().await;
    lock.remove(domain);
    Ok(())
}

pub async fn verify(mut record: Model) -> Result<i32, anyhow::Error> {
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
    )
    .await?;

    let state = res.verification_state;

    record.last_checked_at = res.last_checked_at;
    record.updated_at = res.updated_at;
    record.verification_state = res.verification_state;
    record.verification_failure_reason = res.verification_failure_reason;
    record.verified_at = res.verified_at;

    infra::table::org_domain_ownership::save_domain_org_record(record).await?;

    Ok(state)
}

pub async fn verify_domain_now(org_id: &str, domain: &str) -> Result<(), anyhow::Error> {
    let record = infra::table::org_domain_ownership::get_domain_org_record(org_id, domain).await?;
    let Some(record) = record else {
        return Err(anyhow::anyhow!(
            "no mapping for domain {domain} foung for org {org_id}"
        ));
    };

    if verify(record).await? == OwnershipState::Verfied as i32 {
        let mut lock = CACHE.write().await;
        lock.insert(domain.to_owned(), org_id.to_owned());
    }
    Ok(())
}

pub async fn update_state(org_id: &str, domain: &str, new_state: i32) -> Result<(), anyhow::Error> {
    let mut lock = CACHE.write().await;
    if new_state == OwnershipState::Verfied as i32 {
        lock.insert(domain.to_owned(), org_id.to_owned());
    } else {
        lock.remove(domain);
    }
    Ok(())
}

pub async fn get_domains_for_org(org_id: &str) -> Result<Vec<Model>, anyhow::Error> {
    let records = infra::table::org_domain_ownership::get_domains_for_org(org_id).await?;
    Ok(records)
}
