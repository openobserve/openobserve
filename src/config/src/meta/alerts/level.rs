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

//! Multi-level alert thresholds — Feature 1 of `alerts_2.md`.
//!
//! `AlertLevel` ("how bad?") is a **separate axis** from `RunOutcome`
//! ("did the evaluation fire?"). An alert can be `firing` at `Warning`, or
//! `notify_failed` at `Critical`. Do not merge them — conflating the two is
//! what made the legacy `completed` value ambiguous (`alerts.md` Part III).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{Operator, TriggerCondition};

/// Storage shape for the level/threshold axis — the `alerts.trigger_thresholds`
/// JSON column (decision D1 in `alerts_2.md`).
///
/// A blob rather than one column per knob: SLO alerting brings a cluster of
/// threshold fields at once (burn-rate warning/critical, long/short windows,
/// error-budget threshold) on top of recovery thresholds and
/// `notify_on_warning`, and each dedicated column would cost its own migration
/// plus a `DB_SCHEMA_VERSION` bump.
///
/// **Scope rule:** threshold and level configuration only. Not notification
/// routing, not scheduling, not general alert config. A typed struct rather
/// than a free-form map so the contents stay discoverable and this cannot rot
/// into a junk drawer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct ThresholdConfig {
    /// Warning threshold; shares `TriggerCondition.operator` with critical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<i64>,
    /// Whether a Warning-level match delivers a notification (D11).
    ///
    /// `None` = true — warnings notify unless explicitly opted out. Set
    /// false for "page me only on critical, show warnings on the dashboard":
    /// state, history and the UI still update at Warning, but nothing is
    /// delivered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify_on_warning: Option<bool>,
    /// WARNING value for a PromQL alert's condition. Lives here rather than in
    /// `Condition` so the shared filter type stays free of alert-specific
    /// fields.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promql_warning: Option<f64>,
    // Reserved for Phase 4 / SLO work — declared here so the shape is known,
    // but nothing reads them yet:
    //   critical_recovery, warning_recovery  (hysteresis, alerts_2.md §6.2)
    //   notify_on_warning                    (D11)
}

impl ThresholdConfig {
    /// True when nothing is configured — callers store `NULL` rather than an
    /// empty object so a single-level alert has no column value at all.
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// Severity of a matched threshold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum AlertLevel {
    #[serde(rename = "ok")]
    Ok,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "critical")]
    Critical,
    /// Reserved: the policy that produces it ships in Phase 2 (`alerts_2.md`
    /// §7.3). The variant exists now so the storage mapping never shifts.
    #[serde(rename = "no_data")]
    NoData,
}

impl AlertLevel {
    /// Durable storage id for `alert_states.level` and the transition columns.
    ///
    /// These are persisted — never reorder or reuse. Deliberately NOT the same
    /// as [`Self::severity_rank`]: `NoData` stores as 3 but ranks below
    /// `Warning`.
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Ok => 0,
            Self::Warning => 1,
            Self::Critical => 2,
            Self::NoData => 3,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            0 => Some(Self::Ok),
            1 => Some(Self::Warning),
            2 => Some(Self::Critical),
            3 => Some(Self::NoData),
            _ => None,
        }
    }

    /// Ordering for "most severe wins" (M-2 rollup).
    ///
    /// `NoData` sits between `Ok` and `Warning`: "we don't know" is a problem,
    /// but not worse than "we know it is bad".
    pub fn severity_rank(&self) -> u8 {
        match self {
            Self::Ok => 0,
            Self::NoData => 1,
            Self::Warning => 2,
            Self::Critical => 3,
        }
    }

    /// Levels that mean the alert is currently triggered.
    pub fn is_firing(&self) -> bool {
        matches!(self, Self::Warning | Self::Critical)
    }

    /// Highest-severity level in an iterator; `None` if empty.
    pub fn most_severe<I: IntoIterator<Item = Self>>(levels: I) -> Option<Self> {
        levels.into_iter().max_by_key(|l| l.severity_rank())
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Warning => "warning",
            Self::Critical => "critical",
            Self::NoData => "no_data",
        }
    }
}

impl std::fmt::Display for AlertLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why a critical/warning threshold pair was rejected (§4.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThresholdError {
    /// The warning threshold is not strictly less severe than critical, given
    /// the operator's direction.
    WarningNotLessSevere,
    /// The operator has no severity ordering, so a second level is meaningless.
    OperatorNotOrderable(Operator),
}

impl std::fmt::Display for ThresholdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WarningNotLessSevere => {
                f.write_str("warning threshold must be less severe than critical for this operator")
            }
            Self::OperatorNotOrderable(op) => write!(
                f,
                "operator `{op}` has no severity ordering; a warning threshold is not supported"
            ),
        }
    }
}

impl std::error::Error for ThresholdError {}

/// Direction of an operator, used for both validation and sizing.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    /// Larger is more severe (`>`, `>=`).
    Greater,
    /// Smaller is more severe (`<`, `<=`).
    Less,
    /// No severity ordering (`=`, `!=`, `contains`, …).
    Unordered,
}

fn direction(op: Operator) -> Direction {
    match op {
        Operator::GreaterThan | Operator::GreaterThanEquals => Direction::Greater,
        Operator::LessThan | Operator::LessThanEquals => Direction::Less,
        _ => Direction::Unordered,
    }
}

