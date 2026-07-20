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
use common::meta::http::HttpResponse;

use crate::{eval_jobs::EvalJobError, providers::ProviderError, repository::PipelineError};

impl From<PipelineError> for Response {
    fn from(value: PipelineError) -> Self {
        match value {
            PipelineError::InfraError(error) => HttpResponse::internal_error(error),
            PipelineError::NotFound(_) => HttpResponse::not_found(value),
            PipelineError::Modified(_) => HttpResponse::conflict(value),
            error => HttpResponse::bad_request(error),
        }
    }
}

impl From<EvalJobError> for Response {
    fn from(value: EvalJobError) -> Self {
        match value {
            EvalJobError::InfraError(error) => {
                log::error!("[EvalJob] internal error: {error}");
                HttpResponse::internal_error("Internal server error")
            }
            EvalJobError::NotFound => HttpResponse::not_found(value),
            EvalJobError::ReconcilerError(error) => {
                log::error!("[EvalJob] reconciler error: {error}");
                HttpResponse::internal_error("Internal server error")
            }
            EvalJobError::InvalidStatus(_) | EvalJobError::InvalidStatusTransition { .. } => {
                HttpResponse::bad_request(value)
            }
        }
    }
}

impl From<ProviderError> for Response {
    fn from(value: ProviderError) -> Self {
        match value {
            ProviderError::InfraError(error) => {
                log::error!("[Provider] internal error: {error}");
                HttpResponse::internal_error("Internal server error")
            }
            ProviderError::MissingName => {
                HttpResponse::bad_request("Provider name cannot be empty")
            }
            ProviderError::ProviderNameAlreadyExists => HttpResponse::bad_request(
                "Provider with this name already exists in this organization",
            ),
            ProviderError::NotFound => HttpResponse::not_found("Provider not found"),
            ProviderError::InvalidConfig(error) => HttpResponse::bad_request(error),
            ProviderError::ProviderInUse(scorers) => HttpResponse::conflict(format!(
                "Provider is used by active scorers: {scorers}. Unlink or replace the provider before deleting it."
            )),
        }
    }
}
