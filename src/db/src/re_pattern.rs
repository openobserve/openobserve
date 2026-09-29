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

use std::sync::Arc;

use config::meta::stream::{PatternAssociation, StreamType, UpdateSettingsWrapper};
use infra::{
    coordinator::get_coordinator,
    db::Event,
    errors,
    table::{
        re_pattern::PatternEntry,
        re_pattern_stream_map::{ApplyPolicy, PatternAssociationEntry, PatternPolicy},
    },
};
use o2_enterprise::enterprise::re_patterns::get_pattern_manager;

// DBKey to set patterns
pub const RE_PATTERN_PREFIX: &str = "/re_patterns/";
// DBKey to set re_pattern_associations
pub const RE_PATTERN_ASSOCIATIONS_PREFIX: &str = "/re_pattern_associations/";

pub async fn add(entry: PatternEntry) -> Result<PatternEntry, anyhow::Error> {
    match infra::table::re_pattern::add(entry.clone()).await {
        Ok(_) => {}
        Err(errors::Error::DbError(errors::DbError::UniqueViolation)) => {
            return Err(anyhow::anyhow!(
                "Pattern with given id/name already exists in the org"
            ));
        }
        Err(e) => {
            log::error!("error while saving pattern to db : {e}");
            return Err(anyhow::anyhow!(e));
        }
    }

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            &format!("{RE_PATTERN_PREFIX}{}", entry.id),
            bytes::Bytes::new(), // no actual data, the receiver can query the db
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::patterns_put(entry.clone()).await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent pattern add notification to super cluster queue for {}/{}",
                        entry.org,
                        entry.name
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending pattern add notification to super cluster queue for {}/{} : {e}",
                        entry.org,
                        entry.name
                    );
                }
            }
        }
    }
    Ok(entry)
}

pub async fn update(id: &str, new_pattern: &str) -> Result<(), errors::Error> {
    infra::table::re_pattern::update_pattern(id, new_pattern).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            &format!("{RE_PATTERN_PREFIX}{id}"),
            bytes::Bytes::new(), // no actual data, the receiver can query the db
            true,
            None,
        )
        .await?;
    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::patterns_update(id, new_pattern)
                .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent pattern update notification to super cluster queue for {id}",
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending pattern update notification to super cluster queue for {id} : {e}",
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn remove(pattern_id: &str) -> Result<(), errors::Error> {
    infra::table::re_pattern::remove(pattern_id).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .delete(
            &format!("{RE_PATTERN_PREFIX}{pattern_id}"),
            false,
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::pattern_delete(pattern_id).await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent pattern delete notification to super cluster queue for {pattern_id}"
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending pattern delete notification to super cluster queue for {pattern_id} : {e}"
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn process_association_changes(
    org: &str,
    stream: &str,
    stype: StreamType,
    update: UpdateSettingsWrapper<PatternAssociation>,
) -> Result<(), errors::Error> {
    if update.add.is_empty() && update.remove.is_empty() {
        return Ok(());
    }

    validate_associations_to_add(org, stream, stype, &update.add)?;

    let mgr = get_pattern_manager().await?;

    // An unknown id is caller input, so it must not surface as a server error.
    for item in update.add.iter().chain(&update.remove) {
        if !mgr.check_pattern_exists(&item.pattern_id) {
            return Err(errors::Error::ErrorCode(errors::ErrorCodes::InvalidParams(
                format!("pattern with id {} not found", item.pattern_id),
            )));
        }
    }

    // update the node itself
    mgr.update_associations(
        org,
        stype,
        stream,
        update.remove.clone(),
        update.add.clone(),
    )?;

    let serialized = serde_json::to_vec(&update)?;
    let added = update
        .add
        .into_iter()
        .map(|item| PatternAssociationEntry {
            id: 0,
            org: org.to_string(),
            stream: stream.to_string(),
            stream_type: stype,
            field: item.field,
            pattern_id: item.pattern_id,
            policy: PatternPolicy::from(&item.policy),
            policy_repr: Some(item.policy),
            apply_at: ApplyPolicy::from(item.apply_at),
        })
        .collect();
    let removed = update
        .remove
        .into_iter()
        .map(|item| PatternAssociationEntry {
            id: 0,
            org: org.to_string(),
            stream: stream.to_string(),
            stream_type: stype,
            field: item.field,
            pattern_id: item.pattern_id,
            policy: PatternPolicy::from(&item.policy),
            policy_repr: Some(item.policy),
            apply_at: ApplyPolicy::from(item.apply_at),
        })
        .collect();

    infra::table::re_pattern_stream_map::batch_process(added, removed).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            &format!("{RE_PATTERN_ASSOCIATIONS_PREFIX}{org}/{stype}/{stream}",),
            bytes::Bytes::from_owner(serialized.clone()),
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::pattern_associations_update(
                org, stype, stream, serialized,
            )
            .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent association update notification to super cluster queue for {org}/{stype}/{stream}",
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending association update notification to super cluster queue for {org}/{stype}/{stream} : {e}",
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn remove_stream_associations_after_deletion(
    org: &str,
    stream: &str,
    stype: StreamType,
) -> Result<(), anyhow::Error> {
    let mgr = get_pattern_manager().await?;
    mgr.remove_stream_associations(org, stype, stream);

    infra::table::re_pattern_stream_map::remove_associations_by_stream(org, stream, stype).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .delete(
            &format!("{RE_PATTERN_ASSOCIATIONS_PREFIX}{org}/{stype}/{stream}",),
            false,
            true,
            None,
        )
        .await?;
    // we do not need to trigger for super cluster, because the stream deletion handler
    // for super cluster takes care of calling this function
    Ok(())
}

pub async fn watch_patterns() -> Result<(), anyhow::Error> {
    let prefix = RE_PATTERN_PREFIX;
    let cluster_coordinator = get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching re_patterns");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_re_patterns: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let pattern_id = ev.key.strip_prefix(prefix).unwrap();
                let new_pattern = match infra::table::re_pattern::get(pattern_id).await {
                    Ok(Some(val)) => val,
                    Ok(None) => {
                        log::error!("unexpected missing pattern for id {pattern_id}");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting value: {e}");
                        continue;
                    }
                };
                let mgr = get_pattern_manager().await?;
                if mgr.check_pattern_exists(&new_pattern.id) {
                    mgr.update_pattern(new_pattern.id, new_pattern.pattern)?;
                } else {
                    mgr.insert_pattern(new_pattern);
                }
            }
            Event::Delete(ev) => {
                let pattern_id = ev.key.strip_prefix(prefix).unwrap();
                let mgr = get_pattern_manager().await?;
                mgr.remove_pattern(pattern_id);
            }
            Event::Empty => {}
        }
    }
}

