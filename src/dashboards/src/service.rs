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

use axum::response::Response;
use common::{
    meta::{authz::Authz, http::HttpResponse as MetaHttpResponse},
    system_settings,
    utils::auth::{remove_ownership, set_ownership},
};
use config::{
    TIMESTAMP_COL_NAME, ider,
    meta::{
        dashboards::{Dashboard, ListDashboardsParams, v8},
        folder::{DEFAULT_FOLDER, Folder, FolderType},
        stream::{DistinctField, StreamType},
        system_settings::SettingScope,
    },
    utils::time::now_micros,
};
use futures::future::join_all;
use hashbrown::HashMap;
use infra::{
    schema::get_stream_setting_fts_fields,
    table::{
        self,
        distinct_values::{DistinctFieldRecord, OriginType},
    },
};

use crate::{DASHBOARD_ID_TO_ORG, distinct_values};

/// Org-setting key holding the "pin dashboard to Home" snapshot
/// (`{ dashboardId, folderId, label }`). Kept in sync when the pinned
/// dashboard is moved or deleted so the pin never goes stale.
const HOME_DASHBOARD_SETTING_KEY: &str = "home_dashboard";

#[cfg(feature = "enterprise")]
use common::utils::auth::check_permissions;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
#[cfg(feature = "enterprise")]
use o2_openfga::{
    authorizer::authz::{get_ofga_type, remove_parent_relation, set_parent_relation},
    config::get_config as get_openfga_config,
};

/// An error that occurs interacting with dashboards.
#[derive(Debug, thiserror::Error)]
pub enum DashboardError {
    /// An error that occurs while interacting with the database through the
    /// [infra] crate.
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),

    /// Error that occurs when trying to access a dashboard that cannot be
    /// found.
    #[error("dashboard not found")]
    DashboardNotFound,

    /// Error that occurs when trying to update a dashboard using a missing hash
    /// value or a hash value that cannot be parsed as an [i64].
    #[error("tried to update dashboard using hash that cannot be parsed")]
    UpdateMissingHash,

    /// Error that occurs when trying to update a dashboard using a stale hash.
    /// This occurs when the two clients attempt to update the dashboard
    /// concurrently.
    #[error("tried to update dashboard using conflicting hash")]
    UpdateConflictingHash,

    /// Error that occurs when trying to create an update a dashboard but not
    /// title is provided.
    #[error("dashboard cannot have empty title")]
    PutMissingTitle,

    /// Error that occurs when trying to move a dashboard but either the source
    /// or destination folder is not specified.
    #[error("missing source or destination folder for dashboard move")]
    MoveMissingFolderParam,

    /// Error that occurs when trying to move a dashboard but either the source
    /// or destination folder is not specified.
    #[error("error deleting the dashboard {0} from old folder {1} : {2}")]
    MoveDashboardDeleteOld(String, String, String),

    /// Error that occurs when trying to move a dashboard to a destination
    /// folder that cannot be found.
    #[error("error moving dashboard to folder that cannot be found")]
    MoveDestinationFolderNotFound,

    /// Error that occurs when trying to create a dashboard in a folder that
    /// cannot be found.
    #[error("error creating dashboard in folder that cannot be found")]
    CreateFolderNotFound,

    /// Error that occurs when trying to create a destination folder for a new
    /// dashboard.
    #[error("error creating default folder")]
    CreateDefaultFolder,

    /// Error that occurs when updating the distinct values using the
    /// dashboard variables
    #[error("error in updating distinct values")]
    DistinctValueError,

    /// Error that occurs when the user making the api call is not found.
    #[error("user not found")]
    UserNotFound,

    /// Error that occurs when trying to get the list of dashboards that a user is permitted to
    /// get.
    #[error(transparent)]
    ListPermittedDashboardsError(anyhow::Error),

    #[error("Permission denied")]
    PermissionDenied,

    #[error("panel operations are only supported for v8 dashboards")]
    PanelUnsupportedVersion,

    #[error("tab not found: {0}")]
    TabNotFound(String),

    #[error("panel not found: {0}")]
    PanelNotFound(String),

    #[error("panel with id {0} already exists in tab {1}")]
    PanelAlreadyExists(String, String),
}

