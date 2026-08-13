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
    pub check_name: String,
    pub check_id: String,
    pub check_type: String,
    pub target: String,
    pub destinations: Vec<String>,
    pub run_id: String,
    /// Aggregate run status: "passed"|"warning"|"failed"|"error".
    pub status: String,
    /// Number of locations that were checked in this run.
    pub job_count: i64,
    pub error: Option<String>,
    pub checked_at: i64,
    /// This message closes an incident rather than opening one.
    ///
    /// Mandatory once `cooldown_mins` exists: with a cooldown, silence no
    /// longer means "recovered", it means "possibly still broken and inside
    /// the window". A recovery message is the only thing that closes it.
    pub recovery: bool,
    /// How many runs in a row had failed when this fired. 0 on a recovery.
    pub consecutive_failures: i32,
    /// The run recovered by retrying. Informational, not an incident.
    pub flaky: bool,
    /// The target is reachable but degrading — a certificate inside its warning
    /// window, or a failing SFTP probe on a host that authenticated.
    ///
    /// Kept distinct from `flaky` because they arrive as the same `warning`
    /// status: a flaky run fixed itself and needs no action, a degrading one
    /// will not fix itself and needs action before it becomes an outage.
    /// Why the run was a warning, straight from the probe: `cert_expiring`,
    /// `sftp_degraded`, `flaky`. `None` from a probe too old to report one, in
    /// which case the message stays generic rather than guessing.
    pub status_reason: Option<String>,
    pub degraded: bool,
    /// Locations that did not pass, worst first.
    ///
    /// Previously absent entirely, so a six-location check with one broken
    /// region could only say "the check is failing" and the reader had to open
    /// the UI to find out where.
    pub failing_locations: Vec<String>,
    /// Locations that passed, alphabetical.
    ///
    /// Carried because `failing_locations` is empty on a recovery **by
    /// definition** — nothing is failing — which left the recovery message
    /// unable to name anything and degrading to a bare count. With both sides
    /// a partial recovery is expressible too: "2 of 3 recovered, the third is
    /// still down".
    pub passing_locations: Vec<String>,
}

