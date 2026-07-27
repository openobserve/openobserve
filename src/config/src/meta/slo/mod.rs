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

//! Service Level Objectives — Feature 5 of `alerts_2.md` (§6b).
//!
//! Two objects, deliberately separate (D28):
//!
//! * an **SLO** is a new entity — what "good" means, a target, a rolling window, optional grouping.
//!   It has no threshold, no destination, no silence. Several alerts point at one SLO.
//! * an **SLO alert** is an ordinary `alerts` row whose condition is a [`condition::SloCondition`].
//!   It inherits destinations, silence, the §7.1 delivery split, state rows, history, priority,
//!   tags and composite eligibility unchanged.
//!
//! Everything in this module is **pure logic with no I/O** — the same
//! discipline as `alerts::level` / `alerts::grouping`, so the arithmetic that
//! decides whether someone gets paged is unit-testable without a database.
//!
//! The load-bearing invariants, each enforced by a submodule:
//!
//! | Invariant | Where |
//! | --------- | ----- |
//! | The §6b.6a math is stated once and derived everywhere | [`math`] |
//! | Ingest ranges are aligned and half-open; the open slice is never published | [`window`] |
//! | A gap is not a zero, and what a gap *means* differs by SLI type (D48) | [`slice`] |
//! | Unmeasured time freezes alerts; it never reads as uptime (D34) | [`coverage`] |
//! | Reads see only committed rows — forward *and* backward (D53/D58) | [`slice`] |
//! | The overall row is exact regardless of the group cap (S-9, D46) | [`group`] |
//! | Every SLO-alert bound rejects with a named error (SA-3..SA-19) | [`condition`] |
//! | The org budget bounds the *product* of the caps, at the horizon (S-14) | [`budget`] |
//! | Computation-affecting edits rebuild; reverts rebuild too (D59) | [`generation`] |

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::alerts::Operator;

pub mod budget;
pub mod condition;
pub mod coverage;
pub mod generation;
pub mod group;
pub mod math;
pub mod slice;
pub mod window;

/// Which of the three SLI shapes an SLO measures (S-5).
///
/// Mirrors Datadog's three SLO types: metric-based, time-slice, monitor-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SliType {
    /// Good events / total events from one scan.
    Count,
    /// A per-slice condition over an aggregate; uptime = good slices.
    TimeSlice,
    /// Uptime of an existing alert. **Gated on the S-16 availability ledger**
    /// — until that exists, "Ok for 3h" and "paused for 3h" are
    /// indistinguishable and this type must not ship.
    Alert,
}

/// Query language for a time-slice aggregate. Carried explicitly rather than
/// inferred from the stream type, so the evaluator never guesses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryLanguage {
    Sql,
    PromQl,
}

/// One query of a dual-query count source. Each carries its **own** stream —
/// D40's fallback exists precisely for numerator/denominator pairs that do not
/// share one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct CountQuery {
    pub stream: String,
    pub stream_type: String,
    /// SELECT-only SQL projecting `slice_start`, every configured `group_by`
    /// column, and exactly one numeric `zo_slo_value`.
    pub sql: String,
}

/// How a count SLI obtains good/total — itself a tagged union so that
/// unrepresentable states cannot be constructed (D40).
/// **Adjacently tagged, not internally tagged.** This workspace builds
/// `serde_json` with `arbitrary_precision` (root `Cargo.toml`), which encodes
/// every number as a map. Internally-tagged enums buffer their whole subtree
/// through `serde::__private::de::Content` before dispatching, and that
/// buffered map cannot then be deserialized into an `f64` — the failure is
/// `invalid type: map, expected f64`, and it survives nesting. Serialization
/// still succeeds, so the bug only appears on read-back.
///
/// This variant carries no numbers *today*, but the dual-query form is the one
/// most likely to gain them, and the failure mode is silent enough to be worth
/// pre-empting. See [`SliConfig`] for the same treatment and a regression test.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "mode", content = "query", rename_all = "snake_case")]
pub enum CountSource {
    /// The native form: one scan, so good and total are provably from the same
    /// rows.
    SingleQuery {
        stream: String,
        stream_type: String,
        /// Denominator filter. `None` = all rows.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        /// Numerator predicate. Mandatory — in this arm there is no other
        /// definition of `good`.
        good_expr: String,
    },
    /// Importer-only fallback for an unfoldable Datadog pair. Weaker
    /// atomicity: two scans that cannot be proven to have seen the same
    /// instant.
    DualQuery { good: CountQuery, total: CountQuery },
}

