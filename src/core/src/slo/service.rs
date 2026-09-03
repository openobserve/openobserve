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

//! SLO lifecycle — the operations behind the HTTP layer (`alerts_2.md` §6b).
//!
//! Save is the interesting one, because four things have to happen together
//! and the order matters:
//!
//! 1. **validate** the definition (§6b.7) — a bad SLI must never reach the budget;
//! 2. **charge** the org's row budget, which is where a create is actually rejected (S-14);
//! 3. **persist**, bumping the generation if the definition changed (D59);
//! 4. **schedule** the ingest job and, for a fresh generation, the backfill.
//!
//! Charging before persisting is deliberate. The reverse — save, then charge,
//! then roll back on rejection — leaves a window where the SLO exists
//! uncharged, and concurrent creates in that window each see headroom the
//! other has already taken.

use std::str::FromStr as _;

use config::{
    get_config,
    meta::{
        alerts::alert::Alert,
        folder::{DEFAULT_FOLDER, FolderType},
        slo::{
            SLICE_300_SECS, Slo, SloValidationError,
            alert_uptime::{EvalInterval, UptimeGrid, uptime_slices},
            budget_rows::{groups_reserved, rows_for_reservation},
            source_alert_ineligibility, validate_query_safety, validate_slo,
        },
    },
    utils::time::now_micros,
};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        folders, slo_backfill_jobs as backfill_jobs, slo_budget, slos as slos_table,
        slos::GenerationEffect,
    },
};
use serde::Serialize;
use svix_ksuid::Ksuid;

/// Why a save was rejected.
#[derive(Debug)]
pub enum SloError {
    Validation(String),
    Budget(String),
    NotFound,
    /// A name already taken in this folder. Its own variant so the handler can
    /// answer 409 with a sentence, instead of leaking
    /// `UNIQUE constraint failed: slos.org, slos.folder_id, slos.name` from a
    /// 500 — which is what it did before end-to-end testing.
    DuplicateName(String),
    /// The destination folder does not exist. Its own variant so the handler
    /// can answer 404 instead of persisting an SLO into a folder nothing will
    /// ever list — `slos.folder_id` carries no foreign key, so an unchecked
    /// id is accepted by the database and then invisible in the UI.
    FolderNotFound(String),
    /// A move collided with a same-named SLO already in the destination. The
    /// unique index fails the whole statement without naming the loser, so
    /// this carries no name — and nothing moved.
    MoveNameConflict,
    /// One of the generated alerts is still an operand of a composite. The
    /// cascade is preflighted, so neither the SLO nor any sibling alert moved.
    AlertCascadeConflict(String),
    /// The shared composite graph lock could not be acquired or released.
    TemporarilyUnavailable(String),
    Db(String),
}

impl std::fmt::Display for SloError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(m)
            | Self::Budget(m)
            | Self::AlertCascadeConflict(m)
            | Self::TemporarilyUnavailable(m)
            | Self::Db(m) => write!(f, "{m}"),
            Self::NotFound => write!(f, "SLO not found"),
            Self::DuplicateName(n) => {
                write!(f, "an SLO named \"{n}\" already exists in this folder")
            }
            Self::FolderNotFound(id) => write!(f, "folder \"{id}\" not found"),
            Self::MoveNameConflict => write!(
                f,
                "the destination folder already has an SLO with one of these names; nothing was moved"
            ),
        }
    }
}

impl std::error::Error for SloError {}

impl From<SloValidationError> for SloError {
    fn from(e: SloValidationError) -> Self {
        Self::Validation(e.to_string())
    }
}

impl From<infra::errors::Error> for SloError {
    fn from(e: infra::errors::Error) -> Self {
        Self::Db(e.to_string())
    }
}

/// Recognize the unique-index violation across backends.
///
/// Matched on the message because the three supported stores word it
/// differently and none surfaces a portable error code through sea-orm:
/// SQLite says `UNIQUE constraint failed`, Postgres `duplicate key value
/// violates unique constraint`, MySQL `Duplicate entry`.
fn is_duplicate_name(e: &infra::errors::Error) -> bool {
    let m = e.to_string().to_lowercase();
    (m.contains("unique") || m.contains("duplicate")) && m.contains("slos")
}

/// Validate a definition without saving it — shared by create and update so
/// the two cannot drift.
///
/// Async because an `alert` SLI is validated against **facts about its source
/// alert**, and those have to be read. Validation itself stays pure: the
/// lookup happens here and the rules run in [`validate_with_facts`].
pub async fn validate(slo: &Slo) -> Result<(), SloError> {
    validate_with_facts(slo, load_source_alert_facts(slo).await?)
}

/// The pure half of [`validate`]. `source_alert` is `None` when the SLI is not
/// an alert SLI, or when the source could not be loaded — which is itself a
/// rejection (`AlertSliSourceUnknown`), not a pass.
fn validate_with_facts(
    slo: &Slo,
    source_alert: Option<config::meta::slo::SourceAlertFacts>,
) -> Result<(), SloError> {
    validate_slo(&slo.definition, slo.target, source_alert)?;
    let group_by = slo.definition.group_by.clone().unwrap_or_default();
    validate_query_safety(
        &slo.definition.sli_config,
        &group_by,
        slo.definition.slice_interval_secs,
    )
    .map_err(|e| SloError::Validation(e.to_string()))?;
    validate_promql_parses(&slo.definition.sli_config)?;
    Ok(())
}

/// Parse every PromQL expression the SLI carries, so a typo is refused at save
/// instead of discovered as permanent no-data days later: an expression that
/// does not parse fails on **every** evaluation, so the SLO writes no slices,
/// coverage falls to zero, and every alert on it freezes.
///
/// It cannot live beside the other query-safety rules. `config` has no PromQL
/// parser — which is exactly why its count arm can only check non-emptiness —
/// and `core` already depends on `promql-parser`. So the emptiness rules run
/// there and the parse runs here, one step later, which is also the order the
/// messages should come in: "must be a non-empty expression" is more useful
/// than a parser complaining about empty input.
///
/// **Parse-only, deliberately.** There is no grouping or aggregation check.
/// Requiring the root to be an aggregation whose `by(…)` equals the SLO's
/// `group_by` rejects expressions that are entirely correct: a
/// `histogram_quantile` root, whose inner `by` must also carry `le`, and a
/// binary-op root such as the canonical `increase(a) - increase(b)` count
/// pair. Grouping comes from the labels the returned series carry, and nothing
/// about those is knowable at save.
fn validate_promql_parses(sli_config: &config::meta::slo::SliConfig) -> Result<(), SloError> {
    use config::meta::slo::{CountSource, QueryLanguage, SliConfig};

    // Exhaustive, like the `validate_query_safety` it follows: the gate is the
    // VARIANT, never a guess at what the string looks like — plenty of SQL
    // (`avg(duration_ms)`) is also valid PromQL, and plenty of PromQL is also
    // valid SQL. A wildcard arm would let the next PromQL-bearing shape save
    // unparseable and measure nothing; this way it will not compile.
    match sli_config {
        SliConfig::Count { source } => match source {
            CountSource::PromQl { good, total } => {
                parse_promql("good", good)?;
                parse_promql("total", total)
            }
            CountSource::SingleQuery { .. } | CountSource::DualQuery { .. } => Ok(()),
        },
        SliConfig::TimeSlice {
            query_language: QueryLanguage::PromQl,
            query,
            ..
        } => parse_promql("query", query),
        SliConfig::TimeSlice {
            query_language: QueryLanguage::Sql,
            ..
        } => Ok(()),
        // Reads existing alert state, not a user query.
        SliConfig::Alert { .. } => Ok(()),
    }
}

/// One expression, named by its field so a count SLI's rejection says which
/// half of the pair is wrong.
fn parse_promql(field: &str, expr: &str) -> Result<(), SloError> {
    promql_parser::parser::parse(expr)
        .map(|_| ())
        .map_err(|e| SloError::Validation(format!("{field} is not a valid PromQL expression: {e}")))
}

/// Read the source alert an `alert` SLI points at, and reduce it to facts.
///
/// `Ok(None)` means "there is no source to describe": the SLI is not an alert
/// SLI, the id does not parse, or no such alert exists. `validate_slo` turns
/// the last two into `AlertSliSourceUnknown`, and distinguishing "no such
/// alert" from "the id is malformed" would only give the API two ways to say
/// the same thing.
///
/// A **database failure is not that**, and must not be laundered into it. A
/// meta-DB blip would otherwise refuse an edit to a long-standing, still-valid
/// alert SLO with "requires facts about its source alert" — inviting the user
/// to fix a pointer that was never broken. It surfaces as `SloError::Db`,
/// matching how every other read in this module reports one.
async fn load_source_alert_facts(
    slo: &Slo,
) -> Result<Option<config::meta::slo::SourceAlertFacts>, SloError> {
    let Some(alert_id) = source_alert_id(slo) else {
        return Ok(None);
    };
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Ok(None);
    };
    match crate::alerts::alert::get_by_id_db(&slo.org, id).await {
        Ok(alert) => Ok(Some(source_alert_facts(&alert))),
        Err(crate::alerts::alert::AlertError::AlertNotFound) => Ok(None),
        Err(e) => Err(SloError::Db(e.to_string())),
    }
}

/// The alert an `alert` SLI measures from, or `None` for every other SLI type.
///
/// The single place the SLI-type gate lives. Every alert-only lifecycle rule —
/// validation's fact lookup, PR 4's backfill floor, the status view's
/// measurement floor — asks here first, so none of them can leak onto a count
/// or time-slice SLO, whose backfill must keep covering its whole window.
fn source_alert_id(slo: &Slo) -> Option<&str> {
    match &slo.definition.sli_config {
        config::meta::slo::SliConfig::Alert { alert_id } => Some(alert_id),
        _ => None,
    }
}

/// Reduce a source alert to the facts §5.1/§5.4 validate against.
///
/// Pure and separate from the read, so the derivations — which are the subtle
/// part — are testable without a database.
fn source_alert_facts(
    alert: &config::meta::alerts::alert::Alert,
) -> config::meta::slo::SourceAlertFacts {
    let trigger = &alert.trigger_condition;
    // §7.1 / MN-10: an alert with ANY warning source keeps evaluating while
    // silenced and suppresses at delivery instead, so only the others go dark.
    // Read through `is_multi_level` rather than `warning_threshold` alone,
    // because that is what the scheduler itself branches on — checking a
    // subset would have validation believe a source stays dense when the
    // runtime puts it on the legacy silence path.
    let evaluates_through_silence = config::meta::alerts::dispatch::evaluates_through_silence(
        alert.query_condition.multi_alert_enabled(),
        config::meta::alerts::level::is_multi_level(alert),
    );

    config::meta::slo::SourceAlertFacts {
        is_scheduled: !alert.is_real_time,
        // Per-group state, not the column list (§2).
        is_grouped: config::meta::alerts::grouping::maintains_group_state(&alert.query_condition),
        // The domain-level form of the indexed `alerts.slo_id` column, which
        // is derived from exactly this field at write time (D60).
        is_slo_alert: alert.query_condition.slo_condition.is_some(),
        // Composite alerts are deferred (Feature 4) and have no representation
        // on `Alert` yet, so nothing can be one. The fact is wired now so the
        // rule ships whole rather than being remembered later.
        is_composite: false,
        frequency_secs: trigger.frequency,
        is_cron: trigger.frequency_type == config::meta::alerts::FrequencyType::Cron,
        is_silence_gated: trigger.silence > 0 && !evaluates_through_silence,
        silence_minutes: trigger.silence,
    }
}

// ---------------------------------------------------------------------------
// source-alert lifecycle (PR 4)
// ---------------------------------------------------------------------------

/// The invariant this alert would break for an SLO slicing at
/// `slice_interval_secs`, or `None` when it would break none.
///
/// The **same rule function** the picker and save-time validation use
/// (`source_alert_ineligibility`), deliberately: an edit guard with its own
/// copy of the rules would drift, and the drift would show up as an alert the
/// form refuses to pick but the API happily edits into an SLO's source.
///
/// Reads the alert as it would be AFTER the save, not the delta. "The edit
/// breaks it" and "the saved alert is ineligible" are the same predicate here,
/// and the post-state form has the property that matters: no sequence of saves
/// can leave a live SLO pointing at an ineligible source.
pub fn source_alert_edit_breakage(
    alert: &Alert,
    slice_interval_secs: i64,
) -> Option<SloValidationError> {
    source_alert_ineligibility(&source_alert_facts(alert), slice_interval_secs)
}