impl From<DashboardError> for Response {
    fn from(value: DashboardError) -> Self {
        match value {
            DashboardError::InfraError(err) => MetaHttpResponse::internal_error(err),
            DashboardError::DashboardNotFound => MetaHttpResponse::not_found("Dashboard not found"),
            DashboardError::UpdateMissingHash => MetaHttpResponse::internal_error(
                "Request to update existing dashboard with missing or invalid hash value. BUG",
            ),
            DashboardError::UpdateConflictingHash => MetaHttpResponse::conflict(
                "Conflict: Failed to save due to concurrent changes. Please refresh the page after backing up your work to avoid losing changes.",
            ),
            DashboardError::PutMissingTitle => {
                MetaHttpResponse::internal_error("Dashboard should have title")
            }
            DashboardError::MoveMissingFolderParam => MetaHttpResponse::bad_request(
                "Please specify from & to folder from dashboard movement",
            ),
            DashboardError::MoveDestinationFolderNotFound
            | DashboardError::CreateFolderNotFound => {
                MetaHttpResponse::not_found("Folder not found")
            }
            DashboardError::CreateDefaultFolder => {
                MetaHttpResponse::internal_error("Error saving default folder")
            }
            DashboardError::DistinctValueError => {
                MetaHttpResponse::internal_error("Error in updating distinct values")
            }
            DashboardError::MoveDashboardDeleteOld(dashboard_id, folder_id, error) => {
                MetaHttpResponse::internal_error(format!(
                    "error deleting the dashboard {dashboard_id} from old folder {folder_id} : {error}"
                ))
            }
            DashboardError::ListPermittedDashboardsError(err) => MetaHttpResponse::forbidden(err),
            DashboardError::UserNotFound => MetaHttpResponse::unauthorized("User not found"),
            DashboardError::PermissionDenied => MetaHttpResponse::forbidden("Permission denied"),
            DashboardError::PanelUnsupportedVersion => MetaHttpResponse::bad_request(
                "Panel operations are only supported for v8 dashboards",
            ),
            DashboardError::TabNotFound(tab_id) => {
                MetaHttpResponse::not_found(format!("Tab not found: {tab_id}"))
            }
            DashboardError::PanelNotFound(panel_id) => {
                MetaHttpResponse::not_found(format!("Panel not found: {panel_id}"))
            }
            DashboardError::PanelAlreadyExists(panel_id, tab_id) => MetaHttpResponse::conflict(
                format!("Panel with id {panel_id} already exists in tab {tab_id}"),
            ),
        }
    }
}

async fn add_distinct_field_entry(
    dashboard_id: &str,
    org: &str,
    stream: &str,
    stype: String,
    field: &str,
) -> Result<(), anyhow::Error> {
    log::info!(
        "adding distinct field {stype} {org}/{stream} : {field} for dashboard {dashboard_id}"
    );
    let record = DistinctFieldRecord::new(
        OriginType::Dashboard,
        dashboard_id,
        org,
        stream,
        stype,
        field,
    );
    distinct_values::add(record)
        .await
        .map_err(|e| anyhow::anyhow!("error in adding distinct value record : {e}"))
}

async fn remove_distinct_field_entry(
    dashboard_id: &str,
    org: &str,
    stream: &str,
    stype: String,
    field: &str,
) -> Result<(), anyhow::Error> {
    log::info!(
        "removing distinct field {stype} {org}/{stream} : {field} for dashboard {dashboard_id}"
    );
    let record = DistinctFieldRecord::new(
        OriginType::Dashboard,
        dashboard_id,
        org,
        stream,
        stype,
        field,
    );
    distinct_values::remove(record)
        .await
        .map_err(|e| anyhow::anyhow!("error in removing distinct value record : {e}"))
}

async fn update_distinct_variables(
    org_id: &str,
    old_dash: Option<Dashboard>,
    new_dash: &Dashboard,
) -> Result<(), anyhow::Error> {
    let mut old_variables = get_query_variables(old_dash.as_ref());
    let new_variables = get_query_variables(Some(new_dash));

    let dashboard_id = new_dash.dashboard_id().unwrap();

    if !new_variables.is_empty() {
        for ((name, typ), fields) in new_variables.into_iter() {
            let mut stream_settings = infra::schema::get_settings(org_id, &name, typ)
                .await
                .unwrap_or_default();
            // we only store distinct values for logs and traces -
            // if anything else, we can ignore.
            if !matches!(typ, StreamType::Logs | StreamType::Traces) {
                continue;
            }
            // get entry from previous variables corresponding to this stream
            let old_fields = old_variables
                .remove(&(name.to_owned(), typ))
                .unwrap_or_default();
            let mut _new_added = false;

            let _fts = get_stream_setting_fts_fields(&Some(stream_settings.clone()));
            for f in fields.iter() {
                // we ignore full text search no matter what
                if _fts.contains(f) {
                    continue;
                }

                if f == "count" || f == TIMESTAMP_COL_NAME {
                    // these are reserved fields
                    continue;
                }
                // we add entry for all the fields, because we need mappings for each individual
                // origin-stream-field mapping. The duplicates are handled in add function, so
                // we can call it for each field without issues
                add_distinct_field_entry(dashboard_id, org_id, &name, typ.to_string(), f).await?;
                let _temp = DistinctField {
                    name: f.to_owned(),
                    added_ts: now_micros(),
                };
                if !stream_settings.distinct_value_fields.contains(&_temp) {
                    stream_settings.distinct_value_fields.push(_temp);
                    _new_added = true;
                }
            }
            // here we check if any of the fields used in previous version are no longer used
            // if so, remove their entry.
            for f in old_fields {
                if !fields.contains(&f) {
                    remove_distinct_field_entry(dashboard_id, org_id, &name, typ.to_string(), &f)
                        .await?;
                }
            }
            if _new_added {
                openobserve_catalog::schema::save_distinct_value_fields(
                    org_id,
                    &name,
                    typ,
                    stream_settings,
                )
                .await?;
            }
        }

        // finally, whatever stream remains in the old variables
        // it has all corresponding fields removed, so remove those as well
        for ((name, typ), fields) in old_variables.into_iter() {
            for f in fields {
                remove_distinct_field_entry(dashboard_id, org_id, &name, typ.to_string(), &f)
                    .await?;
            }
        }
    } else {
        // I guess all the variables were removed from the dashboard.
        // we can batch remove all entries belonging to this dashboard.
        distinct_values::batch_remove(OriginType::Dashboard, dashboard_id).await?
    }
    Ok(())
}