/// Numeric comparison. Non-numeric operators never match here — they are
/// handled upstream by the condition builder, not by threshold evaluation.
pub fn compare(actual: f64, op: Operator, threshold: f64) -> bool {
    match op {
        Operator::EqualTo => actual == threshold,
        Operator::NotEqualTo => actual != threshold,
        Operator::GreaterThan => actual > threshold,
        Operator::GreaterThanEquals => actual >= threshold,
        Operator::LessThan => actual < threshold,
        Operator::LessThanEquals => actual <= threshold,
        _ => false,
    }
}

/// Core classifier: pure values, shared by the count path AND the aggregation
/// path (whose thresholds live in `Aggregation.having.value` / `warning_value`
/// and may be fractional).
///
/// Critical is checked first — the most severe match wins (T-3).
pub fn evaluate_level_values(
    actual: f64,
    op: Operator,
    critical: f64,
    warning: Option<f64>,
) -> Option<AlertLevel> {
    if compare(actual, op, critical) {
        return Some(AlertLevel::Critical);
    }
    if let Some(w) = warning
        && compare(actual, op, w)
    {
        return Some(AlertLevel::Warning);
    }
    None
}

/// Convenience wrapper for count-based alerts; counts widen losslessly to f64.
pub fn evaluate_level(actual: f64, tc: &TriggerCondition) -> Option<AlertLevel> {
    evaluate_level_values(
        actual,
        tc.operator,
        tc.threshold as f64,
        tc.warning_threshold.map(|w| w as f64),
    )
}

/// Level to record for an evaluation that **completed successfully**.
///
/// `evaluate_level` returns `None` to mean "matched no threshold", which is the
/// healthy state — `Ok` — NOT "no level could be computed". Those two meanings
/// must not be conflated: `apply_outcome` treats a `None` level as "carry the
/// level axis forward untouched", which is correct only for a *failed*
/// evaluation (a query error observed nothing).
///
/// Every successful-evaluation caller must funnel through here so the state row
/// and the triggers-stream record cannot disagree about the same evaluation.
pub fn level_for_successful_evaluation(matched: Option<AlertLevel>) -> AlertLevel {
    matched.unwrap_or(AlertLevel::Ok)
}

/// What a completed evaluation should do about notification (§7.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryDecision {
    /// Deliver, and (re)start the silence window from now.
    Deliver,
    /// Deliver because severity increased; resets silence even mid-window.
    DeliverEscalation,
    /// Condition matched but delivery is suppressed by the silence window.
    SuppressedBySilence,
    /// Warning matched and `notify_on_warning` is off.
    SuppressedByWarningPolicy,
    /// Nothing to deliver — the alert is not firing.
    NotFiring,
}

impl DeliveryDecision {
    pub fn should_deliver(&self) -> bool {
        matches!(self, Self::Deliver | Self::DeliverEscalation)
    }

    /// Escalation restarts the silence window; an ordinary delivery starts it.
    pub fn resets_silence(&self) -> bool {
        self.should_deliver()
    }
}

/// Decide whether this evaluation delivers a notification.
///
/// This is the §7.1 rule set, kept pure so it can be tested without a
/// scheduler. It exists because silence must stop meaning "skip evaluation":
/// a Warning→Critical escalation inside a silence window is only observable if
/// the alert keeps evaluating, and only actionable if escalation overrides the
/// suppression.
///
/// * `level` — severity this evaluation classified.
/// * `last_notified` — severity of the last DELIVERED notification. Escalation is measured against
///   this, not the previous evaluation, so a flap down and back up does not re-notify.
/// * `silenced_until` — delivery suppressed until this timestamp.
/// * `notify_on_warning` — D11; `None` means true.
pub fn delivery_decision(
    level: AlertLevel,
    last_notified: Option<AlertLevel>,
    silenced_until: Option<i64>,
    now: i64,
    notify_on_warning: Option<bool>,
) -> DeliveryDecision {
    if !level.is_firing() {
        return DeliveryDecision::NotFiring;
    }
    if level == AlertLevel::Warning && !notify_on_warning.unwrap_or(true) {
        return DeliveryDecision::SuppressedByWarningPolicy;
    }

    // Severity increased since the last delivery -> notify even while silenced.
    let escalated = last_notified.is_none_or(|prev| level.severity_rank() > prev.severity_rank());

    let silenced = silenced_until.is_some_and(|until| now < until);
    match (silenced, escalated) {
        // An escalation from a NEVER-notified state inside a silence window is
        // still the first delivery at this severity; treat it as escalation.
        (true, true) => DeliveryDecision::DeliverEscalation,
        (true, false) => DeliveryDecision::SuppressedBySilence,
        (false, true) => DeliveryDecision::DeliverEscalation,
        (false, false) => DeliveryDecision::Deliver,
    }
}

/// Rows fetched for the notification payload in hybrid mode (§4.4c).
///
/// Nothing downstream can practically use more: row templates iterate every
/// row into the notification body, template-var maps fold every row, and
/// destinations truncate oversized payloads anyway.
pub const PAYLOAD_SAMPLE_ROWS: i64 = 100;

/// How a count-based alert's evaluation should be executed (§4.4c).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvaluationStrategy {
    /// One query sized by the operator-aware sentinel; the row count is the
    /// decision. `actual_value` is a lower bound once the cap is hit.
    SingleQuery { size: i64 },
    /// `COUNT(*)` decides (exact); the payload is sampled separately, and only
    /// when a level actually matched.
    CountPlusSample { payload_size: i64 },
}