/// Whether an edit changed what "good" means for an SLI reading this alert
/// (D59).
///
/// The SLI is `level == Ok`, so this is precisely "would the same data now
/// produce a different level". `query_condition` decides that wholesale, and so
/// do the severity fields of `trigger_condition`; **cadence and delivery do
/// not** — a frequency, cron, silence, timezone or notify-on-warning edit
/// changes when or whether a human hears about the alert, never whether the
/// alert considered the world good.
///
/// Compares whole structs minus that exclusion list, mirroring
/// `slos::definition_changed`: a field added to `TriggerCondition` later counts
/// as computation-affecting by default, which is the safe direction to be wrong
/// in.
pub fn source_alert_condition_changed(before: &Alert, after: &Alert) -> bool {
    /// Blank the fields that decide WHEN the alert runs and WHO hears about
    /// it, leaving only the ones that decide the verdict.
    fn verdict_only(
        trigger: &config::meta::alerts::TriggerCondition,
    ) -> config::meta::alerts::TriggerCondition {
        config::meta::alerts::TriggerCondition {
            frequency: 0,
            cron: String::new(),
            frequency_type: config::meta::alerts::FrequencyType::default(),
            silence: 0,
            timezone: None,
            notify_on_warning: None,
            ..trigger.clone()
        }
    }

    before.query_condition != after.query_condition
        || verdict_only(&before.trigger_condition) != verdict_only(&after.trigger_condition)
}

/// Every SLO in `org` measuring from this alert.
///
/// `get_or_init` rather than `get`, unlike this module's other reads: this one
/// is on the ALERT write path, which can run before anything has touched an
/// SLO, and refusing a save because the ORM was not warm yet would be a new way
/// for alerts to fail.
pub async fn slos_sourced_from_alert(org: &str, alert_id: &str) -> Result<Vec<Slo>, SloError> {
    let db = infra::db::get_orm_client_ro().await;
    slos_table::list_by_source_alert(db, org, alert_id)
        .await
        .map_err(Into::into)
}

/// D59 for the source alert: its condition moved, so each SLO reading it starts
/// a new epoch — one window must never mix two definitions.
///
/// Best-effort and fire-and-forget, like the alert's own state and ledger
/// teardown: the alert has already been written by the time this runs, and a
/// meta-DB blip here must not turn a saved alert into a 500.
pub async fn redefine_for_source_alert(org: &str, slo_ids: &[String]) {
    // `get_or_init` for the same reason `slos_sourced_from_alert` uses it: this
    // runs on the alert write path, and silently skipping the bump would leave
    // one window mixing two definitions — the one corruption D59 exists to
    // prevent.
    let db = infra::db::get_orm_client_rw().await;
    let now = now_micros() / 1_000_000;
    for id in slo_ids {
        let mut slo = match slos_table::get(db, org, id).await {
            Ok(Some(slo)) => slo,
            Ok(None) => continue,
            Err(e) => {
                log::warn!("[slo] could not read {id} after its source alert changed: {e}");
                continue;
            }
        };
        let (from, to) = match slos_table::bump_generation(db, org, id, now).await {
            Ok(Some(pair)) => pair,
            Ok(None) => continue,
            Err(e) => {
                // Error, not warn: the alert is already written, so this SLO's
                // window now mixes two definitions of "good" — the one
                // corruption eventual consistency does not repair, and nothing
                // downstream re-compares an SLO against its source.
                log::error!(
                    "[slo] {id} is still on generation {} after its source alert's condition \
                     changed, so its window now mixes two definitions: {e}",
                    slo.definition_generation
                );
                continue;
            }
        };
        slo.definition_generation = to;
        let (_, rows) = reservation(&slo);
        after_generation_bump(db, &slo, from, rows, now).await;
        log::info!(
            "[slo] {id} moved to generation {to}: its source alert's condition changed, so one \
             window would otherwise mix two definitions"
        );
    }
}

// ---------------------------------------------------------------------------
// source-alert picker and preview (PR 3)
// ---------------------------------------------------------------------------

/// One candidate source alert, as the SLO form's picker sees it.
///
/// Ineligible alerts are returned rather than filtered out: "your alert is not
/// in the list" is not an explanation, and the reasons — a cron schedule, a
/// silence window — each have a remedy the user can act on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SloEligibleAlert {
    pub alert_id: String,
    pub name: String,
    /// `trigger_condition.frequency`. Present on every row, including
    /// ineligible ones, because the form derives its slice default from it.
    pub frequency_secs: i64,
    pub eligible: bool,
    /// The validator's own message, verbatim — not a second wording of it.
    pub reason: Option<String>,
}

/// Reduce one alert to its picker row, or `None` if it cannot be referenced.
///
/// Judged against [`SLICE_300_SECS`], the coarsest slice there is: the picker
/// asks "could any legal SLO use this source", because no SLO exists yet to
/// supply a narrower grid.
pub fn slo_eligibility(alert: &Alert) -> Option<SloEligibleAlert> {
    // An alert with no id cannot be named by `SliConfig::Alert`, so offering it
    // would only produce an SLO whose source is unknown.
    let alert_id = alert.id?.to_string();
    let facts = source_alert_facts(alert);
    let reason = source_alert_ineligibility(&facts, SLICE_300_SECS);
    Some(SloEligibleAlert {
        alert_id,
        name: alert.name.clone(),
        frequency_secs: facts.frequency_secs,
        eligible: reason.is_none(),
        reason: reason.map(|e| e.to_string()),
    })
}

/// Every alert in the org the caller can see, each judged as an SLI source.
///
/// Visibility goes through the same permitted path listing does. Note what
/// that filter is and is not: it narrows to per-alert grants only when
/// `O2_OPENFGA_LIST_ONLY_PERMITTED` is on, and is a no-op otherwise. The
/// route's own `LIST` check on `alert_folders` — the same one the alerts list
/// carries — is what actually keeps this out of the hands of someone who
/// cannot list alerts at all.
///
/// Ordered eligible-first, then by name: the list exists to be chosen from, and
/// burying the usable rows under the refused ones inverts that.
pub async fn list_slo_eligible_alerts(
    org: &str,
    user_id: Option<&str>,
) -> Result<Vec<SloEligibleAlert>, SloError> {
    let db = get_orm_client_ro().await;
    let params = config::meta::alerts::alert::ListAlertsParams::new(org);
    let alerts = crate::alerts::alert::list_v2(db, user_id, params)
        .await
        .map_err(|e| SloError::Db(e.to_string()))?;

    let mut rows: Vec<SloEligibleAlert> = alerts
        .iter()
        .filter_map(|(_, alert)| slo_eligibility(alert))
        .collect();
    rows.sort_by(|a, b| {
        b.eligible
            .cmp(&a.eligible)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(rows)
}

/// One ledger interval on the wire, which is what the ribbon draws.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AlertSliPreviewInterval {
    /// `None` when the stored level is one this build cannot interpret — which
    /// the ribbon must draw as unmeasured, never as good.
    pub level: Option<String>,
    pub frequency_secs: i64,
    pub from_us: i64,
    pub to_us: i64,
}

/// What an alert SLI would have measured over a window, computed from the
/// ledger before anything is saved.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AlertSliPreview {
    pub alert_id: String,
    /// The range the ribbon is drawn against. Intervals alone cannot place a
    /// band, and a gap at either edge would otherwise be invisible.
    pub range_start_secs: i64,
    pub range_end_secs: i64,
    pub slice_interval_secs: i64,
    pub intervals: Vec<AlertSliPreviewInterval>,
    /// Percentage 0..100 over MEASURED time. `None` when nothing was measured
    /// — deliberately not 0, which would render a brand-new source as total
    /// downtime.
    pub sli: Option<f64>,
    pub good_secs: f64,
    pub total_secs: f64,
    pub observed_slices: i64,
    pub expected_slices: i64,
    /// `observed / expected`, 0..1 — the denominator behind the SLI, which is
    /// the number that decides whether the SLO would freeze.
    pub coverage: f64,
    /// Whether an SLO on this source would be FROZEN right now rather than
    /// reporting the SLI beside it.
    ///
    /// [`Self::sli`] is the honest ratio over measured time, which is what the
    /// form asks for — but below `ZO_SLO_MIN_COVERAGE` the saved SLO reports
    /// no data at all (`SloStatusView::derive`), so "100% over 33% of the
    /// window" is a reading the SLO will refuse to give. The floor is
    /// server-side config the form cannot see, so the comparison has to travel
    /// with the answer (§2, D34).
    pub would_freeze: bool,
}

/// The grid a preview measures over, or `None` for a shape no SLO could store.
///
/// The range ends on the last COMPLETED slice rather than on `now`: a
/// half-elapsed slice reads as a gap and would drag the preview's coverage
/// down for a reason that has nothing to do with the source.
pub fn preview_grid(
    window_secs: i64,
    slice_interval_secs: i64,
    now_secs: i64,
    min_coverage: f64,
) -> Option<UptimeGrid> {
    use config::meta::slo::{
        SLICE_60_SECS, WINDOW_7D_SECS, WINDOW_30D_SECS, WINDOW_90D_SECS, window::align_down,
    };
    if !matches!(
        window_secs,
        WINDOW_7D_SECS | WINDOW_30D_SECS | WINDOW_90D_SECS
    ) || !matches!(slice_interval_secs, SLICE_60_SECS | SLICE_300_SECS)
    {
        return None;
    }
    let range_end_secs = align_down(now_secs, slice_interval_secs);
    Some(UptimeGrid {
        range_start_secs: range_end_secs - window_secs,
        range_end_secs,
        slice_interval_secs,
        min_coverage,
    })
}

