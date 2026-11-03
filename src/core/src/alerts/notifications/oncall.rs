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

//! The on-call sender and resolver the enterprise engine reaches through its registered slots.

use config::meta::alerts::{level::AlertLevel, notification_kind::NotificationKind};
use o2_enterprise::enterprise::oncall::sender::{
    OnCallNotification, OnCallResolve, OnCallSendError,
};

use super::{
    LegacyPayload, NotificationContext, STATUS_FIRING, STATUS_RESOLVED,
    notify::{NotifyError, SkipOutcome, notify},
};

/// Sends one on-call message to one destination through the shared path and the ledger.
pub async fn notify_destination(n: OnCallNotification) -> Result<(), OnCallSendError> {
    let mut ctx = on_call_context(&n);
    let explicit = super::org_default::load_override(&n.org_id, n.template.as_deref()).await;
    let result = notify(&n.org_id, &n.destination, &explicit, None, &mut ctx).await;
    send_result(result.map(|_| ()))
}

/// Closes a response's episode: every destination it reached or its team channel gets the resolve.
pub async fn resolve_episode(r: OnCallResolve) -> Result<(), OnCallSendError> {
    use infra::table::notification_deliveries::CLOSED_BY_RESOLVE;

    use super::delivery;

    let n = r.message;
    let ctx = on_call_context(&n);
    let explicit = super::org_default::load_override(&n.org_id, n.template.as_deref()).await;
    let mut rows = Vec::new();
    for dest in &r.destinations {
        rows.push(delivery::fanout_row(&n.org_id, dest, &explicit, None, &ctx).await);
    }
    let mut recorded_rows = Vec::new();
    for dest in delivery::recorded_destinations(&n.org_id, NotificationKind::OnCall, &n.episode_id)
        .await
        .into_iter()
        .filter(|d| !r.destinations.contains(d))
    {
        recorded_rows.push(delivery::fanout_row(&n.org_id, &dest, &explicit, None, &ctx).await);
    }
    let (current, mut outside) = delivery::split_fanout(rows);
    let (recorded, recorded_outside) = delivery::split_fanout(recorded_rows);
    outside.extend(recorded_outside);
    let state_change: delivery::StateChange = Box::new(|_| Box::pin(async { Ok(true) }));
    let results = delivery::resolve_episode(
        &n.org_id,
        NotificationKind::OnCall,
        &n.episode_id,
        n.response_id.as_deref().unwrap_or(&n.episode_id),
        current,
        recorded,
        CLOSED_BY_RESOLVE,
        true,
        state_change,
    )
    .await
    .map_err(|e| OnCallSendError::Retryable(e.to_string()))?
    .unwrap_or_default();
    delivery::send_outside_after_close(&n.org_id, &outside, &explicit, None, &ctx).await;
    let failed: Vec<String> = results
        .into_iter()
        .filter_map(|r| send_result(r.map(|_| ())).err())
        .filter(|e| !matches!(e, OnCallSendError::Skipped(_)))
        .map(|e| e.to_string())
        .collect();
    if failed.is_empty() {
        Ok(())
    } else {
        // The rows are queued on the ledger, so the sweeper finishes what failed here.
        Err(OnCallSendError::Retryable(failed.join("; ")))
    }
}

/// Upgrade notice: one line per policy whose email or SNS destinations now get pages.
pub async fn log_mail_destination_policies() {
    use config::meta::destinations::{DestinationType, Module};

    let policies = match infra::table::oncall_policies::list_all().await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[ONCALL] could not list policies for the upgrade notice: {e}");
            return;
        }
    };
    for policy in policies {
        let mut mail = Vec::new();
        for name in &policy.destinations {
            if let Ok(Some(dest)) = infra::table::destinations::get(&policy.org_id, name).await
                && let Module::Alert {
                    destination_type: DestinationType::Email(_) | DestinationType::Sns(_),
                    ..
                } = dest.module
            {
                mail.push(name.as_str());
            }
        }
        if !mail.is_empty() {
            log::info!(
                "[ONCALL] policy of team {} in org {} names email or SNS destinations ({}); they receive pages from this version",
                policy.team_id,
                policy.org_id,
                mail.join(", ")
            );
        }
    }
}

