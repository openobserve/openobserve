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

//! The health state of the domain listener and the port that reports it to a load balancer.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use axum::{Router, http::StatusCode};
use o2_enterprise::enterprise::status_pages::cert_store::Readiness;

use super::Directory;

/// Why the listener is, or is not, ready for the load balancer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HealthState {
    Ready,
    /// The store is not `Ready`: still loading, no key, or a key or epoch that does not match.
    Store(Readiness),
    Draining,
    /// The store is ready and a domain port is not bound.
    NotListening,
}

impl HealthState {
    pub(super) fn of(readiness: Readiness, draining: bool, listening: bool) -> Self {
        if draining || readiness == Readiness::Draining {
            Self::Draining
        } else if readiness != Readiness::Ready {
            Self::Store(readiness)
        } else if !listening {
            Self::NotListening
        } else {
            Self::Ready
        }
    }

    pub fn is_ready(self) -> bool {
        self == Self::Ready
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready | Self::Store(Readiness::Ready) => "ready",
            Self::Store(Readiness::Loading) => "loading",
            Self::Store(Readiness::NoKey) => "no key",
            Self::Store(Readiness::KeyMismatch) => "key mismatch",
            Self::Store(Readiness::EpochMismatch) => "epoch mismatch",
            Self::Store(Readiness::Draining) | Self::Draining => "draining",
            Self::NotListening => "not listening",
        }
    }
}

/// What the listener itself knows: whether its ports are up, and whether it is shutting down.
#[derive(Default)]
pub(super) struct Flags {
    listening: AtomicBool,
    draining: AtomicBool,
}

impl Flags {
    pub(super) fn set_listening(&self, listening: bool) {
        self.listening.store(listening, Ordering::Relaxed);
    }

    pub(super) fn begin_drain(&self) {
        self.draining.store(true, Ordering::Relaxed);
    }

    pub(super) fn state(&self, readiness: Readiness) -> HealthState {
        HealthState::of(
            readiness,
            self.draining.load(Ordering::Relaxed),
            self.listening.load(Ordering::Relaxed),
        )
    }
}