/// Fold the ledger into a preview. Pure, and the SAME fold the ingest pass
/// runs — a preview computed a second way is a preview that can disagree with
/// the SLO it is previewing.
pub fn alert_sli_preview_of(
    alert_id: &str,
    intervals: &[EvalInterval],
    grid: UptimeGrid,
) -> AlertSliPreview {
    let slices = uptime_slices(intervals, grid);
    let good_secs: f64 = slices.iter().map(|s| s.good_secs).sum();
    let total_secs: f64 = slices.iter().map(|s| s.total_secs).sum();
    let expected_slices = if grid.slice_interval_secs > 0 {
        (grid.range_end_secs - grid.range_start_secs) / grid.slice_interval_secs
    } else {
        0
    };
    let observed_slices = slices.len() as i64;
    let coverage = if expected_slices > 0 {
        (observed_slices as f64 / expected_slices as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    AlertSliPreview {
        alert_id: alert_id.to_string(),
        range_start_secs: grid.range_start_secs,
        range_end_secs: grid.range_end_secs,
        slice_interval_secs: grid.slice_interval_secs,
        intervals: intervals
            .iter()
            .map(|i| AlertSliPreviewInterval {
                level: i.level.map(level_name),
                frequency_secs: i.frequency_secs,
                from_us: i.from_us,
                to_us: i.to_us,
            })
            .collect(),
        sli: config::meta::slo::math::sli(good_secs, total_secs),
        good_secs,
        total_secs,
        observed_slices,
        expected_slices,
        coverage,
        would_freeze: coverage < grid.min_coverage,
    }
}

/// The wire spelling of a level, matching `AlertLevel`'s own serde renames so
/// the ribbon's colour map has one vocabulary rather than two.
fn level_name(level: config::meta::alerts::level::AlertLevel) -> String {
    use config::meta::alerts::level::AlertLevel;
    match level {
        AlertLevel::Ok => "ok",
        AlertLevel::Warning => "warning",
        AlertLevel::Critical => "critical",
        AlertLevel::NoData => "no_data",
    }
    .to_string()
}

/// Read the ledger for one alert and fold it into a preview.
///
/// The alert is looked up first: a preview for an id that names nothing would
/// otherwise read as a source with no history, which is the one answer that
/// must not be indistinguishable from "paused".
pub async fn alert_sli_preview(
    org: &str,
    alert_id: &str,
    window_secs: i64,
    slice_interval_secs: i64,
) -> Result<AlertSliPreview, SloError> {
    let Ok(id) = Ksuid::from_str(alert_id) else {
        return Err(SloError::NotFound);
    };
    match crate::alerts::alert::get_by_id_db(org, id).await {
        Ok(_) => {}
        Err(crate::alerts::alert::AlertError::AlertNotFound) => return Err(SloError::NotFound),
        Err(e) => return Err(SloError::Db(e.to_string())),
    }

    let cfg = get_config();
    let now_secs = now_micros() / 1_000_000;
    let Some(grid) = preview_grid(
        window_secs,
        slice_interval_secs,
        now_secs,
        cfg.slo.min_coverage,
    ) else {
        return Err(SloError::Validation(format!(
            "cannot preview a {window_secs}s window on {slice_interval_secs}s slices"
        )));
    };

    let rows = infra::table::alert_eval_intervals::list_overlapping(
        alert_id,
        grid.range_start_secs * 1_000_000,
        grid.range_end_secs * 1_000_000,
    )
    .await
    .map_err(|e| SloError::Db(e.to_string()))?;

    let intervals: Vec<EvalInterval> = rows
        .iter()
        .map(|r| EvalInterval {
            level: r.level,
            frequency_secs: r.frequency_secs,
            from_us: r.from_us,
            to_us: r.to_us,
        })
        .collect();
    Ok(alert_sli_preview_of(alert_id, &intervals, grid))
}

/// Ensure an SLO's folder exists before anything is written into it.
///
/// SLOs live in **alert** folders — there is no `FolderType::Slos`, because an
/// SLO is alerting configuration and is authorized as `alerts` (§6b, D28). So
/// this asks the same question `alerts::alert::create` asks, of the same rows.
///
/// A missing `default` is created rather than rejected, matching the alert
/// path: a fresh org has no folder rows at all until something is saved, and
/// the handler defaults `folder_id` to `default` — so rejecting here would
/// make the first SLO in a new org impossible to create.
async fn ensure_folder(org: &str, folder_id: &str) -> Result<(), SloError> {
    if folders::exists(org, folder_id, FolderType::Alerts).await? {
        return Ok(());
    }
    if folder_id == DEFAULT_FOLDER {
        crate::alerts::alert::create_default_alerts_folder(org)
            .await
            .map_err(|e| SloError::Db(e.to_string()))?;
        return Ok(());
    }
    Err(SloError::FolderNotFound(folder_id.to_string()))
}

/// What an SLO reserves against its org's row budget.
pub fn reservation(slo: &Slo) -> (i64, i64) {
    let cfg = get_config();
    let groups = groups_reserved(slo.is_grouped(), slo.groups_estimate, cfg.slo.max_groups);
    let rows = rows_for_reservation(
        groups,
        slo.definition.slice_interval_secs,
        cfg.slo.revision_headroom,
    );
    (groups, rows)
}

pub async fn create(slo: &mut Slo) -> Result<(), SloError> {
    let cfg = get_config();
    let db = get_orm_client_rw().await;

    validate(slo).await?;
    // Before the budget charge: a bad folder should cost nothing, and the
    // charge is the step whose rollback is fiddly.
    ensure_folder(&slo.org, &slo.folder_id).await?;

    let (groups, rows) = reservation(slo);
    slo.groups_reserved = groups;
    slo.definition_generation = 1;

    // Charged BEFORE the row exists. Saving first would leave a window in
    // which the SLO exists uncharged, and concurrent creates in that window
    // each see headroom the other has already taken.
    slo_budget::charge(
        db,
        &slo.org,
        &slo.id,
        slo.definition_generation,
        rows,
        cfg.slo.max_slice_rows_per_org,
    )
    .await
    .map_err(|e| SloError::Budget(e.to_string()))?;

    let now = now_micros() / 1_000_000;
    if let Err(e) = slos_table::create(db, slo, now, slo.owner.as_deref()).await {
        // Release what we just reserved, or a failed save would leak budget
        // that nothing will ever retire.
        let _ = slo_budget::retire(db, &slo.org, &slo.id, slo.definition_generation, now).await;
        if is_duplicate_name(&e) {
            return Err(SloError::DuplicateName(slo.name.clone()));
        }
        return Err(e.into());
    }

    schedule(slo, now).await;
    Ok(())
}

pub async fn update(slo: &mut Slo) -> Result<(), SloError> {
    let db = get_orm_client_rw().await;

    validate(slo).await?;
    // An update carries `folder_id` too, so it is also a move.
    ensure_folder(&slo.org, &slo.folder_id).await?;

    let existing = slos_table::get(db, &slo.org, &slo.id)
        .await?
        .ok_or(SloError::NotFound)?;
    // The caller does not choose the generation; the diff does.
    slo.definition_generation = existing.definition_generation;

    let (groups, rows) = reservation(slo);
    slo.groups_reserved = groups;

    let now = now_micros() / 1_000_000;
    let effect = match slos_table::update(db, slo, now, slo.owner.as_deref()).await {
        Ok(e) => e,
        Err(e) if is_duplicate_name(&e) => {
            return Err(SloError::DuplicateName(slo.name.clone()));
        }
        Err(e) => return Err(e.into()),
    };

    match effect {
        GenerationEffect::Bumped { from, to } => {
            slo.definition_generation = to;
            after_generation_bump(db, slo, from, rows, now).await;
        }
        GenerationEffect::Unchanged(g) => {
            slo.definition_generation = g;
            // A pause/resume still has to reach the scheduler.
            sync_ingest_trigger(slo).await;
        }
    }
    Ok(())
}

/// Everything that has to follow a generation bump, wherever the bump came
/// from: the old epoch's charge becomes a residual, the new epoch is charged,
/// and the new epoch gets its ingest trigger plus a fresh backfill.
///
/// `slo.definition_generation` must already be the NEW generation.
async fn after_generation_bump(
    db: &sea_orm::DatabaseConnection,
    slo: &Slo,
    from: i32,
    rows: i64,
    now: i64,
) {
    let to = slo.definition_generation;
    // The old generation's slices persist to the horizon whether or not
    // anything reads them, so its charge becomes a residual rather than being
    // released (S-14c).
    let expires = now + config::meta::slo::budget_rows::SLICE_HORIZON_SECS;
    let _ = slo_budget::retire(db, &slo.org, &slo.id, from, expires).await;
    if let Err(e) = slo_budget::charge(
        db,
        &slo.org,
        &slo.id,
        to,
        rows,
        get_config().slo.max_slice_rows_per_org,
    )
    .await
    {
        log::warn!(
            "[slo] {} bumped to generation {to} but its budget charge failed: {e}",
            slo.id
        );
    }
    schedule(slo, now).await;
}

/// Move SLOs into another (alert) folder.
///
/// Separate from `update` because a move is not an edit of the definition: it
/// must never bump the generation, and the caller only has ids, not full
/// definitions. Returns the number of rows moved so the handler can answer 404
/// when nothing matched.
pub async fn move_to_folder(
    org: &str,
    ids: &[String],
    dst_folder_id: &str,
    editor: Option<&str>,
) -> Result<u64, SloError> {
    let db = get_orm_client_rw().await;

    ensure_folder(org, dst_folder_id).await?;

    let now = now_micros() / 1_000_000;
    match slos_table::move_to_folder(db, org, ids, dst_folder_id, now, editor).await {
        Ok(n) => Ok(n),
        // The destination already holds an SLO of the same name. Its own
        // variant because the name is not known here — the unique index fails
        // the whole statement without saying which row lost.
        Err(e) if is_duplicate_name(&e) => Err(SloError::MoveNameConflict),
        Err(e) => Err(e.into()),
    }
}

pub async fn delete(org: &str, id: &str) -> Result<bool, SloError> {
    let db = get_orm_client_rw().await;

    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(false);
    };

    // S-12: the SLO's alerts go with it. An alert whose SLO no longer exists
    // has nothing to evaluate and no way to recover — it would error on every
    // pass forever — so leaving it behind is not a kinder outcome than
    // removing it. Disabled alerts are included for the same reason.
    //
    // Deleted through the alert service rather than by row, so each one takes
    // its scheduler trigger, ofga ownership and run-state with it.
    let dependents = infra::table::alerts::list_alerts_by_slo(db, org, id)
        .await
        .map_err(|e| SloError::Db(e.to_string()))?;
    let cascade = plan_alert_cascade(&dependents);
    let alert_ids = cascade
        .iter()
        .map(|(alert_id, _)| *alert_id)
        .collect::<Vec<_>>();
    if let Err(error) = crate::alerts::alert::delete_many_for_cascade(db, org, &alert_ids).await {
        use crate::alerts::alert::AlertError;
        return Err(match error {
            AlertError::AlertReferencedByComposites { parents } => {
                SloError::AlertCascadeConflict(format!(
                    "one or more generated alerts are referenced by {} composite alert(s)",
                    parents.len()
                ))
            }
            AlertError::CompositeGraphLockUnavailable(message) => {
                SloError::TemporarilyUnavailable(message)
            }
            other => SloError::Db(other.to_string()),
        });
    }
    for (_, name) in cascade {
        log::info!("[slo] deleted alert \"{name}\" along with SLO {id}");
    }

    let now = now_micros() / 1_000_000;

    // Retire, do not release: the slices are still on disk, and instant
    // release would make create-backfill-delete-repeat an unlimited storage
    // loophole (S-14c).
    let expires = now + config::meta::slo::budget_rows::SLICE_HORIZON_SECS;
    let _ = slo_budget::retire(db, org, id, slo.definition_generation, expires).await;

    let _ = backfill_jobs::delete_all(db, id).await;
    let _ = crate::db::scheduler::delete(org, crate::db::scheduler::TriggerModule::Slo, id).await;
    let _ = crate::db::scheduler::delete(org, crate::db::scheduler::TriggerModule::SloBackfill, id)
        .await;

    Ok(slos_table::delete(db, org, id).await?)
}

/// Which dependent alerts a delete will cascade to, as `(id, name)`.
///
/// Split out so the selection is testable without a database. An id that will
/// not parse is skipped rather than aborting the cascade: one unusable row
/// must not strand every other alert pointing at the same SLO.
fn plan_alert_cascade(dependents: &[(String, String)]) -> Vec<(Ksuid, String)> {
    dependents
        .iter()
        .filter_map(|(id, name)| Some((Ksuid::from_str(id).ok()?, name.clone())))
        .collect()
}

pub async fn set_enabled(org: &str, id: &str, enabled: bool) -> Result<bool, SloError> {
    let db = get_orm_client_rw().await;
    let now = now_micros() / 1_000_000;
    let changed = slos_table::set_enabled(db, org, id, enabled, now).await?;
    if changed && let Some(slo) = slos_table::get(db, org, id).await? {
        sync_ingest_trigger(&slo).await;
    }
    Ok(changed)
}

// ---------------------------------------------------------------------------
// read path
// ---------------------------------------------------------------------------

/// One SLO with its rollup measurement.
pub async fn get_with_status(
    org: &str,
    id: &str,
) -> Result<Option<(Slo, Option<config::meta::slo::SloStatusView>)>, anyhow::Error> {
    let db = get_orm_client_ro().await;
    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(None);
    };
    let status = rollup_view(db, &slo).await?;
    Ok(Some((slo, status)))
}

/// Every SLO in an org, each with its rollup measurement.
pub async fn list_with_status(
    org: &str,
    folder: Option<&str>,
) -> Result<Vec<(Slo, Option<config::meta::slo::SloStatusView>)>, anyhow::Error> {
    let db = get_orm_client_ro().await;
    let mut out = Vec::new();
    for slo in slos_table::list(db, org, folder).await? {
        let status = rollup_view(db, &slo).await?;
        out.push((slo, status));
    }
    Ok(out)
}

/// The per-group breakdown.
///
/// The rollup row is excluded: it is the EXACT overall (S-9), not a group, and
/// listing it alongside the groups would double-count in any client that sums
/// what it is given.
pub async fn group_status(
    org: &str,
    id: &str,
) -> Result<Vec<config::meta::slo::SloStatusView>, anyhow::Error> {
    let db = get_orm_client_ro().await;
    let Some(slo) = slos_table::get(db, org, id).await? else {
        return Ok(Vec::new());
    };
    let rows = infra::table::slo::load_all_groups(db, &slo.id).await?;
    let cfg = get_config();
    let now_secs = now_micros() / 1_000_000;
    Ok(rows
        .into_iter()
        .filter(|r| !r.group_key.is_empty())
        .map(|r| {
            view_of(
                &slo,
                &r,
                cfg.slo.min_coverage,
                now_secs,
                cfg.slo.recompute_slices.max(1),
            )
        })
        .collect())
}

