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

//! Runs every rule over one context and orders the result deterministically.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use super::{
    context::AnalysisContext,
    failure::FailureRule,
    finding::{Finding, HygieneRule, Skip},
    no_destination::NoDestinationRule,
    noise::NoiseRule,
    notify_failed::NotifyFailedRule,
    silent::SilentRule,
};

/// The whole run: what was found, what was declined, and how much was judged.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
pub struct EngineReport {
    pub findings: Vec<Finding>,
    pub skips: Vec<Skip>,
    /// Summed over rules, so one alert judged by every rule counts once per rule.
    pub judgements: usize,
    pub alerts_in_scope: usize,
}

pub fn default_rules() -> Vec<Box<dyn HygieneRule>> {
    vec![
        Box::new(FailureRule::default()),
        Box::new(NoDestinationRule::default()),
        Box::new(NoiseRule::default()),
        Box::new(NotifyFailedRule::default()),
        Box::new(SilentRule::default()),
    ]
}

pub fn run(rules: &[Box<dyn HygieneRule>], ctx: &AnalysisContext) -> EngineReport {
    let mut report = EngineReport {
        alerts_in_scope: ctx.alerts.len(),
        ..Default::default()
    };
    for rule in rules {
        let outcome = rule.evaluate(ctx);
        report.judgements += outcome.examined;
        report.findings.extend(outcome.findings);
        report.skips.extend(outcome.skips);
    }
    report.findings.sort_by(finding_order);
    report.skips.sort_by(skip_order);
    report
}

fn finding_order(a: &Finding, b: &Finding) -> Ordering {
    a.rule_id
        .cmp(&b.rule_id)
        .then_with(|| subject_key(a).cmp(&subject_key(b)))
        .then_with(|| a.title.cmp(&b.title))
}

/// One skip per rule per alert, so `(rule_id, subject)` is already a total order.
fn skip_order(a: &Skip, b: &Skip) -> Ordering {
    a.rule_id
        .cmp(&b.rule_id)
        .then_with(|| a.subject.sort_key().cmp(&b.subject.sort_key()))
}

