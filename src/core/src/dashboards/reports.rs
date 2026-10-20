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

use std::{str::FromStr, time::Duration};

use async_trait::async_trait;
use chromiumoxide::{Page, browser::Browser, cdp::browser_protocol::page::PrintToPdfParams};
use chrono::Timelike;
use config::{
    SMTP_CLIENT,
    cluster::LOCAL_NODE,
    get_chrome_launch_options, get_config,
    meta::{
        alerts::fixed_offset,
        dashboards::{
            datetime_now,
            reports::{
                HttpReportPayload, REPORT_SECRET_HEADER, Report, ReportDashboard,
                ReportDestination, ReportEmailAttachmentType, ReportEmailDetails,
                ReportFrequencyType, ReportListFilters, ReportMediaType, ReportTimerangeType,
                format_dashb_var,
            },
        },
        folder::Folder,
        self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
    },
    utils::time::now_micros,
};
use cron::Schedule;
use db::{
    self,
    authz::{remove_ownership, set_ownership},
    dashboards::dashboard_in_org,
};
use futures::{
    StreamExt,
    future::{self, try_join_all},
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table,
};
use itertools::Itertools;
use lettre::{
    AsyncTransport, Message,
    message::{MultiPart, SinglePart, header::ContentType},
};
use reqwest::Client;
use serde::Deserialize;
use usage_reporting::publish_triggers_usage;

use crate::{
    alerts::alert::TZ_OFFSET_RANGE_MINUTES, auth::is_ofga_unsupported, common::meta::authz::Authz,
    short_url,
};

/// `trigger_source` of a run the scheduler started.
pub const TRIGGER_SOURCE_SCHEDULED: &str = "scheduled";
/// `trigger_source` of a run a user started with Run now.
pub const TRIGGER_SOURCE_MANUAL: &str = "manual";
/// Job claim used when `ZO_REPORT_SCHEDULE_TIMEOUT` is not positive; matches its default.
const DEFAULT_REPORT_SCHEDULE_TIMEOUT_SECS: u64 = 300;

/// Errors that can occur when interacting with reports.
#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error("SMTP configuration not enabled")]
    SmtpNotEnabled,

    #[error("Chrome not enabled")]
    ChromeNotEnabled,

    #[error("Report username and password ENVs not set")]
    ReportUsernamePasswordNotSet,

    #[error("Report name cannot contain ':', '#', '?', '&', '%', quotes and space characters")]
    NameContainsOpenFgaUnsupportedCharacters,

    #[error("Report name is required")]
    NameIsEmpty,

    #[error("Report name cannot contain '/'")]
    NameContainsForwardSlash,

    #[error("Report already exists")]
    CreateReportNameAlreadyUsed,

    #[error("Report organization does not match the organization in the request path")]
    OrgMismatch,

    #[error("Report not found")]
    ReportNotFound,

    #[error("Atleast one dashboard is required")]
    NoDashboards,

    #[error("Inline attachment type is only supported for PNG reports, not PDF")]
    InlineAttachmentTypeNotSupportedForPdf,

    #[error("Atleast one tab is required")]
    NoDashboardTabs,

    #[error("Atleast one destination is required")]
    NoDestinations,

    #[error("Some dashboards/tabs not found")]
    DashboardTabNotFound,

    #[error(transparent)]
    ParseCronError(#[from] cron::error::Error),

    #[error("Report tz_offset must be strictly between -1440 and 1440 minutes")]
    TzOffsetOutOfRange,

    #[error("Report cron schedule '{cron}' has no future occurrence")]
    CronHasNoFutureOccurrence { cron: String },

    #[error("Report frequency interval cannot be negative")]
    NegativeInterval,

    #[error(transparent)]
    DbError(anyhow::Error),

    #[error(transparent)]
    SendReportError(#[from] SendReportError),

    #[error("Error creating default reports folder")]
    CreateDefaultFolderError,

    #[error("Folder not found")]
    FolderNotFound,
}

pub async fn save(
    org_id: &str,
    folder_id: &str,
    name: &str,
    report: Report,
    create: bool,
) -> Result<(), ReportError> {
    let report = prepare_save(org_id, folder_id, name, report, create).await?;
    write_save(org_id, folder_id, report, create).await
}

/// Runs every check [`save`] makes and returns the report it would write.
pub async fn prepare_save(
    org_id: &str,
    folder_id: &str,
    name: &str,
    mut report: Report,
    create: bool,
) -> Result<Report, ReportError> {
    bind_to_path_org(&mut report, org_id)?;

    let conn = get_orm_client_rw().await;
    let cfg = get_config();
    if cfg.common.report_server_url.is_empty() {
        // Check if SMTP is enabled, otherwise don't save the report
        if !cfg.smtp.smtp_enabled && !report.destinations.is_empty() {
            return Err(ReportError::SmtpNotEnabled);
        }

        // Check if Chrome is enabled, otherwise don't save the report
        if !cfg.chrome.chrome_enabled || cfg.chrome.chrome_path.is_empty() {
            return Err(ReportError::ChromeNotEnabled);
        }

        if cfg.common.report_user_name.is_empty() || cfg.common.report_user_password.is_empty() {
            return Err(ReportError::ReportUsernamePasswordNotSet);
        }
    }

    if !name.is_empty() {
        report.name = name.to_string();
    }

    // Don't allow the characters not supported by ofga
    if is_ofga_unsupported(&report.name) {
        return Err(ReportError::NameContainsOpenFgaUnsupportedCharacters);
    }
    if report.name.is_empty() {
        return Err(ReportError::NameIsEmpty);
    }
    if report.name.contains('/') {
        return Err(ReportError::NameContainsForwardSlash);
    }

    validate_schedule(&mut report)?;

    match db::dashboards::reports::get(conn, org_id, folder_id, &report.name).await {
        Ok(old_report) => {
            if create {
                return Err(ReportError::CreateReportNameAlreadyUsed);
            }
            report.owner = old_report.owner;
            report.updated_at = Some(datetime_now());
        }
        Err(_) => {
            if !create {
                return Err(ReportError::ReportNotFound);
            }
        }
    }

    // Atleast one `ReportDashboard` needs to be present
    if report.dashboards.is_empty() {
        return Err(ReportError::NoDashboards);
    }

    // Inline attachment type is only valid for PNG reports
    if report.dashboards.iter().any(|d| {
        d.report_type == ReportMediaType::Pdf
            && d.email_attachment_type == ReportEmailAttachmentType::Inline
    }) {
        return Err(ReportError::InlineAttachmentTypeNotSupportedForPdf);
    }

    // Check if dashboards & tabs exist
    let mut tasks = Vec::with_capacity(report.dashboards.len());
    for dashboard in report.dashboards.iter() {
        let dash_id = &dashboard.dashboard;
        let folder = &dashboard.folder;
        if dashboard.tabs.is_empty() {
            return Err(ReportError::NoDashboardTabs);
        }

        // Supports only one tab for now
        let tab_id = &dashboard.tabs[0];
        tasks.push(async move {
            let maybe_dashboard =
                table::dashboards::get_from_folder(org_id, folder, dash_id).await?;
            // Check if the tab_id exists
            if let Some(dashboard) = maybe_dashboard.and_then(|d| d.v3) {
                let mut tab_found = false;
                for tab in dashboard.tabs {
                    if &tab.tab_id == tab_id {
                        tab_found = true;
                    }
                }
                if tab_found {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("Tab not found"))
                }
            } else {
                Ok(())
            }
        });
    }
    if try_join_all(tasks).await.is_err() {
        return Err(ReportError::DashboardTabNotFound);
    }
    Ok(report)
}