/// What "good" means, tagged on [`SliType`] (§6b.7).
///
/// `group_by` is deliberately **not** here — it lives on [`SloDefinition`],
/// the single source of truth for slice identity.
/// **Adjacently tagged** (`{"sli_type": …, "config": {…}}`) rather than
/// internally tagged, because `TimeSlice` carries an `f64` threshold and this
/// workspace's `serde_json` has `arbitrary_precision` enabled — see
/// [`CountSource`] for the full explanation. `sli_type` stays a top-level key
/// so the storage layer can keep denormalizing it into `slos.sli_type` for
/// list filtering.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "sli_type", content = "config", rename_all = "snake_case")]
pub enum SliConfig {
    Count {
        source: CountSource,
    },
    TimeSlice {
        stream: String,
        stream_type: String,
        query_language: QueryLanguage,
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        /// Orderable comparators only — a slice with no value is a *gap*, not
        /// a failure, so `=`/`!=` have no meaning here.
        comparator: Operator,
        threshold: f64,
    },
    Alert {
        alert_id: String,
    },
}

impl SliConfig {
    /// The discriminant, denormalized into `slos.sli_type` at write time for
    /// list filtering. Derived — never accepted independently from the API, so
    /// the column and the tagged JSON cannot disagree.
    pub fn sli_type(&self) -> SliType {
        match self {
            Self::Count { .. } => SliType::Count,
            Self::TimeSlice { .. } => SliType::TimeSlice,
            Self::Alert { .. } => SliType::Alert,
        }
    }
}

/// The computation-affecting shape of an SLO — everything a slice's meaning
/// depends on.
///
/// Deliberately excludes `target`: it is applied at read time (D56), so
/// editing it never invalidates a slice and never triggers a rebuild.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct SloDefinition {
    pub sli_config: SliConfig,
    /// THE canonical location for grouping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<Vec<String>>,
    pub window_secs: i64,
    pub slice_interval_secs: i64,
}

/// A Service Level Objective (S-1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Slo {
    pub id: String,
    pub org: String,
    pub folder_id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Everything a slice's meaning depends on.
    #[serde(flatten)]
    pub definition: SloDefinition,
    /// Percentage in (0, 100), up to 3 decimals. Applied at READ time.
    pub target: f64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    /// Bumped by every computation-affecting edit, including reverts (D59).
    /// Also the writing epoch and the CAS fence for writer commits.
    pub definition_generation: i32,
    /// Preflight `COUNT(DISTINCT …)` estimate; feeds the S-10 cap and the
    /// S-14 budget.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups_estimate: Option<i64>,
    /// Budget reservation: 1 when ungrouped, else `clamp(2 × estimate, 64, hard cap)`.
    pub groups_reserved: i64,
}

impl Slo {
    pub fn is_grouped(&self) -> bool {
        self.definition
            .group_by
            .as_ref()
            .is_some_and(|g| !g.is_empty())
    }
}

/// Why an SLO definition was rejected at save (S-2 … S-4).
#[derive(Debug, Clone, PartialEq)]
pub enum SloValidationError {
    /// `target` must be strictly inside (0, 100).
    TargetOutOfRange(f64),
    /// At most 3 decimal places (S-2).
    TargetTooPrecise(f64),
    /// Rolling 7d / 30d / 90d only (S-3, D31).
    UnsupportedWindow(i64),
    /// 60s or 300s only (S-4).
    UnsupportedSliceInterval(i64),
    /// Grouped SLOs are pinned to 300s slices (D30).
    GroupedRequiresCoarseSlice { slice_interval_secs: i64 },
    /// A time-slice comparator must have a severity direction.
    ComparatorNotOrderable(Operator),
    /// The `alert` SLI type is gated on the S-16 availability ledger.
    AlertSliNotAvailable,
}

