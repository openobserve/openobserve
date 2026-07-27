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

use std::collections::HashMap;

use config::utils::json;
use o2_enterprise::enterprise::{
    cloud::billings::{
        self, MeteringProvider,
        org_usage::{self, OrgUsageEvent, OrgUsageQueryResult, RangeUnit, UsageResultUnit},
    },
    metering::MeteringEventName,
};
use serde::Serialize;
use utoipa::ToSchema;

use crate::self_reporting::search::get_usage;

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GetOrgUsageResponseBody {
    pub data: Vec<OrgUserData>,
    pub range: String,
    pub start_time: i64,
    pub end_time: i64,
}

impl GetOrgUsageResponseBody {
    pub fn convert_to_unit(&mut self, unit: &str) {
        let target_unit = unit.to_ascii_lowercase();
        for usage_data in &mut self.data {
            match (
                usage_data.unit.to_ascii_lowercase().as_str(),
                target_unit.as_str(),
            ) {
                ("gb", "mb") => {
                    usage_data.value *= 1024.0;
                    usage_data.unit = "MB".to_string();
                }
                ("mb", "gb") => {
                    usage_data.value /= 1024.0;
                    usage_data.unit = "GB".to_string();
                }
                _ => {}
            }
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema, Default)]
pub struct OrgUserData {
    pub event: String,
    pub value: f64,
    pub cost: Option<f64>,
    pub unit: String,
}

impl OrgUserData {
    pub fn from_query_result(value: OrgUsageQueryResult, price_map: &HashMap<String, f64>) -> Self {
        let event = match value.event {
            OrgUsageEvent::UsageEvent(event) => event.into(),
            OrgUsageEvent::DataRetentionUsageEvent(_) => MeteringEventName::DataRetention,
        };
        let cost = price_map
            .get(&event.to_string())
            .map(|price| match value.unit {
                UsageResultUnit::MB => price * (value.size / 1024.0),
                UsageResultUnit::GB | UsageResultUnit::Count => price * value.size,
            });
        Self {
            event: value.event.to_string(),
            value: value.size,
            unit: value.unit.to_string(),
            cost,
        }
    }
}

pub async fn get_org_usage(
    parent_org: &str,
    org_id: &str,
    usage_range: &org_usage::UsageRange,
    unit: &str,
) -> Result<GetOrgUsageResponseBody, billings::BillingError> {
    let mut cycle_details = None;
    let mut pricing_map = HashMap::new();

    if let Ok(billings) =
        o2_enterprise::enterprise::cloud::customer_billings::get_by_org_id(parent_org).await
    {
        // if subscription is present, and stripe is provider , and range is cycle and subscription
        // id is present, we will try to get the cycle based usage
        if let Some(b) = billings.first()
            && b.provider == MeteringProvider::Stripe
            && let Some(id) = &b.subscription_id
        {
            pricing_map = o2_enterprise::enterprise::cloud::billings::get_pricing_map(id).await?;
            if usage_range.unit == RangeUnit::Cycle {
                let sub =
                    o2_enterprise::enterprise::cloud::billings::get_stripe_subscription(id).await?;

                let end = sub.current_period_end;
                let diff = sub.current_period_end - sub.current_period_start;
                cycle_details = Some((end, diff));
                log::info!("using end {end} diff {diff} for org {org_id} for usage query")
            }
        }
    }

    // fire the query
    let (sql, start_time, end_time) =
        org_usage::create_usage_query_sql_and_time_range(org_id, usage_range, cycle_details);

    // The main `usage` stream may not exist yet for a brand-new org. As with
    // data retention below, a missing stream should read as "no usage" rather
    // than failing the whole request.
    let mut usage_results = match get_usage(sql, start_time, end_time, false).await {
        Ok(hits) => hits
            .into_iter()
            .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
            .filter(|r| r.event.is_billable())
            .collect::<Vec<_>>(),
        Err(e) => {
            log::warn!("usage query failed for org {org_id}, treating as zero: {e}");
            Vec::new()
        }
    };

    let (data_retention_query, ..) = org_usage::create_data_retention_usage_sql_and_time_range(
        org_id,
        usage_range,
        cycle_details,
    );

    // Data-retention usage lives in a separate `data_retention_usage` stream
    // that may not exist for an org yet (e.g. no retention usage recorded). A
    // failure here (most commonly "stream not found") must NOT fail the whole
    // usage response — treat it as zero retention and return the rest.
    let mut data_retention_results =
        match get_usage(data_retention_query, start_time, end_time, false).await {
            Ok(hits) => hits
                .into_iter()
                .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
                .collect::<Vec<_>>(),
            Err(e) => {
                log::warn!(
                    "data_retention_usage query failed for org {org_id}, treating as zero: {e}"
                );
                Vec::new()
            }
        };

    usage_results.append(&mut data_retention_results);

    let data = usage_results
        .into_iter()
        .map(|v| OrgUserData::from_query_result(v, &pricing_map))
        .collect();

    let mut body = GetOrgUsageResponseBody {
        data,
        range: usage_range.to_string(),
        start_time,
        end_time,
    };
    body.convert_to_unit(unit);
    Ok(body)
}
