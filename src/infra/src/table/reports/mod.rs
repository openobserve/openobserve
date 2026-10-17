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

mod intermediate;
mod queries;
mod relations;

use chrono::Utc;
use config::meta::{
    dashboards::reports::{ListReportsParams, Report as MetaReport},
    folder::{Folder as MetaFolder, FolderType},
};
pub use intermediate::convert_str_to_meta_report_timerange;
pub use queries::ListReportsQueryResult;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, Condition, ConnectionTrait, EntityTrait,
    ModelTrait, QueryFilter, Set, TransactionTrait, sea_query::Expr,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::{report_dashboards, reports};

/// The outcome of a report's latest run.
#[derive(Debug, Clone, PartialEq)]
pub struct LastRun {
    pub at: i64,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Json(#[from] serde_json::Error),

    #[error(transparent)]
    SeaOrm(#[from] sea_orm::error::DbErr),

    #[error("Report not found.")]
    ReportNotFound,

    #[error("Dashboard not found.")]
    DashboardNotFound,

    #[error("Report folder not found.")]
    ReportFolderNotFound,

    #[error("Frequency interval cannot be negative.")]
    NegativeFrequencyInterval,
}

/// Gets a report by its name.
pub async fn get_by_name<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    report_name: &str,
) -> Result<Option<(MetaFolder, MetaReport)>, Error> {
    let txn = conn.begin().await?;
    let Some(models) = queries::SelectReportAndJoinRelationsResult::get(
        &txn,
        org_id,
        folder_snowflake_id,
        report_name,
    )
    .await?
    else {
        return Ok(None);
    };
    txn.commit().await?;
    let (folder, report) = models.try_into()?;
    Ok(Some((folder, report)))
}

pub async fn get_by_id<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    report_id: &str,
) -> Result<Option<(MetaFolder, MetaReport)>, Error> {
    let txn = conn.begin().await?;
    let Some(models) =
        queries::SelectReportAndJoinRelationsResult::get_by_id(&txn, report_id).await?
    else {
        return Ok(None);
    };
    txn.commit().await?;
    let (folder, report) = models.try_into()?;
    Ok(Some((folder, report)))
}

/// Gets a report and its KSUID by its name, from one read.
pub async fn get_with_id_by_name<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    report_name: &str,
) -> Result<Option<(String, MetaReport)>, Error> {
    let Some(models) = queries::SelectReportAndJoinRelationsResult::get(
        conn,
        org_id,
        folder_snowflake_id,
        report_name,
    )
    .await?
    else {
        return Ok(None);
    };
    let id = models.report.id.clone();
    let (_, report) = models.try_into()?;
    Ok(Some((id, report)))
}

/// Creates a new report.
///
/// The new report is created in the report folder with the given `folder_snowflake_id`.
///
/// If the optional `report_id` is given, then that will be used as the new report's ID. If none is
/// given then a random ID will be generated.
pub async fn create_report<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    report: MetaReport,
    report_id: Option<Ksuid>,
) -> Result<(String, MetaReport), Error> {
    let txn = conn.begin().await?;

    let report_id = report_id
        .unwrap_or_else(|| Ksuid::new(None, None))
        .to_string();
    let now = Utc::now().timestamp_micros();

    // Try to get the primary key of report folder.
    let Some(report_folder_model) = super::folders::get_model(
        &txn,
        &report.org_id,
        folder_snowflake_id,
        FolderType::Reports,
    )
    .await?
    else {
        return Err(Error::ReportFolderNotFound);
    };

    // Convert frequency into an intermediate type which can be serialized into a JSON schema that
    // the DB expects.
    let frequency_intermediate: intermediate::ReportFrequency = report
        .frequency
        .try_into()
        .map_err(|_| Error::NegativeFrequencyInterval)?;
    let frequency_json = serde_json::to_value(frequency_intermediate)?;

    // Convert destinations into an intermediate type which can be serialized into a JSON schema
    // that the DB expects.
    let destinations_intermediate: intermediate::ReportDestinations =
        report.destinations.clone().into();
    let destinations_json = serde_json::to_value(destinations_intermediate)?;

    // Create the new `report` record.
    let report_active_model = reports::ActiveModel {
        id: Set(report_id.clone()),
        org: Set(report.org_id.clone()),
        folder_id: Set(report_folder_model.id.clone()),
        name: Set(report.name),
        title: Set(report.title),
        description: Set(Some(report.description).filter(|s| !s.is_empty())),
        enabled: Set(report.enabled),
        frequency: Set(frequency_json),
        destinations: Set(destinations_json),
        message: Set(Some(report.message).filter(|s| !s.is_empty())),
        timezone: Set(report.timezone),
        tz_offset: Set(report.tz_offset),
        owner: Set(Some(report.owner).filter(|s| !s.is_empty())),
        last_edited_by: Set(Some(report.last_edited_by).filter(|s| !s.is_empty())),
        created_at: Set(now),
        updated_at: Set(Some(now)),
        start_at: Set(report.start),
        image_preview: Set(report.image_preview),
        last_run_at: NotSet,
        last_run_status: NotSet,
        last_run_error: NotSet,
    };
    let report_model = report_active_model.insert(&txn).await?;

    // Create new `report_dashboards` relation records.
    let existing_rltns = vec![];
    let desired_rltns = report.dashboards;
    let rltns_to_create = relations::relations_to_create(
        &txn,
        &report.org_id,
        &report_id,
        &existing_rltns,
        &desired_rltns,
    )
    .await?;
    report_dashboards::Entity::insert_many(rltns_to_create)
        .exec(&txn)
        .await?;

    // Convert the newly created records into a domain model
    let joined_models = queries::JoinReportDashboardFolderResults::get(&txn, &report_id).await?;
    let models = queries::SelectReportAndJoinRelationsResult {
        report: report_model,
        report_folder: report_folder_model,
        joined_dashboards: joined_models,
    };
    let (_folder, report) = models.try_into()?;

    txn.commit().await?;
    Ok((report_id, report))
}

