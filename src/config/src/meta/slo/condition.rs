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

//! SLO alerts — the **fourth threshold family** (§6b.6, SA-1 … SA-19).
//!
//! §4.4b named three families (count, aggregation, PromQL), each with its own
//! critical value, operator and warning. This is the fourth, with one
//! structural difference: it has **no count gate at all**. For the other
//! families `TriggerCondition.threshold` means "for at least N groups/series";
//! here it is *unused*, and validation rejects a non-default value rather than
//! ignoring it (SA-4) — silently ignoring config is how the D13 mistake
//! happened.
//!
//! Classification reuses Feature 1's `evaluate_level_values` rather than
//! growing a parallel comparator (D35): a burn-rate alert classifies each
//! window and takes the **less severe** of the two, which is exactly Datadog's
//! "must exceed in both windows" AND rule generalized from a boolean to a
//! level.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{
    super::alerts::{Operator, level::AlertLevel},
    coverage::{Observation, UnobservedReason},
};

/// The two SLO-alert shapes Datadog offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SloAlertKind {
    /// Fires on the percentage of the budget consumed over the SLO window.
    ErrorBudget,
    /// Fires when the burn rate exceeds the threshold in **both** windows.
    BurnRate,
}

/// The SLO alert's condition, persisted in `alerts.query_slo_condition`
/// (D42). `slo_id` is additionally written to the indexed `alerts.slo_id`
/// column, which is authoritative for reverse lookups (D60).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SloCondition {
    pub slo_id: String,
    pub kind: SloAlertKind,
    /// Orderable ascending only: `>` or `>=` (SA-5).
    pub operator: Operator,
    /// Finite and strictly positive (SA-3).
    pub critical: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<f64>,
    /// `BurnRate` only. 1h–48h, ≤ the SLO window, an exact multiple of and
    /// ≥ 2× the slice interval (SA-8).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_window_secs: Option<i64>,
    /// `BurnRate` only. Defaults to long ÷ 12 (Google SRE workbook).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_window_secs: Option<i64>,
    /// Per-group fan-out — Feature 3's flag, same semantics (SA-13).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub multi_alert: bool,
}

/// The SLO facts validation needs, without dragging in the whole entity.
#[derive(Debug, Clone, Copy)]
pub struct SloFacts {
    pub target: f64,
    pub window_secs: i64,
    pub slice_interval_secs: i64,
    pub is_grouped: bool,
}

