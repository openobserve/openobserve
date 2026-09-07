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

//! The alert fires but has nowhere to send the notification.

use std::time::Duration;

use super::{
    context::{AlertFacts, AnalysisContext, TimeRange},
    finding::{Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity},
    gate,
};

pub const RULE_ID: &str = "no_destination";

const DEFAULT_MIN_FIRINGS: u64 = 1;
const DEFAULT_MIN_HISTORY_HOURS: i64 = 1;
const DEFAULT_MIN_SAMPLES: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoDestinationThresholds {
    pub min_firings: u64,
    pub min_history_hours: i64,
    pub min_samples: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NoDestinationRule {
    pub thresholds: NoDestinationThresholds,
}

impl Default for NoDestinationThresholds {
    fn default() -> Self {
        Self {
            min_firings: DEFAULT_MIN_FIRINGS,
            min_history_hours: DEFAULT_MIN_HISTORY_HOURS,
            min_samples: DEFAULT_MIN_SAMPLES,
        }
    }
}

impl NoDestinationRule {
    pub fn new(thresholds: NoDestinationThresholds) -> Self {
        Self { thresholds }
    }

    /// Attempts are ignored: they may target a destination that has since been detached.
    fn judge(&self, facts: &AlertFacts, window: TimeRange) -> Option<Finding> {
        // A zero threshold must not turn "never fired" into "fires into the void".
        if facts.destination_count > 0
            || facts.firings == 0
            || facts.firings < self.thresholds.min_firings
        {
            return None;
        }
        Some(Finding {
            rule_id: RULE_ID.to_string(),
            severity: Severity::High,
            confidence: Confidence::High,
            title: format!(
                "{} fired {} times and has no destination attached now",
                facts.alert.alert_name, facts.firings
            ),
            subjects: vec![facts.alert.clone()],
            evidence: Evidence::NoDestination {
                firings: facts.firings,
            },
            window,
            actions: vec![ProposedAction::AttachDestination],
        })
    }
}

impl HygieneRule for NoDestinationRule {
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
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, TimeRange},
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
    };

    const WINDOW_SECS: i64 = 24 * 3600;
    const HISTORY_SECS: i64 = 12 * 3600;

    fn orphaned_alert() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a9", "auth spike"),
            enabled: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 72,
            evaluations: 144,
            firings: 5,
            destination_count: 0,
            notification_attempts: 0,
            ..Default::default()
        }
    }

    fn context_of(facts: AlertFacts) -> AnalysisContext {
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts])
    }

    #[test]
    fn an_alert_that_fires_into_the_void_is_reported_as_having_no_destination() {
        let ctx = context_of(orphaned_alert());
        let outcome = NoDestinationRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, RULE_ID);
        assert_eq!(finding.severity, Severity::High);
        assert_eq!(finding.confidence, Confidence::High);
        assert_eq!(
            finding.title,
            "auth spike fired 5 times and has no destination attached now"
        );
        assert_eq!(
            finding.subjects,
            vec![AlertRef::new("default", "a9", "auth spike")]
        );
        assert_eq!(finding.evidence, Evidence::NoDestination { firings: 5 });
        assert_eq!(finding.window, ctx.window);
        assert_eq!(finding.actions, vec![ProposedAction::AttachDestination]);
    }

    #[test]
    fn each_orphaned_alert_gets_its_own_finding_rather_than_one_rollup() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a10", "token refresh errors"),
            ..orphaned_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![orphaned_alert(), second],
        );
        let outcome = NoDestinationRule::default().evaluate(&ctx);
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
        assert_eq!(named, BTreeSet::from(["a10", "a9"]));
    }

    #[test]
    fn a_single_firing_is_enough_to_report_a_missing_destination() {
        let facts = AlertFacts {
            firings: 1,
            ..orphaned_alert()
        };
        assert_eq!(
            NoDestinationRule::default()
                .evaluate(&context_of(facts))
                .findings
                .len(),
            1
        );
    }

    #[test]
    fn an_alert_that_never_fired_is_not_reported_for_a_missing_destination() {
        let facts = AlertFacts {
            firings: 0,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    /// Silencing, deduplication and throttling all leave a real destination unattempted.
    #[test]
    fn an_alert_with_a_destination_that_never_notified_is_not_reported() {
        let facts = AlertFacts {
            destination_count: 1,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    /// Attempts against a since-detached destination do not give the alert one back.
    #[test]
    fn an_alert_with_no_destination_is_reported_even_though_it_attempted_notifications() {
        let facts = AlertFacts {
            notification_attempts: 5,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        assert_eq!(
            outcome.findings[0].evidence,
            Evidence::NoDestination { firings: 5 }
        );
    }

    #[test]
    fn a_disabled_alert_is_never_reported_for_a_missing_destination() {
        let facts = AlertFacts {
            enabled: false,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::AlertDisabled]
        );
        assert!(outcome.findings.is_empty());
    }

    /// The floor is on retained records, so plentiful evaluations do not satisfy it.
    #[test]
    fn too_few_samples_skips_the_no_destination_rule_and_says_so() {
        let facts = AlertFacts {
            sample_count: 9,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a9"),
            Some(&SkipReason::InsufficientSamples {
                required: 10,
                actual: 9
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_sample_count_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            sample_count: 10,
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn less_than_an_hour_of_history_skips_the_no_destination_rule_and_says_so() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(600),
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skip_reason_for("default", "a9"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 3600,
                actual_secs: 600
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_history_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(3600),
            ..orphaned_alert()
        };
        let outcome = NoDestinationRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn demanding_more_firings_stops_a_rarely_firing_orphan_being_reported() {
        let facts = orphaned_alert();
        let strict = NoDestinationRule::new(NoDestinationThresholds {
            min_firings: 10,
            ..Default::default()
        });
        assert_eq!(
            NoDestinationRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    #[test]
    fn a_raised_sample_floor_skips_an_alert_the_default_floor_judges() {
        let facts = orphaned_alert();
        let strict = NoDestinationRule::new(NoDestinationThresholds {
            min_samples: 100,
            ..Default::default()
        });
        assert_eq!(
            NoDestinationRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a9"),
            Some(&SkipReason::InsufficientSamples {
                required: 100,
                actual: 72
            })
        );
    }

    #[test]
    fn a_raised_history_floor_skips_an_alert_the_default_floor_judges() {
        let facts = orphaned_alert();
        let strict = NoDestinationRule::new(NoDestinationThresholds {
            min_history_hours: 24,
            ..Default::default()
        });
        assert_eq!(
            NoDestinationRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a9"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 24 * 3600,
                actual_secs: HISTORY_SECS
            })
        );
    }

    #[test]
    fn the_no_destination_rule_reports_its_own_history_and_sample_requirements() {
        let rule = NoDestinationRule::default();
        assert_eq!(rule.rule_id(), "no_destination");
        assert_eq!(rule.min_history(), Duration::from_secs(3600));
        assert_eq!(rule.min_samples(), 10);
    }

    #[test]
    fn an_absurd_history_threshold_saturates_rather_than_overflowing() {
        let rule = NoDestinationRule::new(NoDestinationThresholds {
            min_history_hours: i64::MAX,
            ..Default::default()
        });
        assert_eq!(rule.min_history(), Duration::from_secs(u64::MAX));
    }
}
