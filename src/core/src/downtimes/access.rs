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

//! The extra rules for a feature that can silence what a user cannot see (WP6).

use std::{
    collections::{HashMap, HashSet},
    future::Future,
};

use config::meta::{
    downtimes::{Downtime, DowntimeTarget, TargetFolders, TargetModule},
    folder::FolderType,
};
use futures::{StreamExt, stream};
use o2_openfga::authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation};

use super::{
    DowntimeError,
    matching::{Inventory, Matches, Visibility},
};
use crate::auth::check_permissions;

#[derive(Clone, Copy)]
pub enum MatchOutput {
    Preview,
    Detail,
}

impl MatchOutput {
    fn cap(self) -> usize {
        match self {
            Self::Preview => super::matching::PREVIEW_CAP,
            Self::Detail => super::AFFECTED_CAP,
        }
    }
}

/// Get, update, cancel and delete are checked against the row's own folder.
pub async fn authorize_row(
    org: &str,
    user_id: &str,
    row: &Downtime,
    method: &str,
) -> Result<(), DowntimeError> {
    if check_permissions(
        &row.id,
        org,
        user_id,
        "downtimes",
        method,
        Some(&row.folder_id),
        false,
        true,
        false,
    )
    .await
    {
        Ok(())
    } else {
        Err(DowntimeError::Forbidden(format!(
            "You are not allowed to {} this downtime.",
            verb(method)
        )))
    }
}

/// Folders must exist and be listable; ids must exist, lie in the chosen folders and be readable.
pub async fn check_targets(
    org: &str,
    user_id: &str,
    targets: &[DowntimeTarget],
    inventory: &Inventory,
) -> Result<(), DowntimeError> {
    for target in targets {
        check_target_folders(org, user_id, target).await?;
        check_target_ids(org, user_id, target, inventory).await?;
    }
    Ok(())
}

/// GET checks preserve folder inheritance and individual grants regardless of list filtering.
pub async fn visibility(
    org: &str,
    user_id: &str,
    candidates: Vec<(TargetModule, &str, &str)>,
) -> Result<Visibility, DowntimeError> {
    if db::user::is_root_user(user_id) || !crate::authz::rbac_enforced().await {
        return Ok(Visibility::default());
    }
    Ok(readable_candidates(candidates, |module, id, folder_id| {
        can_read(org, user_id, module, id, folder_id)
    })
    .await)
}

pub async fn match_visibility(
    org: &str,
    user_id: &str,
    matches: &Matches,
    output: MatchOutput,
) -> Result<Visibility, DowntimeError> {
    if db::user::is_root_user(user_id) || !crate::authz::rbac_enforced().await {
        return Ok(Visibility::default());
    }
    Ok(readable_matches(matches, output, |module, id, folder_id| {
        can_read(org, user_id, module, id, folder_id)
    })
    .await)
}

/// The downtime folders the user may list; the list route is org-level, so each folder is checked.
pub async fn listable_downtime_folders(
    org: &str,
    user_id: &str,
) -> Result<HashSet<String>, DowntimeError> {
    let candidates = listable_folders(org, user_id, FolderType::Downtimes).await?;
    Ok(retain_listable_folders(org, user_id, candidates).await)
}

/// Of rows outside the listable folders, those granted one by one; one OpenFGA ListObjects call.
pub async fn individually_readable(
    org: &str,
    user_id: &str,
    rows: Vec<(String, String)>,
) -> HashSet<String> {
    if rows.is_empty() {
        return HashSet::new();
    }
    let ofga_type = get_ofga_type("downtimes");
    match crate::authz::list_objects_for_user(org, user_id, "GET_INDIVIDUAL_FROM_ROLE", &ofga_type)
        .await
    {
        Ok(Some(objects)) => granted_ids(&ofga_type, org, &objects, rows),
        // No list filtering configured: the per-row check the GET route runs decides.
        Ok(None) => {
            let checks = rows.into_iter().map(|(id, folder_id)| async move {
                check_permissions(
                    &id,
                    org,
                    user_id,
                    "downtimes",
                    "GET",
                    Some(&folder_id),
                    false,
                    true,
                    false,
                )
                .await
                .then_some(id)
            });
            futures::future::join_all(checks)
                .await
                .into_iter()
                .flatten()
                .collect()
        }
        Err(e) => {
            log::warn!("[downtimes] individual grants of {user_id} in {org} unreadable: {e}");
            HashSet::new()
        }
    }
}

