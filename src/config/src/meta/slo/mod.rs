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
pub mod budget_rows;
pub mod condition;
pub mod coverage;
pub mod generation;
pub mod group;
pub mod math;
pub mod slice;
pub mod stream;
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
pub fn language_suits_stream(
    stream_type: &str,
    query_language: QueryLanguage,
) -> Result<(), QuerySafetyError> {
    let ok = match query_language {
        // SQL addresses any stream; PromQL only makes sense over metrics.
        QueryLanguage::Sql => stream_type != "metrics",
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
        },
        SliConfig::TimeSlice {
            stream_type,
            query_language,
            scope,
            ..
        } => {
            language_suits_stream(stream_type, *query_language)?;
            if let Some(scope) = scope {
                parse_predicate("scope", scope)?;
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
    /// A grouped source cannot report per-group coverage: the triggers stream
    /// carries one record per evaluation, not per group (D8, D65).
    pub is_grouped: bool,
    pub is_slo_alert: bool,
    pub is_composite: bool,
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
///    source-eligibility rules (scheduled, ungrouped, not itself an SLO alert or composite)
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
        }
        SliConfig::Alert { .. } => {
            let Some(facts) = source_alert else {
                return Err(SloValidationError::AlertSliSourceUnknown);
            };
            if facts.is_slo_alert || facts.is_composite {
                return Err(SloValidationError::AlertSliSourceIneligible);
            }
            if !facts.is_scheduled {
                return Err(SloValidationError::AlertSliSourceNotScheduled);
            }
            if facts.is_grouped {
                return Err(SloValidationError::AlertSliSourceIsGrouped);
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

    fn eligible_source() -> SourceAlertFacts {
        SourceAlertFacts {
            is_scheduled: true,
            is_grouped: false,
            is_slo_alert: false,
            is_composite: false,
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

    #[test]
    fn a_time_slice_config_with_a_mismatched_language_is_rejected() {
        let cfg = SliConfig::TimeSlice {
            stream: "http_metrics".into(),
            stream_type: "metrics".into(),
            query_language: QueryLanguage::Sql,
            query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
            scope: None,
            comparator: Operator::LessThan,
            threshold: 500.0,
        };
        assert!(matches!(
            validate_query_safety(&cfg, &[], 300),
            Err(QuerySafetyError::LanguageNotValidForStream { .. })
        ));
    }

    // ---- time-slice threshold finiteness ------------------------------------

    /// The threshold decides whether every bucket is good or bad. `NaN`
    /// compares false against everything, so every slice classifies bad;
    /// `±inf` classifies every slice the same way in the other direction.
    /// Either way the SLO reports a confident, uniform, wrong answer.
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