/// Every request, whatever its method or path, gets 200 when ready and 503 otherwise.
pub(super) fn router(flags: Arc<Flags>, directory: Arc<dyn Directory>) -> Router {
    Router::new().fallback(move || {
        let state = flags.state(directory.readiness());
        async move {
            let status = if state.is_ready() {
                StatusCode::OK
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            };
            (status, state.as_str())
        }
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::{body::Body, extract::Request};
    use tower::ServiceExt;

    use super::{
        super::{
            Running,
            proxy_protocol::Proxy,
            router::Pages,
            testkit::{Fake, HOST, SLUG, free_port, local_plan, plain_get, proxy_header},
        },
        *,
    };

    const NO_PREFACE: &[u8] = b"";

    async fn health(running: &Running, preface: &[u8]) -> (u16, String) {
        let addr = running.health_addr().unwrap();
        let (status, text) = plain_get(addr, preface, None, "/healthz").await.unwrap();
        (status, text.rsplit("\r\n\r\n").next().unwrap().to_string())
    }

    fn running(fake: &Arc<Fake>, flags: &Arc<Flags>) -> Running {
        let plan = local_plan(Proxy::Off);
        Running::new(plan, fake.clone(), flags.clone(), Pages::live())
    }

    #[test]
    fn the_state_names_each_condition_and_only_ready_is_ready() {
        use Readiness::{EpochMismatch, KeyMismatch, Loading, NoKey, Ready};
        let table = [
            (Loading, false, true, HealthState::Store(Loading), "loading"),
            (NoKey, false, true, HealthState::Store(NoKey), "no key"),
            (
                KeyMismatch,
                false,
                true,
                HealthState::Store(KeyMismatch),
                "key mismatch",
            ),
            (
                EpochMismatch,
                false,
                true,
                HealthState::Store(EpochMismatch),
                "epoch mismatch",
            ),
            (Ready, true, true, HealthState::Draining, "draining"),
            (
                Readiness::Draining,
                false,
                true,
                HealthState::Draining,
                "draining",
            ),
            (KeyMismatch, true, false, HealthState::Draining, "draining"),
            (
                Ready,
                false,
                false,
                HealthState::NotListening,
                "not listening",
            ),
            (
                Loading,
                false,
                false,
                HealthState::Store(Loading),
                "loading",
            ),
            (Ready, false, true, HealthState::Ready, "ready"),
        ];
        for (readiness, draining, listening, state, name) in table {
            let flags = Flags::default();
            flags.set_listening(listening);
            if draining {
                flags.begin_drain();
            }
            assert_eq!(flags.state(readiness), state, "{readiness:?}");
            assert_eq!(state.as_str(), name);
            assert_eq!(state.is_ready(), state == HealthState::Ready);
        }
    }

    #[tokio::test]
    async fn every_request_gets_the_state_whatever_its_method_or_path() {
        let (fake, flags) = (Fake::new(), Arc::new(Flags::default()));
        flags.set_listening(true);
        let app = router(flags.clone(), fake.clone());
        for (method, path) in [
            ("GET", "/healthz"),
            ("GET", "/"),
            ("POST", "/x/y"),
            ("HEAD", "/healthz"),
        ] {
            let request = || {
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap()
            };
            let ready = app.clone().oneshot(request()).await.unwrap();
            assert_eq!(ready.status(), StatusCode::OK, "{method} {path}");
            fake.set_readiness(Readiness::KeyMismatch);
            let mismatch = app.clone().oneshot(request()).await.unwrap();
            assert_eq!(
                mismatch.status(),
                StatusCode::SERVICE_UNAVAILABLE,
                "{method} {path}"
            );
            fake.set_readiness(Readiness::Ready);
        }
    }

    #[tokio::test]
    async fn the_health_port_is_up_and_503_while_the_tls_port_refuses_before_the_first_load() {
        let fake = Fake::loading();
        let flags = Arc::new(Flags::default());
        let tls = free_port();
        let mut plan = local_plan(Proxy::Off);
        plan.https = tls;
        let mut running = Running::new(plan, fake.clone(), flags.clone(), Pages::live());
        running.bind_health();
        assert_eq!(
            health(&running, NO_PREFACE).await,
            (503, "loading".to_string())
        );
        assert!(tokio::net::TcpStream::connect(tls).await.is_err());

        let binding = tokio::spawn(async move {
            running.bind_domain_ports().await;
            running
        });
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(
            tokio::net::TcpStream::connect(tls).await.is_err(),
            "no bind before loaded()"
        );
        assert_eq!(fake.listening(), None);

        fake.finish_loading();
        let running = binding.await.unwrap();
        assert_eq!(
            health(&running, NO_PREFACE).await,
            (200, "ready".to_string())
        );
        assert_eq!(fake.listening(), running.https_addr());
        assert!(tokio::net::TcpStream::connect(tls).await.is_ok());
        running.drain().await;
    }

    #[tokio::test]
    async fn the_health_port_follows_the_store_with_and_without_a_proxy_header_of_either_version() {
        let (fake, flags) = (Fake::new(), Arc::new(Flags::default()));
        let mut running = running(&fake, &flags);
        running.bind_health();
        running.bind_domain_ports().await;
        let prefaces = [
            NO_PREFACE.to_vec(),
            proxy_header(1, "198.51.100.1"),
            proxy_header(2, "2001:db8::1"),
        ];
        for preface in &prefaces {
            assert_eq!(health(&running, preface).await, (200, "ready".to_string()));
        }
        for (readiness, name) in [
            (Readiness::KeyMismatch, "key mismatch"),
            (Readiness::EpochMismatch, "epoch mismatch"),
            (Readiness::NoKey, "no key"),
        ] {
            fake.set_readiness(readiness);
            for preface in &prefaces {
                assert_eq!(health(&running, preface).await, (503, name.to_string()));
            }
        }
        fake.set_readiness(Readiness::Ready);
        assert_eq!(health(&running, NO_PREFACE).await.0, 200);
        running.drain().await;
    }

    #[tokio::test]
    async fn the_health_port_says_503_from_the_start_of_a_drain_and_the_store_is_told() {
        let (fake, flags) = (Fake::new(), Arc::new(Flags::default()));
        fake.serve(HOST, SLUG);
        let mut running = running(&fake, &flags);
        running.bind_health();
        running.bind_domain_ports().await;
        let health_addr = running.health_addr().unwrap();
        assert_eq!(
            plain_get(health_addr, NO_PREFACE, None, "/")
                .await
                .unwrap()
                .0,
            200
        );

        let draining = tokio::spawn(running.drain());
        // the drain reports not ready before it stops accepting anything
        for _ in 0..100 {
            if flags.state(Readiness::Ready) == HealthState::Draining {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert_eq!(flags.state(Readiness::Ready), HealthState::Draining);
        assert!(fake.drained());
        let app = router(flags.clone(), fake.clone());
        let request = || {
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap()
        };
        let response = app.oneshot(request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        tokio::time::timeout(Duration::from_secs(10), draining)
            .await
            .unwrap()
            .unwrap();
        assert!(
            plain_get(health_addr, NO_PREFACE, None, "/").await.is_err(),
            "the port is closed"
        );
    }

    #[tokio::test]
    async fn the_health_state_is_not_listening_when_the_tls_port_could_not_be_bound() {
        let (fake, flags) = (Fake::new(), Arc::new(Flags::default()));
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut plan = local_plan(Proxy::Off);
        plan.https = taken.local_addr().unwrap();
        let mut running = Running::new(plan, fake.clone(), flags.clone(), Pages::live());
        running.bind_health();
        running.bind_domain_ports().await;
        assert_eq!(running.https_addr(), None);
        assert_eq!(fake.listening(), None);
        assert_eq!(flags.state(Readiness::Ready), HealthState::NotListening);
        assert_eq!(
            health(&running, NO_PREFACE).await,
            (503, "not listening".to_string())
        );
        running.drain().await;
    }

    #[tokio::test]
    async fn a_header_that_names_nobody_still_gets_the_health_answer() {
        const V2_SIGNATURE: &[u8] = b"\r\n\r\n\0\r\nQUIT\n";
        let v2 = |command: u8| [V2_SIGNATURE, &[command, 0x00, 0, 0]].concat();
        let (fake, flags) = (Fake::new(), Arc::new(Flags::default()));
        let mut running = running(&fake, &flags);
        running.bind_health();
        running.bind_domain_ports().await;
        let health = running.health_addr().unwrap();
        let prefaces = [b"PROXY UNKNOWN\r\n".to_vec(), v2(0x20), v2(0x21)];
        for preface in &prefaces {
            let (status, text) = plain_get(health, preface, None, "/healthz").await.unwrap();
            assert_eq!(status, 200, "{preface:?}: {text}");
        }
        fake.set_readiness(Readiness::KeyMismatch);
        for preface in &prefaces {
            let (status, text) = plain_get(health, preface, None, "/healthz").await.unwrap();
            assert_eq!(status, 503, "{preface:?}: {text}");
            assert!(text.ends_with("key mismatch"), "{text}");
        }
        running.drain().await;
    }
}
