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

use std::{error::Error, fmt, io, sync::Arc, time::Duration};

use config::{
    meta::secret_store::{
        SecretErrorCode,
        external::{CONNECT_TIMEOUT, FetchError, MAX_BODY_BYTES, REQUEST_TIMEOUT},
    },
    utils::ssrf_guard::{
        RedirectMode, SecretBackendNetwork, find_ssrf_refusal, is_always_blocked_host,
    },
};
use reqwest::{Certificate, Request, Response, StatusCode, header};
use url::Url;
use zeroize::Zeroizing;

#[derive(Clone, PartialEq, Eq)]
pub struct Origin {
    host: String,
}

impl Origin {
    pub fn as_tuple(&self) -> (&'static str, &str, u16) {
        ("https", &self.host, 443)
    }
}

impl fmt::Display for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (scheme, host, port) = self.as_tuple();
        write!(f, "{scheme}://{host}:{port}")
    }
}

pub struct BackendClient {
    origin: Origin,
    client: reqwest::Client,
}

impl BackendClient {
    pub async fn send(&self, mut request: Request) -> Result<BackendResponse, FetchError> {
        let origin = origin_of(request.url()).map_err(|_| denied_endpoint())?;
        let host = request.url().host_str().ok_or_else(denied_endpoint)?;
        let mut headers = request.headers().get_all(header::HOST).iter();
        if origin != self.origin
            || headers.next().is_some_and(|value| {
                value.as_bytes() != host.as_bytes()
                    && value.as_bytes() != format!("{host}:443").as_bytes()
            })
            || headers.next().is_some()
        {
            return Err(denied_endpoint());
        }
        // A provider request may carry its own timeout; it cannot extend the backend deadline.
        *request.timeout_mut() = Some(
            request
                .timeout()
                .copied()
                .unwrap_or(REQUEST_TIMEOUT)
                .min(REQUEST_TIMEOUT),
        );
        let response = self.client.execute(request).await.map_err(request_error)?;
        read_response(response).await
    }
}

pub struct BackendResponse {
    pub status: StatusCode,
    pub retry_after: Option<header::HeaderValue>,
    pub body: Zeroizing<Vec<u8>>,
}

impl BackendResponse {
    /// A transient error that carries the provider's `Retry-After` in seconds when it sent one.
    pub fn transient(&self, reason: &'static str) -> FetchError {
        let seconds = self
            .retry_after
            .as_ref()
            .and_then(|value| value.to_str().ok())
            .and_then(|value| retry_after_seconds(value, chrono::Utc::now()));
        match seconds {
            Some(seconds) if seconds > 0 => FetchError::Throttled {
                reason,
                retry_after: Duration::from_secs(seconds.min(3600)),
            },
            _ => FetchError::Transient { reason },
        }
    }
}

/// Credential AD binds the origin; saving a backend must also validate its network with
/// `build_client`.
pub fn check_endpoint(endpoint: &str) -> Result<Origin, SecretErrorCode> {
    let invalid = SecretErrorCode::InsecureTransport;
    let (_, address) = endpoint.split_once("://").ok_or(invalid)?;
    let authority = address.split(['/', '?', '#']).next().ok_or(invalid)?;
    if authority.is_empty()
        || authority.contains(['@', '%'])
        || authority.rsplit_once(':').is_some_and(|(host, port)| {
            !authority.ends_with(']') && (port != "443" || host.is_empty())
        })
        || endpoint.contains('\\')
        || endpoint
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(invalid);
    }
    let url = Url::parse(endpoint).map_err(|_| invalid)?;
    if url.query().is_some() {
        return Err(invalid);
    }
    origin_of(&url)
}

pub async fn build_client(
    endpoint: &str,
    ca_pem: Option<&[u8]>,
    cluster_cidrs: &str,
) -> Result<BackendClient, SecretErrorCode> {
    let origin = check_endpoint(endpoint)?;
    let invalid = SecretErrorCode::InsecureTransport;
    let cfg = config::get_config();
    let cluster = cluster_exclusions(cluster_cidrs, &cfg.common.secret_backend_cluster_cidrs);
    let network =
        SecretBackendNetwork::from_cidrs(&cfg.common.secret_backend_private_cidrs, &cluster)
            .ok_or(invalid)?;
    // IP literals skip reqwest's DNS resolver; check the bound origin before exposing a client.
    tokio::time::timeout(CONNECT_TIMEOUT, network.resolve_host(&origin.host))
        .await
        .map_err(|_| invalid)?
        .map_err(|_| invalid)?;
    let mut builder = client_builder(network);
    if let Some(pem) = ca_pem {
        let certs = Certificate::from_pem_bundle(pem).map_err(|_| invalid)?;
        if certs.is_empty() {
            return Err(invalid);
        }
        builder = builder.tls_certs_merge(certs);
    }
    Ok(BackendClient {
        origin,
        client: builder.build().map_err(|_| invalid)?,
    })
}

