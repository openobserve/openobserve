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

use axum::{extract::Request, middleware::Next, response::Response};
#[cfg(feature = "enterprise")]
use axum::{
    extract::{FromRequestParts, RawPathParams},
    http::request::Parts,
};
#[cfg(any(feature = "enterprise", test))]
use common::meta::http::HttpResponse as MetaHttpResponse;
#[cfg(any(feature = "enterprise", test))]
use config::{META_ORG_ID, meta::stream::StreamType};

/// Answers the search handlers' 429, for the licence or an org's usage block, before a gated
/// route reads any data.
pub async fn search_license_middleware(request: Request, next: Next) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // a usage block is per org, so every request is checked, not only a closed licence
        let (mut parts, body) = request.into_parts();
        if let Some(refused) = refusal(&mut parts).await {
            return refused;
        }
        next.run(Request::from_parts(parts, body)).await
    }
    #[cfg(not(feature = "enterprise"))]
    next.run(request).await
}

/// A path stream never exempts: the handler may read other streams through its SQL.
#[cfg(feature = "enterprise")]
async fn refusal(parts: &mut Parts) -> Option<Response> {
    let params = RawPathParams::from_request_parts(parts, &()).await.ok();
    let org_id = params
        .as_ref()
        .and_then(|params| {
            params
                .iter()
                .find_map(|(key, value)| (key == "org_id").then_some(value))
        })
        .unwrap_or_default();
    refusal_for(org_id, search_service::check_search_allowed)
}

#[cfg(any(feature = "enterprise", test))]
fn refusal_for(
    org_id: &str,
    gate: impl Fn(&str, Option<(&str, StreamType)>) -> Result<(), infra::errors::Error>,
) -> Option<Response> {
    if org_id == META_ORG_ID {
        return None;
    }
    gate(org_id, None).err().map(MetaHttpResponse::search_refused)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::http::StatusCode;
    use infra::errors::Error;

    use super::*;

    const BLOCKED: &str = "Search is temporarily disabled due to exceeding allotted ingestion limit. Please contact your administrator.";

    fn open(_: &str, _: Option<(&str, StreamType)>) -> Result<(), Error> {
        Ok(())
    }

    fn closed(_: &str, _: Option<(&str, StreamType)>) -> Result<(), Error> {
        Err(Error::Message(BLOCKED.to_string()))
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    fn usage_blocked(_: &str, _: Option<(&str, StreamType)>) -> Result<(), Error> {
        Err(Error::ErrorCode(infra::errors::ErrorCodes::ContractUsageLimitExceeded {
            meters: "ingestion".to_string(),
            until: 1_793_577_600_000_000,
        }))
    }

    #[tokio::test]
    async fn a_usage_block_answers_429_with_its_40003_body() {
        let refused = refusal_for("acme", usage_blocked).unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(refused.headers().get("X-Error-Message").unwrap(), "40003");
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes(refused).await).unwrap();
        assert_eq!(json["code"], 40003);
        assert_eq!(json["error_detail"], "ingestion");
        assert_eq!(
            json["message"],
            "Usage limit exceeded on your contract (ingestion). Metered features are blocked until 2026-11-02 00:00 UTC. Contact your account manager."
        );
        assert!(refusal_for("_meta", usage_blocked).is_none());
    }

    #[test]
    fn open_gate_refuses_nothing() {
        assert!(refusal_for("acme", open).is_none());
    }

    #[tokio::test]
    async fn closed_gate_answers_the_search_handler_429() {
        let refused = refusal_for("acme", closed).unwrap();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(refused.headers().get("retry-after").is_none());
        let body = body_bytes(refused).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"code": 429, "message": format!("Error# {BLOCKED}")})
        );
        let handler_body = body_bytes(MetaHttpResponse::too_many_requests(Error::Message(
            BLOCKED.to_string(),
        )))
        .await;
        assert_eq!(body, handler_body);
    }

    #[test]
    fn meta_org_is_never_refused_and_never_asks_the_gate() {
        let calls = AtomicUsize::new(0);
        let counting = |org: &str, stream: Option<(&str, StreamType)>| {
            calls.fetch_add(1, Ordering::SeqCst);
            closed(org, stream)
        };
        assert!(refusal_for(META_ORG_ID, counting).is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_gate_is_asked_about_the_org_and_never_a_stream() {
        let asked = std::sync::Mutex::new(Vec::new());
        let recording = |org: &str, stream: Option<(&str, StreamType)>| {
            asked
                .lock()
                .unwrap()
                .push((org.to_string(), stream.map(|(name, _)| name.to_string())));
            closed(org, stream)
        };
        assert!(refusal_for("acme", recording).is_some());
        assert_eq!(*asked.lock().unwrap(), vec![("acme".to_string(), None)]);
    }
}