/// Every way an SLO-alert condition can be rejected. Each names its own bound
/// so the 400 is actionable.
#[derive(Debug, Clone, PartialEq)]
pub enum SloConditionError {
    /// SA-5: only `>` and `>=` have meaning for "bad when high".
    OperatorNotAscending(Operator),
    /// SA-3: `NaN`, `±inf`, or ≤ 0. A burn rate of 0 fires permanently.
    ThresholdNotFinitePositive { field: &'static str, value: f64 },
    /// SA-5 / T-2: warning must be strictly less severe than critical.
    WarningNotLessSevere { critical: f64, warning: f64 },
    /// SA-6: above `100 / (100 − target)` the alert can never fire.
    BurnRateAboveMax { critical: f64, max: f64 },
    /// SA-7: budget consumption above 100% is dominated by alerting at 100.
    ErrorBudgetOutOfRange(f64),
    /// SA-8: `long_window` must be 1h–48h.
    LongWindowOutOfRange(i64),
    /// SA-8: windows must be exact multiples of the slice interval.
    WindowNotSliceMultiple { window_secs: i64, slice_secs: i64 },
    /// SA-8: a one-slice window has coverage 0 or 1; a single gap freezes it.
    WindowTooFewSlices {
        window_secs: i64,
        min_secs: i64,
        field: &'static str,
    },
    /// SA-8: short must not exceed long.
    ShortWindowExceedsLong { short: i64, long: i64 },
    /// SA-8: both windows must fit inside the SLO window.
    WindowExceedsSloWindow { window_secs: i64, slo_window: i64 },
    /// Burn-rate alerts require both windows; budget alerts must not set them.
    WindowsMismatchedForKind(SloAlertKind),
    /// SA-4: this family has no count gate — a non-default value is rejected,
    /// not ignored.
    CountGateNotSupported,
    /// SA-13: per-group fan-out requires a grouped SLO.
    MultiAlertRequiresGroupedSlo,
    /// SA-19: too many distinct `(long, short)` pairs on one SLO.
    TooManyBurnWindowPairs { pairs: usize, max: usize },
}

impl std::fmt::Display for SloConditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OperatorNotAscending(op) => write!(
                f,
                "operator `{op}` is not supported for SLO alerts; burn rate and budget \
                 consumption are bad when high, so use > or >="
            ),
            Self::ThresholdNotFinitePositive { field, value } => write!(
                f,
                "{field} must be a finite number greater than 0; got {value}"
            ),
            Self::WarningNotLessSevere { critical, warning } => write!(
                f,
                "warning ({warning}) must be lower than critical ({critical})"
            ),
            Self::BurnRateAboveMax { critical, max } => write!(
                f,
                "critical burn rate {critical} exceeds the maximum {max:.0} for this target; it \
                 would require an error rate above 100% and can never fire"
            ),
            Self::ErrorBudgetOutOfRange(v) => {
                write!(f, "error-budget threshold {v} must be in (0, 100]")
            }
            Self::LongWindowOutOfRange(w) => {
                write!(f, "long window {w}s must be between 1 and 48 hours")
            }
            Self::WindowNotSliceMultiple {
                window_secs,
                slice_secs,
            } => write!(
                f,
                "window {window_secs}s must be an exact multiple of the SLO's {slice_secs}s slice \
                 interval"
            ),
            Self::WindowTooFewSlices {
                window_secs,
                min_secs,
                field,
            } => write!(
                f,
                "{field} {window_secs}s must be at least {min_secs}s (2 slices); a one-slice \
                 window has coverage 0 or 1, so a single gap freezes the alert"
            ),
            Self::ShortWindowExceedsLong { short, long } => {
                write!(
                    f,
                    "short window {short}s must not exceed the long window {long}s"
                )
            }
            Self::WindowExceedsSloWindow {
                window_secs,
                slo_window,
            } => write!(
                f,
                "window {window_secs}s must fit inside the SLO's {slo_window}s window"
            ),
            Self::WindowsMismatchedForKind(kind) => match kind {
                SloAlertKind::BurnRate => {
                    f.write_str("burn-rate alerts require both a long and a short window")
                }
                SloAlertKind::ErrorBudget => f.write_str(
                    "error-budget alerts evaluate the SLO window and must not set burn windows",
                ),
            },
            Self::CountGateNotSupported => f.write_str(
                "SLO alerts have no count gate; leave the trigger threshold and operator at their \
                 defaults",
            ),
            Self::MultiAlertRequiresGroupedSlo => {
                f.write_str("per-group alerting requires an SLO with group_by set")
            }
            Self::TooManyBurnWindowPairs { pairs, max } => write!(
                f,
                "this SLO already has {pairs} distinct burn-window pairs; the maximum is {max}"
            ),
        }
    }
}

impl std::error::Error for SloConditionError {}

/// SA-8: the smallest legal window for a slice interval — two slices.
pub fn min_window_secs(slice_interval_secs: i64) -> i64 {
    let _ = slice_interval_secs;
    todo!("condition::min_window_secs")
}

/// The default short window: long ÷ 12, raised to the smallest legal value.
pub fn default_short_window_secs(long_window_secs: i64, slice_interval_secs: i64) -> i64 {
    let _ = (long_window_secs, slice_interval_secs);
    todo!("condition::default_short_window_secs")
}

/// Validate a condition against the SLO it references (SA-3 … SA-13).
///
/// **Check order is part of the contract.** Many inputs violate more than one
/// rule at once (a 7-minute window on a 5-minute-slice SLO is both a
/// non-multiple *and* under two slices), and callers assert on specific
/// variants, so the order is fixed here rather than left to the implementer:
///
/// 1. window presence matches the kind (`WindowsMismatchedForKind`)
/// 2. operator is ascending (`OperatorNotAscending`)
/// 3. thresholds are finite and positive (`ThresholdNotFinitePositive`)
/// 4. kind-specific range (`BurnRateAboveMax` / `ErrorBudgetOutOfRange`)
/// 5. warning is less severe (`WarningNotLessSevere`)
/// 6. windows, in order: `LongWindowOutOfRange` → `WindowNotSliceMultiple` → `WindowTooFewSlices` →
///    `ShortWindowExceedsLong` → `WindowExceedsSloWindow`
/// 7. no count gate (`CountGateNotSupported`)
/// 8. per-group requires grouping (`MultiAlertRequiresGroupedSlo`)
///
/// `count_gate_is_default` is supplied by the caller from the alert's
/// `TriggerCondition`, so this stays free of the alert type.
pub fn validate(
    cond: &SloCondition,
    slo: &SloFacts,
    count_gate_is_default: bool,
) -> Result<(), SloConditionError> {
    let _ = (cond, slo, count_gate_is_default);
    todo!("condition::validate")
}

