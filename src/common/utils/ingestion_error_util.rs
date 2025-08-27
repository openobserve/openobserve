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

use actix_web::HttpResponse;
use infra::errors;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::request::search::error_utils::map_error_to_http_response,
};

pub fn handle_error(e: infra::errors::Error) -> HttpResponse {
    match e {
        errors::Error::IngestionError(e) => MetaHttpResponse::forbidden(e),
        errors::Error::ResourceError(e) => MetaHttpResponse::service_unavailable(e),
        _ => {
            log::error!("Error processing request: {e:?}");
            map_error_to_http_response(&e, None)
        }
    }
}
