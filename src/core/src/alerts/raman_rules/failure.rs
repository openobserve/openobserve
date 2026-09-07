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

//! Repeated evaluation errors clustered by normalised message.

use std::time::Duration;

use super::{
    context::{AlertFacts, AnalysisContext, TimeRange},
    finding::{
        Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity,
        SkipReason,
    },
    gate,
};

pub const RULE_ID: &str = "failure";

const DEFAULT_MIN_ERRORS: u64 = 5;
const DEFAULT_MIN_ERROR_RATIO: f64 = 0.10;
const DEFAULT_MIN_HISTORY_HOURS: i64 = 24;
const DEFAULT_MIN_SAMPLES: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct FailureThresholds {
    pub min_errors: u64,
    pub min_error_ratio: f64,
    pub min_history_hours: i64,
    pub min_samples: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FailureRule {
    pub thresholds: FailureThresholds,
}

impl Default for FailureThresholds {
    fn default() -> Self {
        Self {
            min_errors: DEFAULT_MIN_ERRORS,
            min_error_ratio: DEFAULT_MIN_ERROR_RATIO,
            min_history_hours: DEFAULT_MIN_HISTORY_HOURS,
            min_samples: DEFAULT_MIN_SAMPLES,
        }
    }
}

impl FailureRule {
    pub fn new(thresholds: FailureThresholds) -> Self {
        Self { thresholds }
    }

    fn judge(&self, facts: &AlertFacts, window: TimeRange) -> Option<Finding> {
        if facts.evaluation_errors < self.thresholds.min_errors {
            return None;
        }
        let error_ratio = facts.error_ratio();
        if error_ratio < self.thresholds.min_error_ratio {
            return None;
        }
        let top = facts.top_error_cluster();
        Some(Finding {
            rule_id: RULE_ID.to_string(),
            severity: Severity::High,
            confidence: Confidence::High,
            title: failure_title(facts, top.map(|c| c.normalised_message.as_str())),
            subjects: vec![facts.alert.clone()],
            evidence: Evidence::Failure {
                evaluation_errors: facts.evaluation_errors,
                evaluations: facts.evaluations,
                error_ratio,
                top_error: top.map_or_else(String::new, |c| c.normalised_message.clone()),
                top_error_count: top.map_or(0, |c| c.count),
            },
            window,
            actions: vec![ProposedAction::FixAlertQuery],
        })
    }
}

impl HygieneRule for FailureRule {
    fn rule_id(&self) -> &'static str {
        RULE_ID
    }

    fn evaluate(&self, ctx: &AnalysisContext) -> RuleOutcome {
        let window = ctx.window;
        gate::judge_each(self, ctx, |facts| self.judge(facts, window))
    }

    fn min_history(&self) -> Duration {
        Duration::from_secs((self.thresholds.min_history_hours.max(0) as u64).saturating_mul(3600))
    }

    fn min_samples(&self) -> usize {
        self.thresholds.min_samples
    }

    /// Counters that contradict each other cannot support a high-confidence finding.
    fn unmeasurable(&self, facts: &AlertFacts) -> Option<SkipReason> {
        let inconsistent = facts.evaluation_errors > facts.evaluations
            || facts
                .top_error_cluster()
                .is_some_and(|c| c.count > facts.evaluation_errors);
        inconsistent.then(|| SkipReason::UnmeasurableSignal {
            signal: "evaluation_errors".to_string(),
        })
    }
}

