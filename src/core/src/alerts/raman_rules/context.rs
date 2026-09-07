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

//! Pre-aggregated per-alert facts that every hygiene rule reads.

use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const MICROS_PER_SEC: i64 = 1_000_000;

/// Identity of one alert, unique on `(org_id, alert_id)`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct AlertRef {
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: String,
}

/// Half-open microsecond span, matching the timestamp unit used across o2.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct TimeRange {
    pub start_micros: i64,
    pub end_micros: i64,
}

/// One bucket of evaluation errors sharing a normalised message.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ErrorCluster {
    pub normalised_message: String,
    pub count: u64,
}

/// Aggregated outcome of one alert over the analysis window; never raw rows.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AlertFacts {
    pub alert: AlertRef,
    /// Whether the alert is enabled at the moment the digest runs.
    pub enabled: bool,
    /// Whether incident correlation is opted into; without it there is no linkage signal.
    pub creates_incident: bool,
    /// The alert's observed lifetime in the data, first to last observation.
    pub history: TimeRange,
    /// Rows backing this aggregate; below `evaluations` when the collector groups in SQL.
    pub sample_count: usize,
    /// Includes errored runs, so `evaluation_errors` is a subset and no ratio exceeds one.
    pub evaluations: u64,
    /// Evaluations whose condition matched; a subset of `evaluations`.
    pub firings: u64,
    /// `None` is unmeasurable (never resolved or not collected), never evidence of speed.
    pub mean_time_to_normal_secs: Option<f64>,
    /// Firings the correlator linked; a subset, meaningful only under `creates_incident`.
    pub incident_linked_firings: u64,
    /// Evaluations that failed to run; a subset of `evaluations`.
    pub evaluation_errors: u64,
    pub error_clusters: Vec<ErrorCluster>,
    /// Delivery attempts across all destinations, so one firing may contribute many.
    pub notification_attempts: u64,
    /// Attempts that failed; a subset of `notification_attempts`.
    pub notification_failures: u64,
    /// Destinations attached **now**, not when the alert fired.
    pub destination_count: usize,
}

/// Everything a rule run may read; there is no other input and no I/O.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AnalysisContext {
    pub window: TimeRange,
    pub alerts: Vec<AlertFacts>,
}

impl AlertRef {
    pub fn new(org_id: &str, alert_id: &str, alert_name: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            alert_id: alert_id.to_string(),
            alert_name: alert_name.to_string(),
        }
    }

    pub fn sort_key(&self) -> (&str, &str) {
        (self.org_id.as_str(), self.alert_id.as_str())
    }
}

impl TimeRange {
    pub fn new(start_micros: i64, end_micros: i64) -> Self {
        Self {
            start_micros,
            end_micros,
        }
    }

    pub fn of_secs(secs: i64) -> Self {
        Self::new(0, secs.saturating_mul(MICROS_PER_SEC))
    }

    pub fn span_secs(&self) -> i64 {
        self.end_micros.saturating_sub(self.start_micros).max(0) / MICROS_PER_SEC
    }

    pub fn span(&self) -> Duration {
        Duration::from_secs(self.span_secs() as u64)
    }
}

impl ErrorCluster {
    pub fn new(normalised_message: &str, count: u64) -> Self {
        Self {
            normalised_message: normalised_message.to_string(),
            count,
        }
    }
}

impl AlertFacts {
    pub fn incident_linkage_ratio(&self) -> f64 {
        ratio(self.incident_linked_firings, self.firings)
    }

    pub fn error_ratio(&self) -> f64 {
        ratio(self.evaluation_errors, self.evaluations)
    }

    pub fn notification_failure_ratio(&self) -> f64 {
        ratio(self.notification_failures, self.notification_attempts)
    }

    pub fn top_error_cluster(&self) -> Option<&ErrorCluster> {
        self.error_clusters.iter().max_by(|a, b| {
            a.count
                .cmp(&b.count)
                .then(b.normalised_message.cmp(&a.normalised_message))
        })
    }
}

impl AnalysisContext {
    pub fn new(window: TimeRange, alerts: Vec<AlertFacts>) -> Self {
        Self { window, alerts }
    }

    pub fn is_empty(&self) -> bool {
        self.alerts.is_empty()
    }