macro_rules! _get_variables {
    ($map:ident, $dash:ident) => {
        if let Some(vars) = &$dash.variables {
            for v in vars.list.iter() {
                if let Some(ref qd) = v.query_data {
                    // FE uses $ to reference variables,
                    // stream name itself can come from variable
                    // so we skip it if it starts with $
                    if qd.stream.starts_with("$") {
                        continue;
                    }
                    $map.entry((qd.stream.clone(), qd.stream_type))
                        .or_default()
                        .push(qd.field.clone());
                }
            }
        }
    };
}

pub fn get_query_variables(
    dashboard: Option<&Dashboard>,
) -> HashMap<(String, StreamType), Vec<String>> {
    let mut map: HashMap<(String, StreamType), Vec<String>> = HashMap::new();
    let dashboard = if let Some(d) = dashboard {
        d
    } else {
        return map;
    };
    match dashboard.version {
        1 => {
            let dash = dashboard.v1.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        2 => {
            let dash = dashboard.v2.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        3 => {
            let dash = dashboard.v3.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        4 => {
            let dash = dashboard.v4.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        5 => {
            let dash = dashboard.v5.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        6 => {
            let dash = dashboard.v6.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        7 => {
            let dash = dashboard.v7.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        8 => {
            let dash = dashboard.v8.as_ref().unwrap();
            _get_variables!(map, dash);
        }
        _ => {
            unreachable!("we only have 8 dashboard versions")
        }
    }
    map
}

async fn create_default_dashboard_folder(
    org_id: &str,
    folder: Folder,
) -> Result<(), DashboardError> {
    let (_id, folder) = table::folders::put(org_id, None, folder, FolderType::Dashboards).await?;
    set_ownership(org_id, "folders", Authz::new(&folder.folder_id)).await;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::folders_create(
            org_id,
            _id,
            &folder.folder_id,
            FolderType::Dashboards,
            &folder.name,
            Some(folder.description.as_str()).filter(|description| !description.is_empty()),
        )
        .await;
    }

    Ok(())
}

#[tracing::instrument(skip(dashboard))]
pub async fn create_dashboard(
    org_id: &str,
    folder_id: &str,
    dashboard: Dashboard,
) -> Result<Dashboard, DashboardError> {
    // NOTE: Overwrite whatever `dashboard_id` the client has sent us
    // If folder is default folder & doesn't exist then create it

    let dashboard = if table::folders::exists(org_id, folder_id, FolderType::Dashboards).await? {
        let dashboard_id = ider::generate();
        let saved = put(org_id, &dashboard_id, folder_id, None, dashboard, None).await?;
        set_ownership(
            org_id,
            "dashboards",
            Authz {
                obj_id: dashboard_id,
                parent_type: "folders".to_owned(),
                parent: folder_id.to_owned(),
            },
        )
        .await;
        Ok(saved)
    } else if folder_id == DEFAULT_FOLDER {
        let folder = Folder {
            folder_id: DEFAULT_FOLDER.to_string(),
            name: DEFAULT_FOLDER.to_string(),
            description: DEFAULT_FOLDER.to_string(),
        };
        create_default_dashboard_folder(org_id, folder)
            .await
            .map_err(|_| DashboardError::CreateDefaultFolder)?;
        let dashboard_id = ider::generate();
        let saved = put(org_id, &dashboard_id, folder_id, None, dashboard, None).await?;
        set_ownership(
            org_id,
            "dashboards",
            Authz {
                obj_id: dashboard_id,
                parent_type: "folders".to_owned(),
                parent: folder_id.to_owned(),
            },
        )
        .await;
        Ok(saved)
    } else {
        Err(DashboardError::CreateFolderNotFound)
    }?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put(
            org_id,
            folder_id,
            dashboard.clone(),
        )
        .await;
    }

    Ok(dashboard)
}

#[tracing::instrument(skip(dashboard))]
pub async fn update_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    dashboard: Dashboard,
    hash: Option<&str>,
) -> Result<Dashboard, DashboardError> {
    // Check if dashboard exists and belongs to the specified folder.
    // Note: We don't need to explicitly check if the folder exists because
    // the folder-dashboard relationship is enforced by a foreign key constraint.
    // If the dashboard exists in the folder, the folder must exist.
    let existing = table::dashboards::get_from_folder(org_id, folder_id, dashboard_id).await?;
    if existing.is_none() {
        return Err(DashboardError::DashboardNotFound);
    }

    let dashboard = put(org_id, dashboard_id, folder_id, None, dashboard, hash).await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put(
            org_id,
            folder_id,
            dashboard.clone(),
        )
        .await;
    }

    Ok(dashboard)
}

#[tracing::instrument]
pub async fn list_all_dashboards(
    params: ListDashboardsParams,
) -> Result<Vec<(Folder, Dashboard)>, DashboardError> {
    Ok(table::dashboards::list(params).await?)
}

#[tracing::instrument]
pub async fn get_dashboard(org_id: &str, dashboard_id: &str) -> Result<Dashboard, DashboardError> {
    table::dashboards::get_by_id(org_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)
        .map(|(_f, d)| d)
}

/// Given the current `home_dashboard` setting value, returns the new `folderId`
/// to persist when `dashboard_id` is moved to `to_folder` — or `None` if the
/// setting does not pin this dashboard, or the folder is already correct.
fn home_pin_move_target(
    value: &serde_json::Value,
    dashboard_id: &str,
    to_folder: &str,
) -> Option<String> {
    let pins_this = value.get("dashboardId").and_then(|v| v.as_str()) == Some(dashboard_id);
    let folder_changed = value.get("folderId").and_then(|v| v.as_str()) != Some(to_folder);
    if pins_this && folder_changed {
        Some(to_folder.to_string())
    } else {
        None
    }
}

/// Returns true if the `home_dashboard` setting pins `dashboard_id` and should
/// therefore be cleared when that dashboard is deleted.
fn home_pin_should_clear(value: &serde_json::Value, dashboard_id: &str) -> bool {
    value.get("dashboardId").and_then(|v| v.as_str()) == Some(dashboard_id)
}

/// Keep the org's pinned `home_dashboard` setting in sync when the pinned
/// dashboard is moved: if the setting points at `dashboard_id`, update its
/// `folderId` to `to_folder`. Best-effort — never fails the caller.
async fn reconcile_home_dashboard_on_move(org_id: &str, dashboard_id: &str, to_folder: &str) {
    let setting = match system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        HOME_DASHBOARD_SETTING_KEY,
    )
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return, // no pin for this org
        Err(e) => {
            log::error!(
                "[Dashboard] reconcile home_dashboard (move) read failed for org {org_id}: {e}"
            );
            return;
        }
    };

    let Some(new_folder) = home_pin_move_target(&setting.setting_value, dashboard_id, to_folder)
    else {
        return;
    };

    let mut updated = setting;
    if let Some(obj) = updated.setting_value.as_object_mut() {
        obj.insert(
            "folderId".to_string(),
            serde_json::Value::String(new_folder),
        );
    } else {
        return; // malformed value; leave it alone
    }

    if let Err(e) = system_settings::set(&updated).await {
        log::error!(
            "[Dashboard] reconcile home_dashboard (move) write failed for org {org_id}: {e}"
        );
    }
}

/// Clear the org's pinned `home_dashboard` setting when the pinned dashboard is
/// deleted. Best-effort — never fails the caller.
async fn reconcile_home_dashboard_on_delete(org_id: &str, dashboard_id: &str) {
    let setting = match system_settings::get(
        &SettingScope::Org,
        Some(org_id),
        None,
        HOME_DASHBOARD_SETTING_KEY,
    )
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => return,
        Err(e) => {
            log::error!(
                "[Dashboard] reconcile home_dashboard (delete) read failed for org {org_id}: {e}"
            );
            return;
        }
    };

    if !home_pin_should_clear(&setting.setting_value, dashboard_id) {
        return;
    }

    if let Err(e) = system_settings::delete(
        &SettingScope::Org,
        Some(org_id),
        None,
        HOME_DASHBOARD_SETTING_KEY,
    )
    .await
    {
        log::error!("[Dashboard] reconcile home_dashboard (delete) failed for org {org_id}: {e}");
    }
}

