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
use chrono::{Duration, Local, TimeZone, Utc};
use config::{
    get_config,
    meta::stream::StreamType,
    utils::{
        base64,
        json::{Map, Value},
    },
    SMTP_CLIENT,
};
use cron::Schedule;
use hashbrown::{HashMap, HashSet};
use lettre::{message::SinglePart, AsyncTransport, Message};

use crate::{
    common::{
        meta::{
            authz::Authz,
            scheduled_ops::{
                derived_streams::DerivedStreamMeta,
                destinations::{DestinationType, DestinationWithTemplate, HTTPType},
                AlertFrequencyType, Operator, QueryType,
            },
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::{
        db,
        scheduled_ops::{build_sql, destinations},
    },
};

pub async fn save(
    org_id: &str,
    name: &str,
    mut derived_streams: DerivedStreamMeta,
    create: bool,
) -> Result<(), anyhow::Error> {
    if !name.is_empty() {
        derived_streams.name = name.to_string();
    }
    derived_streams.name = derived_streams.name.trim().to_string();

    // 1. check if db already exists

    // 2. Update the frequency
    // if derived_streams.trigger_condition.frequency_type == AlertFrequencyType::Cron {
    //     // Check the cron expression
    //     Schedule::from_str(&derived_streams.trigger_condition.cron)?;
    // } else if derived_streams.trigger_condition.frequency == 0 {
    //     // default frequency is 60 seconds
    //     derived_streams.trigger_condition.frequency =
    //         std::cmp::max(10, get_config().limit.alert_schedule_interval);
    // }

    // 3. validate before saving
    if derived_streams.name.is_empty() {
        return Err(anyhow::anyhow!("DerivedStream name is required."));
    }
    // QUESTION(taiming): why not / and do we need the same for derived_streams?
    // if alert.name.contains('/') {
    //     return Err(anyhow::anyhow!("Alert name cannot contain '/'"));
    // }

    if !derived_streams.source.is_valid() {
        return Err(anyhow::anyhow!(
            "DerivedStreams source is not valid. Both org_id and stream_name are required"
        ));
    }
    if !derived_streams.destination.is_valid() {
        return Err(anyhow::anyhow!(
            "DerivedStreams destination is not valid. Both org_id and stream_name are required"
        ));
    }

    // before saving alert check alert context attributes
    if let Some(attrs) = &derived_streams.context_attributes {
        let mut new_attrs = HashMap::with_capacity(attrs.len());
        for key in attrs.keys() {
            let new_key = key.trim().to_string();
            if !new_key.is_empty() {
                new_attrs.insert(new_key, attrs.get(key).unwrap().to_string());
            }
        }
        derived_streams.context_attributes = Some(new_attrs);
    }

    // before saving alert check column type to decide numeric condition
    // get and check schema
    // let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    // if stream_name.is_empty() || schema.fields().is_empty() {
    //     return Err(anyhow::anyhow!("Stream {stream_name} not found"));
    // }

    if derived_streams.is_real_time
        && derived_streams.query_condition.query_type != QueryType::Custom
    {
        return Err(anyhow::anyhow!(
            "Realtime DerivedStreams should use Custom query type"
        ));
    }

    // TODO: check if applicable to DerivedStreams
    match derived_streams.query_condition.query_type {
        QueryType::Custom => {
            if derived_streams.query_condition.aggregation.is_some() {
                // if it has result we should fire the alert when enable aggregation
                derived_streams.trigger_condition.operator = Operator::GreaterThanEquals;
                derived_streams.trigger_condition.threshold = 1;
            }
        }
        QueryType::SQL => {
            if derived_streams.query_condition.sql.is_none()
                || derived_streams
                    .query_condition
                    .sql
                    .as_ref()
                    .unwrap()
                    .is_empty()
            {
                return Err(anyhow::anyhow!(
                    "DerivedStreams with SQL mode should have a query"
                ));
            }
        }
        QueryType::PromQL => {
            if derived_streams.query_condition.promql.is_none()
                || derived_streams
                    .query_condition
                    .promql
                    .as_ref()
                    .unwrap()
                    .is_empty()
                || derived_streams.query_condition.promql_condition.is_none()
            {
                return Err(anyhow::anyhow!(
                    "DerivedStreams with PromQL mode should have a query"
                ));
            }
        }
    }

    // test the alert
    // _ = &alert.evaluate(None).await?;

    // TODO: call db save the alert
    Ok(())
}

pub async fn get(org_id: &str, name: &str) -> Result<Option<DerivedStreamMeta>, anyhow::Error> {
    // TODO: call db to get the derived_streams
    Ok(None)
}

pub async fn list(org_id: &str, name: &str) -> Result<Vec<DerivedStreamMeta>, anyhow::Error> {
    // TODO: call db to list the derived_streams
    Ok(Vec::new())
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    // TODO: call db to to check if exists and delete is so
    Ok(())
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

impl DerivedStreamMeta {}
