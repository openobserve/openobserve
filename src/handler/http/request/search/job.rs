// Copyright 2023 Zinc Labs Inc.
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

use std::io::Error;

use actix_web::{post, web, HttpResponse};

use crate::handler::grpc::cluster_rpc::search_server::Search;

#[post("/{org_id}/_cancel_job")]
pub async fn cancel_job(
    _org_id: web::Path<String>,
    grpc_server: web::Data<crate::service::search::Searcher>,
) -> Result<HttpResponse, Error> {
    let request = crate::handler::grpc::cluster_rpc::CancelJobRequest { job_id: 0 };
    let res = grpc_server
        .get_ref()
        .cancel_job(tonic::Request::new(request))
        .await;
    match res {
        Ok(_) => Ok(HttpResponse::Ok().body("hello")),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}

#[post("/{org_id}/_job_status")]
pub async fn job_status(
    _org_id: web::Path<String>,
    grpc_server: web::Data<crate::service::search::Searcher>,
) -> Result<HttpResponse, Error> {
    let request = crate::handler::grpc::cluster_rpc::GetJobStatusRequest { job_id: 0 };
    let res = grpc_server
        .get_ref()
        .get_job_status(tonic::Request::new(request))
        .await;
    match res {
        Ok(_) => Ok(HttpResponse::Ok().body("hello")),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}