async fn rollup_view(
    db: &sea_orm::DatabaseConnection,
    slo: &Slo,
) -> Result<Option<config::meta::slo::SloStatusView>, anyhow::Error> {
    let Some(row) = infra::table::slo::load_status(db, &slo.id, "").await? else {
        return Ok(None);
    };
    // A status row from a superseded generation describes a definition that
    // no longer exists. Reporting it would show numbers the current SLO never
    // produced.
    if row.definition_generation != slo.definition_generation {
        return Ok(None);
    }
    let cfg = get_config();
    let now_secs = now_micros() / 1_000_000;
    let view = view_of(
        slo,
        &row,
        cfg.slo.min_coverage,
        now_secs,
        cfg.slo.recompute_slices.max(1),
    );
    // Only the rollup carries this, like the watermark: it describes the SLO's
    // whole window, not one group's slice of it.
    Ok(Some(view.with_measuring_since(
        measurement_floor(db, slo).await,
        now_secs - slo.definition.window_secs,
    )))
}

/// The earliest instant this SLO's window is actually measured from, epoch
/// seconds — the clamp PR 4's backfill was queued under, read back.
///
/// Read from the backfill job rather than recomputed: the job row records the
/// range that was really filled, so the banner cannot disagree with the data.
/// `None` for every non-alert SLI, and for an alert SLI whose job row is gone —
/// in both cases there is nothing to explain.
async fn measurement_floor(db: &sea_orm::DatabaseConnection, slo: &Slo) -> Option<i64> {
    source_alert_id(slo)?;
    backfill_jobs::get(db, &slo.id, slo.definition_generation)
        .await
        .ok()
        .flatten()
        .map(|job| job.range_start)
}

fn view_of(
    slo: &Slo,
    row: &infra::table::entity::slo_status::Model,
    coverage_floor: f64,
    now_secs: i64,
    stale_k: i64,
) -> config::meta::slo::SloStatusView {
    let expected = config::meta::slo::window::expected_slices(
        0,
        slo.definition.window_secs,
        slo.definition.slice_interval_secs,
    );
    let view = config::meta::slo::SloStatusView::derive(
        row.group_key.clone(),
        row.good,
        row.total,
        row.covered_slices.map(i64::from),
        expected,
        slo.target,
        slo.definition.window_secs,
        coverage_floor,
        row.computed_at,
    );
    // The watermark lives ONLY on the rollup row (`apply_status_in_txn`), so a
    // group row's absent watermark says nothing about staleness — reporting it
    // as stale would flag every group of every healthy SLO.
    if !row.group_key.is_empty() {
        return view;
    }
    view.with_watermark(
        row.watermark_end,
        // The same test the alert evaluator applies (`evaluate.rs`), so the
        // banner and the alerts cannot disagree about whether the SLO froze.
        config::meta::slo::window::watermark_is_stale_or_absent(
            now_secs,
            row.watermark_end,
            slo.definition.slice_interval_secs,
            stale_k,
        ),
    )
}

/// Create the ingest job and, for a fresh generation, queue the backfill.
async fn schedule(slo: &Slo, now: i64) {
    sync_ingest_trigger(slo).await;

    let db = get_orm_client_rw().await;
    // A new generation has no history, so its window is meaningless until
    // backfill fills it. The range ends where the incremental writer begins,
    // which is what keeps the two writers off each other's slices (§6b.9).
    let (start, end) = super::backfill::backfill_range(
        slo.definition.window_secs,
        now,
        slo.definition.slice_interval_secs,
    );
    // An alert SLI cannot honestly measure the whole window: there is no
    // evidence before the ledger begins, and history before the source alert's
    // last edit was produced under a config the eligibility rules never saw
    // (PR 4). The window stays 30 days and reads as partial — the SLO detail
    // page says "measuring since <date>" rather than quoting a coverage
    // percentage nobody can explain.
    let start = alert_source_floor(db, slo).await.clamp_start(
        start,
        end,
        slo.definition.slice_interval_secs,
    );
    if let Err(e) =
        backfill_jobs::queue(db, &slo.id, slo.definition_generation, start, end, now).await
    {
        log::warn!("[slo] could not queue backfill for {}: {e}", slo.id);
        return;
    }
    push_trigger(
        &slo.org,
        &slo.id,
        crate::db::scheduler::TriggerModule::SloBackfill,
        now_micros(),
    )
    .await;
}

/// How far back an SLO's backfill may honestly reach (S-16 PR 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceFloor {
    /// Not an alert SLI. A count or time-slice SLO measures its whole window
    /// and must never be clamped.
    WholeWindow,
    /// The two bounds to take the later of, epoch seconds. Either may be
    /// genuinely absent — a source that has never evaluated has no ledger, and
    /// one untouched since the 2024 migration reads as no recent edit — and an
    /// absent bound constrains nothing.
    ///
    /// **The last edit is of ANY kind**, not just computation-affecting ones:
    /// the alert layer stamps one timestamp per save and cannot tell the
    /// difference. Coarser than the doc's ideal, safe in the same direction —
    /// it can only shorten the measured span, never claim history the
    /// eligibility checks never saw.
    Bounds {
        ledger_start_secs: Option<i64>,
        last_edit_secs: Option<i64>,
    },
    /// The source could not be read. Nothing may be claimed about history whose
    /// provenance cannot be checked, so the backfill measures none of it.
    ///
    /// Fails CLOSED, unlike the rest of this fire-and-forget path. The queued
    /// range is recorded once per generation and never revisited, so a widened
    /// range here would be permanent — and it would be exactly the
    /// unvalidated-history measurement bullet 4 exists to prevent. An empty
    /// range instead reads as "measuring since now, 0 of 30 days" on the detail
    /// page, which is honest and fills itself in as the incremental pass runs.
    Unreadable,
}

impl SourceFloor {
    fn clamp_start(self, range_start: i64, range_end: i64, slice_interval_secs: i64) -> i64 {
        match self {
            Self::WholeWindow => range_start,
            Self::Bounds {
                ledger_start_secs,
                last_edit_secs,
            } => super::backfill::clamp_backfill_start(
                range_start,
                range_end,
                ledger_start_secs,
                last_edit_secs,
                slice_interval_secs,
            ),
            Self::Unreadable => range_end,
        }
    }
}

/// Read the two bounds PR 4's backfill clamp takes the later of: where the
/// source alert's availability ledger begins, and when the alert was last
/// written.
async fn alert_source_floor(db: &sea_orm::DatabaseConnection, slo: &Slo) -> SourceFloor {
    let Some(alert_id) = source_alert_id(slo) else {
        return SourceFloor::WholeWindow;
    };
    let Ok(ledger_start) = infra::table::alert_eval_intervals::earliest_from_us(alert_id).await
    else {
        log::warn!("[slo] {}: could not read its source's ledger", slo.id);
        return SourceFloor::Unreadable;
    };
    let last_edit = match infra::table::alerts::last_written_us(db, &slo.org, alert_id).await {
        Ok(at) => at,
        Err(e) => {
            log::warn!("[slo] {}: could not read its source alert: {e}", slo.id);
            return SourceFloor::Unreadable;
        }
    };
    SourceFloor::Bounds {
        ledger_start_secs: ledger_start.map(|us| us / 1_000_000),
        last_edit_secs: last_edit.map(|us| us / 1_000_000),
    }
}

/// Add or remove the ingest trigger to match `enabled`.
async fn sync_ingest_trigger(slo: &Slo) {
    let module = crate::db::scheduler::TriggerModule::Slo;
    if !slo.enabled {
        let _ = crate::db::scheduler::delete(&slo.org, module, &slo.id).await;
        return;
    }
    push_trigger(&slo.org, &slo.id, module, now_micros()).await;
}