/// Pick the execution strategy for a count-based alert.
///
/// Hybrid kicks in when proving the comparison would need more rows than
/// `cutoff` (clamped up to the sentinel floor of 100, so a tiny cutoff cannot
/// force hybrid where the floor fetch is already minimal).
///
/// Callers must apply the §4.4c guards BEFORE consulting this: aggregation,
/// VRL functions, multi-window queries and the threshold bypass never use
/// hybrid.
pub fn evaluation_strategy(tc: &TriggerCondition, cutoff: i64) -> EvaluationStrategy {
    let size = required_search_size(tc);
    if size <= cutoff.max(100) {
        EvaluationStrategy::SingleQuery { size }
    } else {
        EvaluationStrategy::CountPlusSample {
            payload_size: PAYLOAD_SAMPLE_ROWS,
        }
    }
}

/// Wrap a user query so the database counts instead of returning rows.
///
/// The user's SQL is embedded verbatim — the count must agree exactly with
/// what the original query would have returned.
///
/// DELIBERATELY not `track_total_hits`. The search layer has an AST rewriter
/// (`TrackTotalHitsVisitor`, `search/src/sql/rewriter/track_total_hits.rs`)
/// that replaces a query's projection with `count(*) AS zo_sql_num` — but for
/// a `GROUP BY` query it yields PER-GROUP counts, where "Alert if No. of
/// events" means ROWS RETURNED (i.e. the number of groups). Wrapping as a
/// subquery counts rows-returned for every query shape, which is the alert
/// semantic. Do not "simplify" this into the rewriter.
pub fn count_query_sql(sql: &str) -> String {
    // A saved query may end in `;` (plus stray whitespace) — legal standalone,
    // invalid inside `FROM (...)`. Strip terminal semicolons only; interior
    // ones (string literals) are part of the query.
    let sql = sql.trim().trim_end_matches(';').trim_end();
    format!("SELECT COUNT(*) AS zo_alert_count FROM ({sql}) AS zo_alert_subquery")
}

/// The "worst" observed value for history/notification context (T-9): the one
/// furthest in the direction the operator FIRES. For `>`/`>=` that is the
/// maximum; for `<`/`<=` it is the MINIMUM — reporting the max there would put
/// a mild (or unrelated) value beside a Critical level. `=`/`!=` have no
/// severity direction; max is an arbitrary but stable choice.
pub fn worst_observed_value(values: &[f64], op: Operator) -> Option<f64> {
    let iter = values.iter().cloned();
    match op {
        Operator::LessThan | Operator::LessThanEquals => {
            iter.min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        }
        _ => iter.max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)),
    }
}

/// Validate a critical/warning pair against the operator (§4.5).
///
/// "Less severe" is direction-dependent — a plain `warning < critical` check is
/// wrong for `<`/`<=`.
pub fn validate_thresholds(
    op: Operator,
    critical: i64,
    warning: Option<i64>,
) -> Result<(), ThresholdError> {
    validate_thresholds_f64(op, critical as f64, warning.map(|w| w as f64))
}

/// f64 form of [`validate_thresholds`], for threshold families whose values are
/// not integers (aggregation `having.value`, PromQL condition values).
pub fn validate_thresholds_f64(
    op: Operator,
    critical: f64,
    warning: Option<f64>,
) -> Result<(), ThresholdError> {
    let Some(warning) = warning else {
        // Single-level alerts stay valid for every operator (G5).
        return Ok(());
    };
    match direction(op) {
        Direction::Greater if warning < critical => Ok(()),
        Direction::Less if warning > critical => Ok(()),
        Direction::Unordered => Err(ThresholdError::OperatorNotOrderable(op)),
        // Includes the equal case: an equal warning is unreachable, since
        // critical is evaluated first.
        _ => Err(ThresholdError::WarningNotLessSevere),
    }
}

/// Rows a search must fetch to *prove* the comparison for one threshold.
///
/// Fetching exactly N rows cannot distinguish `count == N` from `count > N`,
/// so strict-above and equality comparisons need one extra row.
fn sentinel(op: Operator, threshold: i64) -> i64 {
    match op {
        // `> N`, `= N`, `!= N`, `<= N` all hinge on telling N from more-than-N.
        Operator::GreaterThan
        | Operator::EqualTo
        | Operator::NotEqualTo
        | Operator::LessThanEquals => threshold.saturating_add(1),
        // `>= N` is proven by N rows; `< N` is disproven by N rows.
        Operator::GreaterThanEquals | Operator::LessThan => threshold,
        _ => 0,
    }
}

/// Search size needed to classify an evaluation across both levels (T-7).
///
/// Guarantees correct *classification* only: once the cap is hit, the row count
/// is a lower bound, so the `actual_value` recorded for T-9 is also a lower
/// bound (`alerts_2.md` §7.5).
pub fn required_search_size(tc: &TriggerCondition) -> i64 {
    let mut size = sentinel(tc.operator, tc.threshold);
    if let Some(w) = tc.warning_threshold {
        size = size.max(sentinel(tc.operator, w));
    }
    // Preserve the pre-existing floor.
    size.max(100)
}

#[cfg(test)]
mod tests {
    use crate::meta::alerts::{
        Operator, TriggerCondition,
        level::{
            AlertLevel, ThresholdError, evaluate_level, level_for_successful_evaluation,
            required_search_size, validate_thresholds,
        },
    };

