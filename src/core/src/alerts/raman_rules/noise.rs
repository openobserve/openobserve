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

//! Fires constantly, clears itself in seconds, never became an incident.

use std::time::Duration;

use super::{
    context::{AlertFacts, AnalysisContext, TimeRange},
    finding::{
        Confidence, Evidence, Finding, HygieneRule, ProposedAction, RuleOutcome, Severity,
        SkipReason,
    },
    gate,
};

pub const RULE_ID: &str = "noise";

const DEFAULT_MIN_FIRINGS: u64 = 20;
const DEFAULT_MAX_MEAN_TIME_TO_NORMAL_SECS: f64 = 300.0;
const DEFAULT_MAX_INCIDENT_LINKAGE_RATIO: f64 = 0.0;
const DEFAULT_MIN_HISTORY_HOURS: i64 = 168;
const DEFAULT_MIN_SAMPLES: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct NoiseThresholds {
    pub min_firings: u64,
    pub max_mean_time_to_normal_secs: f64,
    pub max_incident_linkage_ratio: f64,
    pub min_history_hours: i64,
    pub min_samples: usize,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NoiseRule {
    pub thresholds: NoiseThresholds,
}

impl Default for NoiseThresholds {
    fn default() -> Self {
        Self {
            min_firings: DEFAULT_MIN_FIRINGS,
            max_mean_time_to_normal_secs: DEFAULT_MAX_MEAN_TIME_TO_NORMAL_SECS,
            max_incident_linkage_ratio: DEFAULT_MAX_INCIDENT_LINKAGE_RATIO,
            min_history_hours: DEFAULT_MIN_HISTORY_HOURS,
            min_samples: DEFAULT_MIN_SAMPLES,
        }
    }
}

impl NoiseRule {
    pub fn new(thresholds: NoiseThresholds) -> Self {
        Self { thresholds }
    }

    fn judge(&self, facts: &AlertFacts, window: TimeRange) -> Option<Finding> {
        // A threshold of zero must not make an alert that never fired "noisy".
        if facts.firings == 0 || facts.firings < self.thresholds.min_firings {
            return None;
        }
        let mean_time_to_normal_secs = measurable_mean_time_to_normal(facts)?;
        if mean_time_to_normal_secs > self.thresholds.max_mean_time_to_normal_secs {
            return None;
        }
        let incident_linkage_ratio = facts.incident_linkage_ratio();
        if incident_linkage_ratio > self.thresholds.max_incident_linkage_ratio {
            return None;
        }
        Some(Finding {
            rule_id: RULE_ID.to_string(),
            severity: Severity::Medium,
            confidence: Confidence::High,
            title: noise_title(facts, incident_linkage_ratio),
            subjects: vec![facts.alert.clone()],
            evidence: Evidence::Noise {
                firings: facts.firings,
                mean_time_to_normal_secs,
                incident_linkage_ratio,
            },
            window,
            actions: vec![
                ProposedAction::RaiseThreshold,
                ProposedAction::LengthenEvaluationWindow,
                ProposedAction::EnableDeduplication,
            ],
        })
    }
}

impl HygieneRule for NoiseRule {
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

    /// Named per signal, and only for alerts that would otherwise have qualified.
    fn unmeasurable(&self, facts: &AlertFacts) -> Option<SkipReason> {
        if facts.firings == 0 || facts.firings < self.thresholds.min_firings {
            return None;
        }
        if !facts.creates_incident {
            return Some(SkipReason::UnmeasurableSignal {
                signal: "incident_linkage".to_string(),
            });
        }
        if measurable_mean_time_to_normal(facts).is_none() {
            return Some(SkipReason::UnmeasurableSignal {
                signal: "mean_time_to_normal_secs".to_string(),
            });
        }
        if facts.incident_linked_firings > facts.firings {
            return Some(SkipReason::UnmeasurableSignal {
                signal: "incident_linked_firings".to_string(),
            });
        }
        None
    }
}

/// "Never" is a claim only a zero linkage threshold earns, and that is configurable.
fn noise_title(facts: &AlertFacts, incident_linkage_ratio: f64) -> String {
    if incident_linkage_ratio == 0.0 {
        return format!(
            "{} fired {} times without ever opening an incident",
            facts.alert.alert_name, facts.firings
        );
    }
    format!(
        "{} fired {} times, opening an incident for only {} of them",
        facts.alert.alert_name, facts.firings, facts.incident_linked_firings
    )
}

/// A negative or non-finite mean is clock skew, so it is absent rather than good evidence.
fn measurable_mean_time_to_normal(facts: &AlertFacts) -> Option<f64> {
    facts
        .mean_time_to_normal_secs
        .filter(|s| s.is_finite() && *s >= 0.0)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, TimeRange},
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
    };

    const WINDOW_SECS: i64 = 240 * 3600;
    const HISTORY_SECS: i64 = 200 * 3600;

    fn flapping_disk_alert() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a1", "disk latency"),
            enabled: true,
            creates_incident: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 2016,
            evaluations: 4032,
            firings: 400,
            mean_time_to_normal_secs: Some(45.0),
            incident_linked_firings: 0,
            destination_count: 2,
            notification_attempts: 800,
            ..Default::default()
        }
    }

    /// Otherwise fully qualifying, so only the sample floor can hold it back.
    fn undersampled_flapping_alert() -> AlertFacts {
        AlertFacts {
            sample_count: 30,
            ..flapping_disk_alert()
        }
    }

    fn context_of(facts: AlertFacts) -> AnalysisContext {
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts])
    }

    /// `creates_incident` defaults off, making "never linked" structurally true, not evidence.
    #[test]
    fn an_alert_that_never_opted_into_incidents_is_cleared_rather_than_called_noisy() {
        let facts = AlertFacts {
            creates_incident: false,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));

        assert!(
            outcome.findings.is_empty(),
            "an alert that cannot open an incident cannot be evidenced as never having done so"
        );
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "incident_linkage".to_string()
            }],
            "the operator must be told which signal was missing, not just that nothing was found"
        );
    }

    /// The gate must not swallow a genuinely noisy alert that did opt in.
    #[test]
    fn an_alert_that_opted_into_incidents_and_never_opened_one_is_still_noise() {
        let outcome = NoiseRule::default().evaluate(&context_of(flapping_disk_alert()));

        assert_eq!(outcome.findings.len(), 1);
        assert_eq!(
            outcome.findings[0].evidence,
            Evidence::Noise {
                firings: 400,
                mean_time_to_normal_secs: 45.0,
                incident_linkage_ratio: 0.0,
            }
        );
    }

    #[test]
    fn an_alert_that_self_resolves_in_seconds_and_never_paged_anyone_is_noise() {
        let ctx = context_of(flapping_disk_alert());
        let outcome = NoiseRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
        let finding = &outcome.findings[0];
        assert_eq!(finding.rule_id, RULE_ID);
        assert_eq!(finding.severity, Severity::Medium);
        assert_eq!(finding.confidence, Confidence::High);
        assert_eq!(
            finding.title,
            "disk latency fired 400 times without ever opening an incident"
        );
        assert_eq!(
            finding.subjects,
            vec![AlertRef::new("default", "a1", "disk latency")]
        );
        assert_eq!(
            finding.evidence,
            Evidence::Noise {
                firings: 400,
                mean_time_to_normal_secs: 45.0,
                incident_linkage_ratio: 0.0,
            }
        );
        assert_eq!(finding.window, ctx.window);
        assert_eq!(
            finding.actions,
            vec![
                ProposedAction::RaiseThreshold,
                ProposedAction::LengthenEvaluationWindow,
                ProposedAction::EnableDeduplication,
            ]
        );
    }

    #[test]
    fn each_qualifying_alert_gets_its_own_finding_rather_than_one_rollup() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a2", "queue depth"),
            ..flapping_disk_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![flapping_disk_alert(), second],
        );
        let outcome = NoiseRule::default().evaluate(&ctx);
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
        assert_eq!(named, BTreeSet::from(["a1", "a2"]));
    }

    #[test]
    fn an_alert_at_exactly_the_minimum_firing_count_is_still_noise() {
        let facts = AlertFacts {
            firings: 20,
            notification_attempts: 40,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn an_alert_one_firing_below_the_minimum_is_not_noise() {
        let facts = AlertFacts {
            firings: 19,
            notification_attempts: 38,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn an_alert_that_clears_exactly_at_the_time_to_normal_cutoff_is_still_noise() {
        let facts = AlertFacts {
            mean_time_to_normal_secs: Some(300.0),
            ..flapping_disk_alert()
        };
        assert_eq!(
            NoiseRule::default()
                .evaluate(&context_of(facts))
                .findings
                .len(),
            1
        );
    }

    #[test]
    fn an_alert_that_takes_longer_than_the_cutoff_to_clear_is_not_noise() {
        let facts = AlertFacts {
            mean_time_to_normal_secs: Some(301.0),
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    /// A silent clear reads as "checked, and fine" for a rule that could not check.
    #[test]
    fn an_alert_with_no_measured_time_to_normal_is_skipped_with_a_reason() {
        let facts = AlertFacts {
            mean_time_to_normal_secs: None,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 0);
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "mean_time_to_normal_secs".to_string()
            }]
        );
    }

    /// A non-finite mean stores as null and breaks equality, so it counts as absent.
    #[test]
    fn a_non_finite_or_negative_time_to_normal_is_skipped_not_cleared() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -45.0] {
            let facts = AlertFacts {
                mean_time_to_normal_secs: Some(value),
                ..flapping_disk_alert()
            };
            let outcome = NoiseRule::default().evaluate(&context_of(facts));
            assert_eq!(outcome.examined, 0, "{value} was judged");
            assert_eq!(outcome.skips.len(), 1, "{value} recorded no skip");
            assert!(outcome.findings.is_empty(), "{value} was reported as noise");
        }
    }

    /// Opting out of incidents is conclusive data, so it clears rather than skips.
    #[test]
    fn linkage_is_named_ahead_of_the_mean_when_both_are_missing() {
        let facts = AlertFacts {
            creates_incident: false,
            mean_time_to_normal_secs: None,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "incident_linkage".to_string()
            }]
        );
    }

    /// Naming the mean for an alert that never fired would send the operator hunting
    /// for a measurement that was never relevant.
    #[test]
    fn an_alert_below_the_firing_floor_is_cleared_rather_than_blamed_on_a_missing_signal() {
        let facts = AlertFacts {
            firings: 2,
            creates_incident: false,
            mean_time_to_normal_secs: None,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    /// A zero threshold must not turn "never fired" into "fires constantly".
    #[test]
    fn an_alert_that_never_fired_is_not_noise_even_at_a_zero_threshold() {
        let rule = NoiseRule::new(NoiseThresholds {
            min_firings: 0,
            ..Default::default()
        });
        let outcome = rule.evaluate(&context_of(AlertFacts {
            firings: 0,
            incident_linked_firings: 0,
            ..flapping_disk_alert()
        }));
        assert!(outcome.has_no_findings());
        assert_eq!(outcome.examined, 1);
    }

    #[test]
    fn an_alert_linked_to_even_one_incident_is_not_noise() {
        let facts = AlertFacts {
            incident_linked_firings: 1,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert!(outcome.findings.is_empty());
    }

    #[test]
    fn a_disabled_alert_is_never_reported_as_noise() {
        let facts = AlertFacts {
            enabled: false,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
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
    fn more_linked_firings_than_firings_is_reported_as_unmeasurable() {
        let facts = AlertFacts {
            firings: 400,
            incident_linked_firings: 500,
            ..flapping_disk_alert()
        };
        // Lenient, so only the contradictory counters can produce the skip.
        let lenient = NoiseRule::new(NoiseThresholds {
            max_incident_linkage_ratio: 1.0,
            ..Default::default()
        });
        let outcome = lenient.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skips.iter().map(|s| &s.reason).collect::<Vec<_>>(),
            vec![&SkipReason::UnmeasurableSignal {
                signal: "incident_linked_firings".to_string()
            }]
        );
    }

    /// The floor is on retained records, so plentiful evaluations do not satisfy it.
    #[test]
    fn too_few_samples_skips_the_noise_rule_and_says_so() {
        let outcome = NoiseRule::default().evaluate(&context_of(undersampled_flapping_alert()));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientSamples {
                required: 50,
                actual: 30
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_sample_count_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            sample_count: 50,
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    #[test]
    fn less_than_a_week_of_history_skips_the_noise_rule_and_says_so() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(100 * 3600),
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.examined, 0);
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 168 * 3600,
                actual_secs: 100 * 3600
            })
        );
    }

    #[test]
    fn an_alert_with_exactly_the_minimum_history_is_judged_rather_than_skipped() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(168 * 3600),
            ..flapping_disk_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 1);
        assert_eq!(outcome.skips, vec![]);
        assert_eq!(outcome.findings.len(), 1);
    }

    /// One alert yields at most one skip per rule, and history is the reason reported.
    #[test]
    fn failing_both_gates_yields_a_single_skip_naming_the_history_shortfall() {
        let facts = AlertFacts {
            history: TimeRange::of_secs(2 * 3600),
            ..undersampled_flapping_alert()
        };
        let outcome = NoiseRule::default().evaluate(&context_of(facts));
        assert_eq!(outcome.examined, 0);
        assert!(outcome.findings.is_empty());
        assert_eq!(outcome.skips.len(), 1);
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 168 * 3600,
                actual_secs: 2 * 3600
            })
        );
    }

    #[test]
    fn two_undersampled_alerts_produce_two_skips_rather_than_one() {
        let second = AlertFacts {
            alert: AlertRef::new("default", "a2", "queue depth"),
            ..undersampled_flapping_alert()
        };
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![undersampled_flapping_alert(), second],
        );
        let outcome = NoiseRule::default().evaluate(&ctx);
        assert_eq!(outcome.examined, 0);
        assert_eq!(outcome.skips.len(), 2);
        let named: BTreeSet<&str> = outcome
            .skips
            .iter()
            .map(|s| s.subject.alert_id.as_str())
            .collect();
        assert_eq!(named, BTreeSet::from(["a1", "a2"]));
    }

    #[test]
    fn raising_the_minimum_firing_threshold_stops_a_noisy_alert_being_reported() {
        let facts = flapping_disk_alert();
        let strict = NoiseRule::new(NoiseThresholds {
            min_firings: 500,
            ..Default::default()
        });
        assert_eq!(
            NoiseRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        assert!(strict.evaluate(&context_of(facts)).findings.is_empty());
    }

    #[test]
    fn allowing_some_incident_linkage_lets_a_partly_paged_alert_count_as_noise() {
        let facts = AlertFacts {
            incident_linked_firings: 4,
            ..flapping_disk_alert()
        };
        let lenient = NoiseRule::new(NoiseThresholds {
            max_incident_linkage_ratio: 0.05,
            ..Default::default()
        });
        assert!(
            NoiseRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .is_empty()
        );
        assert_eq!(lenient.evaluate(&context_of(facts)).findings.len(), 1);
    }

    #[test]
    fn a_longer_time_to_normal_cutoff_lets_a_slower_alert_count_as_noise() {
        let facts = AlertFacts {
            mean_time_to_normal_secs: Some(600.0),
            ..flapping_disk_alert()
        };
        let lenient = NoiseRule::new(NoiseThresholds {
            max_mean_time_to_normal_secs: 900.0,
            ..Default::default()
        });
        assert!(
            NoiseRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .is_empty()
        );
        assert_eq!(lenient.evaluate(&context_of(facts)).findings.len(), 1);
    }

    #[test]
    fn a_raised_sample_floor_skips_an_alert_the_default_floor_judges() {
        let facts = flapping_disk_alert();
        let strict = NoiseRule::new(NoiseThresholds {
            min_samples: 3_000,
            ..Default::default()
        });
        assert_eq!(
            NoiseRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientSamples {
                required: 3_000,
                actual: 2016
            })
        );
    }

    #[test]
    fn a_raised_history_floor_skips_an_alert_the_default_floor_judges() {
        let facts = flapping_disk_alert();
        let strict = NoiseRule::new(NoiseThresholds {
            min_history_hours: 300,
            ..Default::default()
        });
        assert_eq!(
            NoiseRule::default()
                .evaluate(&context_of(facts.clone()))
                .findings
                .len(),
            1
        );
        let outcome = strict.evaluate(&context_of(facts));
        assert!(outcome.findings.is_empty());
        assert_eq!(
            outcome.skip_reason_for("default", "a1"),
            Some(&SkipReason::InsufficientHistory {
                required_secs: 300 * 3600,
                actual_secs: HISTORY_SECS
            })
        );
    }

    #[test]
    fn the_noise_rule_reports_its_own_history_and_sample_requirements() {
        let rule = NoiseRule::default();
        assert_eq!(rule.rule_id(), "noise");
        assert_eq!(rule.min_history(), Duration::from_secs(168 * 3600));
        assert_eq!(rule.min_samples(), 50);
    }

    #[test]
    fn an_absurd_history_threshold_saturates_rather_than_overflowing() {
        let rule = NoiseRule::new(NoiseThresholds {
            min_history_hours: i64::MAX,
            ..Default::default()
        });
        assert_eq!(rule.min_history(), Duration::from_secs(u64::MAX));
    }

    /// The title may only assert what the configured threshold actually established.
    #[test]
    fn the_title_does_not_claim_never_when_some_linkage_was_tolerated() {
        let rule = NoiseRule::new(NoiseThresholds {
            max_incident_linkage_ratio: 0.25,
            ..Default::default()
        });
        let outcome = rule.evaluate(&context_of(AlertFacts {
            incident_linked_firings: 40,
            ..flapping_disk_alert()
        }));
        assert_eq!(outcome.findings.len(), 1);
        assert!(
            !outcome.findings[0].title.contains("without ever opening"),
            "linkage of 40/400 was tolerated, so the title must not claim never: {}",
            outcome.findings[0].title
        );
    }

    #[test]
    fn the_title_still_claims_never_when_linkage_really_was_zero() {
        let rule = NoiseRule::default();
        let outcome = rule.evaluate(&context_of(flapping_disk_alert()));
        assert_eq!(outcome.findings.len(), 1);
        assert!(
            outcome.findings[0]
                .title
                .contains("without ever opening an incident"),
            "got: {}",
            outcome.findings[0].title
        );
    }
}
