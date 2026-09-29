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

//! Hardened outbound HTTP for customer-supplied evaluation endpoints.
//!
//! Every call to an address a customer configured -- a Remote Scorer, a Remote
//! Task -- goes through [`OutboundClient`]. Those endpoints are
//! attacker-influenced input, so the destination is checked before the request
//! leaves the process and again at every redirect hop.
//!
//! Which destinations are allowed is not this module's to decide. That is
//! `config::utils::ssrf_guard`, the guard alert destinations and enrichment
//! tables already use, so one policy -- and one pair of settings,
//! `ZO_SSRF_ALLOW_LOOPBACK` and `ZO_SKIP_SSRF_CHECKS` -- governs every outbound
//! call the platform makes on a customer's behalf:
//!
//! * [`SsrfGuard::validate_url_with_config`] rejects a private, loopback, reserved, or metadata
//!   destination before the request is built
//! * [`build_safe_client`] enforces the same policy on the wire: every address the client resolves
//!   is checked as it connects, and every redirect target is revalidated before it is followed
//!
//! What this module still owns is what the guard does not cover, because it is
//! about calling a configured endpoint rather than about which addresses exist:
//!
//! * cloud builds require HTTPS; non-cloud deployments may use HTTP for local infrastructure
//! * the URL must carry no credentials and no fragment
//! * responses are size-capped while streaming, not after
//! * headers the platform owns cannot be overridden by customer headers
//! * failures are split by whether trying again could help
//!
//! [`validate_endpoint`] is the whole of that, and is what an LLM provider calls
//! too, so a provider endpoint and a task endpoint face one set of rules rather
//! than two that drift.

use std::{fmt, time::Duration};

use anyhow::Result;
use config::utils::ssrf_guard::{SsrfGuard, build_safe_client};
use futures_util::StreamExt;
use hmac::{Hmac, Mac};
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use sha2::Sha256;
use url::Url;

/// Redirect hops a customer endpoint may issue before the request is abandoned.
/// Mirrors the limit inside `build_safe_client`, which is what enforces it; this
/// is here so the rejection can say what the limit was.
const MAX_REDIRECTS: usize = 5;

/// Headers the platform sets itself. A customer header may not override any of
/// them: auth is resolved from a Secret reference, the content type is fixed,
/// and trace, idempotency, and signature headers carry meaning the receiver
/// relies on.
const PLATFORM_OWNED_HEADERS: &[&str] = &[
    "authorization",
    "content-type",
    "traceparent",
    "tracestate",
    "x-o2-idempotency-key",
    "x-o2-signature",
];

/// Headers that belong to the connection rather than the message.
const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// How much of a customer endpoint's answer this module will hold, and how long
/// it waits to reach it. Where the request may go is not settled here -- that is
/// `config::utils::ssrf_guard`, so it stays the same across every outbound path.
#[derive(Debug, Clone)]
pub struct OutboundPolicy {
    pub max_response_bytes: usize,
    pub connect_timeout: Duration,
}

impl OutboundPolicy {
    pub fn new(max_response_bytes: usize, connect_timeout: Duration) -> Self {
        Self {
            max_response_bytes,
            connect_timeout,
        }
    }
}

impl Default for OutboundPolicy {
    fn default() -> Self {
        Self {
            max_response_bytes: 1024 * 1024,
            connect_timeout: Duration::from_secs(10),
        }
    }
}

#[derive(Debug, Clone)]
pub struct OutboundRequest {
    pub method: String,
    pub url: Url,
    pub headers: Vec<(HeaderName, HeaderValue)>,
    pub body: Option<String>,
    pub timeout: Duration,
}

#[derive(Debug, Clone)]
pub struct OutboundResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: String,
    /// The URL that produced this response, which differs from the requested one
    /// when redirects were followed.
    pub final_url: Url,
}

/// Why an outbound call failed, split by whether trying again could help.
///
/// Callers map this onto their own error classes; the module only reports what
/// happened. A non-2xx status is not an error here -- it is returned to the
/// caller, because what counts as a failure differs between a scorer and a task.
#[derive(Debug)]
pub enum OutboundError {
    /// The request was rejected before it left the process, or a hop was
    /// rejected mid-flight. Retrying sends the same rejected request.
    Policy(String),
    /// Covers a name that would not resolve as well as a connection that would
    /// not open: reqwest reports both while connecting.
    Connect(String),
    Timeout,
    ResponseTooLarge(usize),
    InvalidResponse(String),
    Transport(String),
}

