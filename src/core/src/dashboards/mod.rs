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

//! Compatibility facade for dashboard services.
//!
//! Dashboard CRUD and domain logic live in `openobserve-dashboards`. The only
//! composition retained here is user-specific authorization filtering because
//! the current authz/user services are still owned by `openobserve-core`.

use config::meta::{
    dashboards::{Dashboard, ListDashboardsParams},
    folder::Folder,
};
pub use openobserve_dashboards::*;

pub mod reports {
    pub use openobserve_reports::*;
}
pub mod timed_annotations {
    pub use openobserve_dashboards::timed_annotations::*;
}

#[tracing::instrument]
pub async fn list_dashboards(
    user_id: &str,
    params: ListDashboardsParams,
) -> Result<Vec<(Folder, Dashboard)>, DashboardError> {
    let org_id = params.org_id.clone();
    let folder_id = params.folder_id.clone();
    let dashboards = openobserve_dashboards::list_all_dashboards(params).await?;
    filter_permitted_dashboards(&org_id, user_id, dashboards, folder_id).await
}

#[cfg(not(feature = "enterprise"))]
async fn filter_permitted_dashboards(
    _org_id: &str,
    _user_id: &str,
    dashboards: Vec<(Folder, Dashboard)>,
    _folder_id: Option<String>,
) -> Result<Vec<(Folder, Dashboard)>, DashboardError> {
    Ok(dashboards)
}

#[cfg(feature = "enterprise")]
async fn filter_permitted_dashboards(
    org_id: &str,
    user_id: &str,
    dashboards: Vec<(Folder, Dashboard)>,
    folder_id: Option<String>,
) -> Result<Vec<(Folder, Dashboard)>, DashboardError> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    use crate::{common::utils::auth::AuthExtractor, service::db::user::get as get_user};

    if let Some(folder_id) = folder_id {
        let user_role = match get_user(Some(org_id), user_id).await {
            Ok(Some(user)) => user.role,
            _ => return Err(DashboardError::UserNotFound),
        };
        let permitted = crate::service::authz::check_permissions(
            user_id,
            AuthExtractor {
                org_id: org_id.to_string(),
                o2_type: format!("{}:{folder_id}", OFGA_MODELS.get("folders").unwrap().key),
                method: "GET".to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
                use_all_org: false,
                use_self_context: false,
                use_self_parent: true,
                auth: "".to_string(),
            },
            user_role,
            false,
        )
        .await;
        if permitted {
            return Ok(dashboards);
        }
    }

    let permitted_objects = crate::service::authz::list_objects_for_user(
        org_id,
        user_id,
        "GET_INDIVIDUAL_FROM_ROLE",
        "dashboard",
    )
    .await
    .map_err(|error| DashboardError::ListPermittedDashboardsError(anyhow::anyhow!(error)))?;

    Ok(dashboards
        .into_iter()
        .filter(|(folder, dashboard)| {
            let folder_id = &folder.folder_id;
            let Some(dashboard_id) = dashboard.dashboard_id() else {
                return false;
            };

            permitted_objects.is_none()
                || permitted_objects.as_ref().is_some_and(|objects| {
                    objects.contains(&format!("dashboard:{folder_id}/{dashboard_id}"))
                        || objects.contains(&format!("dashboard:{dashboard_id}"))
                        || objects.contains(&format!("dashboard:_all_{org_id}"))
                })
        })
        .collect())
}
