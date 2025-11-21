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

use config::utils::json;
use o2_enterprise::enterprise::cloud::billings::{
    self,
    org_usage::{self, OrgUsageQueryResult},
};

use crate::service::self_reporting::search::get_usage;

pub async fn get_org_usage(
    org_id: &str,
    usage_range: &org_usage::UsageRange,
) -> Result<Vec<OrgUsageQueryResult>, billings::BillingError> {
    // fire the query
    let (sql, start_time, end_time) =
        org_usage::create_usage_query_sql_and_time_range(org_id, usage_range);

    let mut usage_results = get_usage(sql, start_time, end_time)
        .await
        .map_err(|e| billings::BillingError::PartialUsageResults(e.to_string()))?
        .into_iter()
        .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
        .collect::<Vec<_>>();

    let (data_retention_query, ..) =
        org_usage::create_data_retention_usage_sql_and_time_range(org_id, usage_range);

    let mut data_retention_results = get_usage(data_retention_query, start_time, end_time)
        .await
        .map_err(|e| billings::BillingError::PartialUsageResults(e.to_string()))?
        .into_iter()
        .filter_map(|hit| json::from_value::<OrgUsageQueryResult>(hit).ok())
        .collect::<Vec<_>>();

    usage_results.append(&mut data_retention_results);
    Ok(usage_results)
}
