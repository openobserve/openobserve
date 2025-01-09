// Copyright 2024 OpenObserve Inc.
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

use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use config::get_config;
use o2_enterprise::enterprise::cloud::billings as o2_cloud_billings;

use crate::{
    common::{meta::http::HttpResponse as MetaHttpResponse, utils::auth::UserEmail},
    handler::http::models::billings::ListInvoicesResponseBody,
    service::organization,
};

/// GetSubscriptionUrl
#[utoipa::path(
    context_path = "/api",
    tag = "Billings",
    operation_id = "GetSubscriptionUrl",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[get("/{org_id}/billings/hosted_subscription_url")]
pub async fn create_checkout_session(
    path: web::Path<String>,
    user_email: UserEmail,
    req: HttpRequest,
) -> impl Responder {
    let org_id = path.into_inner();
    let email = user_email.user_id.as_str();

    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();

    let Some(sub_type) = query.get("plan") else {
        return o2_cloud_billings::BillingError::SubTypeMissing.into_http_response();
    };

    if organization::get_org(&org_id).await.is_none() {
        return o2_cloud_billings::BillingError::OrgNotFound.into_http_response();
    }

    // TODO(taiming): confirm response type
    // TODO(taiming): confirm base url vs web url
    match o2_cloud_billings::create_checkout_session(
        &get_config().common.base_uri,
        email,
        &org_id,
        sub_type,
    )
    .await
    {
        Err(err) => err.into_http_response(),
        Ok(None) => HttpResponse::Ok().body("Subscription updated successfully."),
        Ok(Some(_url)) => HttpResponse::Ok().body("Checkout session created successfully."),
    }
}

/// ProcessSessionDetail
#[utoipa::path(
    context_path = "/api",
    tag = "Billings",
    operation_id = "ProcessSessionDetail",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[get("/{org_id}/billings/checkout_session_detail")]
pub async fn process_session_detail(path: web::Path<String>, req: HttpRequest) -> impl Responder {
    let org_id = path.into_inner();

    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let Some(session_id) = query.get("session_id") else {
        return o2_cloud_billings::BillingError::SessionIdMissing.into_http_response();
    };
    if query.get("status").map_or(true, |s| !s.eq("success")) {
        return o2_cloud_billings::BillingError::InvalidStatus.into_http_response();
    }
    let Some(sub_type) = query.get("plan") else {
        return o2_cloud_billings::BillingError::SubTypeMissing.into_http_response();
    };

    if organization::get_org(&org_id).await.is_none() {
        return o2_cloud_billings::BillingError::OrgNotFound.into_http_response();
    }

    match o2_cloud_billings::process_checkout_session_details(session_id, sub_type).await {
        Err(e) => e.into_http_response(),
        Ok(()) => {
            let redirect_url = format!("{}/billings/plans", &get_config().common.base_uri);
            HttpResponse::Ok().body(redirect_url)
        }
    }
}

/// Unsubscribe
#[utoipa::path(
    context_path = "/api",
    tag = "Billings",
    operation_id = "Unsubscribe",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[get("/{org_id}/billings/unsubscribe")]
pub async fn unsubscribe(path: web::Path<String>, user_email: UserEmail) -> impl Responder {
    let org_id = path.into_inner();
    let email = user_email.user_id.as_str();

    if organization::get_org(&org_id).await.is_none() {
        return o2_cloud_billings::BillingError::OrgNotFound.into_http_response();
    }

    match o2_cloud_billings::unsubscribe(&org_id, email).await {
        Err(err) => err.into_http_response(),
        Ok(()) => {
            HttpResponse::Ok().body("Subscription will be cancelled at the end of billing cycle.")
        }
    }
}

/// ListInvoices
#[utoipa::path(
    context_path = "/api",
    tag = "Billings",
    operation_id = "ListInvoices",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[get("/{org_id}/billings/invoices")]
pub async fn list_invoices(path: web::Path<String>, user_email: UserEmail) -> impl Responder {
    let org_id = path.into_inner();
    let email = user_email.user_id.as_str();
    if organization::get_org(&org_id).await.is_none() {
        return o2_cloud_billings::BillingError::OrgNotFound.into_http_response();
    }
    match o2_cloud_billings::list_invoice(&org_id, email).await {
        Ok(invoices) => {
            let body = ListInvoicesResponseBody { invoices };
            HttpResponse::Ok().json(body)
        }
        Err(e) => e.into_http_response(),
    }
}

/// ListSubscription
#[utoipa::path(
    context_path = "/api",
    tag = "Billings",
    operation_id = "ListSubscription",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound",  content_type = "application/json", body = HttpResponse),
        (status = 500, description = "Failure",   content_type = "application/json", body = HttpResponse),
    ),
)]
#[get("/{org_id}/billings/list_subscription")]
pub async fn list_subscription(_path: web::Path<String>, _user_email: UserEmail) -> impl Responder {
    HttpResponse::Ok().body("Unimplemented")
}

// BillingsError extension
pub trait IntoHttpResponse {
    fn into_http_response(self) -> HttpResponse;
}

impl IntoHttpResponse for o2_cloud_billings::BillingError {
    fn into_http_response(self) -> HttpResponse {
        match self {
            o2_cloud_billings::BillingError::InfraError(err) => {
                MetaHttpResponse::internal_error(err)
            }
            o2_cloud_billings::BillingError::OrgNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            o2_cloud_billings::BillingError::SessionIdNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            o2_cloud_billings::BillingError::SubscriptionNotFound => {
                MetaHttpResponse::not_found(self.to_string())
            }
            o2_cloud_billings::BillingError::StripeError(err) => MetaHttpResponse::bad_request(err),
            _ => MetaHttpResponse::bad_request(self.to_string()),
        }
    }
}
