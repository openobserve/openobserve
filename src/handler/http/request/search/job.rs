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

#[post("/_cancel_job/{session_id}")]
pub async fn cancel_job(
    session_id: web::Path<String>,
    grpc_server: web::Data<crate::service::search::Searcher>,
) -> Result<HttpResponse, Error> {
    let res = grpc_server
        .get_ref()
        .cancel_job_enter(&session_id.into_inner())
        .await;
    match res {
        Ok(status) => Ok(HttpResponse::Ok().json(status)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}

#[post("/_job_status")]
pub async fn job_status(
    grpc_server: web::Data<crate::service::search::Searcher>,
) -> Result<HttpResponse, Error> {
    let res = grpc_server.get_ref().job_status_enter().await;
    match res {
        Ok(job_status) => Ok(HttpResponse::Ok().json(job_status)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}
