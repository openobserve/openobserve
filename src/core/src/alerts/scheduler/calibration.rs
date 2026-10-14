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

//! The periodic alert calibration job: one scheduler row per org config.

use chrono::Duration;
use config::{
    cluster::LOCAL_NODE,
    meta::{
        self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
        triggers::{Trigger, TriggerStatus},
    },
    utils::{
        json,
        time::{now_micros, second_micros},
    },
};
use infra::{
    db::get_orm_client_ro,
    errors::Error as InfraError,
    scheduler::get_scheduler_max_retries,
    table::{
        alert_calibration::{self, DEFAULT_FREQUENCY_MINUTES},
        entity::alert_calibration_configs::Model as CalibrationConfig,
    },
};
use serde::{Deserialize, Serialize};
use usage_reporting::publish_triggers_usage;

const CONFIG_RETRY_SECS: i64 = 60;
const MAX_CONFIG_RETRY_SECS: i64 = 86_400;

/// What a calibration row carries from one pass to the next.
#[derive(Default, Deserialize, Serialize)]
struct JobData {
    config_misses: u32,
}

/// What a pass decided before any analysis.
#[derive(Debug, PartialEq)]
enum Pass<'a> {
    /// The config is gone or unreadable; a delete may be in flight, so look again later.
    ConfigMiss {
        read_error: Option<String>,
    },
    /// Every earlier claim of this pass outlived its lease, so the window is given up.
    Abandoned(&'a CalibrationConfig),
    Disabled(&'a CalibrationConfig),
    Due(&'a CalibrationConfig),
}

impl<'a> Pass<'a> {
    fn decide(
        read: &'a Result<Option<CalibrationConfig>, InfraError>,
        retries: i32,
        max_retries: i32,
    ) -> Self {
        match read {
            Err(e) => Self::ConfigMiss {
                read_error: Some(e.to_string()),
            },
            Ok(None) => Self::ConfigMiss { read_error: None },
            Ok(Some(config)) if retries >= max_retries => Self::Abandoned(config),
            Ok(Some(config)) if !config.enabled => Self::Disabled(config),
            Ok(Some(config)) => Self::Due(config),
        }
    }

    fn settle(&self, data: &mut JobData, retries: i32, now: i64) -> Outcome {
        let (config, status, error) = match self {
            Self::ConfigMiss { read_error } => {
                data.config_misses = data.config_misses.saturating_add(1);
                let wait_secs = config_retry_secs(data.config_misses);
                let what = match read_error {
                    Some(e) => format!("unreadable ({e})"),
                    None => "not found".to_string(),
                };
                return Outcome {
                    status: RunOutcome::Skipped,
                    error: Some(format!(
                        "config {what} on {} passes in a row; retrying in {wait_secs}s",
                        data.config_misses
                    )),
                    next_run_at: now.saturating_add(second_micros(wait_secs)),
                };
            }
            Self::Abandoned(config) => (
                config,
                RunOutcome::Error,
                Some(format!(
                    "{retries} earlier attempts outlived their lease without finishing this pass"
                )),
            ),
            Self::Disabled(config) => (
                config,
                RunOutcome::Skipped,
                Some("the org's alert calibration config is disabled".to_string()),
            ),
            // Analysis is enterprise-only and lands with its own wiring; until then nothing runs.
            Self::Due(config) => (
                config,
                RunOutcome::Skipped,
                Some("alert calibration analysis is not available yet".to_string()),
            ),
        };
        data.config_misses = 0;
        Outcome {
            status,
            error,
            next_run_at: next_by_cadence(now, config),
        }
    }
}

/// What a pass reports and where it leaves the row.
#[derive(Debug, PartialEq)]
struct Outcome {
    status: RunOutcome,
    error: Option<String>,
    next_run_at: i64,
}

pub(super) async fn handle_triggers(
    trace_id: &str,
    mut trigger: Trigger,
) -> Result<(), anyhow::Error> {
    let started_at = now_micros();
    let read =
        alert_calibration::get_by_id(get_orm_client_ro().await, &trigger.org, &trigger.module_key)
            .await;
    if let Err(e) = &read {
        log::error!(
            "[alert_calibration] could not read config {} for org={}: {e}",
            trigger.module_key,
            trigger.org
        );
    }
    let (_, max_retries) = get_scheduler_max_retries();
    let pass = Pass::decide(&read, trigger.retries, max_retries);
    let mut data: JobData = json::from_str(&trigger.data).unwrap_or_default();
    let finished_at = now_micros();
    let outcome = pass.settle(&mut data, trigger.retries, finished_at);
    let row = trigger_data(&trigger, &outcome, started_at, finished_at, trace_id);
    trigger.status = TriggerStatus::Waiting;
    trigger.retries = 0;
    trigger.next_run_at = outcome.next_run_at;
    trigger.data = json::to_string(&data)?;
    // Local and fenced: a broadcast completion would let a region without the config take over.
    if !infra::scheduler::complete_claim(trigger).await? {
        log::warn!(
            "[alert_calibration] lost the claim on {} for org={}; a later claim owns this pass",
            row.key,
            row.org
        );
        return Ok(());
    }
    publish_triggers_usage(row);
    Ok(())
}

/// Doubling from a minute to a day, so a deleted config stops costing a pull a minute.
fn config_retry_secs(misses: u32) -> i64 {
    let doublings = misses.saturating_sub(1).min(16);
    (CONFIG_RETRY_SECS << doublings).min(MAX_CONFIG_RETRY_SECS)
}

/// Measured from the end of the pass, so a pass that overruns its cadence is not re-run at once.
fn next_by_cadence(now: i64, config: &CalibrationConfig) -> i64 {
    let minutes = if config.frequency_minutes > 0 {
        config.frequency_minutes
    } else {
        DEFAULT_FREQUENCY_MINUTES
    };
    now.saturating_add(second_micros(i64::from(minutes) * 60))
}

fn trigger_data(
    trigger: &Trigger,
    outcome: &Outcome,
    started_at: i64,
    finished_at: i64,
    trace_id: &str,
) -> TriggerData {
    TriggerData {
        _timestamp: finished_at,
        org: trigger.org.clone(),
        module: TriggerDataType::AlertCalibration,
        key: format!("alert_calibration/{}", trigger.module_key),
        next_run_at: outcome.next_run_at,
        is_realtime: trigger.is_realtime,
        is_silenced: trigger.is_silenced,
        status: outcome.status.clone(),
        start_time: trigger.next_run_at,
        end_time: trigger.next_run_at,
        retries: trigger.retries,
        error: outcome.error.clone(),
        delay_in_secs: Some(Duration::microseconds(started_at - trigger.next_run_at).num_seconds()),
        evaluation_took_in_secs: Some((finished_at - started_at) as f64 / 1_000_000.0),
        source_node: Some(LOCAL_NODE.name.clone()),
        scheduler_trace_id: Some(trace_id.to_string()),
        time_in_queue_ms: Some(
            Duration::microseconds(started_at - trigger.start_time.unwrap_or_default())
                .num_milliseconds(),
        ),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use infra::errors::DbError;

    use super::*;

    const NOW: i64 = 1_700_000_000_000_000;
    const MINUTE: i64 = 60 * 1_000_000;

    fn config(enabled: bool, frequency_minutes: i32) -> CalibrationConfig {
        CalibrationConfig {
            id: "cfg1".to_string(),
            org: "default".to_string(),
            enabled,
            frequency_minutes,
            window_minutes: 43_200,
            created_at: NOW,
            updated_at: NOW,
        }
    }

    #[test]
    fn a_pass_is_decided_by_the_config_read_the_retry_budget_and_the_switch() {
        let unreadable = Err(InfraError::DbError(DbError::SeaORMError(
            "down".to_string(),
        )));
        assert!(matches!(
            Pass::decide(&unreadable, 0, 3),
            Pass::ConfigMiss {
                read_error: Some(_)
            }
        ));
        assert_eq!(
            Pass::decide(&Ok(None), 0, 3),
            Pass::ConfigMiss { read_error: None }
        );
        let enabled = Ok(Some(config(true, 30)));
        assert!(matches!(Pass::decide(&enabled, 3, 3), Pass::Abandoned(_)));
        assert!(matches!(Pass::decide(&enabled, 2, 3), Pass::Due(_)));
        assert!(matches!(
            Pass::decide(&Ok(Some(config(false, 30))), 0, 3),
            Pass::Disabled(_)
        ));
    }

    #[test]
    fn a_missing_config_backs_off_from_a_minute_to_a_day() {
        let mut data = JobData::default();
        let waits: Vec<i64> = (0..12)
            .map(|_| {
                let outcome = Pass::ConfigMiss { read_error: None }.settle(&mut data, 0, NOW);
                assert_eq!(outcome.status, RunOutcome::Skipped);
                (outcome.next_run_at - NOW) / 1_000_000
            })
            .collect();
        assert_eq!(&waits[..4], [60, 120, 240, 480]);
        assert_eq!(waits[11], MAX_CONFIG_RETRY_SECS);
        assert_eq!(data.config_misses, 12);
    }

    #[test]
    fn a_found_config_resets_the_backoff_and_re_arms_on_its_cadence() {
        let mut data = JobData { config_misses: 5 };
        let enabled = config(true, 30);
        let outcome = Pass::Due(&enabled).settle(&mut data, 0, NOW);
        assert_eq!(data.config_misses, 0);
        assert_eq!(outcome.next_run_at, NOW + 30 * MINUTE);
        for frequency in [0, -1, i32::MIN] {
            let broken = config(true, frequency);
            let outcome = Pass::Disabled(&broken).settle(&mut data, 0, NOW);
            assert_eq!(outcome.next_run_at, NOW + 1440 * MINUTE, "{frequency}");
        }
    }

    #[test]
    fn an_abandoned_pass_is_an_error_re_armed_on_its_cadence() {
        let enabled = config(true, 60);
        let outcome = Pass::Abandoned(&enabled).settle(&mut JobData::default(), 3, NOW);
        assert_eq!(outcome.status, RunOutcome::Error);
        assert_eq!(outcome.next_run_at, NOW + 60 * MINUTE);
        assert!(outcome.error.unwrap().starts_with("3 earlier attempts"));
    }

    #[test]
    fn the_published_row_is_timed_from_the_due_time_and_the_claim() {
        let trigger = Trigger {
            org: "default".to_string(),
            module_key: "cfg1".to_string(),
            next_run_at: NOW - MINUTE,
            start_time: Some(NOW - 2 * MINUTE),
            retries: 1,
            ..Default::default()
        };
        let outcome = Outcome {
            status: RunOutcome::Skipped,
            error: None,
            next_run_at: NOW + MINUTE,
        };
        let row = trigger_data(&trigger, &outcome, NOW, NOW + 1_000_000, "t");
        assert_eq!(
            (row.delay_in_secs, row.time_in_queue_ms, row.retries),
            (Some(60), Some(120_000), 1)
        );
    }
}
