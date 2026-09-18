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

use axum::{
    extract::{Path, Query},
    response::Response,
};
use hashbrown::HashMap;
use o2_enterprise::enterprise::cloud::{
    billing_group,
    billings::{self, MeteringProvider},
};

use super::IntoHttpResponse;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    models::billings::GetOrgUsageResponseBody, service::org_usage,
};

/// GetUsageData
#[utoipa::path(
    get,
    path = "/{org_id}/billings/data_usage/{usage_date}",
    context_path = "/api",
    tag = "Billings",
    operation_id = "GetUsageData",
    summary = "Get organization usage data",
    description = "Retrieves detailed usage metrics and statistics for the specified organization",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("usage_date" = String, Path, description = "Organization usage query range"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(GetOrgUsageResponseBody)),
        (status = 404, description = "Organization usage not found", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
)]
pub async fn get_org_usage(
    Path((org_id, query_range)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Ok(billings) =
        o2_enterprise::enterprise::cloud::customer_billings::get_by_org_id(&org_id).await
    {
        // if subscription is present, and stripe is provider , and range is cycle and subscription
        // id is present, we will try to get the cycle based usage
        if let Some(b) = billings.first()
            && b.provider == MeteringProvider::Stripe
            && let Some(id) = &b.customer_id
        {
            match o2_enterprise::enterprise::cloud::billings::get_metering_details(id).await {
                Ok(v) => {
                    return MetaHttpResponse::json(serde_json::json!({
                        "price_details":v
                    }));
                }
                Err(e) => {
                    return MetaHttpResponse::internal_error(format!(
                        "error getting metering details : {e}"
                    ));
                }
            }
        }
    }
    MetaHttpResponse::json(serde_json::json!({
        "price_details": serde_json::Value::Null,
    }))
}
