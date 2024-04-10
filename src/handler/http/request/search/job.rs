// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{delete, get, web, HttpResponse};

#[cfg(feature = "enterprise")]
#[delete("/search_job/{session_id}")]
pub async fn cancel_job(session_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let res = crate::service::search::cancel_job(&session_id.into_inner()).await;
    match res {
        Ok(status) => Ok(HttpResponse::Ok().json(status)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}

#[cfg(not(feature = "enterprise"))]
#[delete("/search_job/{session_id}")]
pub async fn cancel_job(_session_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/search_job/status")]
pub async fn job_status() -> Result<HttpResponse, Error> {
    let res = crate::service::search::job_status().await;
    match res {
        Ok(job_status) => Ok(HttpResponse::Ok().json(job_status)),
        Err(e) => Ok(HttpResponse::InternalServerError().body(format!("{:?}", e))),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/search_job/status")]
pub async fn job_status() -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}