/// Fires once per run (when all jobs have completed) for non-passing runs.
/// Passing runs are suppressed — operators want alerts, not confirmations.
///
/// The message body is built per destination type: Slack-compatible JSON for
/// HTTP webhooks, an HTML card for email, plain text for SNS.
#[cfg(feature = "enterprise")]
pub async fn notify_check_result(n: CheckNotification) {
    // A passing run is worth sending exactly once: when it ends an incident
    // somebody was already told about. Otherwise it is a confirmation nobody
    // asked for.
    //
    // A flaky run reports as `warning`, not `passed`, so it is not caught here —
    // the decision to send it was already made upstream against `cooldown_mins`.
    if !n.recovery && (n.status == "passed" || n.status == "up") {
        return;
    }

    use config::meta::destinations::{DestinationType, Module};

    for dest_name in &n.destinations {
        match crate::alerts::destinations::get_with_template(&n.org_id, dest_name).await {
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

                let subject = if n.recovery {
                    format!("[OpenObserve Synthetics] ✅ {} has RECOVERED", n.check_name)
                } else if n.degraded {
                    // Not "is WARNING": the point of the message is that this needs
                    // action before it becomes an outage. Named where we know the
                    // condition, because the subject is the line that decides
                    // whether anyone opens the alert — and "CERTIFICATE EXPIRING"
                    // gets renewed where a generic "DEGRADED" gets skimmed.
                    match n.status_reason.as_deref() {
                        Some("cert_expiring") => format!(
                            "[OpenObserve Synthetics] 🟡 {} — CERTIFICATE EXPIRING SOON",
                            n.check_name
                        ),
                        Some("sftp_degraded") => format!(
                            "[OpenObserve Synthetics] 🟡 {} — SFTP DEGRADED",
                            n.check_name
                        ),
                        _ => format!("[OpenObserve Synthetics] 🟡 {} is DEGRADED", n.check_name),
                    }
                } else if n.flaky {
                    format!("[OpenObserve Synthetics] 🔁 {} is FLAKY", n.check_name)
                } else {
                    format!(
                        "[OpenObserve Synthetics] {} {} is {}",
                        status_emoji(&n),
                        n.check_name,
                        n.status.to_uppercase()
                    )
                };
                if let Err(e) =
                    crate::alerts::alert::dispatch_notification(destination_type, &subject, msg)
                        .await
                {
                    log::error!(
                        "[synthetics] notify dest={dest_name} check={}: {e}",
                        n.check_id
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
/// Emoji for a notification, branching on the **same flags** as
/// [`status_headline`] and in the same order.
///
/// This used to take `&str` and branch on `status` alone, which put a 🔴 on
/// every recovery: `status_headline` reads the `recovery` bool, but on a
/// recovery run `status` is `"passed"` — the run genuinely did pass — so the
/// emoji fell through to the catch-all. The headline said "has recovered" next
/// to an outage marker, and in a busy channel that reads as a second outage.
///
/// The old `"recovered" => "✅"` arm was unreachable: nothing sets `status` to
/// that literal. `AlertDecision::Recovered` becomes the `recovery` bool at the
/// ack and never round-trips into the status string.
///
/// Taking the whole notification is what keeps the two in step — a future
/// branch added to the headline is a compile-visible omission here, rather than
/// a silently wrong glyph.
fn status_emoji(n: &CheckNotification) -> &'static str {
    if n.recovery {
        return "✅";
    }
    if n.degraded {
        return "🟡";
    }
    if n.flaky {
        return "🔁";
    }
    match n.status.as_str() {
        "warning" => "🟡",
        "error" => "⚠️",
        _ => "🔴",
    }
}

/// What the status means, in operator language — differs per status.
#[cfg(feature = "enterprise")]
fn status_headline(n: &CheckNotification) -> String {
    if n.recovery {
        return format!("{} has recovered", n.check_name);
    }
    // `warning` covers two unrelated things, and they need opposite responses:
    // a flaky run already fixed itself, a degrading target will not.
    if n.degraded {
        // Name the condition. "Degrading" is true but not actionable, and the
        // reader's next step differs entirely: renew a certificate, or go and look
        // at an SFTP subsystem. QA reported the generic case as the bug — an
        // expiring certificate that read as "passed only after retries (flaky)".
        return match n.status_reason.as_deref() {
            Some("cert_expiring") => format!(
                "{} — the TLS certificate is expiring soon, renew it before it lapses",
                n.check_name
            ),
            Some("sftp_degraded") => format!(
                "{} connects and authenticates, but its SFTP subsystem is failing",
                n.check_name
            ),
            _ => format!(
                "{} is reachable but degrading — this needs attention before it fails",
                n.check_name
            ),
        };
    }
    if n.flaky {
        return format!(
            "{} passed only after retries (flaky) — it recovered on its own",
            n.check_name
        );
    }
    match n.status.as_str() {
        "warning" => format!("{} passed only after retries (flaky)", n.check_name),
        "error" => format!(
            "{} could not be checked — probe infrastructure error",
            n.check_name
        ),
        _ => format!("{} is failing", n.check_name),
    }
}

/// `checked_at` (microseconds) as a readable UTC stamp, e.g.
/// "2026-07-28 01:24:51 UTC".
///
/// Every destination gets this rather than a raw epoch. Slack's `<!date^…>`
/// markup is still used where it applies, but only ever with this as its
/// fallback text — the fallback is what an operator actually reads whenever the
/// markup is not interpreted, which is exactly when a bare epoch is useless.
#[cfg(feature = "enterprise")]
fn checked_at_utc(checked_at_micros: i64) -> String {
    chrono::DateTime::from_timestamp_micros(checked_at_micros)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
        // Out-of-range only for a nonsense timestamp; showing the raw value
        // beats dropping the field and leaving the reader with nothing.
        .unwrap_or_else(|| checked_at_micros.to_string())
}

/// Deep link to the check's results page in the UI.
#[cfg(feature = "enterprise")]
fn run_url(n: &CheckNotification) -> String {
    let cfg = config::get_config();
    let web_url = cfg.common.web_url.trim_end_matches('/');
    let base_uri = &cfg.common.base_uri;
    format!(
        "{web_url}{base_uri}/web/synthetic/{}/results?org_identifier={}",
        n.check_id, n.org_id
    )
}

#[cfg(feature = "enterprise")]
/// "2 of 6: mumbai, frankfurt" — or just the count when we could not attribute.
///
/// Answers "which region is broken", which the message previously could not: it
/// carried only how many locations were checked, so a one-of-six failure and a
/// six-of-six outage read identically.
fn locations_line(n: &CheckNotification) -> String {
    let total = if n.job_count > 0 { n.job_count } else { 1 };

    // On a recovery the interesting set is what came back, not what is broken —
    // and `failing_locations` is empty by definition, which is what used to make
    // this degrade to a bare count and tell the reader nothing.
    if n.recovery {
        return match (
            n.passing_locations.is_empty(),
            n.failing_locations.is_empty(),
        ) {
            // Nothing to name at all — an older ack, or the query failed.
            (true, _) => total.to_string(),
            // Full recovery.
            (false, true) => format!(
                "{} of {} recovered: {}",
                n.passing_locations.len(),
                total,
                n.passing_locations.join(", ")
            ),
            // Partial: some came back, some did not. Naming both is the whole
            // point — "2 of 3 recovered" alone would read as an all-clear.
            (false, false) => format!(
                "{} of {} recovered: {} — still failing: {}",
                n.passing_locations.len(),
                total,
                n.passing_locations.join(", "),
                n.failing_locations.join(", ")
            ),
        };
    }

    if n.failing_locations.is_empty() {
        return total.to_string();
    }
    format!(
        "{} of {}: {}",
        n.failing_locations.len(),
        total,
        n.failing_locations.join(", ")
    )
}

/// Slack-compatible webhook payload (also renders fine in Teams/Discord-style
/// webhooks that accept a `text` field).
#[cfg(feature = "enterprise")]
fn build_slack_json(n: &CheckNotification) -> String {
    let checked_secs = n.checked_at / 1_000_000;
    let mut lines = vec![
        format!("{} *{}*", status_emoji(n), status_headline(n)),
        String::new(),
        format!("*Check:* {} ({})", n.check_name, n.check_type),
        format!("*Target:* {}", n.target),
        format!("*Locations:* {}", locations_line(n)),
    ];
    if let Some(e) = n.error.as_deref().filter(|e| !e.is_empty()) {
        lines.push(format!("*Error:* ```{e}```"));
    }
    let checked_human = checked_at_utc(n.checked_at);
    lines.push(format!(
        "*Time:* <!date^{checked_secs}^{{date_time_secs}}|{checked_human}>"
    ));

    serde_json::json!({ "text": lines.join("\n") }).to_string()
}

/// Plain text — SNS fans out to SMS/lambda/etc. where markup is noise.
#[cfg(feature = "enterprise")]
fn build_plain_text(n: &CheckNotification) -> String {
    let mut lines = vec![
        status_headline(n),
        format!("Check: {} ({})", n.check_name, n.check_type),
        format!("Target: {}", n.target),
        format!("Status: {}", n.status),
        format!("Locations: {}", locations_line(n)),
    ];
    if let Some(e) = n.error.as_deref().filter(|e| !e.is_empty()) {
        lines.push(format!("Error: {e}"));
    }
    lines.push(format!("Time: {}", checked_at_utc(n.checked_at)));
    lines.push(format!("Run details: {}", run_url(n)));
    lines.join("\n")
}

/// HTML card for email destinations (lettre sends it as the HTML alternative).
#[cfg(feature = "enterprise")]
fn build_email_html(n: &CheckNotification) -> String {
    // TODO: update with a better template for all the checks
    let color = if n.recovery {
        "#2e7d32"
    } else {
        match n.status.as_str() {
            "warning" => "#b58105",
            "error" => "#b45309",
            _ => "#c62828",
        }
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
    <tr><td style="padding:6px 12px;color:#666;width:140px;">Check</td>
        <td style="padding:6px 12px;">{name} ({mtype})</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Target</td>
        <td style="padding:6px 12px;">{target}</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Status</td>
        <td style="padding:6px 12px;font-weight:bold;color:{color};">{status}</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Locations</td>
        <td style="padding:6px 12px;">{jobs}</td></tr>
    <tr><td style="padding:6px 12px;color:#666;">Time</td>
        <td style="padding:6px 12px;">{checked_at}</td></tr>
    {error_row}
  </table>
  <p style="margin-top:12px;">
    <a href="{url}" style="background:{color};color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">View run details</a>
  </p>
</div>"#,
        emoji = status_emoji(n),
        headline = html_escape(&status_headline(n)),
        name = html_escape(&n.check_name),
        mtype = html_escape(&n.check_type),
        target = html_escape(&n.target),
        status = n.status.to_uppercase(),
        jobs = html_escape(&locations_line(n)),
        checked_at = checked_at_utc(n.checked_at),
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

// ── Org provisioning ──────────────────────────────────────────────────────────

/// Mints the org's default `o2syn_` probe token and, in a super cluster,
/// replicates it to every other region.
///
/// Org creation itself replicates, but the super-cluster org consumer only
/// inserts the org row — it does not re-run any of the provisioning that
/// follows a local create. So without this publish, a super cluster ends up with
/// the org in every region and its probe token in exactly one, and an agent
/// configured with that token 401s everywhere else (`find_global` reads the
/// local meta DB and is not region-aware).
///
/// The publish lives here rather than inside `infra::table` deliberately:
/// `infra` cannot reach the enterprise crate, and that missing edge is what
/// stops the super-cluster consumer — which applies through `infra` — from
/// re-broadcasting what it just applied. Same shape as
/// `db::org_ingestion_tokens::add`, which replicates the `o2oi_` token the same
/// way at the same point in org creation.
pub async fn create_default_probe_token(
    org_id: &str,
    created_by: &str,
) -> Result<(), anyhow::Error> {
    let _record = infra::table::synthetics_probe_tokens::create_for_org(org_id, created_by).await?;
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        o2_enterprise::enterprise::super_cluster::queue::synthetics_probe_token_create(
            (&_record).into(),
        )
        .await?;
    }
    Ok(())
}

// ── Private-location staleness watcher ────────────────────────────────────────

/// Ticks every 60s on scheduler nodes. A private location whose registered
/// agents have ALL gone stale (`ZO_SYNTHETICS_AGENT_STALE_SECS`) while
/// synthetics are assigned to it gets one "location down" notification, sent to
/// the union of those synthetics' alert destinations. One-shot per down
/// transition — cleared when any agent comes back (or the location empties).
/// Never-registered locations count as pending, not down.
#[cfg(feature = "enterprise")]
pub async fn location_staleness_watcher() {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

        let rows = match infra::table::synthetics_locations::list_private().await {
            Ok(r) => r,
            Err(e) => {
                log::error!("[synthetics] staleness watcher: list_private: {e}");
                continue;
            }
        };
        let window_us = config::get_config().synthetics.agent_stale_secs.max(1) * 1_000_000;
        let now = config::utils::time::now_micros();

        for loc in rows {
            let Some(org_id) = loc.org_id.clone() else {
                continue;
            };
            let agents = infra::table::synthetics_agents::list_by_location(&loc.id)
                .await
                .unwrap_or_default();
            if !loc.enabled || agents.is_empty() {
                clear_down(&loc.id).await;
                continue;
            }
            let any_live = agents.iter().any(|a| now - a.last_seen_at <= window_us);
            if any_live {
                clear_down(&loc.id).await;
                continue;
            }

            let conn = infra::db::ORM_CLIENT
                .get_or_init(infra::db::connect_to_orm)
                .await;
            let checks =
                infra::table::synthetics_checks::list_referencing_location(conn, &org_id, &loc.id)
                    .await
                    .unwrap_or_default();
            if checks.is_empty() {
                // Nothing runs here — stay quiet, re-evaluate next tick.
                continue;
            }
            // Claim before dispatch so a location without destinations is still
            // one-shot (no per-tick log spam / retry storm), AND so that only one
            // scheduler node speaks. This watcher runs on every scheduler node, so
            // the suppression flag cannot live in this process's memory — N nodes
            // would each believe they had not notified yet and send N pages for
            // one outage. The CAS in `try_claim_down_notification` makes exactly
            // one node the winner.
            match infra::table::synthetics_locations::try_claim_down_notification(&loc.id, now)
                .await
            {
                Ok(true) => {}
                Ok(false) => continue, // another node is sending it
                Err(e) => {
                    log::error!(
                        "[synthetics] staleness watcher: claim down notification for {}: {e}",
                        loc.id
                    );
                    continue;
                }
            }

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

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::*;

    #[test]
    fn checked_at_utc_formats_micros_as_readable_utc() {
        // 1785201891 s → 2026-07-28 01:24:51 UTC
        assert_eq!(
            checked_at_utc(1_785_201_891_000_000),
            "2026-07-28 01:24:51 UTC"
        );
    }

    #[test]
    fn checked_at_utc_keeps_second_precision() {
        // Sub-second remainder is dropped, not rounded up.
        assert_eq!(
            checked_at_utc(1_785_201_891_999_999),
            "2026-07-28 01:24:51 UTC"
        );
    }

    #[test]
    fn checked_at_utc_falls_back_to_the_raw_value_when_out_of_range() {
        assert_eq!(checked_at_utc(i64::MAX), i64::MAX.to_string());
    }

    /// A firing notification for a 3-location check, two of them broken.
    fn firing() -> CheckNotification {
        CheckNotification {
            org_id: "default".into(),
            check_name: "EU1 Cloud Health Check".into(),
            check_id: "abc123".into(),
            check_type: "http".into(),
            target: "https://example.com".into(),
            destinations: vec![],
            run_id: "run1".into(),
            status: "failed".into(),
            job_count: 3,
            error: None,
            checked_at: 1_785_000_000_000_000,
            recovery: false,
            consecutive_failures: 3,
            flaky: false,
            status_reason: None,
            degraded: false,
            failing_locations: vec!["aws-us-east-1".into(), "aws-us-west-1".into()],
            passing_locations: vec!["aws-eu-central-1".into()],
        }
    }

    /// The same check recovering: status is "passed", nothing is failing.
    fn recovered() -> CheckNotification {
        CheckNotification {
            status: "passed".into(),
            recovery: true,
            consecutive_failures: 0,
            failing_locations: vec![],
            passing_locations: vec![
                "aws-eu-central-1".into(),
                "aws-us-east-1".into(),
                "aws-us-west-1".into(),
            ],
            ..firing()
        }
    }

    // ── 2324-a · the emoji must agree with the headline ────────────────────

    #[test]
    fn recovery_is_not_marked_as_an_outage() {
        // The bug: status is "passed" on a recovery, so branching on the status
        // string fell through to the 🔴 catch-all while the headline said
        // "has recovered". In a busy channel that reads as a second outage.
        let n = recovered();
        assert_eq!(status_emoji(&n), "✅");
        assert!(status_headline(&n).contains("has recovered"));
    }

    #[test]
    fn emoji_and_headline_agree_on_every_branch() {
        // The two are only correct together; this is the invariant the old
        // signature could not express.
        let cases: Vec<(CheckNotification, &str, &str)> = vec![
            (recovered(), "✅", "has recovered"),
            (
                CheckNotification {
                    degraded: true,
                    status: "warning".into(),
                    status_reason: Some("cert_expiring".into()),
                    ..firing()
                },
                "🟡",
                "certificate is expiring",
            ),
            (
                CheckNotification {
                    flaky: true,
                    status: "warning".into(),
                    ..firing()
                },
                "🔁",
                "flaky",
            ),
            (firing(), "🔴", "is failing"),
            (
                CheckNotification {
                    status: "error".into(),
                    ..firing()
                },
                "⚠️",
                "could not be checked",
            ),
        ];
        for (n, emoji, headline_fragment) in cases {
            assert_eq!(status_emoji(&n), emoji, "status={}", n.status);
            assert!(
                status_headline(&n).contains(headline_fragment),
                "status={} headline={}",
                n.status,
                status_headline(&n)
            );
        }
    }

    #[test]
    fn degraded_outranks_flaky_exactly_as_the_headline_does() {
        // Both arrive as `warning`. The order matters: a degrading target needs
        // action, a flaky one already fixed itself.
        let n = CheckNotification {
            degraded: true,
            flaky: true,
            status: "warning".into(),
            ..firing()
        };
        assert_eq!(status_emoji(&n), "🟡");
    }

    // ── 2324-b · a recovery must be able to name its locations ─────────────

    #[test]
    fn full_recovery_names_the_locations_that_came_back() {
        // The bug: failing_locations is empty by definition on a recovery, so
        // this used to render the bare count "3".
        let line = locations_line(&recovered());
        assert!(line.contains("3 of 3 recovered"), "{line}");
        assert!(line.contains("aws-us-east-1"), "{line}");
    }

    #[test]
    fn partial_recovery_names_both_sides() {
        // "2 of 3 recovered" alone would read as an all-clear.
        let n = CheckNotification {
            recovery: true,
            status: "passed".into(),
            passing_locations: vec!["aws-us-east-1".into(), "aws-us-west-1".into()],
            failing_locations: vec!["aws-eu-central-1".into()],
            ..firing()
        };
        let line = locations_line(&n);
        assert!(line.contains("2 of 3 recovered"), "{line}");
        assert!(line.contains("still failing: aws-eu-central-1"), "{line}");
    }

    #[test]
    fn recovery_with_no_location_data_falls_back_to_the_count() {
        // An older ack, or the query failed. Better a bare count than a lie.
        let n = CheckNotification {
            recovery: true,
            passing_locations: vec![],
            failing_locations: vec![],
            ..recovered()
        };
        assert_eq!(locations_line(&n), "3");
    }

    #[test]
    fn firing_still_names_only_what_is_broken() {
        // The passing set exists now, but a firing message must not list it —
        // the reader wants the outage, not the healthy regions.
        let line = locations_line(&firing());
        assert!(line.starts_with("2 of 3: "), "{line}");
        assert!(!line.contains("aws-eu-central-1"), "{line}");
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
        match crate::alerts::destinations::get_with_template(org_id, dest_name).await {
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
                if let Err(e) =
                    crate::alerts::alert::dispatch_notification(destination_type, &subject, msg)
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

/// Clears a location's down flag so a future outage notifies again.
///
/// Every scheduler node calls this on recovery; the underlying update is
/// idempotent, so they cannot disagree.
#[cfg(feature = "enterprise")]
async fn clear_down(location_id: &str) {
    if let Err(e) = infra::table::synthetics_locations::clear_down_notification(location_id).await {
        log::error!("[synthetics] staleness watcher: clear down flag for {location_id}: {e}");
    }
}