/// Updates the report.
///
/// Uses the `folder_snowflake_id` and `report.name` to find the report to update.
///
/// Optionally moves the report to a new folder if `new_folder_snowflake_id` is given.
pub async fn update_report<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    new_folder_snowflake_id: Option<&str>,
    report: MetaReport,
) -> Result<String, Error> {
    let txn = conn.begin().await?;

    let Some(models) = queries::SelectReportAndJoinRelationsResult::get(
        conn,
        &report.org_id,
        folder_snowflake_id,
        &report.name,
    )
    .await?
    else {
        return Err(Error::ReportNotFound);
    };

    // Try to get the primary key of the folder with the new folder snowflake ID if one is given.
    let folder_id = if let Some(new_folder_snowflake_id) = new_folder_snowflake_id {
        let maybe_folder_model = super::folders::get_model(
            &txn,
            &report.org_id,
            new_folder_snowflake_id,
            FolderType::Reports,
        )
        .await?;
        let folder_model = maybe_folder_model.ok_or(Error::ReportFolderNotFound)?;
        Set(folder_model.id)
    } else {
        NotSet
    };

    // Convert frequency into an intermediate type which can be serialized into a JSON schema that
    // the DB expects.
    let frequency_intermediate: intermediate::ReportFrequency = report
        .frequency
        .try_into()
        .map_err(|_| Error::NegativeFrequencyInterval)?;
    let frequency_json = serde_json::to_value(frequency_intermediate)?;

    // Convert destinations into an intermediate type which can be serialized into a JSON schema
    // that the DB expects.
    let destinations_intermediate: intermediate::ReportDestinations =
        report.destinations.clone().into();
    let destinations_json = serde_json::to_value(destinations_intermediate)?;

    // Update the `reports` record.
    let report_active_model = reports::ActiveModel {
        id: Set(models.report.id.clone()),
        org: Set(models.report.org.clone()),
        folder_id,
        name: Set(report.name),
        title: Set(report.title),
        description: Set(Some(report.description).filter(|s| !s.is_empty())),
        enabled: Set(report.enabled),
        frequency: Set(frequency_json),
        destinations: Set(destinations_json),
        message: Set(Some(report.message).filter(|s| !s.is_empty())),
        timezone: Set(report.timezone),
        tz_offset: Set(report.tz_offset),
        owner: Set(Some(report.owner).filter(|s| !s.is_empty())),
        last_edited_by: Set(Some(report.last_edited_by).filter(|s| !s.is_empty())),
        created_at: NotSet, // Never updated after creation.
        updated_at: Set(Some(Utc::now().timestamp_micros())),
        start_at: Set(report.start),
        image_preview: Set(report.image_preview),
        last_run_at: NotSet,
        last_run_status: NotSet,
        last_run_error: NotSet,
    };
    report_active_model.update(&txn).await?;

    // Determine which `report_dashboards` records to create, update, and delete.
    let existing_rltns = models.joined_dashboards;
    let desired_rltns = report.dashboards;
    let rltns_to_create = relations::relations_to_create(
        &txn,
        &report.org_id,
        &models.report.id,
        &existing_rltns,
        &desired_rltns,
    )
    .await?;
    let rltns_to_update = relations::relations_to_update(&existing_rltns, &desired_rltns)?;
    let rltns_to_delete = relations::relations_to_delete(&existing_rltns, &desired_rltns);

    if !rltns_to_create.is_empty() {
        report_dashboards::Entity::insert_many(rltns_to_create)
            .exec(&txn)
            .await?;
    }
    for rltn_active_model in rltns_to_update {
        rltn_active_model.update(&txn).await?;
    }
    for rltn_pk in rltns_to_delete {
        report_dashboards::Entity::delete_by_id(rltn_pk)
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(models.report.id)
}

/// Deletes a report by its KSUID.
pub async fn delete_by_id<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    report_id: &str,
) -> Result<String, Error> {
    let txn = conn.begin().await?;
    let Some(report_model) = reports::Entity::find()
        .filter(reports::Column::Id.eq(report_id))
        .one(&txn)
        .await?
    else {
        return Ok(String::new());
    };
    let id = report_model.id.clone();
    report_model.delete(&txn).await?;
    txn.commit().await?;
    Ok(id)
}

