// Copyright 2024 Zinc Labs Inc.
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

use actix_web::http;
use config::{
    get_config,
    utils::{
        base64,
        json::{Map, Value},
    },
};
use cron::Schedule;
use hashbrown::HashMap;

use crate::{
    common::{
        meta::{
            authz::Authz,
            scheduled_ops::{
                derived_streams::DerivedStreamMeta, AlertFrequencyType, Operator, QueryType,
            },
            stream::StreamParams,
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::{
        db,
        scheduled_ops::{build_sql, destinations},
    },
};

pub async fn save(
    mut derived_stream: DerivedStreamMeta,
    pipeline_name: &str,
) -> Result<(), anyhow::Error> {
    derived_stream.name = derived_stream.name.trim().to_string();
    // 1. Start validate DerivedStream
    if !derived_stream.is_valid() {
        return Err(anyhow::anyhow!("Name and destination required"));
    }

    // query_type for realtime
    if derived_stream.is_real_time && derived_stream.query_condition.query_type != QueryType::Custom
    {
        return Err(anyhow::anyhow!(
            "Realtime DerivedStream should use Custom query type"
        ));
    }

    // other checks for query type
    match derived_stream.query_condition.query_type {
        QueryType::Custom => {
            if derived_stream.query_condition.aggregation.is_some() {
                // TODO(taiming): this might only apply to alert?
                // if it has result we should fire the alert when enable aggregation
                derived_stream.trigger_condition.operator = Operator::GreaterThanEquals;
                derived_stream.trigger_condition.threshold = 1;
            }
        }
        QueryType::SQL => {
            if derived_stream
                .query_condition
                .sql
                .as_ref()
                .map_or(false, |sql| sql.is_empty())
            {
                return Err(anyhow::anyhow!(
                    "DerivedStreams with SQL mode should have a query"
                ));
            }
        }
        QueryType::PromQL => {
            if derived_stream
                .query_condition
                .promql
                .as_ref()
                .map_or(false, |promql| promql.is_empty())
                || derived_stream.query_condition.promql_condition.is_none()
            {
                return Err(anyhow::anyhow!(
                    "DerivedStreams with SQL mode should have a query"
                ));
            }
        }
    }

    // QUESTION(taiming): saw this in alerts. is this necessary?
    // check source stream schema
    let schema = infra::schema::get(
        &derived_stream.source.org_id,
        &derived_stream.source.stream_name,
        derived_stream.source.stream_type,
    )
    .await?;
    if schema.fields().is_empty() {
        return Err(anyhow::anyhow!(
            "Source Stream {}/{} schema is empty.",
            derived_stream.source.org_id,
            derived_stream.source.stream_name,
        ));
    }
    // End input validation

    // 2. update the frequency
    if derived_stream.trigger_condition.frequency_type == AlertFrequencyType::Cron {
        // Check the cron expression
        Schedule::from_str(&derived_stream.trigger_condition.cron)?;
    } else if derived_stream.trigger_condition.frequency == 0 {
        // TODO(taiming): need default freq for derived streams
        // default frequency is 60 seconds
        derived_stream.trigger_condition.frequency =
            std::cmp::max(10, get_config().limit.alert_schedule_interval);
    }

    // 3. clean up DerivedStream context attributes
    if let Some(attrs) = &derived_stream.context_attributes {
        let mut new_attrs = HashMap::with_capacity(attrs.len());
        for (key, val) in attrs.iter() {
            new_attrs.insert(key.trim().to_string(), val.to_string());
        }
        derived_stream.context_attributes = Some(new_attrs);
    }

    // test derived_stream
    _ = &derived_stream.evaluate(None).await?;

    // Save the trigger to db
    let trigger = db::scheduler::Trigger {
        org: derived_stream.source.org_id.to_string(),
        module: db::scheduler::TriggerModule::DerivedStream,
        module_key: derived_stream.get_schedule_key(pipeline_name),
        next_run_at: chrono::Utc::now().timestamp_micros(),
        is_realtime: derived_stream.is_real_time,
        is_silenced: false,
        ..Default::default()
    };

    // check if trigger already exists
    if db::scheduler::get(&trigger.org, trigger.module.clone(), &trigger.module_key)
        .await
        .is_ok()
    {
        return Err(anyhow::anyhow!("Trigger already exists"));
    }

    match db::scheduler::push(trigger).await {
        Ok(_) => {
            // TODO(taiming): is this needed, what needs to be updated in ofpg if so?
            set_ownership(
                &derived_stream.source.org_id,
                "derived_stream",
                Authz::new(&derived_stream.name),
            )
            .await;
            Ok(())
        }
        Err(e) => Err(anyhow::anyhow!("Error save DerivedStream trigger: {}", e)),
    }
}

pub async fn delete(
    derived_stream: DerivedStreamMeta,
    pipeline_name: &str,
) -> Result<(), anyhow::Error> {
    match db::scheduler::delete(
        &derived_stream.source.org_id,
        db::scheduler::TriggerModule::DerivedStream,
        &derived_stream.get_schedule_key(pipeline_name),
    )
    .await
    {
        Ok(_) => {
            remove_ownership(
                &derived_stream.source.org_id,
                "derived_stream",
                Authz::new(&derived_stream.name),
            )
            .await;
            Ok(())
        }
        Err(e) => Err(anyhow::anyhow!("Error deleting derived stream: {e}")),
    }
}

impl DerivedStreamMeta {
    pub fn is_valid(&self) -> bool {
        !self.name.is_empty() && self.source.is_valid() && self.destination.is_valid()
    }

    pub fn get_schedule_key(&self, pipeline_name: &str) -> String {
        format!(
            "{}/{}/{}/{}",
            self.source.stream_type, self.source.stream_name, pipeline_name, self.name
        )
    }

    pub async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        if self.is_real_time {
            self.query_condition.evaluate_realtime(row).await
        } else {
            self.query_condition
                .evaluate_scheduled(&self.source, &self.trigger_condition)
                .await
        }
    }
}
