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

//! The raman REST surface: each handler is a delegation into the enterprise
//! service layer, which owns every status this module can return.

#[cfg(feature = "enterprise")]
pub mod config;
#[cfg(feature = "enterprise")]
pub mod digests;

#[cfg(feature = "enterprise")]
use {
    axum::response::{IntoResponse, Response},
    common::meta::http::HttpResponse as MetaHttpResponse,
    o2_enterprise::enterprise::raman_service::RamanServiceError,
};

#[cfg(feature = "enterprise")]
fn error_response(error: &RamanServiceError) -> Response {
    let status = error.http_status();
    if status >= 500 {
        log::error!("[raman] {error}");
    }
    MetaHttpResponse::error(status, error.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "enterprise")]
    use super::*;

    const ROUTER: &str = include_str!("../../../../http/src/handler/http/router/mod.rs");

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

    /// Restated here rather than read off `http_status()`, so the mapping is asserted, not echoed.
    #[cfg(feature = "enterprise")]
    fn documented_status(error: &RamanServiceError) -> u16 {
        match error {
            RamanServiceError::NotFound { .. } => 404,
            RamanServiceError::InvalidInput { .. } => 400,
            RamanServiceError::Storage(_) => 500,
        }
    }

    #[test]
    fn every_raman_route_binds_its_verb_to_its_own_handler() {
        for (path, binding) in [
            (
                "/v2/{org_id}/raman/config",
                "get(raman::config::get_raman_config)",
            ),
            (
                "/v2/{org_id}/raman/config",
                "put(raman::config::update_raman_config)",
            ),
            (
                "/v2/{org_id}/raman/digests",
                "get(raman::digests::list_raman_digests)",
            ),
            (
                "/v2/{org_id}/raman/digests/run",
                "post(raman::digests::run_raman_digest)",
            ),
            (
                "/v2/{org_id}/raman/digests/{digest_id}",
                "get(raman::digests::get_raman_digest)",
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
            normalize("get(\n    raman::config::get_raman_config,\n)"),
            normalize("get(raman::config::get_raman_config)")
        );
    }

    #[test]
    fn a_commented_out_route_is_not_read_as_a_registration() {
        assert_eq!(strip_comments("a\n// .route(\"/x\", get(h))\nb"), "a\n\nb");
        assert_eq!(strip_comments("a/* .route(\"/x\") */b"), "ab");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn every_service_error_variant_reaches_the_client_as_its_documented_status() {
        for error in [
            RamanServiceError::not_found("config", "acme"),
            RamanServiceError::invalid_input("limit", "must be positive"),
            RamanServiceError::Storage("connection reset".into()),
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
