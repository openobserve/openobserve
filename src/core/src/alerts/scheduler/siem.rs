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

//! Scheduler glue for SIEM detections; the evaluation rules live in o2_enterprise.

use config::{
    meta::{
        alerts::{TriggerEvalResults, alert::Alert},
        triggers::ScheduledTriggerData,
    },
    utils::json,
};
use o2_enterprise::enterprise::{
    common::config::get_config as get_o2_config,
    security::{cases::EntityRole, detection, tuning},
};

use crate::alerts::alert::AlertExt;

/// One scheduled run of a SIEM detection.
pub(super) struct SiemRun {
    /// Threshold and correlation detections, evaluated per window and de-duplicated per group.
    grouped: bool,
    dedupe_keys: Vec<String>,
    plan: detection::WindowPlan,
    /// Memory as the run found it; retry paths re-evaluate the same window, so they put it back.
    prior: Option<json::Value>,
    pub(super) severity: Option<String>,
    /// A new detection's opted-in first look at history beyond its own window.
    pub(super) is_backfill: bool,
    /// An opted-in first run that records current matches as baseline instead of firing.
    learning: bool,
}

impl SiemRun {
    /// `None` for any alert that is not a SIEM detection, which keeps today's semantics.
    pub(super) fn for_alert(alert: &Alert, data: &ScheduledTriggerData) -> Option<Self> {
        let attrs = alert.context_attributes.as_ref();
        if !detection::is_siem(attrs) {
            return None;
        }
        let grouped = detection::is_grouped(attrs);
        let mut dedupe_keys = detection::group_by(attrs);
        // An ungrouped threshold is one group, so only its newest event tells two firings apart.
        if grouped && dedupe_keys.is_empty() {
            dedupe_keys.push(detection::LAST_SEEN_COLUMN.to_string());
        }
        let cfg = get_o2_config();
        let plan = detection::WindowPlan::new(
            attrs,
            alert.trigger_condition.period,
            alert.trigger_condition.frequency,
            cfg.siem_detection.lookback_secs,
            cfg.siem_detection.backfill_hours,
        );
        let prior = data.siem.clone();
        let state = detection::SiemTriggerState::from_value(prior.as_ref());
        let is_backfill = state.is_backfill(&plan);
        let learning = state.is_learning(attrs, &plan);
        Some(Self {
            grouped,
            dedupe_keys,
            plan,
            prior,
            severity: detection::sigma_level(attrs).map(str::to_string),
            is_backfill,
            learning,
        })
    }

    pub(super) fn window_start(&self, end_time: i64) -> i64 {
        detection::SiemTriggerState::from_value(self.prior.as_ref())
            .window_start(end_time, &self.plan)
    }

    /// One query per timespan-wide window, so a threshold never counts more than its timespan.
    pub(super) async fn evaluate(
        &self,
        alert: &Alert,
        start_time: i64,
        end_time: i64,
        trace_id: &str,
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        let windows = if !self.grouped {
            vec![(start_time, end_time)]
        } else {
            detection::grouped_windows(
                start_time,
                end_time,
                self.plan.width_us,
                self.plan.stride_us,
            )
        };
        let settings =
            db::organization::read_org_setting(&alert.org_id, |s| s.security_tuning.shared())
                .await
                .unwrap_or_default();
        let now = chrono::Utc::now().timestamp_micros();
        let alert_id = alert.get_unique_key();
        let exceptions = settings.active_exceptions(&alert_id, now);
        let tuned = excepted_alert(alert, &exceptions, &settings).await;
        let alert = tuned.as_ref().unwrap_or(alert);
        let mut merged: Option<TriggerEvalResults> = None;
        for (from, to) in windows {
            let window = alert
                .evaluate(None, (Some(from), to), Some(trace_id.to_string()))
                .await?;
            merged = Some(match merged {
                Some(newer) => detection::merge_window_results(newer, window),
                None => window,
            });
        }
        let mut results = merged.unwrap_or_default();
        let role = EntityRole::of_attributes(alert.context_attributes.as_ref());
        let group_by = detection::group_by(alert.context_attributes.as_ref());
        // Rows are checked too: a missing schema or unparsable SQL runs the detection unguarded.
        let dropped = tuning::drop_rows(&mut results, |row| {
            tuning::row_excepted(row, &exceptions, &settings.lists)
                || settings.suppressed(&alert_id, &tuning::row_entities(row, role, &group_by), now)
        });
        if dropped > 0 {
            log::debug!(
                "[SIEM] detection {}/{} dropped {dropped} rows by exception or suppression",
                alert.org_id,
                alert.name
            );
        }
        Ok(results)
    }

