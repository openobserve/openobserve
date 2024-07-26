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
use config::get_config;
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

pub async fn save(mut derived_stream: DerivedStreamMeta) -> Result<(), anyhow::Error> {
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

    // check if db already exists
    if get_existing_derived_stream(&derived_stream.name, &derived_stream.source)
        .await
        .is_some()
    {
        return Err(anyhow::anyhow!("Derived Stream already exists"));
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

    // TODO(taiming): test derived_stream
    // _ = &derived_stream.evaluate(None).await?;

    match db::scheduled_ops::derived_streams::set(&derived_stream).await {
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
        Err(e) => Err(e),
    }
}

pub async fn delete(derived_stream: DerivedStreamMeta) -> Result<(), anyhow::Error> {
    if get_existing_derived_stream(&derived_stream.name, &derived_stream.source)
        .await
        .is_none()
    {
        return Err(anyhow::anyhow!("Derived Stream not found"));
    }

    match db::scheduled_ops::derived_streams::delete(&derived_stream).await {
        Ok(_) => {
            remove_ownership(
                &derived_stream.source.org_id,
                "derived_stream",
                Authz::new(&derived_stream.name),
            )
            .await;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

async fn get_existing_derived_stream(
    name: &str,
    source: &StreamParams,
) -> Option<DerivedStreamMeta> {
    match db::scheduled_ops::derived_streams::get(
        &source.org_id,
        source.stream_type,
        &source.stream_name,
        name,
    )
    .await
    {
        Ok(ret) => ret,
        Err(_) => None,
    }
}

pub async fn enable(
    org_id: &str,
    name: &str,
    value: bool,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    // TODO: call db to get the derived_streams and change [enabled] and save again
    Ok(())
}

pub async fn trigger(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    // TODO: call db to get the derived_streams and change [enabled] and save again
    Ok(())
}

impl DerivedStreamMeta {
    pub fn is_valid(&self) -> bool {
        !self.name.is_empty() && self.source.is_valid() && self.destination.is_valid()
    }

    pub fn get_schedule_key(&self) -> String {
        format!(
            "{}/{}/{}",
            self.source.stream_type, self.source.stream_name, self.name
        )
    }

    pub fn get_store_key(&self) -> String {
        format!(
            "/derived_streams/{}/{}",
            self.source.org_id,
            self.get_schedule_key()
        )
    }
}
