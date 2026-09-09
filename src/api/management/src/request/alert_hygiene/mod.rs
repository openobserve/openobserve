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

//! The alert_hygiene REST surface: a well-formed request meets the deployment-switch guard first.

#[cfg(feature = "enterprise")]
pub mod config;
#[cfg(feature = "enterprise")]
pub mod digests;

#[cfg(feature = "enterprise")]
use {
    axum::response::{IntoResponse, Response},
    common::meta::http::HttpResponse as MetaHttpResponse,
    o2_enterprise::enterprise::alert_hygiene_service::AlertHygieneServiceError,
};

#[cfg(feature = "enterprise")]
const DISABLED_MESSAGE: &str = "Alert hygiene is disabled (ZO_ALERT_HYGIENE_ENABLED=false)";

/// The whole REST surface behind one predicate: no route reads or writes an alert_hygiene row while
/// off.
#[cfg(feature = "enterprise")]
fn deployment_disabled() -> Option<Response> {
    (!::config::get_config().alert_hygiene.enabled).then(disabled_response)
}

#[cfg(feature = "enterprise")]
fn disabled_response() -> Response {
    MetaHttpResponse::not_found(DISABLED_MESSAGE)
}

#[cfg(feature = "enterprise")]
fn error_response(error: &AlertHygieneServiceError) -> Response {
    let status = error.http_status();
    if status >= 500 {
        log::error!("[alert_hygiene] {error}");
    }
    MetaHttpResponse::error(status, error.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use super::*;

    const ROUTER: &str = include_str!("../../../../http/src/handler/http/router/mod.rs");
    const CONFIG_SOURCE: &str = include_str!("config.rs");
    const DIGESTS_SOURCE: &str = include_str!("digests.rs");
    /// Hot-reloadable, so the guard is a first statement and not route registration.
    const GUARDED_SIGNATURE: &str =
        "-> Response { if let Some(disabled) = deployment_disabled() { return disabled; }";

    /// Env vars are process-global, so both polarities must be driven under one lock.
    #[cfg(feature = "enterprise")]
    static SWITCH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Scans `service_routes()` alone, comments stripped: a moved or disabled route never matches.
    fn route_call(path: &str) -> String {
        let signature = "pub fn service_routes(";
        let start = ROUTER
            .find(signature)
            .expect("the router must define service_routes()");
        let after_signature = &ROUTER[start + signature.len()..];
        let body = &after_signature[..after_signature
            .find("\npub fn ")
            .unwrap_or(after_signature.len())];
        let live = normalize(&strip_comments(body));
        let needle = format!("\"{path}\"");
        live.split(".route(")
            .skip(1)
            .find(|call| call.starts_with(&needle))
            .unwrap_or_else(|| {
                panic!("the route {path} must be registered inside service_routes()")
            })
            .to_string()
    }

    fn strip_comments(source: &str) -> String {
        let mut without_blocks = String::with_capacity(source.len());
        let mut rest = source;
        while let Some(open) = rest.find("/*") {
            without_blocks.push_str(&rest[..open]);
            let after_open = &rest[open + 2..];
            rest = match after_open.find("*/") {
                Some(close) => &after_open[close + 2..],
                None => "",
            };
        }
        without_blocks.push_str(rest);
        without_blocks
            .lines()
            .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Drops the trailing comma too, because rustfmt adds one to any call it wraps.
    fn normalize(source: &str) -> String {
        source
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .replace(",)", ")")
    }

    /// Drives the real `get_config()` read, so a guard that stops consulting it is caught.
    #[cfg(feature = "enterprise")]
    fn with_switch<T>(enabled: bool, f: impl FnOnce() -> T) -> T {
        let _guard = SWITCH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::env::var("ZO_ALERT_HYGIENE_ENABLED").ok();
        unsafe { std::env::set_var("ZO_ALERT_HYGIENE_ENABLED", enabled.to_string()) };
        ::config::refresh_config().expect("config refresh");
        let out = f();
        match previous {
            Some(value) => unsafe { std::env::set_var("ZO_ALERT_HYGIENE_ENABLED", value) },
            None => unsafe { std::env::remove_var("ZO_ALERT_HYGIENE_ENABLED") },
        }
        ::config::refresh_config().expect("config refresh");
        out
    }

    /// Restated here rather than read off `http_status()`, so the mapping is asserted, not echoed.
    #[cfg(feature = "enterprise")]
    fn documented_status(error: &AlertHygieneServiceError) -> u16 {
        match error {
            AlertHygieneServiceError::NotFound { .. } => 404,
            AlertHygieneServiceError::InvalidInput { .. } => 400,
            AlertHygieneServiceError::Storage(_) => 500,
        }
    }

    #[test]
    fn every_alert_hygiene_route_binds_its_verb_to_its_own_handler() {
        for (path, binding) in [
            (
                "/v2/{org_id}/alert_hygiene/config",
                "get(alert_hygiene::config::get_alert_hygiene_config)",
            ),
            (
                "/v2/{org_id}/alert_hygiene/config",
                "put(alert_hygiene::config::update_alert_hygiene_config)",
            ),
            (
                "/v2/{org_id}/alert_hygiene/digests/run",
                "post(alert_hygiene::digests::run_alert_hygiene_digest)",
            ),
        ] {
            assert!(
                route_call(path).contains(&normalize(binding)),
                "{path} must bind {binding} - a different verb or a different handler \
                 is a different endpoint"
            );
        }
    }

    #[test]
    fn a_wrapped_handler_argument_normalizes_to_the_same_call_as_a_single_line_one() {
        assert_eq!(
            normalize("get(\n    alert_hygiene::config::get_alert_hygiene_config,\n)"),
            normalize("get(alert_hygiene::config::get_alert_hygiene_config)")
        );
    }

    #[test]
    fn a_commented_out_route_is_not_read_as_a_registration() {
        assert_eq!(strip_comments("a\n// .route(\"/x\", get(h))\nb"), "a\n\nb");
        assert_eq!(strip_comments("a/* .route(\"/x\") */b"), "ab");
    }

    /// Three handlers, one predicate: a handler skipping it answers while ZO_ALERT_HYGIENE_ENABLED
    /// is off.
    #[test]
    fn every_alert_hygiene_handler_opens_with_the_deployment_guard() {
        let guard = normalize(GUARDED_SIGNATURE);
        let mut handlers = 0;
        for (file, source) in [("config.rs", CONFIG_SOURCE), ("digests.rs", DIGESTS_SOURCE)] {
            for body in strip_comments(source).split("pub async fn ").skip(1) {
                handlers += 1;
                let name = body.split('(').next().unwrap_or(body).trim();
                assert!(
                    normalize(body).contains(&guard),
                    "{file}'s {name} must open with `{GUARDED_SIGNATURE}` - a handler \
                     that skips the guard serves, and mutates, while the deployment \
                     switch is off"
                );
            }
        }
        assert_eq!(handlers, 3, "the alert_hygiene surface is three handlers");
    }

    #[test]
    fn a_commented_out_guard_does_not_count_as_a_guard() {
        assert!(
            !normalize(&strip_comments(&format!("// {GUARDED_SIGNATURE}")))
                .contains(&normalize(GUARDED_SIGNATURE))
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn the_disabled_surface_answers_404_naming_the_env_var() {
        let response = disabled_response();
        assert_eq!(response.status().as_u16(), 404);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert!(
            body.contains("ZO_ALERT_HYGIENE_ENABLED"),
            "an operator must be able to read the switch's name off the response: {body}"
        );
    }

    /// Both polarities against a forced switch: a guard that always answers, or never
    /// answers, fails one of them.
    #[cfg(feature = "enterprise")]
    #[test]
    fn the_guard_answers_only_while_the_deployment_switch_is_off() {
        assert!(
            with_switch(false, deployment_disabled).is_some(),
            "ZO_ALERT_HYGIENE_ENABLED=false must turn the whole surface into a 404"
        );
        assert!(
            with_switch(true, deployment_disabled).is_none(),
            "ZO_ALERT_HYGIENE_ENABLED=true must let every request through to the service layer"
        );
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn every_service_error_variant_reaches_the_client_as_its_documented_status() {
        for error in [
            AlertHygieneServiceError::not_found("config", "acme"),
            AlertHygieneServiceError::invalid_input("limit", "must be positive"),
            AlertHygieneServiceError::Storage("connection reset".into()),
        ] {
            let expected = documented_status(&error);
            assert_eq!(
                error_response(&error).status().as_u16(),
                expected,
                "`{error}` must reach the client as {expected}"
            );
        }
    }
}
