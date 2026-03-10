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

use config::{
    meta::destinations::Email,
    utils::{
        json,
        time::{hour_micros, now_micros},
    },
};
use infra::table::org_users::get_admin;

use crate::{common::meta::telemetry, service::stream::get_streams};

/// This file has all odd-jobs that are specific to cloud installation,
/// and do not fit specifically anywhere else
// interval for checking and reporting no ingestion events
const NO_INGESTION_REPORT_INTERVAL: u64 = 3600;

pub fn start() {
    tokio::spawn(async move { run_no_ingestion().await });
    tokio::spawn(async move { run_ai_quota_check().await });
}

async fn run_no_ingestion() {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        NO_INGESTION_REPORT_INTERVAL,
    ));
    interval.tick().await; // trigger the first run
    loop {
        report_org_no_ingestion(24, "24hr").await;
        report_org_no_ingestion(24 * 7, "7d").await;
        report_org_no_ingestion(24 * 13, "13d").await;
        interval.tick().await;
    }
}

async fn report_no_ingestion_to_segment(org_id: &str, duration: &str) {
    // Send no ingestion in last 24 hours to ActiveCampaign via segment proxy
    log::info!("sending track event : no ingestion in duration {duration} for {org_id} to segment");
    let org_admin = match get_admin(org_id).await {
        Ok(u) => u,
        Err(e) => {
            log::error!("error in getting admin for org {org_id} : {e}");
            return;
        }
    };
    let segment_event_data = HashMap::from([
        (
            "admin_email".to_string(),
            json::Value::String(org_admin.email.to_string()),
        ),
        (
            "organization_id".to_string(),
            json::Value::String(org_id.to_string()),
        ),
        (
            "duration".to_string(),
            json::Value::String(duration.to_string()),
        ),
    ]);
    let mut telemetry_instance = telemetry::Telemetry::new();
    telemetry_instance
        .send_track_event(
            "OpenObserve - No ingestion after creation",
            Some(segment_event_data.clone()),
            false,
            false,
        )
        .await;

    telemetry_instance
        .send_keyevent_track_event(
            "OpenObserve - No ingestion after creation",
            Some(segment_event_data),
            false,
            false,
        )
        .await;
}

async fn report_org_no_ingestion(start_hour: i64, duration: &str) {
    let h_start_micro = hour_micros(start_hour);
    let h_end_micro = hour_micros(start_hour + 1);

    log::info!("checking no ingestion for duration {duration}");
    let now = now_micros();

    let filter = infra::table::organizations::ListFilter {
        created_after: Some(now - h_end_micro),
        created_before: Some(now - h_start_micro),
        limit: None,
    };

    let orgs = match infra::table::organizations::list(filter).await {
        Ok(o) => o,
        Err(e) => {
            log::error!(
                "error in list all orgs for the no ingestion duration {duration} telemetry job {e}"
            );
            return;
        }
    };
    for org in orgs {
        let streams = get_streams(&org.identifier, None, false, None).await;
        if streams.is_empty() {
            report_no_ingestion_to_segment(&org.identifier, duration).await;
        }
    }
    log::info!("check for no ingestion for duration {duration} completed");
}

async fn run_ai_quota_check() {
    let cfg = o2_enterprise::enterprise::common::config::get_config();
    let interval_secs = cfg.cloud.ai_quota_check_interval;
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(interval_secs));
    interval.tick().await; // skip first immediate tick
    loop {
        interval.tick().await;
        check_all_orgs_ai_quota().await;
    }
}

async fn check_all_orgs_ai_quota() {
    use crate::service::trial_quota;

    let orgs = crate::service::db::schema::list_organizations_from_cache().await;
    for org_id in orgs {
        let checkpoint = match trial_quota::get_pending_checkpoint(&org_id).await {
            Some(cp) => cp,
            None => continue,
        };

        // Atomically claim this checkpoint in DB — only one pod wins
        if !trial_quota::mark_checkpoint_notified(&org_id, checkpoint).await {
            // Another pod already sent this checkpoint email
            continue;
        }

        // Get admin email for this org
        let admin = match get_admin(&org_id).await {
            Ok(u) => u,
            Err(e) => {
                log::error!("[AI_QUOTA] Failed to get admin for org={org_id}: {e}");
                continue;
            }
        };

        let is_paid = trial_quota::org_has_active_subscription(&org_id).await;
        let used = trial_quota::get_used(&org_id);
        let limit = trial_quota::get_limit(&org_id);

        let (subject, body) =
            trial_quota::build_quota_email_message(checkpoint, is_paid, used, limit);

        let email = Email {
            recipients: vec![admin.email.clone()],
        };

        match crate::service::alerts::alert::send_email_notification(&subject, &email, body).await {
            Ok(_) => {
                log::info!(
                    "[AI_QUOTA] Sent {}% checkpoint email to {} for org={org_id}",
                    checkpoint,
                    admin.email
                );
            }
            Err(e) => {
                log::error!(
                    "[AI_QUOTA] Failed to send {}% checkpoint email for org={org_id}: {e}",
                    checkpoint
                );
            }
        }
    }
}
