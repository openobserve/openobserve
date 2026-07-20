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

use crate::repository::{destinations::DestinationError, templates::TemplateError};

impl From<DestinationError> for Response {
    fn from(value: DestinationError) -> Self {
        match &value {
            DestinationError::UsedByAlert(_) | DestinationError::UsedByPipeline(_) => {
                HttpResponse::conflict(value)
            }
            DestinationError::InfraError(error) => HttpResponse::internal_error(error),
            DestinationError::NotFound => HttpResponse::not_found(value),
            other_error => HttpResponse::bad_request(other_error),
        }
    }
}

impl From<TemplateError> for Response {
    fn from(value: TemplateError) -> Self {
        match value {
            TemplateError::InfraError(error) => {
                HttpResponse::internal_error(TemplateError::InfraError(error))
            }
            TemplateError::NotFound => HttpResponse::not_found(TemplateError::NotFound),
            TemplateError::DeleteWithDestination(destination) => {
                HttpResponse::conflict(TemplateError::DeleteWithDestination(destination))
            }
            TemplateError::PrebuiltReadOnly(name) => {
                HttpResponse::forbidden(TemplateError::PrebuiltReadOnly(name))
            }
            other_error => HttpResponse::bad_request(other_error),
        }
    }
}
