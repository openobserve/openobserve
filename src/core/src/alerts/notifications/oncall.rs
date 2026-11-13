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

//! The on-call sender the enterprise engine reaches through its registered slot.

use config::meta::{
    alerts::{
        level::AlertLevel,
        notification_kind::{NotificationEvent, NotificationKind},
    },
    oncall::response::SentTemplate,
};
use o2_enterprise::enterprise::oncall::sender::{OnCallNotification, OnCallSendError, OnCallStage};

use super::{
    LegacyPayload, NotificationContext,
    notify::{NotifyError, notify},
};

/// Sends one on-call message to one destination through the shared path.
pub async fn notify_destination(n: OnCallNotification) -> Result<SentTemplate, OnCallSendError> {
    let mut ctx = on_call_context(&n);
    let explicit = super::org_default::load_override(&n.org_id, n.template.as_deref()).await;
    let result = notify(&n.org_id, &n.destination, &explicit, None, &mut ctx).await;
    send_result(result.map(|outcome| SentTemplate {
        destination: n.destination.clone(),
        template_name: outcome.template_name,
        template_source: outcome.template_source,
    }))
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
        // The team's own channel pages too, so its destinations count as well (D9).
        let channel = infra::table::oncall_teams::get_channel(&policy.org_id, &policy.team_id)
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
        let mut names: Vec<&String> = policy.destinations.iter().chain(channel.iter()).collect();
        names.sort();
        names.dedup();
        for name in names {
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
    let level = match n.priority.as_str() {
        "P1" => Some(AlertLevel::Critical),
        "P2" => Some(AlertLevel::Warning),
        _ => None,
    };
    let title = if n.stage == OnCallStage::Test && !n.title.starts_with("[TEST] ") {
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
        alert_level: n.priority.clone(),
        alert_status: state_word(n).to_string(),
        episode_id: (!n.key.is_empty()).then(|| n.key.clone()),
        alert_url: n.url.clone(),
        alert_trigger_time: now,
        alert_trigger_time_str: crate::anomaly_detection::fmt_local_us(now),
        alert_description: n.text.clone(),
        context_attributes: vec![
            attribute("oncall_team", n.team.clone()),
            attribute("oncall_reason", n.reason.clone()),
            attribute("oncall_stage", n.stage.as_str().to_string()),
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
        event: n.event,
        cluster_name: config::get_cluster_name(),
        legacy_payload: Some(LegacyPayload::new(move || legacy.clone())),
        render_hints: super::context::RenderHints {
            fallback_subject: Some(n.title.clone()),
            escape_email_attributes: true,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// The page's state as the title reads it: `{subject} paged`.
fn state_word(n: &OnCallNotification) -> &'static str {
    match (n.stage, n.event) {
        (_, NotificationEvent::Resolved) => "acknowledged",
        (OnCallStage::CoverageGap, _) => "uncovered",
        (OnCallStage::Verdict, _) => "reviewed",
        _ => "paged",
    }
}

/// A Retryable error is retried by the engine; a platform skip is neither delivered nor failed.
fn send_result<T>(result: Result<T, NotifyError>) -> Result<T, OnCallSendError> {
    match result {
        Ok(sent) => Ok(sent),
        // A skip is not a delivery, so a send that only reached platforms reports nothing sent.
        Err(NotifyError::Skipped(reason)) => Err(OnCallSendError::Skipped(reason.as_str().into())),
        Err(e) if e.is_retryable() => Err(OnCallSendError::Retryable(e.to_string())),
        Err(e) => Err(OnCallSendError::Permanent(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::notifications::{
        notify::{Route, SkipReason, route},
        org_default::{EffectiveTemplate, TemplateSource, compiled_fallback},
    };

    fn page(stage: OnCallStage) -> OnCallNotification {
        OnCallNotification {
            org_id: "acme".into(),
            destination: "slack-ops".into(),
            stage,
            event: stage.event(),
            key: if stage == OnCallStage::Test {
                String::new()
            } else {
                "resp_31".into()
            },
            title: "High error rate".into(),
            text: "error rate 12%".into(),
            reason: "paged by policy".into(),
            priority: "P1".into(),
            team: "checkout".into(),
            recipient: Some("maria@acme.com".into()),
            url: "https://o2/r".into(),
            ack_url: Some("https://o2/ack".into()),
            response_id: Some("resp_31".into()),
            legacy_payload: serde_json::json!({"text": "legacy"}),
            ..Default::default()
        }
    }

    fn resolved_for(destination_type: &str) -> super::super::notify::Resolved {
        let dest_type = config::meta::destinations::DestinationType::Http(
            config::meta::destinations::Endpoint {
                destination_type: Some(destination_type.to_string()).filter(|t| !t.is_empty()),
                url: "https://hooks.example/x".into(),
                ..Default::default()
            },
        );
        super::super::notify::Resolved {
            destination: Default::default(),
            channel: super::super::derive_channel_format(&dest_type),
            destination_type: dest_type,
            effective: EffectiveTemplate {
                template: compiled_fallback("acme"),
                source: TemplateSource::Compiled,
                skipped: vec![],
            },
        }
    }

    #[test]
    fn a_page_maps_to_the_on_call_context() {
        let ctx = on_call_context(&page(OnCallStage::Paged));
        assert_eq!(ctx.kind, NotificationKind::OnCall);
        assert_eq!(ctx.event, NotificationEvent::Firing);
        assert_eq!(ctx.episode_id.as_deref(), Some("resp_31"));
        assert_eq!(ctx.level, Some(AlertLevel::Critical));
        assert_eq!(ctx.alert_level, "P1");
        assert_eq!(ctx.alert_status, "paged");
        assert!(
            ctx.context_attributes
                .iter()
                .any(|(k, v)| k == "oncall_ack_url" && v == "https://o2/ack")
        );
        assert_eq!(
            ctx.legacy_payload.unwrap().build(),
            serde_json::json!({"text": "legacy"})
        );
    }

    #[test]
    fn a_test_page_keeps_its_marker_and_a_p3_has_no_level() {
        let mut n = page(OnCallStage::Test);
        n.priority = "P3".into();
        let ctx = on_call_context(&n);
        assert_eq!(ctx.alert_name, "[TEST] High error rate");
        assert_eq!(ctx.level, None);
        assert_eq!(ctx.episode_id, None);
    }

    #[test]
    fn the_event_matrix_on_platform_and_other_destinations() {
        let paged = on_call_context(&page(OnCallStage::Paged));
        assert_eq!(
            route(&resolved_for("pagerduty"), &paged).unwrap(),
            Route::Render
        );
        assert_eq!(
            route(&resolved_for("slack"), &paged).unwrap(),
            Route::Render
        );
        assert!(matches!(
            route(&resolved_for(""), &paged).unwrap(),
            Route::Legacy(_)
        ));
        for stage in [
            OnCallStage::CoverageGap,
            OnCallStage::Verdict,
            OnCallStage::Test,
        ] {
            let ctx = on_call_context(&page(stage));
            assert!(
                matches!(
                    route(&resolved_for("opsgenie"), &ctx),
                    Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))
                ),
                "{stage:?}"
            );
            assert_eq!(route(&resolved_for("slack"), &ctx).unwrap(), Route::Render);
        }
    }

    #[test]
    fn send_results_map_to_what_the_engine_retries() {
        assert_eq!(send_result(Ok(())), Ok(()));
        assert!(matches!(
            send_result::<()>(Err(NotifyError::Skipped(SkipReason::PlatformNotForKind))),
            Err(OnCallSendError::Skipped(_))
        ));
        assert!(matches!(
            send_result::<()>(Err(NotifyError::Skipped(SkipReason::NoOrgMemberRecipient))),
            Err(OnCallSendError::Skipped(_))
        ));
        assert!(matches!(
            send_result::<()>(Err(NotifyError::Rejected {
                status: 503,
                body: String::new()
            })),
            Err(OnCallSendError::Retryable(_))
        ));
        assert!(matches!(
            send_result::<()>(Err(NotifyError::DestinationNotFound("x".into()))),
            Err(OnCallSendError::Permanent(_))
        ));
    }
}
