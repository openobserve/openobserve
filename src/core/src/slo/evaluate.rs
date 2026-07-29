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
            classify_error_budget,
        },
        coverage::{Observation, UnobservedReason, WindowRead, observe},
        window::{expected_slices, watermark_is_stale},
    },
};
use infra::table::{slo as slo_table, slos as slos_table};

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
    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("database not initialized"))?;

    let Some(slo) = slos_table::get(db, org, &cond.slo_id).await? else {
        anyhow::bail!("SLO {} not found", cond.slo_id);
    };

    // A grouped SLO with `multi_alert` fans out one result per group; anything
    // else evaluates the rollup only.
    let rows = if cond.multi_alert && slo.is_grouped() {
        slo_table::load_all_groups(db, &slo.id)
            .await?
            .into_iter()
            .filter(|r| !r.group_key.is_empty())
            .collect()
    } else {
        match slo_table::load_status(db, &slo.id, "").await? {
            Some(r) => vec![r],
            None => Vec::new(),
        }
    };

    if rows.is_empty() {
        // Nothing measured yet. Deliberately frozen rather than Ok: a brand
        // new SLO has not observed a healthy window, it has observed nothing.
        return Ok(vec![SloEvalResult {
            classification: SloClassification::Frozen(UnobservedReason::BelowCoverageFloor),
            actual_value: None,
            group_key: None,
            sli: None,
            coverage: 0.0,
            slo_name: slo.name.clone(),
            slo_target: slo.target,
            slo_window_secs: slo.definition.window_secs,
            error_budget_remaining: None,
        }]);
    }

    let mut out = Vec::new();
    for row in rows {
        // A status row from a superseded generation describes a definition
        // that no longer exists. Treated as unobserved, not as a measurement.
        if row.definition_generation != slo.definition_generation {
            out.push(frozen(
                UnobservedReason::StaleWatermark,
                &row.group_key,
                &slo,
            ));
            continue;
        }
        out.push(evaluate_row(&slo, cond, &row, now_secs));
    }
    Ok(out)
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
    // no current data to classify against.
    let stale = match row.watermark_end {
        Some(watermark) => watermark_is_stale(
            now_secs,
            watermark,
            slo.definition.slice_interval_secs,
            cfg.slo.recompute_slices.max(1),
        ),
        None => true,
    };

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
            SloEvalResult {
                // The LONG window's burn is the reported figure: it is the one
                // the threshold is calibrated against, and the short window
                // exists to suppress spikes rather than to be reported.
                actual_value: long
                    .sli()
                    .map(|s| config::meta::slo::math::burn_rate(s, slo.target)),
                sli: long.sli(),
                coverage: 0.0,
                error_budget_remaining: long
                    .sli()
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
}