#[tracing::instrument]
pub async fn delete_dashboard(org_id: &str, dashboard_id: &str) -> Result<(), DashboardError> {
    let Some((folder, _dashboard)) = table::dashboards::get_by_id(org_id, dashboard_id).await?
    else {
        return Err(DashboardError::DashboardNotFound);
    };
    table::dashboards::delete_from_folder(org_id, &folder.folder_id, dashboard_id).await?;
    // Keep the org's "pin to Home" setting from dangling on a deleted dashboard.
    reconcile_home_dashboard_on_delete(org_id, dashboard_id).await;
    if let Err(e) = infra::coordinator::dashboards::emit_delete_event(org_id, dashboard_id).await {
        log::error!("[Dashboard] error emitting coordinator delete event for {dashboard_id}: {e}");
    }
    DASHBOARD_ID_TO_ORG.write().await.remove(dashboard_id);
    distinct_values::batch_remove(OriginType::Dashboard, dashboard_id).await?;
    remove_ownership(
        org_id,
        "dashboards",
        Authz {
            obj_id: dashboard_id.to_owned(),
            parent_type: "folders".to_owned(),
            parent: folder.folder_id.clone(),
        },
    )
    .await;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_delete(
            org_id,
            &folder.folder_id,
            dashboard_id,
        )
        .await;
    }

    Ok(())
}

