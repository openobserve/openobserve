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
//! | An alert SLI's coverage is proved by the ledger, never inferred from absence (S-16) | [`alert_uptime`] |
//! | Reads see only committed rows — forward *and* backward (D53/D58) | [`slice`] |
//! | The overall row is exact regardless of the group cap (S-9, D46) | [`group`] |
//! | Every SLO-alert bound rejects with a named error (SA-3..SA-19) | [`condition`] |
//! | The org budget bounds the *product* of the caps, at the horizon (S-14) | [`budget`] |
//! | Computation-affecting edits rebuild; reverts rebuild too (D59) | [`generation`] |

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::alerts::Operator;

pub mod alert_uptime;
pub mod budget;
pub mod budget_rows;
pub mod burn;
pub mod condition;
pub mod coverage;
pub mod generation;
pub mod group;
pub mod lenient_f64;
pub mod math;
pub mod slice;
pub mod status_view;
pub mod stream;
pub mod window;

pub use status_view::SloStatusView;

/// Which of the three SLI shapes an SLO measures (S-5).
///
/// The three standard SLO types: metric-based, time-slice, monitor-based.
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

impl SliType {
    /// The stable integer written to `slos.sli_type`. Explicit rather than
    /// derived from declaration order, so reordering the enum cannot silently
    /// reinterpret every stored row.
    pub fn storage_id(self) -> i32 {
        match self {
            Self::Count => 1,
            Self::TimeSlice => 2,
            Self::Alert => 3,
        }
    }

    pub fn from_storage_id(id: i32) -> Option<Self> {
        match id {
            1 => Some(Self::Count),
            2 => Some(Self::TimeSlice),
            3 => Some(Self::Alert),
            _ => None,
        }
    }
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
    /// Importer-only fallback for an unfoldable imported pair. Weaker
    /// atomicity: two scans that cannot be proven to have seen the same
    /// instant.
    DualQuery { good: CountQuery, total: CountQuery },
    /// Metrics-native counting: two PromQL expressions, each evaluated per
    /// slice (wire tag `prom_ql`, following [`QueryLanguage::PromQl`]).
    ///
    /// Exists because pre-aggregated counters have no rows for a `good_expr`
    /// to classify — "good" only exists as arithmetic between series, and
    /// correct counter arithmetic is `increase()` (monotonic-reset-aware),
    /// which SQL over raw samples cannot express. The expressions should use
    /// a range selector equal to the slice interval
    /// (`increase(http_requests_total[5m])` for a 5-minute slice); the
    /// evaluator samples them at slice ends, so each sample covers exactly
    /// its slice.
    ///
    /// Same atomicity caveat as [`Self::DualQuery`]: two evaluations that
    /// cannot be proven to have seen the same instant. Grouping needs no
    /// column list — the returned series' labels supply the group values.
    PromQl { good: String, total: String },
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
        #[serde(deserialize_with = "lenient_f64::deserialize")]
        threshold: f64,
        /// Freshness semantics: a slice the query PROVED empty is **bad**
        /// rather than a gap. For a pipeline-freshness SLO, absence is the
        /// failure signal — a silent pipeline is a broken pipeline, and under
        /// S-8's default it could never read as bad.
        ///
        /// Only flips the meaning of a *successful* query's empty bucket; a
        /// FAILED query still writes nothing and coverage falls, so a search
        /// outage freezes the SLO exactly as before. That distinction is
        /// structural — gap fill runs only after a successful query.
        ///
        /// `#[serde(default)]` is the upgrade guarantee: every stored
        /// time-slice SLO predates the field and keeps S-8 byte-for-byte.
        /// Ungrouped SLOs only (validated) — gap fill cannot see a group that
        /// is absent from the whole pass, so a grouped freshness SLO would
        /// freeze instead of firing for precisely the failure it watches for.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        absent_is_bad: bool,
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
    /// Flattened, so `sli_type` and `config` sit at the SLO's top level rather
    /// than nested under `sli_config`. `SloDefinition` is itself flattened
    /// into [`Slo`], so this is what makes the wire shape
    /// `{"sli_type": "count", "config": {...}, "target": ...}` — one flat
    /// object, matching what the form actually posts.
    #[serde(flatten)]
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
    // The four fields below are assigned SERVER-side, so they carry
    // `#[serde(default)]`: a create request that supplied its own id,
    // generation or reservation would either be ignored or be a way to forge
    // them, and requiring them just makes every client send placeholders.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub org: String,
    #[serde(default)]
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
    #[serde(default)]
    pub definition_generation: i32,
    /// Preflight `COUNT(DISTINCT …)` estimate; feeds the S-10 cap and the
    /// S-14 budget.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub groups_estimate: Option<i64>,
    /// Budget reservation: 1 when ungrouped, else `clamp(2 × estimate, 64, hard cap)`.
    #[serde(default)]
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
    /// A time-slice threshold must be a finite number — `NaN` compares false
    /// against every value, so every slice classifies bad; `±inf` classifies
    /// every slice the same way in the other direction.
    ThresholdNotFinite(f64),
    /// An `alert` SLI was configured without facts about its source.
    AlertSliSourceUnknown,
    /// Only scheduled alerts carry durable level state (C-7, D12).
    AlertSliSourceNotScheduled,
    /// Per-group coverage is not derivable: `TriggerData` is one record per
    /// evaluation, not per group (D8), so a grouped source cannot say which of
    /// its groups were measured (D65).
    AlertSliSourceIsGrouped,
    /// SLO alerts and composites are excluded as sources — which is what
    /// prevents `SLO → alert → SLO` cycles without a cycle checker.
    AlertSliSourceIneligible,
    /// `absent_is_bad` on a grouped SLO: gap fill only fills groups present
    /// in the pass, so a fully absent group would freeze rather than read
    /// bad — the opposite of what the flag promises. Rejected until
    /// per-group fill exists (D27: ignored config is invisible config).
    AbsentIsBadRequiresUngrouped,
    /// An `alert` SLI on a grouped **SLO**. The ledger records one run per
    /// alert, under the empty group key — which is the reserved overall-rollup
    /// key — so a grouped alert SLO's `exact_rollup` would collide with its
    /// own slices. Mirrors [`Self::AbsentIsBadRequiresUngrouped`], and is
    /// checked FIRST in the arm because it needs no source facts (§2, §5.1).
    AlertSliRequiresUngroupedSlo,
    /// Cron cadence is not a single number, and a weekdays-only expression
    /// would read as ~71% coverage — under the floor, so permanently frozen
    /// for a reason the user cannot see (§5.1.2).
    AlertSliSourceIsCron,
    /// The source must evaluate at least once per slice, or the grid can never
    /// be fully covered and the SLO freezes on a config that looks valid.
    /// Also carries the non-positive-cadence rejection: §5.3's forward
    /// extension is then zero-width, so coverage never accrues (§5.1.1).
    AlertSliSourceTooInfrequent {
        frequency_secs: i64,
        slice_interval_secs: i64,
    },
    /// A single-level alert with silence stops evaluating for the whole
    /// silence window, and silence engages after a *firing* — so the holes
    /// land inside bad periods. That biases the SLI upward without ever
    /// tripping the coverage floor: biased uptime, no freeze, no signal
    /// (§5.4).
    AlertSliSourceSilenceGated { silence_minutes: i64 },
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
            Self::ThresholdNotFinite(v) => {
                write!(f, "time-slice threshold {v} must be a finite number")
            }
            Self::AlertSliSourceUnknown => {
                f.write_str("an alert-based SLI requires facts about its source alert")
            }
            Self::AlertSliSourceNotScheduled => f.write_str(
                "an alert-based SLI requires a scheduled source alert; only those carry durable                  level state",
            ),
            Self::AlertSliSourceIsGrouped => f.write_str(
                "an alert-based SLI requires an ungrouped source alert: the triggers stream                  carries one record per evaluation, not per group, so per-group coverage cannot                  be derived",
            ),
            Self::AlertSliSourceIneligible => f.write_str(
                "SLO alerts and composite alerts cannot be SLI sources — that is what prevents                  SLO -> alert -> SLO cycles",
            ),
            Self::AbsentIsBadRequiresUngrouped => f.write_str(
                "absent_is_bad is not yet supported on a grouped SLO: a group absent from the \
                 whole pass cannot be gap-filled, so it would freeze instead of reading bad; \
                 remove the grouping or turn the flag off",
            ),
            Self::AlertSliRequiresUngroupedSlo => f.write_str(
                "an alert-based SLI cannot be grouped: the availability ledger records one run \
                 per alert, not per group, so there is no per-group coverage to stand on; remove \
                 the grouping",
            ),
            Self::AlertSliSourceIsCron => f.write_str(
                "a cron-scheduled alert cannot be an SLI source: its cadence is not a single \
                 number, so the coverage a slice needs cannot be derived from it; switch the \
                 source to a fixed frequency",
            ),
            // Worded as a requirement rather than a comparison, because this
            // variant also carries the non-positive-cadence rejection, where
            // "evaluates less often than" would not be true.
            Self::AlertSliSourceTooInfrequent {
                frequency_secs,
                slice_interval_secs,
            } => write!(
                f,
                "an alert-based SLI needs a source that evaluates at least once per slice: \
                 cadence is {frequency_secs}s against {slice_interval_secs}s slices, so slices \
                 would go unmeasured and the SLO would freeze"
            ),
            Self::AlertSliSourceSilenceGated { silence_minutes } => write!(
                f,
                "a source alert that silences for {silence_minutes} minutes stops evaluating for \
                 that whole window, and silence engages after a firing — so the unmeasured time \
                 lands inside the bad periods and biases the SLI upward; set the source's \
                 silence to 0 or give it a warning threshold"
            ),
        }
    }
}

impl std::error::Error for SloValidationError {}

/// The supported rolling windows (S-3).
pub const WINDOW_7D_SECS: i64 = 7 * 86_400;
pub const WINDOW_30D_SECS: i64 = 30 * 86_400;
pub const WINDOW_90D_SECS: i64 = 90 * 86_400;

/// The supported slice intervals (S-4).
pub const SLICE_60_SECS: i64 = 60;
pub const SLICE_300_SECS: i64 = 300;

