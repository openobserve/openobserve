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

//! The history and sample floors every rule shares, applied once per alert.

use super::{
    context::{AlertFacts, AnalysisContext},
    finding::{Finding, HygieneRule, RuleOutcome, Skip, SkipReason},
};

/// Every rule's floors are applied here, so no rule can forget them.
pub(super) fn judge_each<R, F>(rule: &R, ctx: &AnalysisContext, judge: F) -> RuleOutcome
where
    R: HygieneRule + ?Sized,
    F: Fn(&AlertFacts) -> Option<Finding>,
{
    let mut outcome = RuleOutcome::default();
    for facts in &ctx.alerts {
        if let Some(reason) = declined(rule, ctx, facts) {
            outcome
                .skips
                .push(Skip::new(rule.rule_id(), facts.alert.clone(), reason));
            continue;
        }
        outcome.examined += 1;
        if let Some(finding) = judge(facts) {
            outcome.findings.push(finding);
        }
    }
    outcome
}

/// History outranks samples, so an alert failing both is reported as too young.
fn declined<R: HygieneRule + ?Sized>(
    rule: &R,
    ctx: &AnalysisContext,
    facts: &AlertFacts,
) -> Option<SkipReason> {
    if !facts.enabled {
        return Some(SkipReason::AlertDisabled);
    }
    let required_secs = i64::try_from(rule.min_history().as_secs()).unwrap_or(i64::MAX);
    let actual_secs = facts.history.span_secs();
    if actual_secs < required_secs {
        return Some(SkipReason::InsufficientHistory {
            required_secs,
            actual_secs,
        });
    }
    // A long-lived alert says nothing about a short window, and counters are windowed.
    let window_secs = ctx.window.span_secs();
    if window_secs < required_secs {
        return Some(SkipReason::WindowTooShort {
            required_secs,
            actual_secs: window_secs,
        });
    }
    let required = rule.min_samples();
    if facts.sample_count < required {
        return Some(SkipReason::InsufficientSamples {
            required,
            actual: facts.sample_count,
        });
    }
    rule.unmeasurable(facts)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::alerts::raman_rules::context::{AlertRef, TimeRange};

    struct StubRule {
        min_history_secs: u64,
        min_samples: usize,
        unmeasurable: bool,
    }

    impl HygieneRule for StubRule {
        fn rule_id(&self) -> &'static str {
            "stub"
        }

        fn evaluate(&self, ctx: &AnalysisContext) -> RuleOutcome {
            judge_each(self, ctx, |_: &AlertFacts| None::<Finding>)
        }

        fn min_history(&self) -> Duration {
            Duration::from_secs(self.min_history_secs)
        }

        fn min_samples(&self) -> usize {
            self.min_samples
        }

        fn unmeasurable(&self, _facts: &AlertFacts) -> Option<SkipReason> {
            self.unmeasurable.then(|| SkipReason::UnmeasurableSignal {
                signal: "stub".to_string(),
            })
        }
    }

    fn rule(min_history_secs: u64, min_samples: usize, unmeasurable: bool) -> StubRule {
        StubRule {
            min_history_secs,
            min_samples,
            unmeasurable,
        }
    }

    fn context(history_secs: i64, sample_count: usize) -> AnalysisContext {
        AnalysisContext::new(
            TimeRange::of_secs(i64::from(u16::MAX)),
            vec![AlertFacts {
                alert: AlertRef::new("default", "a1", "stub alert"),
                enabled: true,
                history: TimeRange::of_secs(history_secs),
                sample_count,
                ..Default::default()
            }],
        )
    }

    /// Samples accumulate once history does, so the actionable shortfall is the one shown.
    #[test]
    fn an_alert_failing_both_floors_is_reported_as_too_young() {
        let outcome = rule(7200, 100, false).evaluate(&context(60, 1));
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert!(matches!(
            outcome.skips[0].reason,
            SkipReason::InsufficientHistory { .. }
        ));
    }

    #[test]
    fn an_alert_with_history_but_no_samples_is_reported_as_undersampled() {
        let outcome = rule(60, 100, false).evaluate(&context(7200, 1));
        assert_eq!(
            outcome.skips[0].reason,
            SkipReason::InsufficientSamples {
                required: 100,
                actual: 1
            }
        );
    }

    /// An unmeasurable signal must not mask a floor the operator could actually fix.
    #[test]
    fn a_missing_signal_is_only_reported_once_both_floors_are_met() {
        let outcome = rule(7200, 100, true).evaluate(&context(60, 1));
        assert!(matches!(
            outcome.skips[0].reason,
            SkipReason::InsufficientHistory { .. }
        ));

        let outcome = rule(60, 1, true).evaluate(&context(7200, 100));
        assert_eq!(outcome.examined, 0);
        assert!(matches!(
            outcome.skips[0].reason,
            SkipReason::UnmeasurableSignal { .. }
        ));
    }

    #[test]
    fn an_alert_clearing_every_floor_is_examined_rather_than_skipped() {
        let outcome = rule(60, 1, false).evaluate(&context(7200, 100));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
    }

    #[test]
    fn each_declined_alert_gets_its_own_skip_rather_than_one_rollup() {
        let mut ctx = context(60, 1);
        ctx.alerts.push(AlertFacts {
            alert: AlertRef::new("default", "a2", "second stub"),
            enabled: true,
            history: TimeRange::of_secs(60),
            sample_count: 1,
            ..Default::default()
        });
        let outcome = rule(7200, 100, false).evaluate(&ctx);
        assert_eq!(outcome.skips.len(), 2);
        assert_eq!(outcome.examined, 0);
    }

    /// Phase A seeds alerts disabled; the digest must not quietly endorse them as fine.
    #[test]
    fn a_disabled_alert_is_declined_before_any_floor_is_considered() {
        let mut ctx = context(7200, 100);
        ctx.alerts[0].enabled = false;
        let outcome = rule(60, 1, false).evaluate(&ctx);
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips[0].reason, SkipReason::AlertDisabled);
    }

    /// A year of history says nothing about an hour of counters.
    #[test]
    fn a_window_shorter_than_the_history_floor_is_declined() {
        let mut ctx = context(90 * 86_400, 100);
        ctx.window = TimeRange::of_secs(3600);
        let outcome = rule(30 * 86_400, 1, false).evaluate(&ctx);
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips[0].reason,
            SkipReason::WindowTooShort {
                required_secs: 30 * 86_400,
                actual_secs: 3600
            }
        );
    }

    /// Lifetime is the shortfall an operator can wait out; the window is theirs to widen.
    #[test]
    fn a_short_lifetime_outranks_a_short_window() {
        let mut ctx = context(60, 100);
        ctx.window = TimeRange::of_secs(3600);
        let outcome = rule(30 * 86_400, 1, false).evaluate(&ctx);
        assert!(matches!(
            outcome.skips[0].reason,
            SkipReason::InsufficientHistory { .. }
        ));
    }
}