#[tracing::instrument]
pub async fn move_dashboard(
    org_id: &str,
    dashboard_id: &str,
    to_folder: &str,
    _user_id: &str,
    _check_openfga: bool,
) -> Result<(), DashboardError> {
    if !table::folders::exists(org_id, to_folder, FolderType::Dashboards).await? {
        return Err(DashboardError::MoveDestinationFolderNotFound);
    };

    let (curr_folder, dashboard) = table::dashboards::get_by_id(org_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)?;

    #[cfg(feature = "enterprise")]
    if _check_openfga && get_openfga_config().enabled {
        // TODO: Try to make a single call for all alerts
        if !check_permissions(
            dashboard_id,
            org_id,
            _user_id,
            "dashboards",
            "PUT",
            Some(&curr_folder.folder_id),
            false,
            true,
            false,
        )
        .await
        {
            return Err(DashboardError::PermissionDenied);
        }
    }

    let hash = dashboard.hash.clone();
    let _updated_dashboard = put(
        org_id,
        dashboard_id,
        &curr_folder.folder_id,
        Some(to_folder),
        dashboard,
        Some(&hash),
    )
    .await?;

    // Keep the org's "pin to Home" setting pointing at the new folder.
    reconcile_home_dashboard_on_move(org_id, dashboard_id, to_folder).await;

    #[cfg(feature = "enterprise")]
    {
        if get_o2_config().super_cluster.enabled {
            let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put_v2(
                org_id,
                &curr_folder.folder_id,
                Some(to_folder),
                _updated_dashboard,
            )
            .await;
        }
        if get_openfga_config().enabled {
            set_parent_relation(
                dashboard_id,
                &get_ofga_type("dashboards"),
                to_folder,
                &get_ofga_type("folders"),
            )
            .await;
            remove_parent_relation(
                dashboard_id,
                &get_ofga_type("dashboards"),
                &curr_folder.folder_id,
                &get_ofga_type("folders"),
            )
            .await;
        }
    }

    Ok(())
}

#[tracing::instrument]
pub async fn move_dashboards(
    org_id: &str,
    dashboard_ids: &[String],
    to_folder: &str,
    user_id: &str,
    check_openfga: bool,
) -> Result<(), DashboardError> {
    if !table::folders::exists(org_id, to_folder, FolderType::Dashboards).await? {
        return Err(DashboardError::MoveDestinationFolderNotFound);
    };

    let futs = dashboard_ids
        .iter()
        .map(|d_id| move_dashboard(org_id, d_id, to_folder, user_id, check_openfga));
    let _ = join_all(futs)
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;

    Ok(())
}