/// Why a user-supplied SQL fragment or query was rejected (§6b.7).
///
/// These fragments are re-rendered from a parsed AST and never
/// string-interpolated into the generated query, so anything that does not
/// parse to the expected shape must fail **at save**, not at ingest.
#[derive(Debug, Clone, PartialEq)]
pub enum QuerySafetyError {
    /// Did not parse at all.
    Unparseable { field: &'static str },
    /// A predicate must be exactly one boolean expression — not a statement,
    /// not several.
    NotASingleExpression { field: &'static str },
    /// Statement separators, which would let a fragment append a second
    /// statement to the generated query.
    ContainsStatementSeparator { field: &'static str },
    /// Subqueries are not permitted in a scope or good-expression fragment.
    ContainsSubquery { field: &'static str },
    /// A function outside the allowlist.
    FunctionNotAllowed { field: &'static str, name: String },
    /// A dual-query member must be a single SELECT.
    NotSelectOnly { field: &'static str },
    /// The query must project `slice_start`, every `group_by` column, and
    /// exactly one numeric `zo_slo_value` — nothing else.
    ProjectionMismatch { field: &'static str, detail: String },
    /// The query language must suit the stream type.
    LanguageNotValidForStream {
        stream_type: String,
        query_language: QueryLanguage,
    },
    /// A required expression is empty. It would save cleanly and then measure
    /// nothing — permanent no-data discovered much later. Shared by the PromQL
    /// count sources and by the time-slice aggregate in **both** languages: an
    /// empty SQL aggregate is spliced in as `SELECT  AS zo_slo_value`, which
    /// does not parse, so every pass fails and the SLO freezes at ingest.
    EmptyExpression { field: &'static str },
    /// A `scope` was supplied for a language that has nowhere to put one. It
    /// is a SQL `WHERE (…)` fragment — that is literally where `time_slice_sql`
    /// puts it — and a PromQL plan is the bare expression, so the scope would
    /// narrow nothing, silently and forever (D27).
    ScopeNotValidForLanguage { query_language: QueryLanguage },
}

impl std::fmt::Display for QuerySafetyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unparseable { field } => write!(f, "{field} could not be parsed"),
            Self::NotASingleExpression { field } => {
                write!(f, "{field} must be exactly one boolean expression")
            }
            Self::ContainsStatementSeparator { field } => {
                write!(f, "{field} must not contain a statement separator")
            }
            Self::ContainsSubquery { field } => write!(f, "{field} must not contain a subquery"),
            Self::FunctionNotAllowed { field, name } => {
                write!(f, "{field} uses function `{name}`, which is not allowed")
            }
            Self::NotSelectOnly { field } => write!(f, "{field} must be a single SELECT"),
            Self::ProjectionMismatch { field, detail } => {
                write!(f, "{field} has an invalid projection: {detail}")
            }
            Self::LanguageNotValidForStream {
                stream_type,
                query_language,
            } => write!(
                f,
                "{query_language:?} cannot be used against a `{stream_type}` stream"
            ),
            Self::EmptyExpression { field } => {
                write!(f, "{field} must be a non-empty expression")
            }
            Self::ScopeNotValidForLanguage { query_language } => write!(
                f,
                "scope is a SQL filter and cannot be applied to a {query_language:?} query; \
                 put label matchers inside the expression instead"
            ),
        }
    }
}

impl std::error::Error for QuerySafetyError {}

/// A user predicate that has been parsed and checked, carried as an **AST**
/// rather than a string.
///
/// The distinction is the safety boundary. Returning a re-rendered `String`
/// re-invites exactly what parsing was meant to prevent: the caller has to
/// splice text into generated SQL, and every splice is a place to get operator
/// precedence or quoting wrong. Holding the AST means the time bound and the
/// user predicate are combined structurally — `AND`-ing two expression nodes —
/// so a user predicate of `a = 1 OR b = 2` cannot silently widen the range
/// filter the way `"{time} AND {user}"` string concatenation would.
///
/// Deliberately opaque: there is no public constructor from a string other
/// than [`parse_predicate`], so an unvalidated fragment cannot be smuggled in.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedPredicate {
    /// Rendering is for display and round-trip tests only — never for building
    /// the query.
    rendered: String,
}

impl ValidatedPredicate {
    /// Display form. Not a query-construction primitive.
    pub fn as_display(&self) -> &str {
        &self.rendered
    }
}

/// Parse a boolean predicate fragment (`scope`, `good_expr`) into a
/// [`ValidatedPredicate`].
///
/// A fragment that round-trips through a parser cannot smuggle a statement
/// separator, a second statement, or a subquery past it.
/// Functions a predicate fragment may call. Everything else is rejected —
/// an allowlist rather than a denylist, so a new engine builtin cannot become
/// reachable by default.
const PREDICATE_FUNCTION_ALLOWLIST: &[&str] = &[
    "lower",
    "upper",
    "trim",
    "length",
    "abs",
    "round",
    "floor",
    "ceil",
    "coalesce",
    "concat",
    "substr",
    "starts_with",
    "ends_with",
    "cast",
];

pub fn parse_predicate(
    field: &'static str,
    fragment: &str,
) -> Result<ValidatedPredicate, QuerySafetyError> {
    use sqlparser::{dialect::GenericDialect, parser::Parser};

    if fragment.trim().is_empty() {
        // An empty scope means "all rows" to the caller; it must not be
        // forced through here and become an empty predicate.
        return Err(QuerySafetyError::NotASingleExpression { field });
    }
    if fragment.contains(';') {
        return Err(QuerySafetyError::ContainsStatementSeparator { field });
    }

    let dialect = GenericDialect {};
    let mut parser = Parser::new(&dialect)
        .try_with_sql(fragment)
        .map_err(|_| QuerySafetyError::Unparseable { field })?;
    let expr = parser
        .parse_expr()
        .map_err(|_| QuerySafetyError::Unparseable { field })?;

    // Exactly ONE expression: anything left over means the fragment was a
    // list, a statement, or trailing garbage.
    if parser.peek_token().token != sqlparser::tokenizer::Token::EOF {
        return Err(QuerySafetyError::NotASingleExpression { field });
    }

    check_expr(field, &expr)?;
    if !is_boolean_shaped(&expr) {
        return Err(QuerySafetyError::NotASingleExpression { field });
    }

    Ok(ValidatedPredicate {
        rendered: expr.to_string(),
    })
}

/// Reject subqueries and non-allowlisted functions anywhere in the tree.
fn check_expr(field: &'static str, expr: &sqlparser::ast::Expr) -> Result<(), QuerySafetyError> {
    use sqlparser::ast::Expr;
    match expr {
        Expr::Subquery(_) | Expr::InSubquery { .. } | Expr::Exists { .. } => {
            Err(QuerySafetyError::ContainsSubquery { field })
        }
        Expr::Function(f) => {
            let name = f.name.to_string().to_lowercase();
            if !PREDICATE_FUNCTION_ALLOWLIST.contains(&name.as_str()) {
                return Err(QuerySafetyError::FunctionNotAllowed { field, name });
            }
            Ok(())
        }
        Expr::BinaryOp { left, right, .. } => {
            check_expr(field, left)?;
            check_expr(field, right)
        }
        Expr::UnaryOp { expr, .. }
        | Expr::Nested(expr)
        | Expr::IsNull(expr)
        | Expr::IsNotNull(expr) => check_expr(field, expr),
        Expr::InList { expr, list, .. } => {
            check_expr(field, expr)?;
            list.iter().try_for_each(|e| check_expr(field, e))
        }
        Expr::Between {
            expr, low, high, ..
        } => {
            check_expr(field, expr)?;
            check_expr(field, low)?;
            check_expr(field, high)
        }
        Expr::Like { expr, pattern, .. } | Expr::ILike { expr, pattern, .. } => {
            check_expr(field, expr)?;
            check_expr(field, pattern)
        }
        _ => Ok(()),
    }
}

/// Whether the expression could plausibly evaluate to a boolean. A bare
/// column is not a predicate — accepting one would silently filter on
/// truthiness.
fn is_boolean_shaped(expr: &sqlparser::ast::Expr) -> bool {
    use sqlparser::ast::{BinaryOperator as Op, Expr};
    match expr {
        Expr::BinaryOp { op, left, right } => {
            matches!(
                op,
                Op::Eq | Op::NotEq | Op::Gt | Op::GtEq | Op::Lt | Op::LtEq
            ) || (matches!(op, Op::And | Op::Or)
                && is_boolean_shaped(left)
                && is_boolean_shaped(right))
        }
        Expr::UnaryOp { op, expr } => {
            matches!(op, sqlparser::ast::UnaryOperator::Not) && is_boolean_shaped(expr)
        }
        Expr::Nested(inner) => is_boolean_shaped(inner),
        Expr::IsNull(_) | Expr::IsNotNull(_) | Expr::InList { .. } | Expr::Between { .. } => true,
        Expr::Like { .. } | Expr::ILike { .. } => true,
        _ => false,
    }
}

/// Combine a slice-range bound with an optional user predicate **structurally**
/// (`bound AND (user)`), preserving the user predicate's internal precedence.
///
/// This is the only supported way to apply a predicate to a generated query.
pub fn conjoin_time_bound(
    start_secs: i64,
    end_secs: i64,
    predicate: Option<&ValidatedPredicate>,
) -> String {
    // Half-open, matching the ingest range: `>= start` and `< end`.
    let bound = format!("_timestamp >= {start_secs} AND _timestamp < {end_secs}");
    match predicate {
        // The parentheses are the point. Without them a user predicate of
        // `a = 1 OR b = 2` binds as `(bound AND a = 1) OR b = 2`, and rows
        // outside the slice range enter the batch.
        Some(p) => format!("{bound} AND ({})", p.as_display()),
        None => bound,
    }
}

/// Validate a dual-query member: SELECT-only, and projecting exactly
/// `slice_start`, the `group_by` columns, and one numeric `zo_slo_value`.
///
/// `slice_interval_secs` is required because the `histogram()` bucket width
/// must equal the SLO's configured slice interval — a query bucketing at a
/// different width produces rows that do not line up with the slice grid, and
/// every coverage denominator downstream is computed from that grid.
///
/// Returns the query's key columns, so the caller can compare the numerator's
/// against the denominator's.
pub fn validate_count_query(
    field: &'static str,
    query: &CountQuery,
    group_by: &[String],
    slice_interval_secs: i64,
) -> Result<Vec<String>, QuerySafetyError> {
    use sqlparser::{
        ast::{Expr, GroupByExpr, SelectItem, SetExpr, Statement},
        dialect::GenericDialect,
        parser::Parser,
    };

    let statements = Parser::parse_sql(&GenericDialect {}, &query.sql)
        .map_err(|_| QuerySafetyError::Unparseable { field })?;
    let [Statement::Query(q)] = statements.as_slice() else {
        return Err(QuerySafetyError::NotSelectOnly { field });
    };
    let SetExpr::Select(select) = q.body.as_ref() else {
        return Err(QuerySafetyError::NotSelectOnly { field });
    };

    // Collect the projection's output names.
    let mut names = Vec::new();
    let mut saw_value = false;
    let mut value_is_numeric = false;
    for item in &select.projection {
        match item {
            SelectItem::ExprWithAlias { expr, alias } => {
                let alias = alias.value.to_lowercase();
                if alias == "zo_slo_value" {
                    saw_value = true;
                    value_is_numeric = expr_is_numeric(expr);
                } else {
                    if alias == "slice_start" {
                        check_histogram_interval(field, expr, slice_interval_secs)?;
                    }
                    names.push(alias);
                }
            }
            SelectItem::UnnamedExpr(Expr::Identifier(ident)) => {
                names.push(ident.value.to_lowercase());
            }
            _ => {
                return Err(QuerySafetyError::ProjectionMismatch {
                    field,
                    detail: "every projected column must be a plain column or an alias".to_string(),
                });
            }
        }
    }

    if !saw_value {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "missing a numeric `zo_slo_value` column".to_string(),
        });
    }
    if !value_is_numeric {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "`zo_slo_value` must be a numeric aggregate".to_string(),
        });
    }

    // Exactly `slice_start` + the configured group_by columns, nothing else:
    // the ingest job writes a fixed row shape, so a surprise column is
    // silently dropped.
    let mut expected: Vec<String> = vec!["slice_start".to_string()];
    expected.extend(group_by.iter().map(|g| g.to_lowercase()));
    let mut want = expected.clone();
    want.sort();

    let mut got = names.clone();
    got.sort();
    if got != want {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: format!("projects {names:?}, expected {expected:?}"),
        });
    }

    // The GROUP BY must match too. A query that projects `region` but groups
    // only by `slice_start` still returns one row per slice, so the ingest job
    // would write an arbitrary region's label against every region's data.
    let mut grouped: Vec<String> = match &select.group_by {
        GroupByExpr::Expressions(exprs, _) => exprs
            .iter()
            .map(|e| match e {
                Expr::Identifier(i) => i.value.to_lowercase(),
                other => other.to_string().to_lowercase(),
            })
            .collect(),
        // `GROUP BY ALL` groups by every non-aggregate projection, which is
        // exactly the key set — accept it.
        GroupByExpr::All(_) => want.clone(),
    };
    grouped.sort();
    if grouped != want {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: format!("groups by {grouped:?}, expected {expected:?}"),
        });
    }

    Ok(expected)
}