/// The deployment's pod and service networks are refused even when a caller passes none.
/// `Retry-After` is delta-seconds or an HTTP-date; a date already past means no wait.
fn retry_after_seconds(value: &str, now: chrono::DateTime<chrono::Utc>) -> Option<u64> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(seconds);
    }
    let at = chrono::DateTime::parse_from_rfc2822(value)
        .map(|at| at.with_timezone(&chrono::Utc))
        .ok()
        .or_else(|| obsolete_http_date(value))?;
    let wait = at.signed_duration_since(now).num_milliseconds();
    (wait > 0).then(|| (wait as u64).div_ceil(1000))
}

/// RFC 9110 obsolete HTTP-date forms, RFC 850 and asctime, both always GMT.
fn obsolete_http_date(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    ["%A, %d-%b-%y %H:%M:%S GMT", "%a %b %e %H:%M:%S %Y"]
        .into_iter()
        .find_map(|format| chrono::NaiveDateTime::parse_from_str(value, format).ok())
        .map(|at| at.and_utc())
}

fn cluster_exclusions(caller: &str, configured: &str) -> String {
    [caller, configured]
        .into_iter()
        .filter(|cidrs| !cidrs.trim().is_empty())
        .collect::<Vec<_>>()
        .join(",")
}

fn client_builder(network: SecretBackendNetwork) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(RedirectMode::Deny.secret_bearing_policy())
        .dns_resolver(Arc::new(network))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
}