/// Updates the report identified by its KSUID.
///
/// Optionally moves it to a new folder if `new_folder_snowflake_id` is given.
pub async fn update_by_id<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    report_id: &str,
    new_folder_snowflake_id: Option<&str>,
    report: MetaReport,
) -> Result<String, Error> {
    let txn = conn.begin().await?;

    let Some(models) =
        queries::SelectReportAndJoinRelationsResult::get_by_id(&txn, report_id).await?
    else {
        return Err(Error::ReportNotFound);
    };

    // Resolve the new folder FK if moving.
    let folder_id = if let Some(new_folder_snowflake_id) = new_folder_snowflake_id {
        let maybe_folder_model = super::folders::get_model(
            &txn,
            &report.org_id,
            new_folder_snowflake_id,
            FolderType::Reports,
        )
        .await?;
        let folder_model = maybe_folder_model.ok_or(Error::ReportFolderNotFound)?;
        Set(folder_model.id)
    } else {
        NotSet
    };

    let frequency_intermediate: intermediate::ReportFrequency = report
        .frequency
        .try_into()
        .map_err(|_| Error::NegativeFrequencyInterval)?;
    let frequency_json = serde_json::to_value(frequency_intermediate)?;

    let destinations_intermediate: intermediate::ReportDestinations =
        report.destinations.clone().into();
    let destinations_json = serde_json::to_value(destinations_intermediate)?;

    let report_active_model = reports::ActiveModel {
        id: Set(models.report.id.clone()),
        org: Set(models.report.org.clone()),
        folder_id,
        name: Set(report.name),
        title: Set(report.title),
        description: Set(Some(report.description).filter(|s| !s.is_empty())),
        enabled: Set(report.enabled),
        frequency: Set(frequency_json),
        destinations: Set(destinations_json),
        message: Set(Some(report.message).filter(|s| !s.is_empty())),
        timezone: Set(report.timezone),
        tz_offset: Set(report.tz_offset),
        owner: Set(Some(report.owner).filter(|s| !s.is_empty())),
        last_edited_by: Set(Some(report.last_edited_by).filter(|s| !s.is_empty())),
        created_at: NotSet,
        updated_at: Set(Some(Utc::now().timestamp_micros())),
        start_at: Set(report.start),
        image_preview: Set(report.image_preview),
        last_run_at: NotSet,
        last_run_status: NotSet,
        last_run_error: NotSet,
    };
    report_active_model.update(&txn).await?;

    // Update report_dashboards relations.
    let existing_rltns = models.joined_dashboards;
    let desired_rltns = report.dashboards;
    let rltns_to_create = relations::relations_to_create(
        &txn,
        &report.org_id,
        &models.report.id,
        &existing_rltns,
        &desired_rltns,
    )
    .await?;
    let rltns_to_update = relations::relations_to_update(&existing_rltns, &desired_rltns)?;
    let rltns_to_delete = relations::relations_to_delete(&existing_rltns, &desired_rltns);

    if !rltns_to_create.is_empty() {
        report_dashboards::Entity::insert_many(rltns_to_create)
            .exec(&txn)
            .await?;
    }
    for rltn_active_model in rltns_to_update {
        rltn_active_model.update(&txn).await?;
    }
    for rltn_pk in rltns_to_delete {
        report_dashboards::Entity::delete_by_id(rltn_pk)
            .exec(&txn)
            .await?;
    }

    txn.commit().await?;
    Ok(models.report.id)
}

/// Deletes a report by its name.
pub async fn delete_by_name<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    report_name: &str,
) -> Result<String, Error> {
    let txn = conn.begin().await?;
    let Some((_folder_model, Some(report_model))) =
        queries::get_report_from_folder(&txn, org_id, folder_snowflake_id, report_name).await?
    else {
        return Ok(String::new());
    };
    let report_id = report_model.id.clone();
    report_model.delete(&txn).await?;
    txn.commit().await?;
    Ok(report_id)
}

