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
    get_config,
    meta::{
        self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
        triggers::{Trigger, TriggerModule, TriggerStatus},
    },
    utils::{
        json,
        time::{now_micros, second_micros},
    },
};
use infra::{
    db::get_orm_client_ro,
    errors::{DbError, Error as InfraError},
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
const WRITE_ALLOWANCE_SECS: i64 = 60;

type ConfigRead = Result<Option<CalibrationConfig>, InfraError>;

/// What a calibration row carries from one pass to the next.
#[derive(Default, Deserialize, Serialize)]
struct JobData {
    config_misses: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_run: Option<LastRun>,
}

/// How the latest attempted pass ended; a failed pass writes no digest, so only the row can say
/// why.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct LastRun {
    pub status: RunOutcome,
    pub error: Option<String>,
    pub finished_at: i64,
}

/// What a pass decided before any analysis.
#[derive(Debug, PartialEq)]
enum Pass<'a> {
    /// The deployment switch is off, so the config is not even read.
    SwitchedOff,
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
    /// `read` is `None` when the deployment switch is off and the config was never read.
    fn decide(read: Option<&'a ConfigRead>, retries: i32, max_retries: i32) -> Self {
        match read {
            None => Self::SwitchedOff,
            Some(Err(e)) => Self::ConfigMiss {
                read_error: Some(e.to_string()),
            },
            Some(Ok(None)) => Self::ConfigMiss { read_error: None },
            Some(Ok(Some(config))) if retries >= max_retries => Self::Abandoned(config),
            Some(Ok(Some(config))) if !config.enabled => Self::Disabled(config),
            Some(Ok(Some(config))) => Self::Due(config),
        }
    }

    /// `analysis` is a due pass's result: the window it analysed, or why it failed.
    fn settle(
        &self,
        data: &mut JobData,
        retries: i32,
        now: i64,
        analysis: Option<Result<(i64, i64), String>>,
    ) -> Outcome {
        let (config, status, error, window) = match self {
            // A switched-off deployment costs each org one wake a day, not one per cadence.
            Self::SwitchedOff => {
                return Outcome::skipped(
                    now,
                    MAX_CONFIG_RETRY_SECS,
                    "alert calibration is disabled for this deployment".to_string(),
                );
            }
            Self::ConfigMiss { read_error } => {
                data.config_misses = data.config_misses.saturating_add(1);
                let wait_secs = config_retry_secs(data.config_misses);
                let what = match read_error {
                    Some(e) => format!("unreadable ({e})"),
                    None => "not found".to_string(),
                };
                let reason = format!(
                    "config {what} on {} passes in a row; retrying in {wait_secs}s",
                    data.config_misses
                );
                return Outcome::skipped(now, wait_secs, reason);
            }
            Self::Abandoned(config) => (
                config,
                RunOutcome::Error,
                Some(format!(
                    "{retries} earlier attempts outlived their lease without finishing this pass"
                )),
                None,
            ),
            Self::Disabled(config) => (
                config,
                RunOutcome::Skipped,
                Some("the org's alert calibration config is disabled".to_string()),
                None,
            ),
            Self::Due(config) => match analysis.unwrap_or_else(|| Err("no analysis ran".into())) {
                Ok(window) => (config, RunOutcome::Succeeded, None, Some(window)),
                Err(e) => (config, RunOutcome::Error, Some(e), None),
            },
        };
        data.config_misses = 0;
        if !matches!(self, Self::Disabled(_)) {
            data.last_run = Some(LastRun {
                status: status.clone(),
                error: error.clone(),
                finished_at: now,
            });
        }
        Outcome {
            status,
            error,
            next_run_at: next_by_cadence(now, config),
            window,
        }
    }
}

/// What a pass reports and where it leaves the row.
#[derive(Debug, PartialEq)]
struct Outcome {
    status: RunOutcome,
    error: Option<String>,
    next_run_at: i64,
    /// The window actually analysed, which a clamp may have shortened.
    window: Option<(i64, i64)>,
}

