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
use o2_enterprise::enterprise::cloud::billings::{self as o2_cloud_billings};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

pub mod billings;
pub mod marketing;
pub mod org_usage;

// BillingsError extension
pub trait IntoHttpResponse {
    fn into_http_response(self) -> Response;
}

impl IntoHttpResponse for o2_cloud_billings::BillingError {
    fn into_http_response(self) -> Response {
        match self {
            o2_cloud_billings::BillingError::InfraError(err) => {
                MetaHttpResponse::internal_error(err)
            }
            o2_cloud_billings::BillingError::OrgNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            o2_cloud_billings::BillingError::SessionIdNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            o2_cloud_billings::BillingError::SubscriptionNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            _ => MetaHttpResponse::bad_request(self.to_string()),
        }
    }
}