/// Keeps the downtime folders the user may LIST, each checked on its own.
pub async fn retain_listable_folders(
    org: &str,
    user_id: &str,
    folder_ids: impl IntoIterator<Item = String>,
) -> HashSet<String> {
    let checks = folder_ids.into_iter().map(|folder_id| async move {
        check_permissions(
            &folder_id,
            org,
            user_id,
            "downtime_folders",
            "LIST",
            None,
            false,
            false,
            true,
        )
        .await
        .then_some(folder_id)
    });
    futures::future::join_all(checks)
        .await
        .into_iter()
        .flatten()
        .collect()
}

/// Moves the folder tuple; writing a tuple that exists fails, so an unchanged folder is skipped.
pub async fn reparent(id: &str, from: &str, to: &str) {
    if from == to || !o2_openfga::config::get_config().enabled {
        return;
    }
    let downtime = get_ofga_type("downtimes");
    let folder = get_ofga_type("downtime_folders");
    set_parent_relation(id, &downtime, to, &folder).await;
    remove_parent_relation(id, &downtime, from, &folder).await;
}

async fn can_read(org: &str, user_id: &str, module: TargetModule, id: &str, folder: &str) -> bool {
    check_permissions(
        id,
        org,
        user_id,
        resource_kind(module),
        "GET",
        Some(folder),
        false,
        true,
        false,
    )
    .await
}

async fn readable_matches<'a, F, Fut>(
    matches: &'a Matches,
    output: MatchOutput,
    check: F,
) -> Visibility
where
    F: Fn(TargetModule, &'a str, &'a str) -> Fut + Sync,
    Fut: Future<Output = bool> + Send,
{
    let mut checked = HashMap::new();
    for (module, list) in matches.output_lists(matches!(output, MatchOutput::Preview)) {
        let mut results = Vec::new();
        let mut found = 0;
        {
            let check = &check;
            let mut checks = stream::iter(list.iter().map(|item| {
                let id = item.id.as_str();
                let cached = checked.get(&(module, id)).copied();
                async move {
                    let permitted = match cached {
                        Some(permitted) => permitted,
                        None => check(module, id, &item.folder_id).await,
                    };
                    (id, permitted)
                }
            }))
            // Ordered completion keeps the first readable entries when checks finish out of order.
            .buffered(16)
            .boxed();
            while let Some((id, permitted)) = checks.next().await {
                results.push((id, permitted));
                found += usize::from(permitted);
                if found == output.cap() {
                    break;
                }
            }
        }
        checked.extend(
            results
                .into_iter()
                .map(|(id, permitted)| ((module, id), permitted)),
        );
    }
    let mut readable = HashMap::<_, HashSet<_>>::new();
    for ((module, id), permitted) in checked {
        if permitted {
            readable.entry(module).or_default().insert(id.to_string());
        }
    }
    Visibility {
        readable: Some(readable),
    }
}

async fn readable_candidates<'a, F, Fut>(
    candidates: Vec<(TargetModule, &'a str, &'a str)>,
    check: F,
) -> Visibility
where
    F: Fn(TargetModule, &'a str, &'a str) -> Fut + Sync,
    Fut: Future<Output = bool> + Send,
{
    let mut seen = HashSet::new();
    let mut checks = stream::iter(
        candidates
            .into_iter()
            .filter(|(module, id, _)| seen.insert((*module, *id)))
            .map(|(module, id, folder)| {
                let permitted = check(module, id, folder);
                async move { permitted.await.then_some((module, id.to_string())) }
            }),
    )
    .buffer_unordered(16)
    .boxed();
    let mut readable = std::collections::HashMap::<_, HashSet<_>>::new();
    while let Some(result) = checks.next().await {
        if let Some((module, id)) = result {
            readable.entry(module).or_default().insert(id);
        }
    }
    Visibility {
        readable: Some(readable),
    }
}

async fn listable_folders(
    org: &str,
    user_id: &str,
    folder_type: FolderType,
) -> Result<HashSet<String>, DowntimeError> {
    Ok(db::folders::list_folders(org, Some(user_id), folder_type)
        .await
        .map_err(|e| DowntimeError::Internal(e.to_string()))?
        .into_iter()
        .map(|f| f.folder_id)
        .collect())
}

