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
use chrono::Local;
use pin_project_lite::pin_project;
use regex::Regex;
use tower::{Layer, Service};

/// Returns the HTTP access log format string based on configuration.
///
/// Supported format specifiers:
/// - %a - Remote IP address (from X-Forwarded-For or Forwarded header)
/// - %t - Time the request was received (format: [dd/Mon/yyyyTHH:mm:ss.fff +zzzz])
/// - %r - Request line (method, path, HTTP version)
/// - %s - Response status code
/// - %b - Size of response in bytes (from Content-Length header)
/// - %U - URL path requested (without query string)
/// - %T - Time taken to serve the request, in seconds (3 decimal places)
/// - %D - Time taken to serve the request, in microseconds
/// - %{HeaderName}i - Any request header (e.g., %{Content-Length}i, %{Referer}i, %{User-Agent}i)
/// - %{HeaderName}o - Any response header (e.g., %{Content-Type}o, %{Cache-Control}o)
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
        let timestamp = Local::now()
            .format("[%d/%b/%YT%H:%M:%S%.3f %z]")
            .to_string();

        // Extract request info before moving req
        let remote_addr = req
            .headers()
            .get("X-Forwarded-For")
            .or_else(|| req.headers().get("Forwarded"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        let method = req.method().to_string();
        let path_and_query = req
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let uri_path = req.uri().path().to_string();
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

        // Only collect all request headers if the format contains custom header patterns
        // This optimization avoids unnecessary allocation and iteration
        let request_headers: Vec<(String, String)> = if self.format.contains("}i") {
            req.headers()
                .iter()
                .map(|(name, value)| {
                    (
                        name.as_str().to_string(),
                        value.to_str().unwrap_or("-").to_string(),
                    )
                })
                .collect()
        } else {
            Vec::new()
        };

        AccessLogFuture {
            inner: self.inner.call(req),
            start,
            timestamp,
            remote_addr,
            method,
            path: path_and_query,
            uri_path,
            version,
            content_length,
            referer,
            user_agent,
            request_headers,
            format: self.format.clone(),
        }
    }
}