    /// Drops rows already alerted on and records this run's memory in `data`.
    pub(super) fn dedupe(
        &self,
        results: &mut TriggerEvalResults,
        data: &mut ScheduledTriggerData,
        start_time: i64,
        end_time: i64,
    ) {
        let mut state = detection::SiemTriggerState::from_value(self.prior.as_ref());
        state.dedupe_results(
            results,
            &self.dedupe_keys,
            start_time,
            end_time,
            get_o2_config().siem_detection.dedup_max_rows,
        );
        if self.learning {
            let matches = state.learn_baseline(results, end_time);
            log::info!("[SIEM] learning first run recorded {matches} matches as baseline");
        }
        state.covered_until = Some(end_time);
        data.siem = Some(state.to_value());
    }

    /// A backfill firing whose evidence all predates the run's window, so its case is history.
    pub(super) fn is_historical(
        &self,
        rows: &[json::Map<String, json::Value>],
        end_time: i64,
    ) -> bool {
        self.history_before(end_time)
            .is_some_and(|cutoff| detection::predates(rows, cutoff))
    }

    /// Where a backfill run's own window starts; each case's evidence before it is history.
    pub(super) fn history_before(&self, end_time: i64) -> Option<i64> {
        self.is_backfill
            .then(|| self.plan.own_window_start(end_time))
    }

    pub(super) fn restore(run: Option<&Self>, data: &mut ScheduledTriggerData) {
        if let Some(run) = run {
            data.siem = run.prior.clone();
        }
    }
}

/// The detection with its exceptions ANDed into its SQL; `None` runs it as stored.
async fn excepted_alert(
    alert: &Alert,
    exceptions: &[&o2_enterprise::enterprise::security::tuning::DetectionException],
    settings: &o2_enterprise::enterprise::security::tuning::TuningSettings,
) -> Option<Alert> {
    if exceptions.is_empty() {
        return None;
    }
    let sql = alert.query_condition.sql.as_deref()?;
    let columns: Vec<String> =
        match infra::schema::get(&alert.org_id, &alert.stream_name, alert.stream_type).await {
            Ok(schema) => schema.fields().iter().map(|f| f.name().clone()).collect(),
            Err(e) => {
                log::warn!(
                    "[SIEM] no schema for {}/{}, exceptions apply to result rows only: {e}",
                    alert.org_id,
                    alert.stream_name
                );
                return None;
            }
        };
    match tuning::apply_exceptions_sql(
        sql,
        &alert.stream_name,
        exceptions,
        &settings.lists,
        &columns,
    ) {
        Ok(rewritten) if rewritten != sql => {
            let mut tuned = alert.clone();
            tuned.query_condition.sql = Some(rewritten);
            Some(tuned)
        }
        Ok(_) => None,
        Err(e) => {
            log::warn!(
                "[SIEM] detection {}/{} keeps its SQL; exceptions apply to result rows only: {e}",
                alert.org_id,
                alert.name
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::alerts::alert::Alert;

    use super::*;

    fn rows(n: usize) -> TriggerEvalResults {
        TriggerEvalResults {
            data: Some(
                (0..n)
                    .map(|i| {
                        json::json!({"host": format!("etl-{i}"), "_timestamp": 1_000 + i as i64})
                            .as_object()
                            .unwrap()
                            .clone()
                    })
                    .collect(),
            ),
            ..Default::default()
        }
    }

    #[test]
    fn a_learning_first_run_fires_nothing_and_the_next_run_fires_new_matches() {
        let mut alert = Alert::default();
        alert.trigger_condition.period = 15;
        alert.context_attributes = Some(
            [
                (detection::SIEM_ATTRIBUTE, "true"),
                (detection::LEARN_FIRST_RUN_ATTRIBUTE, "true"),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        );
        let mut data = ScheduledTriggerData::default();
        let first = SiemRun::for_alert(&alert, &data).unwrap();
        let mut results = rows(3);
        first.dedupe(&mut results, &mut data, 0, 2_000);
        assert!(results.data.is_none(), "the first run opens no case");
        let state = detection::SiemTriggerState::from_value(data.siem.as_ref());
        assert_eq!(state.baseline_matches, Some(3));

        let second = SiemRun::for_alert(&alert, &data).unwrap();
        let mut results = rows(3);
        results.data.as_mut().unwrap().push(
            json::json!({"host": "new", "_timestamp": 1_900})
                .as_object()
                .unwrap()
                .clone(),
        );
        second.dedupe(&mut results, &mut data, 0, 3_000);
        let fired = results.data.unwrap_or_default();
        assert_eq!(
            fired.len(),
            1,
            "only the match the baseline had not seen fires"
        );
    }
}
