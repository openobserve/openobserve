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
use crate::meta::alerts::{priority::AlertPriority, what_changed::WhatChanged};

pub const MAX_BUNDLE_ITEMS: usize = 12;
pub const MAX_OFFERED_ACTIONS: usize = 6;
pub const MAX_DECLARED_QUERY_BYTES: usize = 8 * 1024;
pub const LOCAL_SERVING_REGION: &str = "local";
const CONTEXT_LEAD_US: i64 = 2 * 60 * 60 * 1_000_000;

/// Unset fields must be omitted because the agent routes on key presence.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub impact_start_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_start_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_alert_at_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fired_at_us: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected_services: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_reads_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<RcaCapabilities>,
    #[serde(default, skip_serializing_if = "recent_changes_are_empty")]
    pub recent_changes: Option<WhatChanged>,
    #[serde(
        default,
        skip_serializing_if = "texts_are_empty",
        serialize_with = "serialize_texts"
    )]
    pub similar_causes: Vec<String>,
    #[serde(default, skip_serializing_if = "declared_context_is_empty")]
    pub declared_context: Option<DeclaredContext>,
}

impl RcaContext {
    pub fn new(
        subject_type: SubjectType,
        subject_id: impl Into<String>,
        org_id: impl Into<String>,
    ) -> Self {
        let subject_id = subject_id.into();
        Self {
            subject_type,
            incident_id: (subject_type == SubjectType::Incident).then(|| subject_id.clone()),
            subject_id,
            org_id: org_id.into(),
            previous_analysis: None,
            severity: None,
            past_causes: Vec::new(),
            alert_name: None,
            stream: None,
            dimensions: None,
            evidence: None,
            impact_start_at: None,
            window_start_us: None,
            first_alert_at_us: None,
            fired_at_us: None,
            affected_services: Vec::new(),
            history_reads_allowed: None,
            capabilities: None,
            recent_changes: None,
            similar_causes: Vec::new(),
            declared_context: None,
        }
    }