    /// Convenience: a condition with just the threshold knobs set.
    fn tc(op: Operator, critical: i64, warning: Option<i64>) -> TriggerCondition {
        TriggerCondition {
            operator: op,
            threshold: critical,
            warning_threshold: warning,
            ..Default::default()
        }
    }

    // ── AlertLevel: storage identity ────────────────────────────────────────
    // These integers land in `alert_states.level` and
    // `alert_state_transitions.from_level/to_level`, so they are DURABLE.
    // Pin the literals: a roundtrip-only test still passes if variants are
    // reordered, at which point every stored row silently changes meaning.

    #[test]
    fn test_alert_level_i32_values_are_pinned() {
        assert_eq!(AlertLevel::Ok.to_i32(), 0);
        assert_eq!(AlertLevel::Warning.to_i32(), 1);
        assert_eq!(AlertLevel::Critical.to_i32(), 2);
        assert_eq!(AlertLevel::NoData.to_i32(), 3);

        assert_eq!(AlertLevel::from_i32(0), Some(AlertLevel::Ok));
        assert_eq!(AlertLevel::from_i32(1), Some(AlertLevel::Warning));
        assert_eq!(AlertLevel::from_i32(2), Some(AlertLevel::Critical));
        assert_eq!(AlertLevel::from_i32(3), Some(AlertLevel::NoData));
    }

    #[test]
    fn test_alert_level_from_i32_rejects_unknown() {
        assert_eq!(AlertLevel::from_i32(-1), None);
        assert_eq!(AlertLevel::from_i32(99), None);
    }

    #[test]
    fn test_alert_level_serialization() {
        assert_eq!(serde_json::to_string(&AlertLevel::Ok).unwrap(), "\"ok\"");
        assert_eq!(
            serde_json::to_string(&AlertLevel::Warning).unwrap(),
            "\"warning\""
        );
        assert_eq!(
            serde_json::to_string(&AlertLevel::Critical).unwrap(),
            "\"critical\""
        );
        assert_eq!(
            serde_json::to_string(&AlertLevel::NoData).unwrap(),
            "\"no_data\""
        );
    }

    // ── AlertLevel: severity ordering ───────────────────────────────────────
    // Storage id and severity rank are SEPARATE concepts. NoData stores as 3
    // but is less severe than Warning — "we don't know" is not worse than
    // "we know it is bad". Needed by M-2 (rollup = most severe group).

    #[test]
    fn test_severity_rank_is_distinct_from_storage_id() {
        assert_eq!(AlertLevel::Ok.severity_rank(), 0);
        assert_eq!(AlertLevel::NoData.severity_rank(), 1);
        assert_eq!(AlertLevel::Warning.severity_rank(), 2);
        assert_eq!(AlertLevel::Critical.severity_rank(), 3);

        // NoData stores as 3 but ranks below Warning — the two must not be
        // conflated.
        assert_eq!(AlertLevel::NoData.to_i32(), 3);
        assert!(AlertLevel::NoData.severity_rank() < AlertLevel::Warning.severity_rank());
    }

    #[test]
    fn test_most_severe_picks_highest_rank() {
        assert_eq!(
            AlertLevel::most_severe([AlertLevel::Ok, AlertLevel::Warning, AlertLevel::Critical]),
            Some(AlertLevel::Critical)
        );
        assert_eq!(
            AlertLevel::most_severe([AlertLevel::Ok, AlertLevel::NoData]),
            Some(AlertLevel::NoData)
        );
        assert_eq!(
            AlertLevel::most_severe([AlertLevel::Ok]),
            Some(AlertLevel::Ok)
        );
        assert_eq!(AlertLevel::most_severe([]), None);
    }

    #[test]
    fn test_is_firing_level() {
        // Warning and Critical are both "firing" levels for notification
        // purposes; Ok is not.
        assert!(AlertLevel::Critical.is_firing());
        assert!(AlertLevel::Warning.is_firing());
        assert!(!AlertLevel::Ok.is_firing());
        // NoData notifies only under an explicit policy (§7.3) — not a firing
        // level by itself.
        assert!(!AlertLevel::NoData.is_firing());
    }

    // ── T-3: evaluation precedence ──────────────────────────────────────────

    #[test]
    fn test_critical_takes_precedence_over_warning() {
        // crit > 100, warn > 50; actual 150 satisfies BOTH — critical wins.
        let c = tc(Operator::GreaterThan, 100, Some(50));
        assert_eq!(evaluate_level(150.0, &c), Some(AlertLevel::Critical));
    }