impl Outcome {
    fn skipped(now: i64, wait_secs: i64, reason: String) -> Self {
        Self {
            status: RunOutcome::Skipped,
            error: Some(reason),
            next_run_at: now.saturating_add(second_micros(wait_secs)),
            window: None,
        }
    }
}

pub(super) async fn handle_triggers(
    trace_id: &str,
    mut trigger: Trigger,
) -> Result<(), anyhow::Error> {
    let started_at = now_micros();
    let read = read_config(&trigger).await;
    let max_retries = get_scheduler_max_retries();
    let pass = Pass::decide(read.as_ref(), trigger.retries, max_retries);
    let analysis = match &pass {
        Pass::Due(config) => {
            let time_left = time_left(trigger.start_time, started_at, analysis_budget_secs());
            Some(analyse(&trigger, config, time_left).await.map_err(|e| {
                log::error!(
                    "[alert_calibration] pass failed for config {} org={}: {e}",
                    trigger.module_key,
                    trigger.org
                );
                e.to_string()
            }))
        }
        _ => None,
    };
    let mut data: JobData = json::from_str(&trigger.data).unwrap_or_default();
    let finished_at = now_micros();
    let outcome = pass.settle(&mut data, trigger.retries, finished_at, analysis);
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

/// How long the scheduler keeps a pass's claim alive: its analysis budget plus room to write.
pub(super) fn claim_lifetime_secs() -> i64 {
    analysis_budget_secs() + WRITE_ALLOWANCE_SECS
}

/// How the latest attempted pass of the org's config `key` ended, if one has.
pub async fn last_run(org: &str, key: &str) -> Result<Option<LastRun>, anyhow::Error> {
    let trigger = match infra::scheduler::get(org, TriggerModule::AlertCalibration, key).await {
        Ok(trigger) => trigger,
        Err(InfraError::DbError(DbError::KeyNotExists(_))) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    Ok(json::from_str::<JobData>(&trigger.data)
        .unwrap_or_default()
        .last_run)
}

async fn read_config(trigger: &Trigger) -> Option<ConfigRead> {
    if !deployment_enabled() {
        return None;
    }
    let conn = get_orm_client_ro().await;
    let read = alert_calibration::get_by_id(conn, &trigger.org, &trigger.module_key).await;
    if let Err(e) = &read {
        log::error!(
            "[alert_calibration] could not read config {} for org={}: {e}",
            trigger.module_key,
            trigger.org
        );
    }
    Some(read)
}

#[cfg(feature = "enterprise")]
fn deployment_enabled() -> bool {
    o2_enterprise::enterprise::alert_calibration_service::is_enabled()
}

#[cfg(not(feature = "enterprise"))]
fn deployment_enabled() -> bool {
    false
}

/// The digest is the pass's only output, so a failed write fails the pass.
#[cfg(feature = "enterprise")]
async fn analyse(
    trigger: &Trigger,
    config: &CalibrationConfig,
    time_left: std::time::Duration,
) -> Result<(i64, i64), anyhow::Error> {
    use o2_enterprise::enterprise::alert_calibration_service::run_pass;

    use crate::alerts::alert_calibration::{SearchAdapter, sink::write_digest_records};

    let pass = tokio::time::timeout(
        time_left,
        run_pass(
            &SearchAdapter,
            &trigger.org,
            &trigger.module_key,
            trigger.next_run_at,
            config.window_minutes,
        ),
    )
    .await
    .map_err(|_| {
        anyhow::anyhow!(
            "the analysis ran past its {}s budget",
            analysis_budget_secs()
        )
    })??;
    let cfg = get_config();
    // Only the claim's holder writes, or a pass that was claimed again lands its digest twice.
    let held = infra::scheduler::keep_alive_claim(
        trigger,
        cfg.limit.alert_schedule_timeout,
        cfg.limit.report_schedule_timeout,
    )
    .await?;
    if !held {
        anyhow::bail!("lost the claim before writing the digest");
    }
    write_digest_records(&trigger.org, pass.records).await?;
    Ok((pass.window.start_micros, pass.window.end_micros))
}

#[cfg(not(feature = "enterprise"))]
async fn analyse(
    _trigger: &Trigger,
    _config: &CalibrationConfig,
    _time_left: std::time::Duration,
) -> Result<(i64, i64), anyhow::Error> {
    anyhow::bail!("alert calibration is an enterprise feature")
}

fn analysis_budget_secs() -> i64 {
    // The collector's longest chain is three searches in a row, each capped by the query timeout.
    3 * get_config().limit.query_timeout as i64
}

/// Counted from the claim, since time spent queued for a worker uses up the same keep-alive.
fn time_left(claimed_at: Option<i64>, now: i64, budget_secs: i64) -> std::time::Duration {
    let deadline = claimed_at
        .unwrap_or(now)
        .saturating_add(second_micros(budget_secs));
    std::time::Duration::from_micros(u64::try_from(deadline.saturating_sub(now)).unwrap_or(0))
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
    let (start_time, end_time) = outcome
        .window
        .unwrap_or((trigger.next_run_at, trigger.next_run_at));
    TriggerData {
        _timestamp: finished_at,
        org: trigger.org.clone(),
        module: TriggerDataType::AlertCalibration,
        key: format!("alert_calibration/{}", trigger.module_key),
        next_run_at: outcome.next_run_at,
        is_realtime: trigger.is_realtime,
        is_silenced: trigger.is_silenced,
        status: outcome.status.clone(),
        start_time,
        end_time,
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
    fn a_pass_is_decided_by_both_switches_the_config_read_and_the_retry_budget() {
        assert_eq!(Pass::decide(None, 0, 3), Pass::SwitchedOff);
        let unreadable = Err(InfraError::DbError(DbError::SeaORMError(
            "down".to_string(),
        )));
        assert!(matches!(
            Pass::decide(Some(&unreadable), 0, 3),
            Pass::ConfigMiss {
                read_error: Some(_)
            }
        ));
        assert_eq!(
            Pass::decide(Some(&Ok(None)), 0, 3),
            Pass::ConfigMiss { read_error: None }
        );
        let enabled = Ok(Some(config(true, 30)));
        assert!(matches!(
            Pass::decide(Some(&enabled), 3, 3),
            Pass::Abandoned(_)
        ));
        assert!(matches!(Pass::decide(Some(&enabled), 2, 3), Pass::Due(_)));
        let disabled = Ok(Some(config(false, 30)));
        assert!(matches!(
            Pass::decide(Some(&disabled), 0, 3),
            Pass::Disabled(_)
        ));
    }

    #[test]
    fn a_switched_off_deployment_looks_again_in_a_day_and_keeps_the_backoff() {
        let mut data = JobData {
            config_misses: 3,
            ..Default::default()
        };
        let outcome = Pass::SwitchedOff.settle(&mut data, 0, NOW, None);
        assert_eq!(outcome.status, RunOutcome::Skipped);
        assert_eq!(outcome.next_run_at, NOW + 1440 * MINUTE);
        assert_eq!(data.config_misses, 3);
    }

    #[tokio::test]
    async fn a_switched_off_deployment_never_reads_the_config() {
        assert!(read_config(&Trigger::default()).await.is_none());
    }

    #[test]
    fn a_missing_config_backs_off_from_a_minute_to_a_day() {
        let mut data = JobData::default();
        let waits: Vec<i64> = (0..12)
            .map(|_| {
                let outcome = Pass::ConfigMiss { read_error: None }.settle(&mut data, 0, NOW, None);
                assert_eq!(outcome.status, RunOutcome::Skipped);
                (outcome.next_run_at - NOW) / 1_000_000
            })
            .collect();
        assert_eq!(&waits[..4], [60, 120, 240, 480]);
        assert_eq!(waits[11], MAX_CONFIG_RETRY_SECS);
        assert_eq!(data.config_misses, 12);
    }

    #[test]
    fn a_due_pass_reports_its_analysis_and_re_arms_on_its_cadence() {
        let mut data = JobData {
            config_misses: 5,
            ..Default::default()
        };
        let enabled = config(true, 30);
        let done = Pass::Due(&enabled).settle(&mut data, 0, NOW, Some(Ok((NOW - MINUTE, NOW))));
        assert_eq!(data.config_misses, 0);
        assert_eq!(
            (done.status, done.next_run_at, done.window),
            (
                RunOutcome::Succeeded,
                NOW + 30 * MINUTE,
                Some((NOW - MINUTE, NOW))
            )
        );
        let failed =
            Pass::Due(&enabled).settle(&mut data, 0, NOW, Some(Err("querier down".into())));
        assert_eq!(
            (failed.status, failed.error, failed.window),
            (RunOutcome::Error, Some("querier down".to_string()), None)
        );
    }

    #[test]
    fn the_row_keeps_the_latest_attempted_pass_and_not_a_disabled_one() {
        let mut data = JobData::default();
        Pass::Due(&config(true, 30)).settle(&mut data, 0, NOW, Some(Err("querier down".into())));
        Pass::Disabled(&config(false, 30)).settle(&mut data, 0, NOW + MINUTE, None);
        assert_eq!(
            data.last_run,
            Some(LastRun {
                status: RunOutcome::Error,
                error: Some("querier down".to_string()),
                finished_at: NOW,
            })
        );
    }

    #[test]
    fn a_non_positive_cadence_falls_back_to_daily() {
        for frequency in [0, -1, i32::MIN] {
            let broken = config(false, frequency);
            let outcome = Pass::Disabled(&broken).settle(&mut JobData::default(), 0, NOW, None);
            assert_eq!(outcome.next_run_at, NOW + 1440 * MINUTE, "{frequency}");
        }
    }

    #[test]
    fn an_abandoned_pass_is_an_error_re_armed_on_its_cadence() {
        let enabled = config(true, 60);
        let outcome = Pass::Abandoned(&enabled).settle(&mut JobData::default(), 3, NOW, None);
        assert_eq!(outcome.status, RunOutcome::Error);
        assert_eq!(outcome.next_run_at, NOW + 60 * MINUTE);
        assert!(outcome.error.unwrap().starts_with("3 earlier attempts"));
    }

    #[test]
    fn the_analysis_budget_runs_from_the_claim() {
        let left = |claimed_at| time_left(claimed_at, NOW, 1800).as_secs();
        assert_eq!(left(Some(NOW - 10 * MINUTE)), 1200);
        assert_eq!(left(Some(NOW - 40 * MINUTE)), 0);
        assert_eq!(left(None), 1800);
    }

    #[test]
    fn the_published_row_spans_the_analysed_window_and_is_timed_from_the_claim() {
        let trigger = Trigger {
            org: "default".to_string(),
            module_key: "cfg1".to_string(),
            next_run_at: NOW - MINUTE,
            start_time: Some(NOW - 2 * MINUTE),
            retries: 1,
            ..Default::default()
        };
        let outcome = Outcome {
            status: RunOutcome::Succeeded,
            error: None,
            next_run_at: NOW + MINUTE,
            window: Some((NOW - 60 * MINUTE, NOW - MINUTE)),
        };
        let row = trigger_data(&trigger, &outcome, NOW, NOW + 1_000_000, "t");
        assert_eq!(
            (row.start_time, row.end_time),
            (NOW - 60 * MINUTE, NOW - MINUTE)
        );
        assert_eq!(
            (row.delay_in_secs, row.time_in_queue_ms, row.retries),
            (Some(60), Some(120_000), 1)
        );
    }
}
