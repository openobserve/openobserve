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
///
/// The message body is built per destination type: Slack-compatible JSON for
/// HTTP webhooks, an HTML card for email, plain text for SNS.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(n: CheckNotification) {
    if n.status == "passed" || n.status == "up" {
        return;
    }

    use config::meta::destinations::{DestinationType, Module};

    for dest_name in &n.destinations {
        match crate::service::alerts::destinations::get_with_template(&n.org_id, dest_name).await {
            Ok((dest, _tpl)) => {
                let Module::Alert {
                    destination_type, ..
                } = &dest.module
                else {
                    continue;
                };

                let msg = match destination_type {
                    DestinationType::Email(_) => build_email_html(&n),
                    DestinationType::Sns(_) => build_plain_text(&n),
                    DestinationType::Http(_) => build_slack_json(&n),
                };

                let subject = format!(
                    "[OpenObserve Synthetics] {} {} is {}",
                    status_emoji(&n.status),
                    n.monitor_name,
                    n.status.to_uppercase()
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
fn status_emoji(status: &str) -> &'static str {
    match status {
        "failed" | "down" => "🔴",
        "warning" => "🟡",
        "error" => "⚠️",
        _ => "🔴",
    }
}

/// What the status means, in operator language — differs per status.
#[cfg(feature = "enterprise")]
fn status_headline(n: &CheckNotification) -> String {
    match n.status.as_str() {
        "warning" => format!("{} passed only after retries (flaky)", n.monitor_name),
        "error" => format!(
            "{} could not be checked — probe infrastructure error",
            n.monitor_name
        ),
        _ => format!("{} is failing", n.monitor_name),
    }
}

/// Deep link to the monitor's results page in the UI.
#[cfg(feature = "enterprise")]
fn run_url(n: &CheckNotification) -> String {
    let cfg = config::get_config();
    let web_url = cfg.common.web_url.trim_end_matches('/');
    let base_uri = &cfg.common.base_uri;
    format!(
        "{web_url}{base_uri}/web/synthetic/{}/results?org_identifier={}",
        n.monitor_id, n.org_id
    )
}

/// Slack-compatible webhook payload (also renders fine in Teams/Discord-style
/// webhooks that accept a `text` field).
#[cfg(feature = "enterprise")]
fn build_slack_json(n: &CheckNotification) -> String {
    let checked_secs = n.checked_at / 1_000_000;
    let mut lines = vec![
        format!("{} *{}*", status_emoji(&n.status), status_headline(n)),
        String::new(),
        format!("*Monitor:* {} ({})", n.monitor_name, n.monitor_type),
        format!("*Target:* {}", n.target),
        format!(
            "*Locations checked:* {}",
            if n.job_count > 0 { n.job_count } else { 1 }
        ),
    ];
    if let Some(e) = n.error.as_deref().filter(|e| !e.is_empty()) {
        lines.push(format!("*Error:* ```{e}```"));
    }
    lines.push(format!(
        "*Time:* <!date^{checked_secs}^{{date_time_secs}}|{checked_secs}>"
    ));
    lines.push(format!("<{}|View run details →>", run_url(n)));

    serde_json::json!({ "text": lines.join("\n") }).to_string()
}

/// Plain text — SNS fans out to SMS/lambda/etc. where markup is noise.
#[cfg(feature = "enterprise")]
fn build_plain_text(n: &CheckNotification) -> String {
    let mut lines = vec![
        status_headline(n),
        format!("Monitor: {} ({})", n.monitor_name, n.monitor_type),
        format!("Target: {}", n.target),
        format!("Status: {}", n.status),
        format!(
            "Locations checked: {}",
            if n.job_count > 0 { n.job_count } else { 1 }
        ),
    ];
    if let Some(e) = n.error.as_deref().filter(|e| !e.is_empty()) {
        lines.push(format!("Error: {e}"));
    }
    lines.push(format!("Run details: {}", run_url(n)));
    lines.join("\n")
}

/// HTML card for email destinations (lettre sends it as the HTML alternative).
#[cfg(feature = "enterprise")]
fn build_email_html(n: &CheckNotification) -> String {
    let color = match n.status.as_str() {
        "warning" => "#b58105",
        "error" => "#b45309",
        _ => "#c62828",
    };
    let error_row = match n.error.as_deref().filter(|e| !e.is_empty()) {
        Some(e) => format!(
            r#"<tr><td style="padding:6px 12px;color:#666;">Error</td>
                <td style="padding:6px 12px;"><code>{}</code></td></tr>"#,
            html_escape(e)
        ),
        None => String::new(),
    };
    format!(
        r#"<div style="font-family:sans-serif;max-width:560px;">
  <h2 style="color:{color};margin-bottom:4px;">{emoji} {headline}</h2>
  <table style="border-collapse:collapse;background:#f7f7f7;border-radius:6px;width:100%;">
    <tr><td style="padding:6px 12px;color:#666;width:140px;">Monitor</td>
        <td style="padding:6px 12px;">{name} ({mtype})</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Target</td>
        <td style="padding:6px 12px;">{target}</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Status</td>
        <td style="padding:6px 12px;font-weight:bold;color:{color};">{status}</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Locations checked</td>
        <td style="padding:6px 12px;">{jobs}</td></tr>
    {error_row}
  </table>
  <p style="margin-top:12px;">
    <a href="{url}" style="background:{color};color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">View run details</a>
  </p>
</div>"#,
        emoji = status_emoji(&n.status),
        headline = html_escape(&status_headline(n)),
        name = html_escape(&n.monitor_name),
        mtype = html_escape(&n.monitor_type),
        target = html_escape(&n.target),
        status = n.status.to_uppercase(),
        jobs = if n.job_count > 0 { n.job_count } else { 1 },
        url = run_url(n),
    )
}

#[cfg(feature = "enterprise")]
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ── Private-location staleness watcher ────────────────────────────────────────

/// Ticks every 60s on alert_manager nodes. A private location whose registered
/// agents have ALL gone stale (`O2_SYNTHETICS_AGENT_STALE_SECS`) while
/// synthetics are assigned to it gets one "location down" notification, sent to
/// the union of those synthetics' alert destinations. One-shot per down
/// transition — cleared when any agent comes back (or the location empties).
/// Never-registered locations count as pending, not down.
#[cfg(feature = "enterprise")]
pub async fn location_staleness_watcher() {
    use std::collections::HashSet;

    let mut notified_down: HashSet<String> = HashSet::new();
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        let rows = match infra::table::synthetics_locations::list_private().await {
            Ok(r) => r,
            Err(e) => {
                log::error!("[synthetics] staleness watcher: list_private: {e}");
                continue;
            }
        };
        let window_us = o2_enterprise::enterprise::common::config::get_config()
            .synthetics
            .agent_stale_secs
            .max(1)
            * 1_000_000;
        let now = config::utils::time::now_micros();

        for loc in rows {
            let Some(org_id) = loc.org_id.clone() else {
                continue;
            };
            let agents = infra::table::synthetics_agents::list_by_location(&loc.id)
                .await
                .unwrap_or_default();
            if !loc.enabled || agents.is_empty() {
                notified_down.remove(&loc.id);
                continue;
            }
            let any_live = agents.iter().any(|a| now - a.last_seen_at <= window_us);
            if any_live {
                notified_down.remove(&loc.id);
                continue;
            }
            if notified_down.contains(&loc.id) {
                continue;
            }

            let conn = infra::db::ORM_CLIENT
                .get_or_init(infra::db::connect_to_orm)
                .await;
            let checks = infra::table::synthetics_monitors::list_referencing_location(
                conn, &org_id, &loc.id,
            )
            .await
            .unwrap_or_default();
            if checks.is_empty() {
                // Nothing runs here — stay quiet, re-evaluate next tick.
                continue;
            }
            // Mark before dispatch so a location without destinations is still
            // one-shot (no per-tick log spam / retry storm).
            notified_down.insert(loc.id.clone());

            let mut destinations: Vec<String> =
                checks.iter().flat_map(|c| c.destinations.clone()).collect();
            destinations.sort();
            destinations.dedup();
            log::warn!(
                "[synthetics] private location down: {} ({}) org={} affected_checks={} destinations={}",
                loc.label,
                loc.id,
                org_id,
                checks.len(),
                destinations.len()
            );
            if destinations.is_empty() {
                continue;
            }
            notify_location_down(
                &org_id,
                &loc,
                checks.len(),
                window_us / 1_000_000,
                &destinations,
            )
            .await;
        }
    }
}

/// Sends the "location down" notification to each destination, matching the
/// per-type message formats of `notify_check_result`.
#[cfg(feature = "enterprise")]
async fn notify_location_down(
    org_id: &str,
    loc: &infra::table::synthetics_locations::SyntheticsLocationRecord,
    affected: usize,
    stale_secs: i64,
    destinations: &[String],
) {
    use config::meta::destinations::{DestinationType, Module};

    let subject = format!(
        "[OpenObserve Synthetics] 🔴 Private location {} is DOWN",
        loc.label
    );
    let text = format!(
        "Private location {} ({}) is down — no live agent for over {}s.\nAffected checks: {}\nRestart the agent container or check its network path to OpenObserve.",
        loc.label, loc.region, stale_secs, affected
    );

    for dest_name in destinations {
        match crate::service::alerts::destinations::get_with_template(org_id, dest_name).await {
            Ok((dest, _tpl)) => {
                let Module::Alert {
                    destination_type, ..
                } = &dest.module
                else {
                    continue;
                };
                let msg = match destination_type {
                    DestinationType::Email(_) => format!(
                        r#"<div style="font-family:sans-serif;max-width:560px;">
  <h2 style="color:#c62828;margin-bottom:4px;">🔴 Private location {} is down</h2>
  <p>No live agent for over {}s ({}).</p>
  <p>Affected checks: <b>{}</b></p>
  <p>Restart the agent container or check its network path to OpenObserve.</p>
</div>"#,
                        html_escape(&loc.label),
                        stale_secs,
                        html_escape(&loc.region),
                        affected
                    ),
                    DestinationType::Sns(_) => text.clone(),
                    DestinationType::Http(_) => serde_json::json!({ "text": text }).to_string(),
                };
                if let Err(e) = crate::service::alerts::alert::dispatch_notification(
                    destination_type,
                    &subject,
                    msg,
                )
                .await
                {
                    log::error!(
                        "[synthetics] location-down notify dest={dest_name} location={}: {e}",
                        loc.id
                    );
                }
            }
            Err(e) => {
                log::error!("[synthetics] load dest={dest_name} org={org_id}: {e}");
            }
        }
    }
}
