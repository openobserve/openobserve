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

//! Per-domain error-to-response conversions.
//!
//! Each `From<SomeError> for Response` below has to live in the crate that declares the error
//! type, so this module ends up reaching into every domain and must stay above all of them.
//! Nothing inside the crate may depend on it -- use [`crate::http_error`] for the generic mapper
//! instead. When the domains become their own crates these impls move out with their error types.

use axum::response::Response;
use db::alerts::{destinations::DestinationError, templates::TemplateError};

pub use crate::http_error::map_error_to_http_response;
use crate::{
    alerts::alert::AlertError,
    common::meta::http::HttpResponse as MetaHttpResponse,
    dashboards::{DashboardError, reports::ReportError},
    pipeline::db::PipelineError,
};
#[cfg(feature = "enterprise")]
use crate::{
    llm_evaluations::eval_jobs::EvalJobError, providers::ProviderError,
    ratelimit::rule::RatelimitError,
};

impl From<AlertError> for Response {
    fn from(value: AlertError) -> Self {
        match &value {
            AlertError::InfraError(err) => MetaHttpResponse::internal_error(err),
            AlertError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
            AlertError::AlertNameMissing
            | AlertError::AlertNameOfgaUnsupported
            | AlertError::AlertNameContainsForwardSlash
            | AlertError::AlertDestinationMissing
            | AlertError::TemplateNotConfigured { .. }
            | AlertError::RealtimeMissingCustomQuery
            | AlertError::SqlMissingQuery
            | AlertError::SqlContainsSelectStar
            | AlertError::PromqlMissingQuery
            | AlertError::PeriodExceedsMaxQueryRange { .. }
            | AlertError::AlertIdMissing => MetaHttpResponse::bad_request(value),
            AlertError::CreateAlreadyExists => MetaHttpResponse::conflict(value),
            AlertError::CreateFolderNotFound
            | AlertError::MoveDestinationFolderNotFound
            | AlertError::AlertNotFound
            | AlertError::AlertDestinationNotFound { .. }
            | AlertError::AlertTemplateNotFound { .. }
            | AlertError::StreamNotFound { .. }
            | AlertError::AlertWorkflowNotFound { .. } => MetaHttpResponse::not_found(value),
            AlertError::DecodeVrl(err) => MetaHttpResponse::bad_request(err),
            AlertError::ParseCron(err) => MetaHttpResponse::bad_request(err),
            AlertError::SendNotificationError { .. } | AlertError::ResolveStreamNameError(_) => {
                MetaHttpResponse::internal_error(value)
            }
            AlertError::GetDestinationWithTemplateError(err) => {
                MetaHttpResponse::internal_error(err)
            }
            AlertError::PermittedAlertsMissingUser => MetaHttpResponse::forbidden(""),
            AlertError::PermittedAlertsValidator(err) => MetaHttpResponse::forbidden(err),
            AlertError::NotSupportedAlertDestinationType(err) => MetaHttpResponse::forbidden(err),
            AlertError::PermissionDenied | AlertError::UserNotFound => {
                MetaHttpResponse::forbidden("Unauthorized access")
            }
        }
    }
}

pub fn destination_error_response(value: DestinationError) -> Response {
    match &value {
        DestinationError::UsedByAlert(_) | DestinationError::UsedByPipeline(_) => {
            MetaHttpResponse::conflict(value)
        }
        DestinationError::InfraError(err) => MetaHttpResponse::internal_error(err),
        DestinationError::NotFound => MetaHttpResponse::not_found(value),
        other_err => MetaHttpResponse::bad_request(other_err),
    }
}

