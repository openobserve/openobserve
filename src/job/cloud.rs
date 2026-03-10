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
    meta::self_reporting::usage::USAGE_STREAM,
    utils::{
        json,
        time::{hour_micros, now_micros},
    },
};
use hashbrown::HashSet;
use infra::table::org_users::get_admin;

use crate::{
    common::{infra::config::ORGANIZATIONS, meta::telemetry},
    service::{
        organization::is_org_in_free_trial_period, self_reporting::search::get_usage,
        stream::get_streams,
    },
};

/// This file has all odd-jobs that are specific to cloud installation,
/// and do not fit specifically anywhere else
// interval for checking and reporting no ingestion events
const NO_INGESTION_REPORT_INTERVAL: u64 = 3600;

pub fn start() {
    tokio::spawn(async move { run_no_ingestion_period().await });
    tokio::spawn(async move { run_no_ingestion_daily().await });
    tokio::spawn(async move { run_org_expiry_daily().await });
}

async fn run_no_ingestion_period() {
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

async fn report_to_segment(event: &str, org_id: &str, duration: &str) {
    // Send no ingestion in last 24 hours to ActiveCampaign via segment proxy
    log::info!("sending track event : {event} duration {duration} for {org_id} to segment");
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
        .send_track_event(event, Some(segment_event_data.clone()), false, false)
        .await;

    telemetry_instance
        .send_keyevent_track_event(event, Some(segment_event_data), false, false)
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
            report_to_segment(
                "OpenObserve - No ingestion after creation",
                &org.identifier,
                duration,
            )
            .await;
        }
    }
    log::info!("check for no ingestion for duration {duration} completed");
}

async fn run_no_ingestion_daily() {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_hours(24));
    loop {
        interval.tick().await;
        log::info!("starting daily no ingestion reporting");
        let orgs = match get_usage(
            format!(
                "select org_id from \"{USAGE_STREAM}\" where event = 'Ingestion' group by org_id"
            ),
            now_micros() - hour_micros(24), // last 24 hours
            now_micros(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("error in getting orgs for checking no ingestion in last 24 hrs : {e}");
                continue;
            }
        };
        // get the org_ids which have ingested data in last 24 hours
        let orgs: HashSet<_> = orgs
            .into_iter()
            .flat_map(|v| {
                v.pointer("/org_id")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            })
            .collect();

        // get list of all orgs in db, which should be already cached
        let org_cache = { ORGANIZATIONS.read().await.clone() };

        for (org, _) in org_cache {
            // skip for these two as internal orgs
            if org == "_meta" || org == "default" {
                continue;
            }
            let trial_period = match is_org_in_free_trial_period(&org).await {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error in getting trial period info for org {org} for no ingestion daily :{e}"
                    );
                    continue;
                }
            };
            // if not ingested data in last 24 hours and org is in free trial/ subscribed
            // send an event for that org
            if !orgs.contains(&org) && trial_period {
                report_to_segment("OpenObserve - No ingestion in last day", &org, "last 1 day")
                    .await;
            }
        }
        log::info!("daily no ingestion reporting completed");
    }
}

async fn run_org_expiry_daily() {
    use o2_enterprise::enterprise::cloud::billings;
    let hr_micro = hour_micros(24);
    let mut interval = tokio::time::interval(tokio::time::Duration::from_hours(24));
    loop {
        interval.tick().await;
        let now = chrono::Utc::now().timestamp_micros();
        log::info!("starting daily expiry reminder reporting");
        // get all orgs from db, which should be cached in memory
        let org_cache = { ORGANIZATIONS.read().await.clone() };

        for (org, _) in org_cache {
            // skip internal orgs
            if org == "_meta" || org == "default" {
                continue;
            }

            // get the subscription for the org, this would also likely be cached in memory
            let subscription = match billings::get_billing_by_org_id(&org).await {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error getting billing info for org {org} for org expiry daily : {e}"
                    );
                    continue;
                }
            };

            // if org is free, then report how many days for expiry
            if subscription.is_none() || subscription.unwrap().subscription_type.is_free_sub() {
                // org record is also cached in memory for most cases
                let org_record = match infra::table::organizations::get(&org).await {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!(
                            "error in getting org record for org {org} for org expiry daily : {e}"
                        );
                        continue;
                    }
                };
                // if trial period is still on going, then report the remaining days
                if now <= org_record.trial_ends_at {
                    let remaining_days = (org_record.trial_ends_at - now) / hr_micro;
                    report_to_segment(
                        "OpenObserve - Org expiry reminder",
                        &org,
                        &format!("{remaining_days} days"),
                    )
                    .await;
                }
            }
        }
        log::info!("daily expiry reminder reporting completed");
    }
}
