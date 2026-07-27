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

//! Multi-level thresholds for AGGREGATION alerts — `alerts_2.md` §4.4.
//!
//! Aggregation alerts do NOT use `TriggerCondition.threshold`. Their critical
//! threshold is `Aggregation.having.value` — a `serde_json::Value`, so it may
//! be an int, a float, or a JSON string holding a number. The warning
//! counterpart is `Aggregation.warning_value` (already f64).
//!
//! Classification funnels through `level::evaluate_level_values`, the same core
//! the count path uses, so the two cannot disagree about precedence or
//! boundaries.

use serde_json::Value;

use super::{
    Aggregation, Operator,
    level::{AlertLevel, compare, evaluate_level_values},
};

/// Why an aggregation's threshold pair could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggThresholdError {
    /// `having.value` is not a number and not a numeric string.
    ///
    /// Deliberately an error rather than a default: coercing to `0.0` would
    /// make every group critical under `>`.
    NonNumericCritical,
    /// The warning value is not strictly less severe than critical, given the
    /// operator's direction.
    WarningNotLessSevere,
    /// `having.operator` has no severity ordering, so a warning value is
    /// meaningless.
    OperatorNotOrderable,
}

impl std::fmt::Display for AggThresholdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NonNumericCritical => {
                f.write_str("aggregation threshold (having.value) is not numeric")
            }
            Self::WarningNotLessSevere => f.write_str(
                "aggregation warning value must be less severe than the having threshold",
            ),
            Self::OperatorNotOrderable => f.write_str(
                "the aggregation operator has no severity ordering; a warning value is not supported",
            ),
        }
    }
}

impl std::error::Error for AggThresholdError {}

/// Coerce an untyped condition value to f64.
///
/// Accepts JSON numbers and numeric strings — the UI has historically submitted
/// condition values as strings. Everything else is rejected.
fn as_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// Extract `(critical, warning)` for an aggregation alert.
pub fn aggregation_thresholds(agg: &Aggregation) -> Result<(f64, Option<f64>), AggThresholdError> {
    let critical = as_f64(&agg.having.value).ok_or(AggThresholdError::NonNumericCritical)?;
    Ok((critical, agg.warning_value))
}

/// Classify one aggregate value against an aggregation's thresholds.
///
/// Shares `evaluate_level_values` with the count path — see
/// `test_paths_agree_on_identical_inputs`.
pub fn evaluate_aggregation_level(
    actual: f64,
    agg: &Aggregation,
) -> Result<Option<AlertLevel>, AggThresholdError> {
    let (critical, warning) = aggregation_thresholds(agg)?;
    Ok(evaluate_level_values(
        actual,
        agg.having.operator,
        critical,
        warning,
    ))
}

/// Value the SQL `HAVING` clause should filter on (§4.4 option B).
///
/// The clause widens to the **less severe** threshold so every group that could
/// be warning-or-worse is returned, and Rust then classifies each one. Filtering
/// on the critical threshold instead would drop the entire warning band inside
/// the database, where no amount of downstream logic could recover it.
///
/// One query per evaluation, and classification stays in the shared helper.
pub fn having_filter_value(agg: &Aggregation) -> Result<f64, AggThresholdError> {
    let (critical, warning) = aggregation_thresholds(agg)?;
    Ok(widened_threshold(agg.having.operator, critical, warning))
}

/// Widened comparison value for the "one query, both bands" strategy.
///
/// Returns the LESS severe of the two thresholds, so a single query/filter
/// admits every item that could be warning-or-worse. Shared by the SQL
/// `HAVING` clause and the PromQL expression, which face the same problem.
pub fn widened_threshold(op: Operator, critical: f64, warning: Option<f64>) -> f64 {
    let Some(w) = warning else { return critical };
    match op {
        // Larger is more severe -> the smaller value is the wider net.
        Operator::GreaterThan | Operator::GreaterThanEquals => critical.min(w),
        // Smaller is more severe -> the larger value is the wider net.
        Operator::LessThan | Operator::LessThanEquals => critical.max(w),
        // Unorderable operators cannot carry a warning (validation rejects
        // them); fall back to critical rather than guessing.
        _ => critical,
    }
}