/// SA-19: reject a new alert that would push the SLO past the burn-window pair
/// cap. `existing` comes from `WHERE slo_id = ?` on the indexed column (D60),
/// never from the alert cache.
pub fn validate_pair_budget(
    cond: &SloCondition,
    existing: &[(i64, i64)],
    max_pairs: usize,
) -> Result<(), SloConditionError> {
    let _ = (cond, existing, max_pairs);
    todo!("condition::validate_pair_budget")
}

/// Classify one observed value against the condition's thresholds.
///
/// `None` means "matched nothing" = `Ok`, exactly as `evaluate_level_values`
/// does — trap 4 in §8b.
pub fn classify_value(value: f64, cond: &SloCondition) -> Option<AlertLevel> {
    let _ = (value, cond);
    todo!("condition::classify_value")
}

/// The outcome of classifying an SLO alert.
///
/// A two-variant enum rather than `Option<Option<AlertLevel>>` **on purpose**.
/// The nested form spells "frozen" as an outer `None` and "healthy" as
/// `Some(None)`, which any stray `.flatten()`, `.unwrap_or(None)` or `?`
/// silently collapses into each other — and collapsing them in that direction
/// is precisely the catastrophic bug this whole feature is built to avoid: a
/// measurement outage reading as a recovery for every burn-rate alert in the
/// org (D34). Here that mistake does not typecheck.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SloClassification {
    /// Nothing was measured. The caller must leave `level`, `level_since` and
    /// `level_at` untouched (§7.6) — the level rots, it does not reset.
    Frozen(UnobservedReason),
    /// A real measurement produced this level. `AlertLevel::Ok` here means
    /// "observed and healthy", which is categorically different from `Frozen`.
    Observed(AlertLevel),
}

impl SloClassification {
    pub fn is_frozen(&self) -> bool {
        matches!(self, Self::Frozen(_))
    }

    /// The level to record, or `None` when the state must not be touched.
    pub fn level(&self) -> Option<AlertLevel> {
        match self {
            Self::Observed(level) => Some(*level),
            Self::Frozen(_) => None,
        }
    }
}

/// Classify a burn-rate alert from both window observations (SA-9).
///
/// The level is the **less severe** of the two windows' classifications —
/// Datadog's "must exceed in both windows" AND rule, generalized from a
/// boolean to a level.
///
/// If either window is unobserved the result is [`SloClassification::Frozen`],
/// carrying the **long** window's reason when both are unobserved (a stable
/// precedence, so the UI copy does not flicker).
pub fn classify_burn_rate(
    long: Observation,
    short: Observation,
    target: f64,
    cond: &SloCondition,
) -> SloClassification {
    let _ = (long, short, target, cond);
    todo!("condition::classify_burn_rate")
}

/// Classify an error-budget alert from the window observation.
pub fn classify_error_budget(
    window: Observation,
    target: f64,
    cond: &SloCondition,
) -> SloClassification {
    let _ = (window, target, cond);
    todo!("condition::classify_error_budget")
}