impl std::fmt::Display for SloValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TargetOutOfRange(t) => write!(
                f,
                "target {t} must be greater than 0 and strictly below 100 — a 100% target has a \
                 zero error budget, so every burn rate is 0 or infinite"
            ),
            Self::TargetTooPrecise(t) => {
                write!(f, "target {t} has more than 3 decimal places")
            }
            Self::UnsupportedWindow(w) => write!(
                f,
                "window {w}s is not one of the supported rolling windows (7d, 30d, 90d)"
            ),
            Self::UnsupportedSliceInterval(s) => {
                write!(f, "slice interval {s}s must be 60 or 300")
            }
            Self::GroupedRequiresCoarseSlice {
                slice_interval_secs,
            } => write!(
                f,
                "grouped SLOs are pinned to 300s slices; got {slice_interval_secs}s"
            ),
            Self::ComparatorNotOrderable(op) => write!(
                f,
                "time-slice comparator `{op}` has no severity direction; use >, >=, < or <="
            ),
            Self::AlertSliNotAvailable => f.write_str(
                "the alert-based SLI type requires the measurement-availability ledger (S-16)",
            ),
        }
    }
}

impl std::error::Error for SloValidationError {}

/// The supported rolling windows (S-3). Datadog's exact set.
pub const WINDOW_7D_SECS: i64 = 7 * 86_400;
pub const WINDOW_30D_SECS: i64 = 30 * 86_400;
pub const WINDOW_90D_SECS: i64 = 90 * 86_400;

/// The supported slice intervals (S-4).
pub const SLICE_60_SECS: i64 = 60;
pub const SLICE_300_SECS: i64 = 300;