#[tracing::instrument(skip(dashboard))]
async fn put(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    new_folder_id: Option<&str>,
    mut dashboard: Dashboard,
    hash: Option<&str>,
) -> Result<Dashboard, DashboardError> {
    let old_version = table::dashboards::get_from_folder(org_id, folder_id, dashboard_id).await?;
    if let Some(existing_dash) = &old_version {
        let existing_dash_hash = &existing_dash.hash;

        let Some(Ok(hash_val)) = hash.map(|hash_str| hash_str.parse::<u64>()) else {
            return Err(DashboardError::UpdateMissingHash);
        };
        if hash_val.to_string() != *existing_dash_hash {
            return Err(DashboardError::UpdateConflictingHash);
        }
    };

    match update_distinct_variables(org_id, old_version, &dashboard).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("error in updating distinct values while updating dashboard : {e}");
            return Err(DashboardError::DistinctValueError);
        }
    }

    let title = dashboard
        .title()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| DashboardError::PutMissingTitle)?;
    dashboard.set_title(title);

    dashboard.set_dashboard_id(dashboard_id.to_owned());
    let dash = table::dashboards::put(org_id, folder_id, new_folder_id, dashboard, false).await?;
    if let Some(id) = dash.dashboard_id() {
        if let Err(e) = infra::coordinator::dashboards::emit_put_event(org_id, id).await {
            log::error!("[Dashboard] error emitting coordinator put event for {id}: {e}");
        }
        DASHBOARD_ID_TO_ORG
            .write()
            .await
            .insert(id.to_string(), org_id.to_string());
    }
    Ok(dash)
}

/// Internal helper function find dashboard and its folder by id.
///
/// Used by self_reporting to enrich dashboard SearchEventContext
pub async fn get_folder_and_dashboard(
    org_id: &str,
    dashboard_id: &str,
) -> Result<(Folder, Dashboard), DashboardError> {
    table::dashboards::get_by_id(org_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)
}

/// Computes an auto-layout position for a new panel based on existing panels.
///
/// Grid is 192 columns wide. Default panel size: w=96, h=18.
/// Places the new panel to the right of the last panel if there is room,
/// otherwise below all existing panels.
fn compute_panel_layout(
    panels: &[v8::Panel],
    override_w: Option<i64>,
    override_h: Option<i64>,
) -> v8::Layout {
    let w = override_w.unwrap_or(96);
    let h = override_h.unwrap_or(18);

    if panels.is_empty() {
        return v8::Layout {
            x: 0,
            y: 0,
            w,
            h,
            i: 1,
        };
    }

    let default_layout = v8::Layout::default();
    let mut max_i: i64 = 0;
    let mut max_y: i64 = 0;
    let mut last_panel: Option<&v8::Panel> = None;

    for panel in panels {
        let layout = panel.layout.as_ref().unwrap_or(&default_layout);
        if layout.i > max_i {
            max_i = layout.i;
        }
        if layout.y > max_y || (layout.y == max_y && last_panel.is_none()) {
            max_y = layout.y;
            last_panel = Some(panel);
        } else if layout.y == max_y
            && last_panel.is_some_and(|lp| {
                let lp_layout = lp.layout.as_ref().unwrap_or(&default_layout);
                layout.x + layout.w > lp_layout.x + lp_layout.w
            })
        {
            last_panel = Some(panel);
        }
    }

    let new_i = max_i + 1;

    // Try to place to the right of the last panel
    if let Some(lp) = last_panel {
        let lp_layout = lp.layout.as_ref().unwrap_or(&default_layout);
        let remaining = 192 - (lp_layout.x + lp_layout.w);
        if remaining >= w {
            return v8::Layout {
                x: lp_layout.x + lp_layout.w,
                y: lp_layout.y,
                w,
                h,
                i: new_i,
            };
        }
    }

    // Place below all existing panels
    let max_bottom = panels
        .iter()
        .map(|p| {
            let layout = p.layout.as_ref().unwrap_or(&default_layout);
            layout.y + layout.h
        })
        .max()
        .unwrap_or(0);

    v8::Layout {
        x: 0,
        y: max_bottom,
        w,
        h,
        i: new_i,
    }
}

