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

//! What a hook request becomes for the workflow's steps, and the request facts read before that.

use base64::{Engine, prelude::BASE64_STANDARD};
use http::HeaderMap;
use infra::table::workflow_http_triggers::AuthMode;
use serde_json::{Map, Value};

use super::{
    HookReason,
    credentials::{SECRET_PREFIX, TOKEN_PREFIX},
    signature::{MAX_WEBHOOK_ID_LEN, is_printable_ascii},
};

pub const HEADER_ALLOWLIST: [&str; 14] = [
    "content-type",
    "content-length",
    "user-agent",
    "x-request-id",
    "x-correlation-id",
    "traceparent",
    "tracestate",
    "webhook-id",
    "webhook-timestamp",
    "idempotency-key",
    "x-github-event",
    "x-github-delivery",
    "x-event-type",
    "x-o2-dry-run",
];
pub const REFUSED_QUERY_NAMES: [&str; 5] = ["token", "access_token", "api_key", "apikey", "secret"];
pub const MAX_META_HEADERS_BYTES: usize = 8 * 1024;
pub const MAX_META_QUERY_BYTES: usize = 2 * 1024;
pub const EVENT_TYPE: &str = "webhook";
/// Set only on HTTP runs, so a step can tell them apart from the workflow's own trigger kind.
pub const TRIGGER_SOURCE: &str = "http";
pub const DRY_RUN_HEADER: &str = "x-o2-dry-run";
const ENCODED_TOKEN_PREFIX: &str = "o2wh%5f";
const ENCODED_SECRET_PREFIX: &str = "whsec%5f";
const HOOK_SEGMENTS: &str = "/workflows/hooks/";

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct HookInput {
    pub meta: HookMeta,
    pub data: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct HookMeta {
    pub event_type: &'static str,
    pub trigger_source: &'static str,
    pub trigger_id: String,
    pub run_id: String,
    pub received_at: i64,
    pub query: Map<String, Value>,
    pub headers: Map<String, Value>,
}

/// Only the trigger and run segments and the query carry what a caller pastes; the org cannot.
pub fn credential_in_url(path: &str, query: Option<&str>) -> bool {
    let hook_segments = path
        .split_once(HOOK_SEGMENTS)
        .map_or(path, |(_, tail)| tail);
    hook_segments.split('/').any(is_credential_value)
        || query.is_some_and(|q| {
            url::form_urlencoded::parse(q.as_bytes()).any(|(name, value)| {
                REFUSED_QUERY_NAMES
                    .iter()
                    .any(|refused| name.eq_ignore_ascii_case(refused))
                    || is_credential_value(&name)
                    || is_credential_value(&value)
            })
        })
}

pub fn map_body(body: &[u8]) -> Vec<Value> {
    match serde_json::from_slice::<Value>(body) {
        Ok(Value::Array(items)) => items,
        Ok(object @ Value::Object(_)) => vec![object],
        _ => match std::str::from_utf8(body) {
            Ok(text) => vec![serde_json::json!({ "body": text })],
            Err(_) => vec![serde_json::json!({ "body_base64": BASE64_STANDARD.encode(body) })],
        },
    }
}

/// Walks the allowlist in its fixed order, so the cap drops the same headers on every call.
pub fn kept_headers(headers: &HeaderMap) -> Map<String, Value> {
    let mut kept = Map::new();
    let mut used = 0;
    for name in HEADER_ALLOWLIST {
        let values: Vec<&str> = headers
            .get_all(name)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .collect();
        if values.is_empty() {
            continue;
        }
        let value = values.join(", ");
        let size = name.len() + value.len();
        if used + size > MAX_META_HEADERS_BYTES {
            continue;
        }
        used += size;
        kept.insert(name.to_string(), Value::String(value));
    }
    kept
}

pub fn kept_query(query: Option<&str>) -> Map<String, Value> {
    let mut kept = Map::new();
    let mut used = 0;
    for (name, value) in url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()) {
        let size = name.len() + value.len();
        if used + size > MAX_META_QUERY_BYTES {
            continue;
        }
        used += size;
        let value = Value::String(value.into_owned());
        match kept.get_mut(name.as_ref()) {
            Some(Value::Array(values)) => values.push(value),
            Some(existing) => *existing = Value::Array(vec![existing.take(), value]),
            None => {
                kept.insert(name.into_owned(), value);
            }
        }
    }
    kept
}

pub fn build_input(
    trigger_id: &str,
    run_id: &str,
    received_at_us: i64,
    headers: &HeaderMap,
    query: Option<&str>,
    body: &[u8],
) -> HookInput {
    HookInput {
        meta: HookMeta {
            event_type: EVENT_TYPE,
            trigger_source: TRIGGER_SOURCE,
            trigger_id: trigger_id.to_string(),
            run_id: run_id.to_string(),
            received_at: received_at_us,
            query: kept_query(query),
            headers: kept_headers(headers),
        },
        data: map_body(body),
    }
}

pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(http::header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    scheme.eq_ignore_ascii_case("bearer").then(|| token.trim())
}