/// Whether an expression looks like a numeric aggregate rather than a column.
fn expr_is_numeric(expr: &sqlparser::ast::Expr) -> bool {
    use sqlparser::ast::Expr;
    match expr {
        Expr::Function(_) => true,
        Expr::Cast { .. } => true,
        Expr::Value(_) => true,
        Expr::BinaryOp { .. } => true,
        Expr::Nested(inner) => expr_is_numeric(inner),
        _ => false,
    }
}

/// The `histogram()` bucket width must equal the SLO's slice interval, or the
/// rows do not line up with the grid every coverage denominator is computed
/// from (§6b.4a-bis).
fn check_histogram_interval(
    field: &'static str,
    expr: &sqlparser::ast::Expr,
    slice_interval_secs: i64,
) -> Result<(), QuerySafetyError> {
    use sqlparser::ast::{Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Value};

    let Expr::Function(f) = expr else {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "`slice_start` must be histogram(_timestamp, '<interval>')".to_string(),
        });
    };
    if f.name.to_string().to_lowercase() != "histogram" {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "`slice_start` must be produced by histogram()".to_string(),
        });
    }
    let FunctionArguments::List(list) = &f.args else {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "histogram() needs an explicit interval".to_string(),
        });
    };
    let literal = list.args.iter().find_map(|a| match a {
        FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Value(v))) => match &v.value {
            Value::SingleQuotedString(s) => Some(s.clone()),
            _ => None,
        },
        _ => None,
    });
    let Some(literal) = literal else {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: "histogram() needs a quoted interval literal".to_string(),
        });
    };
    let want = interval_literal(slice_interval_secs);
    if literal.trim().to_lowercase() != want {
        return Err(QuerySafetyError::ProjectionMismatch {
            field,
            detail: format!("histogram interval '{literal}' must be '{want}'"),
        });
    }
    Ok(())
}

/// The interval literal for a slice width, in the form `histogram()` accepts.
pub fn interval_literal(slice_interval_secs: i64) -> String {
    match slice_interval_secs {
        60 => "1 minute".to_string(),
        300 => "5 minute".to_string(),
        s => format!("{s} second"),
    }
}

/// Whether a query language can address a stream type.
///
/// SQL addresses every stream, metrics included: a metrics stream is an
/// ordinary stream with a `value` column, so
/// `SELECT histogram(_timestamp, '5 minute'), avg(value) FROM cpu_usage` is a
/// perfectly good SLI. PromQL is the constrained one — it has no logs or
/// traces stream to address.
pub fn language_suits_stream(
    stream_type: &str,
    query_language: QueryLanguage,
) -> Result<(), QuerySafetyError> {
    let ok = match query_language {
        QueryLanguage::Sql => true,
        QueryLanguage::PromQl => stream_type == "metrics",
    };
    if ok {
        Ok(())
    } else {
        Err(QuerySafetyError::LanguageNotValidForStream {
            stream_type: stream_type.to_string(),
            query_language,
        })
    }
}

/// Full query-safety validation for an SLI config (§6b.7), run at save.
pub fn validate_query_safety(
    sli_config: &SliConfig,
    group_by: &[String],
    slice_interval_secs: i64,
) -> Result<(), QuerySafetyError> {
    match sli_config {
        SliConfig::Count { source } => match source {
            CountSource::SingleQuery {
                stream_type,
                scope,
                good_expr,
                ..
            } => {
                // Accepts everything today — SQL addresses every stream. Kept
                // as the single place the rule is applied, not as a check.
                language_suits_stream(stream_type, QueryLanguage::Sql)?;
                if let Some(scope) = scope {
                    parse_predicate("scope", scope)?;
                }
                parse_predicate("good_expr", good_expr)?;
                Ok(())
            }
            CountSource::DualQuery { good, total } => {
                // Both are checked against the SLO's own `group_by`, which is
                // what makes their key schemas agree: there is no separate
                // cross-check, because two projections that each equal
                // `slice_start + group_by` cannot differ from each other.
                validate_count_query("good_query", good, group_by, slice_interval_secs)?;
                validate_count_query("total_query", total, group_by, slice_interval_secs)?;
                Ok(())
            }
            CountSource::PromQl { good, total } => {
                // Non-empty is all that can be checked here: this crate has no
                // PromQL parser, and the grouping needs no column list — the
                // returned series' labels supply the group values at
                // evaluation time.
                for (field, expr) in [("good", good), ("total", total)] {
                    if expr.trim().is_empty() {
                        return Err(QuerySafetyError::EmptyExpression { field });
                    }
                }
                Ok(())
            }
        },
        SliConfig::TimeSlice {
            stream_type,
            query_language,
            query,
            scope,
            ..
        } => {
            language_suits_stream(stream_type, *query_language)?;
            match query_language {
                // A scope reaches the query as a SQL `WHERE (…)` fragment
                // (`time_slice_sql`), and a PromQL plan is the bare
                // expression — there is nowhere to put one, so accepting it
                // would silently narrow nothing. Blank is not a scope, because
                // the planner already reads it as absent; a form that keeps an
                // emptied field around must not be refused for it. Note the
                // asymmetry: SQL still refuses a blank scope, so a PromQL SLO
                // holding `Some("")` has to clear the field to switch to SQL.
                QueryLanguage::PromQl => {
                    if scope.as_deref().is_some_and(|s| !s.trim().is_empty()) {
                        return Err(QuerySafetyError::ScopeNotValidForLanguage {
                            query_language: *query_language,
                        });
                    }
                }
                // Unchanged, blank fragment included: `parse_predicate`
                // has always refused one.
                QueryLanguage::Sql => {
                    if let Some(scope) = scope {
                        parse_predicate("scope", scope)?;
                    }
                }
            }
            // Both languages. The aggregate is the whole measurement, so an
            // empty one is a permanently frozen SLO either way.
            if query.trim().is_empty() {
                return Err(QuerySafetyError::EmptyExpression { field: "query" });
            }
            Ok(())
        }
        // Reads existing alert state, not user SQL.
        SliConfig::Alert { .. } => Ok(()),
    }
}

/// What an `alert` SLI needs to know about its source, gathered by the caller.
///
/// Passed in rather than looked up, so this layer stays free of I/O — the same
/// discipline as [`condition::SloFacts`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceAlertFacts {
    /// Only scheduled alerts carry durable level state (C-7, D12).
    pub is_scheduled: bool,
    /// Maintains **per-group state**: `group_by` non-empty OR
    /// `multi_alert_enabled()`. NOT the column list alone — a PromQL
    /// multi-alert has no `group_by` list at all yet is emphatically grouped,
    /// and it never reaches the single-row path where the ledger writes, so a
    /// column-list test would let it save cleanly and measure nothing forever
    /// (§2, D65).
    pub is_grouped: bool,
    pub is_slo_alert: bool,
    pub is_composite: bool,
    /// `trigger_condition.frequency`, seconds. Meaningless when [`Self::is_cron`].
    pub frequency_secs: i64,
    /// `frequency_type == FrequencyType::Cron` — rejected in v1 (§5.1.2).
    pub is_cron: bool,
    /// `silence > 0 && !evaluates_through_silence(multi_alert, has_warning)`.
    /// Computed by the caller, because whether an alert keeps evaluating
    /// through silence is a delivery-layer question (§5.4).
    pub is_silence_gated: bool,
    /// `trigger_condition.silence`, minutes. Carried only to fill
    /// [`SloValidationError::AlertSliSourceSilenceGated`]'s payload — §5.4
    /// names the minutes in the rejection, and validation is pure, so there is
    /// nowhere else they could come from. Meaningful only when
    /// [`Self::is_silence_gated`].
    pub silence_minutes: i64,
}

/// Why this alert cannot be an `alert` SLI's source, or `None` if it can.
///
/// The source-fact half of [`validate_slo`]'s `Alert` arm, lifted out so the
/// eligible-alerts picker (PR 3) refuses exactly what save refuses and reports
/// the same message. Two rule sets that agree by inspection drift; one rule set
/// cannot.
///
/// The order is the §5.1 contract, and cron precedes cadence deliberately:
/// `frequency_secs` is meaningless for a cron alert, so "evaluates too
/// infrequently" would be a misleading reason against a cron expression.
///
/// `slice_interval_secs` is the grid the source is judged against. Save passes
/// the SLO's own; the picker passes [`SLICE_300_SECS`], the coarsest slice
/// there is (S-4), which makes the question "could ANY legal SLO use this
/// source" — a source slower than that has no grid it could ever fill.
///
/// The SLO's own `group_by` is NOT checked here: it is a fact about the SLO,
/// not about the source, and it has no meaning before one exists.
pub fn source_alert_ineligibility(
    facts: &SourceAlertFacts,
    slice_interval_secs: i64,
) -> Option<SloValidationError> {
    if facts.is_slo_alert || facts.is_composite {
        return Some(SloValidationError::AlertSliSourceIneligible);
    }
    if !facts.is_scheduled {
        return Some(SloValidationError::AlertSliSourceNotScheduled);
    }
    if facts.is_grouped {
        return Some(SloValidationError::AlertSliSourceIsGrouped);
    }
    if facts.is_cron {
        return Some(SloValidationError::AlertSliSourceIsCron);
    }
    if facts.frequency_secs <= 0 || facts.frequency_secs > slice_interval_secs {
        return Some(SloValidationError::AlertSliSourceTooInfrequent {
            frequency_secs: facts.frequency_secs,
            slice_interval_secs,
        });
    }
    if facts.is_silence_gated {
        return Some(SloValidationError::AlertSliSourceSilenceGated {
            silence_minutes: facts.silence_minutes,
        });
    }
    None
}

