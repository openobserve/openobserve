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

use actix_http::ws::ProtocolError;
use actix_web::{error::ResponseError, http::StatusCode};
use actix_ws::CloseReason;
use serde_json::error::Error as SerdeError;
use thiserror::Error;

use crate::service::websocket_events::WsServerEvents;

#[derive(Error, Debug)]
pub enum WsError {
    #[error("ProtocolError# {0}")]
    ProtocolError(#[from] ProtocolError),

    #[error("SerdeError# {0}")]
    SerdeError(#[from] SerdeError),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Response channel not found: {0}")]
    ResponseChannelNotFound(String),

    #[error("Response channel registered for trace_id {0} not found")]
    ResponseChannelClosed(String),

    #[error("Querier WS connection not available: {0}")]
    QuerierWsConnNotAvailable(String),

    #[error("Querier http url {0} not valid")]
    QuerierUrlInvalid(String),

    #[error("Querier WS url error: {0}")]
    QuerierWSUrlError(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl ResponseError for WsError {
    fn status_code(&self) -> StatusCode {
        match self {
            WsError::ProtocolError(_) => StatusCode::BAD_REQUEST,
            WsError::SerdeError(_) => StatusCode::BAD_REQUEST,
            WsError::ConnectionError(_) => StatusCode::SERVICE_UNAVAILABLE,
            WsError::SessionNotFound(_) => StatusCode::BAD_REQUEST,
            WsError::QuerierUrlInvalid(_) => StatusCode::INTERNAL_SERVER_ERROR,
            WsError::QuerierWSUrlError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            WsError::QuerierWsConnNotAvailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            WsError::Other(_) => StatusCode::INTERNAL_SERVER_ERROR,
            WsError::ResponseChannelNotFound(_) => StatusCode::INTERNAL_SERVER_ERROR,
            WsError::ResponseChannelClosed(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

pub type WsResult<T> = Result<T, WsError>;

#[derive(Debug)]
pub enum DisconnectMessage {
    Error(ErrorMessage),
    Close(Option<CloseReason>),
}

#[derive(Debug)]
pub struct ErrorMessage {
    pub ws_server_events: WsServerEvents,
    pub should_disconnect: bool,
}

impl ErrorMessage {
    pub fn new(ws_error: WsError, trace_id: Option<String>, request_id: Option<String>) -> Self {
        let should_client_retry = ws_error.should_client_retry();
        let should_disconnect = ws_error.should_disconnect();
        Self {
            ws_server_events: ws_error.into_ws_server_events(
                trace_id,
                request_id,
                should_client_retry,
            ),
            should_disconnect,
        }
    }

    pub fn new_unauthorized(trace_id: Option<String>) -> Self {
        let ws_server_events = WsServerEvents::Error {
            code: StatusCode::UNAUTHORIZED.into(),
            message: "Cookie expired. Please retry".to_string(),
            error_detail: None,
            trace_id,
            request_id: None,
            // client should not retry on the same ws session, only when cookie is expired
            should_client_retry: false,
        };
        Self {
            ws_server_events,
            // cookie expired, don't disconnect the ws session until the session is drained
            should_disconnect: false,
        }
    }
}

impl WsError {
    /// Disconnect the ws conn to client from router
    pub fn should_disconnect(&self) -> bool {
        false
        // matches!(
        //     self,
        //     WsError::ProtocolError(_) | WsError::QuerierWsConnNotAvailable(_)
        // )
    }

    pub fn should_client_retry(&self) -> bool {
        matches!(self, WsError::ConnectionError(_))
    }

    pub fn into_ws_server_events(
        self,
        trace_id: Option<String>,
        request_id: Option<String>,
        should_client_retry: bool,
    ) -> WsServerEvents {
        let code = self.status_code();
        WsServerEvents::Error {
            code: code.as_u16(),
            message: code.to_string(),
            error_detail: Some(self.to_string()),
            trace_id,
            request_id,
            should_client_retry,
        }
    }
}