    #[test]
    fn test_warning_matches_when_critical_does_not() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        assert_eq!(evaluate_level(75.0, &c), Some(AlertLevel::Warning));
    }

    #[test]
    fn test_no_level_when_neither_matches() {
        let c = tc(Operator::GreaterThan, 100, Some(50));
        assert_eq!(evaluate_level(10.0, &c), None);
    }

    #[test]
    fn test_boundary_values_respect_operator_strictness() {
        let gt = tc(Operator::GreaterThan, 100, Some(50));
        assert_eq!(evaluate_level(100.0, &gt), Some(AlertLevel::Warning)); // not > 100
        assert_eq!(evaluate_level(50.0, &gt), None); // not > 50

        let gte = tc(Operator::GreaterThanEquals, 100, Some(50));
        assert_eq!(evaluate_level(100.0, &gte), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(50.0, &gte), Some(AlertLevel::Warning));
    }

    // ── T-1 / G5: single-level alerts behave exactly as today ───────────────

    #[test]
    fn test_absent_warning_threshold_is_single_level() {
        let c = tc(Operator::GreaterThanEquals, 100, None);
        assert_eq!(evaluate_level(150.0, &c), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(100.0, &c), Some(AlertLevel::Critical));
        // Below critical there is simply no match — never a phantom Warning.
        assert_eq!(evaluate_level(99.0, &c), None);
    }

    // ── T-2: every numeric operator, both levels ────────────────────────────

    #[test]
    fn test_all_numeric_operators_with_two_levels() {
        // (operator, critical, warning, actual, expected)
        let cases: &[(Operator, i64, i64, f64, Option<AlertLevel>)] = &[
            (
                Operator::GreaterThan,
                100,
                50,
                150.0,
                Some(AlertLevel::Critical),
            ),
            (
                Operator::GreaterThan,
                100,
                50,
                60.0,
                Some(AlertLevel::Warning),
            ),
            (
                Operator::GreaterThanEquals,
                100,
                50,
                100.0,
                Some(AlertLevel::Critical),
            ),
            (
                Operator::GreaterThanEquals,
                100,
                50,
                50.0,
                Some(AlertLevel::Warning),
            ),
            // For < / <=, "more severe" means SMALLER, so critical < warning.
            (Operator::LessThan, 10, 25, 5.0, Some(AlertLevel::Critical)),
            (Operator::LessThan, 10, 25, 20.0, Some(AlertLevel::Warning)),
            (Operator::LessThan, 10, 25, 30.0, None),
            (
                Operator::LessThanEquals,
                10,
                25,
                10.0,
                Some(AlertLevel::Critical),
            ),
            (
                Operator::LessThanEquals,
                10,
                25,
                25.0,
                Some(AlertLevel::Warning),
            ),
        ];
        for (op, crit, warn, actual, expected) in cases {
            let c = tc(*op, *crit, Some(*warn));
            assert_eq!(
                evaluate_level(*actual, &c),
                *expected,
                "op={op:?} crit={crit} warn={warn} actual={actual}"
            );
        }
    }

    #[test]
    fn test_equality_operators_still_work_single_level() {
        // `=` / `!=` cannot carry a warning level (see validation), but must
        // keep working as single-level conditions.
        let eq = tc(Operator::EqualTo, 5, None);
        assert_eq!(evaluate_level(5.0, &eq), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(6.0, &eq), None);

        let ne = tc(Operator::NotEqualTo, 5, None);
        assert_eq!(evaluate_level(6.0, &ne), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(5.0, &ne), None);
    }

    #[test]
    fn test_float_actual_values_for_aggregation_alerts() {
        // Aggregation `having` thresholds are floats; count-based alerts widen
        // losslessly. One helper must serve both paths (§4.4).
        let c = tc(Operator::GreaterThan, 100, Some(50));
        assert_eq!(evaluate_level(100.5, &c), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(50.5, &c), Some(AlertLevel::Warning));
        assert_eq!(evaluate_level(49.9, &c), None);
    }

    // ── "no match" is Ok, not "unknown" ─────────────────────────────────────

    /// Regression: live verification found the state row storing NULL level on
    /// a healthy evaluation while the trigger record stored Ok, because
    /// `evaluate_level`'s `None` ("no threshold matched") was passed straight
    /// through to `apply_outcome`, whose `None` means "nothing was computed".
    #[test]
    fn test_successful_evaluation_with_no_match_is_ok_not_unknown() {
        let c = tc(Operator::GreaterThanEquals, 5, Some(2));
        assert_eq!(
            evaluate_level(1.0, &c),
            None,
            "the matcher reports no match"
        );
        assert_eq!(
            level_for_successful_evaluation(evaluate_level(1.0, &c)),
            AlertLevel::Ok,
            "but a completed evaluation that matched nothing is Ok"
        );
    }

    #[test]
    fn test_successful_evaluation_preserves_a_real_match() {
        let c = tc(Operator::GreaterThanEquals, 5, Some(2));
        assert_eq!(
            level_for_successful_evaluation(evaluate_level(3.0, &c)),
            AlertLevel::Warning
        );
        assert_eq!(
            level_for_successful_evaluation(evaluate_level(9.0, &c)),
            AlertLevel::Critical
        );
    }

    // ── T-6 / §4.5: validation matrix ───────────────────────────────────────

    #[test]
    fn test_validation_accepts_correct_direction_for_greater_operators() {
        assert!(validate_thresholds(Operator::GreaterThan, 100, Some(50)).is_ok());
        assert!(validate_thresholds(Operator::GreaterThanEquals, 100, Some(50)).is_ok());
    }

    #[test]
    fn test_validation_rejects_wrong_direction_for_greater_operators() {
        // warning ABOVE critical with `>` would make warning unreachable.
        let err = validate_thresholds(Operator::GreaterThan, 50, Some(100)).unwrap_err();
        assert_eq!(err, ThresholdError::WarningNotLessSevere);
    }

    #[test]
    fn test_validation_accepts_correct_direction_for_less_operators() {
        assert!(validate_thresholds(Operator::LessThan, 10, Some(25)).is_ok());
        assert!(validate_thresholds(Operator::LessThanEquals, 10, Some(25)).is_ok());
    }

    #[test]
    fn test_validation_rejects_wrong_direction_for_less_operators() {
        // With `<`, critical must be the SMALLER number.
        let err = validate_thresholds(Operator::LessThan, 25, Some(10)).unwrap_err();
        assert_eq!(err, ThresholdError::WarningNotLessSevere);
    }

    #[test]
    fn test_validation_rejects_equal_thresholds() {
        // Identical thresholds make the warning level unreachable.
        let err = validate_thresholds(Operator::GreaterThan, 100, Some(100)).unwrap_err();
        assert_eq!(err, ThresholdError::WarningNotLessSevere);
    }

    #[test]
    fn test_validation_rejects_warning_on_unordered_operators() {
        for op in [Operator::EqualTo, Operator::NotEqualTo] {
            let err = validate_thresholds(op, 100, Some(50)).unwrap_err();
            assert_eq!(
                err,
                ThresholdError::OperatorNotOrderable(op),
                "operator {op:?} has no ordering and must reject a warning level"
            );
        }
    }

    #[test]
    fn test_validation_rejects_warning_on_non_numeric_operators() {
        for op in [Operator::Contains, Operator::NotContains] {
            let err = validate_thresholds(op, 100, Some(50)).unwrap_err();
            assert_eq!(err, ThresholdError::OperatorNotOrderable(op));
        }
    }

    #[test]
    fn test_validation_always_accepts_absent_warning() {
        // Every operator remains valid as a single-level alert — G5.
        for op in [
            Operator::EqualTo,
            Operator::NotEqualTo,
            Operator::GreaterThan,
            Operator::GreaterThanEquals,
            Operator::LessThan,
            Operator::LessThanEquals,
            Operator::Contains,
            Operator::NotContains,
        ] {
            assert!(
                validate_thresholds(op, 100, None).is_ok(),
                "operator {op:?} must stay valid without a warning threshold"
            );
        }
    }

    // ── §7.1 delivery semantics ─────────────────────────────────────────────

    use crate::meta::alerts::level::{DeliveryDecision, delivery_decision};

    const NOW: i64 = 1_000;
    const SILENT_UNTIL: i64 = 2_000; // still in the window at NOW

    #[test]
    fn test_ok_level_never_delivers() {
        assert_eq!(
            delivery_decision(AlertLevel::Ok, None, None, NOW, None),
            DeliveryDecision::NotFiring
        );
    }

    #[test]
    fn test_first_firing_delivers() {
        let d = delivery_decision(AlertLevel::Critical, None, None, NOW, None);
        assert!(d.should_deliver());
    }

    /// The core §7.1 rule: escalation overrides an active silence window.
    /// Without it, an alert that goes Warning then Critical while silenced
    /// would page nobody about the critical.
    #[test]
    fn test_escalation_overrides_silence() {
        let d = delivery_decision(
            AlertLevel::Critical,
            Some(AlertLevel::Warning),
            Some(SILENT_UNTIL),
            NOW,
            None,
        );
        assert_eq!(d, DeliveryDecision::DeliverEscalation);
        assert!(d.should_deliver());
        assert!(d.resets_silence(), "escalation restarts the window");
    }

    #[test]
    fn test_same_level_during_silence_is_suppressed() {
        let d = delivery_decision(
            AlertLevel::Critical,
            Some(AlertLevel::Critical),
            Some(SILENT_UNTIL),
            NOW,
            None,
        );
        assert_eq!(d, DeliveryDecision::SuppressedBySilence);
        assert!(!d.should_deliver());
    }

    /// De-escalation must NOT re-notify inside the window — otherwise a
    /// flapping alert pages on every downward step.
    #[test]
    fn test_de_escalation_during_silence_is_suppressed() {
        let d = delivery_decision(
            AlertLevel::Warning,
            Some(AlertLevel::Critical),
            Some(SILENT_UNTIL),
            NOW,
            None,
        );
        assert_eq!(d, DeliveryDecision::SuppressedBySilence);
    }

    #[test]
    fn test_delivery_resumes_after_the_window_expires() {
        let expired = NOW - 1;
        let d = delivery_decision(
            AlertLevel::Critical,
            Some(AlertLevel::Critical),
            Some(expired),
            NOW,
            None,
        );
        assert_eq!(d, DeliveryDecision::Deliver);
    }

    /// Escalation is measured against the last DELIVERED level, so a flap down
    /// and back up to an already-notified severity does not re-page.
    #[test]
    fn test_flap_back_to_already_notified_level_does_not_re_notify() {
        let d = delivery_decision(
            AlertLevel::Critical,
            Some(AlertLevel::Critical),
            Some(SILENT_UNTIL),
            NOW,
            None,
        );
        assert!(!d.should_deliver());
    }

    // ── D11: notify_on_warning ──────────────────────────────────────────────

    #[test]
    fn test_warning_notifies_by_default() {
        assert!(
            delivery_decision(AlertLevel::Warning, None, None, NOW, None).should_deliver(),
            "an unset policy must notify: opting out is explicit, never implied"
        );
    }

    #[test]
    fn test_notify_on_warning_false_suppresses_only_warning() {
        assert_eq!(
            delivery_decision(AlertLevel::Warning, None, None, NOW, Some(false)),
            DeliveryDecision::SuppressedByWarningPolicy
        );
        // Critical is unaffected — "page me only on critical".
        assert!(
            delivery_decision(AlertLevel::Critical, None, None, NOW, Some(false)).should_deliver()
        );
    }

    #[test]
    fn test_warning_policy_beats_silence_check() {
        // With the policy off, a warning is suppressed regardless of window.
        assert_eq!(
            delivery_decision(
                AlertLevel::Warning,
                None,
                Some(SILENT_UNTIL),
                NOW,
                Some(false)
            ),
            DeliveryDecision::SuppressedByWarningPolicy
        );
    }

    /// The i64 and f64 validators must be one implementation — PromQL and
    /// aggregation thresholds are fractional, count thresholds are not, and a
    /// divergence would let an invalid pair through on one path only.
    #[test]
    fn test_i64_and_f64_validators_agree() {
        use crate::meta::alerts::level::validate_thresholds_f64;
        for op in [
            Operator::GreaterThan,
            Operator::GreaterThanEquals,
            Operator::LessThan,
            Operator::LessThanEquals,
            Operator::EqualTo,
            Operator::NotEqualTo,
        ] {
            for (c, w) in [(100i64, 50i64), (50, 100), (100, 100), (10, 25), (25, 10)] {
                assert_eq!(
                    validate_thresholds(op, c, Some(w)),
                    validate_thresholds_f64(op, c as f64, Some(w as f64)),
                    "divergence for {op:?} crit={c} warn={w}"
                );
            }
        }
    }

    /// Fractional pairs are the reason the f64 form exists.
    #[test]
    fn test_f64_validator_handles_fractional_thresholds() {
        use crate::meta::alerts::level::validate_thresholds_f64;
        assert!(validate_thresholds_f64(Operator::GreaterThan, 99.5, Some(50.25)).is_ok());
        assert_eq!(
            validate_thresholds_f64(Operator::GreaterThan, 50.25, Some(99.5)).unwrap_err(),
            ThresholdError::WarningNotLessSevere
        );
    }

    // ── T-7: query sizing — operator-aware sentinels ────────────────────────
    // Fetching exactly N rows cannot distinguish "count == N" from
    // "count > N" on a capped search. Per operator, proving the comparison
    // needs:
    //     > N, = N, != N, <= N   →  N + 1 rows
    //     >= N, < N              →  N
    // With two levels, take the max over both levels' requirements.
    //
    // NOTE this only guarantees CLASSIFICATION. `records.len()` from a capped
    // search is min(true_count, size), so T-9's recorded `actual_value` for
    // count alerts is a lower bound once the cap is hit — documented in
    // alerts_2.md §7.5.

    #[test]
    fn test_search_size_floor_is_preserved() {
        let c = tc(Operator::GreaterThan, 10, None);
        assert_eq!(
            required_search_size(&c),
            100,
            "existing floor of 100 stands"
        );
    }

    #[test]
    fn test_search_size_needs_n_plus_one_for_strict_greater() {
        // With size=500 and 500 rows returned, count could be exactly 500
        // (condition `> 500` FALSE) or more (TRUE). One extra row decides.
        let c = tc(Operator::GreaterThan, 500, Some(100));
        assert_eq!(required_search_size(&c), 501);
    }

    #[test]
    fn test_search_size_needs_exactly_n_for_greater_equals() {
        let c = tc(Operator::GreaterThanEquals, 500, Some(100));
        assert_eq!(required_search_size(&c), 500, ">= N is proven by N rows");
    }

    #[test]
    fn test_search_size_covers_the_warning_band_for_less_than_operators() {
        // For `<`/`<=` the WARNING threshold is the larger number (validation
        // enforces crit < warn), so sizing off `threshold` alone fetches
        // max(100, 10) rows; an actual count of 300 then reads as capped and
        // `< 250` misclassifies. `< N` needs N: getting N back proves
        // count >= N, i.e. the condition is false.
        let c = tc(Operator::LessThan, 10, Some(250));
        assert_eq!(required_search_size(&c), 250);
    }

    #[test]
    fn test_search_size_needs_n_plus_one_for_less_equals() {
        // `<= N`: N rows back cannot distinguish exactly-N (true) from more
        // (false); N+1 decides.
        let c = tc(Operator::LessThanEquals, 10, Some(250));
        assert_eq!(required_search_size(&c), 251);
    }

    #[test]
    fn test_search_size_needs_n_plus_one_for_equality_operators() {
        // `= N` and `!= N` both hinge on distinguishing N from >N.
        assert_eq!(required_search_size(&tc(Operator::EqualTo, 500, None)), 501);
        assert_eq!(
            required_search_size(&tc(Operator::NotEqualTo, 500, None)),
            501
        );
    }

    // ── §4.4c: hybrid count evaluation strategy ─────────────────────────────
    // Large thresholds must not fetch `sentinel` rows just to count them; the
    // decision moves to COUNT(*) and the payload is sampled separately.

    use crate::meta::alerts::level::{
        EvaluationStrategy, PAYLOAD_SAMPLE_ROWS, count_query_sql, evaluation_strategy,
        worst_observed_value,
    };

    #[test]
    fn test_small_thresholds_stay_single_query() {
        // Sentinel within the floor -> exactly today's behaviour.
        let c = tc(Operator::GreaterThanEquals, 5, None);
        assert_eq!(
            evaluation_strategy(&c, 100),
            EvaluationStrategy::SingleQuery { size: 100 },
            "floor of 100 preserved"
        );
        // Boundary: >= 100 needs exactly 100 rows — still single query.
        let c = tc(Operator::GreaterThanEquals, 100, None);
        assert_eq!(
            evaluation_strategy(&c, 100),
            EvaluationStrategy::SingleQuery { size: 100 }
        );
    }

    #[test]
    fn test_sentinel_over_cutoff_goes_hybrid() {
        // `> 100` needs 101 rows — one past the cutoff.
        let c = tc(Operator::GreaterThan, 100, None);
        assert_eq!(
            evaluation_strategy(&c, 100),
            EvaluationStrategy::CountPlusSample {
                payload_size: PAYLOAD_SAMPLE_ROWS
            }
        );
        // The motivating case.
        let c = tc(Operator::GreaterThanEquals, 1_000_000, None);
        assert_eq!(
            evaluation_strategy(&c, 100),
            EvaluationStrategy::CountPlusSample {
                payload_size: PAYLOAD_SAMPLE_ROWS
            }
        );
    }

    #[test]
    fn test_warning_threshold_can_push_into_hybrid() {
        // Critical alone fits the floor; the warning band does not. For `<=`,
        // warning is the LARGER number and needs N+1.
        let c = tc(Operator::LessThanEquals, 10, Some(250));
        assert_eq!(
            evaluation_strategy(&c, 100),
            EvaluationStrategy::CountPlusSample {
                payload_size: PAYLOAD_SAMPLE_ROWS
            }
        );
    }

    #[test]
    fn test_equality_operators_go_hybrid_above_cutoff() {
        // `= N` / `!= N` are where exactness genuinely changes correctness:
        // a capped fetch cannot distinguish N from N+k.
        for op in [Operator::EqualTo, Operator::NotEqualTo] {
            let c = tc(op, 10_000, None);
            assert_eq!(
                evaluation_strategy(&c, 100),
                EvaluationStrategy::CountPlusSample {
                    payload_size: PAYLOAD_SAMPLE_ROWS
                },
                "{op:?}"
            );
        }
    }

    #[test]
    fn test_raising_the_cutoff_keeps_single_query() {
        // Operators can prefer the old behaviour via config.
        let c = tc(Operator::GreaterThanEquals, 5_000, None);
        assert_eq!(
            evaluation_strategy(&c, 10_000),
            EvaluationStrategy::SingleQuery { size: 5_000 }
        );
    }

    #[test]
    fn test_cutoff_below_floor_is_clamped() {
        // A cutoff of 0/50 must not force hybrid for tiny thresholds — the
        // floor fetch is already minimal.
        let c = tc(Operator::GreaterThanEquals, 5, None);
        assert_eq!(
            evaluation_strategy(&c, 0),
            EvaluationStrategy::SingleQuery { size: 100 }
        );
    }

    #[test]
    fn test_count_query_wraps_the_user_sql_verbatim() {
        let sql = "SELECT * FROM stream WHERE status >= 500";
        assert_eq!(
            count_query_sql(sql),
            "SELECT COUNT(*) AS zo_alert_count FROM (SELECT * FROM stream WHERE status >= 500) AS zo_alert_subquery"
        );
    }

    /// A saved query may legally end in `;` (and stray whitespace). Embedded
    /// verbatim that becomes `FROM (SELECT ...;)` — invalid as a subquery — so
    /// only alerts that cross the hybrid cutoff would start failing.
    #[test]
    fn test_count_query_strips_trailing_semicolons_and_whitespace() {
        for sql in [
            "SELECT * FROM stream WHERE status >= 500;",
            "SELECT * FROM stream WHERE status >= 500 ;\n",
            "  SELECT * FROM stream WHERE status >= 500;;  ",
        ] {
            assert_eq!(
                count_query_sql(sql),
                "SELECT COUNT(*) AS zo_alert_count FROM (SELECT * FROM stream WHERE status >= 500) AS zo_alert_subquery"
            );
        }
        // A semicolon INSIDE the query (string literal) must survive.
        assert_eq!(
            count_query_sql("SELECT * FROM s WHERE msg = 'a;b';"),
            "SELECT COUNT(*) AS zo_alert_count FROM (SELECT * FROM s WHERE msg = 'a;b') AS zo_alert_subquery"
        );
    }

    /// For `<`/`<=` the worst offender is the minimum — history must show the
    /// value that best justifies the recorded level, not the largest number.
    #[test]
    fn test_worst_observed_value_is_operator_aware() {
        let values = [85.0, 40.0, 96.0];
        assert_eq!(
            worst_observed_value(&values, Operator::GreaterThan),
            Some(96.0)
        );
        assert_eq!(
            worst_observed_value(&values, Operator::GreaterThanEquals),
            Some(96.0)
        );
        assert_eq!(
            worst_observed_value(&values, Operator::LessThan),
            Some(40.0)
        );
        assert_eq!(
            worst_observed_value(&values, Operator::LessThanEquals),
            Some(40.0)
        );
        // No direction for equality: stable max.
        assert_eq!(worst_observed_value(&values, Operator::EqualTo), Some(96.0));
        assert_eq!(worst_observed_value(&[], Operator::LessThan), None);
    }

    /// Exactness is the point: with a true count available, `= N` classifies
    /// correctly at magnitudes no row fetch would reach.
    #[test]
    fn test_exact_count_classification_beyond_any_fetch_cap() {
        let c = tc(Operator::EqualTo, 1_000_000, None);
        assert_eq!(evaluate_level(1_000_000.0, &c), Some(AlertLevel::Critical));
        assert_eq!(evaluate_level(1_000_001.0, &c), None);
    }

    // NOTE: the level/outcome independence guarantee is exercised properly in
    // `state_level.rs` (level_since vs since moving apart). An assertion here
    // that merely checked `level.is_firing() && outcome.is_firing()` was
    // tautological — it passed even if the two were the same type — so it was
    // removed rather than left as false coverage.
}
