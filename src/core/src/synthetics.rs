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
    /// `config` means the journey could not be assembled, so the text says misconfigured.
    pub error_source: String,
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
    /// Environments that did not pass, worst first.
    pub failing_environments: Vec<String>,
    /// "Failing in 1 of 2 locations (aws-us-east-1)" on a firing partial or down run.
    pub coverage: Option<String>,
    /// The check's template override.
    pub template: Option<String>,
    /// Firing for failed and error, Resolved for recovered, Informational for the notices.
    pub event: config::meta::alerts::notification_kind::NotificationEvent,
}

#[cfg(feature = "enterprise")]
impl CheckNotification {
    /// The notification for a completed run. `status`, `error` and `error_source` describe the
    /// ack that completed it, and `status` is the fallback when the run has no aggregate status.
    pub fn from_ack(
        resp: &openobserve_synthetics::job_api::AckResponse,
        status: &str,
        error: Option<String>,
        error_source: String,
        checked_at: i64,
    ) -> Self {
        use openobserve_synthetics::job_api::AlertDecision;
        Self {
            org_id: resp.org_id.clone(),
            check_name: resp.synthetics_name.clone(),
            check_id: resp.synthetics_id.clone(),
            check_type: resp.synthetic_type.clone(),
            target: resp.target.clone(),
            destinations: resp.destinations.clone(),
            run_id: resp.run_id.clone(),
            status: resp
                .run_status
                .clone()
                .unwrap_or_else(|| status.to_string()),
            job_count: resp.job_count as i64,
            error,
            checked_at,
            recovery: matches!(resp.alert, AlertDecision::Recovered),
            consecutive_failures: resp.consecutive_failures,
            flaky: matches!(resp.alert, AlertDecision::Flaky),
            // A degrading target is `warning` on every run for as long as the condition lasts,
            // so this one is throttled by transition upstream, not by cooldown.
            degraded: matches!(resp.alert, AlertDecision::Degraded),
            status_reason: resp.status_reason.clone(),
            error_source,
            failing_locations: resp.failing_locations.clone(),
            failing_environments: resp.failing_environments.clone(),
            passing_locations: resp.passing_locations.clone(),
            coverage: resp.coverage.clone(),
            template: resp.template.clone(),
            event: check_event(
                matches!(resp.alert, AlertDecision::Recovered),
                matches!(resp.alert, AlertDecision::Flaky),
                matches!(resp.alert, AlertDecision::Degraded),
            ),
        }
    }
}

/// Sends the notification of a run that finalized outside an ack, for
/// `openobserve_synthetics::job_api::register_run_notifier`.
#[cfg(feature = "enterprise")]
pub fn notify_finalized_run(
    resp: openobserve_synthetics::job_api::AckResponse,
) -> openobserve_synthetics::alerting::BoxFuture<'static, ()> {
    Box::pin(async move {
        if resp.destinations.is_empty() {
            return;
        }
        if let Some(gap) = GapNotification::from_ack(&resp) {
            notify_gap(gap).await;
        }
        if matches!(
            resp.alert,
            openobserve_synthetics::job_api::AlertDecision::Silent
        ) {
            return;
        }
        let checked_at = config::utils::time::now_micros();
        let status = resp.run_status.clone().unwrap_or_default();
        let n = CheckNotification::from_ack(&resp, &status, None, String::new(), checked_at);
        notify_check_result(n).await;
    })
}

/// A gap notice owed by a run, with what it names. Owned, so it can move into a spawned task.
#[cfg(feature = "enterprise")]
pub struct GapNotification {
    pub org_id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub target: String,
    pub destinations: Vec<String>,
    pub notice: openobserve_synthetics::alerting::GapNotice,
}

#[cfg(feature = "enterprise")]
impl GapNotification {
    /// `None` when the run owes no gap notice or the check has nowhere to send one.
    pub fn from_ack(resp: &openobserve_synthetics::job_api::AckResponse) -> Option<Self> {
        let notice = resp.gap_notice?;
        if resp.destinations.is_empty() {
            return None;
        }
        Some(Self {
            org_id: resp.org_id.clone(),
            synthetics_id: resp.synthetics_id.clone(),
            synthetics_name: resp.synthetics_name.clone(),
            target: resp.target.clone(),
            destinations: resp.destinations.clone(),
            notice,
        })
    }
}

/// The platform event of a run's message: a recovery resolves, the notices never open a record.
#[cfg(feature = "enterprise")]
pub fn check_event(
    recovery: bool,
    flaky: bool,
    degraded: bool,
) -> config::meta::alerts::notification_kind::NotificationEvent {
    use config::meta::alerts::notification_kind::NotificationEvent;
    if recovery {
        NotificationEvent::Resolved
    } else if flaky || degraded {
        NotificationEvent::Informational
    } else {
        NotificationEvent::Firing
    }
}