/// Which of the two burn-rate windows governs — the **less severe**, and
/// therefore the value recorded as `actual_value` (SA-11).
pub fn governing_burn_rate(long: f64, short: f64) -> f64 {
    let _ = (long, short);
    todo!("condition::governing_burn_rate")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::slo::coverage::Observation;

    const HOUR: i64 = 3600;
    const DAY: i64 = 86_400;

    fn slo_30d_60s() -> SloFacts {
        SloFacts {
            target: 99.9,
            window_secs: 30 * DAY,
            slice_interval_secs: 60,
            is_grouped: false,
        }
    }

    fn slo_7d_300s_grouped() -> SloFacts {
        SloFacts {
            target: 99.5,
            window_secs: 7 * DAY,
            slice_interval_secs: 300,
            is_grouped: true,
        }
    }

    /// Datadog's canonical fast-burn row for a 30-day SLO.
    fn fast_burn() -> SloCondition {
        SloCondition {
            slo_id: "slo1".into(),
            kind: SloAlertKind::BurnRate,
            operator: Operator::GreaterThan,
            critical: 14.4,
            warning: None,
            long_window_secs: Some(HOUR),
            short_window_secs: Some(5 * 60),
            multi_alert: false,
        }
    }

    fn budget_alert() -> SloCondition {
        SloCondition {
            slo_id: "slo1".into(),
            kind: SloAlertKind::ErrorBudget,
            operator: Operator::GreaterThanEquals,
            critical: 90.0,
            warning: Some(75.0),
            long_window_secs: None,
            short_window_secs: None,
            multi_alert: false,
        }
    }

    fn observed(sli: f64) -> Observation {
        Observation::Observed { sli }
    }

    // ======================= validation: operators =========================

    #[test]
    fn ascending_operators_are_accepted() {
        for op in [Operator::GreaterThan, Operator::GreaterThanEquals] {
            let c = SloCondition {
                operator: op,
                ..fast_burn()
            };
            assert!(validate(&c, &slo_30d_60s(), true).is_ok(), "{op} rejected");
        }
    }

    /// SA-5: burn rate and budget consumption are "bad when high". A `<`
    /// threshold has no meaning, and `=` has no severity direction at all.
    #[test]
    fn descending_and_unordered_operators_are_rejected() {
        for op in [
            Operator::LessThan,
            Operator::LessThanEquals,
            Operator::EqualTo,
            Operator::NotEqualTo,
            Operator::Contains,
        ] {
            let c = SloCondition {
                operator: op,
                ..fast_burn()
            };
            assert_eq!(
                validate(&c, &slo_30d_60s(), true),
                Err(SloConditionError::OperatorNotAscending(op))
            );
        }
    }

    // ======================= validation: thresholds ========================

    #[test]
    fn a_zero_critical_is_rejected_because_it_fires_permanently() {
        let c = SloCondition {
            critical: 0.0,
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::ThresholdNotFinitePositive { .. })
        ));
    }

    #[test]
    fn negative_nan_and_infinite_thresholds_are_rejected() {
        for bad in [-1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let c = SloCondition {
                critical: bad,
                ..fast_burn()
            };
            assert!(
                matches!(
                    validate(&c, &slo_30d_60s(), true),
                    Err(SloConditionError::ThresholdNotFinitePositive { .. })
                ),
                "{bad} was accepted"
            );
        }
    }

    #[test]
    fn a_warning_below_critical_is_accepted() {
        let c = SloCondition {
            warning: Some(7.0),
            ..fast_burn()
        };
        assert!(validate(&c, &slo_30d_60s(), true).is_ok());
    }

    #[test]
    fn a_warning_at_or_above_critical_is_rejected() {
        for w in [14.4, 20.0] {
            let c = SloCondition {
                warning: Some(w),
                ..fast_burn()
            };
            assert_eq!(
                validate(&c, &slo_30d_60s(), true),
                Err(SloConditionError::WarningNotLessSevere {
                    critical: 14.4,
                    warning: w
                })
            );
        }
    }

    #[test]
    fn no_warning_is_a_valid_single_level_alert() {
        assert!(validate(&fast_burn(), &slo_30d_60s(), true).is_ok());
    }

    // ======================= SA-6: the burn-rate cap =======================

    #[test]
    fn a_burn_rate_at_the_maximum_is_accepted() {
        // 99.9% target => max 1000.
        let c = SloCondition {
            critical: 1000.0,
            ..fast_burn()
        };
        assert!(validate(&c, &slo_30d_60s(), true).is_ok());
    }

    #[test]
    fn a_burn_rate_above_the_maximum_is_rejected() {
        let c = SloCondition {
            critical: 1000.1,
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::BurnRateAboveMax { .. })
        ));
    }

    /// SA-6's direction, stated as a test because the PRD had it backwards
    /// once: tightening RAISES the ceiling and can never break an alert;
    /// LOOSENING lowers it and can strand one.
    #[test]
    fn loosening_the_target_is_what_strands_an_existing_threshold() {
        let c = SloCondition {
            critical: 500.0,
            ..fast_burn()
        };
        let tight = SloFacts {
            target: 99.9,
            ..slo_30d_60s()
        }; // max 1000
        let loose = SloFacts {
            target: 99.0,
            ..slo_30d_60s()
        }; // max 100
        assert!(validate(&c, &tight, true).is_ok());
        assert!(matches!(
            validate(&c, &loose, true),
            Err(SloConditionError::BurnRateAboveMax { .. })
        ));
    }

    #[test]
    fn tightening_the_target_never_breaks_an_existing_threshold() {
        let c = SloCondition {
            critical: 90.0,
            ..fast_burn()
        };
        let loose = SloFacts {
            target: 99.0,
            ..slo_30d_60s()
        };
        let tight = SloFacts {
            target: 99.9,
            ..slo_30d_60s()
        };
        assert!(validate(&c, &loose, true).is_ok());
        assert!(validate(&c, &tight, true).is_ok());
    }

    #[test]
    fn the_cap_does_not_apply_to_error_budget_alerts() {
        // Budget consumption is a percentage, not a multiplier.
        let c = SloCondition {
            critical: 100.0,
            ..budget_alert()
        };
        assert!(validate(&c, &slo_30d_60s(), true).is_ok());
    }

    // ======================= SA-7: budget range ============================

    #[test]
    fn budget_thresholds_inside_the_range_are_accepted() {
        for v in [1.0, 50.0, 75.0, 100.0] {
            let c = SloCondition {
                critical: v,
                warning: None,
                ..budget_alert()
            };
            assert!(validate(&c, &slo_30d_60s(), true).is_ok(), "{v} rejected");
        }
    }

    #[test]
    fn a_budget_threshold_above_one_hundred_is_rejected() {
        let c = SloCondition {
            critical: 101.0,
            warning: None,
            ..budget_alert()
        };
        assert_eq!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::ErrorBudgetOutOfRange(101.0))
        );
    }

    /// D39: Datadog documents error-budget alerts as critical-only; we allow a
    /// warning because Feature 1 makes it free.
    #[test]
    fn error_budget_alerts_accept_a_warning() {
        assert!(validate(&budget_alert(), &slo_30d_60s(), true).is_ok());
        assert_eq!(budget_alert().warning, Some(75.0));
    }

    // ======================= SA-8: window rules ============================

    #[test]
    fn datadog_suggested_windows_are_all_legal_on_a_sixty_second_slo() {
        let slo = slo_30d_60s();
        for (long_h, short_m) in [(1, 5), (6, 30), (24, 120)] {
            let c = SloCondition {
                long_window_secs: Some(long_h * HOUR),
                short_window_secs: Some(short_m * 60),
                critical: 3.0,
                ..fast_burn()
            };
            assert!(
                validate(&c, &slo, true).is_ok(),
                "{long_h}h/{short_m}m rejected"
            );
        }
    }

    #[test]
    fn a_long_window_under_one_hour_is_rejected() {
        let c = SloCondition {
            long_window_secs: Some(1800),
            ..fast_burn()
        };
        assert_eq!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::LongWindowOutOfRange(1800))
        );
    }

    #[test]
    fn a_long_window_over_forty_eight_hours_is_rejected() {
        let c = SloCondition {
            long_window_secs: Some(49 * HOUR),
            short_window_secs: Some(4 * HOUR),
            ..fast_burn()
        };
        assert_eq!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::LongWindowOutOfRange(49 * HOUR))
        );
    }

    #[test]
    fn windows_must_be_exact_multiples_of_the_slice_interval() {
        // 700s is not a multiple of a 300s slice — and is deliberately ABOVE
        // the two-slice floor (600s) so only the multiple rule can fire.
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(700),
            critical: 3.0,
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &slo_7d_300s_grouped(), true),
            Err(SloConditionError::WindowNotSliceMultiple { .. })
        ));
    }

    /// SA-8: a one-slice window has coverage 0 or 1, so one missing slice
    /// freezes the alert permanently.
    #[test]
    fn a_one_slice_window_is_rejected() {
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(60), // exactly one 60s slice
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::WindowTooFewSlices { .. })
        ));
    }

    #[test]
    fn a_two_slice_window_is_the_smallest_legal_one() {
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(120),
            ..fast_burn()
        };
        assert!(validate(&c, &slo_30d_60s(), true).is_ok());
    }

    /// SA-8b, the consequence that bites the default path: with 300s slices
    /// the minimum short window is 600s, so Datadog's suggested 5m short
    /// window requires a 60s-slice SLO.
    #[test]
    fn the_five_minute_short_window_needs_a_sixty_second_slice_slo() {
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(5 * 60),
            critical: 3.0,
            ..fast_burn()
        };
        assert!(
            validate(&c, &slo_30d_60s(), true).is_ok(),
            "60s slices: legal"
        );
        assert!(
            matches!(
                validate(&c, &slo_7d_300s_grouped(), true),
                Err(SloConditionError::WindowTooFewSlices { .. })
            ),
            "300s slices: 5m is one slice, must be rejected"
        );
    }

    #[test]
    fn grouped_slos_have_a_ten_minute_minimum_short_window() {
        let slo = slo_7d_300s_grouped();
        assert_eq!(min_window_secs(slo.slice_interval_secs), 600);
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(600),
            critical: 3.0,
            ..fast_burn()
        };
        assert!(validate(&c, &slo, true).is_ok());
    }

    #[test]
    fn a_short_window_longer_than_the_long_window_is_rejected() {
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(2 * HOUR),
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::ShortWindowExceedsLong { .. })
        ));
    }

    #[test]
    fn windows_must_fit_inside_the_slo_window() {
        // A 48h long window does not fit in a 1-day SLO window.
        let tiny = SloFacts {
            window_secs: DAY,
            ..slo_30d_60s()
        };
        let c = SloCondition {
            long_window_secs: Some(48 * HOUR),
            short_window_secs: Some(4 * HOUR),
            critical: 3.0,
            ..fast_burn()
        };
        assert!(matches!(
            validate(&c, &tiny, true),
            Err(SloConditionError::WindowExceedsSloWindow { .. })
        ));
    }

    #[test]
    fn burn_rate_alerts_require_both_windows() {
        for c in [
            SloCondition {
                short_window_secs: None,
                ..fast_burn()
            },
            SloCondition {
                long_window_secs: None,
                ..fast_burn()
            },
        ] {
            assert_eq!(
                validate(&c, &slo_30d_60s(), true),
                Err(SloConditionError::WindowsMismatchedForKind(
                    SloAlertKind::BurnRate
                ))
            );
        }
    }

    #[test]
    fn error_budget_alerts_must_not_set_burn_windows() {
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            ..budget_alert()
        };
        assert_eq!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::WindowsMismatchedForKind(
                SloAlertKind::ErrorBudget
            ))
        );
    }

    // ---- the default short window ------------------------------------------

    #[test]
    fn the_default_short_window_is_long_over_twelve() {
        assert_eq!(default_short_window_secs(12 * HOUR, 60), HOUR);
        assert_eq!(default_short_window_secs(HOUR, 60), 300);
    }

    #[test]
    fn the_default_short_window_is_raised_to_the_legal_minimum() {
        // 1h ÷ 12 = 5min, which is one slice at 300s — must be raised to 600.
        assert_eq!(default_short_window_secs(HOUR, 300), 600);
    }

    #[test]
    fn every_default_short_window_passes_validation() {
        for slice in [60, 300] {
            for long_h in [1, 6, 24, 48] {
                let long = long_h * HOUR;
                let short = default_short_window_secs(long, slice);
                let c = SloCondition {
                    long_window_secs: Some(long),
                    short_window_secs: Some(short),
                    critical: 3.0,
                    ..fast_burn()
                };
                let slo = SloFacts {
                    slice_interval_secs: slice,
                    ..slo_30d_60s()
                };
                assert!(
                    validate(&c, &slo, true).is_ok(),
                    "default short {short}s for long {long}s @ {slice}s slices was invalid"
                );
            }
        }
    }

    // ======================= SA-4: no count gate ===========================

    /// The D13 mistake, prevented: a stray count gate is REJECTED, not
    /// silently ignored, because ignored config is invisible config.
    #[test]
    fn a_non_default_count_gate_is_rejected_not_ignored() {
        assert_eq!(
            validate(&fast_burn(), &slo_30d_60s(), false),
            Err(SloConditionError::CountGateNotSupported)
        );
    }

    #[test]
    fn a_default_count_gate_is_accepted() {
        assert!(validate(&fast_burn(), &slo_30d_60s(), true).is_ok());
    }

    // ======================= SA-13: per-group ==============================

    #[test]
    fn per_group_alerting_requires_a_grouped_slo() {
        let c = SloCondition {
            multi_alert: true,
            ..fast_burn()
        };
        assert_eq!(
            validate(&c, &slo_30d_60s(), true),
            Err(SloConditionError::MultiAlertRequiresGroupedSlo)
        );
    }

    #[test]
    fn per_group_alerting_is_allowed_on_a_grouped_slo() {
        let c = SloCondition {
            multi_alert: true,
            critical: 3.0,
            long_window_secs: Some(6 * HOUR),
            short_window_secs: Some(30 * 60),
            ..fast_burn()
        };
        assert!(validate(&c, &slo_7d_300s_grouped(), true).is_ok());
    }

    /// D36: a superset of Datadog, which permits group alerting only on Time
    /// Slice SLOs. Our per-group machinery is SLI-type agnostic.
    #[test]
    fn per_group_alerting_is_not_restricted_by_sli_type() {
        let c = SloCondition {
            multi_alert: true,
            critical: 3.0,
            long_window_secs: Some(6 * HOUR),
            short_window_secs: Some(30 * 60),
            ..fast_burn()
        };
        // SloFacts carries no SLI type at all — that is the point.
        assert!(validate(&c, &slo_7d_300s_grouped(), true).is_ok());
    }

    // ======================= SA-19: pair budget ============================

    #[test]
    fn a_new_pair_within_the_cap_is_accepted() {
        let existing = vec![(HOUR, 300), (6 * HOUR, 1800)];
        assert!(validate_pair_budget(&fast_burn(), &existing, 8).is_ok());
    }

    #[test]
    fn reusing_an_existing_pair_does_not_consume_budget() {
        let existing: Vec<(i64, i64)> = (0..8).map(|i| ((i + 1) * HOUR, 300)).collect();
        let c = SloCondition {
            long_window_secs: Some(HOUR),
            short_window_secs: Some(300),
            ..fast_burn()
        };
        assert!(
            validate_pair_budget(&c, &existing, 8).is_ok(),
            "an already-present pair costs nothing"
        );
    }

    #[test]
    fn a_novel_pair_past_the_cap_is_rejected() {
        let existing: Vec<(i64, i64)> = (0..8).map(|i| ((i + 1) * HOUR, 300)).collect();
        let c = SloCondition {
            long_window_secs: Some(47 * HOUR),
            short_window_secs: Some(600),
            ..fast_burn()
        };
        assert!(matches!(
            validate_pair_budget(&c, &existing, 8),
            Err(SloConditionError::TooManyBurnWindowPairs { .. })
        ));
    }

    #[test]
    fn error_budget_alerts_consume_no_pair_budget() {
        let existing: Vec<(i64, i64)> = (0..8).map(|i| ((i + 1) * HOUR, 300)).collect();
        assert!(validate_pair_budget(&budget_alert(), &existing, 8).is_ok());
    }

    // ======================= SA-9: classification ==========================

    #[test]
    fn both_windows_over_critical_fires_critical() {
        // 1.44% errors against a 0.1% budget = burn 14.4.
        let long = observed(100.0 - 1.60); // burn 16
        let short = observed(100.0 - 1.50); // burn 15
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Observed(AlertLevel::Critical)
        );
    }

    /// The AND rule: one window over threshold is NOT enough. This is what
    /// stops a 30-second blip from paging.
    #[test]
    fn only_the_long_window_over_critical_does_not_fire() {
        let long = observed(100.0 - 1.60); // burn 16
        let short = observed(100.0 - 0.01); // burn 0.1
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Observed(AlertLevel::Ok),
            "an elevated long window alone must not fire"
        );
    }

    #[test]
    fn only_the_short_window_over_critical_does_not_fire() {
        let long = observed(100.0 - 0.01);
        let short = observed(100.0 - 1.60);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Observed(AlertLevel::Ok)
        );
    }

    /// The recovery story the short window exists for: it drops first, and the
    /// alert clears while the long window is still elevated.
    #[test]
    fn the_short_window_recovers_the_alert_first() {
        let long = observed(100.0 - 1.51); // still burning at ~15
        let short = observed(100.0 - 0.08); // recovered, burn 0.8
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Observed(AlertLevel::Ok)
        );
    }

    /// The generalization from boolean to level: take the LESS severe of the
    /// two classifications.
    #[test]
    fn the_less_severe_window_governs_the_level() {
        let c = SloCondition {
            critical: 10.0,
            warning: Some(2.0),
            ..fast_burn()
        };
        // long is Critical (burn 15), short is only Warning (burn 3).
        let long = observed(100.0 - 1.50);
        let short = observed(100.0 - 0.30);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &c),
            SloClassification::Observed(AlertLevel::Warning),
            "Critical ∧ Warning = Warning"
        );
    }

    #[test]
    fn warning_in_both_windows_fires_warning() {
        let c = SloCondition {
            critical: 10.0,
            warning: Some(2.0),
            ..fast_burn()
        };
        let long = observed(100.0 - 0.35);
        let short = observed(100.0 - 0.30);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &c),
            SloClassification::Observed(AlertLevel::Warning)
        );
    }

    #[test]
    fn a_healthy_pair_classifies_as_ok() {
        let long = observed(100.0);
        let short = observed(100.0);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Observed(AlertLevel::Ok),
            "an observed healthy pair is Observed(Ok), never Frozen"
        );
    }

    // ---- unobserved windows freeze, they do not recover --------------------

    /// SA-17: the outer `None` means "freeze", and is deliberately distinct
    /// from `Some(None)` = "observed, matched nothing".
    #[test]
    fn an_unobserved_long_window_freezes_rather_than_recovering() {
        let long = Observation::Unobserved(UnobservedReason::BelowCoverageFloor);
        let short = observed(100.0);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Frozen(UnobservedReason::BelowCoverageFloor),
            "must be indistinguishable from `do not touch the level`"
        );
    }

    #[test]
    fn an_unobserved_short_window_freezes_too() {
        let long = observed(100.0);
        let short = Observation::Unobserved(UnobservedReason::ZeroTotal);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Frozen(UnobservedReason::ZeroTotal)
        );
    }

    #[test]
    fn a_stale_watermark_freezes_the_alert() {
        let stale = Observation::Unobserved(UnobservedReason::StaleWatermark);
        assert_eq!(
            classify_burn_rate(stale, stale, 99.9, &fast_burn()),
            SloClassification::Frozen(UnobservedReason::StaleWatermark)
        );
    }

    /// When both windows are unobserved the reason must be stable, so the UI
    /// copy does not flicker between passes.
    #[test]
    fn the_long_windows_reason_wins_when_both_are_unobserved() {
        let long = Observation::Unobserved(UnobservedReason::StaleWatermark);
        let short = Observation::Unobserved(UnobservedReason::ZeroTotal);
        assert_eq!(
            classify_burn_rate(long, short, 99.9, &fast_burn()),
            SloClassification::Frozen(UnobservedReason::StaleWatermark)
        );
    }

    /// The distinction that makes the whole design safe. With the old
    /// `Option<Option<_>>` shape this was one `.flatten()` away from silently
    /// turning a measurement outage into a fleet-wide recovery.
    #[test]
    fn freezing_and_healthy_are_different_and_only_one_yields_a_level() {
        let frozen = classify_burn_rate(
            Observation::Unobserved(UnobservedReason::BelowCoverageFloor),
            observed(100.0),
            99.9,
            &fast_burn(),
        );
        let healthy = classify_burn_rate(observed(100.0), observed(100.0), 99.9, &fast_burn());

        assert_ne!(frozen, healthy);
        assert!(frozen.is_frozen());
        assert!(!healthy.is_frozen());
        assert_eq!(
            frozen.level(),
            None,
            "a frozen classification must yield no level to write"
        );
        assert_eq!(healthy.level(), Some(AlertLevel::Ok));
    }

    // ---- error budget classification ---------------------------------------

    #[test]
    fn budget_consumption_above_critical_fires_critical() {
        // 99.8 against 99.9 = 200% consumed.
        assert_eq!(
            classify_error_budget(observed(99.8), 99.9, &budget_alert()),
            SloClassification::Observed(AlertLevel::Critical)
        );
    }

    #[test]
    fn budget_consumption_in_the_warning_band_fires_warning() {
        // consumed = 100 × (100 − sli) / (100 − target)
        //          = 100 × 0.08 / 0.1 = 80% — over the 75 warning, under the
        //          90 critical.
        assert_eq!(
            classify_error_budget(observed(99.92), 99.9, &budget_alert()),
            SloClassification::Observed(AlertLevel::Warning)
        );
    }

    #[test]
    fn a_healthy_budget_classifies_as_ok() {
        assert_eq!(
            classify_error_budget(observed(100.0), 99.9, &budget_alert()),
            SloClassification::Observed(AlertLevel::Ok)
        );
    }

    #[test]
    fn an_unobserved_budget_window_freezes() {
        assert_eq!(
            classify_error_budget(
                Observation::Unobserved(UnobservedReason::BelowCoverageFloor),
                99.9,
                &budget_alert()
            ),
            SloClassification::Frozen(UnobservedReason::BelowCoverageFloor)
        );
    }

    // ---- governing value (SA-11) -------------------------------------------

    #[test]
    fn the_governing_burn_rate_is_the_lower_of_the_two() {
        assert_eq!(governing_burn_rate(15.6, 14.9), 14.9);
        assert_eq!(governing_burn_rate(2.4, 9.1), 2.4);
    }

    #[test]
    fn the_governing_value_matches_what_actually_gated_the_alert() {
        // The recorded actual_value must be the value that decided the level,
        // otherwise history contradicts the paging decision.
        let long = 15.1;
        let short = 0.8;
        let governing = governing_burn_rate(long, short);
        assert_eq!(governing, short);
        assert!(governing < 14.4, "and that is why the alert recovered");
    }

    // ---- classify_value ----------------------------------------------------

    #[test]
    fn classify_value_checks_critical_before_warning() {
        let c = SloCondition {
            critical: 10.0,
            warning: Some(2.0),
            ..fast_burn()
        };
        assert_eq!(classify_value(50.0, &c), Some(AlertLevel::Critical));
        assert_eq!(classify_value(5.0, &c), Some(AlertLevel::Warning));
        assert_eq!(classify_value(1.0, &c), None);
    }

    #[test]
    fn classify_value_respects_strict_versus_inclusive_operators() {
        let strict = SloCondition {
            operator: Operator::GreaterThan,
            critical: 10.0,
            warning: None,
            ..fast_burn()
        };
        let inclusive = SloCondition {
            operator: Operator::GreaterThanEquals,
            critical: 10.0,
            warning: None,
            ..fast_burn()
        };
        assert_eq!(classify_value(10.0, &strict), None);
        assert_eq!(classify_value(10.0, &inclusive), Some(AlertLevel::Critical));
    }
}
