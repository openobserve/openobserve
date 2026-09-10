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

//! Evaluating an SLO alert (`alerts_2.md` §6b.3, §6b.4c).
//!
//! An SLO alert runs **no query**. It reads the running aggregate that the
//! ingest pass already computed, which is why five alerts on one SLO cost five
//! cheap status reads and zero extra raw-data scans (§6b.9) — decoupling the
//! alert's cadence from the measurement's is the whole point of the split.
//!
//! The classification itself lives in `config::meta::slo::condition` and is
//! already exhaustively tested. What this module owns is the part that needs
//! the database: turning stored status into an [`Observation`], which is where
//! the freeze decision is actually made.
//!
//! **Frozen is not a level.** When a window cannot be observed the caller must
//! leave `level`, `level_since` and `level_at` untouched — the level rots, it
//! does not reset. Returning `Ok` there would turn a measurement outage into a
//! recovery for every burn-rate alert in the org, which is the catastrophic
//! bug this feature exists to avoid (D34).

use config::{
    get_config,
    meta::slo::{
        Slo,
        condition::{
            SloAlertKind, SloClassification, SloCondition, classify_burn_rate,
            classify_error_budget, governing_burn_rate,
        },
        coverage::{Observation, UnobservedReason, WindowRead, observe},
        window::{expected_slices, watermark_is_stale_or_absent},
    },
};
use infra::{
    db::get_orm_client_ro,
    table::{slo as slo_table, slos as slos_table},
};

/// Everything one SLO-alert evaluation produced.
#[derive(Debug, Clone)]
pub struct SloEvalResult {
    pub classification: SloClassification,
    /// The number that was compared — burn rate, or budget consumed.
    /// `None` when frozen: there is no observed value to report.
    pub actual_value: Option<f64>,
    /// Present for a grouped (multi) SLO alert.
    pub group_key: Option<String>,
    pub sli: Option<f64>,
    pub coverage: f64,
    /// Carried so the notification template can name the SLO rather than only
    /// its id — `{slo_name}` is what a human reads in a page at 3am.
    pub slo_name: String,
    pub slo_target: f64,
    pub slo_window_secs: i64,
    /// Percentage remaining, signed. `None` when frozen.
    pub error_budget_remaining: Option<f64>,
}

/// Evaluate one SLO alert against the current status.
pub async fn evaluate(
    cond: &SloCondition,
    org: &str,
    now_secs: i64,
) -> Result<Vec<SloEvalResult>, anyhow::Error> {
    // Per-group fan-out (SA-13) is not implemented, and half-supporting it is
    // a trap rather than a degraded mode: the watermark lives only on the
    // ROLLUP row (`apply_status_in_txn`), so every group row reads as
    // stale-watermark and freezes — a `multi_alert` alert would sit silently
    // frozen forever. Rejected loudly until genuine per-group state and
    // dispatch exist (`multi_alert_enabled` documents the same decision).
    // First, before the database: the deferral is a fact about the condition,
    // not about this environment's data.
    if cond.multi_alert {
        anyhow::bail!(
            "multi_alert is not yet supported for SLO alerts; evaluate the rollup instead"
        );
    }

    let db = get_orm_client_ro().await;

    let Some(slo) = slos_table::get(db, org, &cond.slo_id).await? else {
        anyhow::bail!("SLO {} not found", cond.slo_id);
    };

    // The rollup row only. When per-group fan-out lands it goes here, gated
    // on group rows carrying their own watermarks.
    let rows = match slo_table::load_status(db, &slo.id, "").await? {
        Some(r) => vec![r],
        None => Vec::new(),
    };

    Ok(evaluate_rows(&slo, cond, &rows, now_secs))
}