/// The two-axis evaluator shared by every alert type whose threshold is
/// applied per ITEM and then gated by an item COUNT.
///
/// Both aggregation alerts (per group, then group count) and PromQL alerts
/// (per series, then series count) have this shape:
///
/// 1. each item's value is classified against critical / warning
/// 2. the alert fires only if enough items matched, per `TriggerCondition`
///
/// Counts are tracked separately per level so an item in the warning band
/// cannot inflate the critical count. With `warning = None` this reduces
/// exactly to the legacy behaviour (G5).
pub fn evaluate_level_over_items(
    item_values: &[f64],
    op: Operator,
    critical: f64,
    warning: Option<f64>,
    tc: &crate::meta::alerts::TriggerCondition,
) -> Option<AlertLevel> {
    let mut critical_items = 0i64;
    let mut firing_items = 0i64; // warning-or-worse

    for v in item_values {
        match evaluate_level_values(*v, op, critical, warning) {
            Some(AlertLevel::Critical) => {
                critical_items += 1;
                firing_items += 1;
            }
            Some(AlertLevel::Warning) => firing_items += 1,
            _ => {}
        }
    }

    if compare(critical_items as f64, tc.operator, tc.threshold as f64) {
        return Some(AlertLevel::Critical);
    }
    if warning.is_some() || tc.warning_threshold.is_some() {
        let count_threshold = tc.warning_threshold.unwrap_or(tc.threshold);
        if compare(firing_items as f64, tc.operator, count_threshold as f64) {
            return Some(AlertLevel::Warning);
        }
    }
    None
}

/// Aggregation wrapper over [`evaluate_level_over_items`]: per-group value
/// classification plus the group-count threshold.
pub fn evaluate_aggregation_alert(
    group_values: &[f64],
    agg: &Aggregation,
    tc: &crate::meta::alerts::TriggerCondition,
) -> Result<Option<AlertLevel>, AggThresholdError> {
    let (critical, warning) = aggregation_thresholds(agg)?;
    Ok(evaluate_level_over_items(
        group_values,
        agg.having.operator,
        critical,
        warning,
        tc,
    ))
}

/// `ORDER BY` fragment that sorts groups **worst-first** for a multi-alert's
/// bounded fetch (`alerts_2.md` §5.3).
///
/// The multi path drops the `HAVING` filter so healthy groups come back too
/// (otherwise a recovering group is indistinguishable from a vanished one), but
/// it still reads a bounded page. Ordering is what makes that page usable: the
/// worst groups are provably inside it, so the rollup level is always exact and
/// the M-6 cap admits the true top of the distribution.
///
/// Buckets by **severity band**, not by raw value. Ordering by the aggregate
/// itself would retain "most extreme within a band", so ordinary jitter between
/// two equally-Critical groups would churn the retained row set every
/// evaluation — the instability `classify_groups`' `(severity_rank desc,
/// group_key asc)` admission contract exists to avoid. Callers append the
/// `group_by` columns as a deterministic tiebreak.
///
/// Requires an orderable operator; `=`/`!=` have no worst-first direction,
/// which is why M-10 refuses them for multi-alerts.
pub fn severity_order_sql(agg: &Aggregation, value_alias: &str) -> Result<String, AggThresholdError> {
    let (critical, warning) = aggregation_thresholds(agg)?;
    let op = match agg.having.operator {
        Operator::GreaterThan => ">",
        Operator::GreaterThanEquals => ">=",
        Operator::LessThan => "<",
        Operator::LessThanEquals => "<=",
        _ => return Err(AggThresholdError::OperatorNotOrderable),
    };

    let mut sql = format!("CASE WHEN \"{value_alias}\" {op} {critical} THEN 2");
    if let Some(w) = warning {
        sql.push_str(&format!(" WHEN \"{value_alias}\" {op} {w} THEN 1"));
    }
    sql.push_str(" ELSE 0 END DESC");
    Ok(sql)
}

