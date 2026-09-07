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

//! Evaluated cleanly over a long baseline and never once fired.

use std::time::Duration;

use super::{
    context::{AlertFacts, AnalysisContext, TimeRange},
    finding::{Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity},
    gate,
};

pub const RULE_ID: &str = "silent";

const DEFAULT_MIN_EVALUATIONS: u64 = 500;
const DEFAULT_MAX_ERROR_RATIO: f64 = 0.10;
const DEFAULT_MIN_HISTORY_DAYS: i64 = 30;
const DEFAULT_MIN_SAMPLES: usize = 100;
const SECS_PER_DAY: i64 = 86_400;

#[derive(Debug, Clone, PartialEq)]
pub struct SilentThresholds {
    pub min_evaluations: u64,
    /// Above this the baseline is broken rather than quiet, and `failure` owns it.
    pub max_error_ratio: f64,
    pub min_history_days: i64,
    pub min_samples: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SilentRule {
    pub thresholds: SilentThresholds,
}

impl Default for SilentThresholds {
    fn default() -> Self {
        Self {
            min_evaluations: DEFAULT_MIN_EVALUATIONS,
            max_error_ratio: DEFAULT_MAX_ERROR_RATIO,
            min_history_days: DEFAULT_MIN_HISTORY_DAYS,
            min_samples: DEFAULT_MIN_SAMPLES,
        }
    }
}

impl SilentRule {
    pub fn new(thresholds: SilentThresholds) -> Self {
        Self { thresholds }
    }

    fn judge(&self, facts: &AlertFacts, window: TimeRange) -> Option<Finding> {
        if facts.firings > 0 || facts.evaluations < self.thresholds.min_evaluations {
            return None;
        }
        // "Never fired" over a broken baseline means it never ran, not that it is dead.
        if facts.error_ratio() >= self.thresholds.max_error_ratio {
            return None;
        }
        // Delivery activity means it is not dormant; `notify_failed` owns it instead.
        if facts.notification_attempts > 0 {
            return None;
        }
        Some(Finding {
            rule_id: RULE_ID.to_string(),
            severity: Severity::Low,
            confidence: Confidence::Medium,
            title: format!(
                "{} never fired across {} evaluations",
                facts.alert.alert_name, facts.evaluations
            ),
            subjects: vec![facts.alert.clone()],
            evidence: Evidence::Silent {
                evaluations: facts.evaluations,
                firings: facts.firings,
                history_secs: facts.history.span_secs(),
            },
            window,
            actions: vec![ProposedAction::ReviewForDeletion],
        })
    }
}

impl HygieneRule for SilentRule {
    fn rule_id(&self) -> &'static str {
        RULE_ID
    }

    fn evaluate(&self, ctx: &AnalysisContext) -> RuleOutcome {
        let window = ctx.window;
        gate::judge_each(self, ctx, |facts| self.judge(facts, window))
    }

    fn min_history(&self) -> Duration {
        Duration::from_secs(
            (self.thresholds.min_history_days.max(0) as u64).saturating_mul(SECS_PER_DAY as u64),
        )
    }

