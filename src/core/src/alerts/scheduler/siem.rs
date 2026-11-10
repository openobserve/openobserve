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
use o2_enterprise::enterprise::{common::config::get_config as get_o2_config, security::detection};

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
        let is_backfill =
            detection::SiemTriggerState::from_value(prior.as_ref()).is_backfill(&plan);
        Some(Self {
            grouped,
            dedupe_keys,
            plan,
            prior,
            severity: detection::sigma_level(attrs).map(str::to_string),
            is_backfill,
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
        Ok(merged.unwrap_or_default())
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