/// Sends a "Monitoring gap" or "Monitoring resumed" notice to every destination of the check.
///
/// Low severity: it says our side could not test the site, not that the site failed. It is an
/// Informational event, so a platform destination such as PagerDuty skips it.
///
/// A notice counts as sent when at least one destination took or skipped it. A notice that every
/// destination failed is owed again, on the next run or reaper sweep. One broken destination does
/// not hold it, or the working destinations get the notice again on every sweep.
#[cfg(feature = "enterprise")]
pub async fn notify_gap(resp: GapNotification) {
    use openobserve_synthetics::alerting::GapNotice;

    if !send_gap_notice(&resp).await {
        return;
    }
    let conn = infra::db::get_orm_client_rw().await;
    let marked = match resp.notice {
        GapNotice::Opened { since } => {
            let now = config::utils::time::now_micros();
            let marked = infra::table::synthetics_checks::mark_gap_notified(
                conn,
                &resp.synthetics_id,
                since,
                now,
            )
            .await;
            // The gap closed while its notice was on the way, so no run owes the resumed notice.
            // The owner got the gap notice, so send it here, once.
            if matches!(marked, Ok(false)) {
                let state =
                    infra::table::synthetics_checks::get_alert_state(conn, &resp.synthetics_id)
                        .await;
                if let Ok(Some(state)) = state
                    && gap_closed_during_delivery(state.gap_since, since)
                {
                    let resumed = GapNotification {
                        notice: GapNotice::Resumed { since, until: now },
                        ..resp
                    };
                    send_gap_notice(&resumed).await;
                }
                return;
            }
            marked
        }
        GapNotice::Resumed { since, .. } => {
            infra::table::synthetics_checks::clear_resumed_gap(conn, &resp.synthetics_id, since)
                .await
        }
    };
    if let Err(e) = marked {
        log::error!(
            "[synthetics] mark gap notice check={}: {e}",
            resp.synthetics_id
        );
    }
}

/// A gap that the row no longer holds closed before its notice could be marked. The same gap with
/// a mark in place means that another sender got there first.
#[cfg(feature = "enterprise")]
fn gap_closed_during_delivery(stored_since: i64, since: i64) -> bool {
    stored_since != since
}

/// Sends one gap notice to every destination. True when at least one took or skipped it.
#[cfg(feature = "enterprise")]
async fn send_gap_notice(resp: &GapNotification) -> bool {
    use crate::alerts::notifications::notify::{NotifyError, notify};

    let ctx = gap_notification_context(resp);
    let mut delivered = false;
    for dest_name in &resp.destinations {
        let mut ctx = ctx.clone();
        match notify(&resp.org_id, dest_name, &[], None, &mut ctx).await {
            Ok(_) | Err(NotifyError::Skipped(_)) => delivered = true,
            Err(e) => log::error!(
                "[synthetics] gap notice dest={dest_name} check={}: {e}",
                resp.synthetics_id
            ),
        }
    }
    delivered
}

/// The shared path's context for a gap notice: the check's variables, with the notice's words.
#[cfg(feature = "enterprise")]
fn gap_notification_context(
    resp: &GapNotification,
) -> crate::alerts::notifications::NotificationContext {
    use config::meta::alerts::{level::AlertLevel, notification_kind::NotificationEvent};
    use openobserve_synthetics::alerting::GapNotice;

    use crate::alerts::notifications::LegacyPayload;

    let (subject, body) = openobserve_synthetics::alerting::gap_notice_text(
        resp.notice,
        &resp.synthetics_name,
        &resp.target,
    );
    let (status, label, level) = match resp.notice {
        GapNotice::Opened { .. } => ("not_measured", "Not measured", AlertLevel::Warning),
        GapNotice::Resumed { .. } => ("resumed", "Monitoring resumed", AlertLevel::Ok),
    };
    let check = CheckNotification {
        org_id: resp.org_id.clone(),
        check_name: resp.synthetics_name.clone(),
        check_id: resp.synthetics_id.clone(),
        check_type: String::new(),
        target: resp.target.clone(),
        destinations: Vec::new(),
        run_id: String::new(),
        status: status.to_string(),
        job_count: 0,
        error: None,
        checked_at: config::utils::time::now_micros(),
        recovery: false,
        consecutive_failures: 0,
        flaky: false,
        status_reason: None,
        error_source: String::new(),
        degraded: false,
        failing_locations: Vec::new(),
        passing_locations: Vec::new(),
        failing_environments: Vec::new(),
        coverage: None,
        template: None,
        event: NotificationEvent::Informational,
    };
    let mut ctx = synthetics_notification_context(&check);
    ctx.alert_status = status.to_string();
    ctx.alert_description = body.clone();
    ctx.level = Some(level);
    ctx.render_hints.fallback_subject = Some(subject.clone());
    for (key, value) in &mut ctx.context_attributes {
        match key.as_str() {
            "check_title" => *value = subject.clone(),
            "check_status_label" => *value = label.to_string(),
            _ => {}
        }
    }
    let legacy = serde_json::json!({ "text": format!("*{subject}*\n{body}") });
    ctx.legacy_payload = Some(LegacyPayload::new(move || legacy.clone()));
    ctx
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

    use crate::alerts::notifications::notify::{NotifyError, notify};

    let ctx = synthetics_notification_context(&n);
    let explicit =
        crate::alerts::notifications::org_default::load_override(&n.org_id, n.template.as_deref())
            .await;
    for dest_name in &n.destinations {
        let mut ctx = ctx.clone();
        match notify(&n.org_id, dest_name, &explicit, None, &mut ctx).await {
            Ok(_) | Err(NotifyError::Skipped(_)) => {}
            Err(e) => log::error!(
                "[synthetics] notify dest={dest_name} check={}: {e}",
                n.check_id
            ),
        }
    }
}

