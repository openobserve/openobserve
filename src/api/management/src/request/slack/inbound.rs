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

//! Slack's inbound requests (section 7.1): no O2 auth; ENT checks the Slack signature.

use axum::{
    body::Bytes,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

/// Larger bodies get 413 from the per-route `DefaultBodyLimit` before the handler runs.
pub const MAX_BODY_BYTES: usize = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Event,
    Command,
    Interaction,
}

/// `POST /api/slack/events`: Events API, including `url_verification`.
pub async fn events(headers: HeaderMap, body: Bytes) -> Response {
    receive(Kind::Event, &headers, &body).await
}

/// `POST /api/slack/commands`: the `/o2` slash command.
pub async fn commands(headers: HeaderMap, body: Bytes) -> Response {
    receive(Kind::Command, &headers, &body).await
}

/// `POST /api/slack/interactions`: buttons, menus and modal submits.
pub async fn interactions(headers: HeaderMap, body: Bytes) -> Response {
    receive(Kind::Interaction, &headers, &body).await
}

#[cfg(feature = "enterprise")]
async fn receive(kind: Kind, headers: &HeaderMap, body: &[u8]) -> Response {
    use o2_enterprise::enterprise::slack::{InboundKind, inbound};
    let kind = match kind {
        Kind::Event => InboundKind::Event,
        Kind::Command => InboundKind::Command,
        Kind::Interaction => InboundKind::Interaction,
    };
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let slack_headers = inbound::InboundHeaders {
        timestamp: header("x-slack-request-timestamp"),
        signature: header("x-slack-signature"),
    };
    let reply = inbound::receive(kind, &slack_headers, body).await;
    reply_response(reply.status, reply.body)
}

#[cfg(not(feature = "enterprise"))]
async fn receive(_kind: Kind, _headers: &HeaderMap, _body: &[u8]) -> Response {
    reply_response(
        404,
        Some(serde_json::json!({"code": 404, "message": "Slack is not enabled"})),
    )
}

fn reply_response(status: u16, body: Option<serde_json::Value>) -> Response {
    let status = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    match body {
        Some(json) => (status, axum::Json(json)).into_response(),
        None => status.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read(response: Response) -> (StatusCode, Vec<u8>) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, bytes.to_vec())
    }

    #[tokio::test]
    async fn every_inbound_route_is_404_while_slack_is_off() {
        for kind in [Kind::Event, Kind::Command, Kind::Interaction] {
            let (status, body) = read(receive(kind, &HeaderMap::new(), b"{}").await).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{kind:?}");
            let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(
                v,
                serde_json::json!({"code": 404, "message": "Slack is not enabled"})
            );
        }
    }

    #[tokio::test]
    async fn an_empty_interaction_ack_has_no_body() {
        let (status, body) = read(reply_response(200, None)).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.is_empty());
    }
}