/// Validate an SLO definition and target at save time.
///
/// **Check order is part of the contract** — several inputs violate more than
/// one rule at once, and callers assert on specific variants:
///
/// 1. `target` range, then precision (S-2)
/// 2. `window_secs` is a supported rolling window (S-3)
/// 3. `slice_interval_secs` is 60 or 300 (S-4)
/// 4. grouped SLOs are pinned to 300s slices (D30)
/// 5. SLI-type specifics: comparator orderability, threshold finiteness, and for an `alert` SLI the
///    SLO-shape rule followed by the source-eligibility rules
///
/// The `alert` arm has its own documented order (§5.1), for the same reason:
/// the SLO's own `group_by` is checked first because it needs no source facts,
/// then the four original source-fact rules in their original order, then
/// cron, cadence and silence.
///
/// `source_alert` is required when — and only when — the SLI type is `alert`.
pub fn validate_slo(
    definition: &SloDefinition,
    target: f64,
    source_alert: Option<SourceAlertFacts>,
) -> Result<(), SloValidationError> {
    // 1. Target range, then precision.
    if !target.is_finite() || target <= 0.0 || target >= 100.0 {
        return Err(SloValidationError::TargetOutOfRange(target));
    }
    // Three decimals: compare against the value rounded to 3 places rather
    // than inspecting the literal, so 99.9 and 99.900 behave the same.
    if (target * 1000.0).round() / 1000.0 != target {
        return Err(SloValidationError::TargetTooPrecise(target));
    }

    // 2. Rolling windows only (D31).
    if !matches!(
        definition.window_secs,
        WINDOW_7D_SECS | WINDOW_30D_SECS | WINDOW_90D_SECS
    ) {
        return Err(SloValidationError::UnsupportedWindow(
            definition.window_secs,
        ));
    }

    // 3. Slice interval.
    if !matches!(
        definition.slice_interval_secs,
        SLICE_60_SECS | SLICE_300_SECS
    ) {
        return Err(SloValidationError::UnsupportedSliceInterval(
            definition.slice_interval_secs,
        ));
    }

    // 4. Grouped SLOs are pinned to 5-minute slices (D30). An EMPTY group_by is not grouped and
    //    must not trip this.
    let is_grouped = definition.group_by.as_ref().is_some_and(|g| !g.is_empty());
    if is_grouped && definition.slice_interval_secs != SLICE_300_SECS {
        return Err(SloValidationError::GroupedRequiresCoarseSlice {
            slice_interval_secs: definition.slice_interval_secs,
        });
    }

    // 5. SLI-type specifics.
    match &definition.sli_config {
        SliConfig::TimeSlice {
            comparator,
            threshold,
            absent_is_bad,
            ..
        } => {
            if !matches!(
                comparator,
                Operator::GreaterThan
                    | Operator::GreaterThanEquals
                    | Operator::LessThan
                    | Operator::LessThanEquals
            ) {
                return Err(SloValidationError::ComparatorNotOrderable(*comparator));
            }
            if !threshold.is_finite() {
                return Err(SloValidationError::ThresholdNotFinite(*threshold));
            }
            // Gap fill cannot see a group absent from the whole pass, so a
            // grouped freshness SLO would freeze rather than fire for the
            // exact failure it exists to watch (see the field's doc).
            if *absent_is_bad && is_grouped {
                return Err(SloValidationError::AbsentIsBadRequiresUngrouped);
            }
        }
        SliConfig::Alert { .. } => {
            // FIRST, because it is the one rule that needs no source facts —
            // a grouped alert SLO must report its own shape rather than
            // "source unknown" when the lookup also failed.
            if is_grouped {
                return Err(SloValidationError::AlertSliRequiresUngroupedSlo);
            }
            let Some(facts) = source_alert else {
                return Err(SloValidationError::AlertSliSourceUnknown);
            };
            // The remaining rules — and their order — are shared with the
            // eligible-alerts picker, so the two can never disagree.
            if let Some(e) = source_alert_ineligibility(&facts, definition.slice_interval_secs) {
                return Err(e);
            }
        }
        SliConfig::Count { .. } => {}
    }

    Ok(())
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
            stream: "requests".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::Sql,
            query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
            scope: None,
            comparator,
            threshold: 500.0,
            absent_is_bad: false,
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
        assert_eq!(validate_slo(&ungrouped(), 99.9, None), Ok(()));
    }

    #[test]
    fn a_target_of_one_hundred_is_rejected() {
        // A zero error budget makes every burn rate 0 or infinite.
        assert_eq!(
            validate_slo(&ungrouped(), 100.0, None),
            Err(SloValidationError::TargetOutOfRange(100.0))
        );
    }

    #[test]
    fn a_target_at_or_below_zero_is_rejected() {
        for t in [0.0, -1.0] {
            assert_eq!(
                validate_slo(&ungrouped(), t, None),
                Err(SloValidationError::TargetOutOfRange(t))
            );
        }
    }

    #[test]
    fn a_target_above_one_hundred_is_rejected() {
        assert_eq!(
            validate_slo(&ungrouped(), 100.5, None),
            Err(SloValidationError::TargetOutOfRange(100.5))
        );
    }

    #[test]
    fn three_decimal_places_are_accepted() {
        for t in [99.999, 99.95, 99.0, 95.5] {
            assert_eq!(validate_slo(&ungrouped(), t, None), Ok(()), "{t} rejected");
        }
    }

    #[test]
    fn four_decimal_places_are_rejected() {
        assert_eq!(
            validate_slo(&ungrouped(), 99.9999, None),
            Err(SloValidationError::TargetTooPrecise(99.9999))
        );
    }

    /// Range before precision, so an over-precise out-of-range target reports
    /// the range error.
    #[test]
    fn range_is_checked_before_precision() {
        assert_eq!(
            validate_slo(&ungrouped(), 100.0001, None),
            Err(SloValidationError::TargetOutOfRange(100.0001))
        );
    }

    // ---- windows (S-3, D31) -------------------------------------------------

    #[test]
    fn every_supported_rolling_window_is_accepted() {
        for w in [WINDOW_7D_SECS, WINDOW_30D_SECS, WINDOW_90D_SECS] {
            let mut d = ungrouped();
            d.window_secs = w;
            assert_eq!(validate_slo(&d, 99.9, None), Ok(()), "window {w} rejected");
        }
    }

    #[test]
    fn an_unsupported_window_is_rejected() {
        let mut d = ungrouped();
        d.window_secs = 14 * 86_400;
        assert_eq!(
            validate_slo(&d, 99.9, None),
            Err(SloValidationError::UnsupportedWindow(14 * 86_400))
        );
    }

    /// D31: windows are absolute seconds, so a 31-day month is not "30 days".
    #[test]
    fn a_calendar_month_is_not_mistaken_for_thirty_days() {
        let mut d = ungrouped();
        d.window_secs = 31 * 86_400;
        assert!(validate_slo(&d, 99.9, None).is_err());
    }

    // ---- slice intervals (S-4, D30) ----------------------------------------

    #[test]
    fn both_supported_slice_intervals_are_accepted() {
        for s in [SLICE_60_SECS, SLICE_300_SECS] {
            let d = def(count_config(), None, s);
            assert_eq!(validate_slo(&d, 99.9, None), Ok(()), "slice {s} rejected");
        }
    }

    #[test]
    fn an_unsupported_slice_interval_is_rejected() {
        for s in [30, 120, 600, 0, -60] {
            let d = def(count_config(), None, s);
            assert_eq!(
                validate_slo(&d, 99.9, None),
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
            validate_slo(&d, 99.9, None),
            Err(SloValidationError::GroupedRequiresCoarseSlice {
                slice_interval_secs: SLICE_60_SECS
            })
        );
    }

    #[test]
    fn a_grouped_slo_with_five_minute_slices_is_accepted() {
        let d = def(count_config(), Some(vec!["region".into()]), SLICE_300_SECS);
        assert_eq!(validate_slo(&d, 99.9, None), Ok(()));
    }

    /// An empty `group_by` is not "grouped" and must not trip the pin.
    #[test]
    fn an_empty_group_by_is_not_treated_as_grouped() {
        let d = def(count_config(), Some(vec![]), SLICE_60_SECS);
        assert_eq!(validate_slo(&d, 99.9, None), Ok(()));
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
            assert_eq!(validate_slo(&d, 99.9, None), Ok(()), "{op} rejected");
        }
    }

    /// A slice with no value is a *gap*, not a failure — so a comparator with
    /// no severity direction has nothing to mean here.
    #[test]
    fn unordered_time_slice_comparators_are_rejected() {
        for op in [Operator::EqualTo, Operator::NotEqualTo, Operator::Contains] {
            let d = def(time_slice_config(op), None, SLICE_60_SECS);
            assert_eq!(
                validate_slo(&d, 99.9, None),
                Err(SloValidationError::ComparatorNotOrderable(op)),
                "{op} accepted"
            );
        }
    }

    fn alert_def() -> SloDefinition {
        def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            None,
            SLICE_60_SECS,
        )
    }

    /// A grouped alert SLO, pinned to 300s slices so it clears the D30 check
    /// and actually reaches the `Alert` arm.
    fn grouped_alert_def() -> SloDefinition {
        def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            Some(vec!["region".into()]),
            SLICE_300_SECS,
        )
    }

    fn eligible_source() -> SourceAlertFacts {
        SourceAlertFacts {
            is_scheduled: true,
            is_grouped: false,
            is_slo_alert: false,
            is_composite: false,
            frequency_secs: 60,
            is_cron: false,
            is_silence_gated: false,
            silence_minutes: 0,
        }
    }

    #[test]
    fn an_alert_sli_over_an_eligible_source_is_accepted() {
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(eligible_source())),
            Ok(())
        );
    }

    #[test]
    fn an_alert_sli_without_source_facts_is_rejected() {
        assert_eq!(
            validate_slo(&alert_def(), 99.9, None),
            Err(SloValidationError::AlertSliSourceUnknown)
        );
    }

    /// Only scheduled alerts carry durable level state (C-7, D12).
    #[test]
    fn a_non_scheduled_source_is_rejected() {
        let facts = SourceAlertFacts {
            is_scheduled: false,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceNotScheduled)
        );
    }

    /// D65: `TriggerData` is one record per evaluation, not per group (D8), so
    /// a grouped source cannot say which of its groups were measured — and
    /// M-6 eviction / M-7 aging make that a real distinction, not a pedantic
    /// one.
    #[test]
    fn a_grouped_source_alert_is_rejected() {
        let facts = SourceAlertFacts {
            is_grouped: true,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceIsGrouped)
        );
    }

    /// Excluding SLO alerts as sources is what prevents SLO -> alert -> SLO
    /// cycles without a cycle checker.
    #[test]
    fn an_slo_alert_or_composite_source_is_rejected() {
        for facts in [
            SourceAlertFacts {
                is_slo_alert: true,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_composite: true,
                ..eligible_source()
            },
        ] {
            assert_eq!(
                validate_slo(&alert_def(), 99.9, Some(facts)),
                Err(SloValidationError::AlertSliSourceIneligible)
            );
        }
    }

    /// Source facts are irrelevant to the other SLI types and must not be
    /// required of them.
    #[test]
    fn non_alert_slis_do_not_need_source_facts() {
        assert_eq!(validate_slo(&ungrouped(), 99.9, None), Ok(()));
    }

    // ---- alert SLI: the SLO's own shape (§2, §5.1) --------------------------

    /// A per-group alert SLI has no per-group coverage to stand on: the ledger
    /// writes one row per evaluation under the empty group key, which is the
    /// reserved overall-rollup key. Enforced server-side, not just in the form
    /// — a direct API call could otherwise save a grouped alert SLO whose
    /// `exact_rollup` collides with the ledger rows.
    #[test]
    fn an_alert_sli_on_a_grouped_slo_is_rejected() {
        assert_eq!(
            validate_slo(&grouped_alert_def(), 99.9, Some(eligible_source())),
            Err(SloValidationError::AlertSliRequiresUngroupedSlo)
        );
    }

    /// The SLO-shape check needs no source facts, so it precedes
    /// `AlertSliSourceUnknown` — otherwise a grouped alert SLO reports the
    /// wrong problem whenever the source lookup also failed.
    #[test]
    fn the_slo_shape_check_runs_before_every_source_fact_check() {
        assert_eq!(
            validate_slo(&grouped_alert_def(), 99.9, None),
            Err(SloValidationError::AlertSliRequiresUngroupedSlo)
        );
        // Every source-fact rule broken at once, so the shape check is raced
        // against all of them — including the two lowest in the list, which
        // are the ones most easily inserted in the wrong place.
        let ineligible = SourceAlertFacts {
            is_slo_alert: true,
            is_scheduled: false,
            is_grouped: true,
            is_cron: true,
            frequency_secs: 3_600,
            is_silence_gated: true,
            silence_minutes: 10,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&grouped_alert_def(), 99.9, Some(ineligible)),
            Err(SloValidationError::AlertSliRequiresUngroupedSlo)
        );
    }

    /// An EMPTY `group_by` is not grouped, exactly as everywhere else.
    #[test]
    fn an_alert_sli_with_an_empty_group_by_is_not_treated_as_grouped() {
        let d = def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            Some(vec![]),
            SLICE_60_SECS,
        );
        assert_eq!(validate_slo(&d, 99.9, Some(eligible_source())), Ok(()));
    }

    // ---- alert SLI: cadence (§5.1) -----------------------------------------

    /// Cadence is not a single number for a cron alert, and a weekdays-only
    /// expression would read as ~71% coverage — under the floor, so frozen
    /// forever for a reason the user cannot see. Refusing is the honest v1.
    #[test]
    fn a_cron_scheduled_source_is_rejected() {
        let facts = SourceAlertFacts {
            is_cron: true,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceIsCron)
        );
    }

    /// `frequency_secs` is meaningless for a cron alert, so reporting
    /// "evaluates too infrequently" against a cron expression would be a
    /// misleading error.
    #[test]
    fn cron_is_reported_before_an_infrequent_cadence() {
        let facts = SourceAlertFacts {
            is_cron: true,
            frequency_secs: 3_600,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceIsCron)
        );
    }

    /// A source slower than the slice grid leaves whole slices unmeasured, so
    /// coverage pins below the floor and the SLO is permanently frozen on a
    /// config that looks valid.
    #[test]
    fn a_source_slower_than_the_slice_grid_is_rejected() {
        let facts = SourceAlertFacts {
            frequency_secs: 300,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceTooInfrequent {
                frequency_secs: 300,
                slice_interval_secs: SLICE_60_SECS,
            })
        );
    }

    /// One evaluation per slice is exactly enough — the rule is `>`, not `>=`.
    #[test]
    fn a_source_at_exactly_the_slice_interval_is_accepted() {
        for (frequency_secs, slice) in [(60, SLICE_60_SECS), (300, SLICE_300_SECS)] {
            let d = def(
                SliConfig::Alert {
                    alert_id: "abc".into(),
                },
                None,
                slice,
            );
            let facts = SourceAlertFacts {
                frequency_secs,
                ..eligible_source()
            };
            assert_eq!(
                validate_slo(&d, 99.9, Some(facts)),
                Ok(()),
                "cadence {frequency_secs} against a {slice}s slice"
            );
        }
    }

    /// A faster source is fine: it simply covers each slice several times over.
    #[test]
    fn a_source_faster_than_the_slice_grid_is_accepted() {
        let d = def(
            SliConfig::Alert {
                alert_id: "abc".into(),
            },
            None,
            SLICE_300_SECS,
        );
        assert_eq!(validate_slo(&d, 99.9, Some(eligible_source())), Ok(()));
    }

    /// §5.3's forward extension is `to_us + frequency_secs`, so a non-positive
    /// cadence is zero-width and coverage never accrues — the SLO would freeze
    /// permanently with a full ledger.
    #[test]
    fn a_non_positive_cadence_is_rejected() {
        for frequency_secs in [0, -60] {
            let facts = SourceAlertFacts {
                frequency_secs,
                ..eligible_source()
            };
            assert_eq!(
                validate_slo(&alert_def(), 99.9, Some(facts)),
                Err(SloValidationError::AlertSliSourceTooInfrequent {
                    frequency_secs,
                    slice_interval_secs: SLICE_60_SECS,
                }),
                "cadence {frequency_secs} accepted"
            );
        }
    }

    // ---- alert SLI: silence (§5.4) -----------------------------------------

    /// Silence engages after a *firing*, so the unmeasured holes land inside
    /// bad periods — missingness correlated with badness, which biases the SLI
    /// upward without ever tripping the coverage floor. Biased uptime with no
    /// freeze and no signal is the fabricated-uptime failure arriving through
    /// the side door.
    #[test]
    fn a_silence_gated_source_is_rejected() {
        let facts = SourceAlertFacts {
            is_silence_gated: true,
            silence_minutes: 10,
            ..eligible_source()
        };
        assert_eq!(
            validate_slo(&alert_def(), 99.9, Some(facts)),
            Err(SloValidationError::AlertSliSourceSilenceGated {
                silence_minutes: 10
            })
        );
    }

    /// A source that keeps evaluating through silence is unaffected: only
    /// *delivery* is suppressed, so the ledger stays dense.
    #[test]
    fn a_source_that_evaluates_through_silence_is_accepted() {
        let facts = SourceAlertFacts {
            is_silence_gated: false,
            silence_minutes: 10,
            ..eligible_source()
        };
        assert_eq!(validate_slo(&alert_def(), 99.9, Some(facts)), Ok(()));
    }

    // ---- alert SLI: the check order is part of the contract (§5.1) ----------

    /// The four pre-existing source-fact errors keep their relative order, and
    /// the three new ones append after them — so no currently-asserted error
    /// changes.
    #[test]
    fn the_alert_arm_reports_errors_in_the_documented_order() {
        // Every rule broken at once: each check in turn must be the one that
        // reports, from the top of the list down.
        let all_bad = SourceAlertFacts {
            is_scheduled: false,
            is_grouped: true,
            is_slo_alert: true,
            is_composite: true,
            frequency_secs: 3_600,
            is_cron: true,
            is_silence_gated: true,
            silence_minutes: 10,
        };
        let expected = [
            SloValidationError::AlertSliSourceIneligible,
            SloValidationError::AlertSliSourceNotScheduled,
            SloValidationError::AlertSliSourceIsGrouped,
            SloValidationError::AlertSliSourceIsCron,
            SloValidationError::AlertSliSourceTooInfrequent {
                frequency_secs: 3_600,
                slice_interval_secs: SLICE_60_SECS,
            },
            SloValidationError::AlertSliSourceSilenceGated {
                silence_minutes: 10,
            },
        ];

        let mut facts = all_bad;
        for want in expected {
            assert_eq!(
                validate_slo(&alert_def(), 99.9, Some(facts)),
                Err(want.clone()),
                "expected {want:?} next"
            );
            // Fix exactly the rule that just reported, and the next one down
            // must take over.
            match want {
                SloValidationError::AlertSliSourceIneligible => {
                    facts.is_slo_alert = false;
                    facts.is_composite = false;
                }
                SloValidationError::AlertSliSourceNotScheduled => facts.is_scheduled = true,
                SloValidationError::AlertSliSourceIsGrouped => facts.is_grouped = false,
                SloValidationError::AlertSliSourceIsCron => facts.is_cron = false,
                SloValidationError::AlertSliSourceTooInfrequent { .. } => {
                    facts.frequency_secs = 60;
                }
                SloValidationError::AlertSliSourceSilenceGated { .. } => {
                    facts.is_silence_gated = false;
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(validate_slo(&alert_def(), 99.9, Some(facts)), Ok(()));
    }

    /// The messages carry the numbers the user has to act on — a bare
    /// "too infrequent" leaves them guessing which knob to turn.
    #[test]
    fn the_new_alert_messages_name_the_offending_values() {
        let too_slow = SloValidationError::AlertSliSourceTooInfrequent {
            frequency_secs: 600,
            slice_interval_secs: 300,
        }
        .to_string();
        assert!(too_slow.contains("600"), "{too_slow}");
        assert!(too_slow.contains("300"), "{too_slow}");

        // The same variant carries the non-positive-cadence rejection (§5.1),
        // so it must name both numbers there too rather than reading as a
        // comparison that does not hold for a 0s cadence.
        let non_positive = SloValidationError::AlertSliSourceTooInfrequent {
            frequency_secs: 0,
            slice_interval_secs: 60,
        }
        .to_string();
        assert!(non_positive.contains('0'), "{non_positive}");
        assert!(non_positive.contains("60"), "{non_positive}");

        let silenced = SloValidationError::AlertSliSourceSilenceGated {
            silence_minutes: 10,
        }
        .to_string();
        assert!(silenced.contains("10"), "{silenced}");

        for e in [
            SloValidationError::AlertSliRequiresUngroupedSlo,
            SloValidationError::AlertSliSourceIsCron,
        ] {
            assert!(!e.to_string().is_empty(), "{e:?} has no message");
        }
    }

    // ---- the picker's rule set (§5.1, §5.4, PR 3) --------------------------

    /// The picker judges a candidate against the COARSEST slice (S-4), because
    /// no SLO exists yet to supply one — so this is "could any legal SLO use
    /// this source at all".
    #[test]
    fn an_eligible_source_has_no_ineligibility() {
        assert_eq!(
            source_alert_ineligibility(&eligible_source(), SLICE_300_SECS),
            None
        );
    }

    /// Every fact must be filtered on, not just the four the arm originally
    /// had: a scheduled, ungrouped, cron-driven or silence-gated alert is
    /// still ineligible, and the picker is the only place that can say so
    /// before save.
    #[test]
    fn every_source_fact_produces_its_own_reason() {
        let cases: [(SourceAlertFacts, SloValidationError); 7] = [
            (
                SourceAlertFacts {
                    is_slo_alert: true,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceIneligible,
            ),
            (
                SourceAlertFacts {
                    is_composite: true,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceIneligible,
            ),
            (
                SourceAlertFacts {
                    is_scheduled: false,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceNotScheduled,
            ),
            (
                SourceAlertFacts {
                    is_grouped: true,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceIsGrouped,
            ),
            (
                SourceAlertFacts {
                    is_cron: true,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceIsCron,
            ),
            (
                SourceAlertFacts {
                    frequency_secs: 600,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceTooInfrequent {
                    frequency_secs: 600,
                    slice_interval_secs: SLICE_300_SECS,
                },
            ),
            (
                SourceAlertFacts {
                    is_silence_gated: true,
                    silence_minutes: 10,
                    ..eligible_source()
                },
                SloValidationError::AlertSliSourceSilenceGated {
                    silence_minutes: 10,
                },
            ),
        ];
        for (facts, want) in cases {
            assert_eq!(
                source_alert_ineligibility(&facts, SLICE_300_SECS),
                Some(want.clone()),
                "expected {want:?} for {facts:?}"
            );
        }
    }

    /// §5.1.3: 300 is the coarsest supported slice, so the picker's cadence
    /// cut-off sits exactly there — 300s in, 301s out.
    #[test]
    fn the_pickers_cadence_cutoff_is_the_coarsest_slice() {
        let at = SourceAlertFacts {
            frequency_secs: SLICE_300_SECS,
            ..eligible_source()
        };
        assert_eq!(source_alert_ineligibility(&at, SLICE_300_SECS), None);

        let past = SourceAlertFacts {
            frequency_secs: SLICE_300_SECS + 1,
            ..eligible_source()
        };
        assert_eq!(
            source_alert_ineligibility(&past, SLICE_300_SECS),
            Some(SloValidationError::AlertSliSourceTooInfrequent {
                frequency_secs: SLICE_300_SECS + 1,
                slice_interval_secs: SLICE_300_SECS,
            })
        );
    }

    /// A non-positive cadence makes §5.3's forward extension zero-width, so
    /// coverage never accrues — refused by the same variant.
    #[test]
    fn a_non_positive_cadence_is_ineligible() {
        for frequency_secs in [0, -1] {
            let facts = SourceAlertFacts {
                frequency_secs,
                ..eligible_source()
            };
            assert_eq!(
                source_alert_ineligibility(&facts, SLICE_300_SECS),
                Some(SloValidationError::AlertSliSourceTooInfrequent {
                    frequency_secs,
                    slice_interval_secs: SLICE_300_SECS,
                })
            );
        }
    }

    /// The shared helper keeps the §5.1 order, including cron before cadence —
    /// `frequency_secs` is meaningless for a cron alert, so reporting "too
    /// infrequent" against a cron expression would be a misleading reason.
    ///
    /// Checked against `validate_slo` at every step rather than against a
    /// second copy of the list: a multi-fault alert is exactly where the
    /// picker and the save path could silently diverge.
    #[test]
    fn the_picker_reports_the_same_reason_order_as_save() {
        let all_bad = SourceAlertFacts {
            is_scheduled: false,
            is_grouped: true,
            is_slo_alert: true,
            is_composite: true,
            frequency_secs: 3_600,
            is_cron: true,
            is_silence_gated: true,
            silence_minutes: 10,
        };
        // `alert_def()` is pinned to 60s slices, so the shared rule is asked
        // the same question the save path asks.
        let expected = [
            SloValidationError::AlertSliSourceIneligible,
            SloValidationError::AlertSliSourceNotScheduled,
            SloValidationError::AlertSliSourceIsGrouped,
            SloValidationError::AlertSliSourceIsCron,
            SloValidationError::AlertSliSourceTooInfrequent {
                frequency_secs: 3_600,
                slice_interval_secs: SLICE_60_SECS,
            },
            SloValidationError::AlertSliSourceSilenceGated {
                silence_minutes: 10,
            },
        ];

        let mut facts = all_bad;
        for want in expected {
            assert_eq!(
                source_alert_ineligibility(&facts, SLICE_60_SECS),
                Some(want.clone()),
                "expected {want:?} next"
            );
            assert_eq!(
                validate_slo(&alert_def(), 99.9, Some(facts)).err(),
                Some(want.clone()),
                "save disagrees with the picker on {facts:?}"
            );
            match want {
                SloValidationError::AlertSliSourceIneligible => {
                    facts.is_slo_alert = false;
                    facts.is_composite = false;
                }
                SloValidationError::AlertSliSourceNotScheduled => facts.is_scheduled = true,
                SloValidationError::AlertSliSourceIsGrouped => facts.is_grouped = false,
                SloValidationError::AlertSliSourceIsCron => facts.is_cron = false,
                SloValidationError::AlertSliSourceTooInfrequent { .. } => facts.frequency_secs = 60,
                SloValidationError::AlertSliSourceSilenceGated { .. } => {
                    facts.is_silence_gated = false
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(source_alert_ineligibility(&facts, SLICE_60_SECS), None);
        assert_eq!(validate_slo(&alert_def(), 99.9, Some(facts)), Ok(()));
    }

    /// The picker and the save path must never disagree: whatever the helper
    /// reports for a set of facts is exactly what `validate_slo` reports for
    /// the same facts at the same slice width. Without this the picker can
    /// offer an alert the server then refuses — the failure PR 3 exists to
    /// remove.
    #[test]
    fn the_picker_rule_and_the_save_rule_agree() {
        let variations = [
            eligible_source(),
            SourceAlertFacts {
                is_slo_alert: true,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_composite: true,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_scheduled: false,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_grouped: true,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_cron: true,
                ..eligible_source()
            },
            SourceAlertFacts {
                frequency_secs: 600,
                ..eligible_source()
            },
            SourceAlertFacts {
                frequency_secs: 0,
                ..eligible_source()
            },
            SourceAlertFacts {
                is_silence_gated: true,
                silence_minutes: 5,
                ..eligible_source()
            },
        ];
        for facts in variations {
            let via_helper = source_alert_ineligibility(&facts, SLICE_60_SECS);
            let via_save = validate_slo(&alert_def(), 99.9, Some(facts)).err();
            assert_eq!(via_helper, via_save, "disagreement for {facts:?}");
        }
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
            absent_is_bad: false,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), cfg);
    }

    /// The API flattens `SloDefinition` into `Slo`, which buffers the nested
    /// threshold once more than deserializing `SliConfig` directly does.
    #[test]
    fn a_fractional_threshold_round_trips_through_a_full_slo() {
        let expected = Slo {
            id: "slo-1".into(),
            org: "acme".into(),
            folder_id: "default".into(),
            name: "checkout latency".into(),
            description: String::new(),
            definition: def(
                SliConfig::TimeSlice {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    query_language: QueryLanguage::Sql,
                    query: "AVG(duration_ms)".into(),
                    scope: None,
                    comparator: Operator::LessThanEquals,
                    threshold: 232.5,
                    absent_is_bad: false,
                },
                None,
                SLICE_300_SECS,
            ),
            target: 99.9,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        };

        let mut get_body = serde_json::to_value(&expected).unwrap();
        get_body
            .as_object_mut()
            .unwrap()
            .insert("status".into(), serde_json::Value::Null);
        let put_body: Slo = serde_json::from_value(get_body)
            .expect("a GET response must be accepted unchanged by PUT");
        assert_eq!(put_body, expected);
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

    // ---- query safety (§6b.7) ----------------------------------------------

    /// The safety boundary is "parse, then re-render from the AST". A fragment
    /// that survives that cannot smuggle anything into the generated SQL.
    #[test]
    fn a_plain_predicate_parses_and_round_trips() {
        let out = parse_predicate("good_expr", "status_code < 500").unwrap();
        assert!(out.as_display().contains("status_code"));
        assert!(out.as_display().contains("500"));
    }

    // ---- structural composition, not string splicing -----------------------

    /// The reason a predicate is carried as an AST. `"{time} AND {user}"`
    /// string concatenation with a user predicate of `a = 1 OR b = 2` binds as
    /// `(time AND a = 1) OR b = 2`, which silently escapes the slice range —
    /// rows outside `[start, end)` land in the batch.
    #[test]
    fn an_or_predicate_cannot_escape_the_time_bound() {
        let p = parse_predicate("scope", "a = 1 OR b = 2").unwrap();
        let sql = conjoin_time_bound(1_000, 2_000, Some(&p));
        let or_pos = sql.find(" OR ").expect("the user predicate is present");
        let close = sql[or_pos..]
            .find(')')
            .expect("the user predicate must be parenthesised");
        assert!(close > 0, "OR must be enclosed, not left at top level");
        // And both bounds survive.
        assert!(sql.contains("1000") && sql.contains("2000"));
    }

    #[test]
    fn a_time_bound_alone_is_well_formed() {
        let sql = conjoin_time_bound(1_000, 2_000, None);
        assert!(sql.contains("1000") && sql.contains("2000"));
        assert!(!sql.contains("AND ()"), "no empty conjunct: {sql}");
    }

    #[test]
    fn the_time_bound_is_half_open() {
        let sql = conjoin_time_bound(1_000, 2_000, None);
        assert!(sql.contains(">="), "start is inclusive: {sql}");
        assert!(
            sql.contains('<') && !sql.contains("<= 2000"),
            "end must be exclusive: {sql}"
        );
    }

    #[test]
    fn a_statement_separator_is_rejected() {
        assert!(matches!(
            parse_predicate("scope", "a = 1; DROP TABLE users"),
            Err(QuerySafetyError::ContainsStatementSeparator { .. })
                | Err(QuerySafetyError::NotASingleExpression { .. })
        ));
    }

    #[test]
    fn a_trailing_separator_alone_is_still_rejected() {
        assert!(parse_predicate("scope", "a = 1;").is_err());
    }

    #[test]
    fn several_expressions_are_rejected() {
        assert!(matches!(
            parse_predicate("scope", "a = 1, b = 2"),
            Err(QuerySafetyError::NotASingleExpression { .. })
                | Err(QuerySafetyError::Unparseable { .. })
        ));
    }

    #[test]
    fn a_subquery_in_a_predicate_is_rejected() {
        assert!(matches!(
            parse_predicate("scope", "a IN (SELECT id FROM other)"),
            Err(QuerySafetyError::ContainsSubquery { .. })
        ));
    }

    #[test]
    fn a_non_boolean_fragment_is_rejected() {
        // A bare column is not a predicate.
        assert!(parse_predicate("good_expr", "status_code").is_err());
    }

    #[test]
    fn garbage_is_rejected_rather_than_passed_through() {
        assert!(matches!(
            parse_predicate("scope", "))) not sql ((("),
            Err(QuerySafetyError::Unparseable { .. })
        ));
    }

    #[test]
    fn an_allowlisted_function_is_accepted() {
        assert!(parse_predicate("scope", "lower(service) = 'checkout'").is_ok());
    }

    #[test]
    fn a_function_outside_the_allowlist_is_rejected() {
        assert!(matches!(
            parse_predicate("scope", "pg_sleep(10) IS NOT NULL"),
            Err(QuerySafetyError::FunctionNotAllowed { .. })
        ));
    }

    /// An empty scope means "all rows" and must not be forced through the
    /// parser as an empty predicate.
    #[test]
    fn an_empty_predicate_is_rejected_rather_than_treated_as_true() {
        assert!(parse_predicate("scope", "").is_err());
        assert!(parse_predicate("scope", "   ").is_err());
    }

    // ---- dual-query projection contract ------------------------------------

    fn cq(sql: &str) -> CountQuery {
        CountQuery {
            stream: "requests".into(),
            stream_type: "logs".into(),
            sql: sql.into(),
        }
    }

    #[test]
    fn a_conforming_dual_query_member_is_accepted() {
        let keys = validate_count_query(
            "good",
            &cq(
                "SELECT histogram(_timestamp, '5 minute') AS slice_start, region, \
                 count(*) AS zo_slo_value FROM requests GROUP BY slice_start, region",
            ),
            &["region".to_string()],
            300,
        )
        .unwrap();
        assert_eq!(keys, vec!["slice_start".to_string(), "region".to_string()]);
    }

    #[test]
    fn a_dual_query_member_that_is_not_a_select_is_rejected() {
        assert!(matches!(
            validate_count_query("good", &cq("DELETE FROM requests"), &[], 300),
            Err(QuerySafetyError::NotSelectOnly { .. })
        ));
    }

    #[test]
    fn a_dual_query_member_missing_zo_slo_value_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '5 minute') AS slice_start FROM requests"),
                &[],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    #[test]
    fn a_dual_query_member_missing_slice_start_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT count(*) AS zo_slo_value FROM requests"),
                &[],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    #[test]
    fn a_dual_query_member_missing_a_group_by_column_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '5 minute') AS slice_start, \
                     count(*) AS zo_slo_value FROM requests"),
                &["region".to_string()],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    /// Extra projected columns are rejected too — the ingest job writes a
    /// fixed row shape, so anything unexpected is silently dropped otherwise.
    #[test]
    fn a_dual_query_member_projecting_extra_columns_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '5 minute') AS slice_start, \
                     count(*) AS zo_slo_value, now() AS surprise FROM requests"),
                &[],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    /// Without a matching key schema the join that pairs numerator to
    /// denominator is undefined — good/total would be combined across
    /// different groups.
    #[test]
    fn dual_queries_with_different_key_schemas_are_rejected() {
        // The denominator omits `region`, so it cannot be joined per-group.
        // This surfaces as a projection mismatch NAMING the offending query,
        // which is strictly more useful than a symmetric "they disagree".
        let cfg = SliConfig::Count {
            source: CountSource::DualQuery {
                good: cq(
                    "SELECT histogram(_timestamp, '5 minute') AS slice_start, region, \
                          count(*) AS zo_slo_value FROM a GROUP BY slice_start, region",
                ),
                total: cq("SELECT histogram(_timestamp, '5 minute') AS slice_start, \
                           count(*) AS zo_slo_value FROM b GROUP BY slice_start"),
            },
        };
        assert!(matches!(
            validate_query_safety(&cfg, &["region".to_string()], 300),
            Err(QuerySafetyError::ProjectionMismatch {
                field: "total_query",
                ..
            })
        ));
    }

    /// The bucket width must equal the SLO's slice interval, or the rows do
    /// not line up with the grid every coverage denominator is computed from.
    #[test]
    fn a_histogram_interval_other_than_the_slice_interval_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '1 minute') AS slice_start, \
                     count(*) AS zo_slo_value FROM requests GROUP BY slice_start"),
                &[],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    #[test]
    fn the_matching_histogram_interval_is_accepted_for_both_slice_widths() {
        assert!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '1 minute') AS slice_start, \
                     count(*) AS zo_slo_value FROM requests GROUP BY slice_start"),
                &[],
                60
            )
            .is_ok()
        );
    }

    #[test]
    fn a_query_grouping_by_the_wrong_columns_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq(
                    "SELECT histogram(_timestamp, '5 minute') AS slice_start, region, \
                     count(*) AS zo_slo_value FROM requests GROUP BY slice_start"
                ),
                &["region".to_string()],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    #[test]
    fn a_non_numeric_zo_slo_value_is_rejected() {
        assert!(matches!(
            validate_count_query(
                "good",
                &cq("SELECT histogram(_timestamp, '5 minute') AS slice_start, \
                     service AS zo_slo_value FROM requests GROUP BY slice_start, service"),
                &[],
                300
            ),
            Err(QuerySafetyError::ProjectionMismatch { .. })
        ));
    }

    // ---- stream / language compatibility -----------------------------------

    #[test]
    fn sql_addresses_a_logs_stream() {
        assert_eq!(language_suits_stream("logs", QueryLanguage::Sql), Ok(()));
    }

    /// Metrics are ordinary streams with a `value` column, so SQL addresses
    /// them like any other. Forbidding it was the rule's one mistake.
    #[test]
    fn sql_addresses_a_metrics_stream() {
        assert_eq!(language_suits_stream("metrics", QueryLanguage::Sql), Ok(()));
    }

    #[test]
    fn promql_addresses_a_metrics_stream() {
        assert_eq!(
            language_suits_stream("metrics", QueryLanguage::PromQl),
            Ok(())
        );
    }

    #[test]
    fn promql_cannot_address_a_logs_stream() {
        assert!(matches!(
            language_suits_stream("logs", QueryLanguage::PromQl),
            Err(QuerySafetyError::LanguageNotValidForStream { .. })
        ));
    }

    #[test]
    fn query_safety_runs_over_the_whole_sli_config() {
        let bad = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: Some("a = 1; DROP TABLE users".into()),
                good_expr: "status_code < 500".into(),
            },
        };
        assert!(validate_query_safety(&bad, &[], 300).is_err());

        let good = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                scope: Some("service = 'checkout'".into()),
                good_expr: "status_code < 500".into(),
            },
        };
        assert_eq!(validate_query_safety(&good, &[], 300), Ok(()));
    }

    /// The whole point of the rule change: a metrics stream is queryable in
    /// SQL, so a SQL time slice over one is a legitimate definition rather
    /// than a save-time rejection. With a scope, because that is what the form
    /// now offers for one — a SQL plan has a `WHERE (…)` to put it in whatever
    /// the stream type is.
    #[test]
    fn a_sql_time_slice_over_metrics_is_accepted() {
        let cfg = SliConfig::TimeSlice {
            stream: "http_metrics".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::Sql,
            query: "avg(value)".into(),
            scope: Some("job = 'api'".into()),
            comparator: Operator::LessThan,
            threshold: 500.0,
            absent_is_bad: false,
        };
        assert_eq!(validate_query_safety(&cfg, &[], 300), Ok(()));
    }

    /// The other direction is still a mismatch — PromQL has no logs stream to
    /// address, and that half of the rule is what keeps it a rule.
    #[test]
    fn a_time_slice_config_with_a_mismatched_language_is_rejected() {
        let cfg = SliConfig::TimeSlice {
            stream: "requests".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::PromQl,
            query: "up".into(),
            scope: None,
            comparator: Operator::LessThan,
            threshold: 500.0,
            absent_is_bad: false,
        };
        assert!(matches!(
            validate_query_safety(&cfg, &[], 300),
            Err(QuerySafetyError::LanguageNotValidForStream { .. })
        ));
    }

    /// `CountSource::SingleQuery` is validated against SQL, so this is where
    /// the old rule turned "count SLO over a metrics stream" into a guaranteed
    /// 400. Nothing else in the arm looks at the stream type.
    #[test]
    fn a_sql_count_over_metrics_passes_query_safety() {
        let cfg = SliConfig::Count {
            source: CountSource::SingleQuery {
                stream: "cpu_usage".into(),
                stream_type: "metrics".into(),
                scope: Some("job = 'api'".into()),
                good_expr: "value < 0.8".into(),
            },
        };
        assert_eq!(validate_query_safety(&cfg, &[], 300), Ok(()));
    }

    /// A create request must not have to invent server-assigned fields.
    #[test]
    fn an_slo_deserializes_without_server_assigned_fields() {
        let json = serde_json::json!({
            "name": "checkout availability",
            "sli_type": "count",
            "config": {
                "source": {
                    "mode": "single_query",
                    "query": {
                        "stream": "requests",
                        "stream_type": "logs",
                        "good_expr": "status_code < 500"
                    }
                }
            },
            "target": 99.9,
            "window_secs": 604_800,
            "slice_interval_secs": 60,
            "enabled": true
        });
        let slo: Slo = serde_json::from_value(json).expect("must deserialize");
        assert_eq!(slo.id, "");
        assert_eq!(slo.definition_generation, 0);
        assert_eq!(slo.groups_reserved, 0);
        assert_eq!(slo.target, 99.9);
    }

    #[test]
    fn sli_type_storage_ids_round_trip() {
        for t in [SliType::Count, SliType::TimeSlice, SliType::Alert] {
            assert_eq!(SliType::from_storage_id(t.storage_id()), Some(t));
        }
    }

    /// Pinned, not derived. A reordering of the enum that silently shifted
    /// these would reinterpret every stored row as a different SLI type.
    #[test]
    fn sli_type_storage_ids_are_pinned() {
        assert_eq!(SliType::Count.storage_id(), 1);
        assert_eq!(SliType::TimeSlice.storage_id(), 2);
        assert_eq!(SliType::Alert.storage_id(), 3);
        assert_eq!(SliType::from_storage_id(0), None);
        assert_eq!(SliType::from_storage_id(4), None);
    }

    // ---- time-slice threshold finiteness ------------------------------------

    /// The threshold decides whether every bucket is good or bad. `NaN`
    /// compares false against everything, so every slice classifies bad;
    /// `±inf` classifies every slice the same way in the other direction.
    /// Either way the SLO reports a confident, uniform, wrong answer.
    #[test]
    fn a_non_finite_time_slice_threshold_is_rejected() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let cfg = SliConfig::TimeSlice {
                stream: "requests".into(),
                stream_type: "logs".into(),
                query_language: QueryLanguage::Sql,
                query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
                scope: None,
                comparator: Operator::LessThan,
                threshold: bad,
                absent_is_bad: false,
            };
            let d = def(cfg, None, SLICE_60_SECS);
            // NOT assert_eq: NaN != NaN, so comparing the payload can never
            // succeed for the NaN case.
            assert!(
                matches!(
                    validate_slo(&d, 99.9, None),
                    Err(SloValidationError::ThresholdNotFinite(_))
                ),
                "threshold {bad} accepted"
            );
        }
    }

    #[test]
    fn a_finite_time_slice_threshold_is_accepted() {
        for ok in [0.0, -5.0, 500.0, 1e9] {
            let cfg = SliConfig::TimeSlice {
                stream: "requests".into(),
                stream_type: "logs".into(),
                query_language: QueryLanguage::Sql,
                query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
                scope: None,
                comparator: Operator::LessThan,
                threshold: ok,
                absent_is_bad: false,
            };
            let d = def(cfg, None, SLICE_60_SECS);
            assert_eq!(
                validate_slo(&d, 99.9, None),
                Ok(()),
                "threshold {ok} rejected"
            );
        }
    }

    // ---- target edge cases --------------------------------------------------

    #[test]
    fn a_non_finite_target_is_rejected() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(
                validate_slo(&ungrouped(), bad, None).is_err(),
                "target {bad} accepted"
            );
        }
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