/// Map status rows to evaluation results — the generation fence, the
/// empty-placeholder rule, and the per-row dispatch.
///
/// Pure and synchronous, split from [`evaluate`] so the D59 fence is testable
/// without a database: while it lived inline in the async fn, no test could
/// observe a superseded row being (wrongly) evaluated.
fn evaluate_rows(
    slo: &Slo,
    cond: &SloCondition,
    rows: &[infra::table::entity::slo_status::Model],
    now_secs: i64,
) -> Vec<SloEvalResult> {
    if rows.is_empty() {
        // Nothing measured yet. Deliberately frozen rather than Ok: a brand
        // new SLO has not observed a healthy window, it has observed nothing.
        return vec![frozen(UnobservedReason::BelowCoverageFloor, "", slo)];
    }

    rows.iter()
        .map(|row| {
            // A status row from a superseded generation describes a definition
            // that no longer exists. Treated as unobserved, not a measurement
            // (D59).
            if row.definition_generation != slo.definition_generation {
                frozen(UnobservedReason::StaleWatermark, &row.group_key, slo)
            } else {
                evaluate_row(slo, cond, row, now_secs)
            }
        })
        .collect()
}

fn frozen(reason: UnobservedReason, group_key: &str, slo: &Slo) -> SloEvalResult {
    SloEvalResult {
        classification: SloClassification::Frozen(reason),
        actual_value: None,
        group_key: (!group_key.is_empty()).then(|| group_key.to_string()),
        sli: None,
        coverage: 0.0,
        slo_name: slo.name.clone(),
        slo_target: slo.target,
        slo_window_secs: slo.definition.window_secs,
        error_budget_remaining: None,
    }
}

fn evaluate_row(
    slo: &Slo,
    cond: &SloCondition,
    row: &infra::table::entity::slo_status::Model,
    now_secs: i64,
) -> SloEvalResult {
    let cfg = get_config();
    let floor = cfg.slo.min_coverage;

    // No watermark at all means nothing has been measured under this
    // generation, which is stale in the only sense that matters here: there is
    // no current data to classify against. Shared with the read-time status
    // view, so what freezes the alerts is the same thing the UI reports.
    let stale = watermark_is_stale_or_absent(
        now_secs,
        row.watermark_end,
        slo.definition.slice_interval_secs,
        cfg.slo.recompute_slices.max(1),
    );

    let group_key = (!row.group_key.is_empty()).then(|| row.group_key.clone());

    match cond.kind {
        SloAlertKind::ErrorBudget => {
            let read = WindowRead {
                good: row.good.unwrap_or(0.0),
                total: row.total.unwrap_or(0.0),
                observed_slices: row.covered_slices.unwrap_or(0) as i64,
                expected_slices: expected_slices(
                    0,
                    slo.definition.window_secs,
                    slo.definition.slice_interval_secs,
                ),
            };
            let obs = observe(read, floor, stale);
            let classification = classify_error_budget(obs, slo.target, cond);
            SloEvalResult {
                actual_value: obs
                    .sli()
                    .map(|s| config::meta::slo::math::error_budget_consumed(s, slo.target)),
                sli: obs.sli(),
                coverage: config::meta::slo::coverage::coverage(
                    read.observed_slices,
                    read.expected_slices,
                ),
                error_budget_remaining: obs
                    .sli()
                    .map(|s| config::meta::slo::math::error_budget_remaining(s, slo.target)),
                slo_name: slo.name.clone(),
                slo_target: slo.target,
                slo_window_secs: slo.definition.window_secs,
                classification,
                group_key,
            }
        }
        SloAlertKind::BurnRate => {
            // The two windows come from `burn_windows`, precomputed once per
            // SLO per pass and shared by every alert on it (SA-19) — which is
            // why adding an alert costs nothing extra at ingest time.
            let (long, short) = burn_windows(row, cond, floor, stale);
            let classification = classify_burn_rate(long, short, slo.target, cond);
            // SA-11: report the window that actually GATED the alert.
            // Classification takes the LESS severe of the two windows, so the
            // governing burn is min(long, short) — equivalently the governing
            // SLI is max(long, short). ALL reported figures derive from that
            // one window, so `{burn_rate}`, `{sli}` and
            // `{error_budget_remaining}` can never contradict each other in a
            // notification. Reporting the long window alone can put a
            // Critical-sized value on a record whose level is Warning,
            // history contradicting the paging decision.
            let (governing_sli, governing_burn) = match (long.sli(), short.sli()) {
                (Some(l), Some(s)) => (
                    Some(l.max(s)),
                    Some(governing_burn_rate(
                        config::meta::slo::math::burn_rate(l, slo.target),
                        config::meta::slo::math::burn_rate(s, slo.target),
                    )),
                ),
                _ => (None, None),
            };
            SloEvalResult {
                actual_value: governing_burn,
                sli: governing_sli,
                coverage: 0.0,
                error_budget_remaining: governing_sli
                    .map(|s| config::meta::slo::math::error_budget_remaining(s, slo.target)),
                slo_name: slo.name.clone(),
                slo_target: slo.target,
                slo_window_secs: slo.definition.window_secs,
                classification,
                group_key,
            }
        }
    }
}

