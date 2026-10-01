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

/// The downtime folders the user may list, for filtering the list endpoint.
pub async fn listable_downtime_folders(
    org: &str,
    user_id: &str,
) -> Result<HashSet<String>, DowntimeError> {
    listable_folders(org, user_id, FolderType::Downtimes).await
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
    let TargetFolders::Some { folder_ids } = &target.folders else {
        return Ok(());
    };
    let (folder_type, ofga_type) = folder_kind(target.module);
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
