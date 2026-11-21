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

//! The RCA agent's context — subject-generic, so an alert-subject run and an incident-subject run
//! build the same shape.

use serde::{Deserialize, Serialize};

use super::subject::SubjectType;
use crate::meta::alerts::priority::AlertPriority;

pub const MAX_BUNDLE_ITEMS: usize = 12;
pub const MAX_OFFERED_ACTIONS: usize = 6;
/// `window_start_us` is the first alert minus this lead (60 minutes).
pub const RCA_WINDOW_LEAD_US: i64 = 3_600_000_000;
/// `RcaCapabilities.serving_region` of a build that is not part of a super cluster.
pub const LOCAL_SERVING_REGION: &str = "local";

/// What the RCA agent is told about the thing it is investigating.
///
/// A field it has nothing to say about is omitted from the wire, never sent as `null` — `o2-ai`
/// routes on key presence, which a null satisfies.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RcaContext {
    pub subject_type: SubjectType,
    pub subject_id: String,
    /// Omitted, never null: the agent routes on `"incident_id" in context`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub incident_id: Option<String>,
    pub org_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_analysis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<AlertPriority>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub past_causes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dimensions: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<EvidenceBundle>,
    /// Microseconds; the incident's first alert, or the alert subject's firing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_alert_at_us: Option<i64>,
    /// Microseconds; `first_alert_at_us` minus [RCA_WINDOW_LEAD_US].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_start_us: Option<i64>,
    /// Microseconds; alert subjects only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fired_at_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected_services: Vec<String>,
    /// Only an explicit `false` blocks history; a missing key means an older producer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_reads_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serving_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<RcaCapabilities>,
}

impl RcaContext {
    /// A context with only the subject keys set; producers fill the rest.
    pub fn new(subject_type: SubjectType, subject_id: String, org_id: String) -> Self {
        Self {
            subject_type,
            subject_id,
            incident_id: None,
            org_id,
            previous_analysis: None,
            severity: None,
            past_causes: Vec::new(),
            alert_name: None,
            stream: None,
            dimensions: None,
            evidence: None,
            first_alert_at_us: None,
            window_start_us: None,
            fired_at_us: None,
            affected_services: Vec::new(),
            history_reads_allowed: None,
            serving_region: None,
            capabilities: None,
        }
    }

    /// Sets `first_alert_at_us` and the analysis window that starts [RCA_WINDOW_LEAD_US] before it.
    pub fn with_first_alert(mut self, first_alert_at_us: i64) -> Self {
        self.first_alert_at_us = Some(first_alert_at_us);
        self.window_start_us = Some(first_alert_at_us.saturating_sub(RCA_WINDOW_LEAD_US).max(0));
        self
    }
}

/// What the serving build can answer; computed by `openobserve_core::alerts::rca_capabilities`.
/// A missing block, or a flag a reader does not know, means unknown, never unavailable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RcaCapabilities {
    /// `oss`, `enterprise` or `cloud`.
    pub edition: String,
    /// `ListServiceDeploys` / `CompareServiceVersions` return data, not the OSS stub.
    #[serde(default)]
    pub service_versions: bool,
    /// `CorrelateServiceStreams` returns data, not the OSS 403.
    #[serde(default)]
    pub service_streams: bool,
    #[serde(default)]
    pub incident_events: bool,
    #[serde(default)]
    pub service_graph_edge_trend: bool,
    /// `O2_SUPER_CLUSTER_ENABLED`: fan-out reads cannot prove absence in other regions.
    #[serde(default)]
    pub super_cluster: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serving_region: Option<String>,
}

impl RcaCapabilities {
    /// The OSS build: no enterprise reads, no super cluster, region `local`.
    pub fn oss() -> Self {
        Self {
            edition: "oss".to_string(),
            serving_region: Some(LOCAL_SERVING_REGION.to_string()),
            ..Default::default()
        }
    }
}

/// The engine's findings for the issue behind an incident; the model starts from them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceBundle {
    pub version: u32,
    pub issue: String,
    /// At most [MAX_BUNDLE_ITEMS].
    pub items: Vec<BundleItem>,
    /// At most [MAX_OFFERED_ACTIONS]; the model may name only these.
    pub actions: Vec<OfferedAction>,
    pub not_checked: Vec<String>,
    pub settled: bool,
}

/// Ids are `B1`, `B2`, ... so they never read as the ledger's `e3` evidence ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BundleItem {
    pub id: String,
    pub role: BundleRole,
    pub text: String,
    /// Microseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BundleRole {
    Cause,
    Impact,
}

