// Copyright 2025 OpenObserve Inc.
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

use config::meta::{
    dashboards::reports::{ListReportsParams, Report},
    folder::{DEFAULT_FOLDER, Folder, FolderType},
};
use infra::table;
use sea_orm::{ConnectionTrait, TransactionTrait};

use crate::service::{dashboards::reports::ReportError, db, folders};

pub async fn get<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    name: &str,
) -> Result<Report, anyhow::Error> {
    match table::reports::get_by_name(conn, org_id, folder_snowflake_id, name).await? {
        Some((_, report)) => Ok(report),
        _ => Err(anyhow::anyhow!("Report not found")),
    }
}

pub async fn get_by_id<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    id: &str,
) -> Result<Report, anyhow::Error> {
    match table::reports::get_by_id(conn, id).await? {
        Some((_, report)) => Ok(report),
        _ => Err(anyhow::anyhow!("Report not found")),
    }
}

pub async fn create<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    report: Report,
) -> Result<(), anyhow::Error> {
    let org = report.org_id.clone();
    let next_run_at = report.start;

    let report_id = create_without_updating_trigger(conn, folder_snowflake_id, report).await?;
    let trigger = db::scheduler::Trigger {
        org,
        module: db::scheduler::TriggerModule::Report,
        module_key: report_id,
        next_run_at,
        ..Default::default()
    };
    db::scheduler::push(trigger)
        .await
        .inspect_err(|e| log::error!("Failed to save trigger: {e}"))?;
    Ok(())
}

pub async fn update<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    new_folder_snowflake_id: Option<&str>,
    report: Report,
) -> Result<(), anyhow::Error> {
    let org_id = report.org_id.clone();
    let next_run_at = report.start;

    let report_id =
        update_without_updating_trigger(conn, folder_snowflake_id, new_folder_snowflake_id, report)
            .await?;
    let scheduler_exists =
        db::scheduler::exists(&org_id, db::scheduler::TriggerModule::Report, &report_id).await;

    let trigger = db::scheduler::Trigger {
        org: org_id.clone(),
        module: db::scheduler::TriggerModule::Report,
        module_key: report_id,
        next_run_at,
        ..Default::default()
    };
    if scheduler_exists {
        db::scheduler::update_trigger(trigger, false, "")
            .await
            .inspect_err(|e| log::error!("Failed to update trigger: {e}"))?;
    } else {
        db::scheduler::push(trigger)
            .await
            .inspect_err(|e| log::error!("Failed to save trigger: {e}"))?;
    }

    Ok(())
}

pub async fn create_without_updating_trigger<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    report: Report,
) -> Result<String, anyhow::Error> {
    // Check if the folder_id is default and if it already exists.
    if folder_snowflake_id == DEFAULT_FOLDER
        && !table::folders::exists(&report.org_id, DEFAULT_FOLDER, FolderType::Reports).await?
    {
        create_default_reports_folder(&report.org_id).await?;
    }
    let (report_id, _) =
        table::reports::create_report(conn, folder_snowflake_id, report.clone(), None).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::emit_create_event(
        &report.org_id.clone(),
        folder_snowflake_id,
        &report_id,
        report,
    )
    .await?;
    Ok(report_id)
}

async fn create_default_reports_folder(org_id: &str) -> Result<Folder, ReportError> {
    let default_folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: "default".to_owned(),
        description: "default".to_owned(),
    };
    folders::save_folder(org_id, default_folder, FolderType::Reports, true)
        .await
        .map_err(|_| ReportError::CreateDefaultFolderError)
}

pub async fn update_without_updating_trigger<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    folder_snowflake_id: &str,
    new_folder_snowflake_id: Option<&str>,
    report: Report,
) -> Result<String, anyhow::Error> {
    let report_id = table::reports::update_report(
        conn,
        folder_snowflake_id,
        new_folder_snowflake_id,
        report.clone(),
    )
    .await?;

    #[cfg(feature = "enterprise")]
    super_cluster::emit_update_event(
        &report.org_id.clone(),
        folder_snowflake_id,
        new_folder_snowflake_id,
        report,
    )
    .await?;
    Ok(report_id)
}

