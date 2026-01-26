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

use axum::{
    body::Body,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use config::{get_config, utils::json};
use o2_enterprise::enterprise::cloud::billings::{self as o2_cloud_billings};

use super::IntoHttpResponse;
use crate::{
    common::{
        meta::{http::HttpResponse as MetaHttpResponse, telemetry},
        utils::{auth::UserEmail, redirect_response::RedirectResponseBuilder},
    },
    handler::http::{
        extractors::Headers,
        models::billings::{
            CheckoutSessionDetailRequestQuery, ListInvoicesResponseBody,
            ListSubscriptionResponseBody,
        },
    },
    service::{
        organization,
        self_reporting::cloud_events::{CloudEvent, EventType, enqueue_cloud_event},
    },
};

/// GetSubscriptionUrl
#[utoipa::path(
    get,
    path = "/{org_id}/billings/hosted_subscription_url",
    context_path = "/api",
    tag = "Billings",
    operation_id = "GetSubscriptionUrl",
    summary = "Get subscription URL for checkout session",
    description = "Creates a checkout session URL for subscription upgrades and billing management",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn create_checkout_session(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let email = user_email.user_id.as_str();

    let Some(sub_type) = query.get("plan") else {
        return o2_cloud_billings::BillingError::SubTypeMissing.into_http_response();
    };

    let org = match organization::get_org(&org_id).await {
        None => return o2_cloud_billings::BillingError::OrgNotFound.into_http_response(),
        Some(org) => org,
    };

    match o2_cloud_billings::create_checkout_session(
        &get_config().common.web_url,
        email,
        &org_id,
        sub_type,
    )
    .await
    {
        Err(err) => err.into_http_response(),
        Ok(o2_cloud_billings::CheckoutResult::RedirectUrl(redirect_url)) => {
            log::debug!("redirect url: {redirect_url}");
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: Some(email.to_string()),
                event: EventType::SubscriptionChanged,
                subscription_type: Some(sub_type.to_owned()),
                stream_name: None,
            })
            .await;
            RedirectResponseBuilder::new(&redirect_url)
                .build()
                .redirect_http()
        }
        Ok(o2_cloud_billings::CheckoutResult::Session(checkout_session)) => {
            log::debug!("created checkout session");
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: Some(email.to_string()),
                event: EventType::CheckoutSessionCreated,
                subscription_type: Some(sub_type.to_owned()),
                stream_name: None,
            })
            .await;
            MetaHttpResponse::json(checkout_session)
        }
    }
}

/// ProcessSessionDetail
#[utoipa::path(
    get,
    path = "/{org_id}/billings/checkout_session_detail",
    context_path = "/api",
    tag = "Billings",
    operation_id = "ProcessSessionDetail",
    summary = "Process checkout session detail after payment",
    description = "Processes successful checkout session details and updates subscription status",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
)]
pub async fn process_session_detail(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<CheckoutSessionDetailRequestQuery>,
) -> Response {
    let email = user_email.user_id.as_str();
    if query.status != "success" {
        return o2_cloud_billings::BillingError::InvalidStatus.into_http_response();
    }

    let org = match organization::get_org(&org_id).await {
        None => return o2_cloud_billings::BillingError::OrgNotFound.into_http_response(),
        Some(org) => org,
    };

    log::debug!("handling checkout session detail");
    match o2_cloud_billings::process_checkout_session_details(
        &org_id,
        &query.session_id,
        &query.plan,
    )
    .await
    {
        Err(e) => e.into_http_response(),
        Ok(()) => {
            let redirect_url = format!(
                "{}/web/billings/plans?org_identifier={}",
                &get_config().common.web_url,
                &org_id
            );
            // Send event to ActiveCampaign
            let segment_event_data = HashMap::from([
                ("email".to_string(), json::Value::String(email.to_string())),
                (
                    "plan".to_string(),
                    json::Value::String(query.plan.to_string()),
                ),
            ]);
            let mut telemetry_instance = telemetry::Telemetry::new();
            telemetry_instance
                .send_track_event(
                    "OpenObserve - New subscription started",
                    Some(segment_event_data.clone()),
                    false,
                    false,
                )
                .await;

            telemetry_instance
                .send_keyevent_track_event(
                    "OpenObserve - New subscription started",
                    Some(segment_event_data),
                    false,
                    false,
                )
                .await;
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: None,
                event: EventType::SubscriptionCreated,
                subscription_type: Some(query.plan.clone()),
                stream_name: None,
            })
            .await;
            RedirectResponseBuilder::new(&redirect_url)
                .build()
                .redirect_http()
        }
    }
}