async fn check_target_folders(
    org: &str,
    user_id: &str,
    target: &DowntimeTarget,
) -> Result<(), DowntimeError> {
    if !needs_folder_check(target) {
        return Ok(());
    }
    let (folder_type, ofga_type) = folder_kind(target.module);
    let TargetFolders::Some { folder_ids } = &target.folders else {
        // All needs the role-wide LIST grant on every folder of the module.
        let all = format!("_all_{org}");
        if check_permissions(
            &all, org, user_id, ofga_type, "LIST", None, false, false, false,
        )
        .await
        {
            return Ok(());
        }
        return Err(DowntimeError::Forbidden(all_folders_denied(target.module)));
    };
    for folder_id in folder_ids {
        if !infra::table::folders::exists(org, folder_id, folder_type).await? {
            return Err(DowntimeError::BadRequest(format!(
                "Folder {folder_id} does not exist for {}.",
                module_label(target.module)
            )));
        }
        if !check_permissions(
            folder_id, org, user_id, ofga_type, "LIST", None, false, false, true,
        )
        .await
        {
            return Err(DowntimeError::Forbidden(format!(
                "You cannot list folder {folder_id}, so you cannot silence it."
            )));
        }
    }
    Ok(())
}

async fn check_target_ids(
    org: &str,
    user_id: &str,
    target: &DowntimeTarget,
    inventory: &Inventory,
) -> Result<(), DowntimeError> {
    let object_type = resource_kind(target.module);
    for id in &target.ids {
        let Some(item) = inventory.find(target.module, id) else {
            return Err(DowntimeError::BadRequest(format!(
                "{id} is not one of the {} of this organization.",
                module_label(target.module)
            )));
        };
        if let TargetFolders::Some { folder_ids } = &target.folders
            && !folder_ids.contains(&item.folder_id)
        {
            return Err(DowntimeError::BadRequest(format!(
                "{id} is not in the chosen folders. Choose its folder or remove it."
            )));
        }
        if !check_permissions(
            id,
            org,
            user_id,
            object_type,
            "GET",
            Some(&item.folder_id),
            false,
            true,
            false,
        )
        .await
        {
            return Err(DowntimeError::Forbidden(format!(
                "You cannot read {id}, so you cannot mute it."
            )));
        }
    }
    Ok(())
}

fn resource_kind(module: TargetModule) -> &'static str {
    match module {
        TargetModule::Synthetics => "synthetics",
        _ => "alerts",
    }
}

/// Named ids narrow All to those items, and [check_target_ids] reads each of them.
fn needs_folder_check(target: &DowntimeTarget) -> bool {
    !matches!(target.folders, TargetFolders::All) || target.ids.is_empty()
}

/// The `(id, folder)` rows a ListObjects answer grants; a role-wide grant answers `_all_{org}`.
fn granted_ids(
    ofga_type: &str,
    org: &str,
    objects: &[String],
    rows: Vec<(String, String)>,
) -> HashSet<String> {
    let objects: HashSet<&str> = objects.iter().map(String::as_str).collect();
    let all = objects.contains(format!("{ofga_type}:_all_{org}").as_str());
    rows.into_iter()
        .map(|(id, _)| id)
        .filter(|id| all || objects.contains(format!("{ofga_type}:{id}").as_str()))
        .collect()
}

fn all_folders_denied(module: TargetModule) -> String {
    let folders = match module {
        TargetModule::Synthetics => "synthetics",
        _ => "alert",
    };
    format!("You cannot list every {folders} folder, so you cannot silence all of them.")
}

/// SLOs and anomaly detections live in alert folders and use the `alerts` resource.
fn folder_kind(module: TargetModule) -> (FolderType, &'static str) {
    match module {
        TargetModule::Synthetics => (FolderType::Synthetics, "synthetic_folder"),
        _ => (FolderType::Alerts, "alert_folders"),
    }
}

pub(super) fn module_label(module: TargetModule) -> &'static str {
    match module {
        TargetModule::Alerts => "alerts",
        TargetModule::AnomalyDetections => "anomaly detections",
        TargetModule::Synthetics => "synthetics checks",
        TargetModule::Slos => "SLOs",
    }
}

fn verb(method: &str) -> &'static str {
    match method {
        "GET" => "read",
        "DELETE" => "delete",
        _ => "change",
    }
}

#[cfg(test)]
mod tests {
    use super::{super::matching::Item, *};

