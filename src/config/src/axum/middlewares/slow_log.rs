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

use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
    time::{Duration, Instant},
};

use axum::{body::Body, http::Request, response::Response};
use pin_project_lite::pin_project;
use tower::{Layer, Service};

use super::HEADER_O2_PROCESS_TIME;

/// Layer that logs slow requests
#[derive(Clone)]
pub struct SlowLogLayer {
    threshold_secs: u64,
}

impl SlowLogLayer {
    pub fn new(threshold_secs: u64) -> Self {
        SlowLogLayer { threshold_secs }
    }
}

impl<S> Layer<S> for SlowLogLayer {
    type Service = SlowLogService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        SlowLogService {
            inner,
            threshold_secs: self.threshold_secs,
        }
    }
}

/// Service that logs slow requests
#[derive(Clone)]
pub struct SlowLogService<S> {
    inner: S,
    threshold_secs: u64,
}

impl<S> Service<Request<Body>> for SlowLogService<S>
where
    S: Service<Request<Body>, Response = Response> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = SlowLogFuture<S::Future>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let start = Instant::now();
        let start_time = crate::utils::time::now_micros();

        // Extract request info before moving req
        let remote_addr = req
            .headers()
            .get("X-Forwarded-For")
            .or_else(|| req.headers().get("Forwarded"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();

        let path = req
            .uri()
            .path_and_query()
            .map(|x| x.as_str())
            .unwrap_or("")
            .to_string();

        let method = req.method().to_string();

        let body_size = req
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);

        let threshold = Duration::from_secs(self.threshold_secs);

        SlowLogFuture {
            inner: self.inner.call(req),
            start,
            start_time,
            remote_addr,
            path,
            method,
            body_size,
            threshold,
        }
    }
}

pin_project! {
    pub struct SlowLogFuture<F> {
        #[pin]
        inner: F,
        start: Instant,
        start_time: i64,
        remote_addr: String,
        path: String,
        method: String,
        body_size: usize,
        threshold: Duration,
    }
}

impl<F, E> Future for SlowLogFuture<F>
where
    F: Future<Output = Result<Response, E>>,
{
    type Output = Result<Response, E>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.project();

        match this.inner.poll(cx) {
            Poll::Ready(result) => {
                let duration = this.start.elapsed();
                let took_time = duration.as_millis();

                if duration > *this.threshold {
                    // Get the process time from the response if available
                    let wait_time_str = if let Ok(ref resp) = result {
                        resp.headers()
                            .get(HEADER_O2_PROCESS_TIME)
                            .and_then(|v| v.to_str().ok())
                            .and_then(|s| s.parse::<i64>().ok())
                            .filter(|&v| v > 0)
                            .map(|v| format!(" wait_time: {} ms,", (v - *this.start_time) / 1000))
                            .unwrap_or_default()
                    } else {
                        String::new()
                    };

                    log::warn!(
                        "slow request detected - remote_addr: {}, method: {}, path: {}, size: {},{} took: {} ms",
                        this.remote_addr,
                        this.method,
                        this.path,
                        this.body_size,
                        wait_time_str,
                        took_time
                    );
                }

                Poll::Ready(result)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}
