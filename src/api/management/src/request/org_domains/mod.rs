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

use axum::{Json, extract::Path, response::Response};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{META_ORG_ID, meta::status_pages::CreateDomainRequest};
use db::organization::get_org_setting;
use infra::table::org_domain_requests::Status;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{org_domain_ownership, org_domain_requests};
use serde::Deserialize;

use crate::service::auth::UserEmail;

#[derive(Deserialize)]
pub struct RequestDecision {
    reason: String,
}
pub async fn get_linked_domain(Path(org_id): Path<String>) -> Response {
    match org_domain_ownership::get_domains_for_org(&org_id).await {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => {
            log::error!("error listing domains for org {org_id} : {e}");
            MetaHttpResponse::internal_error(format!("error listing domains : {e}"))
        }
    }
}

pub async fn link_domain(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<CreateDomainRequest>,
) -> Response {
    let org_settings = match get_org_setting(&org_id).await {
        Ok(v) => v,
        Err(e) => {
            return MetaHttpResponse::internal_error(format!("error getting org settings : {e}"));
        }
    };
    let domain = body.domain.trim().to_lowercase();

    match org_domain_ownership::get_verified_org_for_domain(&domain).await {
        Ok(Some(v)) => {
            log::info!(
                "org {org_id} tried to link domain {domain} but it is already verfied by org {v}"
            );
            return MetaHttpResponse::bad_request(
                "this domain is already linked by some other org",
            );
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "error getting org domain linking : {e}"
            ));
        }
        _ => {}
    }

    if org_settings
        .domain_org_mappings
        .iter()
        .find(|v| v.domain.to_lowercase() == domain)
        .is_some()
    {
        return MetaHttpResponse::bad_request("this domain is already mapped to this org");
    }
    match org_domain_ownership::save_org_domain_mapping(&org_id, &domain).await {
        Ok(_) => {
            log::info!(
                "successfully created org domain ownership entry for {org_id} domain {domain} by user {}",
                user.user_id
            );
            MetaHttpResponse::ok("successfully created mapping request")
        }
        Err(e) => {
            log::error!("error saving domain {domain} link to org {org_id} : {e}",);
            MetaHttpResponse::internal_error(format!("error saving org domain linking : {e}"))
        }
    }
}

pub async fn raise_request(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<CreateDomainRequest>,
) -> Response {
    let domain = body.domain.trim().to_lowercase();

    match org_domain_ownership::get_verified_org_for_domain(&domain).await {
        Ok(Some(v)) => {
            log::info!(
                "org {org_id} tried to link domain {domain} but it is already verfied by org {v}"
            );
            return MetaHttpResponse::bad_request("this domain is already linked by some org");
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "error getting org domain linking : {e}"
            ));
        }
        _ => {}
    }

    match org_domain_requests::save_org_domain_request(&org_id, &domain, &user.user_id).await {
        Ok(_) => {
            log::info!(
                "successfully created org domain ownership request for {org_id} domain {domain} by user {}",
                user.user_id
            );
            MetaHttpResponse::ok("successfully created ownership request")
        }
        Err(e) => {
            log::error!("error saving domain {domain} link request to org {org_id} : {e}",);
            MetaHttpResponse::internal_error(format!(
                "error saving org domain ownership request : {e}"
            ))
        }
    }
}

pub async fn list_requests(Path(org_id): Path<String>) -> Response {
    let requests = if org_id == META_ORG_ID {
        org_domain_requests::list_all_req().await
    } else {
        org_domain_requests::list_by_org(&org_id).await
    };

    match requests {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => {
            log::error!("error listing org domain mapping requests for org {org_id} : {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

pub async fn approve_request(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<RequestDecision>,
) -> Response {
    if org_id != META_ORG_ID {
        return MetaHttpResponse::forbidden("operation not allowed");
    }
    let reason = body.reason.trim().to_string();

    let req = match org_domain_requests::get_req_by_id(&id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return MetaHttpResponse::not_found("request with given id not found");
        }
        Err(e) => {
            log::error!("error getting org domain request by id {id} for approval : {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    match org_domain_ownership::get_verified_org_for_domain(&req.domain).await {
        Ok(Some(v)) => {
            return MetaHttpResponse::bad_request(format!(
                "this domain is already linked to org {v}, request cannot be processed"
            ));
        }
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "error getting org domain linking : {e}"
            ));
        }
        _ => {}
    }

    if let Err(e) =
        org_domain_requests::update_status(&id, &user.user_id, Status::Approved, reason).await
    {
        log::error!("error approving domain ownership request {id} : {e}",);
        return MetaHttpResponse::internal_error(format!(
            "error approving org domain ownership request : {e}"
        ));
    }

    match org_domain_ownership::link_from_meta(&org_id, &req.domain).await {
        Ok(_) => MetaHttpResponse::ok("request approved successfully"),
        Err(e) => {
            log::error!("error linking the domain to org after request approval : {e}");
            MetaHttpResponse::internal_error(e)
        }
    }
}

pub async fn reject_request(
    Path((org_id, id)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
    Json(body): Json<RequestDecision>,
) -> Response {
    if org_id != META_ORG_ID {
        return MetaHttpResponse::forbidden("operation not allowed");
    }
    let reason = body.reason.trim().to_string();

    let req = match org_domain_requests::get_req_by_id(&id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return MetaHttpResponse::not_found("request with given id not found");
        }
        Err(e) => {
            log::error!("error getting org domain request by id {id} for approval : {e}");
            return MetaHttpResponse::internal_error(e);
        }
    };

    if let Err(e) =
        org_domain_requests::update_status(&id, &user.user_id, Status::Rejected, reason).await
    {
        log::error!("error rejecting domain ownership request {id} : {e}",);
        return MetaHttpResponse::internal_error(format!(
            "error approving org domain ownership request : {e}"
        ));
    }
    log::info!(
        "org domain request {id} for org {} successfully rejected by user {}",
        req.org_id,
        user.user_id
    );
    MetaHttpResponse::ok("request rejected successfully")
}

pub async fn delete_linked_domain(
    Path((org_id, did)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let domain = did.trim().to_lowercase();
    let record = match org_domain_ownership::get_domain_org_record(&org_id, &domain).await {
        Ok(v) => v,
        Err(e) => {
            return MetaHttpResponse::internal_error(format!(
                "error getting org domain linking : {e}"
            ));
        }
    };

    let Some(model) = record else {
        return MetaHttpResponse::bad_request("org domain link not found");
    };

    match org_domain_ownership::delete_linked_domain(model).await {
        Ok(_) => {
            log::info!(
                "removed domain link of {domain} from org {org_id} by user {}",
                user.user_id
            );
            MetaHttpResponse::ok("successfully deleted mapping")
        }
        Err(e) => {
            log::error!(
                "error removing domain link of {domain} from org {org_id} by user {} : {e}",
                user.user_id
            );
            MetaHttpResponse::internal_error(format!("error deleting org domain linking : {e}"))
        }
    }
}

pub async fn verify_domain(
    Path((org_id, did)): Path<(String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    let domain = did.trim().to_lowercase();
    match org_domain_ownership::verify_domain_now(&org_id, &domain).await {
        Ok(_) => MetaHttpResponse::ok("successfully verified mapping"),
        Err(e) => {
            log::error!(
                "error verifying domain {domain} for org {org_id} by user {}: {e}",
                user.user_id
            );
            MetaHttpResponse::bad_request(e)
        }
    }
}
