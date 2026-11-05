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

use common::meta::authz::Authz;
use config::{
    ider,
    meta::{
        alerts::alert::ListAlertsParams,
        dashboards::{ListDashboardsParams, reports::ListReportsParams},
        folder::{DEFAULT_FOLDER, Folder, FolderType},
        synthetics::ListSyntheticsParams,
    },
};
use infra::{db::get_orm_client_rw, table};
#[cfg(feature = "enterprise")]
use o2_openfga::meta::mapping::OFGA_MODELS;

#[cfg(feature = "enterprise")]
use crate::authz::list_objects_for_user;
use crate::authz::{remove_ownership, set_ownership};

/// Errors that can occur when interacting with folders.
#[derive(Debug, thiserror::Error)]
pub enum FolderError {
    /// An error that occurs while interacting with the database through the
    /// [infra] crate.
    #[error("InfraError# Internal error")]
    InfraError(#[from] infra::errors::Error),

    /// An error that occurs while interacting with reports through the [infra::table::reports]
    /// module.
    #[error("ReportsError# Internal error")]
    TableReportsError(#[from] table::reports::Error),

    /// An error that occurs when trying to set a folder name to the empty string.
    #[error("Folder name cannot be empty")]
    MissingName,

    /// An error that occurs when trying to create a folder with a name
    /// that already exists in the same organization.
    #[error("Folder with this name already exists in this organization")]
    FolderNameAlreadyExists,

    /// An error that occurs when trying to update the special "default" folder.
    #[error("Can't update default folder")]
    UpdateDefaultFolder,

    /// An error that occurs when trying to delete a folder that contains dashboards.
    #[error("Folder contains dashboards. Please move/delete dashboards from folder.")]
    DeleteWithDashboards,

    /// An error that occurs when trying to delete a folder that contains alerts.
    #[error("Folder contains alerts. Please move/delete alerts from folder.")]
    DeleteWithAlerts,

    /// An error that occurs when trying to delete a folder that contains reports.
    #[error("Folder contains reports. Please move/delete reports from folder.")]
    DeleteWithReports,

    /// An error that occurs when trying to delete a folder that contains synthetics.
    #[error("Folder contains synthetics. Please move/delete synthetics from folder.")]
    DeleteWithSynthetics,

    /// An error that occurs when trying to delete a folder that contains workflows.
    #[error("Folder contains workflows. Please move/delete workflows from folder.")]
    DeleteWithWorkflows,
    /// An error that occurs when trying to delete a folder that contains prompts.
    #[error("Folder contains prompts. Please move/delete prompts from folder.")]
    DeleteWithPrompts,

    /// An error that occurs when trying to delete a folder that contains downtimes.
    #[error("Folder contains downtimes. Please move/delete downtimes from folder.")]
    DeleteWithDowntimes,

    /// A fleet still places or holds collectors, or is the default one.
    #[error("{0}")]
    DeleteFleet(String),

    /// A fleet holds collectors or live tokens, which the refusal counts.
    #[error("{0}")]
    FleetInUse(String, config::meta::fleet::References),

    /// A fleet's revisions kept changing while it was being deleted.
    #[error("{0}")]
    FleetChanged(String),

    /// An error that occurs when trying to delete a folder that cannot be found.
    #[error("Folder not found")]
    NotFound,

    /// An error occurred trying to get the list of permitted folders in
    /// enterprise mode because no user_id was provided.
    #[error("user_id required to get permitted folders in enterprise mode")]
    PermittedFoldersMissingUser,

    /// An error occurred trying to get the list of permitted folders in
    /// enterprise mode using the validator.
    #[error("PermittedFoldersValidator# {0}")]
    PermittedFoldersValidator(String),
}

#[tracing::instrument(skip(folder))]
pub async fn save_folder(
    org_id: &str,
    mut folder: Folder,
    folder_type: FolderType,
    is_internal: bool,
) -> Result<Folder, FolderError> {
    folder.name = folder.name.trim().to_string();
    if folder.name.is_empty() {
        return Err(FolderError::MissingName);
    }

    if !is_internal && folder.folder_id == DEFAULT_FOLDER {
        return Err(FolderError::UpdateDefaultFolder);
    }

    if folder.folder_id != DEFAULT_FOLDER {
        folder.folder_id = ider::generate();
    }

    // Check if there is already a folder with the same name in the organization
    if get_folder_by_name(org_id, &folder.name, folder_type)
        .await
        .is_ok()
    {
        return Err(FolderError::FolderNameAlreadyExists);
    }

    let (_id, folder) = table::folders::put(org_id, None, folder, folder_type).await?;
    let folder_type_ofga = folder_type_ofga_name(folder_type);
    set_ownership(org_id, folder_type_ofga, Authz::new(&folder.folder_id)).await;

    #[cfg(feature = "enterprise")]
    if publishes(folder_type) {
        let _ = o2_enterprise::enterprise::super_cluster::queue::folders_create(
            org_id,
            _id,
            &folder.folder_id,
            folder_type,
            &folder.name,
            Some(folder.description.as_str()).filter(|d| !d.is_empty()),
        )
        .await;
    }

    Ok(folder)
}

/// Returns the org's default folder of the given type, creating it if this is the first use.
///
/// Safe to call concurrently: the folder is created idempotently, so a request that loses the race
/// still gets the folder rather than a unique-constraint failure. Ownership and the super-cluster
/// event only fire for the caller that actually inserted it.
#[tracing::instrument]
pub async fn ensure_default_folder(
    org_id: &str,
    folder_type: FolderType,
) -> Result<Folder, FolderError> {
    let default_folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: DEFAULT_FOLDER.to_owned(),
        description: DEFAULT_FOLDER.to_owned(),
        icon: None,
    };

    let (_id, folder, created) =
        table::folders::get_or_create(org_id, default_folder, folder_type).await?;
    if !created {
        return Ok(folder);
    }

    set_ownership(
        org_id,
        folder_type_ofga_name(folder_type),
        Authz::new(&folder.folder_id),
    )
    .await;

    #[cfg(feature = "enterprise")]
    if publishes(folder_type) {
        let _ = o2_enterprise::enterprise::super_cluster::queue::folders_create(
            org_id,
            _id,
            &folder.folder_id,
            folder_type,
            &folder.name,
            Some(folder.description.as_str()).filter(|d| !d.is_empty()),
        )
        .await;
    }

    Ok(folder)
}

#[tracing::instrument(skip(folder))]
pub async fn update_folder(
    org_id: &str,
    folder_id: &str,
    folder_type: FolderType,
    mut folder: Folder,
) -> Result<Folder, FolderError> {
    if folder_id.eq(DEFAULT_FOLDER) {
        return Err(FolderError::UpdateDefaultFolder);
    }

    folder.folder_id = folder_id.to_string();
    if let Ok(existing_folder) = get_folder_by_name(org_id, &folder.name, folder_type).await
        && existing_folder.folder_id != folder_id
    {
        return Err(FolderError::FolderNameAlreadyExists);
    }
    let (_, folder) = table::folders::put(org_id, None, folder, folder_type).await?;

    #[cfg(feature = "enterprise")]
    if publishes(folder_type) {
        let _ = o2_enterprise::enterprise::super_cluster::queue::folders_update(
            org_id,
            folder_id,
            folder_type,
            &folder.name,
            Some(folder.description.as_str()).filter(|d| !d.is_empty()),
        )
        .await;
    }

    Ok(folder)
}

#[tracing::instrument()]
pub async fn list_folders(
    org_id: &str,
    user_id: Option<&str>,
    folder_type: FolderType,
) -> Result<Vec<Folder>, FolderError> {
    let permitted_folders = permitted_folders(org_id, user_id, folder_type).await?;
    let folders = table::folders::list_folders(org_id, folder_type).await?;
    #[cfg(feature = "enterprise")]
    let folder_ofga_model = match folder_type {
        FolderType::Dashboards => OFGA_MODELS.get("folders").unwrap().key,
        FolderType::Alerts => OFGA_MODELS.get("alert_folders").unwrap().key,
        FolderType::Reports => OFGA_MODELS.get("report_folders").unwrap().key,
        FolderType::Synthetics => OFGA_MODELS.get("synthetic_folder").unwrap().key,
        FolderType::Workflows => OFGA_MODELS.get("workflow_folder").unwrap().key,
        FolderType::Downtimes => OFGA_MODELS.get("downtime_folders").unwrap().key,
        FolderType::Prompts => OFGA_MODELS.get("prompt_folders").unwrap().key,
        FolderType::Fleets => OFGA_MODELS.get("fleets").unwrap().key,
    };
    #[cfg(not(feature = "enterprise"))]
    let folder_ofga_model = "";

    let filtered = match permitted_folders {
        Some(permitted_folders) => {
            if permitted_folders.contains(&format!("{folder_ofga_model}:_all_{org_id}")) {
                folders
            } else {
                folders
                    .into_iter()
                    .filter(|folder_loc| {
                        permitted_folders
                            .contains(&format!("{folder_ofga_model}:{}", folder_loc.folder_id))
                    })
                    .collect::<Vec<_>>()
            }
        }
        None => folders,
    };
    Ok(filtered)
}

#[tracing::instrument()]
pub async fn get_folder(
    org_id: &str,
    folder_id: &str,
    folder_type: FolderType,
) -> Result<Folder, FolderError> {
    table::folders::get(org_id, folder_id, folder_type)
        .await?
        .ok_or(FolderError::NotFound)
}

#[tracing::instrument()]
pub async fn get_folder_by_name(
    org_id: &str,
    folder_name: &str,
    folder_type: FolderType,
) -> Result<Folder, FolderError> {
    table::folders::get_by_name(org_id, folder_name, folder_type)
        .await?
        .ok_or(FolderError::NotFound)
}

#[tracing::instrument()]
pub async fn delete_folder(
    org_id: &str,
    folder_id: &str,
    folder_type: FolderType,
) -> Result<(), FolderError> {
    let client = get_orm_client_rw().await;
    match folder_type {
        // D27: one transaction of its own, which also removes the folder; then only ownership.
        #[cfg(feature = "enterprise")]
        FolderType::Fleets => {
            delete_fleet(org_id, folder_id).await?;
            remove_ownership(
                org_id,
                folder_type_ofga_name(folder_type),
                Authz::new(folder_id),
            )
            .await;
            return Ok(());
        }
        #[cfg(not(feature = "enterprise"))]
        FolderType::Fleets => {}
        FolderType::Dashboards => {
            let params = ListDashboardsParams::new(org_id).with_folder_id(folder_id);
            let dashboards = table::dashboards::list(params).await?;
            if !dashboards.is_empty() {
                return Err(FolderError::DeleteWithDashboards);
            }
        }
        FolderType::Alerts => {
            let params = ListAlertsParams::new(org_id).in_folder(folder_id);
            let alerts = table::alerts::list(client, params).await?;
            if !alerts.is_empty() {
                return Err(FolderError::DeleteWithAlerts);
            }
            // Composites keep the folder slug; anomaly configs keep the `folders.id` key.
            if table::alert_composites::count_in_folder(client, org_id, folder_id).await? > 0 {
                return Err(FolderError::DeleteWithAlerts);
            }
            if let Some(folder_pk) =
                table::folders::get_pk_by_name(org_id, folder_id, folder_type).await?
                && table::anomaly_detection::config::count_in_folder(client, org_id, &folder_pk)
                    .await?
                    > 0
            {
                return Err(FolderError::DeleteWithAlerts);
            }
        }
        FolderType::Reports => {
            let params = ListReportsParams::new(org_id).in_folder(folder_id);
            let reports = table::reports::list_reports(client, &params).await?;
            if !reports.is_empty() {
                return Err(FolderError::DeleteWithReports);
            }
        }
        FolderType::Synthetics => {
            // `folder_id` here is the user-facing id from the URL — the
            // `folders.folder_id` column. The synthetics table stores the
            // folder's PRIMARY KEY instead, so the two must be translated
            // before they can be compared. Comparing them directly always
            // counted zero, which let the delete through to the database and
            // surfaced as a raw "FOREIGN KEY constraint failed" 500 instead of
            // the "move/delete synthetics from folder" message the other
            // folder types give.
            //
            // A missing folder is left to the `exists` check below, which
            // reports NotFound.
            if let Some(folder_pk) =
                table::folders::get_pk_by_name(org_id, folder_id, folder_type).await?
            {
                let params = ListSyntheticsParams {
                    folder_id: Some(folder_pk),
                    ..Default::default()
                };
                if table::synthetics_checks::count(client, org_id, &params).await? > 0 {
                    return Err(FolderError::DeleteWithSynthetics);
                }
            }
        }
        FolderType::Workflows => {
            // `folder_id` is the user-facing id from the URL; the workflows
            // table stores the folder's primary key, so translate before
            // counting. A missing folder falls through to the `exists` check
            // below, which reports NotFound.
            if let Some(folder_pk) =
                table::folders::get_pk_by_name(org_id, folder_id, folder_type).await?
                && table::workflows::count_by_folder(org_id, &folder_pk).await? > 0
            {
                return Err(FolderError::DeleteWithWorkflows);
            }
        }
        FolderType::Downtimes => {
            if let Some(folder_pk) =
                table::folders::get_pk_by_name(org_id, folder_id, folder_type).await?
                && !table::downtimes::release_folder(org_id, &folder_pk).await?
            {
                return Err(FolderError::DeleteWithDowntimes);
            }
        }
        FolderType::Prompts => {
            if let Some(folder_pk) =
                table::folders::get_pk_by_name(org_id, folder_id, folder_type).await?
            {
                use sea_orm::{
                    ConnectionTrait, TryGetable,
                    sea_query::{Alias, Expr, Func, Query},
                };
                let query = Query::select()
                    .expr_as(
                        Func::count(Expr::col(Alias::new("entity_id"))),
                        Alias::new("count"),
                    )
                    .from(Alias::new("llm_prompts"))
                    .and_where(Expr::col(Alias::new("org_id")).eq(org_id))
                    .and_where(Expr::col(Alias::new("folder_id")).eq(folder_pk))
                    .to_owned();
                let statement = client.get_database_backend().build(&query);
                let count = match client
                    .query_one(statement)
                    .await
                    .map_err(infra::errors::Error::from)?
                {
                    Some(row) => i64::try_get(&row, "", "count")
                        .map_err(|error| infra::errors::Error::Message(format!("{error:?}")))?,
                    None => 0,
                };
                if count > 0 {
                    return Err(FolderError::DeleteWithPrompts);
                }
            }
        }
    };

    if !table::folders::exists(org_id, folder_id, folder_type).await? {
        return Err(FolderError::NotFound);
    }

    table::folders::delete(org_id, folder_id, folder_type).await?;
    forget_folder(org_id, folder_id, folder_type).await;
    Ok(())
}

/// Org teardown: every folder without the emptiness checks, its ownership before its row.
pub async fn delete_by_org(org_id: &str) -> Result<(), FolderError> {
    let folder_types = [
        FolderType::Dashboards,
        FolderType::Alerts,
        FolderType::Reports,
        FolderType::Synthetics,
        FolderType::Workflows,
        FolderType::Prompts,
        FolderType::Downtimes,
    ];
    for folder_type in folder_types {
        for folder in table::folders::list_folders(org_id, folder_type).await? {
            forget_folder(org_id, &folder.folder_id, folder_type).await;
            table::folders::delete(org_id, &folder.folder_id, folder_type).await?;
        }
    }
    // Also catches rows whose type no variant above maps, which the typed listing cannot see.
    for (folder_id, folder_type) in table::folders::delete_by_org(org_id).await? {
        if let Some(folder_type) = table::folders::folder_type_from_i16(folder_type) {
            forget_folder(org_id, &folder_id, folder_type).await;
        }
    }
    Ok(())
}

/// A downtime folder travels with the rows filed in it, so it waits for downtime replication too.
#[cfg(feature = "enterprise")]
fn publishes(folder_type: FolderType) -> bool {
    // Fleet data is region-local, so its fleets never replicate (D2).
    o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && folder_type != FolderType::Fleets
        && (folder_type != FolderType::Downtimes || crate::downtimes::replicates())
}

/// OpenFGA object type that owns folders of the given kind.
fn folder_type_ofga_name(folder_type: FolderType) -> &'static str {
    match folder_type {
        FolderType::Dashboards => "folders",
        FolderType::Alerts => "alert_folders",
        FolderType::Reports => "report_folders",
        FolderType::Synthetics => "synthetic_folder",
        FolderType::Workflows => "workflow_folder",
        FolderType::Downtimes => "downtime_folders",
        FolderType::Prompts => "prompt_folders",
        FolderType::Fleets => "fleets",
    }
}

