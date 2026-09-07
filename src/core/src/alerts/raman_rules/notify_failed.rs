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

//! Recurring notification delivery failures: the destination is broken.

use std::time::Duration;

use super::{
    context::{AlertFacts, AnalysisContext, TimeRange},
    finding::{
        Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity,
        SkipReason,
    },
    gate,
};

pub const RULE_ID: &str = "notify_failed";

const DEFAULT_MIN_OCCURRENCES: u64 = 3;
const DEFAULT_MIN_RATIO: f64 = 0.05;
const DEFAULT_MIN_HISTORY_HOURS: i64 = 24;
const DEFAULT_MIN_SAMPLES: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct NotifyFailedThresholds {
    pub min_occurrences: u64,
    pub min_ratio: f64,
    pub min_history_hours: i64,
    pub min_samples: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NotifyFailedRule {
    pub thresholds: NotifyFailedThresholds,
}

impl Default for NotifyFailedThresholds {
    fn default() -> Self {
        Self {
            min_occurrences: DEFAULT_MIN_OCCURRENCES,
            min_ratio: DEFAULT_MIN_RATIO,
            min_history_hours: DEFAULT_MIN_HISTORY_HOURS,
            min_samples: DEFAULT_MIN_SAMPLES,
        }
    }
}

impl NotifyFailedRule {
    pub fn new(thresholds: NotifyFailedThresholds) -> Self {
        Self { thresholds }
    }

    fn judge(&self, facts: &AlertFacts, window: TimeRange) -> Option<Finding> {
        if facts.notification_failures < self.thresholds.min_occurrences {
            return None;
        }
        let failure_ratio = facts.notification_failure_ratio();
        if failure_ratio < self.thresholds.min_ratio {
            return None;
        }
        Some(Finding {
            rule_id: RULE_ID.to_string(),
            severity: Severity::High,
            confidence: Confidence::High,
            title: notify_failed_title(facts),
            subjects: vec![facts.alert.clone()],
            evidence: Evidence::NotifyFailed {
                notification_failures: facts.notification_failures,
                notification_attempts: facts.notification_attempts,
                failure_ratio,
            },
            window,
            actions: vec![ProposedAction::RepairDestination],
        })
    }
}

impl HygieneRule for NotifyFailedRule {
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

    /// More failures than attempts means the two counters came from different reads.
    fn unmeasurable(&self, facts: &AlertFacts) -> Option<SkipReason> {
        (facts.notification_failures > facts.notification_attempts).then(|| {
            SkipReason::UnmeasurableSignal {
                signal: "notification_attempts".to_string(),
            }
        })
    }
}

fn notify_failed_title(facts: &AlertFacts) -> String {
    format!(
        "{} failed to deliver {} of {} notifications",
        facts.alert.alert_name, facts.notification_failures, facts.notification_attempts
    )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, TimeRange},
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
    };

    const WINDOW_SECS: i64 = 72 * 3600;
    const HISTORY_SECS: i64 = 48 * 3600;

    /// Two destinations per firing, so an attempt count can never pass for a firing count.
    fn undelivered_alert() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a5", "checkout error rate"),
            enabled: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 1008,
            evaluations: 2016,
            firings: 100,
            destination_count: 2,
            notification_attempts: 200,
            notification_failures: 40,
            ..Default::default()
        }
    }

    fn context_of(facts: AlertFacts) -> AnalysisContext {
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts])
    }

    #[test]
    fn an_alert_whose_notifications_keep_bouncing_is_reported_as_undelivered() {
        let ctx = context_of(undelivered_alert());
        let outcome = NotifyFailedRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, RULE_ID);
        assert_eq!(finding.severity, Severity::High);
        assert_eq!(finding.confidence, Confidence::High);
        assert_eq!(
            finding.title,
            "checkout error rate failed to deliver 40 of 200 notifications"
        );
        assert_eq!(
            finding.subjects,
            vec![AlertRef::new("default", "a5", "checkout error rate")]
        );
        assert_eq!(
            finding.evidence,
            Evidence::NotifyFailed {
                notification_failures: 40,
                notification_attempts: 200,
                failure_ratio: 0.2,
            }
        );
        assert_eq!(finding.window, ctx.window);
        assert_eq!(finding.actions, vec![ProposedAction::RepairDestination]);
    }

    #[test]
    fn each_qualifying_alert_gets_its_own_finding_rather_than_one_rollup() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a6", "cart abandonment"),
            ..undelivered_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![undelivered_alert(), second],
        );
        let outcome = NotifyFailedRule::default().evaluate(&ctx);
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
        assert_eq!(named, BTreeSet::from(["a5", "a6"]));
    }

    #[test]
    fn an_alert_at_exactly_the_minimum_occurrences_and_ratio_is_still_reported() {
        let facts = AlertFacts {
            firings: 30,
            notification_attempts: 60,
            notification_failures: 3,
            ..undelivered_alert()
        };
        assert_eq!(
            NotifyFailedRule::default()
                .evaluate(&context_of(facts))
                .findings
                .len(),
            1
        );
    }

    #[test]
    fn an_alert_one_delivery_failure_below_the_minimum_is_not_reported() {
        let facts = AlertFacts {
            firings: 20,
            notification_attempts: 40,
            notification_failures: 2,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn an_alert_just_below_the_minimum_failure_ratio_is_not_reported() {
        let facts = AlertFacts {
            firings: 30,
            notification_attempts: 61,
            notification_failures: 3,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_disabled_alert_is_never_reported_as_undelivered() {
        let facts = AlertFacts {
            enabled: false,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
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
    fn more_failures_than_attempts_is_reported_as_unmeasurable() {
        let facts = AlertFacts {
            notification_attempts: 200,
            notification_failures: 250,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "notification_attempts".to_string()
            }]
        );
    }

    /// The floor is on retained records, so plentiful evaluations do not satisfy it.
    #[test]
    fn too_few_samples_skips_the_notify_failed_rule_and_says_so() {
        let facts = AlertFacts {
            sample_count: 40,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a5"),
            Some(&SkipReason::InsufficientSamples {
                required: 50,
                actual: 40
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_sample_count_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            sample_count: 50,
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn less_than_a_day_of_history_skips_the_notify_failed_rule_and_says_so() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(2 * 3600),
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skip_reason_for("default", "a5"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 24 * 3600,
                actual_secs: 2 * 3600
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_history_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(24 * 3600),
            ..undelivered_alert()
        };
        let outcome = NotifyFailedRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn demanding_more_occurrences_stops_a_bouncing_destination_being_reported() {
        let facts = undelivered_alert();
        let strict = NotifyFailedRule::new(NotifyFailedThresholds {
            min_occurrences: 100,
            ..Default::default()
        });
        assert_eq!(
            NotifyFailedRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    /// The occurrence count still clears its default gate, so only the ratio can decide.
    #[test]
    fn demanding_a_higher_failure_ratio_stops_a_bouncing_destination_being_reported() {
        let facts = undelivered_alert();
        let strict = NotifyFailedRule::new(NotifyFailedThresholds {
            min_ratio: 0.5,
            ..Default::default()
        });
        assert_eq!(
            NotifyFailedRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    #[test]
    fn a_raised_sample_floor_skips_an_alert_the_default_floor_judges() {
        let facts = undelivered_alert();
        let strict = NotifyFailedRule::new(NotifyFailedThresholds {
            min_samples: 2_000,
            ..Default::default()
        });
        assert_eq!(
            NotifyFailedRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a5"),
            Some(&SkipReason::InsufficientSamples {
                required: 2_000,
                actual: 1008
            })
        );
    }

    #[test]
    fn a_raised_history_floor_skips_an_alert_the_default_floor_judges() {
        let facts = undelivered_alert();
        let strict = NotifyFailedRule::new(NotifyFailedThresholds {
            min_history_hours: 72,
            ..Default::default()
        });
        assert_eq!(
            NotifyFailedRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a5"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 72 * 3600,
                actual_secs: HISTORY_SECS
            })
        );
    }

    #[test]
    fn the_notify_failed_rule_reports_its_own_history_and_sample_requirements() {
        let rule = NotifyFailedRule::default();
        assert_eq!(rule.rule_id(), "notify_failed");
        assert_eq!(rule.min_history(), Duration::from_secs(24 * 3600));
        assert_eq!(rule.min_samples(), 50);
    }

    #[test]
    fn an_absurd_history_threshold_saturates_rather_than_overflowing() {
        let rule = NotifyFailedRule::new(NotifyFailedThresholds {
            min_history_hours: i64::MAX,
            ..Default::default()
        });
        assert_eq!(rule.min_history(), Duration::from_secs(u64::MAX));
    }
}
