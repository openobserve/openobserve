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

//! AutoResolve routes: the run page, decisions on a plan, saved AutoResolves, and the internal
//! routes an AutoResolve turn reports through.

pub mod internal;
pub mod runs;
pub mod saved;

use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use openobserve_core::autoresolve::{AutoResolveError, ConnectionRefusal, autoresolve_on};
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const DISABLED_MESSAGE: &str = "AutoResolve is not enabled.";
const FAILED_MESSAGE: &str = "The request could not be completed; try again.";

/// Every route is a 404 while the gate is closed: flag, licence, signing keys or internal secret.
fn disabled() -> Option<Response> {
    (!autoresolve_on()).then(|| MetaHttpResponse::not_found(DISABLED_MESSAGE))
}

fn refusal(status: StatusCode, message: impl ToString) -> Response {
    (status, Json(MetaHttpResponse::error(status, message))).into_response()
}

fn status_of(code: u16) -> StatusCode {
    StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

/// Database and internal errors are logged, never shown: the body is one generic sentence.
fn failed(context: &str, e: impl std::fmt::Display) -> Response {
    log::error!("[autoresolve] {context}: {e}");
    refusal(StatusCode::INTERNAL_SERVER_ERROR, FAILED_MESSAGE)
}

fn autoresolve_error(context: &str, e: AutoResolveError) -> Response {
    let status = match &e {
        AutoResolveError::NotEnabled | AutoResolveError::IncidentNotFound => StatusCode::NOT_FOUND,
        AutoResolveError::StepNotRunning
        | AutoResolveError::RunInProgress
        | AutoResolveError::IncidentHasRun(_) => StatusCode::CONFLICT,
        AutoResolveError::NoConnections | AutoResolveError::ConnectionsGone => {
            StatusCode::UNPROCESSABLE_ENTITY
        }
        AutoResolveError::Admission(_) | AutoResolveError::Turn(_) => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        AutoResolveError::Connections(_) => StatusCode::BAD_REQUEST,
        AutoResolveError::Db(_) => return failed(context, e),
    };
    match e {
        AutoResolveError::Connections(e) => connection_refusal(context, e),
        e => refusal(status, e),
    }
}

/// A 400 for a chosen connection list; `connection` names the one to take out.
fn connection_refusal(context: &str, e: ConnectionRefusal) -> Response {
    let message = e.to_string();
    let connection = match e {
        ConnectionRefusal::Db(e) => return failed(context, e),
        ConnectionRefusal::NotMcp { connection } => {
            json!({ "id": connection.id, "name": connection.name })
        }
        // `connection` keeps naming one MCP, as the API documents it; the message names them all.
        ConnectionRefusal::Removed { connections } => json!(connections.first()),
        _ => return refusal(StatusCode::BAD_REQUEST, message),
    };
    let body = json!({ "code": 400, "message": message, "connection": connection });
    (StatusCode::BAD_REQUEST, Json(body)).into_response()
}

/// A person's request: the parser's text names internal fields, so it is only logged.
fn parse_body<T: DeserializeOwned>(body: &Bytes) -> Result<T, Response> {
    serde_json::from_slice(body).map_err(|e| {
        log::debug!("[autoresolve] request body refused: {e}");
        refusal(StatusCode::BAD_REQUEST, "The request body is not valid.")
    })
}

/// The model's request: it acts on the parser's detail.
fn parse_internal_body<T: DeserializeOwned>(body: &Bytes) -> Result<T, Response> {
    serde_json::from_slice(body).map_err(|e| {
        refusal(
            StatusCode::BAD_REQUEST,
            format!("The request body is not valid: {e}."),
        )
    })
}
