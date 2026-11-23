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

//! The router of the domain listener: what a custom hostname can reach, and nothing else. The
//! page comes from the store entry of the TLS hostname; `Host` is only compared with it.

use std::{sync::Arc, time::Duration};

use axum::{
    Extension, Json, Router,
    body::{Body, Bytes},
    extract::{Path, Request, State},
    http::{HeaderMap, Method, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use config::{
    axum::middlewares::{AccessLogLayer, RealIp, get_http_access_log_format},
    meta::feature::Feature,
};
use futures::future::BoxFuture;
use o2_enterprise::enterprise::status_pages::cert_store::PageGate;
use openobserve_api_management::request::status_pages::public::{self, AuthBody};
use tokio::time::timeout;

use super::{Directory, acceptor::TlsHost};

/// The password form is a few hundred bytes.
const AUTH_BODY_LIMIT: usize = 4096;
/// Each byte of a trickled form resets the connection's idle timer, so the read has its own end.
const AUTH_BODY_DEADLINE: Duration = Duration::from_secs(5);
const BY_HOST: &str = "/api/status_pages_public_by_host";
const BY_HOST_AUTH: &str = "/api/status_pages_public_by_host/auth";

/// The public handlers the router calls, so a test can replace them.
#[derive(Clone, Copy)]
pub(super) struct Pages {
    snapshot: fn(String, Option<RealIp>, HeaderMap) -> BoxFuture<'static, Response>,
    auth: fn(String, Option<RealIp>, Bytes) -> BoxFuture<'static, Response>,
    shell: fn(String, Option<RealIp>) -> BoxFuture<'static, Response>,
}

impl Pages {
    pub(super) fn live() -> Self {
        Self {
            snapshot: |slug, ip, headers| {
                Box::pin(public::snapshot(Path(slug), ip.map(Extension), headers))
            },
            auth: |slug, ip, body| Box::pin(unlock(slug, ip, body)),
            shell: |slug, ip| Box::pin(public::page(Path(slug), ip.map(Extension))),
        }
    }
}

#[derive(Clone)]
struct Context {
    directory: Arc<dyn Directory>,
    pages: Pages,
}

pub(super) fn router(directory: Arc<dyn Directory>, pages: Pages) -> Router {
    Router::new()
        .fallback(dispatch)
        .layer(AccessLogLayer::new(get_http_access_log_format()))
        .with_state(Context { directory, pages })
}

/// In order: the authority, the hostname's entry, the domain target, the page gate, the routes.
async fn dispatch(State(ctx): State<Context>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let Some(host) = parts.extensions.get::<TlsHost>() else {
        return not_connected();
    };
    if !authority_matches(&parts, &host.0) {
        return StatusCode::MISDIRECTED_REQUEST.into_response();
    }
    let Some(entry) = ctx.directory.entry(&host.0) else {
        return not_connected();
    };
    let Some(page) = entry.page.as_ref() else {
        return target_answer(&parts);
    };
    match ctx.directory.page_gate(page) {
        PageGate::Serve => {}
        PageGate::NotLicensed => return license_error(),
        PageGate::Refused => return not_connected(),
    }
    route(&ctx.pages, &page.slug, parts, body).await
}

async fn route(pages: &Pages, slug: &str, mut parts: Parts, body: Body) -> Response {
    let ip = parts.extensions.get::<RealIp>().copied();
    match (&parts.method, parts.uri.path()) {
        (method, BY_HOST) if reads(method) => {
            let headers = std::mem::take(&mut parts.headers);
            (pages.snapshot)(slug.to_owned(), ip, headers).await
        }
        (&Method::POST, BY_HOST_AUTH) => match auth_body(body).await {
            Ok(body) => (pages.auth)(slug.to_owned(), ip, body).await,
            Err(status) => status.into_response(),
        },
        (method, path) if reads(method) && redirects_to_root(path) => {
            redirect_to_root(parts.uri.query())
        }
        (method, _) if reads(method) => (pages.shell)(slug.to_owned(), ip).await,
        _ => not_connected(),
    }
}

/// The form within its size limit and its deadline, or the status for the one it broke.
async fn auth_body(body: Body) -> Result<Bytes, StatusCode> {
    match timeout(
        AUTH_BODY_DEADLINE,
        axum::body::to_bytes(body, AUTH_BODY_LIMIT),
    )
    .await
    {
        Ok(Ok(body)) => Ok(body),
        Ok(Err(_)) => Err(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => Err(StatusCode::REQUEST_TIMEOUT),
    }
}

/// The domain target answers the installation check and nothing else.
fn target_answer(parts: &Parts) -> Response {
    if reads(&parts.method) && parts.uri.path() == BY_HOST {
        StatusCode::NO_CONTENT.into_response()
    } else {
        not_connected()
    }
}

/// HEAD is answered as GET; the server drops the body.
fn reads(method: &Method) -> bool {
    method == Method::GET || method == Method::HEAD
}

/// `Host` and `:authority`, whichever the request carries, must name the TLS hostname.
fn authority_matches(parts: &Parts, tls_host: &str) -> bool {
    let names_it = |claim: &str| without_port(claim).eq_ignore_ascii_case(tls_host);
    let header = parts
        .headers
        .get(header::HOST)
        .map(|value| value.to_str().is_ok_and(names_it));
    let authority = parts
        .uri
        .authority()
        .map(|authority| names_it(authority.as_str()));
    match (header, authority) {
        (None, None) => false,
        (header, authority) => header.unwrap_or(true) && authority.unwrap_or(true),
    }
}

fn without_port(authority: &str) -> &str {
    authority.split(':').next().unwrap_or(authority)
}

/// `/status`, anything under `/status/`, or a path whose last-but-one segment is `status`: the
/// shell would read a slug from it and call the slug API, which this router does not serve.
fn redirects_to_root(path: &str) -> bool {
    let (mut first, mut previous, mut last) = (None, None, None);
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        first = first.or(Some(segment));
        previous = last;
        last = Some(segment);
    }
    first == Some("status") || previous == Some("status")
}

fn redirect_to_root(query: Option<&str>) -> Response {
    let location = match query {
        Some(query) => format!("/?{query}"),
        None => "/".to_string(),
    };
    Response::builder()
        .status(StatusCode::MOVED_PERMANENTLY)
        .header(header::LOCATION, location)
        .body(Body::empty())
        .unwrap_or_else(|_| not_connected())
}

/// A bad body is the wrong-password answer the by-host route gives.
async fn unlock(slug: String, ip: Option<RealIp>, body: Bytes) -> Response {
    match serde_json::from_slice::<AuthBody>(&body) {
        Ok(body) => public::auth(Path(slug), ip.map(Extension), Json(body)).await,
        Err(_) => Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("Wrong password."))
            .unwrap_or_default(),
    }
}

/// The error the main router's host route gives for a missing license.
fn license_error() -> Response {
    let err = infra::errors::ErrorCodes::LicenseFeatureNotEntitled(
        <&str>::from(Feature::Synthetics).to_owned(),
    );
    (
        StatusCode::FORBIDDEN,
        Json(common::meta::http::HttpResponse::error_code(err)),
    )
        .into_response()
}

/// The uniform 404 of the listener: no entry, a refused page, a method or path it does not serve.
pub(super) fn not_connected() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(
            "This domain isn't connected to a status page yet.",
        ))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use tower::ServiceExt;

    use super::{
        super::testkit::{Fake, HOST, SLUG},
        *,
    };

    const TARGET: &str = "domains.brand.test";
    const SHELL: &str = "shell";

    fn answer(status: u16, text: String) -> Response {
        Response::builder()
            .status(status)
            .body(Body::from(text))
            .unwrap()
    }

    fn who(ip: Option<RealIp>) -> String {
        ip.map_or("none".to_string(), |ip| ip.0.to_string())
    }

    fn stubs() -> Pages {
        Pages {
            snapshot: |slug, ip, _| {
                Box::pin(async move { answer(200, format!("snapshot {slug} {}", who(ip))) })
            },
            auth: |slug, _, body| {
                Box::pin(async move { answer(200, format!("auth {slug} {}", body.len())) })
            },
            shell: |slug, ip| {
                Box::pin(async move { answer(200, format!("{SHELL} {slug} {}", who(ip))) })
            },
        }
    }

    fn served() -> (Router, Arc<Fake>) {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        fake.serve_target(TARGET);
        (router(fake.clone(), stubs()), fake)
    }

    /// A request as the acceptor delivers it: the TLS hostname and the TCP peer on it.
    fn request(method: Method, uri: &str, host: Option<&str>, tls_host: &str) -> Request {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(host) = host {
            builder = builder.header(header::HOST, host);
        }
        let mut request = builder.body(Body::empty()).unwrap();
        request.extensions_mut().insert(TlsHost(tls_host.into()));
        request
            .extensions_mut()
            .insert(RealIp("203.0.113.5".parse().unwrap()));
        request
    }

    async fn call(router: &Router, request: Request) -> (StatusCode, HeaderMap, String) {
        let response = router.clone().oneshot(request).await.unwrap();
        let (parts, body) = response.into_parts();
        let body = axum::body::to_bytes(body, usize::MAX).await.unwrap();
        (
            parts.status,
            parts.headers,
            String::from_utf8_lossy(&body).into_owned(),
        )
    }

    async fn get(router: &Router, path: &str) -> (StatusCode, HeaderMap, String) {
        call(router, request(Method::GET, path, Some(HOST), HOST)).await
    }

    #[tokio::test]
    async fn only_the_visitor_shell_and_the_two_by_host_paths_exist_never_the_app() {
        let (router, _) = served();
        for path in [
            "/",
            "/web/",
            "/api/default/_search",
            "/metrics",
            "/config",
            "/healthz",
        ] {
            let (status, _, body) = get(&router, path).await;
            assert_eq!(status, StatusCode::OK, "{path}");
            assert_eq!(body, format!("{SHELL} {SLUG} 203.0.113.5"), "{path}");
        }
        for path in [
            "/web/",
            "/api/default/_search",
            "/metrics",
            "/config",
            "/healthz",
        ] {
            let post = call(&router, request(Method::POST, path, Some(HOST), HOST)).await;
            assert_eq!(post.0, StatusCode::NOT_FOUND, "POST {path}");
        }
    }

    #[tokio::test]
    async fn a_host_or_authority_that_differs_from_the_tls_hostname_gets_421() {
        let (router, _) = served();
        let wrong = [
            request(Method::GET, "/", Some("other.brand.test"), HOST),
            request(Method::GET, "/", None, HOST),
            request(Method::GET, "https://other.brand.test/", Some(HOST), HOST),
            request(
                Method::GET,
                &format!("https://{HOST}/"),
                Some("other.brand.test"),
                HOST,
            ),
            request(Method::GET, "/", Some(&format!("{HOST}.evil.test")), HOST),
        ];
        for request in wrong {
            assert_eq!(
                call(&router, request).await.0,
                StatusCode::MISDIRECTED_REQUEST
            );
        }
        let right = [
            request(Method::GET, "/", Some(HOST), HOST),
            request(
                Method::GET,
                "/",
                Some(&format!("{}:443", HOST.to_uppercase())),
                HOST,
            ),
            request(Method::GET, &format!("https://{HOST}/"), None, HOST),
        ];
        for request in right {
            assert_eq!(call(&router, request).await.0, StatusCode::OK);
        }
    }

    #[tokio::test]
    async fn the_page_is_the_one_of_the_tls_hostname_whatever_host_says() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        fake.serve("other.brand.test", "other-slug");
        let router = router(fake, stubs());
        let by_tls_host = request(Method::GET, "/", Some("other.brand.test"), HOST);
        assert_eq!(
            call(&router, by_tls_host).await.0,
            StatusCode::MISDIRECTED_REQUEST
        );
        let (_, _, body) = call(
            &router,
            request(
                Method::GET,
                "/",
                Some("other.brand.test"),
                "other.brand.test",
            ),
        )
        .await;
        assert!(body.contains("other-slug"));
    }

    #[tokio::test]
    async fn the_domain_target_answers_204_to_the_probe_and_404_to_anything_else() {
        let (router, _) = served();
        let on_target = |method, path: &str| request(method, path, Some(TARGET), TARGET);
        let probe = call(&router, on_target(Method::GET, BY_HOST)).await;
        assert_eq!(probe.0, StatusCode::NO_CONTENT);
        for (method, path) in [
            (Method::GET, "/"),
            (Method::GET, "/status/brand-status"),
            (Method::POST, BY_HOST),
            (Method::POST, BY_HOST_AUTH),
            (Method::GET, BY_HOST_AUTH),
        ] {
            let answer = call(&router, on_target(method.clone(), path)).await;
            assert_eq!(answer.0, StatusCode::NOT_FOUND, "{method} {path}");
        }
    }

    #[tokio::test]
    async fn a_hostname_that_left_the_store_gets_404_on_a_connection_still_open() {
        let (router, fake) = served();
        assert_eq!(get(&router, "/").await.0, StatusCode::OK);
        fake.release(HOST);
        assert_eq!(get(&router, "/").await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn head_is_answered_like_get_without_a_body() {
        let (router, _) = served();
        let head = |path: &str, host: &str| request(Method::HEAD, path, Some(host), host);
        for (path, host, expected) in [
            ("/", HOST, StatusCode::OK),
            (BY_HOST, HOST, StatusCode::OK),
            ("/status/brand-status", HOST, StatusCode::MOVED_PERMANENTLY),
            (BY_HOST, TARGET, StatusCode::NO_CONTENT),
            ("/", TARGET, StatusCode::NOT_FOUND),
        ] {
            let (status, _, body) = call(&router, head(path, host)).await;
            assert_eq!(status, expected, "HEAD {host}{path}");
            assert_eq!(body, "", "HEAD {host}{path}");
        }
    }

    #[tokio::test]
    async fn a_refused_page_gate_is_404_even_for_the_redirect_and_a_missing_license_is_the_license_error()
     {
        let (router, fake) = served();
        fake.set_gate(PageGate::Refused);
        for path in ["/", "/status/brand-status", BY_HOST] {
            assert_eq!(get(&router, path).await.0, StatusCode::NOT_FOUND, "{path}");
        }
        fake.set_gate(PageGate::NotLicensed);
        let (status, _, body) = get(&router, "/").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert!(body.contains("40001"), "{body}");
    }

    #[tokio::test]
    async fn the_snapshot_and_the_shell_get_the_slug_of_the_entry_and_the_peer_address() {
        let (router, _) = served();
        let spoofed = [
            ("X-Forwarded-For", "198.51.100.1"),
            ("X-Real-IP", "198.51.100.2"),
        ];
        let mut snapshot = request(Method::GET, BY_HOST, Some(HOST), HOST);
        for (name, value) in spoofed {
            snapshot.headers_mut().insert(name, value.parse().unwrap());
        }
        let (status, _, body) = call(&router, snapshot).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::OK, "snapshot brand-status 203.0.113.5")
        );
    }

    #[tokio::test]
    async fn the_unlock_reads_at_most_4_kb_and_every_other_post_is_404() {
        let (router, _) = served();
        let post = |len: usize| {
            let mut request = request(Method::POST, BY_HOST_AUTH, Some(HOST), HOST);
            *request.body_mut() = Body::from(vec![b'x'; len]);
            request
        };
        let (status, _, body) = call(&router, post(AUTH_BODY_LIMIT)).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::OK, "auth brand-status 4096")
        );
        assert_eq!(
            call(&router, post(AUTH_BODY_LIMIT + 1)).await.0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        for path in ["/", "/status/brand-status", BY_HOST, "/api/default/_search"] {
            let other = call(&router, request(Method::POST, path, Some(HOST), HOST)).await;
            assert_eq!(other.0, StatusCode::NOT_FOUND, "POST {path}");
        }
        for method in [Method::PUT, Method::DELETE, Method::PATCH, Method::OPTIONS] {
            let other = call(&router, request(method.clone(), "/", Some(HOST), HOST)).await;
            assert_eq!(other.0, StatusCode::NOT_FOUND, "{method}");
        }
    }

    /// A body of one byte a second: `bytes` of them, or without end.
    fn trickled(bytes: Option<usize>) -> Body {
        Body::from_stream(futures::stream::unfold(0, move |sent| async move {
            if bytes.is_some_and(|bytes| sent >= bytes) {
                return None;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            Some((Ok::<_, std::io::Error>(Bytes::from_static(b"x")), sent + 1))
        }))
    }

    #[tokio::test(start_paused = true)]
    async fn a_trickled_unlock_body_gets_408_at_its_deadline_and_a_slow_one_in_time_is_read() {
        let (router, _) = served();
        let post = |body: Body| {
            let mut request = request(Method::POST, BY_HOST_AUTH, Some(HOST), HOST);
            *request.body_mut() = body;
            request
        };
        let started = tokio::time::Instant::now();
        let (status, ..) = call(&router, post(trickled(None))).await;
        let took = started.elapsed();
        assert_eq!(status, StatusCode::REQUEST_TIMEOUT);
        assert!(
            took >= AUTH_BODY_DEADLINE && took < AUTH_BODY_DEADLINE + Duration::from_secs(1),
            "{took:?}"
        );

        let (status, _, body) = call(&router, post(trickled(Some(3)))).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::OK, "auth brand-status 3")
        );
    }

    #[tokio::test]
    async fn an_unlock_body_that_is_not_the_form_is_the_wrong_password_answer() {
        let answer = unlock(SLUG.to_string(), None, Bytes::from_static(b"not json")).await;
        assert_eq!(answer.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn a_status_path_is_a_301_to_the_root_with_the_query_kept() {
        let (router, _) = served();
        let moved = [
            ("/status/brand-status", "/"),
            ("/status/", "/"),
            ("/status", "/"),
            ("/x/status/brand-status", "/"),
            ("/status/a/b", "/"),
            ("/status/brand-status?a=1", "/?a=1"),
            ("/status?a=1&b=2", "/?a=1&b=2"),
        ];
        for (path, location) in moved {
            let (status, headers, _) = get(&router, path).await;
            assert_eq!(status, StatusCode::MOVED_PERMANENTLY, "{path}");
            assert_eq!(headers[header::LOCATION], location, "{path}");
        }
        for path in [
            "/",
            "/statuspage",
            "/x/status",
            "/api/status",
            "/status-page/x",
        ] {
            let (status, _, body) = get(&router, path).await;
            assert_eq!(status, StatusCode::OK, "{path}");
            assert!(body.starts_with(SHELL), "{path}");
        }
        let post = request(Method::POST, "/status/brand-status", Some(HOST), HOST);
        assert_eq!(call(&router, post).await.0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn the_redirect_row_matches_the_design_table() {
        for path in [
            "/status",
            "/status/",
            "/status/x",
            "/status/x/y",
            "/a/status/x",
            "//status//x",
            "/a/b/status/x",
        ] {
            assert!(redirects_to_root(path), "{path}");
        }
        for path in [
            "/",
            "",
            "/statuses",
            "/x/status",
            "/a/status/x/y",
            "/Status/x",
            "/x/y/z",
        ] {
            assert!(!redirects_to_root(path), "{path}");
        }
    }

    #[tokio::test]
    async fn a_failed_page_read_reaches_the_visitor_as_a_503_with_retry_after() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let mut pages = stubs();
        pages.shell = |_, _| {
            Box::pin(async {
                Response::builder()
                    .status(StatusCode::SERVICE_UNAVAILABLE)
                    .header(header::RETRY_AFTER, "30")
                    .body(Body::empty())
                    .unwrap()
            })
        };
        let (status, headers, _) = get(&router(fake, pages), "/").await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(headers[header::RETRY_AFTER], "30");
    }
}
