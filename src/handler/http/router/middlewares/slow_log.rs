// Copyright 2025 OpenObserve Inc.
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

use std::{
    future::{ready, Ready},
    time::{Duration, Instant},
};

use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    http::header,
    Error,
};
use config::utils::time::now_micros;
use futures_util::future::LocalBoxFuture;

pub struct SlowLog {
    threshold_secs: u64,
    circuit_breaker_enabled: bool,
}

impl SlowLog {
    pub fn new(threshold_secs: u64, circuit_breaker_enabled: bool) -> Self {
        SlowLog {
            threshold_secs,
            circuit_breaker_enabled,
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for SlowLog
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = SlowLogMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(SlowLogMiddleware {
            service,
            threshold_secs: self.threshold_secs,
            circuit_breaker_enabled: self.circuit_breaker_enabled,
        }))
    }
}

pub struct SlowLogMiddleware<S> {
    service: S,
    threshold_secs: u64,
    circuit_breaker_enabled: bool,
}

impl<S, B> Service<ServiceRequest> for SlowLogMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, mut req: ServiceRequest) -> Self::Future {
        let start = Instant::now();
        let remote_addr = match req.headers().contains_key("X-Forwarded-For")
            || req.headers().contains_key("Forwarded")
        {
            true => req
                .connection_info()
                .realip_remote_addr()
                .unwrap_or("-")
                .to_string(),
            false => req.connection_info().peer_addr().unwrap_or("-").to_string(),
        };
        let path = req
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let method = req.method().to_string();
        let body_size = match req.headers().get("Content-Length") {
            Some(size) => size.to_str().unwrap_or("0").parse::<usize>().unwrap_or(0),
            None => 0,
        };
        let threshold = Duration::from_secs(self.threshold_secs);
        let circuit_breaker_enabled = self.circuit_breaker_enabled;

        // add current time to the request headers
        req.headers_mut().insert(
            header::HeaderName::from_static("o2_req_time"),
            header::HeaderValue::from_str(&now_micros().to_string()).unwrap(),
        );

        let fut = self.service.call(req);

        Box::pin(async move {
            let res = fut.await?;
            let duration = start.elapsed();

            // watch the request duration
            if circuit_breaker_enabled {
                crate::service::circuit_breaker::watch_request(duration.as_millis() as u64);
            }

            // log the slow request
            if duration > threshold {
                log::warn!(
                    "slow request detected - remote_addr: {}, method: {}, path: {}, size: {}, took: {:.6}",
                    remote_addr,
                    method,
                    path,
                    body_size,
                    duration.as_secs_f64()
                );
            }

            Ok(res)
        })
    }
}