impl OutboundError {
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Connect(_) | Self::Timeout | Self::Transport(_) => true,
            Self::Policy(_) | Self::ResponseTooLarge(_) | Self::InvalidResponse(_) => false,
        }
    }
}

impl fmt::Display for OutboundError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Policy(message) => write!(f, "{message}"),
            Self::Connect(message) => write!(f, "failed to connect to endpoint: {message}"),
            Self::Timeout => write!(f, "request timed out"),
            Self::ResponseTooLarge(limit) => write!(f, "response exceeded {limit} bytes"),
            Self::InvalidResponse(message) => write!(f, "invalid response: {message}"),
            Self::Transport(message) => write!(f, "request failed: {message}"),
        }
    }
}

impl std::error::Error for OutboundError {}

/// Check an endpoint a customer configured for the platform to call on its
/// behalf: a Remote Task, a Remote Scorer, an LLM provider.
///
/// Which destinations are allowed comes from the shared SSRF guard. The rest is
/// what the guard does not speak to, because it is about a stored endpoint the
/// platform may send credentials to rather than about addresses:
///
/// * cloud builds require HTTPS so credentials and request data are encrypted in transit
/// * credentials in a URL leak into logs and redirect chains
/// * a fragment is never sent, so it only hides the real target from a reader
///
/// Returns the parsed URL so a caller does not parse it a second time. DNS is
/// not resolved here: [`build_safe_client`] checks every address it resolves at
/// connect time, including on redirect hops.
pub fn validate_endpoint(endpoint: &str) -> Result<Url, String> {
    validate_endpoint_for_deployment(endpoint, cfg!(feature = "cloud"))
}

