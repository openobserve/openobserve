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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "mode", rename_all = "snake_case")]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "sli_type", rename_all = "snake_case")]
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
    /// The dual-query form is importer-only and its two queries must agree on
    /// the key schema.
    DualQueryKeyMismatch,
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
            Self::DualQueryKeyMismatch => {
                f.write_str("dual-query numerator and denominator must project the same key schema")
            }
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
pub fn validate_slo(
    definition: &SloDefinition,
    target: f64,
    alert_sli_enabled: bool,
) -> Result<(), SloValidationError> {
    let _ = (definition, target, alert_sli_enabled);
    todo!("validate_slo")
}
