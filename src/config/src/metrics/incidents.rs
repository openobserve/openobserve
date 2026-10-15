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

//! Incident correlation metrics, the baselines the correlation changes are measured against.

use std::{collections::HashMap, sync::LazyLock as Lazy};

use prometheus::{IntCounterVec, IntGaugeVec, Opts};

use super::{NAMESPACE, create_const_labels};
use crate::meta::alerts::incidents::DimensionRelationship;

/// The `bucket` label values of [INCIDENTS_OPEN_BY_ALERT_COUNT], smallest first.
pub const ALERT_COUNT_BUCKETS: [&str; 5] = ["1", "2-10", "11-100", "101-1000", "1000+"];

/// A firing joining an open incident, by the rule that let it in or kept it out.
pub static INCIDENT_CORRELATION_JOINS: Lazy<IntCounterVec> = Lazy::new(|| {
    IntCounterVec::new(
        Opts::new(
            "incident_correlation_joins_total",
            "Firings correlated into an open incident, by the matching rule that decided it.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "rule"],
    )
    .expect("Metric created")
});

/// Open incidents by how many alert firings they hold; recomputed by the stale sweep.
pub static INCIDENTS_OPEN_BY_ALERT_COUNT: Lazy<IntGaugeVec> = Lazy::new(|| {
    IntGaugeVec::new(
        Opts::new(
            "incidents_open_by_alert_count",
            "Open incidents by the number of alert firings correlated into them.",
        )
        .namespace(NAMESPACE)
        .const_labels(create_const_labels()),
        &["organization", "bucket"],
    )
    .expect("Metric created")
});

/// Why a firing joined, or was kept out of, an open incident.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinRule {
    /// Joined without changing the incident's dimensions (equal or subset).
    Exact,
    SupersetUpgrade,
    /// Strict correlation kept a firing out of another alert's empty-dimension incident.
    EmptyDimensionRejected,
    /// Non-strict correlation let a firing into an empty-dimension incident.
    EmptyDimensionJoined,
}

impl JoinRule {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::SupersetUpgrade => "superset_upgrade",
            Self::EmptyDimensionRejected => "empty_dimension_rejected",
            Self::EmptyDimensionJoined => "empty_dimension_joined",
        }
    }

    /// The rule a join was decided by; an own alert-id upgrade under strict counts as an upgrade.
    pub fn for_join(
        relationship: DimensionRelationship,
        existing_dims_empty: bool,
        strict: bool,
    ) -> Option<Self> {
        match relationship {
            DimensionRelationship::Equal | DimensionRelationship::NewIsSubset => Some(Self::Exact),
            DimensionRelationship::NewIsSuperset if existing_dims_empty && !strict => {
                Some(Self::EmptyDimensionJoined)
            }
            DimensionRelationship::NewIsSuperset => Some(Self::SupersetUpgrade),
            DimensionRelationship::PartialOverlap | DimensionRelationship::Incompatible => None,
        }
    }
}

/// Registers the incident metrics on `registry`.
pub(super) fn register(registry: &prometheus::Registry) {
    registry
        .register(Box::new(INCIDENT_CORRELATION_JOINS.clone()))
        .expect("Metric registered");
    registry
        .register(Box::new(INCIDENTS_OPEN_BY_ALERT_COUNT.clone()))
        .expect("Metric registered");
}

/// One correlation decision.
pub fn correlation_join(org_id: &str, rule: JoinRule) {
    INCIDENT_CORRELATION_JOINS
        .with_label_values(&[org_id, rule.as_str()])
        .inc();
}

/// The [ALERT_COUNT_BUCKETS] value an incident holding `alert_count` firings falls in.
pub fn alert_count_bucket(alert_count: i64) -> &'static str {
    match alert_count {
        ..=1 => ALERT_COUNT_BUCKETS[0],
        2..=10 => ALERT_COUNT_BUCKETS[1],
        11..=100 => ALERT_COUNT_BUCKETS[2],
        101..=1000 => ALERT_COUNT_BUCKETS[3],
        _ => ALERT_COUNT_BUCKETS[4],
    }
}

/// Incident counts per (org, bucket) from `(org, alert_count, incidents)` rows.
pub fn open_by_alert_count(
    rows: impl IntoIterator<Item = (String, i64, i64)>,
) -> HashMap<(String, &'static str), i64> {
    let mut out = HashMap::new();
    for (org_id, alert_count, incidents) in rows {
        *out.entry((org_id, alert_count_bucket(alert_count)))
            .or_insert(0) += incidents;
    }
    out
}

