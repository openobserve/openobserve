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

/// Everything needed to notify destinations about a completed run.
/// Owned values so the whole struct can move into a spawned task.
#[cfg(feature = "enterprise")]
pub struct CheckNotification {
    pub org_id: String,
    pub monitor_name: String,
    pub monitor_id: String,
    pub monitor_type: String,
    pub target: String,
    pub destinations: Vec<String>,
    pub run_id: String,
    /// Aggregate run status: "passed"|"warning"|"failed"|"error".
    pub status: String,
    /// Number of locations that were checked in this run.
    pub job_count: i64,
    pub error: Option<String>,
    pub checked_at: i64,
}

/// Fires once per run (when all jobs have completed) for non-passing runs.
/// Passing runs are suppressed — operators want alerts, not confirmations.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(n: CheckNotification) {
    if n.status == "passed" || n.status == "up" {
        return;
    }

    use config::meta::destinations::Module;

    for dest_name in &n.destinations {
        match crate::service::alerts::destinations::get_with_template(&n.org_id, dest_name).await {
            Ok((dest, tpl)) => {
                let Module::Alert {
                    destination_type, ..
                } = &dest.module
                else {
                    continue;
                };

                let _ = tpl;
                let msg = build_notification_payload(&n);

                let subject = format!(
                    "[OpenObserve Synthetics] {} is {}",
                    n.monitor_name, n.status
                );
                if let Err(e) = crate::service::alerts::alert::dispatch_notification(
                    destination_type,
                    &subject,
                    msg,
                )
                .await
                {
                    log::error!(
                        "[synthetics] notify dest={dest_name} monitor={}: {e}",
                        n.monitor_id
                    );
                }
            }
            Err(e) => {
                log::error!("[synthetics] load dest={dest_name} org={}: {e}", n.org_id);
            }
        }
    }
}

#[cfg(feature = "enterprise")]
fn build_notification_payload(n: &CheckNotification) -> String {
    let status_emoji = match n.status.as_str() {
        "failed" | "down" => "🔴",
        "warning" => "🟡",
        "error" => "⚠️",
        _ => "🔴",
    };

    let checked_secs = n.checked_at / 1_000_000;
    let locations_line = if n.job_count > 1 {
        format!("*Locations checked:* {}\n", n.job_count)
    } else {
        String::new()
    };
    let error_line = match &n.error {
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
         *Time:* <!date^{checked_secs}^{{date_time}}|{checked_secs}>",
        monitor_name = n.monitor_name,
        status = n.status,
        monitor_type = n.monitor_type,
        target = n.target,
        run_id = n.run_id,
        monitor_id = n.monitor_id,
    );

    serde_json::json!({ "text": text }).to_string()
}