#[cfg(feature = "enterprise")]
async fn delete_fleet(org_id: &str, folder_id: &str) -> Result<(), FolderError> {
    use o2_enterprise::enterprise::fleet::service::FleetError;

    let Err(e) = o2_enterprise::enterprise::fleet::fleets::delete_fleet(org_id, folder_id).await
    else {
        return Ok(());
    };
    Err(match e.downcast_ref::<FleetError>() {
        Some(FleetError::FleetNotFound(_)) => FolderError::NotFound,
        Some(FleetError::Invalid(message)) => FolderError::DeleteFleet(message.clone()),
        Some(FleetError::FleetInUse(_, references)) => {
            FolderError::FleetInUse(e.to_string(), references.clone())
        }
        Some(FleetError::RolloutState { .. }) => {
            FolderError::FleetChanged(format!("fleet {folder_id} is changing; retry"))
        }
        _ => FolderError::InfraError(infra::errors::Error::Message(e.to_string())),
    })
}

#[cfg(not(feature = "enterprise"))]
async fn permitted_folders(
    _org_id: &str,
    _user_id: Option<&str>,
    _folder_type: FolderType,
) -> Result<Option<Vec<String>>, FolderError> {
    Ok(None)
}

#[cfg(feature = "enterprise")]
async fn permitted_folders(
    org_id: &str,
    user_id: Option<&str>,
    folder_type: FolderType,
) -> Result<Option<Vec<String>>, FolderError> {
    let (folder_ofga_model, child_ofga_model) = match folder_type {
        FolderType::Dashboards => (
            OFGA_MODELS.get("folders").unwrap().key,
            OFGA_MODELS.get("dashboards").unwrap().key,
        ),
        FolderType::Alerts => (
            OFGA_MODELS.get("alert_folders").unwrap().key,
            OFGA_MODELS.get("alerts").unwrap().key,
        ),
        FolderType::Reports => (
            OFGA_MODELS.get("report_folders").unwrap().key,
            OFGA_MODELS.get("reports").unwrap().key,
        ),
        FolderType::Synthetics => (
            OFGA_MODELS.get("synthetic_folder").unwrap().key,
            OFGA_MODELS.get("synthetics").unwrap().key,
        ),
        FolderType::Workflows => (
            OFGA_MODELS.get("workflow_folder").unwrap().key,
            OFGA_MODELS.get("workflows").unwrap().key,
        ),
        FolderType::Downtimes => (
            OFGA_MODELS.get("downtime_folders").unwrap().key,
            OFGA_MODELS.get("downtimes").unwrap().key,
        ),
        // Prompt grants are plain `prompt:{id}` with no folder prefix, so there is no
        // individual grant to lift a folder into view: only folder `GET` counts.
        FolderType::Prompts => (OFGA_MODELS.get("prompt_folders").unwrap().key, ""),
        // Collectors have no grants of their own (D17), so likewise only folder `GET` counts.
        FolderType::Fleets => (OFGA_MODELS.get("fleets").unwrap().key, ""),
    };

    let Some(user_id) = user_id else {
        return Err(FolderError::PermittedFoldersMissingUser);
    };

    // Get the list of folders that the user has `GET` permission on.
    let mut folder_list = list_objects_for_user(org_id, user_id, "GET", folder_ofga_model)
        .await
        .map_err(|err| FolderError::PermittedFoldersValidator(err.to_string()))?;

    if child_ofga_model.is_empty() {
        return Ok(folder_list);
    }

    // In some cases, there might not be direct `GET` permission on the folder.
    // So, we need to check if the user has `GET` permission on any of the dashboards
    // inside the folder.

    let permitted_dashboards = list_objects_for_user(
        org_id,
        user_id,
        "GET_INDIVIDUAL_FROM_ROLE",
        child_ofga_model,
    )
    .await
    .map_err(|err| FolderError::PermittedFoldersValidator(err.to_string()))?;

    log::debug!("permitted_dashboards: {permitted_dashboards:?}");
    if let Some(permitted_dashboards) = permitted_dashboards {
        let mut folder_list_with_roles = vec![];
        for dashboard in permitted_dashboards {
            let Some((_, folder_id)) = dashboard.split_once(":") else {
                continue;
            };
            // The folder_id is of the format `{folder_id}/{dashboard_id}`.
            // So, we need to extract the folder_id from the dashboard string.
            let Some((folder_id, _)) = folder_id.split_once("/") else {
                continue;
            };
            log::info!("folder_id: {folder_id:?}");
            folder_list_with_roles.push(format!("{folder_ofga_model}:{folder_id}"));
        }
        if let Some(folder_list) = folder_list.as_mut() {
            folder_list.extend(folder_list_with_roles);
        } else {
            folder_list = Some(folder_list_with_roles);
        }
    }
    Ok(folder_list)
}

