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

use axum::{extract::Path, response::Response};
use config::meta::user::UserRole;
use o2_enterprise::enterprise::cloud::billings;
use serde::{Deserialize, Serialize};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
    service::{organization, users},
};

/// Request payload for linking Azure Marketplace subscription
#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct LinkSubscriptionRequest {
    pub token: String,
}

/// Response from link-subscription endpoint
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct LinkSubscriptionResponse {
    pub success: bool,
    pub customer_identifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// LinkAzureMarketplaceSubscription
#[utoipa::path(
    post,
    path = "/{org_id}/azure-marketplace/link-subscription",
    context_path = "/api",
    tag = "Azure Marketplace",
    operation_id = "LinkAzureMarketplaceSubscription",
    summary = "Link Azure Marketplace subscription to organization",
    description = "Processes the token provided by azure and links the subscription to organization",
    security(
        ("Authorization" = [])
    ),
    request_body(content = LinkSubscriptionRequest),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = LinkSubscriptionResponse),
        (status = 400, description = "Bad Request (token expired, invalid)", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden (not admin)", content_type = "application/json", body = ()),
        (status = 409, description = "Conflict (already subscribed)", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
)]
pub async fn link_subscription(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<LinkSubscriptionRequest>,
) -> Response {
    let email = user_email.user_id.as_str();
    let org_id = org_id.as_str();

    // 1. Validate organization exists
    let _org = match organization::get_org(org_id).await {
        Some(org) => org,
        None => {
            return MetaHttpResponse::not_found("Organization not found");
        }
    };

    // 2. Verify user is admin of the organization
    let user = match users::get_user(Some(org_id), email).await {
        Some(u) => u,
        None => {
            return MetaHttpResponse::forbidden(
                "User not found or not authorized for this organization",
            );
        }
    };

    // Only admins and root users can link Azure Marketplace subscriptions
    if user.role != UserRole::Admin && user.role != UserRole::Root {
        return MetaHttpResponse::forbidden(
            "Only organization administrators can link Azure Marketplace subscriptions",
        );
    }

    // 3. Check if org is free tier (cannot link paid orgs)
    let subscription = match billings::get_billing_by_org_id(org_id).await {
        Ok(v) => v,
        Err(e) => {
            log::error!("[AZURE SAAS] Error checking free trial status: {}", e);
            return MetaHttpResponse::internal_error("Failed to check organization status");
        }
    };

    if let Some(sub) = subscription {
        if !sub.subscription_type.is_free_sub() {
            return MetaHttpResponse::bad_request(
                "Only free tier organizations can be linked to Azure Marketplace",
            );
        }
    }

    let req_id = config::ider::generate_trace_id();
    log::info!(
        "[AZURE SAAS] Link subscription request: org_id={}, user={}, req_id={}",
        org_id,
        email,
        req_id
    );

    let res = match billings::azure_utils::process_token(&req.token, &req_id).await {
        Ok(r) => r,
        Err(e) => {
            log::info!("[AZURE SAAS] Error processing token for org {org_id} user {email} : {e}");
            return MetaHttpResponse::bad_request(e);
        }
    };
    let sub_id = res.id.clone();

    if let Err(e) = billings::azure_utils::activate_subscription(&res, &req_id).await {
        log::error!(
            "[AZURE SAAS] Error activating subscription for org {org_id} user {email} sub_id: {sub_id} : {e}",
        );
        return MetaHttpResponse::bad_request(e);
    }

    if let Err(e) = billings::azure_utils::save_subscription(org_id, email, res, &req_id).await {
        log::error!(
            "[AZURE SAAS] Error saving subscription for org {org_id} user {email} sub_id: {sub_id} : {e}",
        );
        MetaHttpResponse::bad_request(e);
    }

    log::info!(
        "subscription successfully linked and activated org_id={org_id}, email={email}, req_id={req_id}"
    );

    MetaHttpResponse::created("successfully linked azure subscription")
}