async fn push_trigger(
    org: &str,
    id: &str,
    module: crate::db::scheduler::TriggerModule,
    next_run_at: i64,
) {
    let trigger = crate::db::scheduler::Trigger {
        org: org.to_string(),
        module,
        module_key: id.to_string(),
        next_run_at,
        is_realtime: false,
        is_silenced: false,
        ..Default::default()
    };
    if let Err(e) = crate::db::scheduler::push(trigger).await {
        log::warn!("[slo] could not schedule {id}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deleting an SLO CASCADES to its alerts: an alert whose SLO is gone can
    /// only ever error — it has no data to evaluate and no way to recover.
    /// Only alerts pointing at THIS SLO go.
    #[test]
    fn the_cascade_targets_exactly_the_alerts_of_this_slo() {
        use svix_ksuid::KsuidLike as _;
        let a = svix_ksuid::Ksuid::new(None, None);
        let b = svix_ksuid::Ksuid::new(None, None);
        let dependents = vec![
            (a.to_string(), "checkout burn".to_string()),
            (b.to_string(), "budget 90%".to_string()),
        ];
        let plan = plan_alert_cascade(&dependents);
        assert_eq!(plan.len(), 2);
        assert!(
            plan.iter()
                .any(|(id, name)| *id == a && name == "checkout burn")
        );
        assert!(
            plan.iter()
                .any(|(id, name)| *id == b && name == "budget 90%")
        );
    }

    /// An SLO nobody alerts on deletes with no cascade at all — and, more to
    /// the point, with no alert lookups turning into deletions.
    #[test]
    fn an_slo_with_no_alerts_cascades_to_nothing() {
        assert!(plan_alert_cascade(&[]).is_empty());
    }

    // ---- validation wiring --------------------------------------------------

    mod validation {
        use config::meta::slo::{
            SliConfig, SloDefinition, SourceAlertFacts, WINDOW_30D_SECS, validate_slo,
        };

        use super::*;

        fn alert_slo() -> Slo {
            Slo {
                id: "slo-1".into(),
                org: "myorg".into(),
                folder_id: "default".into(),
                name: "checkout alert uptime".into(),
                description: String::new(),
                definition: SloDefinition {
                    sli_config: SliConfig::Alert {
                        alert_id: "alert-1".into(),
                    },
                    group_by: None,
                    window_secs: WINDOW_30D_SECS,
                    slice_interval_secs: 60,
                },
                target: 99.9,
                tags: Vec::new(),
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            }
        }

        fn eligible_facts() -> SourceAlertFacts {
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

        /// The "Phase 5c" gap, closed: the facts must actually reach
        /// `validate_slo`. With `None` hardcoded there — as it was — every
        /// alert SLO is rejected with `AlertSliSourceUnknown` however eligible
        /// its source is, and nothing else in this suite would notice.
        #[test]
        fn an_alert_slo_with_an_eligible_source_validates() {
            assert!(
                validate_with_facts(&alert_slo(), Some(eligible_facts())).is_ok(),
                "the source facts never reached validate_slo"
            );
        }

        /// A source that could not be loaded is not a source. The SLO is
        /// refused rather than half-validated.
        #[test]
        fn an_alert_slo_whose_source_is_unknown_is_rejected() {
            let err = validate_with_facts(&alert_slo(), None).unwrap_err();
            assert_eq!(
                err.to_string(),
                config::meta::slo::SloValidationError::AlertSliSourceUnknown.to_string()
            );
        }

        /// A rejection from the facts is surfaced verbatim, not flattened into
        /// a generic message — the picker and the API both depend on it.
        #[test]
        fn a_source_fact_rejection_reaches_the_caller() {
            let cron = SourceAlertFacts {
                is_cron: true,
                ..eligible_facts()
            };
            let err = validate_with_facts(&alert_slo(), Some(cron)).unwrap_err();
            assert_eq!(
                err.to_string(),
                config::meta::slo::SloValidationError::AlertSliSourceIsCron.to_string()
            );
        }

        /// Non-alert SLIs must not have gained a source requirement.
        #[test]
        fn a_count_slo_still_validates_without_any_facts() {
            let mut slo = alert_slo();
            slo.definition.sli_config = SliConfig::Count {
                source: config::meta::slo::CountSource::SingleQuery {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    scope: None,
                    good_expr: "status_code < 500".into(),
                },
            };
            assert!(validate_with_facts(&slo, None).is_ok());
            // And the underlying rule is unchanged.
            assert_eq!(validate_slo(&slo.definition, slo.target, None), Ok(()));
        }
    }

    // ---- PromQL parse validation --------------------------------------------

    /// HAZARD: a PromQL expression that does not parse saves cleanly and then
    /// fails on every single evaluation. The SLO writes no slices, coverage
    /// falls to zero, and every alert on it freezes — a silent, permanent
    /// no-data discovered days later, when the typo was visible at save.
    ///
    /// It cannot be caught in `config`, which has no PromQL parser (hence the
    /// "non-empty only" note on the count arm). `core` already depends on
    /// `promql-parser`, so the parse check lives here, one step after
    /// `validate_query_safety`.
    ///
    /// **Parse-only, deliberately.** There is no grouping or aggregation
    /// check: requiring the root to be an aggregation whose `by(…)` equals
    /// `group_by` rejects legitimate expressions — a `histogram_quantile`
    /// root (whose inner `by` must carry `le`, a necessary superset) and a
    /// binary-op root (the repo's own canonical count fixture). Those two
    /// shapes are pinned below so the idea cannot be reintroduced by accident.
    mod promql_parse_validation {
        use config::meta::{
            alerts::Operator,
            slo::{
                CountQuery, CountSource, QueryLanguage, QuerySafetyError, SliConfig, SloDefinition,
                WINDOW_30D_SECS,
            },
        };

        use super::*;

        /// A `histogram_quantile` root whose inner `by(…)` carries `le` on top
        /// of the group column — the shape an aggregation-root rule would
        /// wrongly reject.
        const HISTOGRAM_QUANTILE: &str =
            "histogram_quantile(0.95, sum by (le, region) (rate(http_duration_bucket[5m])))";
        /// A binary-op root, the other shape such a rule would wrongly reject.
        const GOOD_MINUS_BAD: &str =
            "increase(http_requests_total[5m]) - increase(http_errors_total[5m])";
        /// Unbalanced parenthesis — a plain typo.
        const UNPARSEABLE: &str = "increase(http_requests_total[5m]";

        fn slo_with(sli_config: SliConfig, group_by: Option<Vec<String>>) -> Slo {
            Slo {
                id: "slo-1".into(),
                org: "myorg".into(),
                folder_id: "default".into(),
                name: "checkout latency".into(),
                description: String::new(),
                definition: SloDefinition {
                    sli_config,
                    group_by,
                    window_secs: WINDOW_30D_SECS,
                    slice_interval_secs: SLICE_300_SECS,
                },
                target: 99.9,
                tags: Vec::new(),
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            }
        }

        /// The stream type follows the language so these fixtures never trip
        /// `language_suits_stream` by accident.
        fn time_slice(
            query_language: QueryLanguage,
            query: &str,
            scope: Option<&str>,
        ) -> SliConfig {
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

        fn count_promql(good: &str, total: &str) -> SliConfig {
            SliConfig::Count {
                source: CountSource::PromQl {
                    good: good.into(),
                    total: total.into(),
                },
            }
        }

        // ---- time-slice --------------------------------------------------

        #[test]
        fn a_time_slice_promql_expression_that_does_not_parse_is_rejected() {
            let slo = slo_with(time_slice(QueryLanguage::PromQl, UNPARSEABLE, None), None);
            let msg = validate_with_facts(&slo, None).unwrap_err().to_string();
            // Field-first, matching how every `QuerySafetyError` reads.
            assert!(msg.starts_with("query"), "must name the field: {msg}");
            assert!(
                msg.to_lowercase().contains("promql"),
                "must name the language: {msg}"
            );
        }

        /// A name that is not a PromQL function is a parse error too, and it
        /// is the mistake a user migrating a SQL aggregate actually makes.
        #[test]
        fn an_unknown_promql_function_is_rejected() {
            let slo = slo_with(
                time_slice(QueryLanguage::PromQl, "p95(duration_ms)", None),
                None,
            );
            let msg = validate_with_facts(&slo, None).unwrap_err().to_string();
            assert!(msg.starts_with("query"), "must name the field: {msg}");
        }

        /// Parse-only means parse-only. A bare instant selector — the natural
        /// shape of a gauge SLI ("queue depth < 100") — carries no range
        /// selector, no aggregation and no function call, so it also pins the
        /// absence of any rule about those.
        #[test]
        fn a_valid_time_slice_promql_expression_validates() {
            for query in [HISTOGRAM_QUANTILE, "queue_depth{job=\"api\"}"] {
                let slo = slo_with(time_slice(QueryLanguage::PromQl, query, None), None);
                let err = validate_with_facts(&slo, None).err().map(|e| e.to_string());
                assert!(err.is_none(), "{query}: {err:?}");
            }
        }

        /// The check is gated on the language, not on the SLI type. A SQL
        /// aggregate is not PromQL and must never be parsed as if it were —
        /// both of these are parse errors in PromQL.
        #[test]
        fn a_sql_time_slice_aggregate_is_never_parsed_as_promql() {
            for aggregate in ["p95(duration_ms)", "count(*)"] {
                let slo = slo_with(time_slice(QueryLanguage::Sql, aggregate, None), None);
                assert!(
                    validate_with_facts(&slo, None).is_ok(),
                    "SQL aggregate {aggregate:?} was rejected"
                );
            }
        }

        // ---- count -------------------------------------------------------

        #[test]
        fn an_unparseable_count_numerator_is_rejected_by_name() {
            let slo = slo_with(count_promql(UNPARSEABLE, "increase(a[5m])"), None);
            let msg = validate_with_facts(&slo, None).unwrap_err().to_string();
            assert!(msg.starts_with("good"), "must name the field: {msg}");
            assert!(
                msg.to_lowercase().contains("promql"),
                "must name the language: {msg}"
            );
        }

        #[test]
        fn an_unparseable_count_denominator_is_rejected_by_name() {
            let slo = slo_with(count_promql("increase(a[5m])", UNPARSEABLE), None);
            let msg = validate_with_facts(&slo, None).unwrap_err().to_string();
            assert!(msg.starts_with("total"), "must name the field: {msg}");
        }

        /// A single-query scope is a SQL predicate — `=` is not even a PromQL
        /// operator — so a check gated on anything looser than the variant
        /// would break every SQL count SLO. The sibling fixture at
        /// `a_count_slo_still_validates_without_any_facts` cannot catch this:
        /// its `status_code < 500` happens to be valid PromQL.
        #[test]
        fn a_single_query_count_source_is_never_parsed_as_promql() {
            let slo = slo_with(
                SliConfig::Count {
                    source: CountSource::SingleQuery {
                        stream: "requests".into(),
                        stream_type: "logs".into(),
                        scope: Some("service = 'checkout'".into()),
                        good_expr: "status_code < 500".into(),
                    },
                },
                None,
            );
            let err = validate_with_facts(&slo, None).err().map(|e| e.to_string());
            assert!(err.is_none(), "{err:?}");
        }

        /// A dual-query member is a whole `SELECT …`, which is emphatically
        /// not PromQL. A check that asked "does this SLO look PromQL-ish"
        /// instead of gating on the variant would break every one of them.
        #[test]
        fn a_dual_query_count_source_is_never_parsed_as_promql() {
            let member = || CountQuery {
                stream: "requests".into(),
                stream_type: "logs".into(),
                sql: "SELECT histogram(_timestamp, '5 minute') AS slice_start, \
                      count(*) AS zo_slo_value FROM requests GROUP BY slice_start"
                    .into(),
            };
            let slo = slo_with(
                SliConfig::Count {
                    source: CountSource::DualQuery {
                        good: member(),
                        total: member(),
                    },
                },
                None,
            );
            let err = validate_with_facts(&slo, None).err().map(|e| e.to_string());
            assert!(err.is_none(), "{err:?}");
        }

        #[test]
        fn the_canonical_count_promql_pair_validates() {
            let slo = slo_with(
                count_promql(GOOD_MINUS_BAD, "increase(http_requests_total[5m])"),
                None,
            );
            assert!(validate_with_facts(&slo, None).is_ok());
        }

        // ---- no grouping/aggregation rule, in either shape ----------------

        /// The anti-regression for the rejected design. Both roots — a
        /// function call over a `by (le, region)` superset, and a binary op —
        /// are legitimate for a `region`-grouped SLO, and both must pass.
        #[test]
        fn a_grouped_slo_needs_no_agreement_between_group_by_and_the_expression() {
            let groups = Some(vec!["region".to_string()]);
            let sliced = slo_with(
                time_slice(QueryLanguage::PromQl, HISTOGRAM_QUANTILE, None),
                groups.clone(),
            );
            assert!(
                validate_with_facts(&sliced, None).is_ok(),
                "a histogram_quantile root over a `le` superset is legitimate"
            );

            let counted = slo_with(
                count_promql(GOOD_MINUS_BAD, "increase(http_requests_total[5m])"),
                groups.clone(),
            );
            assert!(
                validate_with_facts(&counted, None).is_ok(),
                "a binary-op root is legitimate"
            );

            // And an expression naming no group label at all: the labels the
            // series carries at evaluation time are the group values, and
            // nothing about them is knowable at save.
            let unlabelled = slo_with(
                time_slice(QueryLanguage::PromQl, "avg(rate(http_sum[5m]))", None),
                groups,
            );
            assert!(
                validate_with_facts(&unlabelled, None).is_ok(),
                "an expression naming no group label is legitimate"
            );
        }

        // ---- ordering against the config-side rules -----------------------

        /// An empty expression is caught by `validate_query_safety` first. It
        /// would also fail to parse, but "must not be empty" is the useful
        /// sentence — a parser's complaint about an empty input is not.
        #[test]
        fn an_empty_expression_still_reports_the_emptiness_rule() {
            let sliced = slo_with(time_slice(QueryLanguage::PromQl, "  ", None), None);
            assert_eq!(
                validate_with_facts(&sliced, None).unwrap_err().to_string(),
                QuerySafetyError::EmptyExpression { field: "query" }.to_string()
            );

            let counted = slo_with(count_promql("", "increase(a[5m])"), None);
            assert_eq!(
                validate_with_facts(&counted, None).unwrap_err().to_string(),
                QuerySafetyError::EmptyExpression { field: "good" }.to_string()
            );
        }

        /// The scope rule is a `config` rule, and the expression here is ALSO
        /// unparseable — so this fails if the parse check is ever placed
        /// before `validate_query_safety`.
        #[test]
        fn a_promql_scope_is_still_rejected_by_the_config_rule() {
            let slo = slo_with(
                time_slice(
                    QueryLanguage::PromQl,
                    UNPARSEABLE,
                    Some("service = 'checkout'"),
                ),
                None,
            );
            assert_eq!(
                validate_with_facts(&slo, None).unwrap_err().to_string(),
                QuerySafetyError::ScopeNotValidForLanguage {
                    query_language: QueryLanguage::PromQl
                }
                .to_string()
            );
        }
    }

    // ---- source-alert facts (§5.1, §5.4) -----------------------------------

    mod source_facts {
        use config::meta::{
            alerts::{
                AggFunction, Aggregation, Condition, FrequencyType, Operator, QueryCondition,
                QueryType, TriggerCondition, alert::Alert,
            },
            slo::condition::{SloAlertKind, SloCondition},
        };

        use super::*;

        /// A plain scheduled SQL alert on a 1-minute cadence: the eligible
        /// shape every other case is a one-field deviation from.
        fn eligible() -> Alert {
            // Built by mutation rather than a struct literal: `Alert` has
            // private fields, so it cannot be spread from outside its module.
            let mut alert = Alert::default();
            alert.is_real_time = false;
            alert.trigger_condition = TriggerCondition {
                frequency: 60,
                frequency_type: FrequencyType::Minutes,
                silence: 0,
                ..Default::default()
            };
            alert.query_condition = QueryCondition {
                query_type: QueryType::SQL,
                ..Default::default()
            };
            alert
        }

        fn aggregation(group_by: Option<Vec<String>>, multi_alert: bool) -> Aggregation {
            Aggregation {
                group_by,
                function: AggFunction::Count,
                having: Condition {
                    column: "x".into(),
                    operator: Operator::GreaterThanEquals,
                    value: serde_json::json!(1),
                    ignore_case: false,
                },
                warning_value: None,
                multi_alert,
            }
        }

        #[test]
        fn an_ordinary_scheduled_alert_is_an_eligible_source() {
            let facts = source_alert_facts(&eligible());
            assert!(facts.is_scheduled);
            assert!(!facts.is_grouped);
            assert!(!facts.is_slo_alert);
            assert!(!facts.is_composite);
            assert!(!facts.is_cron);
            assert!(!facts.is_silence_gated);
            assert_eq!(facts.frequency_secs, 60);
        }

        /// Real-time alerts evaluate at ingest, per cluster, and carry no
        /// durable level state (C-7, D12).
        #[test]
        fn a_real_time_alert_is_not_scheduled() {
            let mut a = eligible();
            a.is_real_time = true;
            assert!(!source_alert_facts(&a).is_scheduled);
        }

        /// "Grouped" is **maintains per-group state**, not the column list.
        #[test]
        fn a_group_by_column_list_makes_the_source_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), false));
            assert!(source_alert_facts(&a).is_grouped);
        }

        /// The case the column-list test gets wrong: a PromQL multi-alert has
        /// no `group_by` list at all — the returned series' labels are the
        /// group — yet it never reaches the single-row path where the ledger
        /// writes. Treating it as ungrouped would let it save cleanly and
        /// measure nothing forever.
        #[test]
        fn a_promql_multi_alert_is_grouped_despite_having_no_group_by_list() {
            let mut a = eligible();
            a.query_condition.query_type = QueryType::PromQL;
            a.query_condition.promql_multi_alert = true;
            assert!(a.query_condition.aggregation.is_none());
            assert!(
                source_alert_facts(&a).is_grouped,
                "a PromQL multi-alert maintains per-group state"
            );
        }

        #[test]
        fn a_sql_multi_alert_is_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), true));
            assert!(source_alert_facts(&a).is_grouped);
        }

        /// An empty column list is not grouping.
        #[test]
        fn an_empty_group_by_list_does_not_make_the_source_grouped() {
            let mut a = eligible();
            a.query_condition.aggregation = Some(aggregation(Some(vec![]), false));
            assert!(!source_alert_facts(&a).is_grouped);
        }

        fn slo_condition(warning: Option<f64>) -> SloCondition {
            SloCondition {
                slo_id: "slo-1".into(),
                kind: SloAlertKind::ErrorBudget,
                operator: Operator::GreaterThanEquals,
                critical: 90.0,
                warning,
                long_window_secs: None,
                short_window_secs: None,
                multi_alert: false,
            }
        }

        /// Excluding SLO alerts is what prevents SLO -> alert -> SLO cycles
        /// without a cycle checker.
        ///
        /// The fact is read from `query_condition.slo_condition`, which is the
        /// domain-level truth: the indexed `alerts.slo_id` column the design
        /// note names is *derived* from exactly this field at write time (D60,
        /// `infra::table::alerts::…`), and `Alert` itself carries no `slo_id`.
        #[test]
        fn an_slo_alert_is_recognised_by_its_slo_condition() {
            let mut a = eligible();
            a.query_condition.query_type = QueryType::Slo;
            a.query_condition.slo_condition = Some(slo_condition(None));
            assert!(source_alert_facts(&a).is_slo_alert);
        }

        #[test]
        fn a_cron_source_is_recognised() {
            let mut a = eligible();
            a.trigger_condition.frequency_type = FrequencyType::Cron;
            a.trigger_condition.cron = "0 9 * * 1-5".into();
            assert!(source_alert_facts(&a).is_cron);
        }

        #[test]
        fn the_cadence_is_the_alerts_frequency_in_seconds() {
            let mut a = eligible();
            a.trigger_condition.frequency = 300;
            assert_eq!(source_alert_facts(&a).frequency_secs, 300);
        }

        /// A single-level alert with silence stops evaluating for the whole
        /// silence window, and silence engages after a firing — missingness
        /// correlated with badness (§5.4).
        #[test]
        fn a_single_level_alert_with_silence_is_silence_gated() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            let facts = source_alert_facts(&a);
            assert!(facts.is_silence_gated);
            assert_eq!(facts.silence_minutes, 10);
        }

        #[test]
        fn silence_of_zero_is_never_gated() {
            let facts = source_alert_facts(&eligible());
            assert!(!facts.is_silence_gated);
            assert_eq!(facts.silence_minutes, 0);
        }

        /// A warning threshold keeps the alert evaluating through silence —
        /// only delivery is suppressed — so the ledger stays dense.
        #[test]
        fn a_warning_threshold_defuses_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.trigger_condition.warning_threshold = Some(1);
            let facts = source_alert_facts(&a);
            assert!(!facts.is_silence_gated);
            assert_eq!(
                facts.silence_minutes, 10,
                "the minutes are still reported; only the gate is off"
            );
        }

        /// The warning axis has four sources, not just `warning_threshold` —
        /// checking only that one would leave aggregation- and PromQL-warning
        /// alerts on the legacy silence path in the runtime while validation
        /// believed otherwise. (The fourth, `slo_condition.warning`, cannot
        /// reach this rule: an SLO alert is refused as a source outright.)
        #[test]
        fn every_reachable_warning_source_defuses_silence() {
            let mut agg = eligible();
            agg.trigger_condition.silence = 10;
            let mut a = aggregation(Some(vec![]), false);
            a.warning_value = Some(1.0);
            agg.query_condition.aggregation = Some(a);
            assert!(!source_alert_facts(&agg).is_silence_gated);

            let mut promql = eligible();
            promql.trigger_condition.silence = 10;
            promql.query_condition.query_type = QueryType::PromQL;
            promql.query_condition.promql_warning_value = Some(1.0);
            assert!(!source_alert_facts(&promql).is_silence_gated);
        }

        /// The fourth family, pinned anyway: the fact must be derived from the
        /// same `is_multi_level` the scheduler uses, not from a subset of it.
        #[test]
        fn an_slo_warning_also_defuses_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.query_condition.query_type = QueryType::Slo;
            a.query_condition.slo_condition = Some(slo_condition(Some(50.0)));
            assert!(!source_alert_facts(&a).is_silence_gated);
        }

        /// `evaluates_through_silence`'s multi-alert arm: it is irrelevant to
        /// eligibility, because a multi-alert is rejected by `is_grouped`
        /// first. Pinned so nobody "simplifies" the grouping fact away on the
        /// grounds that silence already covers it.
        #[test]
        fn a_multi_alert_is_rejected_by_grouping_not_by_silence() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), true));
            let facts = source_alert_facts(&a);
            assert!(
                !facts.is_silence_gated,
                "a multi-alert evaluates through silence"
            );
            assert!(
                facts.is_grouped,
                "and is refused for maintaining per-group state"
            );
        }

        /// Composite alerts are a deferred feature with no representation on
        /// `Alert` yet. The fact stays wired so the rule ships with the rest.
        #[test]
        fn no_alert_is_composite_yet() {
            assert!(!source_alert_facts(&eligible()).is_composite);
        }

        // ---- the picker's rows (PR 3) --------------------------------------

        fn with_id(mut alert: Alert) -> Alert {
            use svix_ksuid::KsuidLike as _;
            alert.id = Some(svix_ksuid::Ksuid::new(None, None));
            alert.name = "checkout latency".into();
            alert
        }

        #[test]
        fn an_eligible_alert_becomes_a_selectable_row() {
            let alert = with_id(eligible());
            let row = slo_eligibility(&alert).expect("an alert with an id has a row");
            assert_eq!(row.alert_id, alert.id.unwrap().to_string());
            assert_eq!(row.name, "checkout latency");
            assert!(row.eligible);
            assert_eq!(row.reason, None);
            assert_eq!(row.frequency_secs, 60);
        }

        /// The picker filters on **every** fact, and each reason is the
        /// validator's own message rather than a second wording of it — so
        /// what the picker says and what a save would say cannot drift.
        #[test]
        fn every_ineligible_shape_carries_the_validators_own_reason() {
            use config::meta::slo::SloValidationError as E;

            let cron = {
                let mut a = with_id(eligible());
                a.trigger_condition.frequency_type = FrequencyType::Cron;
                a.trigger_condition.cron = "0 9 * * 1-5".into();
                a
            };
            let grouped = {
                let mut a = with_id(eligible());
                a.query_condition.aggregation = Some(aggregation(Some(vec!["host".into()]), false));
                a
            };
            let realtime = {
                let mut a = with_id(eligible());
                a.is_real_time = true;
                a
            };
            let slo_alert = {
                let mut a = with_id(eligible());
                a.query_condition.query_type = QueryType::Slo;
                a.query_condition.slo_condition = Some(slo_condition(None));
                a
            };
            let too_slow = {
                let mut a = with_id(eligible());
                a.trigger_condition.frequency = 600;
                a
            };
            let silence_gated = {
                let mut a = with_id(eligible());
                a.trigger_condition.silence = 10;
                a
            };

            let cases = [
                (cron, E::AlertSliSourceIsCron),
                (grouped, E::AlertSliSourceIsGrouped),
                (realtime, E::AlertSliSourceNotScheduled),
                (slo_alert, E::AlertSliSourceIneligible),
                (
                    too_slow,
                    E::AlertSliSourceTooInfrequent {
                        frequency_secs: 600,
                        slice_interval_secs: config::meta::slo::SLICE_300_SECS,
                    },
                ),
                (
                    silence_gated,
                    E::AlertSliSourceSilenceGated {
                        silence_minutes: 10,
                    },
                ),
            ];
            for (alert, want) in cases {
                let row = slo_eligibility(&alert).unwrap();
                assert!(!row.eligible, "{want:?} should not be selectable");
                assert_eq!(row.reason.as_deref(), Some(want.to_string().as_str()));
            }
        }

        /// §5.4's remedy has to reach the user *before* save, and the picker is
        /// the only place that can carry it.
        #[test]
        fn the_silence_reason_names_the_remedy() {
            let mut a = with_id(eligible());
            a.trigger_condition.silence = 10;
            let reason = slo_eligibility(&a).unwrap().reason.unwrap();
            assert!(reason.contains("10"), "{reason}");
            assert!(reason.contains("silence to 0"), "{reason}");
            assert!(reason.contains("warning threshold"), "{reason}");
        }

        /// 300 is the coarsest slice (S-4), so the picker's cadence cut-off is
        /// there — not at the 60s default the form happens to start on.
        #[test]
        fn a_five_minute_cadence_is_still_selectable() {
            let mut a = with_id(eligible());
            a.trigger_condition.frequency = 300;
            let row = slo_eligibility(&a).unwrap();
            assert!(row.eligible, "{:?}", row.reason);
            assert_eq!(row.frequency_secs, 300);
        }

        /// The form applies the smallest-legal-slice default from this number,
        /// so it has to be present on every row — including the ones the user
        /// cannot pick.
        #[test]
        fn an_ineligible_row_still_reports_its_cadence() {
            let mut a = with_id(eligible());
            a.trigger_condition.frequency = 600;
            let row = slo_eligibility(&a).unwrap();
            assert!(!row.eligible);
            assert_eq!(row.frequency_secs, 600);
        }

        /// An alert with no id cannot be referenced by `SliConfig::Alert`, so
        /// offering it would produce an SLO whose source is unknown.
        #[test]
        fn an_alert_without_an_id_is_not_offered() {
            assert!(slo_eligibility(&eligible()).is_none());
        }

        /// The picker reads these names off the wire, and nothing else checks
        /// the serialized shape — a rename here is a silently empty dropdown.
        #[test]
        fn a_picker_row_serializes_under_the_names_the_form_reads() {
            let mut a = with_id(eligible());
            a.trigger_condition.silence = 10;
            let row = slo_eligibility(&a).unwrap();
            let json = serde_json::to_value(&row).unwrap();
            assert!(json.get("alert_id").unwrap().is_string());
            assert_eq!(json.get("name").unwrap(), "checkout latency");
            assert_eq!(json.get("frequency_secs").unwrap(), 60);
            assert_eq!(json.get("eligible").unwrap(), false);
            assert!(json.get("reason").unwrap().is_string());
        }
    }

    // ---- source-alert lifecycle (PR 4) -------------------------------------

    mod source_lifecycle {
        use config::meta::{
            alerts::{
                FrequencyType, Operator, QueryCondition, QueryType, TriggerCondition, alert::Alert,
            },
            slo::SloValidationError as E,
        };

        use super::*;

        /// The same eligible shape `source_facts` uses: a plain scheduled SQL
        /// alert on a 1-minute cadence with no silence.
        fn eligible() -> Alert {
            let mut alert = Alert::default();
            alert.name = "checkout latency".into();
            alert.is_real_time = false;
            alert.trigger_condition = TriggerCondition {
                period: 10,
                operator: Operator::GreaterThanEquals,
                threshold: 3,
                frequency: 60,
                frequency_type: FrequencyType::Minutes,
                silence: 0,
                ..Default::default()
            };
            alert.query_condition = QueryCondition {
                query_type: QueryType::SQL,
                sql: Some("SELECT count(*) FROM requests WHERE status >= 500".into()),
                ..Default::default()
            };
            alert
        }

        fn alert_slo() -> Slo {
            Slo {
                id: "slo-1".into(),
                org: "myorg".into(),
                folder_id: "default".into(),
                name: "checkout alert uptime".into(),
                description: String::new(),
                definition: config::meta::slo::SloDefinition {
                    sli_config: config::meta::slo::SliConfig::Alert {
                        alert_id: "alert-9".into(),
                    },
                    group_by: None,
                    window_secs: config::meta::slo::WINDOW_30D_SECS,
                    slice_interval_secs: 300,
                },
                target: 99.9,
                tags: Vec::new(),
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            }
        }

        /// An alert that carries silence but keeps evaluating through it,
        /// because a warning threshold puts it on the delivery-suppression
        /// path (§5.4) rather than the go-dark one.
        fn silenced_with_warning() -> Alert {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            a.trigger_condition.warning_threshold = Some(1);
            a
        }

        // ---- eligibility-breaking edits (§5.1, §5.4) -----------------------

        /// §5.1.1: a source that evaluates less often than once per slice can
        /// never cover the grid, so the SLO is permanently frozen.
        #[test]
        fn raising_the_cadence_past_the_slice_breaks_the_source() {
            let mut a = eligible();
            a.trigger_condition.frequency = 600;
            assert_eq!(
                source_alert_edit_breakage(&a, 300),
                Some(E::AlertSliSourceTooInfrequent {
                    frequency_secs: 600,
                    slice_interval_secs: 300,
                })
            );
        }

        /// §5.1.2: cadence is not a single number for a cron source, and a
        /// weekdays-only expression reads as ~71% coverage — frozen, for a
        /// reason the user cannot see.
        #[test]
        fn switching_the_source_to_cron_breaks_it() {
            let mut a = eligible();
            a.trigger_condition.frequency_type = FrequencyType::Cron;
            a.trigger_condition.cron = "0 9 * * 1-5".into();
            assert_eq!(
                source_alert_edit_breakage(&a, 300),
                Some(E::AlertSliSourceIsCron)
            );
        }

        /// §5.4: silence engages after a firing, so the unmeasured holes land
        /// inside bad periods — biased uptime with no freeze and no signal.
        #[test]
        fn raising_silence_from_zero_breaks_the_source() {
            let mut a = eligible();
            a.trigger_condition.silence = 10;
            assert_eq!(
                source_alert_edit_breakage(&a, 300),
                Some(E::AlertSliSourceSilenceGated {
                    silence_minutes: 10
                })
            );
        }

        /// The second half of §5.4's lifecycle note, and the subtler one: the
        /// silence never moved. Removing the warning threshold is what flips
        /// the alert from "evaluates through silence, suppresses delivery" to
        /// "goes dark for the whole window".
        #[test]
        fn removing_the_warning_threshold_from_a_silenced_source_breaks_it() {
            let before = silenced_with_warning();
            assert_eq!(
                source_alert_edit_breakage(&before, 300),
                None,
                "a warning threshold keeps a silence-carrying alert eligible"
            );
            let mut after = before;
            after.trigger_condition.warning_threshold = None;
            assert_eq!(
                source_alert_edit_breakage(&after, 300),
                Some(E::AlertSliSourceSilenceGated {
                    silence_minutes: 10
                })
            );
        }

        /// The common case: an edit that touches none of the invariants must
        /// go through untouched. A guard that refuses renames is a guard
        /// nobody can live with.
        #[test]
        fn an_edit_that_breaks_nothing_passes_cleanly() {
            let mut a = eligible();
            a.name = "checkout latency (p99)".into();
            a.description = "now with a runbook link".into();
            a.destinations = vec!["pagerduty".into()];
            a.query_condition.sql = Some("SELECT count(*) FROM requests WHERE status = 503".into());
            a.trigger_condition.threshold = 7;
            assert_eq!(source_alert_edit_breakage(&a, 300), None);
        }

        /// Each SLO is judged against its OWN slice: a 300s SLO tolerates a
        /// cadence a 60s SLO cannot. One shared verdict would refuse edits
        /// that are perfectly legal for the SLO actually reading them.
        #[test]
        fn the_cadence_rule_is_measured_against_each_slos_own_slice() {
            let mut a = eligible();
            a.trigger_condition.frequency = 300;
            assert_eq!(source_alert_edit_breakage(&a, 300), None);
            assert_eq!(
                source_alert_edit_breakage(&a, 60),
                Some(E::AlertSliSourceTooInfrequent {
                    frequency_secs: 300,
                    slice_interval_secs: 60,
                })
            );
        }

        /// The guard must be the SAME rule set the picker and save-time
        /// validation run, or an alert the form refuses to pick becomes one
        /// the API happily edits into a live source.
        #[test]
        fn the_edit_guard_is_the_shared_rule_function() {
            let mut a = eligible();
            a.is_real_time = true;
            assert_eq!(
                source_alert_edit_breakage(&a, 300),
                source_alert_ineligibility(&source_alert_facts(&a), 300),
            );
        }

        // ---- the SLI-type gate ---------------------------------------------

        /// Every alert-only lifecycle rule asks here first. Leaking the
        /// backfill floor onto a count SLO would clamp a window that has no
        /// source alert to clamp against — and cut its history for nothing.
        #[test]
        fn only_an_alert_sli_has_a_source_alert() {
            use config::meta::slo::{CountSource, SliConfig};

            let mut slo = alert_slo();
            assert_eq!(source_alert_id(&slo), Some("alert-9"));

            slo.definition.sli_config = SliConfig::Count {
                source: CountSource::SingleQuery {
                    stream: "requests".into(),
                    stream_type: "logs".into(),
                    scope: None,
                    good_expr: "status < 500".into(),
                },
            };
            assert_eq!(source_alert_id(&slo), None);

            slo.definition.sli_config = SliConfig::TimeSlice {
                stream: "requests".into(),
                stream_type: "logs".into(),
                query_language: config::meta::slo::QueryLanguage::Sql,
                query: "SELECT p95(duration_ms) AS zo_slo_value".into(),
                scope: None,
                comparator: Operator::LessThan,
                threshold: 500.0,
                absent_is_bad: false,
            };
            assert_eq!(source_alert_id(&slo), None);
        }

        // ---- the backfill floor --------------------------------------------

        const DAY: i64 = 86_400;

        /// A count or time-slice SLO measures its whole window — the clamp is
        /// an alert-SLI rule and must not touch anything else.
        #[test]
        fn a_non_alert_sli_keeps_its_whole_window() {
            assert_eq!(SourceFloor::WholeWindow.clamp_start(0, 30 * DAY, 300), 0);
        }

        #[test]
        fn known_bounds_clamp_to_the_later_of_the_two() {
            let floor = SourceFloor::Bounds {
                ledger_start_secs: Some(10 * DAY),
                last_edit_secs: Some(25 * DAY),
            };
            assert_eq!(floor.clamp_start(0, 30 * DAY, 300), 25 * DAY);
        }

        /// Fails CLOSED. The queued range is written once per generation and
        /// never revisited, so widening it on a failed read would permanently
        /// measure history whose provenance nothing could check — exactly what
        /// the clamp exists to prevent.
        #[test]
        fn an_unreadable_source_measures_nothing_rather_than_everything() {
            assert_eq!(
                SourceFloor::Unreadable.clamp_start(0, 30 * DAY, 300),
                30 * DAY,
                "an unreadable source must not widen the range to the whole window"
            );
        }

        // ---- what "good" means (D59) ---------------------------------------

        /// The SLI is `level == Ok`, so anything that would make the same data
        /// produce a different level redefines the SLO's slices.
        #[test]
        fn a_condition_edit_redefines_what_good_means() {
            let before = eligible();
            for after in [
                {
                    let mut a = before.clone();
                    a.query_condition.sql = Some("SELECT count(*) FROM requests".into());
                    a
                },
                {
                    let mut a = before.clone();
                    a.query_condition.query_type = QueryType::Custom;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.threshold = 9;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.operator = Operator::LessThan;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.period = 30;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.warning_threshold = Some(1);
                    a
                },
            ] {
                assert!(
                    source_alert_condition_changed(&before, &after),
                    "an edit to the verdict must bump the generation"
                );
            }
        }

        /// Cadence and delivery change WHEN a human hears about the alert,
        /// never whether the alert thought the world was good. Bumping on
        /// these would throw away up to 90 days of measurement for nothing.
        #[test]
        fn cadence_and_delivery_edits_leave_the_definition_alone() {
            let before = eligible();
            assert!(
                !source_alert_condition_changed(&before, &before.clone()),
                "an untouched alert is not a redefinition"
            );
            for after in [
                {
                    let mut a = before.clone();
                    a.trigger_condition.frequency = 300;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.frequency_type = FrequencyType::Cron;
                    a.trigger_condition.cron = "*/5 * * * *".into();
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.silence = 10;
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.notify_on_warning = Some(false);
                    a
                },
                {
                    let mut a = before.clone();
                    a.trigger_condition.timezone = Some("Asia/Kolkata".into());
                    a
                },
                {
                    let mut a = before.clone();
                    a.name = "renamed".into();
                    a.description = "a new note".into();
                    a.destinations = vec!["slack".into()];
                    a.owner = Some("bob".into());
                    a.enabled = !before.enabled;
                    a.tags = vec!["team:payments".into()];
                    a
                },
            ] {
                assert!(
                    !source_alert_condition_changed(&before, &after),
                    "a cadence/delivery/metadata edit must not discard the window"
                );
            }
        }
    }

    // ---- the preview fold (PR 3) -------------------------------------------

    mod preview {
        use config::meta::{
            alerts::level::AlertLevel,
            slo::alert_uptime::{EvalInterval, UptimeGrid},
        };

        use super::*;

        const MICROS: i64 = 1_000_000;

        /// A 1-hour range on 5-minute slices: 12 slices, a 60s cadence.
        fn grid() -> UptimeGrid {
            UptimeGrid {
                range_start_secs: 0,
                range_end_secs: 3_600,
                slice_interval_secs: 300,
                min_coverage: 0.9,
            }
        }

        fn interval(level: AlertLevel, from_secs: i64, to_secs: i64) -> EvalInterval {
            EvalInterval {
                level: Some(level),
                frequency_secs: 60,
                from_us: from_secs * MICROS,
                to_us: to_secs * MICROS,
            }
        }

        #[test]
        fn a_fully_covered_ok_run_reads_as_a_perfect_sli() {
            let intervals = [interval(AlertLevel::Ok, 0, 3_600)];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.alert_id, "a1");
            // The ribbon is drawn against these bounds, so the response has to
            // carry the range it measured — intervals alone cannot place a
            // band, and a gap at either edge would be invisible.
            assert_eq!(p.range_start_secs, 0);
            assert_eq!(p.range_end_secs, 3_600);
            assert_eq!(p.slice_interval_secs, 300);
            assert_eq!(p.sli, Some(100.0));
            assert_eq!(p.expected_slices, 12);
            assert_eq!(p.observed_slices, 12);
            assert!((p.coverage - 1.0).abs() < 1e-9);
            assert!((p.total_secs - 3_600.0).abs() < 1e-6);
            assert!((p.good_secs - 3_600.0).abs() < 1e-6);
        }

        /// Half OK, half firing: the SLI is over measured time, and coverage
        /// is untouched — a bad alert is still a measured one.
        #[test]
        fn firing_time_is_bad_but_still_measured() {
            let intervals = [
                interval(AlertLevel::Ok, 0, 1_800),
                interval(AlertLevel::Critical, 1_800, 3_600),
            ];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.sli, Some(50.0));
            assert_eq!(p.observed_slices, 12);
        }

        /// A pause drops out of numerator AND denominator (D34): the SLI still
        /// reads 100% over what was measured, but coverage falls — which is
        /// what the ribbon's grey bands and the freeze rule are built on.
        #[test]
        fn a_pause_lowers_coverage_without_moving_the_sli() {
            // Measured 0..1800, nothing after.
            let intervals = [interval(AlertLevel::Ok, 0, 1_800)];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.sli, Some(100.0));
            assert_eq!(p.expected_slices, 12);
            // 1800s measured plus one 60s tail: six whole slices, and the
            // seventh is 60-of-300 — under §5.5's floor, so it is a gap too.
            assert_eq!(p.observed_slices, 6, "a pause must lower coverage");
            assert!((p.coverage - 0.5).abs() < 1e-9);
            assert!((p.total_secs - 1_800.0).abs() < 1e-6);
            // The SLI beside it is honest over measured time, but the SLO this
            // preview describes would report no data at all — and the floor is
            // server-side config the form cannot see, so the verdict travels
            // with the answer or the form shows a promise it cannot keep.
            assert!(p.would_freeze, "50% coverage is under the 0.9 floor");
        }

        #[test]
        fn a_fully_covered_preview_would_not_freeze() {
            let intervals = [interval(AlertLevel::Ok, 0, 3_600)];
            assert!(!alert_sli_preview_of("a1", &intervals, grid()).would_freeze);
        }

        /// Nothing measured is the most frozen state there is; it must not read
        /// as "fine, just no number yet".
        #[test]
        fn an_empty_ledger_would_freeze() {
            assert!(alert_sli_preview_of("a1", &[], grid()).would_freeze);
        }

        /// §5.3's forward extension, with a tail wide enough to change the
        /// answer: an evaluation is an assessment that stands until the next
        /// one is due, so the last run's cadence buys a whole extra slice.
        /// Dropping the extension reads 5 slices and 1500s here.
        #[test]
        fn each_run_covers_forward_by_its_own_cadence() {
            let intervals = [EvalInterval {
                level: Some(AlertLevel::Ok),
                frequency_secs: 300,
                from_us: 0,
                to_us: 1_500 * MICROS,
            }];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.observed_slices, 6);
            assert!((p.total_secs - 1_800.0).abs() < 1e-6);
        }

        /// Clamp 1: the tail must not claim time that has not happened yet, or
        /// the newest slice reads covered before it was measured. Without the
        /// clamp this emits a 13th slice past the range end.
        #[test]
        fn the_tail_never_reaches_past_the_range_end() {
            let intervals = [EvalInterval {
                level: Some(AlertLevel::Ok),
                frequency_secs: 300,
                from_us: 0,
                to_us: 3_600 * MICROS,
            }];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.observed_slices, 12);
            assert_eq!(p.expected_slices, 12);
            assert!((p.total_secs - 3_600.0).abs() < 1e-6);
        }

        /// §5.2: `NoData` is "could not tell", a gap rather than downtime.
        #[test]
        fn a_no_data_interval_is_unmeasured_rather_than_bad() {
            let intervals = [
                interval(AlertLevel::Ok, 0, 1_800),
                interval(AlertLevel::NoData, 1_800, 3_600),
            ];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.sli, Some(100.0), "NoData must not read as downtime");
            assert_eq!(p.observed_slices, 6, "NoData must not read as coverage");
        }

        /// Nothing has been measured yet: no SLI at all, rather than 0% —
        /// which a brand-new source would otherwise render as total downtime.
        #[test]
        fn an_empty_ledger_has_no_sli() {
            let p = alert_sli_preview_of("a1", &[], grid());
            assert_eq!(p.sli, None);
            assert_eq!(p.observed_slices, 0);
            assert_eq!(p.coverage, 0.0);
            assert!(p.intervals.is_empty());
            assert_eq!(p.expected_slices, 12);
        }

        /// The ribbon is drawn from the intervals, so they travel through
        /// untouched — ordered, with their level and their own cadence.
        #[test]
        fn the_intervals_travel_through_for_the_ribbon() {
            let intervals = [
                interval(AlertLevel::Ok, 0, 600),
                interval(AlertLevel::Warning, 1_200, 1_800),
            ];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.intervals.len(), 2);
            assert_eq!(p.intervals[0].level.as_deref(), Some("ok"));
            assert_eq!(p.intervals[0].from_us, 0);
            assert_eq!(p.intervals[0].to_us, 600 * MICROS);
            assert_eq!(p.intervals[0].frequency_secs, 60);
            assert_eq!(p.intervals[1].level.as_deref(), Some("warning"));
            assert_eq!(p.intervals[1].from_us, 1_200 * MICROS);
        }

        /// A level this build cannot interpret must not read as `Ok`, and the
        /// ribbon must not colour it green either.
        #[test]
        fn an_unknown_level_is_reported_as_unknown() {
            let intervals = [EvalInterval {
                level: None,
                frequency_secs: 60,
                from_us: 0,
                to_us: 3_600 * MICROS,
            }];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.intervals[0].level, None);
            assert_eq!(p.sli, None);
            assert_eq!(p.observed_slices, 0);
        }

        /// Same reason as the picker row: the ribbon reads these names off the
        /// wire, and the level is the band's colour.
        #[test]
        fn a_preview_serializes_under_the_names_the_ribbon_reads() {
            let intervals = [interval(AlertLevel::Warning, 0, 600)];
            let json =
                serde_json::to_value(alert_sli_preview_of("a1", &intervals, grid())).unwrap();
            for field in [
                "alert_id",
                "range_start_secs",
                "range_end_secs",
                "slice_interval_secs",
                "intervals",
                "sli",
                "good_secs",
                "total_secs",
                "observed_slices",
                "expected_slices",
                "coverage",
                "would_freeze",
            ] {
                assert!(
                    json.get(field).is_some(),
                    "{field} is missing from the wire"
                );
            }
            let row = &json.get("intervals").unwrap()[0];
            assert_eq!(row.get("level").unwrap(), "warning");
            assert_eq!(row.get("frequency_secs").unwrap(), 60);
            assert_eq!(row.get("from_us").unwrap(), 0);
            assert_eq!(row.get("to_us").unwrap(), 600 * MICROS);
        }

        // ---- the grid the preview measures over ----------------------------

        /// The range ends on the last COMPLETED slice, not on `now`: a
        /// half-elapsed slice would read as a gap and drag the preview's
        /// coverage down for no reason.
        #[test]
        fn the_preview_grid_ends_on_a_slice_boundary() {
            let g = preview_grid(config::meta::slo::WINDOW_7D_SECS, 300, 1_000_000 + 137, 0.9)
                .expect("7d/300s is a supported shape");
            assert_eq!(g.range_end_secs % 300, 0);
            assert_eq!(g.range_end_secs, 999_900);
            assert_eq!(
                g.range_start_secs,
                999_900 - config::meta::slo::WINDOW_7D_SECS
            );
            assert_eq!(g.slice_interval_secs, 300);
            assert_eq!(g.min_coverage, 0.9);
        }

        /// The preview must not invent a grid the SLO model cannot store —
        /// otherwise it would show numbers no saved SLO could reproduce.
        #[test]
        fn an_unsupported_shape_has_no_grid() {
            assert!(preview_grid(3_600, 300, 1_000_000, 0.9).is_none());
            assert!(preview_grid(config::meta::slo::WINDOW_7D_SECS, 120, 1_000_000, 0.9).is_none());
        }

        #[test]
        fn every_supported_shape_has_a_grid() {
            for window in [
                config::meta::slo::WINDOW_7D_SECS,
                config::meta::slo::WINDOW_30D_SECS,
                config::meta::slo::WINDOW_90D_SECS,
            ] {
                for slice in [
                    config::meta::slo::SLICE_60_SECS,
                    config::meta::slo::SLICE_300_SECS,
                ] {
                    assert!(
                        preview_grid(window, slice, 1_000_000, 0.9).is_some(),
                        "{window}/{slice} should be previewable"
                    );
                }
            }
        }

        /// The preview must agree with the pass it is previewing: §5.5's
        /// thin-slice rule is applied by the same fold, so a boundary slice
        /// below the floor is a gap here too.
        #[test]
        fn the_preview_applies_the_same_thin_slice_rule_as_the_pass() {
            // 60 measured seconds inside a 300s slice is 20% — under 0.9.
            let intervals = [EvalInterval {
                level: Some(AlertLevel::Ok),
                frequency_secs: 1,
                from_us: 0,
                to_us: 59 * MICROS,
            }];
            let p = alert_sli_preview_of("a1", &intervals, grid());
            assert_eq!(p.observed_slices, 0, "a thin slice is a gap (§5.5)");
            assert_eq!(p.sli, None);
        }
    }

    // ---- which freeze door the SLO went through (§2, PR 3) ------------------

    mod freeze_mechanism {
        use config::meta::slo::{SliConfig, SloDefinition, WINDOW_30D_SECS};
        use infra::table::entity::slo_status::Model as StatusRow;

        use super::*;

        fn alert_slo() -> Slo {
            Slo {
                id: "slo-1".into(),
                org: "myorg".into(),
                folder_id: "default".into(),
                name: "checkout alert uptime".into(),
                description: String::new(),
                definition: SloDefinition {
                    sli_config: SliConfig::Alert {
                        alert_id: "alert-1".into(),
                    },
                    group_by: None,
                    window_secs: WINDOW_30D_SECS,
                    slice_interval_secs: 300,
                },
                target: 99.9,
                tags: Vec::new(),
                enabled: true,
                owner: None,
                definition_generation: 1,
                groups_estimate: None,
                groups_reserved: 1,
            }
        }

        /// A fully covered rollup row — the state a paused source leaves
        /// behind, because the window stays pinned where it was.
        fn covered_row(watermark_end: Option<i64>) -> StatusRow {
            let expected = config::meta::slo::window::expected_slices(0, WINDOW_30D_SECS, 300);
            StatusRow {
                slo_id: "slo-1".into(),
                group_key: String::new(),
                definition_generation: 1,
                good: Some(1_000.0),
                total: Some(1_000.0),
                covered_slices: Some(expected as i32),
                coverage: Some(1.0),
                burn_windows: None,
                trailing_slices: None,
                watermark_end,
                groups_observed: None,
                groups_observed_is_lower_bound: None,
                active_set: None,
                group_roster: None,
                group_labels: None,
                computed_at: Some(1_000_000),
            }
        }

        /// The §2 case the coverage-percentage copy gets wrong: the source is
        /// paused, every pass emits zero slices, the watermark stops advancing
        /// — and measured coverage of the pinned window stays at 100%. So
        /// `no_data` alone cannot see this freeze, and the banner would say
        /// nothing at all.
        #[test]
        fn a_stalled_watermark_is_reported_even_though_coverage_is_full() {
            let slo = alert_slo();
            // K=3 at 300s slices = 900s of tolerance; this is 4100s past it.
            let row = covered_row(Some(100_000));
            let view = view_of(&slo, &row, 0.9, 105_000, 3);
            assert!(
                !view.no_data,
                "coverage is full, so the floor is not tripped"
            );
            assert!(view.stale_watermark, "the freeze is StaleWatermark (§2)");
            assert_eq!(view.watermark_end, Some(100_000));
        }

        #[test]
        fn a_moving_watermark_is_not_a_freeze() {
            let slo = alert_slo();
            let row = covered_row(Some(100_000));
            let view = view_of(&slo, &row, 0.9, 100_600, 3);
            assert!(!view.stale_watermark);
            assert!(!view.no_data);
        }

        /// Nothing measured under this generation at all: stale in the only
        /// sense that matters.
        #[test]
        fn an_absent_watermark_reads_as_stale() {
            let slo = alert_slo();
            let view = view_of(&slo, &covered_row(None), 0.9, 105_000, 3);
            assert!(view.stale_watermark);
            assert_eq!(view.watermark_end, None);
        }

        /// The other §2 door, unchanged: holes big enough to drop coverage
        /// under the floor freeze via `BelowCoverageFloor`, and that is the
        /// case the coverage-percentage copy describes.
        #[test]
        fn thin_coverage_still_reads_as_no_data() {
            let slo = alert_slo();
            let mut row = covered_row(Some(100_000));
            row.covered_slices = Some(1);
            let view = view_of(&slo, &row, 0.9, 100_600, 3);
            assert!(view.no_data);
            assert!(!view.stale_watermark);
        }

        /// The watermark lives only on the rollup row, so a group row has none
        /// — and "absent" must not be read as "stalled" there, or every group
        /// of every healthy SLO reports a freeze.
        #[test]
        fn a_group_row_makes_no_staleness_claim() {
            let slo = alert_slo();
            let mut row = covered_row(None);
            row.group_key = "region=eu".into();
            let view = view_of(&slo, &row, 0.9, 105_000, 3);
            assert!(!view.stale_watermark);
            assert_eq!(view.watermark_end, None);
        }

        /// Both doors can be open at once — a source that paused long enough
        /// for the hole to reach the window. The two flags are independent, so
        /// the banner can apply `observe`'s precedence and name the stall.
        #[test]
        fn both_freeze_doors_can_be_open_at_once() {
            let slo = alert_slo();
            let mut row = covered_row(Some(100_000));
            row.covered_slices = Some(1);
            let view = view_of(&slo, &row, 0.9, 105_000, 3);
            assert!(view.no_data);
            assert!(view.stale_watermark);
        }
    }

    /// A malformed id cannot be deleted and must not silently abort the
    /// cascade of its siblings — it is skipped, and the caller logs it.
    #[test]
    fn an_unparseable_alert_id_is_skipped_rather_than_aborting_the_cascade() {
        use svix_ksuid::KsuidLike as _;
        let dependents = vec![
            ("not-a-ksuid".to_string(), "broken".to_string()),
            (
                svix_ksuid::Ksuid::new(None, None).to_string(),
                "fine".to_string(),
            ),
        ];
        let plan = plan_alert_cascade(&dependents);
        assert_eq!(plan.len(), 1, "the good alert must still be deleted");
        assert_eq!(plan[0].1, "fine");
    }
}