    fn visibility_inventory() -> Inventory {
        let items = || {
            [
                ("hidden", "list-only"),
                ("individual", "list-only"),
                ("folder-read", "readable"),
            ]
            .map(|(id, folder)| Item {
                id: id.to_string(),
                name: format!("{id}-name"),
                folder_id: folder.to_string(),
                dims: std::collections::HashMap::from([("host".to_string(), format!("{id}-host"))]),
                ..Default::default()
            })
            .to_vec()
        };
        Inventory {
            alerts: items(),
            anomalies: items(),
            synthetics: items(),
            slos: items(),
        }
    }

    fn inventory_candidates(inventory: &Inventory) -> Vec<(TargetModule, &str, &str)> {
        [
            TargetModule::Alerts,
            TargetModule::AnomalyDetections,
            TargetModule::Synthetics,
            TargetModule::Slos,
        ]
        .into_iter()
        .flat_map(|module| {
            inventory
                .items(module)
                .iter()
                .map(move |item| (module, item.id.as_str(), item.folder_id.as_str()))
        })
        .collect()
    }

    #[tokio::test]
    async fn resource_reads_filter_every_preview_branch_affected_items_and_values() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use super::super::matching::{Matches, ModuleMatch, to_preview};

        let inventory = visibility_inventory();
        let module_match = |module| {
            let entries = inventory
                .items(module)
                .iter()
                .map(|item| config::meta::downtimes::PreviewMatch {
                    id: item.id.clone(),
                    name: item.name.clone(),
                    folder_id: item.folder_id.clone(),
                    matched_by: Some(format!("{}-metadata", item.id)),
                    missing: Some(format!("{}-dimension", item.id)),
                    applies: Some(true),
                })
                .collect::<Vec<_>>();
            ModuleMatch {
                matched: entries.clone(),
                at_fire_time: entries.clone(),
                undecidable: entries,
            }
        };
        let matches = Matches {
            alerts: module_match(TargetModule::Alerts),
            anomalies: module_match(TargetModule::AnomalyDetections),
            synthetics: module_match(TargetModule::Synthetics),
            slos: module_match(TargetModule::Slos),
        };
        let checks = AtomicUsize::new(0);
        let visibility = readable_matches(&matches, MatchOutput::Preview, |module, id, folder| {
            checks.fetch_add(1, Ordering::SeqCst);
            assert_eq!(
                resource_kind(module),
                if module == TargetModule::Synthetics {
                    "synthetics"
                } else {
                    "alerts"
                }
            );
            std::future::ready(folder == "readable" || id == "individual")
        })
        .await;
        assert_eq!(checks.load(Ordering::SeqCst), 12);
        let preview = to_preview(&matches, &visibility);
        assert_eq!(
            (
                preview.alerts_total,
                preview.anomalies_total,
                preview.synthetics_total,
                preview.slos_total
            ),
            (3, 3, 3, 3)
        );
        for entries in [
            &preview.alerts,
            &preview.anomalies,
            &preview.synthetics,
            &preview.slos,
            &preview.resolved_at_fire_time,
        ]
        .into_iter()
        .chain(preview.undecidable.values())
        {
            assert_eq!(
                entries
                    .iter()
                    .map(|entry| entry.id.as_str())
                    .collect::<Vec<_>>(),
                ["individual", "folder-read"]
            );
        }
        assert!(!serde_json::to_string(&preview).unwrap().contains("hidden"));
        let affected = super::super::affected(&matches, &visibility);
        assert!(!serde_json::to_string(&affected).unwrap().contains("hidden"));
        for entries in [
            &affected.alerts,
            &affected.anomalies,
            &affected.synthetics,
            &affected.slos,
            &affected.resolved_at_fire_time,
        ] {
            assert_eq!(entries.len(), 2);
        }
        let values = super::super::values::inventory_values(&inventory, &visibility, "host", &[]);
        assert_eq!(values.len(), 2);
        assert!(
            values
                .iter()
                .all(|value| value.items == 3 && !value.value.contains("hidden"))
        );
    }

    #[tokio::test]
    async fn readable_candidates_bounds_checks_and_keeps_modules_separate() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let mut inventory = visibility_inventory();
        inventory.alerts = (0..64)
            .map(|id| Item {
                id: id.to_string(),
                ..Default::default()
            })
            .collect();
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let visibility = readable_candidates(inventory_candidates(&inventory), |module, _, _| {
            let (active, peak) = (&active, &peak);
            async move {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(count, Ordering::SeqCst);
                tokio::task::yield_now().await;
                active.fetch_sub(1, Ordering::SeqCst);
                module == TargetModule::Slos
            }
        })
        .await;
        assert!(peak.load(Ordering::SeqCst) > 1);
        assert!(peak.load(Ordering::SeqCst) <= 16);
        assert!(visibility.sees(TargetModule::Slos, "individual"));
        assert!(!visibility.sees(TargetModule::AnomalyDetections, "individual"));
        assert!(!visibility.sees(TargetModule::Synthetics, "individual"));
        assert!(!visibility.sees(TargetModule::Slos, "unknown"));
    }

    #[tokio::test]
    async fn an_unrestricted_authorizer_keeps_all_inventory_items_visible() {
        let inventory = visibility_inventory();
        let visibility = readable_candidates(inventory_candidates(&inventory), |_, _, _| {
            std::future::ready(true)
        })
        .await;
        for module in [
            TargetModule::Alerts,
            TargetModule::AnomalyDetections,
            TargetModule::Synthetics,
            TargetModule::Slos,
        ] {
            assert!(
                inventory
                    .items(module)
                    .iter()
                    .all(|item| visibility.sees(module, &item.id))
            );
        }
    }

    fn preview_entries(prefix: &str, count: usize) -> Vec<config::meta::downtimes::PreviewMatch> {
        (0..count)
            .map(|i| config::meta::downtimes::PreviewMatch {
                id: format!("{prefix}:{i}"),
                name: format!("{prefix}-{i}"),
                folder_id: "parent".to_string(),
                matched_by: None,
                missing: None,
                applies: None,
            })
            .collect()
    }

    fn volume_matches(count: usize) -> Matches {
        use super::super::matching::ModuleMatch;

        Matches {
            alerts: ModuleMatch {
                matched: preview_entries("alerts", count),
                at_fire_time: preview_entries("fire", count),
                undecidable: preview_entries("unknown-alert", count),
            },
            anomalies: ModuleMatch {
                matched: preview_entries("anomalies", count),
                undecidable: preview_entries("unknown-anomaly", count),
                ..Default::default()
            },
            synthetics: ModuleMatch {
                matched: preview_entries("synthetics", count),
                ..Default::default()
            },
            slos: ModuleMatch {
                matched: preview_entries("slos", count),
                undecidable: preview_entries("unknown-slo", count),
                ..Default::default()
            },
        }
    }

    #[tokio::test]
    async fn preview_stops_authorizing_ten_thousand_readable_matches_per_list() {
        let matches = volume_matches(10_000);
        let calls = std::sync::Mutex::new(HashMap::<String, usize>::new());
        let visibility = readable_matches(&matches, MatchOutput::Preview, |_, id, folder| {
            assert_eq!(folder, "parent");
            let prefix = id.split_once(':').unwrap().0;
            *calls.lock().unwrap().entry(prefix.to_string()).or_default() += 1;
            std::future::ready(true)
        })
        .await;
        assert_eq!(calls.lock().unwrap().len(), 8);
        for calls in calls.lock().unwrap().values() {
            assert!((50..=65).contains(calls), "preview callback count: {calls}");
        }
        let preview = super::super::matching::to_preview(&matches, &visibility);
        assert_eq!(preview.alerts_total, 10_000);
        assert_eq!(preview.anomalies_total, 10_000);
        assert_eq!(preview.synthetics_total, 10_000);
        assert_eq!(preview.slos_total, 10_000);
        for (module, list) in matches.output_lists(true) {
            let visible: Vec<_> = list
                .iter()
                .filter(|entry| visibility.sees(module, &entry.id))
                .collect();
            assert_eq!(visible.len(), 50);
            assert_eq!(visible.first().unwrap().id, list[0].id);
            assert_eq!(visible.last().unwrap().id, list[49].id);
        }
    }

    #[tokio::test]
    async fn detail_stops_authorizing_ten_thousand_readable_matches_per_returned_list() {
        let matches = volume_matches(10_000);
        let calls = std::sync::Mutex::new(HashMap::<String, usize>::new());
        let visibility = readable_matches(&matches, MatchOutput::Detail, |_, id, _| {
            let prefix = id.split_once(':').unwrap().0;
            *calls.lock().unwrap().entry(prefix.to_string()).or_default() += 1;
            std::future::ready(true)
        })
        .await;
        assert_eq!(calls.lock().unwrap().len(), 5);
        for calls in calls.lock().unwrap().values() {
            assert!(
                (500..=515).contains(calls),
                "detail callback count: {calls}"
            );
        }
        let affected = super::super::affected(&matches, &visibility);
        for list in [
            &affected.alerts,
            &affected.anomalies,
            &affected.synthetics,
            &affected.slos,
            &affected.resolved_at_fire_time,
        ] {
            assert_eq!(list.len(), 500);
            assert!(list[0].id.ends_with(":0"));
            assert!(list[499].id.ends_with(":499"));
        }
    }

    #[tokio::test]
    async fn capped_visibility_scans_a_denied_prefix_and_exhausts_all_denied_lists() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let mut matches = volume_matches(0);
        matches.alerts.matched = preview_entries("alerts", 10_000);
        matches.slos.matched = preview_entries("denied", 200);
        let calls = AtomicUsize::new(0);
        let visibility = readable_matches(&matches, MatchOutput::Preview, |module, id, _| {
            calls.fetch_add(1, Ordering::SeqCst);
            let index: usize = id.split_once(':').unwrap().1.parse().unwrap();
            std::future::ready(module == TargetModule::Alerts && index >= 9_000)
        })
        .await;
        let preview = super::super::matching::to_preview(&matches, &visibility);
        assert_eq!(preview.alerts.len(), 50);
        assert_eq!(preview.alerts[0].id, "alerts:9000");
        assert_eq!(preview.alerts[49].id, "alerts:9049");
        assert_eq!(preview.alerts_total, 10_000);
        assert!(preview.slos.is_empty());
        assert_eq!(preview.slos_total, 200);
        assert!((9_250..=9_265).contains(&calls.load(Ordering::SeqCst)));
    }

    #[tokio::test]
    async fn capped_visibility_preserves_order_and_module_isolation_with_out_of_order_checks() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let mut matches = volume_matches(0);
        matches.alerts.matched = preview_entries("shared", 200);
        matches.slos.matched = matches.alerts.matched.clone();
        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let completed = std::sync::Mutex::new(Vec::new());
        let visibility = readable_matches(&matches, MatchOutput::Preview, |module, id, folder| {
            let (active, peak, completed) = (&active, &peak, &completed);
            async move {
                assert_eq!(folder, "parent");
                let index: usize = id.split_once(':').unwrap().1.parse().unwrap();
                struct InFlight<'a>(&'a AtomicUsize);
                impl Drop for InFlight<'_> {
                    fn drop(&mut self) {
                        self.0.fetch_sub(1, Ordering::SeqCst);
                    }
                }
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                let _in_flight = InFlight(active);
                peak.fetch_max(count, Ordering::SeqCst);
                for _ in 0..(16 - index % 16) {
                    tokio::task::yield_now().await;
                }
                completed.lock().unwrap().push((module, index));
                module == TargetModule::Alerts && (index == 0 || index % 2 == 1)
            }
        })
        .await;
        let preview = super::super::matching::to_preview(&matches, &visibility);
        let expected: Vec<_> = std::iter::once(0)
            .chain((1..200).step_by(2))
            .take(50)
            .map(|i| format!("shared:{i}"))
            .collect();
        assert_eq!(
            preview
                .alerts
                .iter()
                .map(|entry| &entry.id)
                .collect::<Vec<_>>(),
            expected.iter().collect::<Vec<_>>()
        );
        assert_eq!(preview.alerts_total, 200);
        assert_eq!(preview.slos_total, 200);
        assert!(preview.slos.is_empty());
        assert_ne!(completed.lock().unwrap()[0].1, 0);
        assert!((2..=16).contains(&peak.load(Ordering::SeqCst)));
    }

    #[tokio::test]
    async fn preview_matched_fire_time_and_undecidable_quotas_are_independent() {
        let mut matches = volume_matches(100);
        matches.alerts.at_fire_time = preview_entries("fire", 180);
        let visibility = readable_matches(&matches, MatchOutput::Preview, |_, id, _| {
            let (prefix, index) = id.split_once(':').unwrap();
            let index: usize = index.parse().unwrap();
            std::future::ready(prefix != "fire" || index >= 100)
        })
        .await;
        let preview = super::super::matching::to_preview(&matches, &visibility);
        assert_eq!(preview.alerts.len(), 50);
        assert_eq!(preview.resolved_at_fire_time.len(), 50);
        assert_eq!(preview.resolved_at_fire_time[0].id, "fire:100");
        assert_eq!(preview.undecidable.len(), 3);
        assert!(preview.undecidable.values().all(|list| list.len() == 50));
    }

    #[tokio::test]
    async fn detail_never_authorizes_undecidable_or_non_alert_fire_time_entries() {
        let mut matches = volume_matches(0);
        matches.alerts.undecidable = preview_entries("unknown-alert", 10_000);
        matches.anomalies.undecidable = preview_entries("unknown-anomaly", 10_000);
        matches.slos.undecidable = preview_entries("unknown-slo", 10_000);
        matches.synthetics.undecidable = preview_entries("unknown-synthetic", 10_000);
        matches.anomalies.at_fire_time = preview_entries("unused-fire", 10_000);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let visibility = readable_matches(&matches, MatchOutput::Detail, |_, _, _| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            std::future::ready(true)
        })
        .await;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        let affected = super::super::affected(&matches, &visibility);
        assert!(affected.alerts.is_empty());
        assert!(affected.resolved_at_fire_time.is_empty());
    }

    #[tokio::test]
    async fn dimension_suggestion_authorization_keeps_complete_readable_counts() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let inventory = Inventory {
            alerts: (0..10_000)
                .map(|i| Item {
                    id: i.to_string(),
                    folder_id: "parent".to_string(),
                    dims: HashMap::from([("host".to_string(), "shared-host".to_string())]),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        let calls = AtomicUsize::new(0);
        let visibility = readable_candidates(inventory_candidates(&inventory), |_, id, _| {
            calls.fetch_add(1, Ordering::SeqCst);
            std::future::ready(id.parse::<usize>().unwrap() % 2 == 0)
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 10_000);
        let values = super::super::values::inventory_values(&inventory, &visibility, "host", &[]);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].items, 5_000);
    }

    fn rows() -> Vec<(String, String)> {
        [("d1", "ops"), ("d2", "ops"), ("d3", "db")]
            .map(|(id, folder)| (id.to_string(), folder.to_string()))
            .to_vec()
    }

    #[test]
    fn a_single_downtime_grant_lists_only_that_row() {
        let objects = ["downtime:d2".to_string()];
        let granted = granted_ids("downtime", "acme", &objects, rows());
        assert_eq!(granted, HashSet::from(["d2".to_string()]));
    }

    #[test]
    fn all_folders_without_the_org_wide_list_right_names_the_folders_it_needs() {
        assert_eq!(
            all_folders_denied(TargetModule::Alerts),
            "You cannot list every alert folder, so you cannot silence all of them."
        );
        assert_eq!(
            all_folders_denied(TargetModule::Slos),
            all_folders_denied(TargetModule::AnomalyDetections)
        );
        assert_eq!(
            all_folders_denied(TargetModule::Synthetics),
            "You cannot list every synthetics folder, so you cannot silence all of them."
        );
    }

    fn target(folders: TargetFolders, ids: &[&str]) -> DowntimeTarget {
        DowntimeTarget {
            module: TargetModule::Alerts,
            folders,
            tags: vec![],
            ids: ids.iter().map(|id| id.to_string()).collect(),
            slo_mode: None,
            incident_mode: Default::default(),
        }
    }

    #[test]
    fn a_quick_mute_of_named_ids_needs_no_org_wide_list() {
        assert!(!needs_folder_check(&target(TargetFolders::All, &["a1"])));
        assert!(needs_folder_check(&target(TargetFolders::All, &[])));
        let some = TargetFolders::Some {
            folder_ids: vec!["ops".to_string()],
        };
        assert!(needs_folder_check(&target(some.clone(), &[])));
        assert!(needs_folder_check(&target(some, &["a1"])));
    }

    #[test]
    fn a_role_wide_grant_lists_every_row_and_none_lists_nothing() {
        let all = ["downtime:_all_acme".to_string()];
        assert_eq!(granted_ids("downtime", "acme", &all, rows()).len(), 3);
        let other_org = ["downtime:_all_other".to_string()];
        assert!(granted_ids("downtime", "acme", &other_org, rows()).is_empty());
        assert!(granted_ids("downtime", "acme", &[], rows()).is_empty());
    }
}