/// Stores a report's latest run; an older run never overwrites a newer one, so late replicas no-op.
pub async fn set_last_run(
    org: &str,
    report_id: &str,
    at: i64,
    status: &str,
    error: Option<&str>,
) -> Result<(), Error> {
    let client = crate::db::get_orm_client_rw().await;
    reports::Entity::update_many()
        .col_expr(reports::Column::LastRunAt, Expr::value(at))
        .col_expr(reports::Column::LastRunStatus, Expr::value(status))
        .col_expr(
            reports::Column::LastRunError,
            Expr::value(error.map(str::to_string)),
        )
        .filter(reports::Column::Org.eq(org))
        .filter(reports::Column::Id.eq(report_id))
        .filter(
            Condition::any()
                .add(reports::Column::LastRunAt.is_null())
                .add(reports::Column::LastRunAt.lte(at)),
        )
        .exec(client)
        .await?;
    Ok(())
}

/// The outcome of a report's latest run, if it has run.
pub async fn get_last_run<C: ConnectionTrait>(
    conn: &C,
    report_id: &str,
) -> Result<Option<LastRun>, Error> {
    let found = reports::Entity::find_by_id(report_id).one(conn).await?;
    Ok(found.and_then(|m| {
        Some(LastRun {
            at: m.last_run_at?,
            status: m.last_run_status.unwrap_or_default(),
            error: m.last_run_error,
        })
    }))
}

/// Delete all reports.
pub async fn delete_all<C: ConnectionTrait>(conn: &C) -> Result<(), Error> {
    reports::Entity::delete_many().exec(conn).await?;
    Ok(())
}

/// Deletes every report of the org; returns each `(id, folder_id)`, the folder's own id.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<(String, String)>, Error> {
    use sea_orm::QuerySelect;

    use super::entity::folders;

    let txn = crate::db::get_orm_client_rw().await.begin().await?;
    let folder_ids: std::collections::HashMap<String, String> = folders::Entity::find()
        .select_only()
        .column(folders::Column::Id)
        .column(folders::Column::FolderId)
        .filter(folders::Column::Org.eq(org_id))
        .into_tuple::<(String, String)>()
        .all(&txn)
        .await?
        .into_iter()
        .collect();
    let delete = reports::Entity::delete_many().filter(reports::Column::Org.eq(org_id));
    let deleted: Vec<(String, String)> = crate::table::delete_returning(
        &txn,
        delete,
        &[reports::Column::Id, reports::Column::FolderId],
    )
    .await?;
    txn.commit().await?;
    Ok(deleted
        .into_iter()
        .map(|(id, pk)| (id, folder_ids.get(&pk).cloned().unwrap_or(pk)))
        .collect())
}

/// Each report of the org with its folder's `folder_id`, including reports no dashboard joins.
pub async fn list_ids_by_org<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<(String, String)>, Error> {
    use sea_orm::{QuerySelect, RelationTrait};

    use super::entity::folders;

    let ids = reports::Entity::find()
        .select_only()
        .column(reports::Column::Id)
        .column(folders::Column::FolderId)
        .join(
            sea_orm::JoinType::InnerJoin,
            reports::Relation::Folders.def(),
        )
        .filter(reports::Column::Org.eq(org_id))
        .into_tuple::<(String, String)>()
        .all(conn)
        .await?;
    Ok(ids)
}

/// Lists the reports the satisfy the given parameters.
pub async fn list_reports<C: ConnectionTrait>(
    conn: &C,
    params: &ListReportsParams,
) -> Result<Vec<ListReportsQueryResult>, Error> {
    let reports = queries::ListReportsQueryResult::get(conn, params).await?;
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_report_not_found_display() {
        assert_eq!(Error::ReportNotFound.to_string(), "Report not found.");
    }

    #[test]
    fn test_error_dashboard_not_found_display() {
        assert_eq!(Error::DashboardNotFound.to_string(), "Dashboard not found.");
    }

    #[test]
    fn test_error_report_folder_not_found_display() {
        assert_eq!(
            Error::ReportFolderNotFound.to_string(),
            "Report folder not found."
        );
    }

    #[test]
    fn test_error_negative_frequency_interval_display() {
        assert_eq!(
            Error::NegativeFrequencyInterval.to_string(),
            "Frequency interval cannot be negative."
        );
    }

    #[test]
    fn test_error_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json {{").unwrap_err();
        let err: Error = json_err.into();
        assert!(matches!(err, Error::Json(_)));
    }
}
