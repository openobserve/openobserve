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

//! Own test binary: it sets this process's configuration from the environment, then builds the
//! production router, so the test fails if `create_app_router` stops installing proxy mode's host
//! boundary when synthetics is off.

// Cloud treats `proxy` as `built_in`, so this self-hosted behaviour is not asserted there.
#![cfg(all(feature = "enterprise", not(feature = "cloud")))]

use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use openobserve_api_http::handler::http::router::create_app_router;
use tower::ServiceExt;

/// Builds the production router and asks it for `path` as `host` presents it.
async fn answer(host: &str, path: &str) -> StatusCode {
    let app = create_app_router(|_| Router::new());
    let request = Request::builder()
        .uri(path)
        .header(header::HOST, host)
        .body(Body::empty())
        .unwrap();
    app.oneshot(request).await.unwrap().status()
}

#[tokio::test]
async fn the_production_router_stops_a_customer_authority_when_proxy_mode_is_on_without_synthetics()
{
    // SAFETY: this binary has one test, and no other thread reads these variables; the
    // configuration is re-read from them immediately and stored before the router is built.
    unsafe {
        std::env::set_var("ZO_STATUS_PAGE_DOMAIN_TLS", "proxy");
        std::env::set_var("ZO_SYNTHETICS_ENABLED", "false");
    }
    config::CONFIG.store(Arc::new(
        config::Config::init().expect("config from the test environment"),
    ));
    let cfg = config::get_config();
    assert!(
        !cfg.synthetics.enabled,
        "the test configuration turns synthetics off"
    );
    assert_eq!(cfg.status_page_domain.tls, "proxy");

    let customer = answer("status.brand.com", "/healthz").await;
    let app_host = answer("localhost:5080", "/healthz").await;

    assert_eq!(
        customer,
        StatusCode::NOT_FOUND,
        "a customer authority must get the neutral 404, not an app route"
    );
    assert_eq!(
        app_host,
        StatusCode::OK,
        "the app's own authority keeps answering"
    );
}
