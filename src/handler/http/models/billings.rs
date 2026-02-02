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

//! These models define the schemas of HTTP request and response JSON bodies in
//! billings API endpoints.

use o2_enterprise::enterprise::cloud::billings as cloud_billings;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize)]
pub struct CheckoutSessionDetailRequestQuery {
    pub session_id: String,
    pub status: String,
    pub plan: String,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ListInvoicesResponseBody {
    #[schema(value_type = Vec<utoipa::openapi::Object>)]
    pub invoices: Vec<cloud_billings::StripeInvoice>,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ListSubscriptionResponseBody {
    pub subscription_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
}

impl From<cloud_billings::CustomerBilling> for ListSubscriptionResponseBody {
    fn from(value: cloud_billings::CustomerBilling) -> Self {
        Self {
            subscription_type: value.subscription_type.to_string(),
            customer_id: value.customer_id,
        }
    }
}

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GetOrgUsageResponseBody {
    pub data: Vec<OrgUserData>,
    pub range: String,
}

impl GetOrgUsageResponseBody {
    pub fn convert_to_unit(&mut self, unit: &str) {
        let target_unit = unit.to_ascii_lowercase();
        for usage_data in self.data.iter_mut() {
            let current_unit = usage_data.unit.to_ascii_lowercase();
            match (current_unit.as_str(), target_unit.as_str()) {
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
    pub unit: String,
}

impl From<cloud_billings::org_usage::OrgUsageQueryResult> for OrgUserData {
    fn from(value: cloud_billings::org_usage::OrgUsageQueryResult) -> Self {
        Self {
            event: value.event.to_string(),
            value: value.size,
            unit: value.unit.to_string(),
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NewUserAttribution {
    pub from: String,
    pub company: String,
}
