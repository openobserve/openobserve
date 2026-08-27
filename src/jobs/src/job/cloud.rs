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

use std::collections::HashMap;

use config::{
    meta::{
        destinations::Email,
        self_reporting::usage::{USAGE_STREAM, UsageEvent},
    },
    utils::{
        json,
        time::{hour_micros, now_micros},
    },
};
use hashbrown::HashSet;
use infra::table::org_users::get_admin;
use stream::get_streams;

use crate::{
    common::{infra::config::ORGANIZATIONS, meta::telemetry},
    service::{organization::is_org_in_free_trial_period, self_reporting::search::get_usage},
};

/// This file has all odd-jobs that are specific to cloud installation,
/// and do not fit specifically anywhere else
// interval for checking and reporting no ingestion events
const NO_INGESTION_REPORT_INTERVAL: u64 = 3600;

/// DB flush interval for trial quota deductions (seconds).
const TRIAL_QUOTA_FLUSH_INTERVAL: u64 = 10;

/// Interval for external contract expiry checks (1 hour).
const EXTERNAL_CONTRACT_CHECK_INTERVAL: u64 = 3600;

/// Interval for the SPEC §9B.3 synthetics step reconciliation (1 hour).
const SYNTHETICS_STEP_RECONCILE_INTERVAL: u64 = 3600;

/// (days-remaining threshold, stage stored after the warning fires).
/// Walked in descending-urgency order so we send at most one warning per tick.
const EXPIRY_WARNING_STAGES: &[(
    i64,
    o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage,
)] = {
    use o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage::*;
    &[(1, OneDay), (7, SevenDay), (30, ThirtyDay)]
};

pub fn start() {
    tokio::spawn(async move { run_no_ingestion_period().await });
    tokio::spawn(async move { run_no_ingestion_daily().await });
    tokio::spawn(async move { run_org_expiry_daily().await });
    tokio::spawn(async move { run_ai_quota_check().await });
    tokio::spawn(async move { run_external_contract_expiry_check().await });
    tokio::spawn(async move { run_synthetics_step_reconcile().await });
}