/// Tests for the PromQL count source (metrics-native counting).
///
/// Written FIRST, against an API that does not exist yet — the variant, the
/// error, and the validation arm below are the specification.
#[cfg(test)]
mod promql_count_source_tests {
    use super::*;

    fn promql_cfg(good: &str, total: &str) -> SliConfig {
        SliConfig::Count {
            source: CountSource::PromQl {
                good: good.into(),
                total: total.into(),
            },
        }
    }

    #[test]
    fn a_promql_count_source_round_trips() {
        let cfg = promql_cfg(
            "increase(http_requests_total[5m]) - increase(http_errors_total[5m])",
            "increase(http_requests_total[5m])",
        );
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), cfg);
    }

    /// The wire shape is part of the API contract: mode-tagged like its two
    /// siblings, so a client dispatches every count source on the same field.
    #[test]
    fn the_wire_shape_is_mode_tagged() {
        let json = r#"{"sli_type":"count","config":{"source":{"mode":"prom_ql","query":{"good":"g","total":"t"}}}}"#;
        let parsed: SliConfig = serde_json::from_str(json).unwrap();
        assert_eq!(parsed, promql_cfg("g", "t"));
    }

    /// The denormalized `slos.sli_type` column and every list filter key on
    /// the TYPE — a new source must not become a new type.
    #[test]
    fn a_promql_source_is_still_a_count_sli() {
        assert_eq!(promql_cfg("g", "t").sli_type(), SliType::Count);
    }

    /// Adding the variant must not disturb what is already stored.
    #[test]
    fn stored_single_query_json_still_parses_unchanged() {
        let json = r#"{"sli_type":"count","config":{"source":{"mode":"single_query","query":{"stream":"s","stream_type":"logs","good_expr":"ok"}}}}"#;
        let parsed: SliConfig = serde_json::from_str(json).unwrap();
        let SliConfig::Count {
            source: CountSource::SingleQuery { good_expr, .. },
        } = parsed
        else {
            panic!("single_query no longer parses to SingleQuery");
        };
        assert_eq!(good_expr, "ok");
    }

    // ── save-time validation ────────────────────────────────────────────────

    #[test]
    fn a_promql_pair_is_accepted() {
        assert!(
            validate_query_safety(
                &promql_cfg("increase(a[5m]) - increase(b[5m])", "increase(a[5m])"),
                &[],
                300
            )
            .is_ok()
        );
    }

    /// An empty expression would save cleanly and then measure nothing — the
    /// same silent-permanent-no-data failure the stream picker closed.
    #[test]
    fn an_empty_promql_expression_is_rejected() {
        for (good, total, which) in [
            ("", "t", "good"),
            ("g", "", "total"),
            ("   ", "t", "good"),
            ("g", "\n", "total"),
        ] {
            let err = validate_query_safety(&promql_cfg(good, total), &[], 300).unwrap_err();
            assert!(
                matches!(err, QuerySafetyError::EmptyExpression { field } if field == which),
                "({good:?}, {total:?}): expected EmptyExpression for {which}, got {err:?}"
            );
        }
    }

    /// Grouping a PromQL source is legal: the series' labels supply the group
    /// values at evaluation time, so there is no column list to check
    /// statically — unlike the dual-query SQL members.
    #[test]
    fn a_grouped_promql_source_passes_query_safety() {
        assert!(validate_query_safety(&promql_cfg("g", "t"), &["region".into()], 300).is_ok());
    }
}