/// Validate an aggregation's threshold pair (§4.5, applied to
/// `having.operator`).
pub fn validate_aggregation_thresholds(agg: &Aggregation) -> Result<(), AggThresholdError> {
    let (critical, warning) = aggregation_thresholds(agg)?;
    let Some(warning) = warning else {
        // Single-level aggregations stay valid for every operator (G5).
        return Ok(());
    };
    match agg.having.operator {
        Operator::GreaterThan | Operator::GreaterThanEquals if warning < critical => Ok(()),
        Operator::LessThan | Operator::LessThanEquals if warning > critical => Ok(()),
        Operator::GreaterThan
        | Operator::GreaterThanEquals
        | Operator::LessThan
        | Operator::LessThanEquals => Err(AggThresholdError::WarningNotLessSevere),
        _ => Err(AggThresholdError::OperatorNotOrderable),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::meta::alerts::{
        AggFunction, Aggregation, Condition, Operator, TriggerCondition,
        aggregation_level::{
            AggThresholdError, aggregation_thresholds, evaluate_aggregation_alert,
            evaluate_aggregation_level, evaluate_level_over_items, having_filter_value,
            severity_order_sql, validate_aggregation_thresholds,
        },
        level::{AlertLevel, evaluate_level_values},
    };

    fn having(op: Operator, value: serde_json::Value) -> Condition {
        Condition {
            column: "alert_agg_value".to_string(),
            operator: op,
            value,
            ignore_case: false,
        }
    }

    fn agg(op: Operator, critical: serde_json::Value, warning: Option<f64>) -> Aggregation {
        Aggregation {
            group_by: None,
            function: AggFunction::Avg,
            having: having(op, critical),
            warning_value: warning,
            multi_alert: false,
        }
    }

    // ── having.value extraction ─────────────────────────────────────────────
    // `Value` is untyped, so every shape a user or an older payload can produce
    // must be handled explicitly. Silent coercion is the dangerous failure:
    // a non-numeric threshold read as 0.0 would make EVERY group critical
    // under `>`.

    #[test]
    fn test_extracts_integer_threshold() {
        let a = agg(Operator::GreaterThan, json!(100), None);
        assert_eq!(aggregation_thresholds(&a).unwrap(), (100.0, None));
    }

    #[test]
    fn test_extracts_float_threshold() {
        let a = agg(Operator::GreaterThan, json!(99.5), None);
        assert_eq!(aggregation_thresholds(&a).unwrap(), (99.5, None));
    }

    /// The UI has historically submitted numeric condition values as strings.
    #[test]
    fn test_extracts_numeric_string_threshold() {
        let a = agg(Operator::GreaterThan, json!("100"), None);
        assert_eq!(aggregation_thresholds(&a).unwrap(), (100.0, None));

        let a = agg(Operator::GreaterThan, json!("99.5"), None);
        assert_eq!(aggregation_thresholds(&a).unwrap(), (99.5, None));
    }

    #[test]
    fn test_extracts_negative_threshold() {
        let a = agg(Operator::LessThan, json!(-5.5), None);
        assert_eq!(aggregation_thresholds(&a).unwrap(), (-5.5, None));
    }

    #[test]
    fn test_non_numeric_threshold_is_an_error_not_zero() {
        for bad in [
            json!("abc"),
            json!(null),
            json!(true),
            json!([1]),
            json!({}),
        ] {
            let a = agg(Operator::GreaterThan, bad.clone(), None);
            assert_eq!(
                aggregation_thresholds(&a),
                Err(AggThresholdError::NonNumericCritical),
                "threshold {bad} must fail loudly; coercing to 0.0 would make \
                 every group critical under `>`"
            );
        }
    }

    #[test]
    fn test_warning_value_is_carried_through() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        assert_eq!(aggregation_thresholds(&a).unwrap(), (100.0, Some(50.0)));
    }

    #[test]
    fn test_absent_warning_value_means_single_level() {
        let a = agg(Operator::GreaterThan, json!(100), None);
        assert_eq!(aggregation_thresholds(&a).unwrap().1, None);
    }

    /// Older stored aggregations have no `warning_value` key at all.
    #[test]
    fn test_aggregation_deserializes_without_warning_value() {
        let raw = json!({
            "group_by": ["host"],
            "function": "avg",
            "having": { "column": "alert_agg_value", "operator": ">", "value": 100 }
        });
        let a: Aggregation = serde_json::from_value(raw).unwrap();
        assert_eq!(a.warning_value, None, "absent = single-level, not an error");
    }

    // ── Classification ──────────────────────────────────────────────────────

    #[test]
    fn test_critical_takes_precedence_for_aggregations() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        assert_eq!(
            evaluate_aggregation_level(150.0, &a).unwrap(),
            Some(AlertLevel::Critical)
        );
    }

    #[test]
    fn test_warning_band_for_aggregations() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        assert_eq!(
            evaluate_aggregation_level(75.0, &a).unwrap(),
            Some(AlertLevel::Warning)
        );
    }

    #[test]
    fn test_no_match_for_aggregations() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        assert_eq!(evaluate_aggregation_level(10.0, &a).unwrap(), None);
    }

    #[test]
    fn test_fractional_aggregate_values() {
        // The whole reason aggregation thresholds are f64: averages are not
        // integers.
        let a = agg(Operator::GreaterThanEquals, json!(99.5), Some(50.25));
        assert_eq!(
            evaluate_aggregation_level(99.5, &a).unwrap(),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            evaluate_aggregation_level(50.25, &a).unwrap(),
            Some(AlertLevel::Warning)
        );
        assert_eq!(evaluate_aggregation_level(50.24, &a).unwrap(), None);
    }

    #[test]
    fn test_less_than_direction_for_aggregations() {
        // For `<`, critical is the SMALLER number.
        let a = agg(Operator::LessThan, json!(10.0), Some(25.0));
        assert_eq!(
            evaluate_aggregation_level(5.0, &a).unwrap(),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            evaluate_aggregation_level(20.0, &a).unwrap(),
            Some(AlertLevel::Warning)
        );
        assert_eq!(evaluate_aggregation_level(30.0, &a).unwrap(), None);
    }

    #[test]
    fn test_classification_propagates_extraction_errors() {
        let a = agg(Operator::GreaterThan, json!("nonsense"), None);
        assert_eq!(
            evaluate_aggregation_level(1.0, &a),
            Err(AggThresholdError::NonNumericCritical)
        );
    }

    // ── The property that keeps the two paths honest ────────────────────────

    /// The count path and the aggregation path must classify identical inputs
    /// identically. §4.4 warns that a divergence here is silent — both paths
    /// keep working, they just disagree about severity.
    #[test]
    fn test_paths_agree_on_identical_inputs() {
        let cases: &[(Operator, f64, Option<f64>)] = &[
            (Operator::GreaterThan, 100.0, Some(50.0)),
            (Operator::GreaterThanEquals, 100.0, Some(50.0)),
            (Operator::LessThan, 10.0, Some(25.0)),
            (Operator::LessThanEquals, 10.0, Some(25.0)),
            (Operator::GreaterThan, 100.0, None),
        ];
        let actuals = [0.0, 9.9, 10.0, 25.0, 49.9, 50.0, 99.9, 100.0, 150.0];

        for (op, critical, warning) in cases {
            let a = agg(*op, json!(*critical), *warning);
            for actual in actuals {
                let via_agg = evaluate_aggregation_level(actual, &a).unwrap();
                let via_values = evaluate_level_values(actual, *op, *critical, *warning);
                assert_eq!(
                    via_agg, via_values,
                    "paths disagree: op={op:?} crit={critical} warn={warning:?} actual={actual}"
                );
            }
        }
    }

    // ── Validation parity (§4.5 applied to having.operator) ─────────────────

    #[test]
    fn test_validation_accepts_correct_direction() {
        assert!(
            validate_aggregation_thresholds(&agg(Operator::GreaterThan, json!(100), Some(50.0)))
                .is_ok()
        );
        assert!(
            validate_aggregation_thresholds(&agg(Operator::LessThan, json!(10), Some(25.0)))
                .is_ok()
        );
    }

    #[test]
    fn test_validation_rejects_wrong_direction() {
        let a = agg(Operator::GreaterThan, json!(50), Some(100.0));
        assert_eq!(
            validate_aggregation_thresholds(&a),
            Err(AggThresholdError::WarningNotLessSevere)
        );
    }

    #[test]
    fn test_validation_rejects_equal_thresholds() {
        let a = agg(Operator::GreaterThan, json!(100), Some(100.0));
        assert_eq!(
            validate_aggregation_thresholds(&a),
            Err(AggThresholdError::WarningNotLessSevere)
        );
    }

    #[test]
    fn test_validation_rejects_unorderable_operators() {
        for op in [Operator::EqualTo, Operator::NotEqualTo] {
            let a = agg(op, json!(100), Some(50.0));
            assert_eq!(
                validate_aggregation_thresholds(&a),
                Err(AggThresholdError::OperatorNotOrderable),
                "{op:?} has no severity ordering"
            );
        }
    }

    #[test]
    fn test_validation_accepts_single_level_for_every_operator() {
        // G5: aggregation alerts with no warning value stay valid regardless of
        // operator — including the unorderable ones that are legal today.
        for op in [
            Operator::EqualTo,
            Operator::NotEqualTo,
            Operator::GreaterThan,
            Operator::GreaterThanEquals,
            Operator::LessThan,
            Operator::LessThanEquals,
        ] {
            let a = agg(op, json!(100), None);
            assert!(
                validate_aggregation_thresholds(&a).is_ok(),
                "{op:?} must stay valid without a warning value"
            );
        }
    }

    #[test]
    fn test_validation_rejects_non_numeric_critical() {
        let a = agg(Operator::GreaterThan, json!("abc"), Some(50.0));
        assert_eq!(
            validate_aggregation_thresholds(&a),
            Err(AggThresholdError::NonNumericCritical)
        );
    }

    // ── Per-group classification (feeds Feature 3, multi-alerts) ──────────────────────────

    /// `HAVING` is evaluated per group in the database, so the classifier must
    /// work over a set of per-group aggregate values.
    #[test]
    fn test_per_group_aggregate_values_classify_independently() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let per_group = [("host-a", 150.0), ("host-b", 75.0), ("host-c", 10.0)];

        let levels: Vec<_> = per_group
            .iter()
            .map(|(_, v)| evaluate_aggregation_level(*v, &a).unwrap())
            .collect();

        assert_eq!(levels[0], Some(AlertLevel::Critical));
        assert_eq!(levels[1], Some(AlertLevel::Warning));
        assert_eq!(levels[2], None);
    }

    // ── Group-count threshold (the OTHER axis) ──────────────────────────────
    // An aggregation alert has TWO thresholds, and the UI shows both rows:
    //   1. `having.value` / `warning_value` — the aggregate VALUE per group ("avg(latency) > 500")
    //   2. `trigger_condition.threshold`    — how many GROUPS must match ("...for at least 3
    //      groups")
    // Classifying per group without re-applying (2) silently turns "3 groups"
    // into "any group".

    fn tc(op: Operator, threshold: i64, warning: Option<i64>) -> TriggerCondition {
        TriggerCondition {
            operator: op,
            threshold,
            warning_threshold: warning,
            ..Default::default()
        }
    }

    /// Regression: the group-count threshold must still gate firing.
    #[test]
    fn test_group_count_threshold_is_still_applied() {
        // avg > 100 critical; needs >= 3 groups.
        let a = agg(Operator::GreaterThan, json!(100), None);
        let t = tc(Operator::GreaterThanEquals, 3, None);

        // Only 2 groups over the value threshold -> must NOT fire.
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 200.0], &a, &t).unwrap(),
            None,
            "2 groups cannot satisfy a >= 3 group-count threshold"
        );
        // 3 groups -> fires.
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 200.0, 300.0], &a, &t).unwrap(),
            Some(AlertLevel::Critical)
        );
    }

    /// With no warning value the behaviour must be byte-identical to the
    /// pre-multi-level implementation: count of HAVING-matching groups against
    /// the trigger threshold (G5).
    #[test]
    fn test_single_level_aggregation_matches_legacy_semantics() {
        let a = agg(Operator::GreaterThan, json!(100), None);
        let t = tc(Operator::GreaterThanEquals, 2, None);

        assert_eq!(
            evaluate_aggregation_alert(&[10.0, 20.0], &a, &t).unwrap(),
            None
        );
        assert_eq!(evaluate_aggregation_alert(&[150.0], &a, &t).unwrap(), None);
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 160.0], &a, &t).unwrap(),
            Some(AlertLevel::Critical)
        );
    }

    /// Warning counts groups that cross the WARNING value; critical counts only
    /// those crossing the critical value. A group in the warning band must not
    /// inflate the critical count.
    #[test]
    fn test_warning_and_critical_counts_are_independent() {
        // crit avg > 100, warn avg > 50; needs >= 2 groups either way.
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let t = tc(Operator::GreaterThanEquals, 2, None);

        // Two groups in the warning band only -> Warning, not Critical.
        assert_eq!(
            evaluate_aggregation_alert(&[60.0, 70.0], &a, &t).unwrap(),
            Some(AlertLevel::Warning)
        );
        // One critical + one warning: critical count is 1 (< 2) so it cannot be
        // Critical; warning-or-worse count is 2 -> Warning.
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 60.0], &a, &t).unwrap(),
            Some(AlertLevel::Warning)
        );
        // Two critical -> Critical.
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 160.0], &a, &t).unwrap(),
            Some(AlertLevel::Critical)
        );
    }

    /// A separate group-count warning threshold is honoured when present:
    /// "critical at 5 groups, warning at 2".
    #[test]
    fn test_group_count_warning_threshold_is_used_when_set() {
        let a = agg(Operator::GreaterThan, json!(100), None);
        let t = tc(Operator::GreaterThanEquals, 5, Some(2));

        assert_eq!(evaluate_aggregation_alert(&[150.0], &a, &t).unwrap(), None);
        assert_eq!(
            evaluate_aggregation_alert(&[150.0, 160.0], &a, &t).unwrap(),
            Some(AlertLevel::Warning),
            "2 groups meets the warning count but not the critical count"
        );
        let five = [150.0; 5];
        assert_eq!(
            evaluate_aggregation_alert(&five, &a, &t).unwrap(),
            Some(AlertLevel::Critical)
        );
    }

    #[test]
    fn test_no_matching_groups_never_fires() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let t = tc(Operator::GreaterThanEquals, 1, None);
        assert_eq!(
            evaluate_aggregation_alert(&[1.0, 2.0], &a, &t).unwrap(),
            None
        );
        assert_eq!(evaluate_aggregation_alert(&[], &a, &t).unwrap(), None);
    }

    // ── PromQL shares the same two-axis shape ───────────────────────────────
    // PromQL bakes the value threshold into the query itself
    // (`(expr) > 500`), then counts matching SERIES against
    // `trigger_condition.threshold` — structurally identical to aggregation's
    // HAVING + group-count. It therefore uses the same generalized evaluator,
    // so the three paths cannot drift apart.

    #[test]
    fn test_generalized_evaluator_matches_the_aggregation_wrapper() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let t = tc(Operator::GreaterThanEquals, 2, None);
        let values = [150.0, 60.0, 10.0];

        assert_eq!(
            evaluate_level_over_items(&values, Operator::GreaterThan, 100.0, Some(50.0), &t),
            evaluate_aggregation_alert(&values, &a, &t).unwrap(),
            "the aggregation wrapper must be a thin shim over the shared evaluator"
        );
    }

    #[test]
    fn test_promql_series_counting_with_two_levels() {
        // crit value > 500, warn > 300; fire when >= 2 series match.
        let t = tc(Operator::GreaterThanEquals, 2, None);

        // Two series over the WARNING value only -> Warning.
        assert_eq!(
            evaluate_level_over_items(
                &[350.0, 400.0],
                Operator::GreaterThan,
                500.0,
                Some(300.0),
                &t
            ),
            Some(AlertLevel::Warning)
        );
        // Two series over CRITICAL -> Critical.
        assert_eq!(
            evaluate_level_over_items(
                &[600.0, 700.0],
                Operator::GreaterThan,
                500.0,
                Some(300.0),
                &t
            ),
            Some(AlertLevel::Critical)
        );
        // One critical + one warning: critical count is 1 (< 2) -> Warning.
        assert_eq!(
            evaluate_level_over_items(
                &[600.0, 350.0],
                Operator::GreaterThan,
                500.0,
                Some(300.0),
                &t
            ),
            Some(AlertLevel::Warning)
        );
        // Below the series count -> nothing.
        assert_eq!(
            evaluate_level_over_items(&[600.0], Operator::GreaterThan, 500.0, Some(300.0), &t),
            None
        );
    }

    /// With no warning value, PromQL behaviour is unchanged: the query filters
    /// at the critical value and the series count decides (G5).
    #[test]
    fn test_promql_single_level_is_unchanged() {
        let t = tc(Operator::GreaterThanEquals, 2, None);
        assert_eq!(
            evaluate_level_over_items(&[600.0], Operator::GreaterThan, 500.0, None, &t),
            None
        );
        assert_eq!(
            evaluate_level_over_items(&[600.0, 700.0], Operator::GreaterThan, 500.0, None, &t),
            Some(AlertLevel::Critical)
        );
    }

    /// The widened filter value is the same concept for PromQL: query at the
    /// less severe threshold so the warning band comes back.
    #[test]
    fn test_widened_value_for_promql_style_thresholds() {
        use crate::meta::alerts::aggregation_level::widened_threshold;
        // `>`: warning is smaller -> query at the warning value.
        assert_eq!(
            widened_threshold(Operator::GreaterThan, 500.0, Some(300.0)),
            300.0
        );
        // `<`: warning is larger -> query at the warning value.
        assert_eq!(
            widened_threshold(Operator::LessThan, 10.0, Some(25.0)),
            25.0
        );
        // Single-level: the critical value.
        assert_eq!(widened_threshold(Operator::GreaterThan, 500.0, None), 500.0);
    }

    // ── The widening/classification contract ────────────────────────────────

    /// P0 regression guard.
    ///
    /// Widening the HAVING clause is only safe if the caller RE-CLASSIFIES the
    /// returned rows. The first implementation widened the SQL but still
    /// classified `records.len()` against `TriggerCondition`, so aggregation
    /// alerts saw a larger row set and fired MORE often than before the change
    /// — a spurious-firing regression, not merely a missing feature.
    ///
    /// This pins the invariant: rows admitted by the widened filter span both
    /// severity bands, so row *presence* cannot imply Critical.
    #[test]
    fn test_widened_filter_admits_rows_that_are_not_critical() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let filter = having_filter_value(&a).unwrap();

        // A group that passes the widened SQL filter...
        let warning_band_value = 75.0;
        assert!(
            warning_band_value > filter,
            "value must survive the widened HAVING"
        );
        // ...is NOT critical. Treating its presence as a firing at critical is
        // exactly the bug.
        assert_eq!(
            evaluate_aggregation_level(warning_band_value, &a).unwrap(),
            Some(AlertLevel::Warning)
        );
    }

    /// A value below even the widened filter must classify as no-match, so a
    /// caller that forgets to re-classify cannot accidentally look correct.
    #[test]
    fn test_values_below_the_widened_filter_do_not_match() {
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let filter = having_filter_value(&a).unwrap();
        assert_eq!(evaluate_aggregation_level(filter, &a).unwrap(), None);
        assert_eq!(evaluate_aggregation_level(filter - 1.0, &a).unwrap(), None);
    }

    /// The rollup across per-group aggregates takes the most severe group —
    /// and the reported value must come from THAT group, so history's
    /// "fired at X against Y" refers to one coherent observation.
    #[test]
    fn test_rollup_reports_the_worst_groups_value() {
        use crate::meta::alerts::level::AlertLevel as L;
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        let groups = [("a", 75.0), ("b", 500.0), ("c", 60.0)];

        let classified: Vec<_> = groups
            .iter()
            .filter_map(|(g, v)| {
                evaluate_aggregation_level(*v, &a)
                    .unwrap()
                    .map(|l| (*g, *v, l))
            })
            .collect();
        let worst = classified
            .iter()
            .max_by_key(|(_, _, l)| l.severity_rank())
            .unwrap();

        assert_eq!(worst.0, "b");
        assert_eq!(worst.1, 500.0, "the value must come from the worst group");
        assert_eq!(worst.2, L::Critical);
    }

    /// §4.4 option B: the `HAVING` clause widens to the LESS severe threshold
    /// so every group that could be warning-or-worse comes back, then Rust
    /// classifies. Sizing off the critical threshold would silently drop the
    /// whole warning band in the database.
    #[test]
    fn test_having_widens_to_the_less_severe_threshold() {
        // `>`: warning is the smaller number, so filter on it.
        let a = agg(Operator::GreaterThan, json!(100), Some(50.0));
        assert_eq!(having_filter_value(&a).unwrap(), 50.0);

        // `<`: warning is the larger number, so filter on it.
        let a = agg(Operator::LessThan, json!(10), Some(25.0));
        assert_eq!(having_filter_value(&a).unwrap(), 25.0);

        // Single-level: the critical threshold is the filter.
        let a = agg(Operator::GreaterThan, json!(100), None);
        assert_eq!(having_filter_value(&a).unwrap(), 100.0);
    }

    // ── §5.3: worst-first ordering for the multi-alert fetch ────────────────

    #[test]
    fn test_severity_order_ranks_critical_above_warning_above_healthy() {
        let a = agg(Operator::GreaterThan, json!(90), Some(80.0));
        assert_eq!(
            severity_order_sql(&a, "alert_agg_value").unwrap(),
            "CASE WHEN \"alert_agg_value\" > 90 THEN 2 \
             WHEN \"alert_agg_value\" > 80 THEN 1 ELSE 0 END DESC"
        );
    }

    #[test]
    fn test_severity_order_without_a_warning_band_has_two_buckets() {
        let a = agg(Operator::GreaterThan, json!(90), None);
        assert_eq!(
            severity_order_sql(&a, "alert_agg_value").unwrap(),
            "CASE WHEN \"alert_agg_value\" > 90 THEN 2 ELSE 0 END DESC"
        );
    }

    #[test]
    fn test_severity_order_follows_the_operator_direction() {
        // For `<` the WORST group is the smallest, so the comparison — not the
        // sort direction — is what flips. Emitting `ASC` on the raw value
        // instead would put the healthiest groups first and the cap would
        // retain exactly the wrong ones.
        let a = agg(Operator::LessThan, json!(10), Some(20.0));
        let sql = severity_order_sql(&a, "alert_agg_value").unwrap();
        assert_eq!(
            sql,
            "CASE WHEN \"alert_agg_value\" < 10 THEN 2 \
             WHEN \"alert_agg_value\" < 20 THEN 1 ELSE 0 END DESC"
        );
        assert!(
            sql.ends_with("DESC"),
            "severity rank always sorts descending; the operator carries the direction"
        );
    }

    #[test]
    fn test_severity_order_buckets_rather_than_ranking_raw_values() {
        // Two equally-Critical groups must be interchangeable to the sort, so
        // ordinary jitter between them cannot churn the retained row set. The
        // proof is that the aggregate appears only inside comparisons, never as
        // a bare sort key.
        let a = agg(Operator::GreaterThan, json!(90), Some(80.0));
        let sql = severity_order_sql(&a, "alert_agg_value").unwrap();
        assert!(sql.starts_with("CASE WHEN"));
        assert!(
            !sql.contains("END DESC, \"alert_agg_value\""),
            "the raw aggregate must not be a secondary sort key"
        );
    }

    #[test]
    fn test_severity_order_rejects_an_unorderable_operator() {
        // `=` has no worst-first direction. M-10 refuses these for multi-alerts
        // precisely so this is unreachable in practice — but the SQL builder
        // must not invent an ordering if it ever is reached.
        for op in [Operator::EqualTo, Operator::NotEqualTo] {
            let a = agg(op, json!(90), None);
            assert!(matches!(
                severity_order_sql(&a, "alert_agg_value"),
                Err(AggThresholdError::OperatorNotOrderable)
            ));
        }
    }

    #[test]
    fn test_severity_order_rejects_a_non_numeric_threshold() {
        let a = agg(Operator::GreaterThan, json!("not a number"), None);
        assert!(severity_order_sql(&a, "alert_agg_value").is_err());
    }
}
