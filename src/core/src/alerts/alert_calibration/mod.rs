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

pub mod applied;
pub mod dismissals;
pub mod sink;

use std::{
    collections::{BTreeSet, HashMap},
    pin::Pin,
};

use config::{
    cluster::LOCAL_NODE,
    ider,
    meta::{
        cluster::RoleGroup,
        search::{Request, Response},
        stream::StreamType,
    },
};
use o2_enterprise::enterprise::{
    alert_calibration_collect::collector::{self, AlertCalibrationSearchPort},
    alert_calibration_rules::context::DestinationCandidate,
    alert_calibration_service,
};
use search_service::grpc_search::grpc_search;

/// A wait this short only ever expires because another scheduler node is already backfilling.
const BACKFILL_LOCK_WAIT_SECS: u64 = 5;

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

    fn destinations_usable_by(
        &self,
        org_id: String,
        user_id: String,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<String>, anyhow::Error>> + Send>> {
        Box::pin(async move {
            // A departed owner fails the lookup, so their alerts get no suggestion (P8a-D2).
            if db::user::get(Some(&org_id), &user_id).await?.is_none() {
                return Ok(Vec::new());
            }
            Ok(usable_destination_names(&org_id, &user_id)
                .await?
                .into_iter()
                .collect())
        })
    }
}

/// The destinations `user_id` could pick in the alert editor, by the editor's own list.
pub async fn usable_destination_names(
    org_id: &str,
    user_id: &str,
) -> anyhow::Result<BTreeSet<String>> {
    let permitted =
        crate::authz::list_objects_for_user(org_id, user_id, "GET", "destination").await?;
    Ok(super::destinations::list(org_id, Some("alert"), permitted)
        .await?
        .into_iter()
        .map(|destination| destination.name)
        .collect())
}

/// The named alerts' folder candidates from the live alerts, by each owner's own list.
pub async fn live_destination_candidates(
    org_id: &str,
    alert_ids: &BTreeSet<String>,
) -> anyhow::Result<HashMap<String, DestinationCandidate>> {
    Ok(collector::live_destination_candidates(&SearchAdapter, org_id, alert_ids).await?)
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
    // Only scheduler nodes run the passes, so only they have a reason to mint the rows.
    if !alert_calibration_service::is_enabled() || !LOCAL_NODE.is_scheduler() {
        return Ok(());
    }
    let locker = match infra::dist_lock::lock(
        "/alert_calibration/org_config_backfill",
        BACKFILL_LOCK_WAIT_SECS,
    )
    .await
    {
        Ok(locker) => locker,
        Err(e) => {
            log::info!(
                "[alert_calibration] default config backfill is running elsewhere, skipping: {e}"
            );
            return Ok(());
        }
    };
    // A blocked org's rows are deleted by its cleanup, which a restart must not undo.
    let orgs = crate::db::organization::list_unblocked()
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