    pub fn contains(&self, alert: &AlertRef) -> bool {
        self.alerts
            .iter()
            .any(|f| f.alert.sort_key() == alert.sort_key())
    }
}

/// Counters are aggregated independently, so a numerator may outrun its denominator.
fn ratio(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 {
        return 0.0;
    }
    (numerator as f64 / denominator as f64).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_span_is_reported_in_whole_seconds() {
        assert_eq!(TimeRange::of_secs(3600).span_secs(), 3600);
        assert_eq!(TimeRange::of_secs(3600).span(), Duration::from_secs(3600));
    }

    #[test]
    fn an_inverted_range_has_a_zero_span_rather_than_a_negative_one() {
        assert_eq!(TimeRange::new(10 * MICROS_PER_SEC, 0).span_secs(), 0);
    }

    #[test]
    fn an_extreme_range_saturates_rather_than_overflowing() {
        let saturated = i64::MAX / MICROS_PER_SEC;
        assert_eq!(TimeRange::new(i64::MIN, i64::MAX).span_secs(), saturated);
        assert_eq!(TimeRange::of_secs(i64::MAX).span_secs(), saturated);
    }

    #[test]
    fn a_ratio_over_no_denominator_is_zero_rather_than_a_nan() {
        let facts = AlertFacts::default();
        assert_eq!(facts.incident_linkage_ratio(), 0.0);
        assert_eq!(facts.error_ratio(), 0.0);
        assert_eq!(facts.notification_failure_ratio(), 0.0);
    }

    /// Counts with no denominator carry no rate, so they read as zero rather than one.
    #[test]
    fn a_positive_numerator_over_no_denominator_is_still_zero() {
        let facts = AlertFacts {
            incident_linked_firings: 7,
            evaluation_errors: 7,
            notification_failures: 7,
            ..Default::default()
        };
        assert_eq!(facts.incident_linkage_ratio(), 0.0);
        assert_eq!(facts.error_ratio(), 0.0);
        assert_eq!(facts.notification_failure_ratio(), 0.0);
    }

    /// Every caller of these ratios gets the clamp, not just the rules that gate on it.
    #[test]
    fn a_numerator_larger_than_its_denominator_clamps_at_one() {
        let facts = AlertFacts {
            firings: 400,
            incident_linked_firings: 500,
            evaluations: 100,
            evaluation_errors: 120,
            notification_attempts: 200,
            notification_failures: 250,
            ..Default::default()
        };
        assert_eq!(facts.incident_linkage_ratio(), 1.0);
        assert_eq!(facts.error_ratio(), 1.0);
        assert_eq!(facts.notification_failure_ratio(), 1.0);
    }

    #[test]
    fn a_ratio_below_one_is_left_alone() {
        let facts = AlertFacts {
            firings: 400,
            incident_linked_firings: 100,
            evaluations: 100,
            evaluation_errors: 30,
            notification_attempts: 200,
            notification_failures: 40,
            ..Default::default()
        };
        assert_eq!(facts.incident_linkage_ratio(), 0.25);
        assert_eq!(facts.error_ratio(), 0.3);
        assert_eq!(facts.notification_failure_ratio(), 0.2);
    }

    #[test]
    fn the_top_error_cluster_is_the_largest_and_ties_break_on_message() {
        let facts = AlertFacts {
            error_clusters: vec![
                ErrorCluster::new("stream not found", 4),
                ErrorCluster::new("permission denied", 4),
                ErrorCluster::new("timeout", 1),
            ],
            ..Default::default()
        };
        assert_eq!(
            facts
                .top_error_cluster()
                .map(|c| c.normalised_message.as_str()),
            Some("permission denied")
        );
    }

    #[test]
    fn a_context_knows_which_alerts_it_carries() {
        let present = AlertRef::new("default", "a1", "cpu high");
        let absent = AlertRef::new("default", "a2", "disk full");
        let ctx = AnalysisContext::new(
            TimeRange::of_secs(3600),
            vec![AlertFacts {
                alert: present.clone(),
                ..Default::default()
            }],
        );
        assert!(ctx.contains(&present));
        assert!(!ctx.contains(&absent));
        assert!(!ctx.is_empty());
    }
}