/// Unsubscribe
#[utoipa::path(
    get,
    path = "/{org_id}/billings/unsubscribe",
    context_path = "/api",
    tag = "Billings",
    operation_id = "Unsubscribe",
    summary = "Unsubscribe from current billing plan",
    description = "Cancels the current subscription at the end of the billing cycle",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn unsubscribe(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let email = user_email.user_id.as_str();

    let org = match organization::get_org(&org_id).await {
        Some(org) => org,
        None => return o2_cloud_billings::BillingError::OrgNotFound.into_http_response(),
    };

    match o2_cloud_billings::unsubscribe(&org_id, email).await {
        Err(err) => err.into_http_response(),
        Ok(()) => {
            enqueue_cloud_event(CloudEvent {
                org_id: org.identifier.clone(),
                org_name: org.name.clone(),
                org_type: org.org_type.clone(),
                user: Some(user_email.user_id.to_string()),
                event: EventType::SubscriptionDeleted,
                subscription_type: None,
                stream_name: None,
            })
            .await;
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/plain")
                .body(Body::from(
                    "Subscription will be cancelled at the end of billing cycle.",
                ))
                .unwrap()
        }
    }
}

/// ListInvoices
#[utoipa::path(
    get,
    path = "/{org_id}/billings/invoices",
    context_path = "/api",
    tag = "Billings",
    operation_id = "ListInvoices",
    summary = "List organization billing invoices",
    description = "Retrieves all billing invoices for the specified organization",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_invoices(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let email = user_email.user_id.as_str();
    if organization::get_org(&org_id).await.is_none() {
        return o2_cloud_billings::BillingError::OrgNotFound.into_http_response();
    }
    match o2_cloud_billings::list_invoice(&org_id, email).await {
        Ok(invoices) => {
            let body = ListInvoicesResponseBody {
                invoices: invoices.unwrap_or_default(),
            };
            MetaHttpResponse::json(body)
        }
        Err(e) => e.into_http_response(),
    }
}

/// ListSubscription
#[utoipa::path(
    get,
    path = "/{org_id}/billings/list_subscription",
    context_path = "/api",
    tag = "Billings",
    operation_id = "ListSubscription",
    summary = "List organization subscription details",
    description = "Gets current subscription information and billing details for the organization",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn list_subscription(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let email = user_email.user_id.as_str();
    match o2_cloud_billings::get_subscription(email, &org_id).await {
        Ok(Some(cb)) => MetaHttpResponse::json(ListSubscriptionResponseBody::from(cb)),
        Ok(None) => MetaHttpResponse::json(ListSubscriptionResponseBody::from(
            o2_cloud_billings::CustomerBilling::new(email, &org_id),
        )),
        Err(e) => e.into_http_response(),
    }
}

/// CreateBillingPortalSession
#[utoipa::path(
    get,
    path = "/{org_id}/billings/billing_portal",
    context_path = "/api",
    tag = "Billings",
    operation_id = "CreateBillingPortalSession",
    summary = "Create customer billing portal session",
    description = "Creates a Stripe customer portal session for managing subscription and billing",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound",  content_type = "application/json", body = ()),
        (status = 500, description = "Failure",   content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn create_billing_portal_session(
    Path(org_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(customer_id) = query.get("customer_id") else {
        return o2_cloud_billings::BillingError::CustomerIdMissing.into_http_response();
    };

    let return_url = format!(
        "{}/web/billings/plans?update_org={}&org_identifier={}",
        get_config().common.web_url,
        chrono::Utc::now().timestamp_millis(),
        org_id
    );

    match o2_cloud_billings::create_customer_portal_session(customer_id, &return_url).await {
        Err(err) => err.into_http_response(),
        Ok(billing_session) => MetaHttpResponse::json(billing_session),
    }
}

/// StripeWebhookEvent
#[utoipa::path(
    post,
    path = "/stripe",
    context_path = "/webhook",
    tag = "Billings",
    summary = "Handle Stripe webhook events",
    description = "Processes webhook events from Stripe for subscription changes and payments",
    request_body(content = String, description = "Raw Stripe webhook payload"),
    responses(
        (status = 200, description="Status OK", content_type = "application/json", body = ())
    )
)]
pub async fn handle_stripe_event(headers: HeaderMap, payload: axum::body::Bytes) -> Response {
    // Convert payload bytes to string
    let payload_str = match String::from_utf8(payload.to_vec()) {
        Ok(str) => str,
        Err(_) => {
            return o2_cloud_billings::BillingError::InvalidStripePayload.into_http_response();
        }
    };

    // Get Stripe signature from headers
    let signature = match headers.get("Stripe-Signature") {
        Some(sig) => match sig.to_str() {
            Ok(s) => s,
            Err(_) => {
                return o2_cloud_billings::BillingError::InvalidStripeSig.into_http_response();
            }
        },
        None => return o2_cloud_billings::BillingError::StripeSigMissing.into_http_response(),
    };

    match o2_cloud_billings::handle_strip_wb_event(signature, &payload_str).await {
        Ok(orgs) => {
            for (org_id, sub_type) in orgs {
                let org = match organization::get_org(&org_id).await {
                    None => continue,
                    Some(org) => org,
                };
                enqueue_cloud_event(CloudEvent {
                    org_id: org.identifier.clone(),
                    org_name: org.name.clone(),
                    org_type: org.org_type.clone(),
                    user: None,
                    event: EventType::SubscriptionDeleted,
                    subscription_type: Some(sub_type.to_string()),
                    stream_name: None,
                })
                .await;
            }

            MetaHttpResponse::json(json::json!({
                "status": "success"
            }))
        }
        Err(err) => err.into_http_response(),
    }
}