/// Tests for `absent_is_bad` (freshness semantics).
///
/// S-8 says an empty slice is a gap, because a search outage must freeze the
/// SLO rather than page as downtime. For a freshness SLO, absence IS the
/// failure — a silent pipeline is a broken pipeline. The flag flips the
/// meaning of a slice the search PROVED empty; a failed search still writes
/// nothing, for every type (that distinction is structural: gap fill only
/// runs after a successful query).
#[cfg(test)]
mod absent_is_bad_tests {
    use super::*;

    fn ts(absent_is_bad: bool) -> SliConfig {
        SliConfig::TimeSlice {
            stream: "etl_output".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::Sql,
            query: "count(*)".into(),
            scope: None,
            comparator: Operator::GreaterThanEquals,
            threshold: 1.0,
            absent_is_bad,
        }
    }

    fn def(sli: SliConfig, group_by: Option<Vec<String>>) -> SloDefinition {
        SloDefinition {
            sli_config: sli,
            group_by,
            window_secs: WINDOW_30D_SECS,
            slice_interval_secs: SLICE_300_SECS,
        }
    }

    /// THE upgrade guarantee: every time-slice SLO already stored was
    /// serialized without this field and must keep S-8 gap semantics.
    #[test]
    fn stored_time_slice_json_parses_with_the_flag_off() {
        let json = r#"{"sli_type":"time_slice","config":{"stream":"s","stream_type":"logs","query_language":"sql","query":"count(*)","comparator":">=","threshold":1.0}}"#;
        let parsed: SliConfig = serde_json::from_str(json).unwrap();
        let SliConfig::TimeSlice { absent_is_bad, .. } = parsed else {
            panic!("wrong variant");
        };
        assert!(!absent_is_bad);
    }

