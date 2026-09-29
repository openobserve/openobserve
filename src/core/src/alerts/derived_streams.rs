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

use std::str::FromStr;

use async_trait::async_trait;
use chrono::{Timelike, Utc};
use config::{
    get_config,
    meta::{
        alerts::{FrequencyType, QueryType, TriggerEvalResults},
        pipeline::components::DerivedStream,
        search::{SearchEventContext, SearchEventType},
        sql::resolve_stream_names,
    },
    utils::sql::is_timestamp_selected,
};
use cron::Schedule;

use crate::{
    alerts::{
        QueryConditionExt,
        alert::{SCHEDULE_FIELD_MAX_SECS, TZ_OFFSET_RANGE_MINUTES},
    },
    db,
};

pub async fn save(
    mut derived_stream: DerivedStream,
    pipeline_name: &str,
    pipeline_id: &str,
    needs_validated: bool,
) -> Result<(), anyhow::Error> {
    // 1. Start validate DerivedStream
    // checks for query type
    match derived_stream.query_condition.query_type {
        QueryType::SQL => {
            if let Some(sql) = &derived_stream.query_condition.sql {
                if sql.is_empty() {
                    return Err(anyhow::anyhow!(
                        "Scheduled pipeline with SQL mode should have a query"
                    ));
                }

                // check if _timestamp is a selected field, or _timestamp as an alias
                if !is_timestamp_selected(sql).map_err(|e| anyhow::anyhow!("Invalid SQL: {}", e))? {
                    return Err(anyhow::anyhow!(
                        "SQL for scheduled pipeline must include _timestamp, or aliased as _timestamp.\n\
                        e.g. SELECT app_name, MAX(_timestamp) AS _timestamp FROM ..."
                    ));
                }

                // Check the max_query_range of streams in the sql query
                let stream_names = match resolve_stream_names(sql) {
                    Ok(stream_names) => stream_names,
                    Err(e) => {
                        return Err(anyhow::anyhow!(
                            "Error resolving stream names in SQL query: {e}"
                        ));
                    }
                };
                let (org_id, stream_type) = (&derived_stream.org_id, derived_stream.stream_type);
                for stream in stream_names.iter() {
                    if let Some(settings) =
                        infra::schema::get_settings(org_id, stream, stream_type).await
                    {
                        let max_query_range = settings.max_query_range;
                        if max_query_range > 0
                            && derived_stream.trigger_condition.period > max_query_range * 60
                        {
                            return Err(anyhow::anyhow!(
                                "Query period is greater than max query range of {max_query_range} hours for stream \"{stream}\""
                            ));
                        }
                    }
                }
            } else {
                return Err(anyhow::anyhow!(
                    "Scheduled pipeline with SQL mode should have a query"
                ));
            }
        }
        QueryType::PromQL
            if (derived_stream
                .query_condition
                .promql
                .as_ref()
                .is_some_and(|promql| promql.is_empty())
                || derived_stream.query_condition.promql_condition.is_none()) =>
        {
            return Err(anyhow::anyhow!(
                "Scheduled pipeline with PromQL mode should have a query and condition"
            ));
        }
        _ => {}
    };
    // End input validation

    if !TZ_OFFSET_RANGE_MINUTES.contains(&derived_stream.tz_offset) {
        return Err(anyhow::anyhow!(
            "tz_offset must be strictly between -1440 and 1440 minutes"
        ));
    }

    // 2. update the frequency
    if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
        let now = chrono::Utc::now().second();
        derived_stream.trigger_condition.cron = super::super::alerts::alert::update_cron_expression(
            &derived_stream.trigger_condition.cron,
            now,
        );
        // Check if the cron expression is valid
        let schedule = Schedule::from_str(&derived_stream.trigger_condition.cron)?;
        if schedule.upcoming(Utc).next().is_none() {
            return Err(anyhow::anyhow!(
                "cron schedule '{}' has no future occurrence",
                derived_stream.trigger_condition.cron
            ));
        }
    } else {
        if derived_stream.trigger_condition.frequency == 0 {
            // default 3 mins, set min at 1 minutes
            derived_stream.trigger_condition.frequency =
                std::cmp::max(1, get_config().limit.derived_stream_schedule_interval / 60);
        }
        // derived streams schedule in minutes, alerts in seconds
        if !(1..=SCHEDULE_FIELD_MAX_SECS / 60).contains(&derived_stream.trigger_condition.frequency)
        {
            return Err(anyhow::anyhow!(
                "frequency must be between 1 and {} minutes",
                SCHEDULE_FIELD_MAX_SECS / 60
            ));
        }
    }

    if !(0..=SCHEDULE_FIELD_MAX_SECS / 60).contains(&derived_stream.trigger_condition.silence) {
        return Err(anyhow::anyhow!(
            "silence must be between 0 and {} minutes",
            SCHEDULE_FIELD_MAX_SECS / 60
        ));
    }
    if let Some(tolerance) = derived_stream.trigger_condition.tolerance_in_secs
        && !(0..=SCHEDULE_FIELD_MAX_SECS).contains(&tolerance)
    {
        return Err(anyhow::anyhow!(
            "tolerance_in_secs must be between 0 and {SCHEDULE_FIELD_MAX_SECS} seconds"
        ));
    }

    let trigger_module_key = derived_stream.get_scheduler_module_key(pipeline_name, pipeline_id);
    if needs_validated {
        // test derived_stream
        let test_end_time = Utc::now().timestamp_micros();
        let test_start_time = test_end_time
            - chrono::Duration::try_seconds(5)
                .unwrap()
                .num_microseconds()
                .unwrap();
        if let Err(e) = &derived_stream
            .evaluate(
                (Some(test_start_time), test_end_time),
                &trigger_module_key,
                None,
            )
            .await
        {
            return Err(anyhow::anyhow!(
                "DerivedStream not saved due to failed test run caused by {e}"
            ));
        };
    }

    let next_run_at = if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
        match derived_stream.trigger_condition.get_next_trigger_time(
            false,
            derived_stream.tz_offset,
            false,
            None,
        ) {
            Ok(t) => t,
            Err(e) => {
                log::error!(
                    "Failed to compute next trigger time for DerivedStream {trigger_module_key}: {e}"
                );
                chrono::Utc::now().timestamp_micros()
            }
        }
    } else {
        chrono::Utc::now().timestamp_micros()
    };
    // Save the trigger to db
    match db::scheduler::get(
        &derived_stream.org_id,
        db::scheduler::TriggerModule::DerivedStream,
        &trigger_module_key,
    )
    .await
    {
        Ok(mut existing_trigger) => {
            existing_trigger.next_run_at = next_run_at;
            db::scheduler::update_trigger(existing_trigger, false, "")
                .await
                .map_err(|_| anyhow::anyhow!("Trigger already exists, but failed to update"))
        }
        Err(_) => {
            let trigger = db::scheduler::Trigger {
                org: derived_stream.org_id.to_string(),
                module: db::scheduler::TriggerModule::DerivedStream,
                module_key: trigger_module_key,
                next_run_at,
                is_realtime: false,
                is_silenced: false,
                ..Default::default()
            };
            db::scheduler::push(trigger)
                .await
                .map_err(|e| anyhow::anyhow!("Error save DerivedStream trigger: {}", e))
        }
    }
}