pub async fn delete<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    name: &str,
) -> Result<(), anyhow::Error> {
    let report_id = table::reports::delete_by_name(conn, org_id, folder_snowflake_id, name)
        .await
        .map_err(|e| anyhow::anyhow!("Error deleting report: {}", e))?;
    let _ = db::scheduler::delete(org_id, db::scheduler::TriggerModule::Report, &report_id)
        .await
        .inspect_err(|e| log::error!("Failed to delete trigger: {e}"));
    #[cfg(feature = "enterprise")]
    super_cluster::emit_delete_event(org_id, folder_snowflake_id, name).await?;
    Ok(())
}

pub async fn list<C: ConnectionTrait>(
    conn: &C,
    params: &ListReportsParams,
) -> Result<Vec<table::reports::ListReportsQueryResult>, anyhow::Error> {
    let reports = table::reports::list_reports(conn, params).await?;
    Ok(reports)
}

pub async fn reset<C: ConnectionTrait>(conn: &C) -> Result<(), anyhow::Error> {
    table::reports::delete_all(conn).await?;
    #[cfg(feature = "enterprise")]
    super_cluster::reset().await?;
    Ok(())
}

/// Helper functions for sending events to the super cluster queue.
#[cfg(feature = "enterprise")]
mod super_cluster {
    use config::meta::dashboards::reports::Report;
    use infra::errors::Error;
    use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

    /// Sends event to the super cluster queue indicating that an report has been
    /// created in the database.
    pub async fn emit_create_event(
        org_id: &str,
        folder_id: &str,
        report_id: &str,
        report: Report,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            log::debug!("Sending super cluster report creation event: {report:?}");
            o2_enterprise::enterprise::super_cluster::queue::reports_create(
                org_id, folder_id, report_id, report,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that an report has been
    /// updated in the database.
    pub async fn emit_update_event(
        org: &str,
        folder_snowflake_id: &str,
        new_folder_snowflake_id: Option<&str>,
        report: Report,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            log::debug!("Sending super cluster report update event: {report:?}");
            o2_enterprise::enterprise::super_cluster::queue::reports_update(
                org,
                folder_snowflake_id,
                new_folder_snowflake_id,
                report,
            )
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that an report has been
    /// deleted from the database.
    pub async fn emit_delete_event(
        org: &str,
        folder_id: &str,
        name: &str,
    ) -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            log::debug!("Sending super cluster report delete event: {name:?}");
            o2_enterprise::enterprise::super_cluster::queue::reports_delete(org, folder_id, name)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }

    /// Sends event to the super cluster queue indicating that all reports have
    /// been deleted from the database.
    pub async fn reset() -> Result<(), infra::errors::Error> {
        if get_o2_config().super_cluster.enabled {
            o2_enterprise::enterprise::super_cluster::queue::reports_reset()
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use config::meta::dashboards::reports::{
        Report, ReportDashboard, ReportDestination, ReportFrequency, ReportFrequencyType,
        ReportMediaType, ReportTimerange,
    };

    fn create_test_report() -> Report {
        Report {
            name: "test_report".to_string(),
            org_id: "test_org".to_string(),
            title: "Test Report".to_string(),
            description: "Test description".to_string(),
            dashboards: vec![ReportDashboard {
                dashboard: "test_dashboard".to_string(),
                folder: "default".to_string(),
                tabs: vec![],
                variables: vec![],
                timerange: ReportTimerange::default(),
            }],
            destinations: vec![ReportDestination::Email("test@example.com".to_string())],
            frequency: ReportFrequency::default(),
            enabled: true,
            start: chrono::Utc::now().timestamp_micros(),
            message: "Test message".to_string(),
            media_type: ReportMediaType::Pdf,
            timezone: "UTC".to_string(),
            tz_offset: 0,
            created_at: config::meta::dashboards::datetime_now(),
            updated_at: None,
            owner: "test_owner".to_string(),
            last_edited_by: "test_editor".to_string(),
        }
    }

    #[test]
    fn test_report_creation() {
        let report = create_test_report();
        assert_eq!(report.name, "test_report");
        assert_eq!(report.org_id, "test_org");
        assert_eq!(report.title, "Test Report");
        assert!(report.enabled);
        assert_eq!(report.destinations.len(), 1);
        assert_eq!(report.frequency.frequency_type, ReportFrequencyType::Weeks);
    }
}