pub async fn watch_pattern_associations() -> Result<(), anyhow::Error> {
    let prefix = RE_PATTERN_ASSOCIATIONS_PREFIX;
    let cluster_coordinator = get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching re_pattern_associations");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_re_pattern_associations: event channel closed");
                return Ok(());
            }
        };

        // there is no separate delete event for associations,
        // everything is notified via put event only

        match ev {
            Event::Put(ev) => {
                let combo = ev.key.strip_prefix(prefix).unwrap();
                let splits = combo.split('/').collect::<Vec<_>>();
                let org = splits[0];
                let stype = StreamType::from(splits[1]);
                let stream = splits[2];

                let v = match ev.value.as_ref() {
                    Some(v) => v,
                    None => {
                        log::error!(
                            "expected value with pattern association message, found none, event : {ev:?}"
                        );
                        continue;
                    }
                };

                let mut updates: UpdateSettingsWrapper<PatternAssociation> =
                    match serde_json::from_slice(v) {
                        Ok(v) => v,
                        Err(e) => {
                            log::error!(
                                "error deserializing pattern association message : error: {e} event: {ev:?}"
                            );
                            continue;
                        }
                    };

                degrade_unsupported_policies(org, stream, stype, &mut updates.add);

                let mgr = get_pattern_manager().await?;
                mgr.update_associations(org, stype, stream, updates.remove, updates.add)?;
            }
            Event::Delete(ev) => {
                let combo = ev.key.strip_prefix(prefix).unwrap();
                let splits = combo.split('/').collect::<Vec<_>>();
                let org = splits[0];
                let stype = StreamType::from(splits[1]);
                let stream = splits[2];

                let mgr = get_pattern_manager().await?;
                mgr.remove_stream_associations(org, stype, stream);
            }
            _ => {}
        }
    }
}