pub async fn delete(
    derived_stream: &DerivedStream,
    pipeline_name: &str,
    pipeline_id: &str,
) -> Result<(), anyhow::Error> {
    db::scheduler::delete(
        &derived_stream.org_id,
        db::scheduler::TriggerModule::DerivedStream,
        &derived_stream.get_scheduler_module_key(pipeline_name, pipeline_id),
    )
    .await
    .map_err(|e| anyhow::anyhow!("Error deleting derived stream trigger: {e}"))
}

#[async_trait]
pub trait DerivedStreamExt: Sync + Send + 'static {
    async fn evaluate(
        &self,
        (start_time, end_time): (Option<i64>, i64),
        module_key: &str,
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error>;
}

#[async_trait]
impl DerivedStreamExt for DerivedStream {
    async fn evaluate(
        &self,
        (start_time, end_time): (Option<i64>, i64),
        module_key: &str,
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        self.query_condition
            .evaluate_scheduled(
                &self.org_id,
                None,
                self.stream_type,
                &self.trigger_condition,
                (start_time, end_time),
                Some(SearchEventType::DerivedStream),
                Some(SearchEventContext::with_derived_stream(Some(
                    module_key.to_string(),
                ))),
                trace_id,
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the real `save`; every rejection here happens before the DB is touched.
    async fn save_err(mutate: impl FnOnce(&mut DerivedStream)) -> String {
        let mut derived_stream = DerivedStream::default();
        mutate(&mut derived_stream);
        save(derived_stream, "p", "p1", false)
            .await
            .unwrap_err()
            .to_string()
    }

    #[tokio::test]
    async fn save_rejects_a_full_day_tz_offset() {
        for tz_offset in [1440, -1440, i32::MAX] {
            let err = save_err(|d| d.tz_offset = tz_offset).await;
            assert!(err.contains("tz_offset"), "{tz_offset}: {err}");
        }
    }

    #[tokio::test]
    async fn save_rejects_out_of_range_schedule_fields() {
        let err = save_err(|d| d.trigger_condition.frequency = i64::MAX).await;
        assert!(err.contains("frequency"), "{err}");
        let err = save_err(|d| d.trigger_condition.silence = i64::MAX).await;
        assert!(err.contains("silence"), "{err}");
        let err = save_err(|d| d.trigger_condition.tolerance_in_secs = Some(i64::MAX)).await;
        assert!(err.contains("tolerance_in_secs"), "{err}");
    }

    #[tokio::test]
    async fn save_rejects_a_cron_with_no_future_occurrence() {
        let err = save_err(|d| {
            d.trigger_condition.frequency_type = FrequencyType::Cron;
            d.trigger_condition.cron = "0 0 0 1 1 * 2020".to_string();
        })
        .await;
        assert!(err.contains("no future occurrence"), "{err}");
    }
}