/// Errors can outlive their clusters, so the dominant message is not always known.
fn failure_title(facts: &AlertFacts, top_error: Option<&str>) -> String {
    let counted = format!(
        "{} failed {} of {} evaluations",
        facts.alert.alert_name, facts.evaluation_errors, facts.evaluations
    );
    match top_error {
        Some(message) => format!("{counted}: {message}"),
        None => counted,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, ErrorCluster, TimeRange},
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
    };

    const WINDOW_SECS: i64 = 72 * 3600;
    const HISTORY_SECS: i64 = 48 * 3600;

    fn broken_query_alert() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a3", "payment failures"),
            enabled: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 75,
            evaluations: 100,
            evaluation_errors: 30,
            error_clusters: vec![
                ErrorCluster::new("stream not found", 25),
                ErrorCluster::new("permission denied", 5),
            ],
            destination_count: 1,
            ..Default::default()
        }
    }

    fn context_of(facts: AlertFacts) -> AnalysisContext {
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts])
    }

    #[test]
    fn an_alert_whose_query_keeps_erroring_is_reported_with_its_dominant_error() {
        let ctx = context_of(broken_query_alert());
        let outcome = FailureRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, RULE_ID);
        assert_eq!(finding.severity, Severity::High);
        assert_eq!(finding.confidence, Confidence::High);
        assert_eq!(
            finding.title,
            "payment failures failed 30 of 100 evaluations: stream not found"
        );
        assert_eq!(
            finding.subjects,
            vec![AlertRef::new("default", "a3", "payment failures")]
        );
        assert_eq!(
            finding.evidence,
            Evidence::Failure {
                evaluation_errors: 30,
                evaluations: 100,
                error_ratio: 0.3,
                top_error: "stream not found".to_string(),
                top_error_count: 25,
            }
        );
        assert_eq!(finding.window, ctx.window);
        assert_eq!(finding.actions, vec![ProposedAction::FixAlertQuery]);
    }

    #[test]
    fn each_qualifying_alert_gets_its_own_finding_rather_than_one_rollup() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a4", "refund latency"),
            ..broken_query_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![broken_query_alert(), second],
        );
        let outcome = FailureRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 2);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 2);
        for finding in &outcome.findings {
            assert_eq!(finding.subjects.len(), 1);
        }
        let named: BTreeSet<&str> = outcome
            .findings
            .iter()
            .map(|f| f.subjects[0].alert_id.as_str())
            .collect();
        assert_eq!(named, BTreeSet::from(["a3", "a4"]));
    }

    #[test]
    fn an_alert_at_exactly_the_minimum_error_count_and_ratio_is_still_reported() {
        let facts = AlertFacts {
            evaluations: 50,
            evaluation_errors: 5,
            error_clusters: vec![ErrorCluster::new("stream not found", 5)],
            ..broken_query_alert()
        };
        assert_eq!(
            FailureRule::default()
                .evaluate(&context_of(facts))
                .findings
                .len(),
            1
        );
    }

    /// The ratio gate is relaxed so this isolates the error count on its own.
    #[test]
    fn an_alert_one_error_below_the_minimum_count_is_not_reported() {
        let facts = AlertFacts {
            evaluations: 50,
            evaluation_errors: 4,
            error_clusters: vec![ErrorCluster::new("stream not found", 4)],
            ..broken_query_alert()
        };
        let any_ratio = FailureRule::new(FailureThresholds {
            min_error_ratio: 0.0,
            ..Default::default()
        });
        let outcome = any_ratio.evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn an_alert_just_below_the_minimum_error_ratio_is_not_reported() {
        let facts = AlertFacts {
            evaluations: 51,
            evaluation_errors: 5,
            error_clusters: vec![ErrorCluster::new("stream not found", 5)],
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_disabled_alert_is_never_reported_as_failing() {
        let facts = AlertFacts {
            enabled: false,
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::AlertDisabled]
        );
        assert!(outcome.findings.is_empty());
    }

    /// Contradictory counters came from separate reads, so no high-confidence
    /// finding may rest on them.
    #[test]
    fn more_errors_than_evaluations_is_reported_as_unmeasurable() {
        let facts = AlertFacts {
            evaluation_errors: 120,
            error_clusters: vec![ErrorCluster::new("stream not found", 120)],
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "evaluation_errors".to_string()
            }]
        );
    }

    /// Errors can outlive their clusters, so an unclustered failure still reports.
    #[test]
    fn errors_with_no_cluster_are_reported_with_an_empty_top_error() {
        let facts = AlertFacts {
            error_clusters: vec![],
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.findings.len(), 1);
        assert_eq!(
            outcome.findings[0].title,
            "payment failures failed 30 of 100 evaluations"
        );
        assert_eq!(
            outcome.findings[0].evidence,
            Evidence::Failure {
                evaluation_errors: 30,
                evaluations: 100,
                error_ratio: 0.3,
                top_error: String::new(),
                top_error_count: 0,
            }
        );
    }

    /// The floor is on retained records, so plentiful evaluations do not satisfy it.
    #[test]
    fn too_few_samples_skips_the_failure_rule_and_says_so() {
        let facts = AlertFacts {
            sample_count: 9,
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a3"),
            Some(&SkipReason::InsufficientSamples {
                required: 50,
                actual: 9
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_sample_count_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            sample_count: 50,
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn less_than_a_day_of_history_skips_the_failure_rule_and_says_so() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(6 * 3600),
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skip_reason_for("default", "a3"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 24 * 3600,
                actual_secs: 6 * 3600
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_history_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(24 * 3600),
            ..broken_query_alert()
        };
        let outcome = FailureRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn demanding_a_higher_error_ratio_stops_a_flaky_alert_being_reported() {
        let facts = broken_query_alert();
        let strict = FailureRule::new(FailureThresholds {
            min_error_ratio: 0.5,
            ..Default::default()
        });
        assert_eq!(
            FailureRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    /// The ratio still clears its default gate, so only the error count can decide.
    #[test]
    fn demanding_more_errors_stops_a_flaky_alert_being_reported() {
        let facts = broken_query_alert();
        let strict = FailureRule::new(FailureThresholds {
            min_errors: 50,
            ..Default::default()
        });
        assert_eq!(
            FailureRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    #[test]
    fn a_raised_sample_floor_skips_an_alert_the_default_floor_judges() {
        let facts = broken_query_alert();
        let strict = FailureRule::new(FailureThresholds {
            min_samples: 200,
            ..Default::default()
        });
        assert_eq!(
            FailureRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a3"),
            Some(&SkipReason::InsufficientSamples {
                required: 200,
                actual: 75
            })
        );
    }

    #[test]
    fn a_raised_history_floor_skips_an_alert_the_default_floor_judges() {
        let facts = broken_query_alert();
        let strict = FailureRule::new(FailureThresholds {
            min_history_hours: 72,
            ..Default::default()
        });
        assert_eq!(
            FailureRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a3"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 72 * 3600,
                actual_secs: HISTORY_SECS
            })
        );
    }

    #[test]
    fn the_failure_rule_reports_its_own_history_and_sample_requirements() {
        let rule = FailureRule::default();
        assert_eq!(rule.rule_id(), "failure");
        assert_eq!(rule.min_history(), Duration::from_secs(24 * 3600));
        assert_eq!(rule.min_samples(), 50);
    }

    #[test]
    fn an_absurd_history_threshold_saturates_rather_than_overflowing() {
        let rule = FailureRule::new(FailureThresholds {
            min_history_hours: i64::MAX,
            ..Default::default()
        });
        assert_eq!(rule.min_history(), Duration::from_secs(u64::MAX));
    }
}
