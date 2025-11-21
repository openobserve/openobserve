// Copyright 2025 OpenObserve Inc.
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

use crate::service::{alerts::QueryConditionExt, db};

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
        QueryType::PromQL => {
            if derived_stream
                .query_condition
                .promql
                .as_ref()
                .is_some_and(|promql| promql.is_empty())
                || derived_stream.query_condition.promql_condition.is_none()
            {
                return Err(anyhow::anyhow!(
                    "Scheduled pipeline with PromQL mode should have a query and condition"
                ));
            }
        }
        _ => {}
    };
    // End input validation

    // 2. update the frequency
    if derived_stream.trigger_condition.frequency_type == FrequencyType::Cron {
        let now = chrono::Utc::now().second();
        derived_stream.trigger_condition.cron = super::super::alerts::alert::update_cron_expression(
            &derived_stream.trigger_condition.cron,
            now,
        );
        // Check if the cron expression is valid
        Schedule::from_str(&derived_stream.trigger_condition.cron)?;
    } else if derived_stream.trigger_condition.frequency == 0 {
        // default 3 mins, set min at 1 minutes
        derived_stream.trigger_condition.frequency =
            std::cmp::max(1, get_config().limit.derived_stream_schedule_interval / 60);
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
                "DerivedStream not saved due to failed test run caused by {}",
                e.to_string()
            ));
        };
    }

    let next_run_at = chrono::Utc::now().timestamp_micros();
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
