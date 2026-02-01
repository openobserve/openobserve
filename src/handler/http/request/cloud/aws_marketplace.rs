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

use axum::{
    extract::{Path, Query},
    response::Response,
};
use axum_extra::extract::cookie::{Cookie, SameSite};
use config::meta::user::UserRole;
use o2_enterprise::enterprise::aws_marketplace::{api as aws_mp_api, db as aws_mp_db};
use serde::{Deserialize, Serialize};

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::extractors::Headers,
    service::{organization, users},
};

/// Form data from AWS Marketplace POST
#[derive(Debug, Deserialize)]
pub struct AwsMarketplaceRegistrationForm {
    #[serde(rename = "x-amzn-marketplace-token")]
    pub token: String,
    #[serde(rename = "x-amzn-marketplace-agreement-id")]
    pub agreement_id: Option<String>,
    #[serde(rename = "x-amzn-marketplace-product-id")]
    pub product_id: Option<String>,
    #[serde(rename = "x-amzn-marketplace-fulfillment-url")]
    pub fulfillment_url: Option<String>,
}

/// AwsMarketplaceRegistration - Entry point from AWS Marketplace
///
/// This endpoint receives the POST from AWS Marketplace when a customer subscribes.
/// It saves the token in a cookie and redirects to the login page.
/// Full path: POST /marketplace/aws/register
pub async fn aws_marketplace_register(
    axum::Form(form): axum::Form<AwsMarketplaceRegistrationForm>,
) -> Response {
    log::info!(
        "[AWS SAAS] Received marketplace registration: product_id={:?}, agreement_id={:?}",
        form.product_id,
        form.agreement_id
    );

    // Get the Dex login URL
    let login_url = {
        use o2_dex::service::auth::get_dex_login;
        let login_data = get_dex_login();

        // Store PKCE state
        let state = login_data.state.clone();
        if let Err(e) = crate::service::kv::set(
            crate::handler::http::auth::validator::PKCE_STATE_ORG,
            &state,
            state.clone().into(),
        )
        .await
        {
            log::error!("[AWS SAAS] Failed to store PKCE state: {}", e);
        }

        login_data.url
    };

    // Create cookie with the marketplace token
    // Use SameSite::Lax to allow the cookie to be sent on redirect from Dex
    let mut cookie = Cookie::new("aws_marketplace_token", form.token.clone());
    cookie.set_path("/");
    cookie.set_http_only(false); // Allow JavaScript to read it
    cookie.set_secure(true);
    cookie.set_same_site(SameSite::Lax);
    cookie.set_expires(time::OffsetDateTime::now_utc() + time::Duration::hours(4)); // Token expires in 4 hours

    log::info!("[AWS SAAS] Redirecting to login: {}", login_url);

    MetaHttpResponse::found(login_url, Some(cookie.to_string()))
}

/// Request payload for linking AWS Marketplace subscription
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