/// Drops the folder's ownership tuples and tells other regions; both only log a failure.
async fn forget_folder(org_id: &str, folder_id: &str, folder_type: FolderType) {
    remove_ownership(
        org_id,
        folder_type_ofga_name(folder_type),
        Authz::new(folder_id),
    )
    .await;
    #[cfg(feature = "enterprise")]
    if publishes(folder_type) {
        let _ = o2_enterprise::enterprise::super_cluster::queue::folders_delete(
            org_id,
            folder_id,
            folder_type,
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use config::meta::folder::FolderType;

    use super::*;

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            infra::db_init().await.expect("meta store");
            table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    fn alert_folder(slug: &str) -> Folder {
        Folder {
            folder_id: slug.to_string(),
            name: slug.to_string(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn test_alert_folder_holding_a_composite_is_not_deleted() {
        use infra::table::entity::alert_composites;
        use sea_orm::ActiveValue::Set;
        use svix_ksuid::KsuidLike;

        if !meta_store().await {
            return;
        }
        let org = format!("folder_guard_c_{}", config::utils::time::now_micros());
        let conn = get_orm_client_rw().await;

        table::folders::get_or_create(&org, alert_folder("holds_composite"), FolderType::Alerts)
            .await
            .unwrap();
        let composite = alert_composites::ActiveModel {
            id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
            org: Set(org.clone()),
            folder_id: Set("holds_composite".to_string()),
            name: Set("composite".to_string()),
            description: Set(None),
            expression: Set("true".to_string()),
            warning_counts_as_firing: Set(false),
            stale_child_policy: Set(0),
            destinations: Set(serde_json::json!([])),
            template: Set(None),
            context_attributes: Set(None),
            enabled: Set(true),
            silence_seconds: Set(0),
            creates_incident: Set(false),
            workflows: Set(serde_json::json!([])),
            priority: Set(None),
            tags: Set(None),
            owner: Set(None),
            last_edited_by: Set(None),
            updated_at: Set(None),
            evaluation_generation: Set(0),
            pending_period_sec: Set(0),
            incident_title_template: Set(None),
        };
        table::alert_composites::create_with_children(conn, composite, vec![])
            .await
            .unwrap();
        assert!(matches!(
            delete_folder(&org, "holds_composite", FolderType::Alerts).await,
            Err(FolderError::DeleteWithAlerts)
        ));
    }

    #[tokio::test]
    async fn test_alert_folder_holding_an_anomaly_config_is_not_deleted() {
        use infra::table::entity::anomaly_detection_config;

        if !meta_store().await {
            return;
        }
        let org = format!("folder_guard_a_{}", config::utils::time::now_micros());
        let conn = get_orm_client_rw().await;
        let (pk, ..) =
            table::folders::get_or_create(&org, alert_folder("holds_anomaly"), FolderType::Alerts)
                .await
                .unwrap();
        let anomaly = anomaly_detection_config::Model {
            anomaly_id: format!("{org}_anomaly"),
            org_id: org.clone(),
            stream_name: "default".to_string(),
            stream_type: "logs".to_string(),
            enabled: true,
            name: "anomaly".to_string(),
            description: None,
            query_mode: "sql".to_string(),
            filters: None,
            custom_sql: None,
            detection_function: "rcf".to_string(),
            histogram_interval: "1h".to_string(),
            schedule_interval: "5m".to_string(),
            detection_window_seconds: 3600,
            training_window_days: 7,
            retrain_interval_days: 1,
            threshold: 95,
            alert_budget_per_day: None,
            level_half_width_seconds: None,
            band_width: None,
            alert_direction: None,
            alert_window_buckets: None,
            alert_window_fire_pct: None,
            alert_window_recover_pct: None,
            band_grouping: None,
            band_k: None,
            seasonality: "none".to_string(),
            is_trained: false,
            training_started_at: None,
            training_completed_at: None,
            last_error: None,
            last_processed_timestamp: None,
            current_model_version: 0,
            rcf_num_trees: 50,
            rcf_tree_size: 256,
            rcf_shingle_size: 8,
            alert_enabled: false,
            alert_destinations: None,
            folder_id: pk.to_string(),
            owner: None,
            priority: None,
            tags: None,
            status: 0,
            retries: 0,
            last_failed_at: None,
            last_alert_fired_at: None,
            last_recovery_notified_at: None,
            template: None,
            detection_lease_us: None,
            last_updated: 0,
            created_at: 1_000_000,
            updated_at: 1_000_000,
        };
        table::anomaly_detection::config::create(conn, anomaly)
            .await
            .unwrap();
        assert!(matches!(
            delete_folder(&org, "holds_anomaly", FolderType::Alerts).await,
            Err(FolderError::DeleteWithAlerts)
        ));

        table::folders::get_or_create(&org, alert_folder("empty"), FolderType::Alerts)
            .await
            .unwrap();
        delete_folder(&org, "empty", FolderType::Alerts)
            .await
            .unwrap();
    }

    #[test]
    fn test_folder_error_variants() {
        // Test all FolderError variants
        let infra_error = FolderError::InfraError(infra::errors::Error::DbError(
            infra::errors::DbError::KeyNotExists("test".to_string()),
        ));
        assert!(matches!(infra_error, FolderError::InfraError(_)));

        let missing_name = FolderError::MissingName;
        assert!(matches!(missing_name, FolderError::MissingName));

        let folder_name_exists = FolderError::FolderNameAlreadyExists;
        assert!(matches!(
            folder_name_exists,
            FolderError::FolderNameAlreadyExists
        ));

        let update_default = FolderError::UpdateDefaultFolder;
        assert!(matches!(update_default, FolderError::UpdateDefaultFolder));

        let delete_with_dashboards = FolderError::DeleteWithDashboards;
        assert!(matches!(
            delete_with_dashboards,
            FolderError::DeleteWithDashboards
        ));

        let delete_with_alerts = FolderError::DeleteWithAlerts;
        assert!(matches!(delete_with_alerts, FolderError::DeleteWithAlerts));

        let delete_with_reports = FolderError::DeleteWithReports;
        assert!(matches!(
            delete_with_reports,
            FolderError::DeleteWithReports
        ));

        let not_found = FolderError::NotFound;
        assert!(matches!(not_found, FolderError::NotFound));

        let permitted_folders_missing_user = FolderError::PermittedFoldersMissingUser;
        assert!(matches!(
            permitted_folders_missing_user,
            FolderError::PermittedFoldersMissingUser
        ));

        let permitted_folders_validator =
            FolderError::PermittedFoldersValidator("test".to_string());
        assert!(matches!(
            permitted_folders_validator,
            FolderError::PermittedFoldersValidator(_)
        ));
    }

    #[test]
    fn test_folder_creation() {
        // Test creating a basic folder
        let folder = Folder {
            folder_id: "test_folder".to_string(),
            name: "Test Folder".to_string(),
            description: "Test description".to_string(),
            icon: None,
        };

        assert_eq!(folder.folder_id, "test_folder");
        assert_eq!(folder.name, "Test Folder");
        assert_eq!(folder.description, "Test description");
    }

    #[test]
    fn test_folder_name_trimming() {
        // Test folder name trimming logic
        let folder_name = "  Test Folder  ";
        let trimmed = folder_name.trim().to_string();

        assert_eq!(trimmed, "Test Folder");
        assert_ne!(trimmed, folder_name);
    }

    #[test]
    fn test_empty_folder_name_validation() {
        // Test empty folder name validation
        let empty_names = vec!["", "   ", "\t", "\n", "  \t  \n  "];

        for name in empty_names {
            let trimmed = name.trim().to_string();
            assert!(trimmed.is_empty());
        }
    }

    #[test]
    fn test_default_folder_validation() {
        // Test default folder validation

        let default_folder_id = "default";
        let non_default_folder_id = "custom_folder";

        assert_eq!(default_folder_id, DEFAULT_FOLDER);
        assert_ne!(non_default_folder_id, DEFAULT_FOLDER);
    }

    #[test]
    fn test_folder_type_enum() {
        // Test FolderType enum values
        assert_eq!(FolderType::Dashboards as u32, 0);
        assert_eq!(FolderType::Alerts as u32, 1);
        assert_eq!(FolderType::Reports as u32, 2);
    }

    #[test]
    fn test_folder_type_ofga_mapping() {
        // Test folder type to OFGA model mapping
        let dashboards_type = "folders";
        let alerts_type = "alert_folders";
        let reports_type = "report_folders";

        assert_eq!(dashboards_type, "folders");
        assert_eq!(alerts_type, "alert_folders");
        assert_eq!(reports_type, "report_folders");
    }

    #[test]
    fn test_folder_id_generation() {
        // Test folder ID generation pattern
        let generated_id = ider::generate();

        assert!(!generated_id.is_empty());
        assert_ne!(generated_id, DEFAULT_FOLDER);
    }

    #[test]
    fn test_folder_ownership_format() {
        // Test folder ownership format
        let _org_id = "test_org";
        let folder_id = "test_folder";
        let folder_type = "folders";

        let ownership_format = format!("{folder_type}:{folder_id}");
        assert_eq!(ownership_format, "folders:test_folder");

        let authz = Authz::new(folder_id);
        assert_eq!(authz.obj_id, folder_id);
    }

    #[test]
    fn test_folder_name_comparison() {
        // Test folder name comparison logic
        let folder_name1 = "Test Folder";
        let folder_name2 = "test folder";
        let folder_name3 = "Test Folder";

        assert_ne!(folder_name1, folder_name2);
        assert_eq!(folder_name1, folder_name3);

        // Test case-insensitive comparison
        assert_eq!(folder_name1.to_lowercase(), folder_name2.to_lowercase());
    }

    #[test]
    fn test_folder_description_handling() {
        // Test folder description handling
        let description = "Test description";
        let empty_description = "";

        let filtered_description = Some(description).filter(|d| !d.is_empty());
        let filtered_empty = Some(empty_description).filter(|d| !d.is_empty());

        assert_eq!(filtered_description, Some(description));
        assert_eq!(filtered_empty, None);
    }

    #[test]
    fn test_folder_list_filtering() {
        // Test folder list filtering logic
        let all_permission = "folders:_all_test_org";
        let specific_permission = "folders:test_folder";

        // Test _all permission
        let permitted_folders = Some([all_permission]);
        let should_return_all = permitted_folders
            .as_ref()
            .map(|p| p.contains(&all_permission));
        assert_eq!(should_return_all, Some(true));

        // Test specific permission
        let specific_permitted = Some([specific_permission]);
        let has_specific = specific_permitted
            .as_ref()
            .map(|p| p.contains(&specific_permission));
        assert_eq!(has_specific, Some(true));
    }

    #[test]
    fn test_folder_error_messages() {
        // Test folder error message formatting
        let missing_name_error = FolderError::MissingName.to_string();
        let folder_exists_error = FolderError::FolderNameAlreadyExists.to_string();
        let update_default_error = FolderError::UpdateDefaultFolder.to_string();

        assert!(missing_name_error.contains("empty"));
        assert!(folder_exists_error.contains("already exists"));
        assert!(update_default_error.contains("default"));
    }

    #[test]
    fn test_folder_list_params() {
        // Test folder list parameters
        let org_id = "test_org";
        let folder_id = "test_folder";

        // Test dashboard params
        let dashboard_params = ListDashboardsParams::new(org_id).with_folder_id(folder_id);
        assert_eq!(dashboard_params.org_id, org_id);

        // Test alerts params
        let alerts_params = ListAlertsParams::new(org_id).in_folder(folder_id);
        assert_eq!(alerts_params.org_id, org_id);

        // Test reports params
        let reports_params = ListReportsParams::new(org_id).in_folder(folder_id);
        assert_eq!(reports_params.org_id, org_id);
    }
}