/// Adds a panel to an existing dashboard.
///
/// Auto-computes layout if the caller does not set explicit x/y values.
/// Returns the panel as stored, the new dashboard hash, and the resolved tab ID.
#[tracing::instrument(skip(panel))]
pub async fn add_panel_to_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    hash: &str,
    tab_id: Option<&str>,
    mut panel: v8::Panel,
) -> Result<(v8::Panel, String, String), DashboardError> {
    let mut dashboard = table::dashboards::get_from_folder(org_id, folder_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)?;
    let v8_dash = dashboard
        .v8
        .as_mut()
        .ok_or(DashboardError::PanelUnsupportedVersion)?;

    // Resolve tab
    let tab = if let Some(tid) = tab_id {
        v8_dash
            .tabs
            .iter_mut()
            .find(|t| t.tab_id == tid)
            .ok_or_else(|| DashboardError::TabNotFound(tid.to_string()))?
    } else {
        v8_dash
            .tabs
            .first_mut()
            .ok_or_else(|| DashboardError::TabNotFound("(no tabs)".to_string()))?
    };
    let resolved_tab_id = tab.tab_id.clone();

    // Generate panel ID if empty
    if panel.id.is_empty() {
        panel.id = ider::generate();
    }

    // Check for duplicate panel ID
    if tab.panels.iter().any(|p| p.id == panel.id) {
        return Err(DashboardError::PanelAlreadyExists(
            panel.id.clone(),
            resolved_tab_id,
        ));
    }

    // Auto-compute layout if caller didn't provide one (or provided all zeros)
    match &mut panel.layout {
        None => {
            panel.layout = Some(compute_panel_layout(&tab.panels, None, None));
        }
        Some(layout) if layout.x == 0 && layout.y == 0 && layout.w == 0 && layout.h == 0 => {
            // All-zero layout means the caller wants auto-placement
            panel.layout = Some(compute_panel_layout(&tab.panels, None, None));
        }
        Some(layout) if layout.x == 0 && layout.y == 0 => {
            // Position is (0,0) — auto-compute, but respect explicit w/h
            let override_w = if layout.w > 0 { Some(layout.w) } else { None };
            let override_h = if layout.h > 0 { Some(layout.h) } else { None };
            panel.layout = Some(compute_panel_layout(&tab.panels, override_w, override_h));
        }
        Some(layout) if layout.i == 0 => {
            // Explicit position but missing i — assign next available
            let max_i = tab
                .panels
                .iter()
                .map(|p| p.layout.as_ref().map_or(0, |l| l.i))
                .max()
                .unwrap_or(0);
            layout.i = max_i + 1;
        }
        Some(_) => {}
    }

    tab.panels.push(panel.clone());

    let saved = put(org_id, dashboard_id, folder_id, None, dashboard, Some(hash)).await?;
    let new_hash = saved.hash.clone();

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put(
            org_id, folder_id, saved,
        )
        .await;
    }

    Ok((panel, new_hash, resolved_tab_id))
}

/// Updates a single panel in an existing dashboard by panel ID.
///
/// Preserves the existing layout if the incoming panel's layout is all zeros.
/// Returns the updated panel, the new dashboard hash, and the resolved tab ID.
#[tracing::instrument(skip(panel))]
pub async fn update_panel_in_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    panel_id: &str,
    hash: &str,
    tab_id: Option<&str>,
    mut panel: v8::Panel,
) -> Result<(v8::Panel, String, String), DashboardError> {
    let mut dashboard = table::dashboards::get_from_folder(org_id, folder_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)?;
    let v8_dash = dashboard
        .v8
        .as_mut()
        .ok_or(DashboardError::PanelUnsupportedVersion)?;

    // Resolve tab
    let tab = if let Some(tid) = tab_id {
        v8_dash
            .tabs
            .iter_mut()
            .find(|t| t.tab_id == tid)
            .ok_or_else(|| DashboardError::TabNotFound(tid.to_string()))?
    } else {
        v8_dash
            .tabs
            .first_mut()
            .ok_or_else(|| DashboardError::TabNotFound("(no tabs)".to_string()))?
    };
    let resolved_tab_id = tab.tab_id.clone();

    // Find existing panel
    let idx = tab
        .panels
        .iter()
        .position(|p| p.id == panel_id)
        .ok_or_else(|| DashboardError::PanelNotFound(panel_id.to_string()))?;

    // Preserve existing layout if incoming panel has no layout
    if panel.layout.is_none() {
        panel.layout = tab.panels[idx].layout.clone();
    }

    // URL param is authoritative for panel ID
    panel.id = panel_id.to_string();

    tab.panels[idx] = panel.clone();

    let saved = put(org_id, dashboard_id, folder_id, None, dashboard, Some(hash)).await?;
    let new_hash = saved.hash.clone();

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put(
            org_id, folder_id, saved,
        )
        .await;
    }

    Ok((panel, new_hash, resolved_tab_id))
}