/// Replaces the gauge, so an org or bucket that emptied since the last sweep reads zero.
pub fn set_open_by_alert_count(counts: &HashMap<(String, &'static str), i64>) {
    INCIDENTS_OPEN_BY_ALERT_COUNT.reset();
    let orgs: std::collections::HashSet<&str> =
        counts.keys().map(|(org_id, _)| org_id.as_str()).collect();
    for org_id in orgs {
        for bucket in ALERT_COUNT_BUCKETS {
            let value = counts
                .get(&(org_id.to_string(), bucket))
                .copied()
                .unwrap_or(0);
            INCIDENTS_OPEN_BY_ALERT_COUNT
                .with_label_values(&[org_id, bucket])
                .set(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use prometheus::Registry;

    use super::*;

    #[test]
    fn test_every_incident_metric_registers_once() {
        let registry = Registry::new();
        register(&registry);
        INCIDENT_CORRELATION_JOINS
            .with_label_values(&["org_reg", "exact"])
            .inc();
        assert!(
            registry
                .gather()
                .iter()
                .any(|m| m.name() == "zo_incident_correlation_joins_total")
        );
    }

    #[test]
    fn test_join_rule_names_the_decision() {
        use DimensionRelationship::*;
        for strict in [true, false] {
            assert_eq!(
                JoinRule::for_join(Equal, false, strict),
                Some(JoinRule::Exact)
            );
            assert_eq!(
                JoinRule::for_join(NewIsSubset, false, strict),
                Some(JoinRule::Exact)
            );
            assert_eq!(
                JoinRule::for_join(NewIsSuperset, false, strict),
                Some(JoinRule::SupersetUpgrade)
            );
            assert_eq!(JoinRule::for_join(PartialOverlap, false, strict), None);
            assert_eq!(JoinRule::for_join(Incompatible, true, strict), None);
        }
        assert_eq!(
            JoinRule::for_join(NewIsSuperset, true, false),
            Some(JoinRule::EmptyDimensionJoined)
        );
        assert_eq!(
            JoinRule::for_join(NewIsSuperset, true, true),
            Some(JoinRule::SupersetUpgrade),
            "strict only lets an alert upgrade its own alert-id incident"
        );
        assert_eq!(
            JoinRule::EmptyDimensionRejected.as_str(),
            "empty_dimension_rejected"
        );
    }

    #[test]
    fn test_alert_count_buckets_cover_every_count() {
        let cases = [
            (0, "1"),
            (1, "1"),
            (2, "2-10"),
            (10, "2-10"),
            (11, "11-100"),
            (100, "11-100"),
            (101, "101-1000"),
            (1000, "101-1000"),
            (1001, "1000+"),
        ];
        for (count, bucket) in cases {
            assert_eq!(alert_count_bucket(count), bucket, "{count}");
        }
    }

    #[test]
    fn test_open_by_alert_count_sums_rows_into_buckets() {
        let counts = open_by_alert_count([
            ("a".to_string(), 3, 2),
            ("a".to_string(), 7, 1),
            ("a".to_string(), 1, 4),
            ("b".to_string(), 5000, 1),
        ]);
        assert_eq!(counts.get(&("a".to_string(), "2-10")), Some(&3));
        assert_eq!(counts.get(&("a".to_string(), "1")), Some(&4));
        assert_eq!(counts.get(&("b".to_string(), "1000+")), Some(&1));
        assert_eq!(counts.len(), 3);
    }

    #[test]
    fn test_setting_the_gauge_zeroes_buckets_that_emptied() {
        let org = "org_gauge_reset";
        set_open_by_alert_count(&open_by_alert_count([(org.to_string(), 50, 2)]));
        let read = |bucket| {
            INCIDENTS_OPEN_BY_ALERT_COUNT
                .with_label_values(&[org, bucket])
                .get()
        };
        assert_eq!(read("11-100"), 2);
        assert_eq!(read("1"), 0);
        set_open_by_alert_count(&open_by_alert_count([(org.to_string(), 1, 1)]));
        assert_eq!(read("11-100"), 0);
        assert_eq!(read("1"), 1);
    }
}