/// Writes a report [`prepare_save`] accepted.
pub async fn write_save(
    org_id: &str,
    folder_id: &str,
    report: Report,
    create: bool,
) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;
    if create {
        let report_id = db::dashboards::reports::create(conn, folder_id, report)
            .await
            .map_err(ReportError::DbError)?;
        set_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id,
                parent_type: "report_folders".to_owned(),
                parent: folder_id.to_owned(),
            },
        )
        .await;
    } else {
        db::dashboards::reports::update(conn, folder_id, None, report)
            .await
            .map_err(ReportError::DbError)?;
    }

    Ok(())
}

pub async fn get(org_id: &str, folder_id: &str, name: &str) -> Result<Report, ReportError> {
    let conn = get_orm_client_rw().await;
    db::dashboards::reports::get(conn, org_id, folder_id, name)
        .await
        .map_err(|_| ReportError::ReportNotFound)
}

pub async fn get_by_id(org_id: &str, report_id: &str) -> Result<(Folder, Report), ReportError> {
    let conn = get_orm_client_ro().await;
    match table::reports::get_by_id(conn, report_id).await {
        Ok(Some((folder, report))) if report.org_id == org_id => Ok((folder, report)),
        Ok(_) => Err(ReportError::ReportNotFound),
        Err(e) => Err(ReportError::DbError(anyhow::anyhow!(e))),
    }
}

pub async fn list(
    org_id: &str,
    filters: ReportListFilters,
    permitted: Option<Vec<String>>,
) -> Result<Vec<table::reports::ListReportsQueryResult>, ReportError> {
    let conn = get_orm_client_rw().await;
    let params = filters.into_params(org_id);
    let reports = db::dashboards::reports::list(conn, &params)
        .await
        .map_err(ReportError::DbError)?;
    let result = reports
        .into_iter()
        .filter(|report| {
            permitted.is_none()
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("report:{}", report.report_name))
                || permitted
                    .as_ref()
                    .unwrap()
                    .contains(&format!("report:_all_{org_id}"))
        })
        .collect_vec();
    Ok(result)
}

pub async fn delete(org_id: &str, folder_id: &str, name: &str) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;

    // Existence check — db::delete returns empty string if not found.
    if db::dashboards::reports::get(conn, org_id, folder_id, name)
        .await
        .is_err()
    {
        return Err(ReportError::ReportNotFound);
    }

    // db::delete now returns the KSUID of the deleted report.
    let report_id = db::dashboards::reports::delete(conn, org_id, folder_id, name)
        .await
        .map_err(ReportError::DbError)?;

    if !report_id.is_empty() {
        remove_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id,
                parent_type: "report_folders".to_owned(),
                parent: folder_id.to_owned(),
            },
        )
        .await;
    }
    Ok(())
}

pub async fn delete_by_id(org_id: &str, report_id: &str) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;
    let (folder, _) = get_by_id(org_id, report_id).await?;

    db::dashboards::reports::delete_by_id(conn, org_id, report_id)
        .await
        .map_err(ReportError::DbError)?;

    remove_ownership(
        org_id,
        "reports",
        Authz {
            obj_id: report_id.to_string(),
            parent_type: "report_folders".to_owned(),
            parent: folder.folder_id,
        },
    )
    .await;
    Ok(())
}

/// Sends a report now and returns the history row of that run; a failed send is a row too.
pub async fn trigger(
    org_id: &str,
    folder_id: &str,
    name: &str,
    user: &str,
) -> Result<TriggerData, ReportError> {
    let conn = get_orm_client_rw().await;
    let Ok(Some((report_id, report))) =
        table::reports::get_with_id_by_name(conn, org_id, folder_id, name).await
    else {
        return Err(ReportError::ReportNotFound);
    };
    Ok(run_manually(&report, &report_id, user).await)
}

/// Sends a report now and returns the history row of that run; a failed send is a row too.
pub async fn trigger_by_id(
    org_id: &str,
    report_id: &str,
    user: &str,
) -> Result<TriggerData, ReportError> {
    let (_, report) = get_by_id(org_id, report_id).await?;
    Ok(run_manually(&report, report_id, user).await)
}

/// The history row of one run of `report`, before its outcome is known.
pub fn run_row(report: &Report, report_id: &str, now: i64) -> TriggerData {
    let attachment_type = report.dashboards.first().map(|d| {
        match d.report_type {
            ReportMediaType::Pdf => "pdf",
            ReportMediaType::Png => "png",
            ReportMediaType::Csv => "csv",
        }
        .to_string()
    });
    TriggerData {
        _timestamp: now,
        org: report.org_id.clone(),
        module: if report.destinations.is_empty() {
            TriggerDataType::CachedReport
        } else {
            TriggerDataType::Report
        },
        key: format!("{}/{report_id}", report.name),
        status: RunOutcome::Succeeded,
        start_time: now,
        end_time: now,
        source_node: Some(LOCAL_NODE.name.clone()),
        trigger_source: Some(TRIGGER_SOURCE_SCHEDULED.to_string()),
        recipient_count: Some(i32::try_from(report.destinations.len()).unwrap_or(i32::MAX)),
        attachment_type,
        dashboard_count: Some(i32::try_from(report.dashboards.len()).unwrap_or(i32::MAX)),
        ..Default::default()
    }
}

