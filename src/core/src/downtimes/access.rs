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

use std::collections::HashSet;

use config::meta::{
    downtimes::{Downtime, DowntimeTarget, TargetFolders, TargetModule},
    folder::FolderType,
};
use o2_openfga::authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation};

use super::{
    DowntimeError,
    matching::{Inventory, Visibility},
};
use crate::auth::check_permissions;

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

/// The folders whose items the user may see, per folder type.
pub async fn visibility(org: &str, user_id: &str) -> Result<Visibility, DowntimeError> {
    Ok(Visibility {
        alert_folders: Some(listable_folders(org, user_id, FolderType::Alerts).await?),
        synthetics_folders: Some(listable_folders(org, user_id, FolderType::Synthetics).await?),
    })
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
    let object_type = match target.module {
        TargetModule::Synthetics => "synthetics",
        _ => "alerts",
    };
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
    use super::*;

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