/// A link or reviewed insight the step may point at; `from` names the items that offer it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferedAction {
    pub id: String,
    pub label: String,
    pub target: String,
    pub from: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(subject_type: SubjectType, incident_id: Option<String>) -> RcaContext {
        RcaContext {
            incident_id,
            ..RcaContext::new(subject_type, "al_ckt#1".to_string(), "default".to_string())
        }
    }

    /// Pins the exact wire shape: an alert subject omits the key entirely,
    /// never sends it as `null`.
    #[test]
    fn test_incident_id_present_for_incident_absent_for_alert() {
        let incident = base(SubjectType::Incident, Some("inc_1".to_string()));
        let json = serde_json::to_value(&incident).unwrap();
        assert_eq!(json["incident_id"], serde_json::json!("inc_1"));

        let alert = base(SubjectType::Alert, None);
        let json = serde_json::to_value(&alert).unwrap();
        assert!(
            !json.as_object().unwrap().contains_key("incident_id"),
            "an alert subject must omit incident_id, not null it: {json}"
        );
    }

    #[test]
    fn test_past_causes_omitted_when_empty_present_when_not() {
        let empty = base(SubjectType::Alert, None);
        let json = serde_json::to_value(&empty).unwrap();
        assert!(!json.as_object().unwrap().contains_key("past_causes"));

        let mut with_causes = base(SubjectType::Alert, None);
        with_causes.past_causes = vec!["2x timeout".to_string()];
        let json = serde_json::to_value(&with_causes).unwrap();
        assert_eq!(json["past_causes"], serde_json::json!(["2x timeout"]));
    }

    /// I2: the alert-only keys are additive. An unchanged `o2-ai` reads the
    /// keys it knows and never sees the rest, so they must be absent — not
    /// null — when there is nothing to say.
    #[test]
    fn test_the_alert_keys_are_sent_when_set_and_omitted_when_not() {
        let bare = base(SubjectType::Alert, None);
        let json = serde_json::to_value(&bare).unwrap();
        let keys = json.as_object().unwrap();
        for key in ["alert_name", "stream", "dimensions", "severity", "evidence"] {
            assert!(
                !keys.contains_key(key),
                "{key} must be omitted, not null: {json}"
            );
        }

        let mut full = base(SubjectType::Alert, None);
        full.alert_name = Some("payment-api high error rate".to_string());
        full.stream = Some("payment_api_errors".to_string());
        full.dimensions = Some(serde_json::json!({ "service": "payments" }));
        full.severity = Some(crate::meta::alerts::priority::AlertPriority::P2);
        let json = serde_json::to_value(&full).unwrap();
        assert_eq!(
            json["alert_name"],
            serde_json::json!("payment-api high error rate")
        );
        assert_eq!(json["stream"], serde_json::json!("payment_api_errors"));
        assert_eq!(
            json["dimensions"],
            serde_json::json!({ "service": "payments" })
        );
        // A bare int, not "P2" — `format_severity` in `o2-ai` renders the scale.
        assert_eq!(json["severity"], serde_json::json!(2));

        full.evidence = Some(EvidenceBundle {
            version: 1,
            issue: "Logs stream k8s-prod stopped".to_string(),
            items: vec![BundleItem {
                id: "B1".to_string(),
                role: BundleRole::Cause,
                text: "Pipeline mask-pii started failing".to_string(),
                at: Some(1_700_000_000_000_000),
                grade: None,
            }],
            actions: vec![OfferedAction {
                id: "A1".to_string(),
                label: "Open pipeline".to_string(),
                target: "/pipelines/mask-pii".to_string(),
                from: vec!["B1".to_string()],
            }],
            not_checked: Vec::new(),
            settled: false,
        });
        let json = serde_json::to_value(&full).unwrap();
        assert_eq!(json["evidence"]["items"][0]["role"], "cause");
        assert!(
            !json["evidence"]["items"][0]
                .as_object()
                .unwrap()
                .contains_key("grade")
        );
        assert_eq!(
            json["evidence"]["actions"][0]["from"],
            serde_json::json!(["B1"])
        );
    }

    #[test]
    fn the_v2_keys_are_omitted_when_unset_and_exact_when_set() {
        let bare = base(SubjectType::Incident, Some("inc_1".to_string()));
        let json = serde_json::to_value(&bare).unwrap();
        for key in [
            "first_alert_at_us",
            "window_start_us",
            "fired_at_us",
            "affected_services",
            "history_reads_allowed",
            "serving_region",
            "capabilities",
        ] {
            assert!(
                !json.as_object().unwrap().contains_key(key),
                "{key}: {json}"
            );
        }

        let mut full = base(SubjectType::Alert, None).with_first_alert(10 * RCA_WINDOW_LEAD_US);
        full.fired_at_us = Some(10 * RCA_WINDOW_LEAD_US);
        full.affected_services = vec!["payments".to_string()];
        full.history_reads_allowed = Some(false);
        full.serving_region = Some("us-east-1".to_string());
        full.capabilities = Some(RcaCapabilities::oss());
        let json = serde_json::to_value(&full).unwrap();
        assert_eq!(json["first_alert_at_us"], 36_000_000_000_i64);
        assert_eq!(json["window_start_us"], 32_400_000_000_i64);
        assert_eq!(json["fired_at_us"], 36_000_000_000_i64);
        assert_eq!(json["affected_services"], serde_json::json!(["payments"]));
        assert_eq!(json["history_reads_allowed"], false);
        assert_eq!(json["serving_region"], "us-east-1");
        assert_eq!(
            json["capabilities"],
            serde_json::json!({
                "edition": "oss",
                "service_versions": false,
                "service_streams": false,
                "incident_events": false,
                "service_graph_edge_trend": false,
                "super_cluster": false,
                "serving_region": "local"
            })
        );
        let back: RcaContext = serde_json::from_value(json).unwrap();
        assert_eq!(back.window_start_us, Some(32_400_000_000));
    }

    #[test]
    fn an_older_producers_context_still_decodes() {
        let old = serde_json::json!({
            "subject_type": "incident",
            "subject_id": "inc_1",
            "org_id": "default"
        });
        let ctx: RcaContext = serde_json::from_value(old).unwrap();
        assert_eq!(ctx.history_reads_allowed, None);
        assert!(ctx.capabilities.is_none());
        assert!(ctx.affected_services.is_empty());
    }

    #[test]
    fn the_window_never_starts_before_the_epoch() {
        let ctx = base(SubjectType::Alert, None).with_first_alert(5);
        assert_eq!(ctx.window_start_us, Some(0));
    }
}