/// Writes the outcome of a send into its run row.
pub fn apply_send_result(
    row: &mut TriggerData,
    result: &Result<SendOutcome, SendReportError>,
    started: std::time::Instant,
) {
    row.end_time = now_micros();
    row.evaluation_took_in_secs = Some(started.elapsed().as_secs_f64());
    match result {
        Ok(outcome) => {
            let recipients = row.recipient_count.unwrap_or_default();
            row.status = RunOutcome::Succeeded;
            row.is_partial = Some(outcome.partial);
            row.delivery_attempted = Some(recipients > 0);
            row.success_response = Some(if recipients > 0 {
                format!("sent to {recipients} recipients")
            } else {
                "cached".to_string()
            });
        }
        Err(e) => {
            row.status = RunOutcome::Error;
            row.error = Some(format!("error processing report: {e}"));
            row.delivery_attempted = e.delivery_attempted();
        }
    }
}

/// Publishes a run row to the triggers stream and stores it as the report's last run.
pub async fn record_run(report_id: &str, row: TriggerData) {
    let org = row.org.clone();
    let at = row.end_time;
    let status = row.status.as_str();
    let error = row.error.clone();
    publish_triggers_usage(row);
    // Written straight to the table: the list reads these columns from the database, not a cache.
    match table::reports::set_last_run(&org, report_id, at, status, error.as_deref()).await {
        Ok(()) => publish_last_run(&org, report_id, at, status, error.as_deref()).await,
        Err(e) => log::error!("[REPORT] failed to store the last run of {org}/{report_id}: {e}"),
    }
}

pub async fn enable(
    org_id: &str,
    folder_id: &str,
    name: &str,
    value: bool,
) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;

    // TODO: The "get" and "update" operations should be in a transaction.
    let mut report = match db::dashboards::reports::get(conn, org_id, folder_id, name).await {
        Ok(report) => report,
        _ => {
            return Err(ReportError::ReportNotFound);
        }
    };
    report.enabled = value;
    db::dashboards::reports::update(conn, folder_id, None, report)
        .await
        .map_err(ReportError::DbError)
}

pub async fn enable_by_id(org_id: &str, report_id: &str, value: bool) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;
    let (_, mut report) = get_by_id(org_id, report_id).await?;
    report.enabled = value;
    db::dashboards::reports::update_by_id(conn, report_id, None, report)
        .await
        .map_err(ReportError::DbError)
}

pub async fn update_by_id(
    org_id: &str,
    report_id: &str,
    new_folder_id: Option<&str>,
    report: Report,
) -> Result<(), ReportError> {
    let (curr_folder, report) = prepare_update_by_id(org_id, report_id, report).await?;
    write_update_by_id(org_id, report_id, new_folder_id, curr_folder, report).await
}

/// Runs every check [`update_by_id`] makes; returns the current folder and the report to write.
pub async fn prepare_update_by_id(
    org_id: &str,
    report_id: &str,
    mut report: Report,
) -> Result<(Folder, Report), ReportError> {
    bind_to_path_org(&mut report, org_id)?;

    let cfg = get_config();

    if cfg.common.report_server_url.is_empty() {
        if !cfg.smtp.smtp_enabled && !report.destinations.is_empty() {
            return Err(ReportError::SmtpNotEnabled);
        }
        if !cfg.chrome.chrome_enabled || cfg.chrome.chrome_path.is_empty() {
            return Err(ReportError::ChromeNotEnabled);
        }
        if cfg.common.report_user_name.is_empty() || cfg.common.report_user_password.is_empty() {
            return Err(ReportError::ReportUsernamePasswordNotSet);
        }
    }

    if is_ofga_unsupported(&report.name) {
        return Err(ReportError::NameContainsOpenFgaUnsupportedCharacters);
    }
    if report.name.is_empty() {
        return Err(ReportError::NameIsEmpty);
    }
    if report.name.contains('/') {
        return Err(ReportError::NameContainsForwardSlash);
    }

    validate_schedule(&mut report)?;

    if report.dashboards.is_empty() {
        return Err(ReportError::NoDashboards);
    }
    if report.dashboards.iter().any(|d| {
        d.report_type == ReportMediaType::Pdf
            && d.email_attachment_type == ReportEmailAttachmentType::Inline
    }) {
        return Err(ReportError::InlineAttachmentTypeNotSupportedForPdf);
    }
    if ensure_dashboards_readable(org_id, &report.dashboards)
        .await
        .is_err()
    {
        return Err(ReportError::DashboardTabNotFound);
    }

    let (curr_folder, old_report) = get_by_id(org_id, report_id).await?;
    report.owner = old_report.owner;
    report.updated_at = Some(datetime_now());
    Ok((curr_folder, report))
}

/// Writes an update [`prepare_update_by_id`] accepted.
pub async fn write_update_by_id(
    org_id: &str,
    report_id: &str,
    new_folder_id: Option<&str>,
    curr_folder: Folder,
    report: Report,
) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;
    db::dashboards::reports::update_by_id(conn, report_id, new_folder_id, report)
        .await
        .map_err(ReportError::DbError)?;

    // Update OpenFGA parent relation if the report is being moved to a different folder.
    if let Some(dst_folder_id) = new_folder_id {
        remove_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id.to_string(),
                parent_type: "report_folders".to_owned(),
                parent: curr_folder.folder_id,
            },
        )
        .await;
        set_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id.to_string(),
                parent_type: "report_folders".to_owned(),
                parent: dst_folder_id.to_owned(),
            },
        )
        .await;
    }
    Ok(())
}

