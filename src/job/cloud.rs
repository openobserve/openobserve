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

use std::collections::HashMap;

use config::utils::{
    json,
    time::{hour_micros, now_micros},
};
use infra::table::org_users::get_admin;

use crate::{common::meta::telemetry, service::stream::get_streams};

/// This file has all odd-jobs that are specific to cloud installation,
/// and do not fit specifically anywhere else

// check and report no
const NO_INGESTION_REPORT_INTERVAL: u64 = 3600;

pub fn start() {
    tokio::spawn(async move { report_org_no_ingestion().await });
}

async fn report_no_ingestion(org_id: &str) {
    // Send no ingestion in last 24 hours to ActiveCampaign via segment proxy
    log::info!("sending track event : no ingestion in last 24 hours for {org_id} to segment");
    let org_admin = match get_admin(org_id).await {
        Ok(u) => u,
        Err(e) => {
            log::error!("error in getting admin for org {org_id} : {e}");
            return;
        }
    };
    let segment_event_data = HashMap::from([
        (
            "email".to_string(),
            json::Value::String(org_admin.email.to_string()),
        ),
        (
            "organization".to_string(),
            json::Value::String(org_id.to_string()),
        ),
        (
            "created_at".to_string(),
            json::Value::String(chrono::Local::now().format("%Y-%m-%d").to_string()),
        ),
    ]);
    telemetry::Telemetry::new()
        .send_track_event(
            "OpenObserve - No ingestion after creation",
            Some(segment_event_data),
            false,
            false,
        )
        .await;
}

pub async fn report_org_no_ingestion() {
    let h24_micro = hour_micros(24);
    let h25_micro = hour_micros(25);

    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        NO_INGESTION_REPORT_INTERVAL,
    ));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        log::info!("checking no ingestion for orgs created in last 24 hours");
        let now = now_micros();
        let all_orgs = match infra::table::organizations::list(None).await {
            Ok(o) => o,
            Err(e) => {
                log::error!("error in list all orgs for the no ingestion telemetry job {e}");
                continue;
            }
        };
        // TODO: extract the filter in sql query itself
        let filtered = all_orgs
            .into_iter()
            .filter(|org| org.created_at > now - h25_micro && org.created_at <= now - h24_micro)
            .collect::<Vec<_>>();
        for org in filtered {
            let streams = get_streams(&org.identifier, None, false, None).await;
            if streams.is_empty() {
                report_no_ingestion(&org.identifier).await;
            }
        }
        log::info!("check for no ingestion for orgs created in last 24 hours completed");
    }
}
