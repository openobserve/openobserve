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

/// Sends a check result notification to each configured alert destination.
///
/// Only fires when the check did NOT pass (status != "passed"). Passing runs are
/// intentionally suppressed — operators want alerts, not confirmations.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(
    org_id: &str,
    monitor_name: &str,
    monitor_id: &str,
    monitor_type: &str,
    target: &str,
    destinations: &[String],
    location: &str,
    status: &str,
    response_time_ms: f64,
    error: Option<&str>,
    checked_at: i64,
) {
    // Suppress notifications for passing runs — only alert on failure/error.
    if status == "passed" || status == "up" {
        return;
    }

    // TODO: enforce alert_if_fails (consecutive failure count) and cooldown_mins (silence period).
    // Requires a persistent state store keyed by (org_id, synthetics_id) tracking consecutive
    // failure count and last-notified-at timestamp. Until then every failed run fires a
    // notification.

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

                // Alert-system templates use single-brace vars ({alert_name}, {alert_url})
                // that are not defined in the synthetics context. Slack rejects payloads
                // with unreplaced {alert_url} in button elements (invalid URI). Until
                // synthetics has its own template system, always use the built-in payload.
                // TODO: support synthetics-specific templates with {{monitor_name}} vars.
                let _ = tpl;
                let msg = default_notification_payload(
                    monitor_name,
                    monitor_id,
                    monitor_type,
                    target,
                    location,
                    status,
                    response_time_ms,
                    error,
                    checked_at,
                );

                let subject = format!("Synthetics: {monitor_name} [{location}] is {status}");
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
fn default_notification_payload(
    monitor_name: &str,
    _monitor_id: &str,
    _monitor_type: &str,
    target: &str,
    location: &str,
    status: &str,
    response_time_ms: f64,
    error: Option<&str>,
    _checked_at: i64,
) -> String {
    let error_line = match error {
        Some(e) if !e.is_empty() => format!("\nError: {e}"),
        _ => String::new(),
    };
    let text = format!(
        "Synthetic monitor *{monitor_name}* [{location}] is *{status}*\nTarget: {target}\nDuration: {response_time_ms:.0} ms{error_line}"
    );
    serde_json::json!({ "text": text }).to_string()
}
