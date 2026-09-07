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

//! The rule contract: what a rule may emit, and how it explains staying silent.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::context::{AlertFacts, AlertRef, AnalysisContext, TimeRange};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
pub enum Confidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
pub enum ProposedAction {
    RaiseThreshold,
    LengthenEvaluationWindow,
    EnableDeduplication,
    ReviewForDeletion,
    FixAlertQuery,
    RepairDestination,
    AttachDestination,
}

/// The numbers behind a finding, one shape per rule so tests assert them exactly.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub enum Evidence {
    Noise {
        firings: u64,
        mean_time_to_normal_secs: f64,
        incident_linkage_ratio: f64,
    },
    Silent {
        evaluations: u64,
        firings: u64,
        history_secs: i64,
    },
    Failure {
        evaluation_errors: u64,
        evaluations: u64,
        error_ratio: f64,
        top_error: String,
        top_error_count: u64,
    },
    NotifyFailed {
        notification_failures: u64,
        notification_attempts: u64,
        failure_ratio: f64,
    },
    NoDestination {
        firings: u64,
    },
}

/// Why a rule declined to judge one alert; silence always carries a reason.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub enum SkipReason {
    InsufficientHistory {
        required_secs: i64,
        actual_secs: i64,
    },
    InsufficientSamples {
        required: usize,
        actual: usize,
    },
    /// A signal the rule needs is absent or corrupt, so it judged nothing.
    UnmeasurableSignal {
        signal: String,
    },
    /// Hygiene judges live alerts; a disabled one is evidence of nothing.
    AlertDisabled,
    /// Floors are on the alert's lifetime, but every counter only covers the window.
    WindowTooShort {
        required_secs: i64,
        actual_secs: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Skip {
    pub rule_id: String,
    pub subject: AlertRef,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Finding {
    pub rule_id: String,
    pub severity: Severity,
    pub confidence: Confidence,
    pub title: String,
    pub subjects: Vec<AlertRef>,
    pub evidence: Evidence,
    pub window: TimeRange,
    pub actions: Vec<ProposedAction>,
}

/// A bare `Vec<Finding>` cannot say "judged one alert, skipped two", so this can.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct RuleOutcome {
    pub findings: Vec<Finding>,
    pub skips: Vec<Skip>,
    pub examined: usize,
}

pub trait HygieneRule {
    fn rule_id(&self) -> &'static str;
    fn evaluate(&self, ctx: &AnalysisContext) -> RuleOutcome;
    fn min_history(&self) -> Duration;
    fn min_samples(&self) -> usize;

    /// Absence of a signal the rule depends on is a skip, never a clearance.
    fn unmeasurable(&self, _facts: &AlertFacts) -> Option<SkipReason> {
        None
    }
}

impl Skip {
    pub fn new(rule_id: &str, subject: AlertRef, reason: SkipReason) -> Self {
        Self {
            rule_id: rule_id.to_string(),
            subject,
            reason,
        }
    }
}

impl RuleOutcome {
    pub fn has_no_findings(&self) -> bool {
        self.findings.is_empty()
    }

    pub fn skip_reason_for(&self, org_id: &str, alert_id: &str) -> Option<&SkipReason> {
        self.skips
            .iter()
            .find(|s| s.subject.org_id == org_id && s.subject.alert_id == alert_id)
            .map(|s| &s.reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pinned_finding() -> Finding {
        Finding {
            rule_id: "noise".to_string(),
            severity: Severity::Medium,
            confidence: Confidence::High,
            title: "t".to_string(),
            subjects: vec![AlertRef::new("default", "a1", "disk latency")],
            evidence: Evidence::Noise {
                firings: 400,
                mean_time_to_normal_secs: 45.0,
                incident_linkage_ratio: 0.0,
            },
            window: TimeRange::new(0, 1),
            actions: vec![ProposedAction::RaiseThreshold],
        }
    }

    #[test]
    fn an_outcome_with_no_findings_can_still_name_its_skip_reason() {
        let outcome = RuleOutcome {
            findings: vec![],
            skips: vec![Skip::new(
                "noise",
                AlertRef::new("default", "a1", "cpu high"),
                SkipReason::InsufficientSamples {
                    required: 50,
                    actual: 3,
                },
            )],
            examined: 0,
        };
        assert!(outcome.has_no_findings());
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientSamples {
                required: 50,
                actual: 3
            })
        );
        assert_eq!(outcome.skip_reason_for("default", "a2"), None);
    }

    /// Alert ids are only unique within an org, so a lookup on the id alone collides.
    #[test]
    fn a_skip_lookup_does_not_confuse_the_same_alert_id_in_two_orgs() {
        let outcome = RuleOutcome {
            findings: vec![],
            skips: vec![
                Skip::new(
                    "noise",
                    AlertRef::new("default", "a1", "cpu high"),
                    SkipReason::InsufficientSamples {
                        required: 50,
                        actual: 3,
                    },
                ),
                Skip::new(
                    "noise",
                    AlertRef::new("prod", "a1", "cpu high"),
                    SkipReason::InsufficientHistory {
                        required_secs: 3600,
                        actual_secs: 600,
                    },
                ),
            ],
            examined: 0,
        };
        assert_eq!(
            outcome.skip_reason_for("prod", "a1"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 3600,
                actual_secs: 600
            })
        );
        assert_eq!(outcome.skip_reason_for("staging", "a1"), None);
    }

    /// Findings are persisted, so a renamed variant orphans every stored digest.
    #[test]
    fn the_persisted_shape_of_a_finding_is_pinned() {
        assert_eq!(
            serde_json::to_string(&pinned_finding()).unwrap(),
            r#"{"rule_id":"noise","severity":"Medium","confidence":"High","title":"t","subjects":[{"org_id":"default","alert_id":"a1","alert_name":"disk latency"}],"evidence":{"Noise":{"firings":400,"mean_time_to_normal_secs":45.0,"incident_linkage_ratio":0.0}},"window":{"start_micros":0,"end_micros":1},"actions":["RaiseThreshold"]}"#
        );
    }

    /// Externally tagged, so every Rust identifier below is a stored wire key.
    #[test]
    fn the_persisted_shape_of_every_evidence_variant_is_pinned() {
        assert_eq!(
            serde_json::to_string(&Evidence::Noise {
                firings: 400,
                mean_time_to_normal_secs: 45.0,
                incident_linkage_ratio: 0.0,
            })
            .unwrap(),
            r#"{"Noise":{"firings":400,"mean_time_to_normal_secs":45.0,"incident_linkage_ratio":0.0}}"#
        );
        assert_eq!(
            serde_json::to_string(&Evidence::Silent {
                evaluations: 600,
                firings: 0,
                history_secs: 2_592_000,
            })
            .unwrap(),
            r#"{"Silent":{"evaluations":600,"firings":0,"history_secs":2592000}}"#
        );
        assert_eq!(
            serde_json::to_string(&Evidence::Failure {
                evaluation_errors: 30,
                evaluations: 100,
                error_ratio: 0.3,
                top_error: "stream not found".to_string(),
                top_error_count: 25,
            })
            .unwrap(),
            r#"{"Failure":{"evaluation_errors":30,"evaluations":100,"error_ratio":0.3,"top_error":"stream not found","top_error_count":25}}"#
        );
        assert_eq!(
            serde_json::to_string(&Evidence::NotifyFailed {
                notification_failures: 40,
                notification_attempts: 200,
                failure_ratio: 0.2,
            })
            .unwrap(),
            r#"{"NotifyFailed":{"notification_failures":40,"notification_attempts":200,"failure_ratio":0.2}}"#
        );
        assert_eq!(
            serde_json::to_string(&Evidence::NoDestination { firings: 5 }).unwrap(),
            r#"{"NoDestination":{"firings":5}}"#
        );
    }

    /// Skips are persisted alongside findings, so their keys are a wire surface too.
    #[test]
    fn the_persisted_shape_of_a_skip_and_both_reasons_is_pinned() {
        assert_eq!(
            serde_json::to_string(&Skip::new(
                "noise",
                AlertRef::new("default", "a1", "disk latency"),
                SkipReason::InsufficientSamples {
                    required: 50,
                    actual: 5,
                },
            ))
            .unwrap(),
            r#"{"rule_id":"noise","subject":{"org_id":"default","alert_id":"a1","alert_name":"disk latency"},"reason":{"InsufficientSamples":{"required":50,"actual":5}}}"#
        );
        assert_eq!(
            serde_json::to_string(&SkipReason::InsufficientHistory {
                required_secs: 604_800,
                actual_secs: 360_000,
            })
            .unwrap(),
            r#"{"InsufficientHistory":{"required_secs":604800,"actual_secs":360000}}"#
        );
    }

    /// A stored digest is ranked and filtered on these strings, not on the Rust names.
    #[test]
    fn the_persisted_shape_of_every_severity_and_confidence_is_pinned() {
        assert_eq!(serde_json::to_string(&Severity::Info).unwrap(), r#""Info""#);
        assert_eq!(serde_json::to_string(&Severity::Low).unwrap(), r#""Low""#);
        assert_eq!(
            serde_json::to_string(&Severity::Medium).unwrap(),
            r#""Medium""#
        );
        assert_eq!(serde_json::to_string(&Severity::High).unwrap(), r#""High""#);
        assert_eq!(serde_json::to_string(&Confidence::Low).unwrap(), r#""Low""#);
        assert_eq!(
            serde_json::to_string(&Confidence::Medium).unwrap(),
            r#""Medium""#
        );
        assert_eq!(
            serde_json::to_string(&Confidence::High).unwrap(),
            r#""High""#
        );
    }

    #[test]
    fn the_persisted_shape_of_every_proposed_action_is_pinned() {
        assert_eq!(
            serde_json::to_string(&[
                ProposedAction::RaiseThreshold,
                ProposedAction::LengthenEvaluationWindow,
                ProposedAction::EnableDeduplication,
                ProposedAction::ReviewForDeletion,
                ProposedAction::FixAlertQuery,
                ProposedAction::RepairDestination,
                ProposedAction::AttachDestination,
            ])
            .unwrap(),
            r#"["RaiseThreshold","LengthenEvaluationWindow","EnableDeduplication","ReviewForDeletion","FixAlertQuery","RepairDestination","AttachDestination"]"#
        );
    }

    /// Digests are written to a JSON column and read back, so decoding is half the contract.
    #[test]
    fn a_finding_survives_a_serialize_deserialize_serialize_round_trip() {
        let finding = pinned_finding();
        let encoded = serde_json::to_string(&finding).unwrap();
        let decoded: Finding = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, finding);
        assert_eq!(serde_json::to_string(&decoded).unwrap(), encoded);
    }

    #[test]
    fn a_skip_survives_a_serialize_deserialize_serialize_round_trip() {
        let skip = Skip::new(
            "silent",
            AlertRef::new("prod", "a7", "legacy queue depth"),
            SkipReason::InsufficientHistory {
                required_secs: 2_592_000,
                actual_secs: 388_800,
            },
        );
        let encoded = serde_json::to_string(&skip).unwrap();
        let decoded: Skip = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, skip);
        assert_eq!(serde_json::to_string(&decoded).unwrap(), encoded);
    }

    #[test]
    fn severity_and_confidence_order_from_low_to_high() {
        assert!(Severity::High > Severity::Info);
        assert!(Confidence::High > Confidence::Low);
    }
}
