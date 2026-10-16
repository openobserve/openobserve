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

//! The OSS half of alert calibration: the search the collector cannot reach, and the digest sink.

pub mod sink;

use std::pin::Pin;

use config::{
    ider,
    meta::{
        cluster::RoleGroup,
        search::{Request, Response},
        stream::StreamType,
    },
};
use o2_enterprise::enterprise::{
    alert_calibration_collect::collector::AlertCalibrationSearchPort, alert_calibration_service,
};
use search_service::grpc_search::grpc_search;

/// Enterprise cannot depend on `search_service`, so its collector's search is injected from here.
pub(crate) struct SearchAdapter;

impl AlertCalibrationSearchPort for SearchAdapter {
    fn search(
        &self,
        org_id: String,
        request: Request,
        role_group: Option<RoleGroup>,
    ) -> Pin<Box<dyn Future<Output = Result<Response, anyhow::Error>> + Send>> {
        Box::pin(async move {
            // `grpc_search` is the entry point that honours `role_group`.
            grpc_search(
                &ider::generate(),
                &org_id,
                StreamType::Logs,
                None,
                &request,
                role_group,
            )
            .await
            .map_err(Into::into)
        })
    }
}

/// Best effort: the startup backfill covers an org this misses.
pub async fn ensure_org_config(org: &str) {
    if !alert_calibration_service::is_enabled() {
        return;
    }
    if let Err(e) = alert_calibration_service::ensure_config(org).await {
        log::warn!("[alert_calibration] could not create the default config for org '{org}': {e}");
    }
}

/// Every org gets a config, so the default cadence runs without anyone opening the settings.
pub async fn backfill_org_configs() -> Result<(), anyhow::Error> {
    if !alert_calibration_service::is_enabled() {
        return Ok(());
    }
    let locker = infra::dist_lock::lock("/alert_calibration/org_config_backfill", 0).await?;
    let orgs = crate::organization::list_all_orgs(None)
        .await
        .unwrap_or_default();
    for org in &orgs {
        if let Err(e) = alert_calibration_service::ensure_config(&org.identifier).await {
            log::error!(
                "[alert_calibration] default config backfill failed for org '{}': {e}",
                org.identifier
            );
        }
    }
    infra::dist_lock::unlock(&locker).await?;
    log::info!(
        "[alert_calibration] default config backfill covered {} orgs",
        orgs.len()
    );
    Ok(())
}