fn subject_key(finding: &Finding) -> (&str, &str) {
    finding
        .subjects
        .first()
        .map_or(("", ""), |subject| subject.sort_key())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;
    use crate::alerts::raman_rules::{
        context::{AlertFacts, AlertRef, ErrorCluster, TimeRange},
        failure::FailureThresholds,
        finding::{Confidence, Evidence, ProposedAction, Severity, SkipReason},
        noise::NoiseThresholds,
        silent::{RULE_ID as SILENT_RULE_ID, SilentThresholds},
    };

    const WINDOW_SECS: i64 = 240 * 3600;
    const HISTORY_SECS: i64 = 200 * 3600;

    /// The threshold of a rule counting evaluation records rather than a rate.
    fn record_count_threshold(rule_id: &str) -> Option<usize> {
        match rule_id {
            SILENT_RULE_ID => Some(SilentThresholds::default().min_evaluations as usize),
            _ => None,
        }
    }

    fn noisy() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a1", "disk latency"),
            enabled: true,
            creates_incident: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 2016,
            evaluations: 4032,
            firings: 400,
            mean_time_to_normal_secs: Some(45.0),
            destination_count: 2,
            notification_attempts: 800,
            ..Default::default()
        }
    }

    fn orphaned() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a9", "auth spike"),
            enabled: true,
            creates_incident: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 144,
            evaluations: 288,
            firings: 5,
            destination_count: 0,
            ..Default::default()
        }
    }

    fn broken() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("prod", "a3", "payment failures"),
            enabled: true,
            creates_incident: true,
            history: TimeRange::of_secs(HISTORY_SECS),
            sample_count: 150,
            evaluations: 200,
            evaluation_errors: 30,
            error_clusters: vec![
                ErrorCluster::new("stream not found", 25),
                ErrorCluster::new("permission denied", 5),
            ],
            destination_count: 1,
            ..Default::default()
        }
    }

    fn starved() -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", "a1", "disk latency"),
            enabled: true,
            creates_incident: true,
            history: TimeRange::of_secs(1800),
            sample_count: 5,
            evaluations: 10,
            firings: 5,
            mean_time_to_normal_secs: Some(45.0),
            destination_count: 0,
            ..Default::default()
        }
    }

    /// Long enough for every rule but noise and silent, so exactly two rules decline.
    fn half_aged(alert_id: &str) -> AlertFacts {
        AlertFacts {
            alert: AlertRef::new("default", alert_id, "disk latency"),
            history: TimeRange::of_secs(100 * 3600),
            ..noisy()
        }
    }

    fn fleet() -> AnalysisContext {
        AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![noisy(), orphaned(), broken()],
        )
    }

    fn cross_org_fleet() -> AnalysisContext {
        let elsewhere = AlertFacts {
            alert: AlertRef::new("prod", "a2", "queue depth"),
            ..noisy()
        };
        AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![noisy(), elsewhere])
    }

    fn skips_by_rule(report: &EngineReport) -> BTreeMap<&str, usize> {
        let mut counts = BTreeMap::new();
        for skip in &report.skips {
            *counts.entry(skip.rule_id.as_str()).or_insert(0) += 1;
        }
        counts
    }

    /// A sample floor at or above a rule's own record threshold silently pins it.
    #[test]
    fn the_one_rule_counting_evaluation_records_keeps_its_sample_floor_below_that_threshold() {
        let mut checked = 0;
        for rule in default_rules() {
            let Some(primary) = record_count_threshold(rule.rule_id()) else {
                continue;
            };
            checked += 1;
            assert!(
                rule.min_samples() < primary,
                "{}: min_samples {} must stay below its count threshold {primary}",
                rule.rule_id(),
                rule.min_samples()
            );
        }
        assert_eq!(checked, 1, "only the silent rule counts evaluation records");
    }

    #[test]
    fn the_same_context_produces_byte_identical_findings_when_run_twice() {
        let ctx = fleet();
        let first = run(&default_rules(), &ctx);
        let second = run(&default_rules(), &ctx);
        assert!(
            !first.findings.is_empty(),
            "a fleet with a noisy, an orphaned and a broken alert must yield findings"
        );
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
    }

    /// Running the same alerts twice cannot catch a rule that depends on input order.
    #[test]
    fn reordering_the_input_alerts_does_not_change_the_output() {
        let baseline = run(&default_rules(), &fleet());
        assert!(
            !baseline.findings.is_empty(),
            "an ordering test over an empty result proves nothing"
        );
        let expected = serde_json::to_string(&baseline).unwrap();
        let mut alerts = fleet().alerts;
        alerts.reverse();
        for _ in 0..alerts.len() {
            alerts.rotate_left(1);
            let ctx = AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), alerts.clone());
            assert_eq!(
                serde_json::to_string(&run(&default_rules(), &ctx)).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn findings_are_ordered_by_rule_id_then_by_alert_identity() {
        let report = run(&default_rules(), &fleet());
        let order: Vec<(&str, &str)> = report
            .findings
            .iter()
            .map(|f| (f.rule_id.as_str(), f.subjects[0].alert_id.as_str()))
            .collect();
        assert_eq!(
            order,
            vec![("failure", "a3"), ("no_destination", "a9"), ("noise", "a1"),]
        );
    }

    /// Rules are supplied out of order so the sort, not the loop, decides the output.
    #[test]
    fn skips_are_ordered_by_rule_id_then_by_alert_identity() {
        let rules: Vec<Box<dyn HygieneRule>> = vec![
            Box::new(SilentRule::default()),
            Box::new(NoiseRule::default()),
        ];
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![half_aged("b2"), half_aged("b1")],
        );
        let report = run(&rules, &ctx);
        let order: Vec<(&str, &str)> = report
            .skips
            .iter()
            .map(|s| (s.rule_id.as_str(), s.subject.alert_id.as_str()))
            .collect();
        assert_eq!(
            order,
            vec![
                ("noise", "b1"),
                ("noise", "b2"),
                ("silent", "b1"),
                ("silent", "b2"),
            ]
        );
    }

    #[test]
    fn a_finding_only_ever_names_alerts_present_in_the_context() {
        let ctx = fleet();
        let report = run(&default_rules(), &ctx);
        assert!(!report.findings.is_empty());
        for finding in &report.findings {
            assert!(
                !finding.subjects.is_empty(),
                "{} named nobody",
                finding.rule_id
            );
            for subject in &finding.subjects {
                assert!(
                    ctx.contains(subject),
                    "{} named {:?} which is not in the context",
                    finding.rule_id,
                    subject
                );
            }
        }
    }

    /// The common case, and the one place duplicated advice would surface.
    #[test]
    fn one_alert_can_be_reported_by_two_rules_at_once() {
        let facts = AlertFacts {
            destination_count: 0,
            notification_attempts: 0,
            ..noisy()
        };
        let report = run(
            &default_rules(),
            &AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![facts]),
        );

        let reported: Vec<&str> = report.findings.iter().map(|f| f.rule_id.as_str()).collect();
        assert_eq!(
            reported,
            vec!["no_destination", "noise"],
            "both rules judge the same alert, ordered by rule id"
        );
        for finding in &report.findings {
            assert_eq!(finding.subjects[0].alert_id, "a1");
        }
    }

    /// The job reads a cross-org firehose, so a two-org finding is the leak shape.
    #[test]
    fn no_finding_ever_names_alerts_from_more_than_one_org() {
        let report = run(&default_rules(), &cross_org_fleet());
        let noise_findings = report
            .findings
            .iter()
            .filter(|f| f.rule_id == "noise")
            .count();
        assert_eq!(
            noise_findings, 2,
            "one rule must match both orgs or this proves nothing"
        );
        for finding in &report.findings {
            let orgs: BTreeSet<&str> = finding.subjects.iter().map(|s| s.org_id.as_str()).collect();
            assert_eq!(
                orgs.len(),
                1,
                "finding {} spans orgs {orgs:?}",
                finding.title
            );
        }
    }

    /// One alert yields at most one skip per rule, and history is the reason reported.
    #[test]
    fn failing_both_gates_yields_a_single_skip_naming_the_history_shortfall() {
        let ctx = AnalysisContext::new(TimeRange::of_secs(WINDOW_SECS), vec![starved()]);
        for rule in default_rules() {
            let outcome = rule.evaluate(&ctx);
            let id = rule.rule_id();
            assert!(outcome.findings.is_empty(), "{id} judged a starved alert");
            assert_eq!(
                outcome.examined, 0,
                "{id} counted a starved alert as judged"
            );
            assert_eq!(outcome.skips.len(), 1, "{id} skipped {:?}", outcome.skips);
            assert!(
                matches!(
                    outcome.skips[0].reason,
                    SkipReason::InsufficientHistory { .. }
                ),
                "{id} reported {:?} rather than the history shortfall",
                outcome.skips[0].reason
            );
        }
    }

    #[test]
    fn the_report_counts_judgements_and_scope_separately() {
        let report = run(&default_rules(), &fleet());
        assert_eq!(report.alerts_in_scope, 3);
        assert_eq!(
            report.judgements, 12,
            "silent declines all three for history; noise judges and clears them"
        );
    }

    /// A rollup would report one skip for the whole fleet instead of one per alert.
    #[test]
    fn a_rule_that_declines_records_one_skip_for_every_alert_it_declined() {
        let report = run(&default_rules(), &fleet());
        assert_eq!(report.skips.len(), 3);
        assert_eq!(
            skips_by_rule(&report),
            BTreeMap::from([("silent", 3)]),
            "noise clears an alert below its firing floor rather than blaming a signal"
        );
        let declined: BTreeSet<&str> = report
            .skips
            .iter()
            .map(|s| s.subject.alert_id.as_str())
            .collect();
        assert_eq!(declined, BTreeSet::from(["a1", "a3", "a9"]));
        for skip in &report.skips {
            assert_eq!(skip.rule_id, "silent");
            assert!(
                matches!(skip.reason, SkipReason::InsufficientHistory { .. }),
                "silent reported {:?} for {}",
                skip.reason,
                skip.subject.alert_id
            );
        }
    }

    /// Two rules declining two alerts is four skips, not two and not one.
    #[test]
    fn two_rules_declining_two_alerts_produce_four_separate_skips() {
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![half_aged("b1"), half_aged("b2")],
        );
        let report = run(&default_rules(), &ctx);
        assert_eq!(report.skips.len(), 4);
        assert_eq!(
            skips_by_rule(&report),
            BTreeMap::from([("noise", 2), ("silent", 2)])
        );
        assert_eq!(report.judgements, 6, "three rules judge both alerts");
    }

    #[test]
    fn the_scope_is_the_context_size_even_when_no_rule_runs() {
        let report = run(&[], &fleet());
        assert_eq!(report.alerts_in_scope, 3);
        assert_eq!(report.judgements, 0);
        assert!(report.findings.is_empty());
        assert!(report.skips.is_empty());
    }

    #[test]
    fn an_empty_context_produces_no_findings_and_does_not_panic() {
        let report = run(&default_rules(), &AnalysisContext::default());
        assert!(report.findings.is_empty());
        assert!(report.skips.is_empty());
        assert_eq!(report.judgements, 0);
        assert_eq!(report.alerts_in_scope, 0);
    }

    #[test]
    fn a_non_default_noise_threshold_changes_what_the_engine_reports() {
        let ctx = fleet();
        let strict: Vec<Box<dyn HygieneRule>> = vec![Box::new(NoiseRule::new(NoiseThresholds {
            min_firings: 1_000,
            ..Default::default()
        }))];
        let lenient: Vec<Box<dyn HygieneRule>> = vec![Box::new(NoiseRule::default())];
        assert_eq!(run(&lenient, &ctx).findings.len(), 1);
        assert!(run(&strict, &ctx).findings.is_empty());
    }

    #[test]
    fn an_alert_with_too_little_history_is_skipped_rather_than_silently_dropped() {
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(2 * 3600),
            vec![AlertFacts {
                history: TimeRange::of_secs(2 * 3600),
                ..noisy()
            }],
        );
        let report = run(&default_rules(), &ctx);
        assert!(report.findings.is_empty());
        assert!(
            report.skips.iter().any(|s| s.rule_id == "noise"),
            "the noise rule must record why it declined, got {:?}",
            report.skips
        );
    }

    /// The whole report is one stored JSON column, so its own keys are a wire surface.
    #[test]
    fn the_persisted_shape_of_a_report_is_pinned() {
        assert_eq!(
            serde_json::to_string(&EngineReport::default()).unwrap(),
            r#"{"findings":[],"skips":[],"judgements":0,"alerts_in_scope":0}"#
        );
    }

    #[test]
    fn a_report_survives_a_serialize_deserialize_serialize_round_trip() {
        let report = EngineReport {
            findings: vec![Finding {
                rule_id: "noise".to_string(),
                severity: Severity::Medium,
                confidence: Confidence::High,
                title: "disk latency fired 400 times".to_string(),
                subjects: vec![AlertRef::new("default", "a1", "disk latency")],
                evidence: Evidence::Noise {
                    firings: 400,
                    mean_time_to_normal_secs: 45.0,
                    incident_linkage_ratio: 0.0,
                },
                window: TimeRange::of_secs(WINDOW_SECS),
                actions: vec![ProposedAction::RaiseThreshold],
            }],
            skips: vec![Skip::new(
                "silent",
                AlertRef::new("prod", "a3", "payment failures"),
                SkipReason::InsufficientHistory {
                    required_secs: 2_592_000,
                    actual_secs: HISTORY_SECS,
                },
            )],
            judgements: 12,
            alerts_in_scope: 3,
        };
        let encoded = serde_json::to_string(&report).unwrap();
        let decoded: EngineReport = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, report);
        assert_eq!(serde_json::to_string(&decoded).unwrap(), encoded);
    }

    /// Disjointness rests on two independently tunable fields, so sweep rather than trust.
    #[test]
    fn no_alert_is_ever_both_silent_and_failing() {
        let mut silent_was_reachable = false;
        let mut failure_was_reachable = false;
        for cut in [0.05_f64, 0.10, 0.25, 0.50] {
            let rules: Vec<Box<dyn HygieneRule>> = vec![
                Box::new(SilentRule::new(SilentThresholds {
                    max_error_ratio: cut,
                    ..Default::default()
                })),
                Box::new(FailureRule::new(FailureThresholds {
                    min_error_ratio: cut,
                    ..Default::default()
                })),
            ];
            for errors in [
                0_u64, 1, 29, 30, 31, 59, 60, 61, 149, 150, 151, 299, 300, 301, 600,
            ] {
                let ctx = AnalysisContext::new(
                    TimeRange::of_secs(60 * 86_400),
                    vec![AlertFacts {
                        alert: AlertRef::new("default", "a9", "quiet but broken"),
                        enabled: true,
                        history: TimeRange::of_secs(45 * 86_400),
                        sample_count: 300,
                        evaluations: 600,
                        evaluation_errors: errors,
                        firings: 0,
                        destination_count: 1,
                        ..Default::default()
                    }],
                );
                let report = run(&rules, &ctx);
                let ids: BTreeSet<&str> =
                    report.findings.iter().map(|f| f.rule_id.as_str()).collect();
                silent_was_reachable |= ids.contains("silent");
                failure_was_reachable |= ids.contains("failure");
                assert!(
                    !(ids.contains("silent") && ids.contains("failure")),
                    "cut {cut} with {errors} errors drew both a deletion and a repair"
                );
            }
        }
        // Without these the assertion above passes whenever neither rule can fire.
        assert!(
            silent_was_reachable,
            "no input ever produced a silent finding"
        );
        assert!(
            failure_was_reachable,
            "no input ever produced a failure finding"
        );
    }

    /// Two findings from one rule are ordered by subject; without the tie-break they
    /// would fall back to input order, which the collector does not guarantee.
    #[test]
    fn same_rule_findings_are_ordered_by_subject_not_by_input_order() {
        let subjects = ["a3", "a1", "a2"];
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            subjects
                .iter()
                .map(|id| AlertFacts {
                    alert: AlertRef::new("default", id, "disk latency"),
                    ..noisy()
                })
                .collect(),
        );
        let report = run(&default_rules(), &ctx);
        let ordered: Vec<&str> = report
            .findings
            .iter()
            .filter(|f| f.rule_id == "noise")
            .map(|f| f.subjects[0].alert_id.as_str())
            .collect();
        assert_eq!(ordered, vec!["a1", "a2", "a3"]);
    }

    /// Same rule and same subject, so only the title can separate them.
    #[test]
    fn same_subject_findings_are_ordered_by_title() {
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(WINDOW_SECS),
            vec![
                AlertFacts {
                    firings: 900,
                    ..noisy()
                },
                AlertFacts {
                    firings: 400,
                    ..noisy()
                },
            ],
        );
        let report = run(&default_rules(), &ctx);
        let titles: Vec<&str> = report
            .findings
            .iter()
            .filter(|f| f.rule_id == "noise")
            .map(|f| f.title.as_str())
            .collect();
        assert_eq!(titles.len(), 2);
        assert!(titles[0] < titles[1], "unordered: {titles:?}");
    }
}