/// The subject line each run sends today; the synthetics card keeps it as its title.
#[cfg(feature = "enterprise")]
fn check_title(n: &CheckNotification) -> String {
    if n.recovery {
        format!("[OpenObserve Synthetics] ✅ {} has RECOVERED", n.check_name)
    } else if n.degraded {
        // Named where the condition is known: the subject decides whether anyone opens the alert.
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
    } else if let Some(coverage) = &n.coverage {
        format!(
            "[OpenObserve Synthetics] {} {}: {coverage}",
            status_emoji(n),
            n.check_name
        )
    } else {
        format!(
            "[OpenObserve Synthetics] {} {} is {}",
            status_emoji(n),
            n.check_name,
            n.status.to_uppercase()
        )
    }
}

/// The shared path's context for one synthetics message (Backend section 6 field mapping).
#[cfg(feature = "enterprise")]
pub fn synthetics_notification_context(
    n: &CheckNotification,
) -> crate::alerts::notifications::NotificationContext {
    use config::meta::alerts::{
        level::AlertLevel,
        notification_kind::{NotificationEvent, NotificationKind},
    };

    use crate::alerts::notifications::{LegacyPayload, NotificationContext, context::RenderHints};

    let level = if n.recovery {
        AlertLevel::Ok
    } else if n.degraded || n.flaky || n.status == "warning" {
        AlertLevel::Warning
    } else {
        AlertLevel::Critical
    };
    // Plain text: the body escapes substituted values, and the card's Error field carries the
    // error.
    let description = status_headline(n);
    let checked = crate::anomaly_detection::fmt_local_us(n.checked_at);
    let legacy: serde_json::Value = serde_json::from_str(&build_slack_json(n)).unwrap_or_default();
    NotificationContext {
        org_name: n.org_id.clone(),
        stream_type: "synthetics".to_string(),
        // A check has no stream or level row of its own; the card's Target and Status carry them.
        alert_name: n.check_name.clone(),
        alert_status: state_word(n).to_string(),
        episode_id: (n.event != NotificationEvent::Informational).then(|| n.check_id.clone()),
        alert_start_time: checked.clone(),
        alert_end_time: checked.clone(),
        alert_start_time_millis: (n.checked_at / 1000).to_string(),
        alert_end_time_millis: (n.checked_at / 1000).to_string(),
        alert_url: run_url(n),
        alert_trigger_time: n.checked_at,
        alert_trigger_time_str: checked,
        alert_description: description,
        context_attributes: synthetics_attributes(n),
        level: Some(level),
        kind: NotificationKind::Synthetics,
        event: n.event,
        cluster_name: config::get_cluster_name(),
        legacy_payload: Some(LegacyPayload::new(move || legacy.clone())),
        render_hints: RenderHints {
            fallback_subject: Some(check_title(n)),
            escape_email_attributes: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// The check's state as the title reads it: `failing`, `degraded`, `flaky` or `recovered`.
#[cfg(feature = "enterprise")]
fn state_word(n: &CheckNotification) -> &'static str {
    if n.recovery {
        "recovered"
    } else if n.degraded {
        "degraded"
    } else if n.flaky {
        "flaky"
    } else {
        "failing"
    }
}

/// The synthetics variables (Backend section B2) plus `check_title`, today's subject line.
#[cfg(feature = "enterprise")]
fn synthetics_attributes(n: &CheckNotification) -> Vec<(String, String)> {
    // A card field, so it reads like the other labels; check_status keeps the raw value.
    let label = if n.recovery {
        "Recovered"
    } else if n.degraded {
        "Degraded"
    } else if n.flaky {
        "Flaky"
    } else if n.status == "warning" {
        "Warning"
    } else {
        "Failing"
    };
    [
        ("check_id", n.check_id.clone()),
        ("check_name", n.check_name.clone()),
        ("check_type", n.check_type.clone()),
        ("check_target", n.target.clone()),
        ("check_status", n.status.clone()),
        ("check_status_label", label.to_string()),
        (
            "check_status_reason",
            n.status_reason.clone().unwrap_or_default(),
        ),
        ("check_locations_line", locations_line(n)),
        ("check_location_count", n.job_count.to_string()),
        (
            "check_consecutive_failures",
            n.consecutive_failures.to_string(),
        ),
        ("check_flaky", n.flaky.to_string()),
        ("check_degraded", n.degraded.to_string()),
        ("check_run_id", n.run_id.clone()),
        ("check_url", run_url(n)),
        ("check_error", n.error.clone().unwrap_or_default()),
        (
            "check_environments",
            environments_line(n).unwrap_or_default(),
        ),
        ("check_checked_at", checked_at_utc(n.checked_at)),
        ("check_title", check_title(n)),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
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
    if let Some(coverage) = &n.coverage {
        return format!("{}: {coverage}", n.check_name);
    }
    match n.status.as_str() {
        "warning" => format!("{} passed only after retries (flaky)", n.check_name),
        "error" if n.error_source == "config" => format!(
            "{} is misconfigured — {}",
            n.check_name,
            n.error
                .as_deref()
                .unwrap_or("its subtest references cannot be expanded")
        ),
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
        "{web_url}{base_uri}/web/synthetics/{}/results?org_identifier={}",
        n.check_id, n.org_id
    )
}

#[cfg(feature = "enterprise")]
/// The environments a message should name, or None when there is nothing to add.
fn environments_line(n: &CheckNotification) -> Option<String> {
    if n.failing_environments.is_empty() {
        return None;
    }
    Some(n.failing_environments.join(", "))
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
    if let Some(envs) = environments_line(n) {
        lines.push(format!("*Environments:* {envs}"));
    }
    if let Some(e) = n.error.as_deref().filter(|e| !e.is_empty()) {
        lines.push(format!("*Error:* ```{e}```"));
    }
    let checked_human = checked_at_utc(n.checked_at);
    lines.push(format!(
        "*Time:* <!date^{checked_secs}^{{date_time_secs}}|{checked_human}>"
    ));

    serde_json::json!({ "text": lines.join("\n") }).to_string()
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

/// The synthetics mute check over the downtimes cache, for `register_mute_check`.
pub fn downtime_mute_check(
    org: &str,
    check_id: &str,
    folder_id: &str,
    tags: &[String],
) -> openobserve_synthetics::alerting::BoxFuture<'static, Option<String>> {
    let (org, check_id, folder_id, tags) = (
        org.to_string(),
        check_id.to_string(),
        folder_id.to_string(),
        tags.to_vec(),
    );
    Box::pin(async move {
        if !crate::alerts::downtimes::any_for(
            &org,
            config::meta::downtimes::TargetModule::Synthetics,
        ) {
            return None;
        }
        let folder_id = public_folder_id(&folder_id).await;
        crate::alerts::downtimes::active_for_synthetic(
            &org,
            &check_id,
            &folder_id,
            &tags,
            config::utils::time::now_micros(),
        )
        .map(|downtime| downtime.id)
    })
}

/// Whether the org can mute a check now, from the downtime cache, for `register_mute_check`.
pub fn downtime_may_mute(org: &str) -> bool {
    crate::alerts::downtimes::any_for(org, config::meta::downtimes::TargetModule::Synthetics)
}

/// Sets the Muted chip on each listed check a downtime silences now.
#[cfg(feature = "enterprise")]
pub fn fill_active_downtimes(
    org_id: &str,
    items: &mut [config::meta::synthetics::SyntheticListItem],
) {
    if !crate::alerts::downtimes::any_for(org_id, config::meta::downtimes::TargetModule::Synthetics)
    {
        return;
    }
    let now = config::utils::time::now_micros();
    for item in items.iter_mut() {
        item.active_downtime = crate::alerts::downtimes::active_for_synthetic(
            org_id,
            &item.id,
            &item.folder_id,
            &item.tags,
            now,
        );
    }
}

#[cfg(not(feature = "enterprise"))]
pub fn fill_active_downtimes(
    _org_id: &str,
    _items: &mut [config::meta::synthetics::SyntheticListItem],
) {
}

/// Stored checks hold the folder primary key, while downtime targets name the public id.
async fn public_folder_id(folder_id: &str) -> String {
    infra::table::folders::get_name_by_pk(folder_id)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| folder_id.to_string())
}

/// Destinations of the unmuted checks; without `may_mute` all count and no folder is read.
#[cfg(feature = "enterprise")]
async fn unmuted_destinations(
    org_id: &str,
    checks: &[config::meta::synthetics::Synthetic],
    may_mute: bool,
) -> Vec<String> {
    let now = config::utils::time::now_micros();
    let mut destinations = Vec::new();
    for check in checks {
        if may_mute {
            let folder_id = public_folder_id(&check.folder_id).await;
            if crate::alerts::downtimes::active_for_synthetic(
                org_id,
                &check.id,
                &folder_id,
                &check.tags,
                now,
            )
            .is_some()
            {
                continue;
            }
        }
        destinations.extend(check.destinations.iter().cloned());
    }
    destinations.sort();
    destinations.dedup();
    destinations
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

            let conn = infra::db::get_orm_client_ro().await;
            let checks =
                infra::table::synthetics_checks::list_referencing_location(conn, &org_id, &loc.id)
                    .await
                    .unwrap_or_default();
            if checks.is_empty() {
                // Nothing runs here — stay quiet, re-evaluate next tick.
                continue;
            }
            let may_mute = downtime_may_mute(&org_id);
            let destinations = unmuted_destinations(&org_id, &checks, may_mute).await;
            if may_mute && destinations.is_empty() {
                log::debug!(
                    "[synthetics] private location down: {} ({}) org={} affected_checks={}, every check muted",
                    loc.label,
                    loc.id,
                    org_id,
                    checks.len()
                );
            }
            report_location_down(
                &loc.id,
                &destinations,
                may_mute,
                async || {
                    infra::table::synthetics_locations::try_claim_down_notification(&loc.id, now)
                        .await
                },
                async |destinations| {
                    log::warn!(
                        "[synthetics] private location down: {} ({}) org={} affected_checks={} destinations={}",
                        loc.label,
                        loc.id,
                        org_id,
                        checks.len(),
                        destinations.len()
                    );
                    if !destinations.is_empty() {
                        notify_location_down(
                            &org_id,
                            &loc,
                            checks.len(),
                            window_us / 1_000_000,
                            destinations,
                        )
                        .await
                    }
                },
            )
            .await;
        }
    }
}