    #[test]
    fn the_flag_round_trips_when_on() {
        let json = serde_json::to_string(&ts(true)).unwrap();
        assert!(json.contains("absent_is_bad"), "{json}");
        assert_eq!(serde_json::from_str::<SliConfig>(&json).unwrap(), ts(true));
    }

    /// Off is omitted, so re-saving an old SLO writes the JSON it already has.
    #[test]
    fn the_flag_is_omitted_from_json_when_off() {
        let json = serde_json::to_string(&ts(false)).unwrap();
        assert!(!json.contains("absent_is_bad"), "{json}");
    }

    /// Gap fill only fills groups PRESENT in the pass, so a fully absent
    /// group would silently decay to frozen rather than reading bad — a lie
    /// for the exact use case this flag serves. Rejected until per-group fill
    /// exists, rather than half-working (D27: ignored config is invisible
    /// config).
    #[test]
    fn a_grouped_slo_cannot_set_absent_is_bad() {
        let err =
            validate_slo(&def(ts(true), Some(vec!["region".into()])), 99.9, None).unwrap_err();
        assert!(
            matches!(err, SloValidationError::AbsentIsBadRequiresUngrouped),
            "got {err:?}"
        );
    }

    #[test]
    fn an_ungrouped_absent_is_bad_slo_is_accepted() {
        assert!(validate_slo(&def(ts(true), None), 99.9, None).is_ok());
        assert!(
            validate_slo(&def(ts(true), Some(vec![])), 99.9, None).is_ok(),
            "an EMPTY group_by is ungrouped and must not trip the rule"
        );
    }