/// LinkAwsMarketplaceSubscription
#[utoipa::path(
    post,
    path="/{org_id}/aws-marketplace/link-subscription",
    context_path = "/api",
    tag = "AWS Marketplace",
    operation_id = "LinkAwsMarketplaceSubscription",
    summary = "Link AWS Marketplace subscription to organization",
    description = "Exchanges AWS Marketplace token for customer info and creates pending subscription",
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

    log::info!(
        "[AWS SAAS] Link subscription request: org_id={}, user={}",
        org_id,
        email
    );

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

    // Only admins and root users can link AWS Marketplace subscriptions
    if user.role != UserRole::Admin && user.role != UserRole::Root {
        return MetaHttpResponse::forbidden(
            "Only organization administrators can link AWS Marketplace subscriptions",
        );
    }

    // 3. Check if org is free tier (cannot link paid orgs)
    match organization::is_org_in_free_trial_period(org_id).await {
        Ok(false) => {
            return MetaHttpResponse::bad_request(
                "Only free tier organizations can be linked to AWS Marketplace",
            );
        }
        Err(e) => {
            log::error!("[AWS SAAS] Error checking free trial status: {}", e);
            return MetaHttpResponse::internal_error("Failed to check organization status");
        }
        Ok(true) => {} // Continue - org is in free trial
    }

    // 4. Check if org is already linked to marketplace
    match aws_mp_db::get_by_org_id(org_id).await {
        Ok(Some(existing))
            if existing.marketplace_status == aws_mp_api::MarketplaceStatus::Active =>
        {
            return MetaHttpResponse::conflict(
                "This organization is already linked to AWS Marketplace",
            );
        }
        Err(e) => {
            log::error!("[AWS SAAS] Database error checking org: {}", e);
            return MetaHttpResponse::internal_error("Failed to check organization status");
        }
        _ => {} // OK to proceed
    }

    // 5. Resolve AWS Marketplace token
    let resolved = match aws_mp_api::resolve_customer_token(&req.token).await {
        Ok(customer) => customer,
        Err(e) => {
            log::error!("[AWS SAAS] Failed to resolve customer token: {}", e);

            if e.to_string().contains("TokenExpired") || e.to_string().contains("expired") {
                return MetaHttpResponse::bad_request(
                    "Your registration link has expired. Please subscribe again from AWS Marketplace.",
                );
            }
            return MetaHttpResponse::internal_error(format!(
                "Failed to validate AWS Marketplace token: {}",
                e
            ));
        }
    };

    // 6. Check if customer_identifier already exists
    match aws_mp_db::get_by_marketplace_customer_id(&resolved.customer_identifier).await {
        Ok(Some(existing)) => {
            use o2_enterprise::enterprise::aws_marketplace::db::ExistingSubscriptionAction;

            let action = aws_mp_db::handle_existing_subscription(
                &existing,
                org_id,
                &resolved.customer_identifier,
            );

            return match action {
                ExistingSubscriptionAction::AlreadySubscribed {
                    customer_identifier,
                } => MetaHttpResponse::json(serde_json::json!({
                    "success": true,
                    "customer_identifier": customer_identifier,
                    "message": "You are already subscribed!"
                })),
                ExistingSubscriptionAction::LinkedToDifferentOrg { existing_org_id } => {
                    MetaHttpResponse::conflict(format!(
                        "This AWS account is already linked to organization '{existing_org_id}'. Each AWS account can only have one active subscription.",
                    ))
                }
                ExistingSubscriptionAction::PendingActivation {
                    customer_identifier,
                } => MetaHttpResponse::json(serde_json::json!({
                    "success": true,
                    "customer_identifier": customer_identifier,
                    "message": "Subscription is being activated..."
                })),
                ExistingSubscriptionAction::StalePending => MetaHttpResponse::conflict(
                    "A pending subscription exists but was not completed. Please contact support.",
                ),
                ExistingSubscriptionAction::PreviousSubscriptionExists { status } => {
                    MetaHttpResponse::conflict(format!(
                        "You previously had a subscription (status: {}). Please contact support to reactivate.",
                        status
                    ))
                }
            };
        }
        Ok(None) => {} // Good, proceed with creation
        Err(e) => {
            log::error!("[AWS SAAS] Database error checking customer_id: {}", e);
            return MetaHttpResponse::internal_error("Failed to check subscription status");
        }
    }

    // 7. Create pending subscription
    match aws_mp_db::create_pending_subscription(email, org_id, &resolved).await {
        Ok(_) => {
            log::info!(
                "[AWS SAAS] Created pending subscription: customer_id={}, org_id={}",
                resolved.customer_identifier,
                org_id
            );

            MetaHttpResponse::json(LinkSubscriptionResponse {
                success: true,
                customer_identifier: resolved.customer_identifier,
                message: None,
            })
        }
        Err(e) => {
            log::error!("[AWS SAAS] Failed to create pending subscription: {}", e);
            MetaHttpResponse::internal_error(format!("Failed to create subscription record: {}", e))
        }
    }
}

/// GetAwsMarketplaceActivationStatus
#[utoipa::path(
    get,
    path="/{org_id}/aws-marketplace/activation-status",
    context_path = "/api",
    tag = "AWS Marketplace",
    operation_id = "GetAwsMarketplaceActivationStatus",
    summary = "Check AWS Marketplace subscription activation status",
    description = "Poll this endpoint to check if AWS Marketplace subscription is activated. Requires admin role.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("customer_id" = Option<String>, Query, description = "Optional AWS Marketplace customer identifier for verification"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "Bad Request (customer_id mismatch)", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden (not admin)", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
)]
pub async fn activation_status(
    Path(org_id): Path<String>,
    Query(query): Query<std::collections::HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let email = user_email.user_id.as_str();
    let org_id = org_id.as_str();

    log::debug!(
        "[AWS SAAS] Checking activation status for org_id={}",
        org_id
    );

    // Verify user has access to this org and is an admin
    let user = match users::get_user(Some(org_id), email).await {
        Some(u) => u,
        None => {
            return MetaHttpResponse::forbidden(
                "User not found or not authorized for this organization",
            );
        }
    };

    // Only admins and root users can check subscription status
    if user.role != UserRole::Admin && user.role != UserRole::Root {
        return MetaHttpResponse::forbidden(
            "Only organization administrators can check subscription status",
        );
    }

    // Get the subscription for this organization
    let billing = match aws_mp_db::get_by_org_id(org_id).await {
        Ok(Some(billing)) => billing,
        Ok(None) => {
            return MetaHttpResponse::not_found(
                "No AWS Marketplace subscription found for this organization",
            );
        }
        Err(e) => {
            log::error!("[AWS SAAS] Database error: {}", e);
            return MetaHttpResponse::internal_error("Failed to check subscription status");
        }
    };

    // If customer_id is provided in query, verify it matches the org's subscription
    if let Some(customer_id) = query.get("customer_id") {
        if *customer_id != billing.customer_identifier {
            MetaHttpResponse::bad_request(
                "The provided customer_id does not match this organization's subscription",
            );
        }
    }
    // If customer_id is not provided, skip verification and proceed (it's optional)

    // Build response based on status
    let response = aws_mp_db::build_activation_status_response(&billing);

    MetaHttpResponse::json(response)
}