pub async fn move_to_folder(
    org_id: &str,
    report_ids: &[String],
    dst_folder_id: &str,
) -> Result<(), ReportError> {
    let conn = get_orm_client_rw().await;
    for report_id in report_ids {
        let (curr_folder, report) = get_by_id(org_id, report_id).await?;

        db::dashboards::reports::update_by_id(conn, report_id, Some(dst_folder_id), report)
            .await
            .map_err(ReportError::DbError)?;

        remove_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id.clone(),
                parent_type: "report_folders".to_owned(),
                parent: curr_folder.folder_id,
            },
        )
        .await;
        set_ownership(
            org_id,
            "reports",
            Authz {
                obj_id: report_id.clone(),
                parent_type: "report_folders".to_owned(),
                parent: dst_folder_id.to_owned(),
            },
        )
        .await;
    }
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum SendReportError {
    #[error("Atleast one dashboard is required")]
    NoDashboards,

    #[error("A referenced dashboard is no longer in this report's org")]
    DashboardNotInOrg,

    #[error("Error contacting report server: {0}")]
    ReportServerClientError(#[from] reqwest::Error),

    #[error("report server {code}: {message}", code = .0.as_u16(), message = .1)]
    ReportServerErrorRepsponse(reqwest::StatusCode, String),

    #[error("SMTP configuration not enabled")]
    SmtpNotEnabled,

    #[error(transparent)]
    ParseAddressError(#[from] lettre::address::AddressError),

    #[error(transparent)]
    ParseContentTypeError(#[from] lettre::message::header::ContentTypeErr),

    #[error("Error sending email: {0}")]
    SendEmailError(#[from] lettre::transport::smtp::Error),

    #[error(transparent)]
    GenerateReportError(#[from] GenerateReportError),
}

impl SendReportError {
    /// Whether the mail server was contacted; None when the report server does not say.
    pub fn delivery_attempted(&self) -> Option<bool> {
        match self {
            Self::SendEmailError(_) => Some(true),
            // A timeout or a 5xx does not say whether the report server already sent the mail.
            Self::ReportServerErrorRepsponse(..) | Self::ReportServerClientError(_) => None,
            _ => Some(false),
        }
    }
}

/// What a finished send tells its run row.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct SendOutcome {
    /// The dashboard had not finished loading when it was rendered.
    pub partial: bool,
}

#[derive(Deserialize)]
struct ReportServerBody {
    #[serde(default)]
    message: String,
    #[serde(default)]
    partial: Option<bool>,
}

#[async_trait]
pub trait SendReport {
    /// Sends the report to subscribers
    async fn send_subscribers(&self) -> Result<SendOutcome, SendReportError>;
}

#[async_trait]
impl SendReport for Report {
    /// Sends the report to subscribers
    async fn send_subscribers(&self) -> Result<SendOutcome, SendReportError> {
        check_send(self).await?;

        let cfg = get_config();
        let mut recipients = vec![];
        for recipient in &self.destinations {
            match recipient {
                ReportDestination::Email(email) => recipients.push(email.clone()),
            }
        }
        let no_of_recipients = recipients.len();
        if !cfg.common.report_server_url.is_empty() {
            let report_data = HttpReportPayload {
                dashboards: self.dashboards.clone(),
                email_details: ReportEmailDetails {
                    title: self.title.clone(),
                    recipients,
                    name: self.name.clone(),
                    message: self.message.clone(),
                    dashb_url: format!("{}{}/web", cfg.common.web_url, cfg.common.base_uri),
                    image_preview: self.image_preview,
                },
            };

            let url = url::Url::parse(&format!(
                "{}/api/{}/reports/{}/send",
                cfg.common.report_server_url, self.org_id, self.name
            ))
            .unwrap();
            let mut req = Client::builder()
                .danger_accept_invalid_certs(cfg.common.report_server_skip_tls_verify)
                .timeout(report_server_timeout(cfg.limit.report_schedule_timeout))
                .build()
                .unwrap()
                .put(url)
                .query(&[("timezone", &self.timezone)])
                .header("Content-Type", "application/json");
            if !cfg.report_server.secret.is_empty() {
                req = req.header(REPORT_SECRET_HEADER, &cfg.report_server.secret);
            }
            let resp = req
                .json(&report_data)
                .send()
                .await
                .map_err(SendReportError::ReportServerClientError)?;
            let status = resp.status();
            let body = resp.bytes().await.unwrap_or_default();
            if !status.is_success() {
                return Err(SendReportError::ReportServerErrorRepsponse(
                    status,
                    report_server_message(&body),
                ));
            }
            log::info!("report sent successfully for the report {}", self.name);
            Ok(SendOutcome {
                partial: report_server_partial(&body),
            })
        } else {
            // Currently only one `ReportDashboard` can be captured and sent
            let dashboard = &self.dashboards[0];
            let report = generate_report(
                dashboard,
                &self.org_id,
                &cfg.common.report_user_name,
                &cfg.common.report_user_password,
                &self.timezone,
                no_of_recipients,
                &self.name,
            )
            .await?;
            send_email(self, &report.0, report.1).await?;
            Ok(SendOutcome { partial: report.2 })
        }
    }
}

/// Sends emails to the [`Report`] recipients. Currently only one pdf data is supported.
async fn send_email(
    report: &Report,
    pdf_data: &[u8],
    dashb_url: String,
) -> Result<(), SendReportError> {
    let cfg = get_config();
    if !cfg.smtp.smtp_enabled {
        return Err(SendReportError::SmtpNotEnabled);
    }

    let mut recipients = vec![];
    for recipient in &report.destinations {
        match recipient {
            ReportDestination::Email(email) => recipients.push(email),
        }
    }

    if recipients.is_empty() {
        return Ok(());
    }

    let mut email = Message::builder()
        .from(cfg.smtp.smtp_from_email.parse()?)
        .subject(report.title.to_string());

    for recipient in recipients {
        email = email.to(recipient.parse()?);
    }

    if !cfg.smtp.smtp_reply_to.is_empty() {
        email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
    }

    let email = email
        .multipart(
            MultiPart::mixed()
                .singlepart(SinglePart::html(format!(
                    "{}\n\n<p><a href='{dashb_url}' target='_blank'>Link to dashboard</a></p>",
                    report.message
                )))
                .singlepart(
                    // Only supports PDF for now, attach the PDF
                    lettre::message::Attachment::new(format!(
                        "{}.pdf",
                        sanitize_filename(&report.title)
                    ))
                    .body(pdf_data.to_owned(), ContentType::parse("application/pdf")?),
                ),
        )
        .unwrap();

    // Send the email
    match SMTP_CLIENT.as_ref().unwrap().send(email).await {
        Ok(_) => {
            log::info!("email sent successfully for the report {}", report.name);
            Ok(())
        }
        Err(e) => Err(SendReportError::SendEmailError(e)),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum GenerateReportError {
    #[error("Chrome not enabled")]
    ChromeNotEnabled,

    #[error("Atleast one tab is required")]
    NoDashboardTabs,

    #[error(transparent)]
    ChromiumOxideError(#[from] chromiumoxide::error::CdpError),

    #[error(transparent)]
    ParseTimeDurationError(std::num::ParseIntError),

    #[error(transparent)]
    BrowserCloseWaitError(std::io::Error),

    #[error(transparent)]
    JoinHandlerError(#[from] tokio::task::JoinError),

    #[error("[REPORT] main element not rendered yet for dashboard {dashboard_id}: {e}")]
    MainElementNotRendered {
        dashboard_id: String,
        e: chromiumoxide::error::CdpError,
    },

    #[error("[REPORT] div.displayDiv element not rendered yet for dashboard {dashboard_id}: {e}")]
    DisplayDivElementNotRendered {
        dashboard_id: String,
        e: chromiumoxide::error::CdpError,
    },

    #[error("span element indicator for data load not rendered yet")]
    DataLoadElementNotRendered,
}

/// The checks a send runs before it renders anything, so a caller can answer them first.
pub async fn check_send(report: &Report) -> Result<(), SendReportError> {
    if report.dashboards.is_empty() {
        return Err(SendReportError::NoDashboards);
    }
    ensure_dashboards_readable(&report.org_id, &report.dashboards).await
}

async fn generate_report(
    dashboard: &ReportDashboard,
    org_id: &str,
    user_id: &str,
    user_pass: &str,
    timezone: &str,
    no_of_recipients: usize,
    report_name: &str,
) -> Result<(Vec<u8>, String, bool), GenerateReportError> {
    let cfg = get_config();
    // Check if Chrome is enabled, otherwise don't save the report
    if !cfg.chrome.chrome_enabled {
        return Err(GenerateReportError::ChromeNotEnabled);
    }

    let dashboard_id = &dashboard.dashboard;
    let folder_id = &dashboard.folder;

    if dashboard.tabs.is_empty() {
        return Err(GenerateReportError::NoDashboardTabs);
    }
    // Only one tab is supported for now
    let tab_id = &dashboard.tabs[0];
    let mut dashb_vars = "".to_string();
    for variable in dashboard.variables.iter() {
        dashb_vars = format!(
            "{dashb_vars}&{}",
            format_dashb_var(&variable.key, &variable.value)
        );
    }

    log::info!("launching browser for dashboard {dashboard_id}");
    let (mut browser, mut handler) =
        Browser::launch(get_chrome_launch_options().await.as_ref().unwrap().clone()).await?;
    log::info!("browser launched");

    let handle = tokio::task::spawn(async move {
        while let Some(h) = handler.next().await {
            match h {
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    });

    let web_url = format!("{}{}/web", cfg.common.web_url, cfg.common.base_uri);
    log::debug!("Navigating to web url: {}", web_url);
    let page = browser
        .new_page(&format!("{web_url}/login?login_as_internal_user=true"))
        .await?;
    page.disable_log().await?;
    log::debug!("headless: new page created");

    page.find_element("input[type='email']")
        .await?
        .click()
        .await?
        .type_str(user_id)
        .await?;
    log::debug!("headless: email input filled");

    page.find_element("input[type='password']")
        .await?
        .click()
        .await?
        .type_str(user_pass)
        .await?
        .press_key("Enter")
        .await?;
    log::debug!("headless: password input filled");

    // Does not seem to work for single page client application
    page.wait_for_navigation().await?;
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

    let timerange = &dashboard.timerange;
    let search_type_params = if no_of_recipients == 0 {
        "search_type=ui".to_string()
    } else {
        format!("search_type=reports&report_id={org_id}-{report_name}")
    };

    // dashboard link in the email should contain data of the same period as the report
    let (dashb_url, email_dashb_url) = match timerange.range_type {
        ReportTimerangeType::Relative => {
            let period = &timerange.period;
            let (time_duration, time_unit) = period.split_at(period.len() - 1);
            let dashb_url = format!(
                "{web_url}/dashboards/view?org_identifier={org_id}&dashboard={dashboard_id}&folder={folder_id}&tab={tab_id}&refresh=Off&{search_type_params}&period={period}&timezone={timezone}&var-Dynamic+filters=%255B%255D&print=true{dashb_vars}",
            );

            let time_duration: i64 = time_duration
                .parse()
                .map_err(GenerateReportError::ParseTimeDurationError)?;
            let end_time = now_micros();
            let start_time = match time_unit {
                "m" => {
                    end_time
                        - chrono::Duration::try_minutes(time_duration)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                }
                "h" => {
                    end_time
                        - chrono::Duration::try_hours(time_duration)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                }
                "d" => {
                    end_time
                        - chrono::Duration::try_days(time_duration)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                }
                "w" => {
                    end_time
                        - chrono::Duration::try_weeks(time_duration)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                }
                _ => {
                    end_time
                        - chrono::Duration::try_days(30 * time_duration)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                }
            };

            let email_dashb_url = format!(
                "{web_url}/dashboards/view?org_identifier={org_id}&dashboard={dashboard_id}&folder={folder_id}&tab={tab_id}&refresh=Off&from={start_time}&to={end_time}&timezone={timezone}&var-Dynamic+filters=%255B%255D&print=true{dashb_vars}",
            );
            (dashb_url, email_dashb_url)
        }
        ReportTimerangeType::Absolute => {
            let url = format!(
                "{web_url}/dashboards/view?org_identifier={org_id}&dashboard={dashboard_id}&folder={folder_id}&tab={tab_id}&refresh=Off&{search_type_params}&from={}&to={}&timezone={timezone}&var-Dynamic+filters=%255B%255D&print=true{dashb_vars}",
                timerange.from, timerange.to
            );
            (url.clone(), url)
        }
    };

    log::debug!("headless: going to dash url");
    // First navigate to the correct org
    page.goto(&format!("{web_url}/?org_identifier={org_id}"))
        .await?;
    page.wait_for_navigation().await?;
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    log::debug!("headless: navigated to the org_id: {org_id}");

    page.goto(&dashb_url).await?;
    log::debug!("headless: going to dash url");

    // Wait for navigation does not really wait until it is fully loaded
    page.wait_for_navigation().await?;

    log::info!("waiting for data to load for dashboard {dashboard_id}");

    // If the span element is not rendered yet, capture whatever is loaded till now
    let partial = if let Err(e) = wait_for_panel_data_load(&page).await {
        log::error!(
            "[REPORT] error occurred while finding the span element for dashboard {dashboard_id}:{e}"
        );
        true
    } else {
        log::info!("[REPORT] all panel data loaded for report dashboard: {dashboard_id}");
        false
    };

    if let Err(e) = page.find_element("main").await {
        browser.close().await?;
        browser
            .wait()
            .await
            .map_err(GenerateReportError::BrowserCloseWaitError)?;
        handle.await?;
        return Err(GenerateReportError::MainElementNotRendered {
            dashboard_id: dashboard_id.clone(),
            e,
        });
    }
    if let Err(e) = page.find_element("div.displayDiv").await {
        browser.close().await?;
        browser
            .wait()
            .await
            .map_err(GenerateReportError::BrowserCloseWaitError)?;
        handle.await?;
        return Err(GenerateReportError::DisplayDivElementNotRendered {
            dashboard_id: dashboard_id.clone(),
            e,
        });
    }

    // Last two elements loaded means atleast the metric components have loaded.
    // Convert the page into pdf
    let pdf_data = if no_of_recipients != 0 {
        page.pdf(PrintToPdfParams {
            landscape: Some(true),
            ..Default::default()
        })
        .await?
    } else {
        // No need to capture pdf
        vec![]
    };

    browser.close().await?;
    browser
        .wait()
        .await
        .map_err(GenerateReportError::BrowserCloseWaitError)?;
    handle.await?;
    log::debug!("done with headless browser");

    // convert to short_url
    let email_dashb_url = match short_url::shorten(org_id, &email_dashb_url).await {
        Ok(short_url) => short_url,
        Err(e) => {
            log::error!("Error shortening email dashboard url: {e}");
            email_dashb_url
        }
    };
    Ok((pdf_data, email_dashb_url, partial))
}

async fn wait_for_panel_data_load(page: &Page) -> Result<(), GenerateReportError> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(get_config().chrome.chrome_sleep_secs.into());
    log::info!("waiting for headless data to load");
    loop {
        if page
            .find_element("span#dashboardVariablesAndPanelsDataLoaded")
            .await
            .is_ok()
        {
            return Ok(());
        }

        if start.elapsed() >= timeout {
            return Err(GenerateReportError::DataLoadElementNotRendered);
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}

fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Same existence-scoped org check the dashboards GET handler uses.
async fn ensure_dashboards_readable(
    org_id: &str,
    dashboards: &[ReportDashboard],
) -> Result<(), SendReportError> {
    let checks = dashboards
        .iter()
        .map(|d| dashboard_in_org(org_id, &d.dashboard));
    let results = future::join_all(checks).await;
    if all_dashboards_readable(&results) {
        Ok(())
    } else {
        Err(SendReportError::DashboardNotInOrg)
    }
}

/// An empty slice passes trivially; callers reject zero dashboards earlier.
fn all_dashboards_readable(results: &[bool]) -> bool {
    results.iter().all(|readable| *readable)
}

/// Anchors a report to the org it was addressed to, rejecting a body that names a different one.
fn bind_to_path_org(report: &mut Report, org_id: &str) -> Result<(), ReportError> {
    if !report.org_id.is_empty() && report.org_id != org_id {
        return Err(ReportError::OrgMismatch);
    }
    // Persistence, relations and the trigger all read the org off the report, never the path.
    report.org_id = org_id.to_string();
    Ok(())
}

/// Replicates a stored last run to the other regions; a failure is logged, never returned.
#[cfg(feature = "enterprise")]
async fn publish_last_run(org: &str, report_id: &str, at: i64, status: &str, error: Option<&str>) {
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && !get_config().common.local_mode
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::reports_last_run(
            org, report_id, at, status, error,
        )
        .await
    {
        log::error!("[SUPER_CLUSTER] Failed to publish report last run: {e}");
    }
}

#[cfg(not(feature = "enterprise"))]
async fn publish_last_run(
    _org: &str,
    _report_id: &str,
    _at: i64,
    _status: &str,
    _error: Option<&str>,
) {
}

/// Sends a report on a user's request and records the run.
async fn run_manually(report: &Report, report_id: &str, user: &str) -> TriggerData {
    let started = std::time::Instant::now();
    let mut row = run_row(report, report_id, now_micros());
    row.trigger_source = Some(TRIGGER_SOURCE_MANUAL.to_string());
    row.triggered_by = Some(user.to_string()).filter(|u| !u.is_empty());
    let result = report.send_subscribers().await;
    if let Err(e) = &result {
        log::error!(
            "[REPORT] manual run of {}/{report_id} failed: {e}",
            report.org_id
        );
    }
    apply_send_result(&mut row, &result, started);
    record_run(report_id, row.clone()).await;
    row
}

/// The report-server request must end before the scheduler's job claim does, or a retry re-sends.
fn report_server_timeout(schedule_timeout_secs: i64) -> Duration {
    match u64::try_from(schedule_timeout_secs) {
        Ok(claim) if claim > 0 => Duration::from_secs(claim),
        _ => Duration::from_secs(DEFAULT_REPORT_SCHEDULE_TIMEOUT_SECS),
    }
}

/// The `message` of the report server's JSON reply, or the raw body when it is not JSON.
fn report_server_message(body: &[u8]) -> String {
    match serde_json::from_slice::<ReportServerBody>(body) {
        Ok(parsed) if !parsed.message.is_empty() => parsed.message,
        _ => String::from_utf8_lossy(body).trim().to_string(),
    }
}

fn report_server_partial(body: &[u8]) -> bool {
    serde_json::from_slice::<ReportServerBody>(body)
        .ok()
        .and_then(|parsed| parsed.partial)
        .unwrap_or(false)
}

/// Normalises a report's schedule and rejects one the scheduler could not evaluate.
fn validate_schedule(report: &mut Report) -> Result<(), ReportError> {
    if !TZ_OFFSET_RANGE_MINUTES.contains(&report.tz_offset) {
        return Err(ReportError::TzOffsetOutOfRange);
    }
    let tz = fixed_offset(report.tz_offset).ok_or(ReportError::TzOffsetOutOfRange)?;
    if report.frequency.frequency_type == ReportFrequencyType::Cron {
        let now = chrono::Utc::now().second();
        report.frequency.cron =
            super::super::alerts::alert::update_cron_expression(&report.frequency.cron, now);
        let schedule = Schedule::from_str(&report.frequency.cron)?;
        // The scheduler reads the cron in the report's offset, so check it there.
        if schedule.upcoming(tz).next().is_none() {
            return Err(ReportError::CronHasNoFutureOccurrence {
                cron: report.frequency.cron.clone(),
            });
        }
    } else if report.frequency.interval < 0 {
        return Err(ReportError::NegativeInterval);
    } else if report.frequency.interval == 0 {
        report.frequency.interval = 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Datelike;

    use super::*;

    #[test]
    fn test_sanitize_filename_alphanumeric() {
        assert_eq!(sanitize_filename("report123"), "report123");
    }

    #[test]
    fn test_sanitize_filename_allowed_special_chars() {
        assert_eq!(
            sanitize_filename("my-report_v1 final"),
            "my-report_v1 final"
        );
    }

    #[test]
    fn test_sanitize_filename_replaces_slashes() {
        assert_eq!(sanitize_filename("folder/report"), "folder_report");
    }

    #[test]
    fn test_sanitize_filename_empty_string() {
        assert_eq!(sanitize_filename(""), "");
    }

    #[test]
    fn test_sanitize_filename_all_special() {
        assert_eq!(sanitize_filename("@#$%^&*"), "_______");
    }

    #[test]
    fn test_report_error_display_smtp_not_enabled() {
        let err = ReportError::SmtpNotEnabled;
        assert_eq!(err.to_string(), "SMTP configuration not enabled");
    }

    #[test]
    fn test_report_error_display_chrome_not_enabled() {
        let err = ReportError::ChromeNotEnabled;
        assert_eq!(err.to_string(), "Chrome not enabled");
    }

    #[test]
    fn test_report_error_display_name_is_empty() {
        let err = ReportError::NameIsEmpty;
        assert_eq!(err.to_string(), "Report name is required");
    }

    #[test]
    fn test_report_error_display_name_contains_forward_slash() {
        let err = ReportError::NameContainsForwardSlash;
        assert_eq!(err.to_string(), "Report name cannot contain '/'");
    }

    #[test]
    fn test_report_error_display_report_not_found() {
        let err = ReportError::ReportNotFound;
        assert_eq!(err.to_string(), "Report not found");
    }

    #[test]
    fn test_report_error_display_no_dashboards() {
        let err = ReportError::NoDashboards;
        assert_eq!(err.to_string(), "Atleast one dashboard is required");
    }

    #[test]
    fn test_report_error_display_no_destinations() {
        let err = ReportError::NoDestinations;
        assert_eq!(err.to_string(), "Atleast one destination is required");
    }

    #[test]
    fn test_report_error_display_folder_not_found() {
        let err = ReportError::FolderNotFound;
        assert_eq!(err.to_string(), "Folder not found");
    }

    #[test]
    fn test_report_error_display_create_default_folder_error() {
        let err = ReportError::CreateDefaultFolderError;
        assert_eq!(err.to_string(), "Error creating default reports folder");
    }

    #[test]
    fn test_report_error_display_name_already_used() {
        let err = ReportError::CreateReportNameAlreadyUsed;
        assert_eq!(err.to_string(), "Report already exists");
    }

    #[test]
    fn test_report_error_display_no_dashboard_tabs() {
        let err = ReportError::NoDashboardTabs;
        assert_eq!(err.to_string(), "Atleast one tab is required");
    }

    #[test]
    fn test_report_error_display_inline_attachment_not_supported() {
        let err = ReportError::InlineAttachmentTypeNotSupportedForPdf;
        assert_eq!(
            err.to_string(),
            "Inline attachment type is only supported for PNG reports, not PDF"
        );
    }

    #[test]
    fn test_report_error_display_dashboard_tab_not_found() {
        let err = ReportError::DashboardTabNotFound;
        assert_eq!(err.to_string(), "Some dashboards/tabs not found");
    }

    #[test]
    fn test_report_error_display_username_password_not_set() {
        let err = ReportError::ReportUsernamePasswordNotSet;
        assert_eq!(err.to_string(), "Report username and password ENVs not set");
    }

    #[test]
    fn test_report_error_display_name_contains_unsupported_chars() {
        let err = ReportError::NameContainsOpenFgaUnsupportedCharacters;
        assert!(err.to_string().contains("Report name cannot contain"));
    }

    #[test]
    fn test_report_error_db_error() {
        let err = ReportError::DbError(anyhow::anyhow!("connection refused"));
        assert!(err.to_string().contains("connection refused"));
    }

    fn scheduled(tz_offset: i32, cron: &str) -> Report {
        let mut report = Report {
            tz_offset,
            ..Default::default()
        };
        report.frequency.frequency_type = ReportFrequencyType::Cron;
        report.frequency.cron = cron.to_string();
        report
    }

    #[test]
    fn validate_schedule_rejects_a_full_day_tz_offset() {
        for tz_offset in [1440, -1440, i32::MAX, i32::MIN] {
            let err = validate_schedule(&mut scheduled(tz_offset, "0 0 * * * *"));
            assert!(
                matches!(err, Err(ReportError::TzOffsetOutOfRange)),
                "{tz_offset}: {err:?}"
            );
        }
    }

    #[test]
    fn validate_schedule_rejects_a_cron_with_no_future_occurrence() {
        let err = validate_schedule(&mut scheduled(0, "0 0 0 1 1 * 2020"));
        assert!(
            matches!(err, Err(ReportError::CronHasNoFutureOccurrence { .. })),
            "{err:?}"
        );
    }

    #[test]
    fn validate_schedule_accepts_values_at_their_bounds() {
        for tz_offset in [-1439, 0, 1439] {
            let mut report = scheduled(tz_offset, "0 0 * * * *");
            assert!(validate_schedule(&mut report).is_ok(), "{tz_offset}");
        }
        let mut report = Report::default();
        report.frequency.frequency_type = ReportFrequencyType::Hours;
        report.frequency.interval = 0;
        assert!(validate_schedule(&mut report).is_ok());
        assert_eq!(report.frequency.interval, 1);
    }

    #[test]
    fn validate_schedule_rejects_a_negative_interval() {
        for frequency_type in [ReportFrequencyType::Hours, ReportFrequencyType::Months] {
            let mut report = Report::default();
            report.frequency.frequency_type = frequency_type;
            report.frequency.interval = -1;
            let err = validate_schedule(&mut report);
            assert!(matches!(err, Err(ReportError::NegativeInterval)), "{err:?}");
        }
    }

    #[test]
    fn validate_schedule_checks_the_cron_in_the_report_offset() {
        let target = chrono::Utc::now() + chrono::Duration::hours(2);
        let cron = format!(
            "0 {} {} {} {} * {}",
            target.minute(),
            target.hour(),
            target.day(),
            target.month(),
            target.year()
        );
        assert!(
            validate_schedule(&mut scheduled(0, &cron)).is_ok(),
            "{cron}"
        );
        let err = validate_schedule(&mut scheduled(720, &cron));
        assert!(
            matches!(err, Err(ReportError::CronHasNoFutureOccurrence { .. })),
            "{cron}: {err:?}"
        );
    }

    fn report_with_schedule(tz_offset: i32, cron: &str) -> Report {
        let mut report = scheduled(tz_offset, cron);
        report.name = "weekly".to_string();
        report
    }

    #[tokio::test]
    async fn update_by_id_rejects_the_schedules_that_save_rejects() {
        let saved = config::CONFIG.load_full();
        // Raw Config::init() skips limit defaults, leaving the postgres pool zero-sized.
        let mut cfg = config::config::init();
        cfg.common.report_server_url = "http://report-server.example".to_string();
        config::CONFIG.store(std::sync::Arc::new(cfg));
        let mut outcomes = vec![];
        for (tz_offset, cron) in [(1440, "0 0 * * * *"), (0, "0 0 0 1 1 * 2020")] {
            let created = save(
                "org_a",
                "default",
                "",
                report_with_schedule(tz_offset, cron),
                true,
            )
            .await
            .map_err(|e| e.to_string());
            let updated = update_by_id("org_a", "r1", None, report_with_schedule(tz_offset, cron))
                .await
                .map_err(|e| e.to_string());
            outcomes.push((created, updated));
        }
        config::CONFIG.store(saved);
        for (created, updated) in outcomes {
            assert!(created.is_err(), "{created:?}");
            assert_eq!(created, updated);
        }
    }

    #[test]
    fn bind_to_path_org_rejects_a_foreign_org_in_the_body() {
        let mut report = Report {
            org_id: "org_b".to_string(),
            ..Default::default()
        };
        assert!(matches!(
            bind_to_path_org(&mut report, "org_a"),
            Err(ReportError::OrgMismatch)
        ));
    }

    #[test]
    fn bind_to_path_org_fills_in_an_omitted_org() {
        let mut report = Report::default();
        assert!(bind_to_path_org(&mut report, "org_a").is_ok());
        assert_eq!(report.org_id, "org_a");
    }

    #[test]
    fn bind_to_path_org_accepts_a_matching_org() {
        let mut report = Report {
            org_id: "org_a".to_string(),
            ..Default::default()
        };
        assert!(bind_to_path_org(&mut report, "org_a").is_ok());
        assert_eq!(report.org_id, "org_a");
    }

    #[test]
    fn all_dashboards_readable_is_true_when_every_check_passed() {
        assert!(all_dashboards_readable(&[true, true, true]));
    }

    #[test]
    fn all_dashboards_readable_is_false_if_any_dashboard_is_not_in_org() {
        assert!(!all_dashboards_readable(&[true, false, true]));
    }

    #[test]
    fn all_dashboards_readable_is_true_for_no_dashboards() {
        assert!(all_dashboards_readable(&[]));
    }

    fn dashboard(report_type: ReportMediaType) -> ReportDashboard {
        ReportDashboard {
            dashboard: "d1".to_string(),
            folder: "default".to_string(),
            tabs: vec!["tab1".to_string()],
            variables: vec![],
            timerange: config::meta::dashboards::reports::ReportTimerange::default(),
            report_type,
            email_attachment_type: ReportEmailAttachmentType::default(),
            attachment_dimensions: None,
        }
    }

    #[test]
    fn run_row_describes_an_emailed_report() {
        let report = Report {
            name: "Exec KPI".to_string(),
            org_id: "org_a".to_string(),
            destinations: vec![
                ReportDestination::Email("a@b.c".to_string()),
                ReportDestination::Email("d@e.f".to_string()),
            ],
            dashboards: vec![
                dashboard(ReportMediaType::Png),
                dashboard(ReportMediaType::Pdf),
            ],
            ..Default::default()
        };
        let row = run_row(&report, "abc", 10);
        assert_eq!(row.key, "Exec KPI/abc");
        assert_eq!(row.org, "org_a");
        assert_eq!(row.module, TriggerDataType::Report);
        assert_eq!(row.recipient_count, Some(2));
        assert_eq!(row.dashboard_count, Some(2));
        assert_eq!(row.attachment_type.as_deref(), Some("png"));
        assert_eq!(
            row.trigger_source.as_deref(),
            Some(TRIGGER_SOURCE_SCHEDULED)
        );
    }

    #[test]
    fn run_row_of_a_report_without_recipients_is_a_cached_report() {
        let report = Report {
            name: "Warm".to_string(),
            dashboards: vec![dashboard(ReportMediaType::Csv)],
            ..Default::default()
        };
        let row = run_row(&report, "abc", 10);
        assert_eq!(row.module, TriggerDataType::CachedReport);
        assert_eq!(row.recipient_count, Some(0));
        assert_eq!(row.attachment_type.as_deref(), Some("csv"));
    }

    #[test]
    fn apply_send_result_fills_a_sent_run() {
        let mut row = TriggerData {
            recipient_count: Some(4),
            ..Default::default()
        };
        apply_send_result(
            &mut row,
            &Ok(SendOutcome { partial: true }),
            std::time::Instant::now(),
        );
        assert_eq!(row.status, RunOutcome::Succeeded);
        assert_eq!(row.is_partial, Some(true));
        assert_eq!(row.delivery_attempted, Some(true));
        assert_eq!(
            row.success_response.as_deref(),
            Some("sent to 4 recipients")
        );
        assert!(row.evaluation_took_in_secs.is_some());
        assert!(row.end_time > 0);
    }

    #[test]
    fn apply_send_result_fills_a_cached_run() {
        let mut row = TriggerData {
            recipient_count: Some(0),
            ..Default::default()
        };
        apply_send_result(
            &mut row,
            &Ok(SendOutcome::default()),
            std::time::Instant::now(),
        );
        assert_eq!(row.delivery_attempted, Some(false));
        assert_eq!(row.success_response.as_deref(), Some("cached"));
    }

    #[test]
    fn apply_send_result_records_a_readable_report_server_error() {
        let mut row = TriggerData::default();
        let err = SendReportError::ReportServerErrorRepsponse(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            report_server_message(br#"{"code":500,"message":"SMTP 550 mailbox unavailable"}"#),
        );
        apply_send_result(&mut row, &Err(err), std::time::Instant::now());
        assert_eq!(row.status, RunOutcome::Error);
        assert_eq!(
            row.error.as_deref(),
            Some("error processing report: report server 500: SMTP 550 mailbox unavailable")
        );
        assert_eq!(row.delivery_attempted, None);
    }

    #[test]
    fn report_server_message_falls_back_to_the_raw_body() {
        assert_eq!(report_server_message(b"  bad gateway \n"), "bad gateway");
        assert_eq!(report_server_message(br#"{"code":500}"#), r#"{"code":500}"#);
    }

    #[test]
    fn report_server_partial_reads_the_flag() {
        assert!(report_server_partial(
            br#"{"code":200,"message":"ok","partial":true}"#
        ));
        assert!(!report_server_partial(br#"{"code":200,"message":"ok"}"#));
        assert!(!report_server_partial(b"not json"));
    }

    #[test]
    fn report_server_timeout_ends_before_the_job_claim() {
        assert_eq!(report_server_timeout(300), Duration::from_secs(300));
        assert_eq!(report_server_timeout(45), Duration::from_secs(45));
        assert_eq!(report_server_timeout(0), Duration::from_secs(300));
        assert_eq!(report_server_timeout(-1), Duration::from_secs(300));
    }

    /// With no DB configured, `dashboard_in_org` fails closed, so this proves the check runs.
    #[tokio::test]
    async fn send_subscribers_rejects_a_report_before_rendering_when_the_dashboard_check_fails() {
        let report = Report {
            org_id: "org_a".to_string(),
            dashboards: vec![ReportDashboard {
                dashboard: "some-dashboard".to_string(),
                folder: "default".to_string(),
                tabs: vec!["tab1".to_string()],
                variables: vec![],
                timerange: config::meta::dashboards::reports::ReportTimerange::default(),
                report_type: ReportMediaType::default(),
                email_attachment_type: ReportEmailAttachmentType::default(),
                attachment_dimensions: None,
            }],
            ..Default::default()
        };
        assert!(matches!(
            report.send_subscribers().await,
            Err(SendReportError::DashboardNotInOrg)
        ));
    }
}