/// Start trial quota background jobs (flush + cluster sync).
/// Must run on ALL nodes, not just scheduler.
pub fn start_trial_quota_jobs() {
    tokio::spawn(async move { run_trial_quota_flush().await });
    tokio::spawn(async move {
        openobserve_core::trial_quota::subscribe_ha_queue().await;
    });
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

async fn run_trial_quota_flush() {
    let mut interval =
        tokio::time::interval(tokio::time::Duration::from_secs(TRIAL_QUOTA_FLUSH_INTERVAL));
    interval.tick().await; // skip first immediate tick
    loop {
        interval.tick().await;
        openobserve_core::trial_quota::flush_to_db().await;
        openobserve_core::trial_quota::refresh_limits_from_db().await;
    }
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
    use openobserve_core::trial_quota;

    let orgs = db::schema::list_organizations_from_cache().await;

    // Pre-fetch all notified checkpoints in a single GROUP-BY query to avoid
    // one DB round-trip per org (N+1).
    let all_checkpoints: HashMap<String, i16> =
        match infra::table::trial_quota_usage::load_all_checkpoints().await {
            Ok(rows) => rows.into_iter().collect(),
            Err(e) => {
                log::error!("[AI_QUOTA] Failed to load checkpoints: {e}");
                return;
            }
        };

    for org_id in orgs {
        let already_notified = all_checkpoints.get(&org_id).copied().unwrap_or(0) as u8;
        let pct = trial_quota::get_quota_percentage(&org_id);
        let checkpoint = match trial_quota::pending_checkpoint_from(pct, already_notified) {
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

        let policy =
            o2_enterprise::enterprise::cloud::ai_credits::resolve_ai_credit_exhaustion_policy(
                &org_id,
            )
            .await;
        let used = trial_quota::get_used(&org_id);
        let limit = trial_quota::get_limit(&org_id);

        let org_name = match infra::table::organizations::get(&org_id).await {
            Ok(record) => record.org_name,
            Err(e) => {
                log::warn!("[AI_QUOTA] Failed to get org name for org={org_id}: {e}");
                String::new()
            }
        };

        let (subject, body) =
            o2_enterprise::enterprise::cloud::ai_credits::build_ai_credit_quota_email(
                &org_id, &org_name, checkpoint, policy, used, limit,
            );

        let email = Email {
            recipients: vec![admin.email.clone()],
        };

        match openobserve_core::alerts::alert::send_email_notification(
            &subject,
            &email,
            body.clone(),
            body,
        )
        .await
        {
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
            false,
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
            if subscription.is_none_or(|s| s.subscription_type.is_free_sub()) {
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

async fn run_external_contract_expiry_check() {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        EXTERNAL_CONTRACT_CHECK_INTERVAL,
    ));
    interval.tick().await; // skip first immediate tick
    loop {
        interval.tick().await;
        check_external_contract_expiry().await;
    }
}

async fn check_external_contract_expiry() {
    use o2_enterprise::enterprise::cloud::billings::MeteringProvider;

    let billings = match o2_enterprise::enterprise::cloud::list_customer_billings().await {
        Ok(cbs) => cbs,
        Err(e) => {
            log::error!("[EXT_CONTRACT] Failed to list customer billings: {e}");
            return;
        }
    };

    let now = chrono::Utc::now().timestamp_micros();
    let day_micros = hour_micros(24);

    for cb in billings {
        if !matches!(cb.provider, MeteringProvider::NoOp) {
            continue;
        }

        let Some(end_date) = cb.end_date else {
            continue;
        };

        let org_id = &cb.org_id;

        // Check if contract has expired
        if end_date <= now {
            log::info!(
                "[EXT_CONTRACT] External contract expired for org {org_id}, reverting to Free tier"
            );

            // try cancelling subscription of member orgs
            if let Err(e) =
                o2_enterprise::enterprise::cloud::billing_group::remove_member_billing_of(org_id)
                    .await
            {
                log::error!(
                    "[EXT_CONTRACT] Failed to delete members of expired billing for org {org_id}: {e}",
                );
                continue;
            }

            if let Err(e) =
                o2_enterprise::enterprise::cloud::customer_billings::delete_by_org_id(org_id).await
            {
                log::error!(
                    "[EXT_CONTRACT] Failed to delete expired billing for org {org_id}: {e}"
                );
            }
            continue;
        }

        // Check if we need to send expiry warnings
        let days_remaining = (end_date - now) / day_micros;

        let stage = match find_pending_expiry_stage(days_remaining, cb.expiry_notified_stage) {
            Some(s) => s,
            None => continue,
        };

        // Send warning email to org admin
        let admin = match get_admin(org_id).await {
            Ok(u) => u,
            Err(e) => {
                log::error!("[EXT_CONTRACT] Failed to get admin for org={org_id}: {e}");
                continue;
            }
        };

        let org_name = match infra::table::organizations::get(org_id).await {
            Ok(record) => record.org_name,
            Err(_) => String::new(),
        };

        let (subject, body) =
            build_external_contract_expiry_email(org_id, &org_name, days_remaining);

        let email = Email {
            recipients: vec![admin.email.clone()],
        };

        match openobserve_core::alerts::alert::send_email_notification(
            &subject,
            &email,
            body.clone(),
            body,
        )
        .await
        {
            Ok(_) => {
                log::info!(
                    "[EXT_CONTRACT] Sent {stage:?} expiry warning to {} for org={org_id}",
                    admin.email
                );
            }
            Err(e) => {
                log::error!(
                    "[EXT_CONTRACT] Failed to send expiry warning email for org={org_id}: {e}"
                );
                continue;
            }
        }

        // Report to segment proxy for contract expiry tracking
        report_to_segment(
            "OpenObserve - Contract expiry reminder",
            org_id,
            &format!("{days_remaining} days"),
        )
        .await;

        // Advance the stored stage so we don't resend.
        let mut updated_billing = cb.clone();
        updated_billing.expiry_notified_stage = Some(stage);
        if let Err(e) =
            o2_enterprise::enterprise::cloud::update_customer_billing(updated_billing).await
        {
            log::error!("[EXT_CONTRACT] Failed to update expiry stage for org={org_id}: {e}");
        }
    }
}

fn build_external_contract_expiry_email(
    org_id: &str,
    org_name: &str,
    days_remaining: i64,
) -> (String, String) {
    let display_name = if org_name.is_empty() {
        org_id
    } else {
        org_name
    };

    let subject = format!(
        "[OpenObserve] Contract expiring in {} day{} — {}",
        days_remaining,
        if days_remaining == 1 { "" } else { "s" },
        display_name
    );

    let message = if days_remaining <= 1 {
        "Your contract expires tomorrow. Please contact your account manager to renew \
         and avoid service interruption."
    } else if days_remaining <= 7 {
        "Your contract is expiring soon. Please contact your account manager to renew \
         your subscription."
    } else {
        "Your contract will expire in the coming weeks. Please reach out to your \
         account manager if you'd like to renew."
    };

    let display_name_esc = html_escape(display_name);
    let org_id_esc = html_escape(org_id);
    let body = format!(
        "<html><body>\
        <h2>Contract Expiry Notice</h2>\
        <p><strong>Organization:</strong> {display_name_esc} ({org_id_esc})</p>\
        <p>{message}</p>\
        <p><strong>Days remaining:</strong> {days_remaining}</p>\
        <p>After expiry, your organization will revert to the Free tier.</p>\
        </body></html>"
    );

    (subject, body)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Pick the most-urgent expiry warning stage that should fire, given the current
/// `days_remaining` and the last stage already notified.
///
/// Walks `EXPIRY_WARNING_STAGES` in descending-urgency order (30 → 7 → 1) and
/// returns the first stage whose threshold has been reached and is strictly
/// greater than `current_stage`. Returns `None` when no new warning is due.
fn find_pending_expiry_stage(
    days_remaining: i64,
    current_stage: Option<o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage>,
) -> Option<o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage> {
    EXPIRY_WARNING_STAGES
        .iter()
        .find(|(threshold, stage)| {
            days_remaining <= *threshold && current_stage.is_none_or(|s| s < *stage)
        })
        .map(|(_, stage)| *stage)
}

// SPEC §9B.3 — per org, `SUM(size)` over the two step events in the usage stream
// vs `trial_quota_usage.usage_count`. They arrive by entirely separate paths, so
// divergence is the only signal that pool adjustments are being lost (§11 **F8**
// drops a flush record but not the usage row for the same ack), and under §6.1's
// one-time grant that loss is permanent and invisible until the org runs short.

/// One org's two answers, and their difference.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StepReconciliation {
    org_id: String,
    /// `SUM(size)` over the two step events in the usage stream.
    stream_steps: i64,
    /// `trial_quota_usage.usage_count` for the synthetics pool.
    pool_steps: i64,
}

impl StepReconciliation {
    /// `stream - pool`, signed — the number **A8** alerts on. POSITIVE: the pool
    /// never charged steps the usage stream recorded (§11 **F8**; under §6.1's
    /// one-time grant the org silently keeps them). NEGATIVE: the emit lost rows.
    fn divergence(&self) -> i64 {
        self.stream_steps - self.pool_steps
    }
}

/// Joins the two sides over the UNION of their orgs — SPEC §9B.3.
///
/// Union, not intersection: an org present on one side only is the serious case
/// (every flush record dropped, or steps charged against a grant with no usage
/// row), and an inner join reports it exactly like a healthy org.
///
/// Sorted by org so the caller's log lines and the gauge order are stable.
fn reconcile_steps(stream: &[(String, i64)], pool: &[(String, i64)]) -> Vec<StepReconciliation> {
    let mut merged: HashMap<&str, (i64, i64)> = HashMap::new();
    for (org_id, steps) in stream {
        merged.entry(org_id.as_str()).or_default().0 += steps;
    }
    for (org_id, steps) in pool {
        merged.entry(org_id.as_str()).or_default().1 += steps;
    }

    let mut rows = merged
        .into_iter()
        .map(|(org_id, (stream_steps, pool_steps))| StepReconciliation {
            org_id: org_id.to_string(),
            stream_steps,
            pool_steps,
        })
        .collect::<Vec<_>>();
    rows.sort_by(|a, b| a.org_id.cmp(&b.org_id));
    rows
}

/// Publishes §9B.3's three gauges and advances the pass counter.
///
/// The gauges are RESET first: a label set that stops being reported keeps its
/// last value forever, so a corrected or unsubscribed org would alert forever.
/// The counter advances even with nothing to report, because after the reset
/// "no divergence anywhere" and "this job stopped running" scrape identically.
fn publish_step_reconciliation(rows: &[StepReconciliation]) {
    config::metrics::SYNTHETICS_STEP_RECONCILE_STREAM_STEPS.reset();
    config::metrics::SYNTHETICS_STEP_RECONCILE_POOL_STEPS.reset();
    config::metrics::SYNTHETICS_STEP_RECONCILE_DIVERGENCE_STEPS.reset();

    for row in rows {
        let labels = [row.org_id.as_str()];
        config::metrics::SYNTHETICS_STEP_RECONCILE_STREAM_STEPS
            .with_label_values(&labels)
            .set(row.stream_steps);
        config::metrics::SYNTHETICS_STEP_RECONCILE_POOL_STEPS
            .with_label_values(&labels)
            .set(row.pool_steps);
        config::metrics::SYNTHETICS_STEP_RECONCILE_DIVERGENCE_STEPS
            .with_label_values(&labels)
            .set(row.divergence());
    }

    config::metrics::SYNTHETICS_STEP_RECONCILE_SCANS_TOTAL.inc();
}

/// The `SUM(size)` half of §9B.3, as SQL.
///
/// BOTH of §4.2's step events: §6.1's grant is spent by whichever one the ack
/// emitted — `SyntheticsFreeSteps` while the grant has room, `SyntheticsSteps`
/// once it is gone — so summing only the billable one reports every org still
/// inside its evaluation budget as diverging by its entire consumption. Names
/// come from `UsageEvent`'s `Display`, so a rename cannot silently zero this.
fn step_usage_sql() -> String {
    format!(
        "SELECT org_id, SUM(size) AS value FROM \"{USAGE_STREAM}\" WHERE event IN ('{}', '{}') \
         GROUP BY org_id",
        UsageEvent::SyntheticsSteps,
        UsageEvent::SyntheticsFreeSteps,
    )
}

/// One row of [`step_usage_sql`], or `None` if it is not one.
///
/// Read field by field rather than through a `Deserialize` derive so a row in
/// an unexpected shape is SKIPPED rather than aborting the pass — §11 **F2** is
/// the same failure one layer up, where one unreadable usage row halts metering
/// fleet-wide. `as_f64` also accepts the integer `SUM(size)` returns.
fn step_usage_row(hit: &json::Value) -> Option<(String, i64)> {
    let org_id = hit.get("org_id")?.as_str()?;
    let steps = hit.get("value")?.as_f64()?;
    Some((org_id.to_string(), steps as i64))
}

/// One §9B.3 pass.
///
/// The usage read is REGION-LOCAL (`local = true`) where metering's is federated
/// (§8.3): `trial_quota_usage` is a per-region meta table with no super-cluster
/// handler (§8.3's **F4**, item 2.6), so the pool side is this region's only.
/// Reading the stream side federated would compare N regions' usage against one
/// region's counter and report every org as diverging, forever.
///
/// `start_time = 0`: §6.1's grant never resets, so `usage_count` is a lifetime
/// total and the stream side must be one too. Where the `usage` stream's
/// retention is shorter, the stream side under-reports whatever aged out — a
/// NEGATIVE divergence that grows with retention, not with any defect.
async fn reconcile_synthetics_steps() {
    let stream = match get_usage(step_usage_sql(), 0, now_micros(), true).await {
        Ok(hits) => hits
            .into_iter()
            .filter_map(|hit| {
                step_usage_row(&hit).or_else(|| {
                    log::warn!("[SYNTHETICS_STEP_RECONCILE] unreadable usage row: {hit}");
                    None
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            // Return rather than publish: the gauges are sticky, so resetting
            // them after a failed read would write A8's healthy state over a real
            // divergence, and the un-advanced pass counter shows the stalled job.
            log::error!("[SYNTHETICS_STEP_RECONCILE] usage query failed: {e}");
            return;
        }
    };

    let pool = match infra::table::trial_quota_usage::load_all().await {
        Ok(rows) => rows
            .into_iter()
            .filter(|row| {
                openobserve_core::trial_quota::TrialQuotaPool::SyntheticsSteps
                    .feature_keys()
                    .contains(&row.feature.as_str())
            })
            .map(|row| (row.org_id, row.usage_count))
            .collect::<Vec<_>>(),
        Err(e) => {
            log::error!("[SYNTHETICS_STEP_RECONCILE] pool counter read failed: {e}");
            return;
        }
    };

    let rows = reconcile_steps(&stream, &pool);
    for row in rows.iter().filter(|row| row.divergence() != 0) {
        log::warn!(
            "[SYNTHETICS_STEP_RECONCILE] org={} usage stream reports {} steps, the free pool \
             counter reports {} (divergence {})",
            row.org_id,
            row.stream_steps,
            row.pool_steps,
            row.divergence(),
        );
    }
    publish_step_reconciliation(&rows);
}

async fn run_synthetics_step_reconcile() {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        SYNTHETICS_STEP_RECONCILE_INTERVAL,
    ));
    interval.tick().await; // trigger the first run
    loop {
        reconcile_synthetics_steps().await;
        interval.tick().await;
    }
}

#[cfg(test)]
mod tests {
    use o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage;

    use super::*;

    /// The three gauges are process-global and `publish_step_reconciliation`
    /// resets them, so two of these at once would wipe each other's labels.
    static RECONCILE_METRICS: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Reached through a function pointer so these calls do not count towards
    /// `the_reconciliation_publishes_what_it_computed`'s by-name call count.
    fn publish(rows: &[StepReconciliation]) {
        let publish_rows: fn(&[StepReconciliation]) = publish_step_reconciliation;
        publish_rows(rows);
    }

    fn side(rows: &[(&str, i64)]) -> Vec<(String, i64)> {
        rows.iter()
            .map(|(org, steps)| ((*org).to_string(), *steps))
            .collect()
    }

    fn row(org_id: &str, stream_steps: i64, pool_steps: i64) -> StepReconciliation {
        StepReconciliation {
            org_id: org_id.to_string(),
            stream_steps,
            pool_steps,
        }
    }

    /// **§9B.3.** The two sides are joined per org and are not interchangeable;
    /// the four numbers differ on purpose, so a swapped comparison cannot pass.
    #[test]
    fn the_reconciliation_compares_the_stream_against_the_pool() {
        let rows = reconcile_steps(
            &side(&[("acme", 10_000), ("globex", 42)]),
            &side(&[("acme", 9_800), ("globex", 42)]),
        );

        assert_eq!(
            rows,
            vec![row("acme", 10_000, 9_800), row("globex", 42, 42)],
        );
        assert_eq!(
            rows[0].divergence(),
            200,
            "the stream recorded 200 steps the pool never charged — §11 F8, and under a \
             ONE-TIME grant the org keeps them",
        );
        assert_eq!(rows[1].divergence(), 0, "the healthy case");
    }

    /// The sign carries the diagnosis: inverted, A8 fires with the two causes
    /// swapped and the operator looks at the wrong half of the system.
    #[test]
    fn the_divergence_is_the_stream_minus_the_pool() {
        assert_eq!(row("a", 100, 60).divergence(), 40);
        assert_eq!(row("b", 60, 100).divergence(), -40);
        assert_eq!(row("c", 0, 0).divergence(), 0);
    }

    /// **The union, not the intersection.** An org on one side only is the most
    /// serious case there is, and an inner join reports it as healthy.
    #[test]
    fn an_org_on_one_side_only_still_reports_a_divergence() {
        let rows = reconcile_steps(&side(&[("stream-only", 500)]), &side(&[("pool-only", 300)]));

        assert_eq!(
            rows,
            vec![row("pool-only", 0, 300), row("stream-only", 500, 0)],
        );
        assert_eq!(
            rows[0].divergence(),
            -300,
            "charged against the grant with no usage row behind it",
        );
        assert_eq!(
            rows[1].divergence(),
            500,
            "every flush record for this org was dropped",
        );
    }

    /// The pool side is one row per `(org_id, feature)`, so an org with several
    /// synthetics feature keys must SUM rather than overwrite; overwriting
    /// under-reports the pool and manufactures F8's signature out of nothing.
    #[test]
    fn several_rows_for_one_org_are_summed_on_both_sides() {
        let rows = reconcile_steps(
            &side(&[("acme", 30), ("acme", 12)]),
            &side(&[("acme", 40), ("acme", 2)]),
        );
        assert_eq!(rows, vec![row("acme", 42, 42)]);
    }

    /// **A8.** All three gauges are published, per org, and the divergence is
    /// the one the row computed.
    #[test]
    fn the_reconciliation_publishes_all_three_gauges() {
        let _serialised = RECONCILE_METRICS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        publish(&[row("a8-drift", 10_000, 9_800)]);

        let labels = ["a8-drift"];
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_STREAM_STEPS
                .with_label_values(&labels)
                .get(),
            10_000,
        );
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_POOL_STEPS
                .with_label_values(&labels)
                .get(),
            9_800,
        );
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_DIVERGENCE_STEPS
                .with_label_values(&labels)
                .get(),
            200,
        );
    }

    /// The gauges are reset each pass, so a divergence that is CORRECTED stops
    /// being reported — otherwise the fix for an A8 alert leaves it firing on a
    /// stale number and the next real one lands on an alert everyone ignores.
    #[test]
    fn a_corrected_divergence_stops_being_reported() {
        let _serialised = RECONCILE_METRICS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        publish(&[row("a8-fixed", 500, 0), row("a8-kept", 42, 42)]);
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_DIVERGENCE_STEPS
                .with_label_values(&["a8-fixed"])
                .get(),
            500,
        );

        publish(&[row("a8-kept", 42, 42)]);
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_DIVERGENCE_STEPS
                .with_label_values(&["a8-fixed"])
                .get(),
            0,
        );
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_STREAM_STEPS
                .with_label_values(&["a8-fixed"])
                .get(),
            0,
        );
    }

    /// A pass that finds nothing still advances the counter: after the reset,
    /// "every org agrees" and "this job stopped running" produce an identical
    /// scrape, so only a counter scraped from outside separates them.
    #[test]
    fn a_pass_that_finds_nothing_still_advances_the_scan_counter() {
        let _serialised = RECONCILE_METRICS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let before = config::metrics::SYNTHETICS_STEP_RECONCILE_SCANS_TOTAL.get();
        publish(&[]);
        assert_eq!(
            config::metrics::SYNTHETICS_STEP_RECONCILE_SCANS_TOTAL.get() - before,
            1,
        );
    }

    /// **§9B.3's SQL.** `SyntheticsFreeSteps` is the half that is easy to forget
    /// and not a small error: orgs still inside §6.1's evaluation budget emit
    /// ONLY that event, so the stream side would read zero for exactly them.
    #[test]
    fn the_usage_query_covers_both_step_events() {
        let sql = step_usage_sql();
        assert!(sql.contains("'SyntheticsSteps'"), "{sql}");
        assert!(sql.contains("'SyntheticsFreeSteps'"), "{sql}");
        assert!(
            !sql.contains("_SyntheticsStepsDefined"),
            "`defined` is what the journey DECLARES, never what it spent — including it \
             would report a definition as pool consumption: {sql}",
        );
        assert!(!sql.contains("_SyntheticsBrowserMs"), "{sql}");
        assert!(
            sql.contains("SUM(size)") && sql.contains("GROUP BY org_id"),
            "{sql}",
        );
    }

    /// One malformed row must not cost the whole pass. §11 **F2** is this exact
    /// mistake one layer up, where a single unreadable row halts metering
    /// fleet-wide and silently.
    #[test]
    fn an_unreadable_usage_row_is_skipped_not_fatal() {
        let good = json::json!({"org_id": "acme", "value": 84.0});
        assert_eq!(step_usage_row(&good), Some(("acme".to_string(), 84)),);
        // `SUM(size)` comes back as an integer when every summand is whole.
        assert_eq!(
            step_usage_row(&json::json!({"org_id": "acme", "value": 84})),
            Some(("acme".to_string(), 84)),
        );
        for bad in [
            json::json!({"value": 84.0}),
            json::json!({"org_id": "acme"}),
            json::json!({"org_id": 7, "value": 84.0}),
            json::json!({"org_id": "acme", "value": "84"}),
            json::json!("not a row"),
        ] {
            assert_eq!(step_usage_row(&bad), None, "{bad}");
        }
    }

    /// A failed read must NOT publish: both gauges are reset before they are set,
    /// so publishing after a failed query writes A8's healthy state over a real
    /// divergence. Pinned in source because neither error arm is reachable here;
    /// the needles are assembled so this test's own source does not satisfy them.
    #[test]
    fn the_reconciliation_publishes_what_it_computed() {
        let source = include_str!("cloud.rs");
        assert_eq!(
            source
                .matches(&["publish_step", "_reconciliation("].concat())
                .count(),
            2,
            "one definition and exactly one call site are expected for A8's gauges",
        );

        let body = source
            .split_once(&["async fn reconcile_synthetics", "_steps()"].concat())
            .expect("the reconciliation pass")
            .1;
        let end = body
            .find("\n}\n")
            .expect("end of reconcile_synthetics_steps");
        let body = &body[..end];

        let publish_at = body
            .find(&["publish_step", "_reconciliation("].concat())
            .expect("the publish");
        for bail_out in ["usage query failed", "pool counter read failed"] {
            let bail_at = body
                .find(bail_out)
                .unwrap_or_else(|| panic!("the `{bail_out}` guard is gone"));
            assert!(
                bail_at < publish_at,
                "`{bail_out}` no longer returns before the publish, so a failed read now \
                 resets every gauge to zero and A8 reads healthy",
            );
        }
        assert_eq!(
            body.matches("return;").count(),
            2,
            "each of the two reads must return rather than fall through to the publish",
        );
    }

    /// The job has to be spawned, or none of the above ever runs. `start()`
    /// cannot be exercised here, and a missing spawn fails nothing: the gauges
    /// simply never appear, which is indistinguishable from "no org has ever
    /// diverged".
    #[test]
    fn the_reconciliation_job_is_spawned() {
        let source = include_str!("cloud.rs");
        assert_eq!(
            source
                .matches(&["run_synthetics_step", "_reconcile()"].concat())
                .count(),
            2,
            "one definition and exactly one spawn are expected for the §9B.3 job",
        );
    }

    #[test]
    fn test_html_escape_basic_chars() {
        assert_eq!(
            html_escape("<script>alert('x')</script>"),
            "&lt;script&gt;alert('x')&lt;/script&gt;"
        );
        assert_eq!(html_escape("a & b"), "a &amp; b");
        assert_eq!(html_escape(""), "");
        assert_eq!(html_escape("plain text"), "plain text");
    }

    #[test]
    fn test_html_escape_orders_amp_first() {
        // & must be escaped before < and > so we don't double-escape entities.
        assert_eq!(html_escape("&<>"), "&amp;&lt;&gt;");
        assert_eq!(html_escape("&amp;"), "&amp;amp;");
    }

    #[test]
    fn test_build_expiry_email_singular_day() {
        let (subject, body) = build_external_contract_expiry_email("org-a", "Acme Corp", 1);

        // "1 day" — no plural suffix
        assert!(
            subject.contains("expiring in 1 day —"),
            "subject: {subject}"
        );
        assert!(!subject.contains("1 days"));
        assert!(subject.contains("Acme Corp"));
        // <=1 days uses the most urgent message
        assert!(body.contains("expires tomorrow"));
        assert!(body.contains("Days remaining:</strong> 1"));
        assert!(body.contains("Acme Corp"));
        assert!(body.contains("(org-a)"));
    }

    #[test]
    fn test_build_expiry_email_plural_seven_days() {
        let (subject, body) = build_external_contract_expiry_email("org-b", "Beta Inc", 7);

        assert!(subject.contains("expiring in 7 days"));
        // 7 days falls into the "expiring soon" bucket (>1 and <=7)
        assert!(body.contains("expiring soon"));
        assert!(!body.contains("expires tomorrow"));
    }

    #[test]
    fn test_build_expiry_email_plural_thirty_days() {
        let (_subject, body) = build_external_contract_expiry_email("org-c", "Gamma LLC", 30);

        // >7 days falls into the "coming weeks" bucket
        assert!(body.contains("coming weeks"));
        assert!(!body.contains("expires tomorrow"));
        assert!(!body.contains("expiring soon"));
    }

    #[test]
    fn test_build_expiry_email_falls_back_to_org_id_when_name_empty() {
        let (subject, body) = build_external_contract_expiry_email("org-d", "", 5);

        // Empty org name → org_id is used as the display name in subject and body.
        assert!(subject.ends_with("— org-d"), "subject: {subject}");
        assert!(body.contains("<strong>Organization:</strong> org-d (org-d)"));
    }

    #[test]
    fn test_build_expiry_email_escapes_html_in_org_name() {
        let (_subject, body) =
            build_external_contract_expiry_email("org-e", "<script>alert(1)</script>", 10);

        // The malicious org name must be escaped in the email body.
        assert!(!body.contains("<script>alert(1)</script>"));
        assert!(body.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
    }

    #[test]
    fn test_find_pending_stage_no_warning_when_far_out() {
        // Plenty of time left, no warning has been sent yet.
        assert_eq!(find_pending_expiry_stage(60, None), None);
    }

    #[test]
    fn test_find_pending_stage_thirty_day_first_fire() {
        // 30 days remaining, nothing notified yet → fire ThirtyDay.
        assert_eq!(
            find_pending_expiry_stage(30, None),
            Some(ExpiryNotificationStage::ThirtyDay)
        );
        // Same goes for 25 days remaining.
        assert_eq!(
            find_pending_expiry_stage(25, None),
            Some(ExpiryNotificationStage::ThirtyDay)
        );
    }

    #[test]
    fn test_find_pending_stage_no_resend_thirty_day() {
        // ThirtyDay already sent, days_remaining still in the 8..30 window → no new
        // warning yet (must wait until SevenDay threshold).
        assert_eq!(
            find_pending_expiry_stage(20, Some(ExpiryNotificationStage::ThirtyDay)),
            None
        );
    }

    #[test]
    fn test_find_pending_stage_seven_day_after_thirty() {
        // ThirtyDay already sent and we crossed the 7-day boundary → fire SevenDay.
        assert_eq!(
            find_pending_expiry_stage(7, Some(ExpiryNotificationStage::ThirtyDay)),
            Some(ExpiryNotificationStage::SevenDay)
        );
        assert_eq!(
            find_pending_expiry_stage(3, Some(ExpiryNotificationStage::ThirtyDay)),
            Some(ExpiryNotificationStage::SevenDay)
        );
    }

    #[test]
    fn test_find_pending_stage_one_day_after_seven() {
        assert_eq!(
            find_pending_expiry_stage(1, Some(ExpiryNotificationStage::SevenDay)),
            Some(ExpiryNotificationStage::OneDay)
        );
    }

    #[test]
    fn test_find_pending_stage_no_resend_after_one_day() {
        // OneDay (the most urgent) has already been sent → never fire again.
        assert_eq!(
            find_pending_expiry_stage(1, Some(ExpiryNotificationStage::OneDay)),
            None
        );
        assert_eq!(
            find_pending_expiry_stage(0, Some(ExpiryNotificationStage::OneDay)),
            None
        );
    }

    #[test]
    fn test_find_pending_stage_skips_levels_when_first_seen_late() {
        // Org is already inside the 7-day window when we first notice it: skip
        // ThirtyDay and fire SevenDay directly, since both thresholds are met.
        assert_eq!(
            find_pending_expiry_stage(5, None),
            Some(ExpiryNotificationStage::ThirtyDay)
        );
        // First check happens with only 1 day remaining: ThirtyDay still wins
        // because the iterator returns the first matching stage. The next tick
        // (after marking ThirtyDay as sent) escalates to SevenDay, then OneDay.
        // This mirrors the production loop's behaviour of at-most-one-notice
        // per tick.
        assert_eq!(
            find_pending_expiry_stage(1, None),
            Some(ExpiryNotificationStage::ThirtyDay)
        );
    }
}