    pub fn with_window(mut self, impact_start_at: i64) -> Self {
        self.impact_start_at = Some(impact_start_at);
        self.window_start_us = Some(impact_start_at.saturating_sub(CONTEXT_LEAD_US));
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RcaCapabilities {
    pub edition: RcaEdition,
    #[serde(default)]
    pub service_versions: bool,
    #[serde(default)]
    pub service_streams: bool,
    #[serde(default)]
    pub incident_events: bool,
    #[serde(default)]
    pub service_graph_edge_trend: bool,
    #[serde(default)]
    pub super_cluster: bool,
    #[serde(default, skip_serializing_if = "optional_text_is_empty")]
    pub serving_region: Option<String>,
}

impl RcaCapabilities {
    pub fn oss() -> Self {
        Self {
            edition: RcaEdition::Oss,
            service_versions: false,
            service_streams: false,
            incident_events: false,
            service_graph_edge_trend: false,
            super_cluster: false,
            serving_region: Some(LOCAL_SERVING_REGION.to_string()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RcaEdition {
    Oss,
    Enterprise,
    Cloud,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DeclaredContext {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub kind: String,
    #[serde(
        skip_serializing_if = "String::is_empty",
        serialize_with = "serialize_declared_query",
        deserialize_with = "deserialize_declared_query"
    )]
    pub query: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub streams: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window: Option<DeclaredContextWindow>,
    #[serde(skip_serializing_if = "optional_text_is_empty")]
    pub result_summary: Option<String>,
}

impl DeclaredContext {
    pub fn is_empty(&self) -> bool {
        self.kind.is_empty()
            && self.query.is_empty()
            && self.streams.is_empty()
            && self.window.is_none()
            && optional_text_is_empty(&self.result_summary)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeclaredContextWindow {
    pub start_us: i64,
    pub end_us: i64,
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

fn recent_changes_are_empty(changes: &Option<WhatChanged>) -> bool {
    changes.as_ref().is_none_or(WhatChanged::is_empty)
}

fn declared_context_is_empty(context: &Option<DeclaredContext>) -> bool {
    context.as_ref().is_none_or(DeclaredContext::is_empty)
}

fn optional_text_is_empty(text: &Option<String>) -> bool {
    text.as_ref().is_none_or(String::is_empty)
}

fn texts_are_empty(texts: &[String]) -> bool {
    texts.iter().all(|text| text.trim().is_empty())
}

fn serialize_texts<S: serde::Serializer>(
    texts: &[String],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let texts: Vec<_> = texts
        .iter()
        .filter(|text| !text.trim().is_empty())
        .collect();
    texts.serialize(serializer)
}

fn serialize_declared_query<S: serde::Serializer>(
    query: &str,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if query.len() > MAX_DECLARED_QUERY_BYTES {
        return Err(serde::ser::Error::custom("declared query exceeds 8 KiB"));
    }
    serializer.serialize_str(query)
}

fn deserialize_declared_query<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<String, D::Error> {
    let query = String::deserialize(deserializer)?;
    if query.len() > MAX_DECLARED_QUERY_BYTES {
        return Err(serde::de::Error::custom("declared query exceeds 8 KiB"));
    }
    Ok(query)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rca_context_json_keeps_the_legacy_bytes_when_new_fields_are_empty() {
        let context = RcaContext::new(SubjectType::Alert, "al_ckt#1", "default");
        assert_eq!(
            serde_json::to_string(&context).unwrap(),
            r#"{"subject_type":"alert","subject_id":"al_ckt#1","org_id":"default"}"#
        );
        assert_eq!(
            serde_json::to_string(&RcaContext::new(SubjectType::Incident, "inc_1", "default"))
                .unwrap(),
            r#"{"subject_type":"incident","subject_id":"inc_1","incident_id":"inc_1","org_id":"default"}"#
        );
        let mut empty = context;
        empty.recent_changes = Some(WhatChanged::default());
        empty.declared_context = Some(DeclaredContext::default());
        empty.similar_causes = vec![String::new(), "  ".into()];
        assert_eq!(
            serde_json::to_string(&empty).unwrap(),
            serde_json::to_string(&base(SubjectType::Alert, None)).unwrap()
        );
        let json = serde_json::to_value(empty).unwrap();
        for key in [
            "impact_start_at",
            "window_start_us",
            "first_alert_at_us",
            "fired_at_us",
            "affected_services",
            "history_reads_allowed",
            "capabilities",
            "recent_changes",
            "similar_causes",
            "declared_context",
        ] {
            assert!(json.get(key).is_none(), "{key}: {json}");
        }
    }

    #[test]
    fn rca_context_json_sends_each_new_field_when_set_and_never_null() {
        let mut context = RcaContext::new(SubjectType::Incident, "inc_1", "default")
            .with_window(14 * 3_600_000_000);
        context.first_alert_at_us = Some(14 * 3_600_000_000);
        context.fired_at_us = Some(14 * 3_600_000_000);
        context.affected_services = vec!["checkout".into()];
        context.history_reads_allowed = Some(false);
        context.capabilities = Some(RcaCapabilities::oss());
        context.recent_changes = Some(WhatChanged {
            coverage: crate::meta::alerts::what_changed::ChangeCoverage {
                change_events: true,
                ..Default::default()
            },
            ..Default::default()
        });
        context.similar_causes = vec!["reviewed cause".into()];
        context.declared_context = Some(DeclaredContext {
            kind: "logs".into(),
            query: "select * from app".into(),
            streams: vec!["app".into()],
            window: Some(DeclaredContextWindow {
                start_us: 1,
                end_us: 2,
            }),
            result_summary: Some("3 errors".into()),
        });
        let json = serde_json::to_value(&context).unwrap();
        for key in [
            "impact_start_at",
            "window_start_us",
            "first_alert_at_us",
            "fired_at_us",
            "affected_services",
            "history_reads_allowed",
            "capabilities",
            "recent_changes",
            "similar_causes",
            "declared_context",
        ] {
            assert!(!json[key].is_null(), "{key}: {json}");
        }
        assert_eq!(json["history_reads_allowed"], false);
        assert_eq!(
            json["declared_context"]["window"],
            serde_json::json!({"start_us": 1, "end_us": 2})
        );
        assert!(json.get("serving_region").is_none());
    }

    #[test]
    fn impact_and_alert_windows_start_two_hours_before_their_subject() {
        let onset = 14 * 3_600_000_000;
        let incident =
            RcaContext::new(SubjectType::Incident, "inc_1", "default").with_window(onset);
        assert_eq!(incident.impact_start_at, Some(onset));
        assert_eq!(incident.window_start_us, Some(12 * 3_600_000_000));
        let alert = RcaContext::new(SubjectType::Alert, "al_1#1", "default").with_window(onset);
        assert_eq!(alert.window_start_us, incident.window_start_us);
    }

    #[test]
    fn declared_query_is_limited_to_eight_kibibytes() {
        let mut declared = DeclaredContext {
            query: "x".repeat(MAX_DECLARED_QUERY_BYTES),
            ..Default::default()
        };
        assert!(serde_json::to_value(&declared).is_ok());
        declared.query.push('x');
        assert!(serde_json::to_value(&declared).is_err());
        let json = serde_json::json!({"query": "x".repeat(MAX_DECLARED_QUERY_BYTES + 1)});
        assert!(serde_json::from_value::<DeclaredContext>(json).is_err());
    }

    #[test]
    fn oss_capabilities_name_the_available_reads() {
        let json = serde_json::to_value(RcaCapabilities::oss()).unwrap();
        assert_eq!(json["edition"], "oss");
        assert_eq!(json["service_versions"], false);
        assert_eq!(json["service_streams"], false);
        assert_eq!(json["incident_events"], false);
        assert_eq!(json["service_graph_edge_trend"], false);
        assert_eq!(json["super_cluster"], false);
        assert_eq!(json["serving_region"], "local");
    }

    fn base(subject_type: SubjectType, incident_id: Option<String>) -> RcaContext {
        let mut context = RcaContext::new(subject_type, "al_ckt#1", "default");
        context.incident_id = incident_id;
        context
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
}
