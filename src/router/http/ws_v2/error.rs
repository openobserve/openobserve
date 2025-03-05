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

use actix_web::{error::ResponseError, http::StatusCode};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum WsError {
    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Session error: {0}")]
    SessionError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Message error: {0}")]
    MessageError(String),

    #[error("Querier not available: {0}")]
    QuerierNotAvailable(String),

    #[error("Circuit breaker open for querier: {0}")]
    CircuitBreakerOpen(String),

    #[error("Timeout error: {0}")]
    Timeout(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl ResponseError for WsError {
    fn status_code(&self) -> StatusCode {
        match self {
            WsError::ConnectionError(_) => StatusCode::SERVICE_UNAVAILABLE,
            WsError::SessionError(_) => StatusCode::BAD_REQUEST,
            WsError::SessionNotFound(_) => StatusCode::BAD_REQUEST,
            WsError::MessageError(_) => StatusCode::BAD_REQUEST,
            WsError::QuerierNotAvailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            WsError::CircuitBreakerOpen(_) => StatusCode::SERVICE_UNAVAILABLE,
            WsError::Timeout(_) => StatusCode::REQUEST_TIMEOUT,
            WsError::Other(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

pub type WsResult<T> = Result<T, WsError>;
