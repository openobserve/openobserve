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

//! Synthetics service — notifications only.
//! Result queries are handled client-side via the O2 stream search API.

// ── Notifications ─────────────────────────────────────────────────────────────

/// Fires once per run (when all jobs have completed) for non-passing runs.
/// Passing runs are suppressed — operators want alerts, not confirmations.
///
/// `status` is the aggregate run status: "passed"|"warning"|"failed"|"error".
/// `job_count` = number of locations that were checked in this run.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(
    org_id: &str,
    monitor_name: &str,
    monitor_id: &str,
    monitor_type: &str,
    target: &str,
    destinations: &[String],
    run_id: &str,
    status: &str,
    job_count: i64,
    error: Option<&str>,
    checked_at: i64,
) {
    if status == "passed" || status == "up" {
        return;
    }

    use config::meta::destinations::Module;

    for dest_name in destinations {
        match crate::service::alerts::destinations::get_with_template(org_id, dest_name).await {
            Ok((dest, tpl)) => {
                let Module::Alert {
                    destination_type, ..
                } = &dest.module
                else {
                    continue;
                };

                let _ = tpl;
                let msg = build_notification_payload(
                    monitor_name,
                    monitor_id,
                    monitor_type,
                    target,
                    run_id,
                    status,
                    job_count,
                    error,
                    checked_at,
                );

                let subject = format!("[OpenObserve Synthetics] {monitor_name} is {status}");
                if let Err(e) = crate::service::alerts::alert::dispatch_notification(
                    destination_type,
                    &subject,
                    msg,
                )
                .await
                {
                    log::error!("[synthetics] notify dest={dest_name} monitor={monitor_id}: {e}");
                }
            }
            Err(e) => {
                log::error!("[synthetics] load dest={dest_name} org={org_id}: {e}");
            }
        }
    }
}

#[cfg(feature = "enterprise")]
fn build_notification_payload(
    monitor_name: &str,
    monitor_id: &str,
    monitor_type: &str,
    target: &str,
    run_id: &str,
    status: &str,
    job_count: i64,
    error: Option<&str>,
    checked_at: i64,
) -> String {
    let status_emoji = match status {
        "failed" | "down" => "🔴",
        "warning" => "🟡",
        "error" => "⚠️",
        _ => "🔴",
    };

    let checked_secs = checked_at / 1_000_000;
    let locations_line = if job_count > 1 {
        format!("*Locations checked:* {job_count}\n")
    } else {
        String::new()
    };
    let error_line = match error {
        Some(e) if !e.is_empty() => format!("*Error:* {e}\n"),
        _ => String::new(),
    };

    let text = format!(
        "{status_emoji} *{monitor_name}* is *{status}*\n\
         *Type:* {monitor_type}\n\
         *Target:* {target}\n\
         {locations_line}\
         {error_line}\
         *Run ID:* `{run_id}`\n\
         *Monitor ID:* `{monitor_id}`\n\
         *Time:* <!date^{checked_secs}^{{date_time}}|{checked_secs}>"
    );

    serde_json::json!({ "text": text }).to_string()
}
