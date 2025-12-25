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

#[cfg(feature = "enterprise")]
use actix_web::error::ErrorForbidden;
use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    middleware,
};

/// Middleware to check if service accounts feature is enabled
pub async fn service_account_guard_middleware(
    req: ServiceRequest,
    next: middleware::Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, actix_web::Error> {
    #[cfg(not(feature = "enterprise"))]
    {
        // In non-enterprise mode, service accounts are always enabled
        let res = next.call(req).await?;
        Ok(res)
    }

    #[cfg(feature = "enterprise")]
    {
        let service_account_enabled = o2_dex::config::get_config().service_account_enabled;

        if !service_account_enabled {
            return Err(ErrorForbidden("Service Accounts Not Supported"));
        }

        let res = next.call(req).await?;
        Ok(res)
    }
}
