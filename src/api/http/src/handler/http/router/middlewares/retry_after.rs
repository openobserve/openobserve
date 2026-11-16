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

use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    middleware::Next,
    response::Response,
};

/// Tells a client refused with 503 by the tripped memory circuit breaker when to retry.
pub async fn retry_after_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    set_retry_after(
        &mut response,
        ingester::memory_circuit_breaker_retry_after(),
    );
    response
}

fn set_retry_after(response: &mut Response, retry_after_secs: Option<u64>) {
    if response.status() != StatusCode::SERVICE_UNAVAILABLE
        || response.headers().contains_key(RETRY_AFTER)
    {
        return;
    }
    if let Some(secs) = retry_after_secs {
        response
            .headers_mut()
            .insert(RETRY_AFTER, HeaderValue::from(secs));
    }
}

#[cfg(test)]
mod tests {
    use axum::response::IntoResponse;

    use super::*;

    fn retry_after(
        status: StatusCode,
        existing: Option<&'static str>,
        secs: Option<u64>,
    ) -> Option<String> {
        let mut response = status.into_response();
        if let Some(value) = existing {
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from_static(value));
        }
        set_retry_after(&mut response, secs);
        response
            .headers()
            .get(RETRY_AFTER)
            .map(|v| v.to_str().unwrap().to_string())
    }

    #[test]
    fn test_set_retry_after() {
        for (status, existing, secs, expected) in [
            (StatusCode::SERVICE_UNAVAILABLE, None, Some(12), Some("12")),
            (StatusCode::SERVICE_UNAVAILABLE, None, None, None),
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Some("60"),
                Some(12),
                Some("60"),
            ),
            (StatusCode::INTERNAL_SERVER_ERROR, None, Some(12), None),
            (StatusCode::OK, None, Some(12), None),
        ] {
            assert_eq!(
                retry_after(status, existing, secs).as_deref(),
                expected,
                "{status} {existing:?} {secs:?}"
            );
        }
    }
}
