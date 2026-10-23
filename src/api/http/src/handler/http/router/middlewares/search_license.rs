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

use axum::{
    extract::{FromRequestParts, RawPathParams, Request},
    http::request::Parts,
    middleware::Next,
    response::Response,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::{META_ORG_ID, utils::base64};

/// Answers the search handlers' licence 429 before a gated route reads any data.
pub async fn search_license_middleware(request: Request, next: Next) -> Response {
    let (mut parts, body) = request.into_parts();
    if let Some(refused) = refusal(&mut parts).await {
        return refused;
    }
    next.run(Request::from_parts(parts, body)).await
}

async fn refusal(parts: &mut Parts) -> Option<Response> {
    // Unreadable params fall through to the closed-gate answer for an unknown org and stream.
    let (org_id, streams) = match RawPathParams::from_request_parts(parts, &()).await {
        Ok(params) => (
            param(&params, "org_id").unwrap_or_default().to_string(),
            path_streams(&params),
        ),
        Err(_) => (String::new(), Vec::new()),
    };
    refusal_for(&org_id, &streams, search_service::check_search_allowed)
}

fn param<'a>(params: &'a RawPathParams, name: &str) -> Option<&'a str> {
    params
        .iter()
        .find_map(|(key, value)| (key == name).then_some(value))
}

fn path_streams(params: &RawPathParams) -> Vec<String> {
    if let Some(stream) = param(params, "stream_name") {
        return vec![stream.to_string()];
    }
    param(params, "stream_names")
        .and_then(|encoded| base64::decode_url(encoded).ok())
        .map(|names| names.split(',').map(str::to_string).collect())
        .unwrap_or_default()
}

fn refusal_for(
    org_id: &str,
    streams: &[String],
    gate: impl Fn(&str, Option<&str>) -> Result<(), infra::errors::Error>,
) -> Option<Response> {
    if org_id == META_ORG_ID {
        return None;
    }
    let verdict = if streams.is_empty() {
        gate(org_id, None)
    } else {
        streams
            .iter()
            .try_for_each(|stream| gate(org_id, Some(stream)))
    };
    verdict.err().map(MetaHttpResponse::too_many_requests)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{Router, body::Body, http::StatusCode, routing::get};
    use infra::errors::Error;
    use tower::ServiceExt;

    use super::*;

    const BLOCKED: &str = "Search is temporarily disabled due to exceeding allotted ingestion limit. Please contact your administrator.";

    fn open(_: &str, _: Option<&str>) -> Result<(), Error> {
        Ok(())
    }

    fn closed(_: &str, _: Option<&str>) -> Result<(), Error> {
        Err(Error::Message(BLOCKED.to_string()))
    }

    fn names(streams: &[&str]) -> Vec<String> {
        streams.iter().map(|s| s.to_string()).collect()
    }

    async fn body_bytes(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    async fn streams_at(encoded: &str) -> String {
        let app = Router::new().route(
            "/{org_id}/{stream_names}/_around_multi",
            get(|params: RawPathParams| async move { path_streams(&params).join("|") }),
        );
        let request = axum::http::Request::get(format!("/acme/{encoded}/_around_multi"))
            .body(Body::empty())
            .unwrap();
        String::from_utf8(body_bytes(app.oneshot(request).await.unwrap()).await).unwrap()
    }

    #[test]
    fn open_gate_refuses_nothing() {
        assert!(refusal_for("acme", &[], open).is_none());
        assert!(refusal_for("acme", &names(&["logs"]), open).is_none());
    }

    #[tokio::test]
    async fn closed_gate_answers_the_search_handler_429() {
        let refused = refusal_for("acme", &[], closed).unwrap();
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
        let counting = |org: &str, stream: Option<&str>| {
            calls.fetch_add(1, Ordering::SeqCst);
            closed(org, stream)
        };
        assert!(refusal_for(META_ORG_ID, &names(&["logs"]), counting).is_none());
        assert!(refusal_for(META_ORG_ID, &[], counting).is_none());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn each_path_stream_reaches_the_gate() {
        let only_triggers = |_: &str, stream: Option<&str>| match stream {
            Some("triggers") => Ok(()),
            _ => Err(Error::Message(BLOCKED.to_string())),
        };
        assert!(refusal_for("acme", &names(&["triggers"]), only_triggers).is_none());
        assert!(refusal_for("acme", &names(&["logs"]), only_triggers).is_some());
        assert!(refusal_for("acme", &names(&["triggers", "logs"]), only_triggers).is_some());
    }

    #[tokio::test]
    async fn around_multi_stream_names_are_decoded() {
        assert_eq!(
            streams_at(&base64::encode_url("triggers,logs")).await,
            "triggers|logs"
        );
    }

    #[tokio::test]
    async fn undecodable_stream_names_are_gated_as_unknown() {
        assert_eq!(streams_at("!!not-base64!!").await, "");
        let asked = std::sync::Mutex::new(Vec::new());
        let recording = |_: &str, stream: Option<&str>| {
            asked.lock().unwrap().push(stream.map(str::to_string));
            closed("", None)
        };
        assert!(refusal_for("acme", &[], recording).is_some());
        assert_eq!(*asked.lock().unwrap(), vec![None]);
    }
}
