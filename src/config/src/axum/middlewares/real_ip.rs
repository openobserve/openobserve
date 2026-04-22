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

use std::{net::IpAddr, str::FromStr};

use axum::{body::Body, extract::Extension, http::Request, middleware::Next, response::Response};
use axum_client_ip::{ClientIp, ClientIpSource};

/// The real client IP resolved by [`ClientIpSource`] and attached to the
/// request by [`extract_real_ip`]. Consumers should read this extension
/// instead of parsing `X-Forwarded-For`/`Forwarded` headers directly.
#[derive(Clone, Copy, Debug)]
pub struct RealIp(pub IpAddr);

/// Resolve the [`ClientIpSource`] from the configured string.
/// Empty / unrecognised values fall back to [`ClientIpSource::ConnectInfo`]
/// (the TCP peer), which is the only safe default when no proxy is in front.
pub fn resolve_client_ip_source(configured: &str) -> ClientIpSource {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return ClientIpSource::ConnectInfo;
    }
    match ClientIpSource::from_str(trimmed) {
        Ok(source) => source,
        Err(_) => {
            log::warn!(
                "invalid ZO_HTTP_REAL_IP_SOURCE={trimmed:?}, falling back to ConnectInfo; \
                 valid values: ConnectInfo, RightmostXForwardedFor, RightmostForwarded, \
                 XRealIp, CfConnectingIp, TrueClientIp, FlyClientIp, XEnvoyExternalAddress, \
                 CloudFrontViewerAddress"
            );
            ClientIpSource::ConnectInfo
        }
    }
}

/// Middleware that extracts the client IP per the configured [`ClientIpSource`]
/// and stores it in the request extensions as [`RealIp`].
///
/// Extraction failures (missing header / missing `ConnectInfo`) are swallowed
/// so the request still reaches downstream handlers; logging middlewares will
/// show `-` for the IP in that case.
pub async fn extract_real_ip(
    client_ip: Result<ClientIp, axum_client_ip::Rejection>,
    Extension(source): Extension<ClientIpSource>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    match client_ip {
        Ok(ClientIp(ip)) => {
            req.extensions_mut().insert(RealIp(ip));
        }
        Err(e) => {
            log::debug!("failed to resolve client IP via {source:?}: {e}");
        }
    }
    next.run(req).await
}