    #[test]
    fn a_grouped_time_slice_without_the_flag_is_still_accepted() {
        assert!(validate_slo(&def(ts(false), Some(vec!["region".into()])), 99.9, None).is_ok());
    }
}

/// Tests for the time-slice arm of [`validate_query_safety`] (§6b.7).
///
/// Two HAZARDs, one per language, both of the same species — config that saves
/// cleanly and is then silently ignored or silently measures nothing (D27:
/// ignored config is invisible config):
///
/// * **`scope` under PromQL.** A scope is a SQL `WHERE (…)` fragment — that is literally where
///   `time_slice_sql` puts it. A PromQL time-slice plan is the bare expression, evaluated by the
///   metrics engine, with nowhere to put a WHERE clause. So a scope saved against a PromQL
///   time-slice narrows nothing, forever, and the SLI silently measures a wider population than the
///   user asked for. Label matchers belong inside the expression.
/// * **an empty `query`.** For PromQL it saves and then measures nothing — permanent no-data. For
///   SQL it is spliced in as `SELECT  AS zo_slo_value`, which does not parse, so every pass fails
///   and the SLO freezes at ingest. The SQL twin was never validated at all before this.
#[cfg(test)]
mod time_slice_query_safety_tests {
    use super::*;

    /// The stream type follows the language, so these fixtures never trip
    /// [`language_suits_stream`] by accident — that rule has its own test.
    fn ts(query_language: QueryLanguage, query: &str, scope: Option<&str>) -> SliConfig {
        let stream_type = match query_language {
            QueryLanguage::PromQl => "metrics",
            QueryLanguage::Sql => "logs",
        };
        SliConfig::TimeSlice {
            stream: "http_requests".into(),
            stream_type: stream_type.into(),
            query_language,
            query: query.into(),
            scope: scope.map(Into::into),
            comparator: Operator::LessThan,
            threshold: 500.0,
            absent_is_bad: false,
        }
    }

    const PROMQL_AGG: &str =
        "histogram_quantile(0.95, sum by (le) (rate(http_duration_bucket[5m])))";
    const SQL_AGG: &str = "approx_percentile_cont(duration_ms, 0.95)";

    // ── scope is meaningless under PromQL ───────────────────────────────────

    #[test]
    fn a_promql_time_slice_with_a_scope_is_rejected() {
        let cfg = ts(
            QueryLanguage::PromQl,
            PROMQL_AGG,
            Some("service = 'checkout'"),
        );
        let err = validate_query_safety(&cfg, &[], 300).unwrap_err();
        assert!(
            matches!(
                err,
                QuerySafetyError::ScopeNotValidForLanguage {
                    query_language: QueryLanguage::PromQl
                }
            ),
            "got {err:?}"
        );
    }

    /// This scope is one `parse_predicate` has its own rejection for (the
    /// statement separator). Reporting the LANGUAGE rule for it is only
    /// possible if `parse_predicate` never ran.
    #[test]
    fn a_promql_scope_is_never_handed_to_the_sql_predicate_parser() {
        let cfg = ts(
            QueryLanguage::PromQl,
            PROMQL_AGG,
            Some("a = 1; DROP TABLE users"),
        );
        let err = validate_query_safety(&cfg, &[], 300).unwrap_err();
        assert!(
            matches!(err, QuerySafetyError::ScopeNotValidForLanguage { .. }),
            "got {err:?}"
        );
    }

    /// A blank scope is what a UI leaves behind when the user switches the
    /// language, and the planner already treats it as absent
    /// (`scope.filter(|s| !s.trim().is_empty())`). Rejecting it would refuse a
    /// config that means exactly "no scope".
    #[test]
    fn a_blank_scope_is_accepted_under_promql() {
        for scope in [Some(""), Some("   "), Some("\n\t")] {
            assert_eq!(
                validate_query_safety(&ts(QueryLanguage::PromQl, PROMQL_AGG, scope), &[], 300),
                Ok(()),
                "scope {scope:?} means `no scope` and must be accepted"
            );
        }
    }

    /// The rule is language-scoped: SQL keeps the full predicate check it
    /// always had. Which of the two separator rejections fires is left open,
    /// matching `a_statement_separator_is_rejected` — the point is only that
    /// the fragment was parsed at all.
    #[test]
    fn a_sql_time_slice_still_validates_its_scope() {
        assert_eq!(
            validate_query_safety(
                &ts(QueryLanguage::Sql, SQL_AGG, Some("service = 'checkout'")),
                &[],
                300
            ),
            Ok(())
        );
        let err = validate_query_safety(
            &ts(QueryLanguage::Sql, SQL_AGG, Some("a = 1; DROP TABLE users")),
            &[],
            300,
        )
        .unwrap_err();
        assert!(
            matches!(
                err,
                QuerySafetyError::ContainsStatementSeparator { field: "scope" }
                    | QuerySafetyError::NotASingleExpression { field: "scope" }
            ),
            "got {err:?}"
        );
    }

    /// Pinned because the obvious implementation of the PromQL rule — hoist
    /// `filter(|s| !s.trim().is_empty())` above the language branch — would
    /// silently start accepting a blank SQL scope too. `parse_predicate` has
    /// always refused one, and changing that is not this rule's business.
    /// The variant is pinned, not just "some error": for a BLANK fragment
    /// `parse_predicate` is deterministic, and answering a SQL user with the
    /// PromQL-only rule would be a wrong sentence rather than a wrong outcome.
    #[test]
    fn a_blank_sql_scope_is_still_refused() {
        for scope in ["", "   "] {
            let err =
                validate_query_safety(&ts(QueryLanguage::Sql, SQL_AGG, Some(scope)), &[], 300)
                    .unwrap_err();
            assert!(
                matches!(
                    err,
                    QuerySafetyError::NotASingleExpression { field: "scope" }
                ),
                "blank SQL scope {scope:?}: got {err:?}"
            );
        }
    }

    // ── an empty aggregate is rejected in BOTH languages ────────────────────

    #[test]
    fn an_empty_time_slice_query_is_rejected_in_both_languages() {
        for language in [QueryLanguage::Sql, QueryLanguage::PromQl] {
            for query in ["", "   ", "\n\t"] {
                let err = validate_query_safety(&ts(language, query, None), &[], 300).unwrap_err();
                assert!(
                    matches!(err, QuerySafetyError::EmptyExpression { field: "query" }),
                    "{language:?} {query:?}: got {err:?}"
                );
            }
        }
    }

    /// The emptiness rule must not hide behind the scope branch. A SQL
    /// time-slice with a perfectly good scope and no aggregate still emits
    /// `SELECT  AS zo_slo_value`, and the SLO freezes at ingest.
    #[test]
    fn an_empty_query_is_still_rejected_when_the_scope_is_valid() {
        let cfg = ts(QueryLanguage::Sql, "", Some("service = 'checkout'"));
        let err = validate_query_safety(&cfg, &[], 300).unwrap_err();
        assert!(
            matches!(err, QuerySafetyError::EmptyExpression { field: "query" }),
            "got {err:?}"
        );
    }

    #[test]
    fn a_non_empty_time_slice_query_is_accepted_in_both_languages() {
        assert_eq!(
            validate_query_safety(&ts(QueryLanguage::Sql, SQL_AGG, None), &[], 300),
            Ok(())
        );
        assert_eq!(
            validate_query_safety(&ts(QueryLanguage::PromQl, PROMQL_AGG, None), &[], 300),
            Ok(())
        );
    }

    /// Check order is part of the contract. A PromQL SLO pointed at a `logs`
    /// stream is wrong about the *stream* first; reporting a scope or an empty
    /// aggregate instead would send the user to fix the wrong field.
    #[test]
    fn the_stream_language_rule_still_reports_first() {
        let cfg = SliConfig::TimeSlice {
            stream: "requests".into(),
            stream_type: "logs".into(),
            query_language: QueryLanguage::PromQl,
            query: String::new(),
            scope: Some("service = 'checkout'".into()),
            comparator: Operator::LessThan,
            threshold: 500.0,
            absent_is_bad: false,
        };
        let err = validate_query_safety(&cfg, &[], 300).unwrap_err();
        assert!(
            matches!(err, QuerySafetyError::LanguageNotValidForStream { .. }),
            "got {err:?}"
        );
    }

    /// Both new rules can fire at once, and either order compiles. The scope
    /// is reported first because it is the language-specific rule, in the same
    /// position `parse_predicate` occupied before it.
    #[test]
    fn the_scope_rule_reports_before_the_empty_query_rule() {
        let cfg = ts(QueryLanguage::PromQl, "", Some("service = 'checkout'"));
        let err = validate_query_safety(&cfg, &[], 300).unwrap_err();
        assert!(
            matches!(err, QuerySafetyError::ScopeNotValidForLanguage { .. }),
            "got {err:?}"
        );
    }

    // ── the messages ────────────────────────────────────────────────────────

    /// The rejection has to say what to do instead, or the user simply retries
    /// with a different scope.
    #[test]
    fn the_scope_rejection_names_the_language_and_the_remedy() {
        let msg = QuerySafetyError::ScopeNotValidForLanguage {
            query_language: QueryLanguage::PromQl,
        }
        .to_string();
        // Case-insensitive throughout: the sibling `LanguageNotValidForStream`
        // renders the language through `{:?}` ("PromQl"), and which spelling
        // or capitalization wins is not what this test is about.
        let msg = msg.to_lowercase();
        assert!(msg.contains("scope"), "{msg}");
        assert!(msg.contains("promql"), "{msg}");
        assert!(msg.contains("label"), "{msg}");
    }

    /// `EmptyExpression` is now shared with the SQL aggregate, so its message
    /// must not tell someone editing a SQL time-slice SLO about PromQL.
    #[test]
    fn the_empty_expression_message_is_language_neutral() {
        let msg = QuerySafetyError::EmptyExpression { field: "query" }.to_string();
        assert!(msg.contains("query"), "{msg}");
        assert!(!msg.to_lowercase().contains("promql"), "{msg}");
    }
}