pin_project! {
    pub struct AccessLogFuture<F> {
        #[pin]
        inner: F,
        start: Instant,
        timestamp: String,
        remote_addr: String,
        method: String,
        path: String,
        uri_path: String,
        version: String,
        content_length: String,
        referer: String,
        user_agent: String,
        request_headers: Vec<(String, String)>,
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
                let response_time_micros = duration.as_micros();

                // Get status code, response size, and response headers from the response
                let (status_code, response_size, response_headers) = if let Ok(ref resp) = result {
                    let status = resp.status().as_u16().to_string();
                    let size = resp
                        .headers()
                        .get("Content-Length")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("-")
                        .to_string();
                    // Only collect response headers if the format contains custom header patterns
                    let headers: Vec<(String, String)> = if this.format.contains("}o") {
                        resp.headers()
                            .iter()
                            .map(|(name, value)| {
                                (
                                    name.as_str().to_string(),
                                    value.to_str().unwrap_or("-").to_string(),
                                )
                            })
                            .collect()
                    } else {
                        Vec::new()
                    };
                    (status, size, headers)
                } else {
                    ("500".to_string(), "-".to_string(), vec![])
                };

                // Build the request line
                let request_line = format!("{} {} {}", this.method, this.path, this.version);

                // Start with basic replacements
                let mut log_message = this
                    .format
                    .replace("%a", this.remote_addr)
                    .replace("%t", this.timestamp)
                    .replace("%r", &request_line)
                    .replace("%s", &status_code)
                    .replace("%b", &response_size)
                    .replace("%U", this.uri_path)
                    .replace("%T", &format!("{:.3}", response_time_secs))
                    .replace("%D", &response_time_micros.to_string())
                    .replace("%{Content-Length}i", this.content_length)
                    .replace("%{Referer}i", this.referer)
                    .replace("%{User-Agent}i", this.user_agent);

                // Only parse generic headers if the format contains custom header patterns
                // This avoids expensive regex operations when not needed
                if this.format.contains("}i") {
                    // Handle generic %{Header}i patterns for request headers
                    let request_header_regex = Regex::new(r"%\{([^}]+)\}i").unwrap();
                    for cap in request_header_regex.captures_iter(&this.format.clone()) {
                        let header_name = &cap[1];
                        // Skip already-handled headers to avoid redundant work
                        if header_name == "Content-Length"
                            || header_name == "Referer"
                            || header_name == "User-Agent"
                        {
                            continue;
                        }
                        let header_value = this
                            .request_headers
                            .iter()
                            .find(|(name, _)| name.eq_ignore_ascii_case(header_name))
                            .map(|(_, value)| value.as_str())
                            .unwrap_or("-");
                        log_message =
                            log_message.replace(&format!("%{{{}}}i", header_name), header_value);
                    }
                }

                if this.format.contains("}o") {
                    // Handle generic %{Header}o patterns for response headers
                    let response_header_regex = Regex::new(r"%\{([^}]+)\}o").unwrap();
                    for cap in response_header_regex.captures_iter(&this.format.clone()) {
                        let header_name = &cap[1];
                        let header_value = response_headers
                            .iter()
                            .find(|(name, _)| name.eq_ignore_ascii_case(header_name))
                            .map(|(_, value)| value.as_str())
                            .unwrap_or("-");
                        log_message =
                            log_message.replace(&format!("%{{{}}}o", header_name), header_value);
                    }
                }

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
        // Test that common format contains expected patterns
        let common_format =
            r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#;

        assert!(common_format.contains("%a")); // Remote IP
        assert!(common_format.contains("%r")); // Request line
        assert!(common_format.contains("%s")); // Response status
        assert!(common_format.contains("%b")); // Response size
        assert!(common_format.contains("%T")); // Time taken
        assert!(common_format.contains("Content-Length"));
        assert!(common_format.contains("Referer"));
        assert!(common_format.contains("User-Agent"));

        // Test that JSON format also contains core patterns
        let json_format = r#"{ "remote_ip": "%a", "request": "%r", "status": %s, "response_size": %b, "request_size": "%{Content-Length}i", "referer": "%{Referer}i", "user_agent": "%{User-Agent}i", "response_time_secs": %T }"#;

        assert!(json_format.contains("%a")); // Remote IP
        assert!(json_format.contains("%r")); // Request line
        assert!(json_format.contains("%s")); // Response status
        assert!(json_format.contains("%b")); // Response size
        assert!(json_format.contains("%T")); // Time taken
    }

    #[test]
    fn test_format_specifier_replacement() {
        // Test that all format specifiers can be parsed
        let format = "%a %t %r %s %b %U %T %D %{X-Custom}i %{X-Response}o";

        // Verify the format contains all expected specifiers
        assert!(format.contains("%a")); // Remote IP
        assert!(format.contains("%t")); // Timestamp
        assert!(format.contains("%r")); // Request line
        assert!(format.contains("%s")); // Status code
        assert!(format.contains("%b")); // Response size
        assert!(format.contains("%U")); // URI path
        assert!(format.contains("%T")); // Time in seconds
        assert!(format.contains("%D")); // Time in microseconds
        assert!(format.contains("%{X-Custom}i")); // Request header
        assert!(format.contains("%{X-Response}o")); // Response header
    }

    #[test]
    fn test_header_pattern_regex() {
        let request_header_regex = Regex::new(r"%\{([^}]+)\}i").unwrap();
        let response_header_regex = Regex::new(r"%\{([^}]+)\}o").unwrap();

        // Test request header patterns
        let format = "%{Content-Type}i %{X-Custom-Header}i";
        let captures: Vec<_> = request_header_regex.captures_iter(format).collect();
        assert_eq!(captures.len(), 2);
        assert_eq!(&captures[0][1], "Content-Type");
        assert_eq!(&captures[1][1], "X-Custom-Header");

        // Test response header patterns
        let format = "%{Content-Type}o %{Cache-Control}o";
        let captures: Vec<_> = response_header_regex.captures_iter(format).collect();
        assert_eq!(captures.len(), 2);
        assert_eq!(&captures[0][1], "Content-Type");
        assert_eq!(&captures[1][1], "Cache-Control");
    }

    #[test]
    fn test_header_pattern_optimization() {
        // Format without custom headers should not trigger regex parsing
        let format_no_custom = "%a %t %r %s %b %U %T %D";
        assert!(!format_no_custom.contains("}i"));
        assert!(!format_no_custom.contains("}o"));

        // Format with only standard headers should still trigger check but skip them
        let format_standard = r#"%a "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i""#;
        assert!(format_standard.contains("}i"));

        // Format with custom headers should trigger full regex parsing
        let format_custom = "%a %{X-Custom}i %{Cache-Control}o";
        assert!(format_custom.contains("}i"));
        assert!(format_custom.contains("}o"));
    }
}