    fn min_samples(&self) -> usize {
        self.thresholds.min_samples
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, TimeRange},
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
    };

    const WINDOW_SECS: i64 = 60 * SECS_PER_DAY;
    const HISTORY_SECS: i64 = 45 * SECS_PER_DAY;

    fn never_fired_alert() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a7", "legacy queue depth"),
            enabled: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 300,
            evaluations: 600,
            firings: 0,
            destination_count: 1,
            ..Default::default()
        }
    }

    fn context_of(facts: AlertFacts) -> AnalysisContext {
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts])
    }

    /// Phase A seeds prebuilt alerts disabled, so calling them dead accuses ourselves.
    #[test]
    fn a_disabled_alert_is_never_reported_as_silent() {
        let facts = AlertFacts {
            enabled: false,
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::AlertDisabled]
        );
        assert!(
            outcome.has_no_findings(),
            "a disabled alert is not evaluated, so it cannot be dead"
        );
    }

    #[test]
    fn an_alert_evaluated_for_weeks_that_never_fired_is_reported_as_possibly_dead() {
        let ctx = context_of(never_fired_alert());
        let outcome = SilentRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, RULE_ID);
        assert_eq!(finding.severity, Severity::Low);
        assert_eq!(finding.confidence, Confidence::Medium);
        assert_eq!(
            finding.title,
            "legacy queue depth never fired across 600 evaluations"
        );
        assert_eq!(
            finding.subjects,
            vec![AlertRef::new("default", "a7", "legacy queue depth")]
        );
        assert_eq!(
            finding.evidence,
            Evidence::Silent {
                evaluations: 600,
                firings: 0,
                history_secs: HISTORY_SECS,
            }
        );
        assert_eq!(finding.window, ctx.window);
        assert_eq!(finding.actions, vec![ProposedAction::ReviewForDeletion]);
    }

    #[test]
    fn each_qualifying_alert_gets_its_own_finding_rather_than_one_rollup() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a8", "expired token sweep"),
            ..never_fired_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![never_fired_alert(), second],
        );
        let outcome = SilentRule::default().evaluate(&ctx);
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
        assert_eq!(named, BTreeSet::from(["a7", "a8"]));
    }

    /// The count threshold is on evaluations, which the retained record count undershoots.
    #[test]
    fn an_alert_at_exactly_the_minimum_evaluation_count_is_still_reported() {
        let facts = AlertFacts {
            evaluations: 500,
            ..never_fired_alert()
        };
        assert_eq!(
            SilentRule::default()
                .evaluate(&context_of(facts))
                .findings
                .len(),
            1
        );
    }

    #[test]
    fn an_alert_one_evaluation_below_the_minimum_is_not_reported() {
        let facts = AlertFacts {
            evaluations: 499,
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn an_alert_that_fired_even_once_is_not_silent() {
        let facts = AlertFacts {
            firings: 1,
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    /// The floor is on retained records, so plentiful evaluations do not satisfy it.
    #[test]
    fn too_few_samples_skips_the_silent_rule_and_says_so() {
        let facts = AlertFacts {
            sample_count: 12,
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a7"),
            Some(&SkipReason::InsufficientSamples {
                required: 100,
                actual: 12
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_sample_count_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            sample_count: 100,
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn less_than_thirty_days_of_history_skips_the_silent_rule_and_says_so() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(20 * SECS_PER_DAY),
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skip_reason_for("default", "a7"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 30 * SECS_PER_DAY,
                actual_secs: 20 * SECS_PER_DAY
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_history_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(30 * SECS_PER_DAY),
            ..never_fired_alert()
        };
        let outcome = SilentRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn demanding_more_evaluations_stops_a_quiet_alert_being_reported() {
        let facts = never_fired_alert();
        let strict = SilentRule::new(SilentThresholds {
            min_evaluations: 5_000,
            ..Default::default()
        });
        assert_eq!(
            SilentRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    #[test]
    fn a_raised_sample_floor_skips_an_alert_the_default_floor_judges() {
        let facts = never_fired_alert();
        let strict = SilentRule::new(SilentThresholds {
            min_samples: 400,
            ..Default::default()
        });
        assert_eq!(
            SilentRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a7"),
            Some(&SkipReason::InsufficientSamples {
                required: 400,
                actual: 300
            })
        );
    }

    #[test]
    fn a_raised_history_floor_skips_an_alert_the_default_floor_judges() {
        let facts = never_fired_alert();
        let strict = SilentRule::new(SilentThresholds {
            min_history_days: 90,
            ..Default::default()
        });
        assert_eq!(
            SilentRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a7"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 90 * SECS_PER_DAY,
                actual_secs: HISTORY_SECS
            })
        );
    }

    #[test]
    fn the_silent_rule_reports_its_own_history_and_sample_requirements() {
        let rule = SilentRule::default();
        assert_eq!(rule.rule_id(), "silent");
        assert_eq!(rule.min_history(), Duration::from_secs(30 * 86_400));
        assert_eq!(rule.min_samples(), 100);
    }

    #[test]
    fn an_absurd_history_threshold_saturates_rather_than_overflowing() {
        let rule = SilentRule::new(SilentThresholds {
            min_history_days: i64::MAX,
            ..Default::default()
        });
        assert_eq!(rule.min_history(), Duration::from_secs(u64::MAX));
    }

    /// Recommending deletion of a merely-broken alert is this rule's dangerous case.
    #[test]
    fn an_alert_that_errored_through_its_baseline_is_not_called_dead() {
        let rule = SilentRule::default();
        let outcome = rule.evaluate(&context_of(AlertFacts {
            evaluation_errors: 600,
            ..never_fired_alert()
        }));
        assert!(
            outcome.has_no_findings(),
            "an alert that failed every evaluation is broken, not dead"
        );
        assert_eq!(outcome.examined, 1, "it is judged and cleared, not skipped");
    }

    #[test]
    fn an_alert_erroring_at_exactly_the_ceiling_is_not_called_dead() {
        let rule = SilentRule::default();
        let facts = never_fired_alert();
        let at_ceiling = (facts.evaluations as f64 * DEFAULT_MAX_ERROR_RATIO) as u64;
        let outcome = rule.evaluate(&context_of(AlertFacts {
            evaluation_errors: at_ceiling,
            ..never_fired_alert()
        }));
        assert!(outcome.has_no_findings());
    }

    #[test]
    fn an_alert_with_a_few_transient_errors_is_still_reported() {
        let rule = SilentRule::default();
        let outcome = rule.evaluate(&context_of(AlertFacts {
            evaluation_errors: 1,
            ..never_fired_alert()
        }));
        assert_eq!(
            outcome.findings.len(),
            1,
            "one blip over a 45-day baseline does not make an alert healthy"
        );
    }

    /// A retry landing in-window from a firing outside it means the alert is not
    /// dormant, and `notify_failed` owns it — never both delete and repair.
    #[test]
    fn an_alert_with_delivery_activity_is_not_reported_as_dead() {
        let rule = SilentRule::default();
        let outcome = rule.evaluate(&context_of(AlertFacts {
            notification_attempts: 4,
            notification_failures: 4,
            ..never_fired_alert()
        }));
        assert!(outcome.has_no_findings());
        assert_eq!(outcome.examined, 1);
    }
}