/// Read the precomputed `(long, short)` window pair for this condition.
///
/// A pair the ingest pass did not precompute is **unobserved**, not zero: the
/// alert was configured with windows the measurement side has not caught up
/// to, and treating a missing measurement as a healthy one is the failure this
/// whole module is shaped to prevent.
fn burn_windows(
    row: &infra::table::entity::slo_status::Model,
    cond: &SloCondition,
    floor: f64,
    stale: bool,
) -> (Observation, Observation) {
    let long_secs = cond.long_window_secs.unwrap_or(3600);
    let short_secs = cond.short_window_secs.unwrap_or(long_secs / 12);

    let read_pair = |secs: i64| -> Observation {
        let Some(windows) = row.burn_windows.as_ref() else {
            return Observation::Unobserved(UnobservedReason::BelowCoverageFloor);
        };
        let Some(entry) = windows.get(secs.to_string()) else {
            return Observation::Unobserved(UnobservedReason::BelowCoverageFloor);
        };
        let good = entry.get("good").and_then(|v| v.as_f64());
        let total = entry.get("total").and_then(|v| v.as_f64());
        let covered = entry.get("covered").and_then(|v| v.as_i64());
        let (Some(good), Some(total), Some(covered)) = (good, total, covered) else {
            return Observation::Unobserved(UnobservedReason::BelowCoverageFloor);
        };
        let expected = entry
            .get("expected")
            .and_then(|v| v.as_i64())
            .unwrap_or(covered.max(1));
        observe(
            WindowRead {
                good,
                total,
                observed_slices: covered,
                expected_slices: expected,
            },
            floor,
            stale,
        )
    };

    (read_pair(long_secs), read_pair(short_secs))
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::{Operator, level::AlertLevel};

    use super::*;

    fn cond(kind: SloAlertKind) -> SloCondition {
        SloCondition {
            slo_id: "slo1".into(),
            kind,
            operator: Operator::GreaterThan,
            critical: 14.4,
            warning: Some(6.0),
            long_window_secs: Some(3600),
            short_window_secs: Some(300),
            multi_alert: false,
        }
    }

    fn status(burn_windows: Option<serde_json::Value>) -> infra::table::entity::slo_status::Model {
        infra::table::entity::slo_status::Model {
            slo_id: "slo1".into(),
            group_key: String::new(),
            definition_generation: 1,
            good: Some(990.0),
            total: Some(1000.0),
            covered_slices: Some(43_200),
            coverage: Some(1.0),
            burn_windows,
            trailing_slices: None,
            watermark_end: Some(1_000_000),
            groups_observed: None,
            groups_observed_is_lower_bound: None,
            active_set: None,
            group_roster: None,
            group_labels: None,
            computed_at: Some(1_000_000),
        }
    }

    /// A pair the ingest pass never precomputed is unobserved, not zero.
    /// Treating a missing measurement as a healthy one is exactly the failure
    /// this module exists to prevent.
    #[test]
    fn a_missing_burn_window_freezes_rather_than_reading_as_healthy() {
        let (long, short) = burn_windows(&status(None), &cond(SloAlertKind::BurnRate), 0.9, false);
        assert!(!long.is_observed(), "a missing window read as observed");
        assert!(!short.is_observed());
    }

    #[test]
    fn a_partial_burn_window_entry_freezes() {
        // `total` missing — an entry that exists but cannot produce an SLI.
        let row = status(Some(serde_json::json!({ "3600": { "good": 1.0 } })));
        let (long, _) = burn_windows(&row, &cond(SloAlertKind::BurnRate), 0.9, false);
        assert!(!long.is_observed());
    }

    #[test]
    fn a_complete_burn_window_is_observed() {
        let row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 299.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        let (long, short) = burn_windows(&row, &cond(SloAlertKind::BurnRate), 0.9, false);
        assert!(long.is_observed());
        assert!(short.is_observed());
    }

    /// A stale watermark means the data is not current, so nothing about it is
    /// a measurement — whatever its coverage says.
    #[test]
    fn a_stale_watermark_freezes_a_fully_covered_window() {
        let row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
        })));
        let (long, _) = burn_windows(&row, &cond(SloAlertKind::BurnRate), 0.9, true);
        assert!(
            !long.is_observed(),
            "stale data was treated as a measurement"
        );
    }

    /// Under-covered windows must not produce a level at all — not even Ok.
    #[test]
    fn an_under_covered_window_freezes() {
        let row = status(Some(serde_json::json!({
            "3600": { "good": 10.0, "total": 10.0, "covered": 5, "expected": 60 },
        })));
        let (long, _) = burn_windows(&row, &cond(SloAlertKind::BurnRate), 0.9, false);
        assert!(!long.is_observed());
        let c = classify_burn_rate(long, long, 99.0, &cond(SloAlertKind::BurnRate));
        assert!(c.is_frozen());
        assert_eq!(c.level(), None, "a frozen classification produced a level");
    }

    /// The short window exists to suppress spikes, so a healthy short window
    /// holds the alert down even when the long window is breaching.
    #[test]
    fn a_healthy_short_window_suppresses_a_breaching_long_window() {
        let long = Observation::Observed { sli: 0.0 }; // burning maximally
        let short = Observation::Observed { sli: 100.0 }; // perfectly healthy
        let c = classify_burn_rate(long, short, 99.0, &cond(SloAlertKind::BurnRate));
        assert_eq!(c.level(), Some(AlertLevel::Ok));
    }

    #[test]
    fn both_windows_breaching_produces_critical() {
        let obs = Observation::Observed { sli: 0.0 };
        let c = classify_burn_rate(obs, obs, 99.0, &cond(SloAlertKind::BurnRate));
        assert_eq!(c.level(), Some(AlertLevel::Critical));
    }

    // ── the writer/reader contract (Gap 1) ──────────────────────────────────

    /// **The contract this whole feature turned on.** `burn_windows` had a
    /// reader, a column and a migration but no writer, so every burn-rate
    /// alert froze forever. This pins the two halves together: what
    /// `burn::burn_windows_json` WRITES must be what `burn_windows()` READS.
    /// A renamed field or a changed key shape on either side fails here rather
    /// than silently freezing production alerts.
    #[test]
    fn the_ingest_writers_burn_windows_are_readable_by_the_evaluator() {
        use config::meta::slo::burn;

        const SLICE: i64 = 300;
        const WM: i64 = 1_000_000;
        // A gap-free hour: 12 slices of 5 minutes, 99% good.
        let buf: burn::TrailingSlices = (1..=12).map(|i| (WM - i * SLICE, (99.0, 100.0))).collect();
        let written = burn::burn_windows_json(&buf, &[3600, 300], WM, SLICE);

        let mut row = status(Some(written));
        row.watermark_end = Some(WM);

        let c = SloCondition {
            long_window_secs: Some(3600),
            short_window_secs: Some(300),
            ..cond(SloAlertKind::BurnRate)
        };
        let (long, short) = burn_windows(&row, &c, 0.9, false);
        assert!(
            long.is_observed(),
            "the evaluator could not read the long window the ingest pass wrote"
        );
        assert!(short.is_observed(), "short window unreadable");
        // And the values survive the round trip: 99% good against a 99%
        // target is a burn rate of exactly 1.0.
        assert_eq!(long.sli(), Some(99.0));
        let r = evaluate_row(&slo(), &c, &row, WM);
        assert_eq!(r.actual_value, Some(1.0), "burn rate at exactly 1.0");
    }

    /// The negative half of the contract: a window the ingest pass did NOT
    /// precompute must still freeze. Proves the round-trip test above passes
    /// for the right reason rather than because everything reads as observed.
    #[test]
    fn a_window_the_writer_did_not_precompute_still_freezes() {
        use config::meta::slo::burn;

        const SLICE: i64 = 300;
        const WM: i64 = 1_000_000;
        let buf: burn::TrailingSlices = (1..=12).map(|i| (WM - i * SLICE, (99.0, 100.0))).collect();
        // Only the 1h window is written...
        let written = burn::burn_windows_json(&buf, &[3600], WM, SLICE);
        let mut row = status(Some(written));
        row.watermark_end = Some(WM);
        // ...but the alert asks for a 30m long window too.
        let c = SloCondition {
            long_window_secs: Some(1800),
            short_window_secs: Some(300),
            ..cond(SloAlertKind::BurnRate)
        };
        let (long, short) = burn_windows(&row, &c, 0.9, false);
        assert!(!long.is_observed(), "an unwritten window read as measured");
        assert!(!short.is_observed());
    }

    /// D59: a status row from a SUPERSEDED generation describes a definition
    /// that no longer exists — frozen, never evaluated. The row deliberately
    /// carries data that would classify as Observed if the fence were gone,
    /// so deleting the fence fails this test rather than passing vacuously.
    #[test]
    fn a_row_from_a_superseded_generation_is_frozen_not_evaluated() {
        let mut row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 299.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        row.definition_generation = 2; // slo() is generation 1
        row.group_key = "host=a".into();
        let out = evaluate_rows(&slo(), &cond(SloAlertKind::BurnRate), &[row], 1_000_000);
        assert_eq!(out.len(), 1);
        assert!(
            out[0].classification.is_frozen(),
            "a superseded row was evaluated as a measurement"
        );
        assert_eq!(out[0].actual_value, None);
        // The group identity survives the freeze, so a grouped UI can still
        // attribute the frozen entry.
        assert_eq!(out[0].group_key.as_deref(), Some("host=a"));
    }

    /// The same data under the CURRENT generation evaluates normally — the
    /// fence must not freeze everything.
    #[test]
    fn a_current_generation_row_is_evaluated() {
        let row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 299.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        let out = evaluate_rows(&slo(), &cond(SloAlertKind::BurnRate), &[row], 1_000_000);
        assert_eq!(out.len(), 1);
        assert!(!out[0].classification.is_frozen());
    }

    /// A brand-new SLO with no status rows has observed NOTHING — one frozen
    /// placeholder, never an empty result (an empty result would leave the
    /// caller with nothing to freeze on).
    #[test]
    fn no_rows_yields_a_single_frozen_placeholder() {
        let out = evaluate_rows(&slo(), &cond(SloAlertKind::ErrorBudget), &[], 1_000_000);
        assert_eq!(out.len(), 1);
        assert!(out[0].classification.is_frozen());
        assert_eq!(out[0].group_key, None);
        assert_eq!(
            out[0].slo_name, "test",
            "the placeholder still names the SLO"
        );
    }

    /// SA-14 wiring: `evaluate_row` must COMPUTE staleness from the row's
    /// watermark, not trust a caller. An old watermark freezes even a fully
    /// covered window. (Default config: K=3 recompute slices × 300s slice =
    /// 900s of tolerance; 10,000s past it is unambiguous.)
    #[test]
    fn evaluate_row_freezes_when_the_watermark_is_old() {
        let row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 299.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        // status() pins watermark_end = 1_000_000; evaluate far past it.
        let r = evaluate_row(
            &slo(),
            &cond(SloAlertKind::BurnRate),
            &row,
            1_000_000 + 10_000,
        );
        assert!(
            r.classification.is_frozen(),
            "an old watermark must freeze, not classify"
        );
        assert_eq!(r.actual_value, None);
    }

    /// No watermark at all means nothing was ever measured under this
    /// generation — stale in the only sense that matters.
    #[test]
    fn evaluate_row_freezes_when_there_is_no_watermark_at_all() {
        let mut row = status(Some(serde_json::json!({
            "3600": { "good": 990.0, "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 299.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        row.watermark_end = None;
        let r = evaluate_row(&slo(), &cond(SloAlertKind::BurnRate), &row, 1_000_000);
        assert!(r.classification.is_frozen());
    }

    /// The ErrorBudget arm's window wiring, end to end: sli = 100·good/total
    /// from the ROW's columns, budget figures derived from it. Pins the
    /// good/total orientation — swapping them inverts the SLI (a 99% error
    /// rate reads as 99% success), which no other test observed.
    #[test]
    fn an_error_budget_row_reads_good_over_total() {
        // status(): good 990, total 1000 → sli 99.0; slo(): target 99.0 →
        // consumed = 100 × (100−99)/(100−99) = 100.0, remaining 0.0.
        let r = evaluate_row(
            &slo(),
            &cond(SloAlertKind::ErrorBudget),
            &status(None),
            1_000_000,
        );
        assert_eq!(r.sli, Some(99.0), "sli is 100·good/total");
        assert_eq!(r.actual_value, Some(100.0), "budget consumed");
        assert_eq!(r.error_budget_remaining, Some(0.0));
    }

    /// Under-coverage freezes the ErrorBudget arm exactly as it does burn
    /// windows — the coverage denominator comes from the GRID, not the data.
    #[test]
    fn an_under_covered_error_budget_window_freezes() {
        let mut row = status(None);
        // slo(): 30d window at 300s slices = 8,640 expected; 100 is ~1%.
        row.covered_slices = Some(100);
        let r = evaluate_row(&slo(), &cond(SloAlertKind::ErrorBudget), &row, 1_000_000);
        assert!(r.classification.is_frozen());
        assert_eq!(r.actual_value, None);
    }

    /// The deferral must trip on the CONDITION alone — before the database,
    /// before the SLO is even fetched — so a misconfigured alert fails with
    /// the actionable message rather than whatever the environment's DB state
    /// happens to produce. (This test runs with no database at all.)
    #[tokio::test]
    async fn multi_alert_is_rejected_before_touching_the_database() {
        let c = SloCondition {
            multi_alert: true,
            ..cond(SloAlertKind::BurnRate)
        };
        let err = evaluate(&c, "org", 0).await.unwrap_err();
        assert!(
            err.to_string().contains("multi_alert"),
            "expected the multi_alert deferral, got: {err}"
        );
    }

    fn slo() -> Slo {
        Slo {
            id: "slo1".into(),
            org: "default".into(),
            folder_id: "default".into(),
            name: "test".into(),
            description: String::new(),
            definition: config::meta::slo::SloDefinition {
                sli_config: config::meta::slo::SliConfig::Count {
                    source: config::meta::slo::CountSource::SingleQuery {
                        stream: "logs".into(),
                        stream_type: "logs".into(),
                        scope: None,
                        good_expr: "1=1".into(),
                    },
                },
                group_by: None,
                window_secs: 30 * 86_400,
                slice_interval_secs: 300,
            },
            target: 99.0,
            tags: vec![],
            enabled: true,
            owner: None,
            definition_generation: 1,
            groups_estimate: None,
            groups_reserved: 1,
        }
    }

    /// SA-11: `actual_value` is the burn that GATED the alert — the less
    /// severe window, `min(long, short)`. Reporting the long window alone
    /// puts a Critical-sized value on a record whose level is Warning or Ok,
    /// history contradicting the paging decision.
    #[test]
    fn actual_value_is_the_governing_burn_not_the_long_window() {
        // Long window burning maximally (sli 0 → burn 100× at target 99);
        // short window perfectly healthy (sli 100 → burn 0). The healthy
        // short window suppresses the alert, so it must also own the record.
        let row = status(Some(serde_json::json!({
            "3600": { "good": 0.0,   "total": 1000.0, "covered": 60, "expected": 60 },
            "300":  { "good": 300.0, "total": 300.0,  "covered": 5,  "expected": 5  },
        })));
        let r = evaluate_row(&slo(), &cond(SloAlertKind::BurnRate), &row, 1_000_000);
        assert_eq!(
            r.classification.level(),
            Some(AlertLevel::Ok),
            "the healthy short window suppresses"
        );
        assert_eq!(
            r.actual_value,
            Some(0.0),
            "and the value recorded is the one that suppressed, not the long window's 100×"
        );
        // Every reported figure comes from the SAME (governing) window, so a
        // notification cannot show a burn rate that contradicts its SLI.
        assert_eq!(r.sli, Some(100.0), "sli follows the governing window");
        assert_eq!(
            r.error_budget_remaining,
            Some(100.0),
            "budget remaining follows the governing window"
        );
    }
}
