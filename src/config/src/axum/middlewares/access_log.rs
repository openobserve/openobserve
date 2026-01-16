// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
    time::Instant,
};

use axum::{body::Body, http::Request, response::Response};
use pin_project_lite::pin_project;
use tower::{Layer, Service};

/// Returns the HTTP access log format string based on configuration.
///
/// Supported format specifiers:
/// - %a - Remote IP address
/// - %t - Time the request was received
/// - %r - Request line (method, path, HTTP version)
/// - %s - Response status code
/// - %b - Size of response in bytes
/// - %U - URL path requested
/// - %T - Time taken to serve the request, in seconds
/// - %D - Time taken to serve the request, in microseconds
/// - %i - Header line(s) from request
/// - %o - Header line(s) from response
/// - %{Content-Length}i - Size of request payload in bytes
/// - %{Referer}i - Referer header
/// - %{User-Agent}i - User-Agent header
///
/// Returns a format string that can be used by the AccessLogLayer middleware.
pub fn get_http_access_log_format() -> String {
    let log_format = crate::get_config().http.access_log_format.to_string();
    if log_format.is_empty() || log_format.to_lowercase() == "common" {
        r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#.to_string()
    } else if log_format.to_lowercase() == "json" {
        r#"{ "remote_ip": "%a", "request": "%r", "status": %s, "response_size": %b, "request_size": "%{Content-Length}i", "referer": "%{Referer}i", "user_agent": "%{User-Agent}i", "response_time_secs": %T }"#
            .to_string()
    } else {
        log_format
    }
}

/// Layer that logs HTTP access using a customizable format
#[derive(Clone)]
pub struct AccessLogLayer {
    format: String,
}

impl AccessLogLayer {
    pub fn new(format: String) -> Self {
        AccessLogLayer { format }
    }
}

impl<S> Layer<S> for AccessLogLayer {
    type Service = AccessLogService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        AccessLogService {
            inner,
            format: self.format.clone(),
        }
    }
}

/// Service that logs HTTP access
#[derive(Clone)]
pub struct AccessLogService<S> {
    inner: S,
    format: String,
}

impl<S> Service<Request<Body>> for AccessLogService<S>
where
    S: Service<Request<Body>, Response = Response> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = AccessLogFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let start = Instant::now();

        // Extract request info before moving req
        let remote_addr = req
            .headers()
            .get("X-Forwarded-For")
            .or_else(|| req.headers().get("Forwarded"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        let method = req.method().to_string();
        let path = req
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let version = format!("{:?}", req.version());

        // Extract headers
        let content_length = req
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        let referer = req
            .headers()
            .get("Referer")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        let user_agent = req
            .headers()
            .get("User-Agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        AccessLogFuture {
            inner: self.inner.call(req),
            start,
            remote_addr,
            method,
            path,
            version,
            content_length,
            referer,
            user_agent,
            format: self.format.clone(),
        }
    }
}

pin_project! {
    pub struct AccessLogFuture<F> {
        #[pin]
        inner: F,
        start: Instant,
        remote_addr: String,
        method: String,
        path: String,
        version: String,
        content_length: String,
        referer: String,
        user_agent: String,
        format: String,
    }
}

impl<F, E> Future for AccessLogFuture<F>
where
    F: Future<Output = Result<Response, E>>,
{
    type Output = Result<Response, E>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();

        match this.inner.poll(cx) {
            Poll::Ready(result) => {
                let duration = this.start.elapsed();
                let response_time_secs = duration.as_secs_f64();

                // Get status code and response size from the response
                let (status_code, response_size) = if let Ok(ref resp) = result {
                    let status = resp.status().as_u16().to_string();
                    let size = resp
                        .headers()
                        .get("Content-Length")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("-")
                        .to_string();
                    (status, size)
                } else {
                    ("500".to_string(), "-".to_string())
                };

                // Build the request line
                let request_line = format!("{} {} {}", this.method, this.path, this.version);

                // Replace format specifiers with actual values
                let log_message = this
                    .format
                    .replace("%a", this.remote_addr)
                    .replace("%r", &request_line)
                    .replace("%s", &status_code)
                    .replace("%b", &response_size)
                    .replace("%T", &format!("{:.3}", response_time_secs))
                    .replace("%{Content-Length}i", this.content_length)
                    .replace("%{Referer}i", this.referer)
                    .replace("%{User-Agent}i", this.user_agent);

                log::info!("{}", log_message);

                Poll::Ready(result)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_formatting_patterns() {
        // Test the log format string used in HTTP server setup
        let log_format = get_http_access_log_format();

        assert!(log_format.contains("%a")); // Remote IP
        assert!(log_format.contains("%r")); // Request line
        assert!(log_format.contains("%s")); // Response status
        assert!(log_format.contains("%b")); // Response size
        assert!(log_format.contains("%T")); // Time taken
        assert!(log_format.contains("Content-Length"));
        assert!(log_format.contains("Referer"));
        assert!(log_format.contains("User-Agent"));
    }
}