/// One notification per outage from the CAS winner; only a mute emptying the list keeps the claim.
#[cfg(feature = "enterprise")]
async fn report_location_down(
    loc_id: &str,
    destinations: &[String],
    may_mute: bool,
    claim: impl AsyncFnOnce() -> Result<bool, infra::errors::Error>,
    notify: impl AsyncFnOnce(&[String]),
) -> bool {
    if may_mute && destinations.is_empty() {
        return false;
    }
    match claim().await {
        Ok(true) => {}
        Ok(false) => return false,
        Err(e) => {
            log::error!(
                "[synthetics] staleness watcher: claim down notification for {loc_id}: {e}"
            );
            return false;
        }
    }
    // The winner reports even an empty list, so the outage is logged once as on main.
    notify(destinations).await;
    !destinations.is_empty()
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
            error_source: "probe".into(),
            degraded: false,
            failing_locations: vec!["aws-us-east-1".into(), "aws-us-west-1".into()],
            passing_locations: vec!["aws-eu-central-1".into()],
            failing_environments: vec![],
            coverage: None,
            template: None,
            event: config::meta::alerts::notification_kind::NotificationEvent::Firing,
        }
    }

    /// The same check recovering: status is "passed", nothing is failing.
    fn recovered() -> CheckNotification {
        CheckNotification {
            status: "passed".into(),
            recovery: true,
            event: config::meta::alerts::notification_kind::NotificationEvent::Resolved,
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

    fn resolved_for(destination_type: &str) -> crate::alerts::notifications::notify::Resolved {
        use crate::alerts::notifications::org_default::{
            EffectiveTemplate, TemplateSource, compiled_fallback,
        };
        let dest_type = config::meta::destinations::DestinationType::Http(
            config::meta::destinations::Endpoint {
                destination_type: Some(destination_type.to_string()).filter(|t| !t.is_empty()),
                url: "https://hooks.example/x".into(),
                ..Default::default()
            },
        );
        crate::alerts::notifications::notify::Resolved {
            destination: Default::default(),
            channel: crate::alerts::notifications::derive_channel_format(&dest_type),
            destination_type: dest_type,
            effective: EffectiveTemplate {
                template: compiled_fallback("default"),
                source: TemplateSource::Compiled,
                skipped: vec![],
            },
        }
    }

    #[test]
    fn a_failing_run_triggers_keyed_by_the_check_and_the_recovery_resolves() {
        use crate::alerts::notifications::{
            notify::{Route, route},
            platform::Platform,
        };
        let firing = synthetics_notification_context(&firing());
        assert_eq!(firing.episode_id.as_deref(), Some("abc123"));
        assert_eq!(
            route(&resolved_for("pagerduty"), &firing).unwrap(),
            Route::Render
        );
        let recovered = synthetics_notification_context(&recovered());
        assert_eq!(recovered.episode_id.as_deref(), Some("abc123"));
        assert_eq!(
            route(&resolved_for("pagerduty"), &recovered).unwrap(),
            Route::PlatformResolve(Platform::PagerDuty)
        );
        assert_eq!(
            route(&resolved_for("slack"), &recovered).unwrap(),
            Route::Render
        );
    }

    #[test]
    fn a_notice_skips_platforms_and_is_a_card_elsewhere() {
        use config::meta::alerts::notification_kind::NotificationEvent;

        use crate::alerts::notifications::notify::{NotifyError, Route, SkipReason, route};
        let notice = CheckNotification {
            status: "warning".into(),
            degraded: true,
            status_reason: Some("cert_expiring".into()),
            event: NotificationEvent::Informational,
            ..firing()
        };
        let ctx = synthetics_notification_context(&notice);
        assert_eq!(ctx.episode_id, None);
        assert!(matches!(
            route(&resolved_for("pagerduty"), &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
        ));
        assert_eq!(route(&resolved_for("slack"), &ctx).unwrap(), Route::Render);
    }

    #[test]
    fn the_check_card_body_has_no_escaped_code_fence() {
        use crate::alerts::notifications::{
            default_template::compiled_default_content, resolve_content,
        };
        let n = CheckNotification {
            error: Some("connect to https://example.com:443/health?x=1 timed out".into()),
            ..firing()
        };
        let ctx = synthetics_notification_context(&n);
        assert!(
            !ctx.alert_description.contains('`'),
            "{}",
            ctx.alert_description
        );
        let content = resolve_content(&compiled_default_content(), &ctx, "slack");
        assert!(
            !content.body_markdown.contains("\\`"),
            "{}",
            content.body_markdown
        );
        assert!(
            content.fields.iter().any(|(_, v)| v.contains("timed out")),
            "the Error field carries the error"
        );
    }

    #[test]
    fn a_generic_webhook_gets_todays_text_body_byte_for_byte() {
        use crate::alerts::notifications::notify::{Route, route};
        let n = firing();
        let Route::Legacy(body) =
            route(&resolved_for(""), &synthetics_notification_context(&n)).unwrap()
        else {
            panic!("expected the legacy body");
        };
        assert_eq!(body.to_string(), build_slack_json(&n));
    }

    fn location() -> infra::table::synthetics_locations::SyntheticsLocationRecord {
        infra::table::synthetics_locations::SyntheticsLocationRecord {
            id: "loc_1".into(),
            org_id: Some("default".into()),
            kind: "private".into(),
            provider: "self".into(),
            region: "dc-1".into(),
            label: "rack 4".into(),
            pool: "p".into(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn the_location_card_has_no_unknown_marker_on_slack_and_email() {
        use crate::alerts::notifications::{
            ChannelFormat, RenderedMessage, UNMATCHED_MARKER,
            default_template::compiled_default_content, render, resolve_content,
        };
        let ctx = location_down_context("default", &location(), 3, 120);
        assert_eq!(ctx.alert_status, "failing");
        let content = resolve_content(&compiled_default_content(), &ctx, "slack");
        let RenderedMessage::Http { body } = render(ChannelFormat::Slack, &content, &ctx).unwrap()
        else {
            panic!("slack renders a body");
        };
        assert!(!body.contains(UNMATCHED_MARKER), "{body}");
        assert!(body.contains("private_location"), "{body}");
        assert!(!content.body_markdown.contains("\\`"), "{body}");
        let email = resolve_content(&compiled_default_content(), &ctx, "email");
        let RenderedMessage::Email { html, text, .. } =
            render(ChannelFormat::Email, &email, &ctx).unwrap()
        else {
            panic!("email renders a message");
        };
        assert!(!html.contains(UNMATCHED_MARKER), "{html}");
        assert!(!text.contains(UNMATCHED_MARKER), "{text}");
        assert!(text.contains("is down"), "{text}");
    }

    #[test]
    fn a_location_down_skips_platforms_and_keeps_todays_text_on_webhooks() {
        use crate::alerts::notifications::notify::{NotifyError, Route, SkipReason, route};
        let ctx = location_down_context("default", &location(), 3, 120);
        assert_eq!(ctx.episode_id, None);
        assert!(matches!(
            route(&resolved_for("pagerduty"), &ctx),
            Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
        ));
        assert_eq!(route(&resolved_for("slack"), &ctx).unwrap(), Route::Render);
        let Route::Legacy(body) = route(&resolved_for(""), &ctx).unwrap() else {
            panic!("expected the legacy body");
        };
        assert!(
            body["text"]
                .as_str()
                .unwrap()
                .starts_with("Private location rack 4 (dc-1) is down")
        );
    }

    #[test]
    fn the_title_is_todays_subject_line() {
        let ctx = synthetics_notification_context(&recovered());
        assert_eq!(
            ctx.render_hints.fallback_subject.as_deref(),
            Some("[OpenObserve Synthetics] ✅ EU1 Cloud Health Check has RECOVERED")
        );
        let title = ctx
            .context_attributes
            .iter()
            .find(|(k, _)| k == "check_title")
            .map(|(_, v)| v.as_str());
        assert_eq!(
            title,
            Some("[OpenObserve Synthetics] ✅ EU1 Cloud Health Check has RECOVERED")
        );
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
    fn a_config_error_reads_as_misconfigured_not_as_probe_infrastructure() {
        let mut n = firing();
        n.status = "error".into();
        n.error_source = "config".into();
        n.error =
            Some("'Login (shared)' grew and this test now needs 51 steps; the limit is 50".into());
        let headline = status_headline(&n);
        assert!(headline.contains("misconfigured"), "{headline}");
        assert!(headline.contains("51 steps"), "{headline}");
        assert!(!headline.contains("probe infrastructure"), "{headline}");
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
            failing_environments: vec![],
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

    async fn locations_db() -> sea_orm::DatabaseConnection {
        use infra::table::entity::synthetics_locations;
        use sea_orm::{ConnectionTrait, Database, EntityTrait, Schema, Set};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let table = Schema::new(backend).create_table_from_entity(synthetics_locations::Entity);
        db.execute(backend.build(&table)).await.unwrap();
        synthetics_locations::Entity::insert(synthetics_locations::ActiveModel {
            id: Set("loc-1".to_string()),
            org_id: Set(Some("org1".to_string())),
            kind: Set("private".to_string()),
            provider: Set("custom".to_string()),
            region: Set("corp-hq".to_string()),
            label: Set("Corp HQ".to_string()),
            pool: Set("private-org1-corp-hq".to_string()),
            enabled: Set(true),
            down_notified_at: Set(0),
            created_at: Set(1),
            updated_at: Set(1),
        })
        .exec(&db)
        .await
        .unwrap();
        db
    }

    async fn down_notified_at(db: &sea_orm::DatabaseConnection) -> i64 {
        use sea_orm::EntityTrait;
        infra::table::entity::synthetics_locations::Entity::find_by_id("loc-1")
            .one(db)
            .await
            .unwrap()
            .unwrap()
            .down_notified_at
    }

    /// One watcher tick for loc-1, with the destinations its unmuted checks left.
    async fn tick(
        db: &sea_orm::DatabaseConnection,
        destinations: &[String],
        now: i64,
        sent: &std::sync::atomic::AtomicUsize,
    ) -> bool {
        tick_with(db, destinations, true, now, sent).await
    }

    async fn tick_with(
        db: &sea_orm::DatabaseConnection,
        destinations: &[String],
        may_mute: bool,
        now: i64,
        sent: &std::sync::atomic::AtomicUsize,
    ) -> bool {
        report_location_down(
            "loc-1",
            destinations,
            may_mute,
            async || {
                infra::table::synthetics_locations::try_claim_down_notification_with(
                    db, "loc-1", now,
                )
                .await
            },
            async |destinations| {
                if !destinations.is_empty() {
                    sent.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            },
        )
        .await
    }

    #[tokio::test]
    async fn a_location_whose_every_check_is_muted_keeps_its_down_claim() {
        let db = locations_db().await;
        let sent = std::sync::atomic::AtomicUsize::new(0);

        assert!(!tick(&db, &[], 100, &sent).await);
        assert_eq!(
            down_notified_at(&db).await,
            0,
            "a muted tick must not use up the claim"
        );
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn with_no_downtime_a_location_without_destinations_uses_its_claim_as_before() {
        let db = locations_db().await;
        let sent = std::sync::atomic::AtomicUsize::new(0);

        assert!(!tick_with(&db, &[], false, 100, &sent).await);
        assert_eq!(
            down_notified_at(&db).await,
            100,
            "the claim is one-shot on main"
        );
        assert!(!tick_with(&db, &["pager".to_string()], false, 200, &sent).await);
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn the_first_tick_after_the_mute_claims_and_notifies_once() {
        let db = locations_db().await;
        let sent = std::sync::atomic::AtomicUsize::new(0);
        let destinations = ["pager".to_string()];

        assert!(!tick(&db, &[], 100, &sent).await);
        assert!(tick(&db, &destinations, 200, &sent).await);
        assert!(!tick(&db, &destinations, 300, &sent).await);
        assert_eq!(down_notified_at(&db).await, 200);
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn a_gap_that_closed_during_delivery_owes_its_resumed_notice() {
        assert!(gap_closed_during_delivery(0, 100));
        assert!(gap_closed_during_delivery(200, 100));
        assert!(!gap_closed_during_delivery(100, 100));
    }

    #[test]
    fn a_gap_notice_is_informational_and_carries_its_own_words() {
        use config::meta::alerts::{level::AlertLevel, notification_kind::NotificationEvent};
        use openobserve_synthetics::alerting::GapNotice;

        let gap = GapNotification {
            org_id: "org1".into(),
            synthetics_id: "c1".into(),
            synthetics_name: "Checkout".into(),
            target: "example.com".into(),
            destinations: vec!["d1".into()],
            notice: GapNotice::Opened { since: 1 },
        };
        let ctx = gap_notification_context(&gap);
        assert_eq!(ctx.event, NotificationEvent::Informational);
        assert_eq!(ctx.episode_id, None);
        assert_eq!(ctx.level, Some(AlertLevel::Warning));
        let subject = "[OpenObserve Synthetics] Monitoring gap: Checkout";
        assert_eq!(ctx.render_hints.fallback_subject.as_deref(), Some(subject));
        assert!(ctx.alert_description.contains("could not test example.com"));
        let attr = |k: &str| {
            ctx.context_attributes
                .iter()
                .find(|(key, _)| key == k)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(attr("check_title"), Some(subject));
        assert_eq!(attr("check_status_label"), Some("Not measured"));
    }
}

/// Sends the "location down" notification through the shared path.
#[cfg(feature = "enterprise")]
async fn notify_location_down(
    org_id: &str,
    loc: &infra::table::synthetics_locations::SyntheticsLocationRecord,
    affected: usize,
    stale_secs: i64,
    destinations: &[String],
) {
    use crate::alerts::notifications::notify::{NotifyError, notify};

    let ctx = location_down_context(org_id, loc, affected, stale_secs);
    for dest_name in destinations {
        let mut ctx = ctx.clone();
        match notify(org_id, dest_name, &[], None, &mut ctx).await {
            Ok(_) | Err(NotifyError::Skipped(_)) => {}
            Err(e) => log::error!(
                "[synthetics] location-down notify dest={dest_name} location={}: {e}",
                loc.id
            ),
        }
    }
}

/// Context for a private location down message; Informational, so platforms skip it (D8).
#[cfg(feature = "enterprise")]
fn location_down_context(
    org_id: &str,
    loc: &infra::table::synthetics_locations::SyntheticsLocationRecord,
    affected: usize,
    stale_secs: i64,
) -> crate::alerts::notifications::NotificationContext {
    use config::meta::alerts::{
        level::AlertLevel,
        notification_kind::{NotificationEvent, NotificationKind},
    };

    use crate::alerts::notifications::{LegacyPayload, NotificationContext, context::RenderHints};

    let subject = format!(
        "[OpenObserve Synthetics] 🔴 Private location {} is DOWN",
        loc.label
    );
    let text = format!(
        "Private location {} ({}) is down — no live agent for over {}s.\nAffected checks: {}\nRestart the agent container or check its network path to OpenObserve.",
        loc.label, loc.region, stale_secs, affected
    );
    let legacy = serde_json::json!({ "text": text });
    let now = config::utils::time::now_micros();
    NotificationContext {
        org_name: org_id.to_string(),
        stream_type: "synthetics".to_string(),
        alert_name: loc.label.clone(),
        alert_status: "failing".to_string(),
        alert_url: locations_url(org_id),
        alert_trigger_time: now,
        alert_trigger_time_str: crate::anomaly_detection::fmt_local_us(now),
        alert_description: text,
        context_attributes: vec![
            ("check_name".to_string(), loc.label.clone()),
            ("check_status".to_string(), "down".to_string()),
            ("check_status_label".to_string(), "Down".to_string()),
            ("check_target".to_string(), loc.region.clone()),
            ("check_type".to_string(), "private_location".to_string()),
            (
                "check_locations_line".to_string(),
                format!("{} ({affected} affected checks)", loc.region),
            ),
            ("check_error".to_string(), String::new()),
            ("check_environments".to_string(), String::new()),
            ("check_checked_at".to_string(), checked_at_utc(now)),
            ("check_url".to_string(), locations_url(org_id)),
            ("check_title".to_string(), subject.clone()),
        ],
        level: Some(AlertLevel::Critical),
        kind: NotificationKind::Synthetics,
        event: NotificationEvent::Informational,
        cluster_name: config::get_cluster_name(),
        legacy_payload: Some(LegacyPayload::new(move || legacy.clone())),
        render_hints: RenderHints {
            fallback_subject: Some(subject),
            escape_email_attributes: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

#[cfg(feature = "enterprise")]
fn locations_url(org_id: &str) -> String {
    let cfg = config::get_config();
    format!(
        "{}{}/web/settings/synthetics_locations?org_identifier={org_id}",
        cfg.common.web_url, cfg.common.base_uri
    )
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