pub fn template_error_response(value: TemplateError) -> Response {
    match value {
        TemplateError::InfraError(err) => {
            MetaHttpResponse::internal_error(TemplateError::InfraError(err))
        }
        TemplateError::NotFound => MetaHttpResponse::not_found(TemplateError::NotFound),
        TemplateError::DeleteWithDestination(destination) => {
            MetaHttpResponse::conflict(TemplateError::DeleteWithDestination(destination))
        }
        TemplateError::PrebuiltReadOnly(name) => {
            MetaHttpResponse::forbidden(TemplateError::PrebuiltReadOnly(name))
        }
        other_err => MetaHttpResponse::bad_request(other_err),
    }
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
            DashboardError::MoveDashboardDeleteOld(dashb_id, folder_id, e) => {
                MetaHttpResponse::internal_error(format!(
                    "error deleting the dashboard {dashb_id} from old folder {folder_id} : {e}"
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

impl From<ReportError> for Response {
    fn from(value: ReportError) -> Self {
        match &value {
            ReportError::SmtpNotEnabled | ReportError::ChromeNotEnabled => {
                MetaHttpResponse::internal_error(value)
            }
            ReportError::ReportUsernamePasswordNotSet
            | ReportError::NameContainsOpenFgaUnsupportedCharacters
            | ReportError::NameIsEmpty
            | ReportError::NameContainsForwardSlash
            | ReportError::CreateReportNameAlreadyUsed
            | ReportError::NoDashboards
            | ReportError::InlineAttachmentTypeNotSupportedForPdf
            | ReportError::NoDashboardTabs
            | ReportError::NoDestinations => MetaHttpResponse::bad_request(value),
            ReportError::ReportNotFound
            | ReportError::DashboardTabNotFound
            | ReportError::FolderNotFound => MetaHttpResponse::not_found(value),
            ReportError::ParseCronError(e) => MetaHttpResponse::bad_request(e),
            ReportError::DbError(e) => MetaHttpResponse::internal_error(e),
            ReportError::SendReportError(e) => MetaHttpResponse::internal_error(e),
            ReportError::CreateDefaultFolderError => MetaHttpResponse::internal_error(value),
        }
    }
}

impl From<PipelineError> for Response {
    fn from(value: PipelineError) -> Self {
        match value {
            PipelineError::InfraError(err) => MetaHttpResponse::internal_error(err),
            PipelineError::NotFound(_) => MetaHttpResponse::not_found(value),
            PipelineError::Modified(_) => MetaHttpResponse::conflict(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<EvalJobError> for Response {
    fn from(value: EvalJobError) -> Self {
        match value {
            EvalJobError::InfraError(err) => {
                log::error!("[EvalJob] internal error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            EvalJobError::NotFound => MetaHttpResponse::not_found(value),
            EvalJobError::ReconcilerError(err) => {
                log::error!("[EvalJob] reconciler error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            EvalJobError::TaskPublish(err) => {
                log::error!("[EvalJob] task publish error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            EvalJobError::InvalidStatus(_)
            | EvalJobError::InvalidStatusTransition { .. }
            | EvalJobError::InvalidJob(_) => MetaHttpResponse::bad_request(value),
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<ProviderError> for Response {
    fn from(value: ProviderError) -> Self {
        match value {
            ProviderError::InfraError(err) => {
                log::error!("[Provider] internal error: {err}");
                MetaHttpResponse::internal_error("Internal server error")
            }
            ProviderError::MissingName => {
                MetaHttpResponse::bad_request("Provider name cannot be empty")
            }
            ProviderError::ProviderNameAlreadyExists => MetaHttpResponse::bad_request(
                "Provider with this name already exists in this organization",
            ),
            ProviderError::NotFound => MetaHttpResponse::not_found("Provider not found"),
            ProviderError::InvalidConfig(err) => MetaHttpResponse::bad_request(err),
            ProviderError::ProviderInUse(scorers) => MetaHttpResponse::conflict(format!(
                "Provider is used by active scorers: {scorers}. Unlink or replace the provider before deleting it."
            )),
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<RatelimitError> for Response {
    fn from(value: RatelimitError) -> Self {
        match value {
            RatelimitError::NotFound(_) => MetaHttpResponse::not_found(value),
            error => MetaHttpResponse::bad_request(error),
        }
    }
}
