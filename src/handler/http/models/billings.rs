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
    /// Billing provider: "stripe", "aws", or "azure". Omitted for external-contract subs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

impl From<cloud_billings::CustomerBilling> for ListSubscriptionResponseBody {
    fn from(value: cloud_billings::CustomerBilling) -> Self {
        let provider = match value.provider {
            cloud_billings::MeteringProvider::NoOp => None,
            other => Some(other.to_string()),
        };
        Self {
            subscription_type: value.subscription_type.to_string(),
            customer_id: value.customer_id,
            provider,
        }
    }
}

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

#[cfg(test)]
mod tests {
    use cloud_billings::{
        CustomerBilling, MeteringProvider, SubscriptionType, org_usage::OrgUsageQueryResult,
    };

    use super::*;

    fn billing_with_provider(provider: MeteringProvider) -> CustomerBilling {
        let mut cb = CustomerBilling::new("admin@example.com", "org-x");
        cb.provider = provider;
        cb.subscription_type = SubscriptionType::Rate;
        cb.customer_id = Some("cus_abc".to_string());
        cb
    }

    #[test]
    fn test_list_subscription_response_omits_provider_for_noop() {
        // External-contract orgs (NoOp provider) must hide the provider field
        // from the API response — that's the contract the frontend relies on
        // to detect "this is an external contract" vs. a real billing backend.
        let mut cb = billing_with_provider(MeteringProvider::NoOp);
        cb.subscription_type = SubscriptionType::ExternalContract;
        cb.customer_id = Some("custom".to_string());

        let body: ListSubscriptionResponseBody = cb.into();

        assert!(body.provider.is_none());
        assert_eq!(body.subscription_type, "external-contract");
        assert_eq!(body.customer_id.as_deref(), Some("custom"));

        let json = serde_json::to_value(&body).unwrap();
        assert!(
            json.get("provider").is_none(),
            "provider field must be omitted from JSON for NoOp, got {json}"
        );
    }

    #[test]
    fn test_list_subscription_response_includes_provider_for_stripe() {
        let body: ListSubscriptionResponseBody =
            billing_with_provider(MeteringProvider::Stripe).into();

        assert_eq!(body.provider.as_deref(), Some("stripe"));
        assert_eq!(body.subscription_type, "pay-as-you-go");
    }

    #[test]
    fn test_list_subscription_response_includes_provider_for_aws_and_azure() {
        let aws: ListSubscriptionResponseBody = billing_with_provider(MeteringProvider::Aws).into();
        assert_eq!(aws.provider.as_deref(), Some("aws"));

        let azure: ListSubscriptionResponseBody =
            billing_with_provider(MeteringProvider::Azure).into();
        assert_eq!(azure.provider.as_deref(), Some("azure"));
    }

    #[test]
    fn test_convert_to_unit_gb_to_mb() {
        let mut body = GetOrgUsageResponseBody {
            data: vec![OrgUserData {
                event: "ingestion".to_string(),
                value: 2.0,
                unit: "GB".to_string(),
            }],
            range: "30d".to_string(),
            start_time: 0,
            end_time: 0,
        };

        body.convert_to_unit("MB");

        assert_eq!(body.data[0].unit, "MB");
        assert!((body.data[0].value - 2048.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_to_unit_mb_to_gb() {
        let mut body = GetOrgUsageResponseBody {
            data: vec![OrgUserData {
                event: "ingestion".to_string(),
                value: 1024.0,
                unit: "MB".to_string(),
            }],
            range: "30d".to_string(),
            start_time: 0,
            end_time: 0,
        };

        body.convert_to_unit("GB");

        assert_eq!(body.data[0].unit, "GB");
        assert!((body.data[0].value - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_to_unit_is_case_insensitive() {
        let mut body = GetOrgUsageResponseBody {
            data: vec![OrgUserData {
                event: "ingestion".to_string(),
                value: 1.0,
                unit: "gb".to_string(),
            }],
            range: "30d".to_string(),
            start_time: 0,
            end_time: 0,
        };

        body.convert_to_unit("mb");

        assert_eq!(body.data[0].unit, "MB");
        assert!((body.data[0].value - 1024.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_to_unit_no_op_when_units_match() {
        let mut body = GetOrgUsageResponseBody {
            data: vec![OrgUserData {
                event: "ingestion".to_string(),
                value: 5.5,
                unit: "GB".to_string(),
            }],
            range: "7d".to_string(),
            start_time: 0,
            end_time: 0,
        };

        body.convert_to_unit("GB");

        assert_eq!(body.data[0].unit, "GB");
        assert!((body.data[0].value - 5.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_convert_to_unit_unknown_pair_is_ignored() {
        let mut body = GetOrgUsageResponseBody {
            data: vec![OrgUserData {
                event: "ingestion".to_string(),
                value: 100.0,
                unit: "Bytes".to_string(),
            }],
            range: "1d".to_string(),
            start_time: 0,
            end_time: 0,
        };

        body.convert_to_unit("MB");

        // No conversion path defined for Bytes → MB; record stays untouched.
        assert_eq!(body.data[0].unit, "Bytes");
        assert!((body.data[0].value - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_org_user_data_from_query_result() {
        // OrgUsageQueryResult only derives Deserialize, so build it from JSON.
        // UsageEvent uses default (PascalCase) serde, not snake_case.
        let json = serde_json::json!({
            "event": "Ingestion",
            "unit": "GB",
            "size": 12.5,
            "start_time":0,
            "end_time":0
        });
        let q: OrgUsageQueryResult = serde_json::from_value(json).unwrap();

        let data: OrgUserData = q.into();

        assert!((data.value - 12.5).abs() < f64::EPSILON);
        assert_eq!(data.unit, "GB");
        assert_eq!(data.event, "Ingestion");
    }
}