fn validate_endpoint_for_deployment(endpoint: &str, require_https: bool) -> Result<Url, String> {
    let parsed = Url::parse(endpoint).map_err(|e| format!("endpoint is not a valid URL: {e}"))?;

    if require_https && parsed.scheme() != "https" {
        return Err("endpoint must use HTTPS in cloud deployments".to_string());
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("endpoint must not include credentials".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("endpoint must not include a fragment".to_string());
    }

    // Scheme, host, private ranges and metadata are the guard's call, with its env overrides.
    SsrfGuard::validate_url_with_config(endpoint)
        .map_err(|message| format!("endpoint rejected: {message}"))?;

    Ok(parsed)
}

/// Validates and sends outbound calls on behalf of one subsystem.
///
/// `subject` prefixes error messages ("Remote scorer", "Remote task") so a
/// rejection names the thing the operator configured.
pub struct OutboundClient {
    subject: &'static str,
    policy: OutboundPolicy,
}

impl OutboundClient {
    pub fn new(subject: &'static str, policy: OutboundPolicy) -> Self {
        Self { subject, policy }
    }

    pub fn with_policy(subject: &'static str, policy: OutboundPolicy) -> Self {
        Self { subject, policy }
    }

    pub fn policy(&self) -> &OutboundPolicy {
        &self.policy
    }

    fn reject<T>(&self, message: impl fmt::Display) -> Result<T, OutboundError> {
        Err(OutboundError::Policy(format!("{} {message}", self.subject)))
    }

    /// Check a configured endpoint URL. Run at save time as well as before every
    /// call, so a policy change takes effect on stored configurations too.
    ///
    /// The rules are [`validate_endpoint`]'s; this only names the subject in the
    /// rejection, so an operator knows which configuration to fix.
    pub fn validate_endpoint(&self, endpoint: &str) -> Result<Url, OutboundError> {
        match validate_endpoint(endpoint) {
            Ok(url) => Ok(url),
            Err(message) => self.reject(message),
        }
    }

    pub fn validate_header_name(&self, name: &str) -> Result<HeaderName, OutboundError> {
        let header = match HeaderName::from_bytes(name.as_bytes()) {
            Ok(header) => header,
            Err(e) => return self.reject(format!("header name '{name}' is invalid: {e}")),
        };
        if PLATFORM_OWNED_HEADERS.contains(&header.as_str())
            || HOP_BY_HOP_HEADERS.contains(&header.as_str())
        {
            return self.reject(format!("header '{}' is not allowed", header.as_str()));
        }
        Ok(header)
    }

    pub fn validate_header_pair(
        &self,
        name: &str,
        value: &str,
    ) -> Result<(HeaderName, HeaderValue), OutboundError> {
        let header = self.validate_header_name(name)?;
        match HeaderValue::from_str(value) {
            Ok(value) => Ok((header, value)),
            Err(e) => self.reject(format!("value for header '{name}' is invalid: {e}")),
        }
    }

    pub fn validate_header_value(
        &self,
        value: &str,
        label: &str,
    ) -> Result<HeaderValue, OutboundError> {
        match HeaderValue::from_str(value) {
            Ok(value) => Ok(value),
            Err(e) => self.reject(format!("{label} is invalid: {e}")),
        }
    }

    /// Send a request, letting the shared hardened client carry the destination
    /// rules through DNS and any redirect chain.
    pub async fn send(&self, request: OutboundRequest) -> Result<OutboundResponse, OutboundError> {
        // The URL is checked here as well as at save time: a stored
        // configuration may predate the current policy.
        let url = self.validate_endpoint(request.url.as_str())?;

        let response = self
            .send_one(
                &url,
                &request.method.to_uppercase(),
                &request.headers,
                request.body.as_deref(),
                request.timeout,
            )
            .await?;

        let status = response.status();
        let headers = response.headers().clone();
        // Not the requested URL when the endpoint redirected.
        let final_url = response.url().clone();
        let body = self.read_limited(response).await?;
        Ok(OutboundResponse {
            status,
            headers,
            body,
            final_url,
        })
    }

    async fn send_one(
        &self,
        url: &Url,
        method: &str,
        headers: &[(HeaderName, HeaderValue)],
        body: Option<&str>,
        timeout: Duration,
    ) -> Result<reqwest::Response, OutboundError> {
        // Built per call because the total timeout is the caller's. The guard
        // work -- the DNS check on every resolved address and the revalidation of
        // every redirect target -- comes from `build_safe_client`.
        let client = build_safe_client(
            reqwest::Client::builder()
                .timeout(timeout)
                .connect_timeout(self.policy.connect_timeout),
        )
        .map_err(|e| OutboundError::Transport(e.to_string()))?;

        let parsed_method = match reqwest::Method::from_bytes(method.as_bytes()) {
            Ok(method) => method,
            Err(_) => return self.reject(format!("HTTP method '{method}' is not supported")),
        };

        let mut req = client.request(parsed_method, url.as_str());
        for (name, value) in headers {
            req = req.header(name.clone(), value.clone());
        }
        if let Some(body) = body {
            req = req.body(body.to_string());
        }

        let error = match req.send().await {
            Ok(response) => return Ok(response),
            Err(e) => e,
        };

        // A destination the guard turned down reads as a DNS or connect failure
        // at this level, and retrying would send the same rejected request, so
        // it is reported as the policy failure it is.
        if let Some(message) = guard_rejection(&error) {
            return self.reject(message);
        }
        if error.is_timeout() {
            return Err(OutboundError::Timeout);
        }
        if error.is_redirect() {
            return self.reject(format!(
                "was redirected somewhere it may not follow, or more than {MAX_REDIRECTS} times: {error}"
            ));
        }
        if error.is_connect() {
            return Err(OutboundError::Connect(error.to_string()));
        }
        Err(OutboundError::Transport(error.to_string()))
    }

    /// Read the body while enforcing the cap, so an oversized response is
    /// abandoned mid-stream rather than buffered and then rejected.
    async fn read_limited(&self, response: reqwest::Response) -> Result<String, OutboundError> {
        let limit = self.policy.max_response_bytes;
        if let Some(content_length) = response.content_length()
            && content_length > limit as u64
        {
            return Err(OutboundError::ResponseTooLarge(limit));
        }

        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| OutboundError::Transport(e.to_string()))?;
            if body.len().saturating_add(chunk.len()) > limit {
                return Err(OutboundError::ResponseTooLarge(limit));
            }
            body.extend_from_slice(&chunk);
        }

        String::from_utf8(body)
            .map_err(|e| OutboundError::InvalidResponse(format!("response was not UTF-8: {e}")))
    }
}

