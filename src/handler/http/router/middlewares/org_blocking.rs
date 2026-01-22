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

use axum::{extract::Request, middleware::Next, response::Response};
#[cfg(feature = "cloud")]
use {
    crate::service::organization, axum::http::StatusCode, axum::response::IntoResponse,
    config::cluster::LOCAL_NODE, config::get_config,
};

pub async fn blocked_orgs_middleware(request: Request, next: Next) -> Response {
    #[cfg(not(feature = "cloud"))]
    {
        next.run(request).await
    }

    #[cfg(feature = "cloud")]
    {
        let prefix = format!("{}/api/", get_config().common.base_uri);
        let path = request
            .uri()
            .path()
            .strip_prefix(&prefix)
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("");

        // in middleware, we only want to block ingestion request
        // so for non ingester node, we can allow pass.
        if LOCAL_NODE.is_ingester()
            && config::router::INGESTER_ROUTES
                .iter()
                .any(|r| path.ends_with(r))
        {
            // for all ingester routes, the first part of path is org_id
            let org_id = path.split('/').next().unwrap_or("");
            // the function can return error if there were any db errors or such
            // in that case, we allow the request to proceed
            match organization::is_org_in_free_trial_period(org_id).await {
                Ok(ongoing) => {
                    // if the trial period is not ongoing, we will block the org here itself
                    if !ongoing {
                        log::info!("{org_id} blocked in middleware");
                        return (
                            StatusCode::TOO_MANY_REQUESTS,
                            "organization has expired its trial period",
                        )
                            .into_response();
                    }
                }
                Err(e) => {
                    log::error!("error in middleware while checking for trial period : {e}");
                }
            }
        }
        next.run(request).await
    }
}
