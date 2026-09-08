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

//! The org's single raman config: a read and a partial update.

use axum::{Json, extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use o2_enterprise::enterprise::raman_service::{self, UpdateRamanConfig};

use super::{deployment_disabled, error_response};

pub async fn get_raman_config(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match raman_service::get_config(&org_id).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(error) => error_response(&error),
    }
}

pub async fn update_raman_config(
    Path(org_id): Path<String>,
    Json(update): Json<UpdateRamanConfig>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match raman_service::update_config(&org_id, update).await {
        Ok(config) => MetaHttpResponse::json(config),
        Err(error) => error_response(&error),
    }
}