/// The shared path's context for one on-call message (Backend section 6 field mapping).
pub fn on_call_context(n: &OnCallNotification) -> NotificationContext {
    let resolved = n.event == STATUS_RESOLVED;
    let level = if resolved {
        Some(AlertLevel::Ok)
    } else {
        match n.priority.as_str() {
            "P1" => Some(AlertLevel::Critical),
            "P2" => Some(AlertLevel::Warning),
            _ => None,
        }
    };
    let title = if n.event == "test" && !n.title.starts_with("[TEST] ") {
        format!("[TEST] {}", n.title)
    } else {
        n.title.clone()
    };
    let now = config::utils::time::now_micros();
    let legacy = n.legacy_payload.clone();
    let attribute = |k: &str, v: String| (k.to_string(), v);
    NotificationContext {
        org_name: n.org_id.clone(),
        alert_name: title,
        alert_level: level.map(|l| l.to_string()).unwrap_or_default(),
        alert_status: if resolved {
            STATUS_RESOLVED
        } else {
            STATUS_FIRING
        }
        .to_string(),
        episode_id: Some(n.episode_id.clone()),
        alert_url: n.url.clone(),
        alert_trigger_time: now,
        alert_trigger_time_str: crate::anomaly_detection::fmt_local_us(now),
        alert_description: n.text.clone(),
        context_attributes: vec![
            attribute("oncall_team", n.team.clone()),
            attribute("oncall_reason", n.reason.clone()),
            attribute("oncall_stage", n.stage.clone()),
            attribute("oncall_priority", n.priority.clone()),
            attribute("oncall_recipient", n.recipient.clone().unwrap_or_default()),
            attribute(
                "oncall_response_id",
                n.response_id.clone().unwrap_or_default(),
            ),
            attribute("oncall_ack_url", n.ack_url.clone().unwrap_or_default()),
            attribute("runbook_url", n.runbook_url.clone().unwrap_or_default()),
        ],
        level,
        kind: NotificationKind::OnCall,
        object_id: n
            .response_id
            .clone()
            .unwrap_or_else(|| n.episode_id.clone()),
        event: n.event.clone(),
        cluster_name: config::get_cluster_name(),
        legacy_payload: Some(LegacyPayload::new(move || legacy.clone())),
        render_hints: super::context::RenderHints {
            fallback_subject: Some(n.title.clone()),
            escape_email_attributes: true,
        },
        ..Default::default()
    }
}

/// A Retryable error is retried by the engine; a Skipped one is neither delivered nor failed.
fn send_result(result: Result<(), NotifyError>) -> Result<(), OnCallSendError> {
    match result {
        Ok(()) => Ok(()),
        Err(NotifyError::Skipped(reason)) => match reason.outcome() {
            SkipOutcome::Delivered | SkipOutcome::Handled | SkipOutcome::Pending => Ok(()),
            SkipOutcome::Unsuccessful => Err(OnCallSendError::Skipped(reason.as_str().to_string())),
        },
        Err(e) if e.is_retryable() => Err(OnCallSendError::Retryable(e.to_string())),
        Err(e) => Err(OnCallSendError::Permanent(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::{super::notify::SkipReason, *};

    fn page(event: &str) -> OnCallNotification {
        OnCallNotification {
            org_id: "acme".into(),
            destination: "slack-ops".into(),
            event: event.into(),
            episode_id: "resp_31".into(),
            title: "High error rate".into(),
            text: "error rate 12%".into(),
            reason: "paged by policy".into(),
            priority: "P1".into(),
            team: "checkout".into(),
            recipient: Some("maria@acme.com".into()),
            url: "https://o2/r".into(),
            ack_url: Some("https://o2/ack".into()),
            response_id: Some("resp_31".into()),
            stage: "paged".into(),
            legacy_payload: serde_json::json!({"text": "legacy"}),
            ..Default::default()
        }
    }

    #[test]
    fn a_page_maps_to_the_on_call_context() {
        let ctx = on_call_context(&page("paged:0:0"));
        assert_eq!(ctx.kind, NotificationKind::OnCall);
        assert_eq!(ctx.episode_id.as_deref(), Some("resp_31"));
        assert_eq!(ctx.object_id, "resp_31");
        assert_eq!(ctx.level, Some(AlertLevel::Critical));
        assert_eq!(ctx.alert_status, STATUS_FIRING);
        assert!(
            ctx.context_attributes
                .iter()
                .any(|(k, v)| k == "oncall_ack_url" && v == "https://o2/ack")
        );
        assert_eq!(
            ctx.legacy_payload.unwrap().build(),
            serde_json::json!({"text": "legacy"})
        );

        let resolved = on_call_context(&page(STATUS_RESOLVED));
        assert_eq!(resolved.level, Some(AlertLevel::Ok));
        assert_eq!(resolved.alert_status, STATUS_RESOLVED);
    }

    #[test]
    fn a_test_page_keeps_its_marker_and_a_p3_has_no_level() {
        let mut n = page("test");
        n.priority = "P3".into();
        let ctx = on_call_context(&n);
        assert_eq!(ctx.alert_name, "[TEST] High error rate");
        assert_eq!(ctx.level, None);
    }

    #[test]
    fn send_results_map_to_what_the_engine_retries() {
        assert_eq!(send_result(Ok(())), Ok(()));
        for handled in [
            SkipReason::AlreadyDelivered,
            SkipReason::PlatformNoAck,
            SkipReason::PlatformNotForKind,
            SkipReason::InFlight,
        ] {
            assert_eq!(send_result(Err(NotifyError::Skipped(handled))), Ok(()));
        }
        assert!(matches!(
            send_result(Err(NotifyError::Skipped(SkipReason::NoOrgMemberRecipient))),
            Err(OnCallSendError::Skipped(_))
        ));
        assert!(matches!(
            send_result(Err(NotifyError::Rejected {
                status: 503,
                body: String::new()
            })),
            Err(OnCallSendError::Retryable(_))
        ));
        assert!(matches!(
            send_result(Err(NotifyError::DestinationNotFound("x".into()))),
            Err(OnCallSendError::Permanent(_))
        ));
    }
}