/// The guard's rejection, when one is the reason a request failed.
///
/// `build_safe_client` turns a refused address or a refused redirect target into
/// a resolver or redirect error, which reqwest then wraps. Reading the chain is
/// what separates "this endpoint is not allowed" from "this endpoint is down",
/// and the two are handled differently: one is worth retrying, the other never
/// will be.
fn guard_rejection(error: &reqwest::Error) -> Option<String> {
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(err) = current {
        let message = err.to_string();
        if message.contains("not allowed for security reasons") {
            return Some(message);
        }
        current = err.source();
    }
    None
}

/// Produces the webhook signature over `timestamp + \".\" + raw_body`.
pub fn hmac_sha256_hex(secret: &[u8], timestamp: i64, raw_body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts keys of any length");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(raw_body);
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> OutboundClient {
        OutboundClient::with_policy("Remote scorer", OutboundPolicy::default())
    }

    #[test]
    fn hmac_signature_matches_the_wire_contract() {
        assert_eq!(
            hmac_sha256_hex(b"secret", 1_700_000_000, br#"{"ok":true}"#),
            "c1afc7c2df3db0690d7d75954610ed1a1d959ce96355ccb8c0a8bc09fd0cfc27"
        );
    }

    /// The destination rules belong to the shared guard, which reads
    /// `ZO_SSRF_ALLOW_LOOPBACK` and `ZO_SKIP_SSRF_CHECKS` from the environment.
    /// A developer environment that relaxed them is not a failing test.
    fn guard_is_strict() -> bool {
        let cfg = config::get_config();
        !cfg.common.ssrf_allow_loopback && !cfg.common.skip_ssrf_checks
    }

    #[test]
    fn test_rejects_endpoints_that_are_the_wrong_shape() {
        // None of these depend on the destination policy.
        for endpoint in [
            "https://user:pass@example.com/evaluate",
            "https://example.com/evaluate#fragment",
            "ftp://example.com/evaluate",
            "not-a-url",
        ] {
            let err = client().validate_endpoint(endpoint).unwrap_err();
            assert!(
                err.to_string().starts_with("Remote scorer endpoint"),
                "unexpected message for {endpoint}: {err}"
            );
            assert!(
                !err.is_retryable(),
                "policy rejection must not be retryable"
            );
        }
    }

    #[test]
    fn test_rejects_non_public_destinations() {
        if !guard_is_strict() {
            return;
        }
        for endpoint in [
            "https://localhost/evaluate",
            "https://127.0.0.1/evaluate",
            "https://[::1]/evaluate",
            "https://169.254.169.254/latest/meta-data",
            "https://metadata.google.internal/evaluate",
            "https://10.0.0.5/evaluate",
            "http://127.0.0.1:8098/task",
            "http://host.docker.internal:8098/task",
        ] {
            let err = client().validate_endpoint(endpoint).unwrap_err();
            assert!(
                err.to_string().starts_with("Remote scorer endpoint"),
                "unexpected message for {endpoint}: {err}"
            );
            assert!(
                !err.is_retryable(),
                "policy rejection must not be retryable"
            );
        }
    }

    #[test]
    fn test_accepts_public_https_endpoints() {
        for endpoint in [
            "https://example.com/evaluate",
            "https://scoring.example.com:8443/v1/score?strict=true",
        ] {
            assert!(client().validate_endpoint(endpoint).is_ok(), "{endpoint}");
        }
    }

    #[cfg(not(feature = "cloud"))]
    #[test]
    fn test_non_cloud_accepts_public_http_endpoints() {
        for endpoint in [
            "http://example.com/evaluate",
            "http://tasks.example.com:8080/run",
        ] {
            assert!(client().validate_endpoint(endpoint).is_ok(), "{endpoint}");
        }
    }

    #[test]
    fn test_https_requirement_rejects_public_http_endpoints() {
        for endpoint in [
            "http://example.com/evaluate",
            "http://tasks.example.com:8080/run",
        ] {
            let err = validate_endpoint_for_deployment(endpoint, true).unwrap_err();
            assert!(err.contains("HTTPS"), "{endpoint}: {err}");
        }
    }

    #[cfg(feature = "cloud")]
    #[test]
    fn test_cloud_rejects_public_http_endpoints() {
        for endpoint in [
            "http://example.com/evaluate",
            "http://tasks.example.com:8080/run",
        ] {
            let err = client().validate_endpoint(endpoint).unwrap_err();
            assert!(err.to_string().contains("HTTPS"), "{endpoint}: {err}");
            assert!(!err.is_retryable(), "{endpoint}: {err}");
        }
    }

    #[test]
    fn test_single_label_https_hosts_are_left_to_guarded_dns_resolution() {
        let endpoint = "https://intranet/evaluate";
        assert!(client().validate_endpoint(endpoint).is_ok(), "{endpoint}");
    }

    #[cfg(not(feature = "cloud"))]
    #[test]
    fn test_non_cloud_single_label_http_hosts_are_left_to_guarded_dns_resolution() {
        let endpoint = "http://intranet/evaluate";
        assert!(client().validate_endpoint(endpoint).is_ok(), "{endpoint}");
    }

    #[test]
    fn test_loopback_endpoints_follow_ssrf_settings() {
        let cfg = config::get_config();
        let allow_loopback = cfg.common.ssrf_allow_loopback || cfg.common.skip_ssrf_checks;
        for endpoint in [
            "http://localhost:8000/o2_agent/o2-ai/query",
            "https://localhost/evaluate",
            "http://127.0.0.1:8098/task",
            "http://[::1]:8098/task",
        ] {
            let expected =
                allow_loopback && (!cfg!(feature = "cloud") || endpoint.starts_with("https://"));
            assert_eq!(
                client().validate_endpoint(endpoint).is_ok(),
                expected,
                "{endpoint}"
            );
        }
    }

    #[test]
    fn test_private_endpoints_require_skip_ssrf_checks() {
        let skip_ssrf_checks = config::get_config().common.skip_ssrf_checks;
        for endpoint in [
            "http://host.docker.internal:8098/task",
            "http://10.0.0.5/evaluate",
            "https://10.0.0.5/evaluate",
        ] {
            let expected =
                skip_ssrf_checks && (!cfg!(feature = "cloud") || endpoint.starts_with("https://"));
            assert_eq!(
                client().validate_endpoint(endpoint).is_ok(),
                expected,
                "{endpoint}"
            );
        }
    }

    #[test]
    fn test_platform_owned_headers_cannot_be_overridden() {
        for header in [
            "authorization",
            "Content-Type",
            "traceparent",
            "tracestate",
            "X-O2-Idempotency-Key",
            "x-o2-signature",
            "host",
            "transfer-encoding",
            "cookie",
        ] {
            let err = client().validate_header_name(header).unwrap_err();
            assert!(
                err.to_string().contains("is not allowed"),
                "expected {header} to be rejected, got: {err}"
            );
        }
    }

    #[test]
    fn test_allows_ordinary_custom_headers() {
        let (name, value) = client()
            .validate_header_pair("X-Tenant-Id", "acme")
            .unwrap();

        assert_eq!(name.as_str(), "x-tenant-id");
        assert_eq!(value, "acme");
    }

    #[test]
    fn test_rejects_malformed_header_names_and_values() {
        assert!(client().validate_header_name("bad header").is_err());
        assert!(client().validate_header_pair("X-Ok", "bad\nvalue").is_err());
    }

    #[test]
    fn test_error_retryability() {
        assert!(OutboundError::Connect("x".into()).is_retryable());
        assert!(OutboundError::Timeout.is_retryable());
        assert!(OutboundError::Transport("x".into()).is_retryable());

        assert!(!OutboundError::Policy("x".into()).is_retryable());
        assert!(!OutboundError::ResponseTooLarge(1024).is_retryable());
        assert!(!OutboundError::InvalidResponse("x".into()).is_retryable());
    }
}
