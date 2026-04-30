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

use config::utils::json;
use o2_enterprise::enterprise::cloud::billings::{
    self, MeteringProvider,
    org_usage::{self, OrgUsageQueryResult, RangeUnit},
};

use crate::{
    handler::http::models::billings::GetOrgUsageResponseBody,
    service::self_reporting::search::get_usage,
};

pub async fn get_org_usage(
    org_id: &str,
    usage_range: &org_usage::UsageRange,
    unit: &str,
) -> Result<GetOrgUsageResponseBody, billings::BillingError> {
    let mut cycle_details = None;

    if let Ok(billings) =
        o2_enterprise::enterprise::cloud::customer_billings::get_by_org_id(org_id).await
    {
        // if subscription is present, and stripe is provider , and range is cycle and subscription
        // id is present, we will try to get the cycle based usage
        if let Some(b) = billings.first() {
            if b.provider == MeteringProvider::Stripe
                && usage_range.unit == RangeUnit::Cycle
                && let Some(id) = &b.subscription_id
            {
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

    let mut usage_results = get_usage(sql, start_time, end_time, false)
        .await
        .map_err(|e| billings::BillingError::PartialUsageResults(e.to_string()))?
        .into_iter()
        .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
        .filter(|r| r.event.is_billable())
        .collect::<Vec<_>>();

    let (data_retention_query, ..) = org_usage::create_data_retention_usage_sql_and_time_range(
        org_id,
        usage_range,
        cycle_details,
    );

    let mut data_retention_results = get_usage(data_retention_query, start_time, end_time, false)
        .await
        .map_err(|e| billings::BillingError::PartialUsageResults(e.to_string()))?
        .into_iter()
        .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
        .collect::<Vec<_>>();

    usage_results.append(&mut data_retention_results);

    let mut body = GetOrgUsageResponseBody {
        data: usage_results.into_iter().map(From::from).collect(),
        range: usage_range.to_string(),
        start_time,
        end_time,
    };
    body.convert_to_unit(unit);
    Ok(body)
}