fn origin_of(url: &Url) -> Result<Origin, SecretErrorCode> {
    let invalid = SecretErrorCode::InsecureTransport;
    let host = url.host_str().ok_or(invalid)?;
    if url.scheme() != "https"
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || is_always_blocked_host(host.trim_end_matches('.'))
    {
        return Err(invalid);
    }
    let host = host.strip_suffix('.').unwrap_or(host);
    if matches!(url.host(), Some(url::Host::Domain(_)))
        && (host.len() > 253 || !host.split('.').all(valid_label))
    {
        return Err(invalid);
    }
    Ok(Origin {
        host: host.to_owned(),
    })
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn denied_endpoint() -> FetchError {
    FetchError::Denied {
        reason: "endpoint_refused",
    }
}

fn request_error(error: reqwest::Error) -> FetchError {
    if error.is_timeout() {
        return FetchError::Transient { reason: "timeout" };
    }
    if find_ssrf_refusal(&error).is_some() {
        return denied_endpoint();
    }
    let mut source = error.source();
    while let Some(cause) = source {
        if let Some(err) = cause.downcast_ref::<io::Error>() {
            match err.kind() {
                io::ErrorKind::InvalidData => {
                    return FetchError::Denied {
                        reason: "tls_failure",
                    };
                }
                io::ErrorKind::ConnectionRefused
                | io::ErrorKind::ConnectionReset
                | io::ErrorKind::ConnectionAborted
                | io::ErrorKind::NetworkUnreachable
                | io::ErrorKind::HostUnreachable
                | io::ErrorKind::TimedOut => {
                    return FetchError::Transient {
                        reason: "connect_error",
                    };
                }
                _ => {}
            }
        }
        source = cause.source();
    }
    FetchError::Denied {
        reason: "transport_failure",
    }
}

async fn read_response(mut response: Response) -> Result<BackendResponse, FetchError> {
    let status = response.status();
    if status.is_redirection() {
        return Err(FetchError::Denied {
            reason: "redirect_refused",
        });
    }
    let too_large = || FetchError::Invalid {
        reason: "body_too_large",
    };
    if response
        .content_length()
        .is_some_and(|len| len > MAX_BODY_BYTES as u64)
    {
        return Err(too_large());
    }
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        if chunk.len() > MAX_BODY_BYTES - body.len() {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(BackendResponse {
        status,
        retry_after: response.headers().get(header::RETRY_AFTER).cloned(),
        body,
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use bytes::Bytes;
    use futures::stream;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    #[test]
    fn transient_carries_a_valid_retry_after_in_seconds() {
        let response = |value: Option<&str>| BackendResponse {
            status: StatusCode::TOO_MANY_REQUESTS,
            retry_after: value.map(|v| header::HeaderValue::from_str(v).unwrap()),
            body: Zeroizing::new(Vec::new()),
        };
        assert_eq!(
            response(Some(" 7 ")).transient("x").retry_after(),
            Some(Duration::from_secs(7))
        );
        assert_eq!(
            response(Some("99999")).transient("x").retry_after(),
            Some(Duration::from_secs(3600))
        );
        let later = (chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc2822();
        let wait = response(Some(&later)).transient("x").retry_after().unwrap();
        assert!(wait > Duration::from_secs(25) && wait <= Duration::from_secs(31));
        let rfc_example = chrono::DateTime::parse_from_rfc3339("1994-11-06T08:49:37Z").unwrap();
        for date in ["Sunday, 06-Nov-94 08:49:37 GMT", "Sun Nov  6 08:49:37 1994"] {
            assert_eq!(
                obsolete_http_date(date),
                Some(rfc_example.with_timezone(&chrono::Utc)),
                "{date}"
            );
        }
        let later = chrono::Utc::now() + chrono::Duration::seconds(30);
        for date in [
            later.format("%A, %d-%b-%y %H:%M:%S GMT").to_string(),
            later.format("%a %b %e %H:%M:%S %Y").to_string(),
        ] {
            let wait = response(Some(&date)).transient("x").retry_after();
            assert!(
                wait.is_some_and(|w| w > Duration::from_secs(25) && w <= Duration::from_secs(31)),
                "{date} was not read as a Retry-After date"
            );
        }
        for value in [
            None,
            Some("0"),
            Some("-1"),
            Some("Wed, 21 Oct 2015 07:28:00 GMT"),
            Some("Wednesday, 21-Oct-15 07:28:00 GMT"),
            Some("Wed Oct 21 07:28:00 2015"),
            Some("not a date"),
        ] {
            assert_eq!(
                response(value).transient("x"),
                FetchError::Transient { reason: "x" }
            );
        }
    }

    #[test]
    fn endpoint_normalizes_origin_and_refuses_ambiguous_authorities() {
        for endpoint in [
            "https://secretmanager.googleapis.com",
            "HTTPS://SECRETMANAGER.GOOGLEAPIS.COM.:443/v1/backend",
        ] {
            assert_eq!(
                check_endpoint(endpoint).unwrap().to_string(),
                "https://secretmanager.googleapis.com:443"
            );
        }
        for endpoint in [
            "http://example.com",
            "https:example.com",
            "https://example.com:8443",
            "https://example.com:",
            "https://example.com:0443",
            "https://user@example.com",
            "https://@example.com",
            "https://example.com\\@elsewhere.com",
            "https://127.0.0.1",
            "https://169.254.169.254",
            "https://metadata.google.internal.",
            "https://example.com?q",
            "https://example.com/#fragment",
            "https://a..example.com",
            "https://*.example.com",
        ] {
            assert!(matches!(
                check_endpoint(endpoint),
                Err(SecretErrorCode::InsecureTransport)
            ));
        }
    }

    #[tokio::test]
    async fn builder_checks_literals_before_reqwest_can_dial_them() {
        for endpoint in [
            "http://example.com",
            "https://127.0.0.1",
            "https://[fd00:ec2::254]",
            "https://10.1.2.3",
        ] {
            assert!(matches!(
                build_client(endpoint, None, "10.1.0.0/16").await,
                Err(SecretErrorCode::InsecureTransport)
            ));
        }
    }

    #[tokio::test]
    async fn a_new_request_must_match_the_validated_origin_and_host_header() {
        let client = build_client("https://8.8.8.8", None, "").await.unwrap();
        let mut request = Request::new(
            reqwest::Method::GET,
            Url::parse("https://8.8.8.8/v1").unwrap(),
        );
        request.headers_mut().insert(
            header::HOST,
            header::HeaderValue::from_static("wrong.example"),
        );
        assert!(matches!(
            client.send(request).await,
            Err(FetchError::Denied {
                reason: "endpoint_refused"
            })
        ));
        let request = Request::new(
            reqwest::Method::GET,
            Url::parse("https://169.254.169.254/v1").unwrap(),
        );
        assert!(matches!(
            client.send(request).await,
            Err(FetchError::Denied {
                reason: "endpoint_refused"
            })
        ));
    }

    #[tokio::test]
    async fn caller_cannot_configure_an_empty_or_invalid_ca_bundle() {
        for pem in [b"".as_slice(), b"not a certificate"] {
            assert!(matches!(
                build_client("https://8.8.8.8", Some(pem), "").await,
                Err(SecretErrorCode::InsecureTransport)
            ));
        }
    }

    #[tokio::test]
    async fn networks_check_the_addresses_returned_to_the_connector() {
        let net = SecretBackendNetwork::from_cidrs(
            "10.0.0.0/8,fc00::/7,127.0.0.1,169.254.169.254",
            "10.96.0.0/12",
        )
        .unwrap();
        for host in ["10.1.2.3", "fd12::1", "8.8.8.8"] {
            let addrs = net.resolve_host(host).await.unwrap();
            assert_eq!(addrs[0].ip(), host.parse::<std::net::IpAddr>().unwrap());
        }
        for host in [
            "10.96.1.2",
            "172.16.0.1",
            "127.0.0.1",
            "::1",
            "169.254.169.254",
            "fd00:ec2::254",
            "::ffff:127.0.0.1",
            "64:ff9b::a9fe:a9fe",
            "0.0.0.0",
            "ff02::1",
            "100.100.100.200",
        ] {
            assert!(net.resolve_host(host).await.is_err());
        }
    }

    #[tokio::test]
    async fn configured_cluster_networks_are_refused_beside_the_callers() {
        assert_eq!(cluster_exclusions("", ""), "");
        assert_eq!(cluster_exclusions("", "10.96.0.0/12"), "10.96.0.0/12");
        let cluster = cluster_exclusions("10.1.0.0/16", "10.96.0.0/12");
        assert_eq!(cluster, "10.1.0.0/16,10.96.0.0/12");
        let net = SecretBackendNetwork::from_cidrs("10.0.0.0/8", &cluster).unwrap();
        for host in ["10.1.2.3", "10.96.1.2"] {
            assert!(net.resolve_host(host).await.is_err(), "{host}");
        }
        assert!(net.resolve_host("10.200.0.1").await.is_ok());
    }

    #[tokio::test]
    async fn every_redirect_fails_before_reading_a_body() {
        for status in 300..400 {
            let body = reqwest::Body::wrap_stream(stream::poll_fn(
                |_| -> std::task::Poll<Option<Result<Bytes, io::Error>>> {
                    panic!("a redirect body must never be read")
                },
            ));
            let response = http::Response::builder().status(status).body(body).unwrap();
            assert!(matches!(
                read_response(response.into()).await,
                Err(FetchError::Denied {
                    reason: "redirect_refused"
                })
            ));
        }
    }

    #[tokio::test]
    async fn redirect_sends_nothing_to_location() {
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", origin.local_addr().unwrap());
        let location = target.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = origin.accept().await.unwrap();
            let mut bytes = [0; 1024];
            assert!(socket.read(&mut bytes).await.unwrap() > 0);
            let reply = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{location}/\r\nContent-Length: 0\r\n\r\n"
            );
            socket.write_all(reply.as_bytes()).await.unwrap();
        });
        let network = SecretBackendNetwork::from_cidrs("", "").unwrap();
        let client = client_builder(network)
            .https_only(false)
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let response = client.get(url).send().await.unwrap();
        assert!(matches!(
            read_response(response).await,
            Err(FetchError::Denied {
                reason: "redirect_refused"
            })
        ));
        server.await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), target.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn streamed_body_cap_applies_without_a_length_header() {
        for (last, allowed) in [(0, true), (1, false)] {
            let chunks = [vec![0; MAX_BODY_BYTES], vec![0; last]]
                .map(|v| Ok::<_, io::Error>(Bytes::from(v)));
            let body = reqwest::Body::wrap_stream(stream::iter(chunks));
            let response = Response::from(http::Response::new(body));
            let result = read_response(response).await;
            if allowed {
                assert_eq!(result.unwrap().body.len(), MAX_BODY_BYTES);
            } else {
                assert!(matches!(
                    result,
                    Err(FetchError::Invalid {
                        reason: "body_too_large"
                    })
                ));
            }
        }
    }
}