/// Add-list only: rejecting a remove would strand a bad row, and an edit is a remove plus an add.
fn validate_associations_to_add(
    org: &str,
    stream: &str,
    stype: StreamType,
    add: &[PatternAssociation],
) -> Result<(), errors::Error> {
    for item in add.iter() {
        let policy = PatternPolicy::parse_strict(&item.policy).map_err(|e| {
            errors::Error::ErrorCode(errors::ErrorCodes::InvalidParams(format!(
                "invalid policy for field {}: {e}",
                item.field
            )))
        })?;
        ApplyPolicy::parse_strict(&item.apply_at).map_err(|e| {
            errors::Error::ErrorCode(errors::ErrorCodes::InvalidParams(format!(
                "invalid apply_at for field {}: {e}",
                item.field
            )))
        })?;
        if policy == PatternPolicy::Detect {
            log::warn!(
                "[SDR] accepting Detect association for {org}/{stype}/{stream} field {} pattern {}; this propagates cluster-wide and a node predating Detect will stop redacting this field",
                item.field,
                item.pattern_id
            );
        }
    }
    Ok(())
}

/// The row already exists in the DB, so refusing it would only leave this node's map stale.
pub fn degrade_unsupported_policies(
    org: &str,
    stream: &str,
    stype: StreamType,
    add: &mut [PatternAssociation],
) {
    for item in add.iter_mut() {
        if !PatternPolicy::is_recognised(&item.policy) {
            log::error!(
                "[SDR] replicated association {org}/{stype}/{stream} field {} pattern {} carries policy {:?}, which this build cannot decode; degrading it to Detect, so this field is counted but NOT redacted on this node",
                item.field,
                item.pattern_id,
                item.policy
            );
            item.policy = PatternPolicy::Detect.to_string();
        } else if item.policy == PatternPolicy::Detect.to_string()
            && !config::get_config().common.sdr_detect_policy_enabled
        {
            log::warn!(
                "[SDR] replicated association {org}/{stype}/{stream} field {} pattern {} uses Detect while ZO_SDR_DETECT_POLICY_ENABLED is false here; the flag gates authoring only, so this node honours it as count-only",
                item.field,
                item.pattern_id
            );
        }
        if let Err(e) = ApplyPolicy::parse_strict(&item.apply_at) {
            log::error!(
                "[SDR] replicated association {org}/{stype}/{stream} field {} pattern {} carries apply_at {e}; applying it at ingestion",
                item.field,
                item.pattern_id
            );
            item.apply_at = ApplyPolicy::AtIngestion.to_string();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_re_pattern_prefix_value() {
        assert_eq!(RE_PATTERN_PREFIX, "/re_patterns/");
    }

    #[test]
    fn test_re_pattern_associations_prefix_value() {
        assert_eq!(RE_PATTERN_ASSOCIATIONS_PREFIX, "/re_pattern_associations/");
    }

    #[test]
    fn test_prefixes_are_distinct() {
        assert_ne!(RE_PATTERN_PREFIX, RE_PATTERN_ASSOCIATIONS_PREFIX);
    }

    fn association(policy: &str, apply_at: &str) -> PatternAssociation {
        PatternAssociation {
            field: "message".to_string(),
            pattern_name: "card".to_string(),
            description: String::new(),
            pattern: "[0-9]{16}".to_string(),
            pattern_id: "p1".to_string(),
            policy: policy.to_string(),
            apply_at: apply_at.to_string(),
        }
    }

    #[test]
    fn a_replicated_undecodable_policy_is_degraded_before_it_reaches_the_manager() {
        let mut add = vec![association("SomeFuturePolicy", "AtIngestion")];
        degrade_unsupported_policies("org", "logs", StreamType::Logs, &mut add);
        assert_eq!(add[0].policy, "Detect");
        assert_ne!(add[0].policy, "Redact");
    }

    #[test]
    fn a_replicated_supported_policy_is_passed_through_untouched() {
        for policy in ["DropField", "Redact", "Hash", "Detect"] {
            let mut add = vec![association(policy, "Both")];
            degrade_unsupported_policies("org", "logs", StreamType::Logs, &mut add);
            assert_eq!(add[0].policy, policy);
            assert_eq!(add[0].apply_at, "Both");
        }
    }

    #[test]
    fn a_replicated_undecodable_apply_at_falls_back_to_ingestion() {
        let mut add = vec![association("Redact", "SomeFutureTime")];
        degrade_unsupported_policies("org", "logs", StreamType::Logs, &mut add);
        assert_eq!(add[0].apply_at, "AtIngestion");
        assert_eq!(add[0].policy, "Redact");
    }
}