/// Validate an SLO definition and target at save time.
///
/// **Check order is part of the contract** — several inputs violate more than
/// one rule at once, and callers assert on specific variants:
///
/// 1. `target` range, then precision (S-2)
/// 2. `window_secs` is a supported rolling window (S-3)
/// 3. `slice_interval_secs` is 60 or 300 (S-4)
/// 4. grouped SLOs are pinned to 300s slices (D30)
/// 5. SLI-type specifics: comparator orderability, the S-16 gate
pub fn validate_slo(
    definition: &SloDefinition,
    target: f64,
    alert_sli_enabled: bool,
) -> Result<(), SloValidationError> {
    let _ = (definition, target, alert_sli_enabled);
    todo!("validate_slo")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count_config() -> SliConfig {
        SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: Some("service = 'checkout'".into()),
                good_expr: "status_code < 500".into(),
            },
        }
    }

    fn time_slice_config(comparator: Operator) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "http_metrics".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::Sql,
            query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
            scope: None,
            comparator,
            threshold: 500.0,
        }
    }

    fn def(sli_config: SliConfig, group_by: Option<Vec<String>>, slice: i64) -> SloDefinition {
        SloDefinition {
            sli_config,
            group_by,
            window_secs: WINDOW_30D_SECS,
            slice_interval_secs: slice,
        }
    }

    fn ungrouped() -> SloDefinition {
        def(count_config(), None, SLICE_60_SECS)
    }

    // ---- target range and precision (S-2) ----------------------------------

    #[test]
    fn a_well_formed_slo_is_accepted() {
        assert_eq!(validate_slo(&ungrouped(), 99.9, false), Ok(()));
    }

    #[test]
    fn a_target_of_one_hundred_is_rejected() {
        // A zero error budget makes every burn rate 0 or infinite.
        assert_eq!(
            validate_slo(&ungrouped(), 100.0, false),
            Err(SloValidationError::TargetOutOfRange(100.0))
        );
    }

    #[test]
    fn a_target_at_or_below_zero_is_rejected() {
        for t in [0.0, -1.0] {
            assert_eq!(
                validate_slo(&ungrouped(), t, false),
                Err(SloValidationError::TargetOutOfRange(t))
            );
        }
    }

    #[test]
    fn a_target_above_one_hundred_is_rejected() {
        assert_eq!(
            validate_slo(&ungrouped(), 100.5, false),
            Err(SloValidationError::TargetOutOfRange(100.5))
        );
    }

    #[test]
    fn three_decimal_places_are_accepted() {
        for t in [99.999, 99.95, 99.0, 95.5] {
            assert_eq!(validate_slo(&ungrouped(), t, false), Ok(()), "{t} rejected");
        }
    }

    #[test]
    fn four_decimal_places_are_rejected() {
        assert_eq!(
            validate_slo(&ungrouped(), 99.9999, false),
            Err(SloValidationError::TargetTooPrecise(99.9999))
        );
    }

    /// Range before precision, so an over-precise out-of-range target reports
    /// the range error.
    #[test]
    fn range_is_checked_before_precision() {
        assert_eq!(
            validate_slo(&ungrouped(), 100.0001, false),
            Err(SloValidationError::TargetOutOfRange(100.0001))
        );
    }

    // ---- windows (S-3, D31) -------------------------------------------------

    #[test]
    fn every_supported_rolling_window_is_accepted() {
        for w in [WINDOW_7D_SECS, WINDOW_30D_SECS, WINDOW_90D_SECS] {
            let mut d = ungrouped();
            d.window_secs = w;
            assert_eq!(validate_slo(&d, 99.9, false), Ok(()), "window {w} rejected");
        }
    }

    #[test]
    fn an_unsupported_window_is_rejected() {
        let mut d = ungrouped();
        d.window_secs = 14 * 86_400;
        assert_eq!(
            validate_slo(&d, 99.9, false),
            Err(SloValidationError::UnsupportedWindow(14 * 86_400))
        );
    }

    /// D31: windows are absolute seconds, so a 31-day month is not "30 days".
    #[test]
    fn a_calendar_month_is_not_mistaken_for_thirty_days() {
        let mut d = ungrouped();
        d.window_secs = 31 * 86_400;
        assert!(validate_slo(&d, 99.9, false).is_err());
    }

    // ---- slice intervals (S-4, D30) ----------------------------------------

    #[test]
    fn both_supported_slice_intervals_are_accepted() {
        for s in [SLICE_60_SECS, SLICE_300_SECS] {
            let d = def(count_config(), None, s);
            assert_eq!(validate_slo(&d, 99.9, false), Ok(()), "slice {s} rejected");
        }
    }

    #[test]
    fn an_unsupported_slice_interval_is_rejected() {
        for s in [30, 120, 600, 0, -60] {
            let d = def(count_config(), None, s);
            assert_eq!(
                validate_slo(&d, 99.9, false),
                Err(SloValidationError::UnsupportedSliceInterval(s)),
                "slice {s} accepted"
            );
        }
    }

    /// D30: the volume math forbids 1-minute slices once grouping multiplies
    /// them by group count.
    #[test]
    fn a_grouped_slo_is_pinned_to_five_minute_slices() {
        let d = def(count_config(), Some(vec!["region".into()]), SLICE_60_SECS);
        assert_eq!(
            validate_slo(&d, 99.9, false),
            Err(SloValidationError::GroupedRequiresCoarseSlice {
                slice_interval_secs: SLICE_60_SECS
            })
        );
    }

    #[test]
    fn a_grouped_slo_with_five_minute_slices_is_accepted() {
        let d = def(count_config(), Some(vec!["region".into()]), SLICE_300_SECS);
        assert_eq!(validate_slo(&d, 99.9, false), Ok(()));
    }

    /// An empty `group_by` is not "grouped" and must not trip the pin.
    #[test]
    fn an_empty_group_by_is_not_treated_as_grouped() {
        let d = def(count_config(), Some(vec![]), SLICE_60_SECS);
        assert_eq!(validate_slo(&d, 99.9, false), Ok(()));
    }

    // ---- SLI-type specifics -------------------------------------------------

    #[test]
    fn orderable_time_slice_comparators_are_accepted() {
        for op in [
            Operator::LessThan,
            Operator::LessThanEquals,
            Operator::GreaterThan,
            Operator::GreaterThanEquals,
        ] {
            let d = def(time_slice_config(op), None, SLICE_60_SECS);
            assert_eq!(validate_slo(&d, 99.9, false), Ok(()), "{op} rejected");
        }
    }

    /// A slice with no value is a *gap*, not a failure — so a comparator with
    /// no severity direction has nothing to mean here.
    #[test]
    fn unordered_time_slice_comparators_are_rejected() {
        for op in [Operator::EqualTo, Operator::NotEqualTo, Operator::Contains] {
            let d = def(time_slice_config(op), None, SLICE_60_SECS);
            assert_eq!(
                validate_slo(&d, 99.9, false),
                Err(SloValidationError::ComparatorNotOrderable(op)),
                "{op} accepted"
            );
        }
    }

    /// S-16: without the availability ledger, "Ok for 3h" and "paused for 3h"
    /// are indistinguishable, so this SLI would count unmeasured time as
    /// uptime.
    #[test]
    fn the_alert_sli_is_rejected_while_the_ledger_is_missing() {
        let d = def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            None,
            SLICE_60_SECS,
        );
        assert_eq!(
            validate_slo(&d, 99.9, false),
            Err(SloValidationError::AlertSliNotAvailable)
        );
    }

    #[test]
    fn the_alert_sli_is_accepted_once_the_ledger_exists() {
        let d = def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            None,
            SLICE_60_SECS,
        );
        assert_eq!(validate_slo(&d, 99.9, true), Ok(()));
    }

    // ---- derived discriminant ----------------------------------------------

    #[test]
    fn the_sli_type_discriminant_is_derived_from_the_tag() {
        assert_eq!(count_config().sli_type(), SliType::Count);
        assert_eq!(
            time_slice_config(Operator::LessThan).sli_type(),
            SliType::TimeSlice
        );
        assert_eq!(
            SliConfig::Alert {
                alert_id: "x".into()
            }
            .sli_type(),
            SliType::Alert
        );
    }

    // ---- serde: these shapes are persisted as JSON -------------------------

    /// **Regression guard.** `SliConfig` and `CountSource` are *adjacently*
    /// tagged because this workspace enables `serde_json/arbitrary_precision`,
    /// which encodes numbers as maps and makes internally-tagged enums fail to
    /// deserialize any `f64` in their subtree — `invalid type: map, expected
    /// f64`. Serialization keeps working, so the bug only shows on read-back:
    /// an SLO would save fine and never load again.
    ///
    /// If someone "tidies" these into internally-tagged enums, this test is
    /// what stops it reaching production.
    #[test]
    fn a_time_slice_config_round_trips_despite_arbitrary_precision() {
        let cfg = time_slice_config(Operator::LessThan);
        let json = serde_json::to_string(&cfg).unwrap();
        let back: SliConfig = serde_json::from_str(&json)
            .expect("internally-tagged enums cannot carry f64 under arbitrary_precision");
        assert_eq!(back, cfg);
    }

    #[test]
    fn a_single_query_count_config_round_trips() {
        let cfg = count_config();
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), cfg);
    }

    #[test]
    fn a_dual_query_count_config_round_trips() {
        let cfg = SliConfig::Count {
            source: CountSource::DualQuery {
                good: CountQuery {
                    stream: "a".into(),
                    stream_type: "logs".into(),
                    sql: "SELECT 1 AS zo_slo_value".into(),
                },
                total: CountQuery {
                    stream: "b".into(),
                    stream_type: "metrics".into(),
                    sql: "SELECT 2 AS zo_slo_value".into(),
                },
            },
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), cfg);
    }

    /// A fractional threshold is the case that actually broke — pin it
    /// separately from the round-number one.
    #[test]
    fn a_fractional_threshold_round_trips() {
        let cfg = SliConfig::TimeSlice {
            stream: "m".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::PromQl,
            query: "q".into(),
            scope: None,
            comparator: Operator::LessThanEquals,
            threshold: 0.001_25,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), cfg);
    }

    /// The tags are the discriminants the storage layer denormalizes, so a
    /// rename would silently orphan every stored row.
    #[test]
    fn the_serialized_tags_are_the_documented_discriminants() {
        let json = serde_json::to_value(count_config()).unwrap();
        assert_eq!(json["sli_type"], "count");
        assert_eq!(json["config"]["source"]["mode"], "single_query");

        let json = serde_json::to_value(time_slice_config(Operator::LessThan)).unwrap();
        assert_eq!(json["sli_type"], "time_slice");
        assert!(
            json["config"].is_object(),
            "adjacent tagging keeps the payload under `config`"
        );
    }

    #[test]
    fn an_unknown_sli_type_fails_to_deserialize() {
        assert!(serde_json::from_str::<SliConfig>(r#"{"sli_type":"telepathy"}"#).is_err());
    }

    #[test]
    fn a_missing_content_block_fails_to_deserialize() {
        assert!(serde_json::from_str::<SliConfig>(r#"{"sli_type":"time_slice"}"#).is_err());
    }

    // ---- is_grouped ---------------------------------------------------------

    #[test]
    fn is_grouped_treats_none_and_empty_alike() {
        let base = Slo {
            id: "s".into(),
            org: "o".into(),
            folder_id: "f".into(),
            name: "n".into(),
            description: String::new(),
            definition: ungrouped(),
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        };
        assert!(!base.is_grouped());

        let mut empty = base.clone();
        empty.definition.group_by = Some(vec![]);
        assert!(!empty.is_grouped());

        let mut grouped = base;
        grouped.definition.group_by = Some(vec!["region".into()]);
        assert!(grouped.is_grouped());
    }
}