/// Deletes a single panel from an existing dashboard by panel ID.
///
/// If `tab_id` is provided, searches only that tab. Otherwise searches all tabs.
/// Returns the new dashboard hash and the deleted panel ID.
#[tracing::instrument]
pub async fn delete_panel_from_dashboard(
    org_id: &str,
    dashboard_id: &str,
    folder_id: &str,
    panel_id: &str,
    hash: &str,
    tab_id: Option<&str>,
) -> Result<(String, String), DashboardError> {
    let mut dashboard = table::dashboards::get_from_folder(org_id, folder_id, dashboard_id)
        .await?
        .ok_or(DashboardError::DashboardNotFound)?;
    let v8_dash = dashboard
        .v8
        .as_mut()
        .ok_or(DashboardError::PanelUnsupportedVersion)?;

    let mut found = false;

    if let Some(tid) = tab_id {
        let tab = v8_dash
            .tabs
            .iter_mut()
            .find(|t| t.tab_id == tid)
            .ok_or_else(|| DashboardError::TabNotFound(tid.to_string()))?;

        let before_len = tab.panels.len();
        tab.panels.retain(|p| p.id != panel_id);
        found = tab.panels.len() < before_len;
    } else {
        // Search all tabs
        for tab in &mut v8_dash.tabs {
            let before_len = tab.panels.len();
            tab.panels.retain(|p| p.id != panel_id);
            if tab.panels.len() < before_len {
                found = true;
                break;
            }
        }
    }

    if !found {
        return Err(DashboardError::PanelNotFound(panel_id.to_string()));
    }

    let saved = put(org_id, dashboard_id, folder_id, None, dashboard, Some(hash)).await?;
    let new_hash = saved.hash.clone();

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let _ = o2_enterprise::enterprise::super_cluster::queue::dashboards_put(
            org_id, folder_id, saved,
        )
        .await;
    }

    Ok((new_hash, panel_id.to_string()))
}

#[cfg(test)]
mod tests {
    use config::meta::dashboards::v8;

    use super::*;

    fn make_panel(i: i64, x: i64, y: i64, w: i64, h: i64) -> v8::Panel {
        let mut p: v8::Panel = serde_json::from_str(
            r#"{"id":"","type":"bar","title":"","description":"","config":{"show_legends":false,"legends_position":null},"queries":[]}"#
        ).unwrap();
        p.id = format!("p{i}");
        p.layout = Some(v8::Layout { x, y, w, h, i });
        p
    }

    #[test]
    fn test_compute_panel_layout_empty_panels() {
        let layout = compute_panel_layout(&[], None, None);
        assert_eq!(layout.x, 0);
        assert_eq!(layout.y, 0);
        assert_eq!(layout.w, 96);
        assert_eq!(layout.h, 18);
        assert_eq!(layout.i, 1);
    }

    #[test]
    fn test_compute_panel_layout_custom_size_empty() {
        let layout = compute_panel_layout(&[], Some(48), Some(10));
        assert_eq!(layout.w, 48);
        assert_eq!(layout.h, 10);
    }

    #[test]
    fn test_compute_panel_layout_places_below_when_no_room() {
        // Panel at x=0, y=0, w=192 — takes full row width
        let panels = vec![make_panel(1, 0, 0, 192, 18)];
        let layout = compute_panel_layout(&panels, None, None);
        // No room to the right, should place below (y = 0 + 18 = 18)
        assert_eq!(layout.y, 18);
        assert_eq!(layout.x, 0);
        assert_eq!(layout.i, 2);
    }

    #[test]
    fn test_compute_panel_layout_places_right_when_room() {
        // Panel at x=0, y=0, w=96 — leaves room on the right
        let panels = vec![make_panel(1, 0, 0, 96, 18)];
        let layout = compute_panel_layout(&panels, Some(96), None);
        // Room to the right: x = 96, y = 0
        assert_eq!(layout.x, 96);
        assert_eq!(layout.y, 0);
        assert_eq!(layout.i, 2);
    }

    #[test]
    fn home_pin_move_target_updates_when_pin_matches_and_folder_changed() {
        let v = serde_json::json!({ "dashboardId": "abc", "folderId": "B", "label": "X" });
        assert_eq!(home_pin_move_target(&v, "abc", "A"), Some("A".to_string()));
    }

    #[test]
    fn home_pin_move_target_none_when_folder_unchanged() {
        let v = serde_json::json!({ "dashboardId": "abc", "folderId": "A", "label": "X" });
        assert_eq!(home_pin_move_target(&v, "abc", "A"), None);
    }

    #[test]
    fn home_pin_move_target_none_when_different_dashboard() {
        let v = serde_json::json!({ "dashboardId": "other", "folderId": "B", "label": "X" });
        assert_eq!(home_pin_move_target(&v, "abc", "A"), None);
    }

    #[test]
    fn home_pin_should_clear_true_when_pin_matches() {
        let v = serde_json::json!({ "dashboardId": "abc", "folderId": "B", "label": "X" });
        assert!(home_pin_should_clear(&v, "abc"));
    }

    #[test]
    fn home_pin_should_clear_false_when_pin_differs() {
        let v = serde_json::json!({ "dashboardId": "other", "folderId": "B", "label": "X" });
        assert!(!home_pin_should_clear(&v, "abc"));
    }

    #[test]
    fn home_pin_handles_malformed_value_gracefully() {
        let v = serde_json::json!("not-an-object");
        assert_eq!(home_pin_move_target(&v, "abc", "A"), None);
        assert!(!home_pin_should_clear(&v, "abc"));
    }
}
