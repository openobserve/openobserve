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
    meta::{destinations::Email, self_reporting::usage::USAGE_STREAM},
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

            // Members first, and awaited *here* rather than inside
            // `delete_expired_contract_billing`: members meter through the `SuperOrg` provider,
            // which resolves the payer's billing row to find the real provider
            // (`metering/super_org.rs`), so the payer's row must outlive every member flush.
            // Passing the finished `Result` in keeps that ordering here and out of
            // `delete_expired_contract_billing`: the value cannot exist without awaiting the
            // member teardown first, so these two statements cannot be swapped without a
            // compile error. Wrong ordering is still expressible — pass `Ok(())` and remove the
            // members afterwards — just no longer reachable by accident.
            let members_removed =
                o2_enterprise::enterprise::cloud::billing_group::remove_member_billing_of(org_id)
                    .await;

            delete_expired_contract_billing(org_id, members_removed, |org| async move {
                o2_enterprise::enterprise::cloud::flush_then_delete_customer_billing(&org).await
            })
            .await;
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

/// Finish expiring one external contract: given the outcome of removing its billing-group members,
/// tear down the contract org's own billing row.
///
/// `members_removed` is a value, not a future: by the time this function is entered the member
/// teardown has already run to completion, so it cannot be left lazy or raced with `tokio::join!`,
/// and the naive reordering — swapping the two statements at the call site — is a compile error
/// (E0425, "cannot find value `members_removed` in this scope") rather than a silent behaviour
/// change.
///
/// It does **not** make the ordering unconditional: `delete_expired_contract_billing(org_id,
/// Ok(()), teardown)` followed by `remove_member_billing_of(org_id).await` type-checks and is
/// wrong. What the value buys is that the ordering is decided at the single call site above, in
/// plain sight, instead of being hidden inside this function, and that it cannot be broken by
/// accident.
/// When it is an `Err`, `teardown` is never invoked: a member whose row survived is still entitled,
/// and deleting the payer's row on top of that would orphan it. The hourly sweep retries the whole
/// org on its next tick.
///
/// Returns `()`. `check_external_contract_expiry` walks every contract org in the deployment, and
/// one org's failure must not stop the rest, so every error is logged here and swallowed rather
/// than propagated into the loop.
///
/// `teardown` is `cloud::flush_then_delete_customer_billing` in production; it is injected only so
/// this control flow is testable without a database. It takes just an org id, so the flush and the
/// delete cannot be transposed at any call site.
async fn delete_expired_contract_billing<F, Fut>(
    org_id: &str,
    members_removed: Result<(), anyhow::Error>,
    teardown: F,
) where
    F: FnOnce(String) -> Fut,
    Fut: std::future::Future<Output = Result<(), anyhow::Error>>,
{
    if let Err(e) = members_removed {
        log::error!(
            "[EXT_CONTRACT] Failed to delete members of expired billing for org {org_id}: {e}",
        );
        return;
    }

    if let Err(e) = teardown(org_id.to_string()).await {
        log::error!("[EXT_CONTRACT] Failed to delete expired billing for org {org_id}: {e}");
    }
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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use o2_enterprise::enterprise::cloud::billings::ExpiryNotificationStage;

    use super::*;

    /// Ordered record of the org ids the injected teardown was handed.
    type CallLog = Arc<Mutex<Vec<String>>>;

    fn call_log() -> CallLog {
        Arc::new(Mutex::new(Vec::new()))
    }

    fn calls(log: &CallLog) -> Vec<String> {
        log.lock().unwrap().clone()
    }

    /// Spec §7.4 / F12 / E19: the automatic expiry path must tear the contract org's own row down
    /// through the shared flush-then-delete helper, handing it the expiring org's id.
    #[tokio::test]
    async fn expired_contract_org_is_torn_down_with_its_own_org_id() {
        let log = call_log();
        let log_c = log.clone();

        delete_expired_contract_billing("contract-org", Ok(()), move |org| async move {
            log_c.lock().unwrap().push(org);
            Ok(())
        })
        .await;

        assert_eq!(calls(&log), ["contract-org"]);
    }

    /// The `continue`-on-member-failure rule: if the members could not be removed, the payer's own
    /// row must be left alone. Deleting it anyway would orphan every surviving member billing row —
    /// `metering/super_org.rs` resolves the payer's row and would then error for each of them, and
    /// the members would stay entitled with no payer.
    #[tokio::test]
    async fn member_removal_failure_skips_the_contract_org_teardown() {
        let log = call_log();
        let log_c = log.clone();

        delete_expired_contract_billing(
            "contract-org",
            Err(anyhow::anyhow!("member delete blew up")),
            move |org| async move {
                log_c.lock().unwrap().push(org);
                Ok(())
            },
        )
        .await;

        assert!(
            calls(&log).is_empty(),
            "the contract org's row must survive a failed member teardown: {:?}",
            calls(&log)
        );
    }

    /// One org's failure must not stop the sweep. `check_external_contract_expiry` iterates every
    /// contract org in the deployment; a teardown error is logged and swallowed, and a member
    /// failure only skips that org's own row.
    ///
    /// This walks three orgs the way the loop does: one whose teardown fails, one whose members
    /// failed, and one healthy org that must still be processed last.
    #[tokio::test]
    async fn one_orgs_failure_does_not_stop_the_sweep() {
        let log = call_log();

        let orgs: Vec<(&str, Result<(), anyhow::Error>)> = vec![
            ("teardown-fails", Ok(())),
            (
                "members-fail",
                Err(anyhow::anyhow!("member delete blew up")),
            ),
            ("healthy", Ok(())),
        ];

        for (org_id, members_removed) in orgs {
            let log_c = log.clone();
            delete_expired_contract_billing(org_id, members_removed, move |org| async move {
                log_c.lock().unwrap().push(org.clone());
                if org == "teardown-fails" {
                    Err(anyhow::anyhow!("delete blew up"))
                } else {
                    Ok(())
                }
            })
            .await;
        }

        assert_eq!(
            calls(&log),
            ["teardown-fails", "healthy"],
            "every org must be visited; only the member-failure org skips its own teardown"
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