pub fn idempotency_key(headers: &HeaderMap, mode: AuthMode) -> Result<Option<String>, HookReason> {
    let name = match mode {
        AuthMode::Token => "idempotency-key",
        AuthMode::Signature => "webhook-id",
    };
    let Some(value) = headers.get(name) else {
        return Ok(None);
    };
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_WEBHOOK_ID_LEN
        || !bytes.iter().copied().all(is_printable_ascii)
    {
        return Err(HookReason::InvalidIdempotencyKey);
    }
    Ok(Some(String::from_utf8_lossy(bytes).into_owned()))
}

pub fn is_dry_run(headers: &HeaderMap) -> bool {
    headers
        .get(DRY_RUN_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("true"))
}

/// Raw path segments are not percent-decoded, so the encoded underscore is matched too.
pub fn is_credential_value(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        TOKEN_PREFIX,
        SECRET_PREFIX,
        ENCODED_TOKEN_PREFIX,
        ENCODED_SECRET_PREFIX,
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use http::HeaderValue;
    use serde_json::json;

    use super::*;

    fn header_map(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(
                http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn credential_names_in_the_query_are_refused() {
        for query in [
            "token=x",
            "a=1&ACCESS_TOKEN=x",
            "api_key=x",
            "ApiKey=x",
            "secret",
            "secret=",
        ] {
            assert!(
                credential_in_url("/api/v2/o/workflows/hooks/t", Some(query)),
                "{query}"
            );
        }
        assert!(credential_in_url("/x", Some("v=o2wh_abc")));
        assert!(credential_in_url("/x", Some("v=whsec_abc")));
        assert!(
            credential_in_url("/x", Some("v=o2wh%5Fabc")),
            "a percent-encoded prefix is refused"
        );
    }

    #[test]
    fn a_param_named_key_is_allowed() {
        assert!(!credential_in_url(
            "/api/v2/o/workflows/hooks/t",
            Some("key=deploy")
        ));
        assert!(!credential_in_url(
            "/api/v2/o/workflows/hooks/t",
            Some("tokens=1&secretary=2")
        ));
        assert!(!credential_in_url("/api/v2/o/workflows/hooks/t", None));
    }

    #[test]
    fn a_prefixed_value_in_the_path_is_refused() {
        assert!(credential_in_url(
            "/api/v2/o/workflows/hooks/o2wh_abc",
            None
        ));
        assert!(credential_in_url(
            "/api/v2/o/workflows/hooks/t/runs/whsec_abc",
            None
        ));
        assert!(credential_in_url(
            "/api/v2/o/workflows/hooks/O2WH%5Fabc",
            None
        ));
        assert!(!credential_in_url(
            "/api/v2/o/workflows/hooks/xo2wh_abc",
            None
        ));
    }

    #[test]
    fn only_segments_after_hooks_are_checked() {
        assert!(!credential_in_url(
            "/api/v2/whsec_lab/workflows/hooks/t1",
            None
        ));
        assert!(!credential_in_url(
            "/o2wh_base/api/v2/whsec_lab/workflows/hooks/t1/runs/r1",
            None
        ));
        assert!(credential_in_url(
            "/api/v2/whsec_lab/workflows/hooks/o2wh_abc",
            None
        ));
        assert!(credential_in_url(
            "/api/v2/whsec_lab/workflows/hooks/t1",
            Some("v=whsec_abc")
        ));
    }

    #[test]
    fn an_array_body_maps_to_itself() {
        assert_eq!(map_body(br#"[{"a":1},2]"#), vec![json!({"a":1}), json!(2)]);
        assert_eq!(map_body(b"[]"), Vec::<Value>::new());
    }

    #[test]
    fn an_object_body_is_wrapped() {
        assert_eq!(
            map_body(br#"{"event":"deploy"}"#),
            vec![json!({"event":"deploy"})]
        );
    }

    #[test]
    fn text_body_maps_to_body_field() {
        assert_eq!(map_body(b"hello"), vec![json!({"body":"hello"})]);
        assert_eq!(map_body(b"42"), vec![json!({"body":"42"})]);
        assert_eq!(map_body(b""), vec![json!({"body":""})]);
    }

    #[test]
    fn binary_body_maps_to_body_base64() {
        let bytes = [0xff_u8, 0x00, 0xfe];
        assert_eq!(
            map_body(&bytes),
            vec![json!({"body_base64": BASE64_STANDARD.encode(bytes)})]
        );
    }

    #[test]
    fn only_allowlisted_headers_reach_meta() {
        let headers = header_map(&[
            ("Content-Type", "application/json"),
            ("authorization", "Bearer o2wh_secret"),
            ("cookie", "s=1"),
            ("webhook-signature", "v1,abc"),
            ("x-api-key", "k"),
            ("x-github-event", "push"),
            ("x-custom", "1"),
        ]);
        let kept = kept_headers(&headers);
        assert_eq!(kept.get("content-type"), Some(&json!("application/json")));
        assert_eq!(kept.get("x-github-event"), Some(&json!("push")));
        assert_eq!(kept.len(), 2, "{kept:?}");
    }

    #[test]
    fn idempotency_key_header_is_kept() {
        let kept = kept_headers(&header_map(&[("Idempotency-Key", "deploy-42")]));
        assert_eq!(kept.get("idempotency-key"), Some(&json!("deploy-42")));
    }

    #[test]
    fn headers_are_capped_at_8_kib() {
        let big = "a".repeat(5000);
        let headers = header_map(&[
            ("user-agent", &big),
            ("x-request-id", &big),
            ("content-type", "text/plain"),
        ]);
        let kept = kept_headers(&headers);
        let size: usize = kept
            .iter()
            .map(|(k, v)| k.len() + v.as_str().map_or(0, str::len))
            .sum();
        assert!(size <= MAX_META_HEADERS_BYTES, "{size}");
        assert!(kept.contains_key("user-agent"));
        assert!(!kept.contains_key("x-request-id"));
        assert!(kept.contains_key("content-type"));
    }

    #[test]
    fn query_is_capped_at_2_kib() {
        let query = format!("a=1&b={}&c=3&a=2", "x".repeat(3000));
        let kept = kept_query(Some(&query));
        assert_eq!(kept.get("a"), Some(&json!(["1", "2"])));
        assert_eq!(kept.get("c"), Some(&json!("3")));
        assert!(!kept.contains_key("b"));
        assert_eq!(kept_query(Some("k=v%20w")).get("k"), Some(&json!("v w")));
        assert!(kept_query(None).is_empty());
    }

    #[test]
    fn hook_input_has_meta_and_data() {
        let headers = header_map(&[("content-type", "application/json")]);
        let input = build_input(
            "t1",
            "r1",
            1_792_579_200_000_000,
            &headers,
            Some("k=v"),
            br#"{"a":1}"#,
        );
        assert_eq!(
            serde_json::to_value(&input).unwrap(),
            json!({
                "meta": {
                    "event_type": "webhook",
                    "trigger_source": "http",
                    "trigger_id": "t1",
                    "run_id": "r1",
                    "received_at": 1_792_579_200_000_000_i64,
                    "query": {"k": "v"},
                    "headers": {"content-type": "application/json"},
                },
                "data": [{"a": 1}],
            })
        );
    }

    #[test]
    fn received_at_is_microseconds() {
        let now = config::utils::time::now_micros();
        let input = build_input("t", "r", now, &HeaderMap::new(), None, b"[]");
        assert_eq!(input.meta.received_at, now);
        assert!(
            input.meta.received_at > 1_000_000_000_000_000,
            "µs since the epoch"
        );
    }

    #[test]
    fn only_a_bearer_authorization_carries_the_token() {
        let token = "o2wh_abc";
        assert_eq!(
            bearer_token(&header_map(&[("authorization", "Bearer o2wh_abc")])),
            Some(token)
        );
        assert_eq!(
            bearer_token(&header_map(&[("authorization", "bearer o2wh_abc")])),
            Some(token)
        );
        assert_eq!(
            bearer_token(&header_map(&[("authorization", "Basic o2wh_abc")])),
            None
        );
        assert_eq!(
            bearer_token(&header_map(&[("x-api-key", "o2wh_abc")])),
            None
        );
        assert_eq!(bearer_token(&HeaderMap::new()), None);
    }

    #[test]
    fn idempotency_keys_are_printable_ascii_up_to_255() {
        let token = AuthMode::Token;
        assert_eq!(idempotency_key(&HeaderMap::new(), token), Ok(None));
        assert_eq!(
            idempotency_key(&header_map(&[("idempotency-key", "deploy-42")]), token),
            Ok(Some("deploy-42".to_string()))
        );
        assert_eq!(
            idempotency_key(&header_map(&[("webhook-id", "msg_1")]), AuthMode::Signature),
            Ok(Some("msg_1".to_string()))
        );
        assert_eq!(
            idempotency_key(&header_map(&[("webhook-id", "msg_1")]), token),
            Ok(None),
            "token mode keys on Idempotency-Key only"
        );
        for bad in ["", &"k".repeat(256)] {
            assert_eq!(
                idempotency_key(&header_map(&[("idempotency-key", bad)]), token),
                Err(HookReason::InvalidIdempotencyKey),
                "{bad:?}"
            );
        }
        let mut tabbed = HeaderMap::new();
        tabbed.insert("idempotency-key", HeaderValue::from_static("a\tb"));
        assert_eq!(
            idempotency_key(&tabbed, token),
            Err(HookReason::InvalidIdempotencyKey)
        );
    }

    #[test]
    fn the_dry_run_header_must_say_true() {
        assert!(is_dry_run(&header_map(&[("x-o2-dry-run", "true")])));
        assert!(is_dry_run(&header_map(&[("X-O2-Dry-Run", "TRUE")])));
        assert!(!is_dry_run(&header_map(&[("x-o2-dry-run", "1")])));
        assert!(!is_dry_run(&HeaderMap::new()));
    }
}
