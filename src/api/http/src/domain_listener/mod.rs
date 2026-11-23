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

//! The TLS listener that serves only status pages on custom domains, in the main server's process;
//! a listener failure never stops the main server.

mod acceptor;
mod health;
mod proxy_protocol;
mod router;
#[cfg(test)]
mod testkit;

use std::{
    future::Future,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{Arc, LazyLock},
    time::Duration,
};

use acceptor::{DomainAcceptor, HEAD_TIMEOUT, HeaderAcceptor, Stop};
use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    response::Response,
};
use axum_server::Handle;
use config::meta::cluster::{Node, Role};
use futures::future::BoxFuture;
use health::Flags;
pub use health::HealthState;
use hyper_util::rt::TokioTimer;
use o2_enterprise::enterprise::status_pages::cert_store::{
    self, PageGate, PageRef, Readiness, StoreEntry,
};
use proxy_protocol::{Proxy, Trusted, empty_list_notice};
use router::Pages;
use tokio::task::JoinHandle;
use tokio_rustls::rustls::sign::CertifiedKey;

const MAX_STREAMS: u32 = 32;
/// How long the health port keeps answering 503 after the other ports are drained.
const HEALTH_GRACE: Duration = Duration::from_secs(1);

static FLAGS: LazyLock<Arc<Flags>> = LazyLock::new(|| Arc::new(Flags::default()));

/// The store and the process, as the listener sees them, so a test can replace both.
trait Directory: Send + Sync + 'static {
    fn entry(&self, hostname: &str) -> Option<Arc<StoreEntry>>;
    fn challenge(&self, hostname: &str) -> Option<Arc<CertifiedKey>>;
    fn readiness(&self) -> Readiness;
    fn page_gate(&self, page: &PageRef) -> PageGate;
    fn record_peer(&self, private: bool);
    fn set_listening(&self, addr: SocketAddr);
    fn begin_drain(&self);
    fn loaded(&self) -> BoxFuture<'static, ()>;
}

/// The certificate store of the process.
struct Global;

impl Directory for Global {
    fn entry(&self, hostname: &str) -> Option<Arc<StoreEntry>> {
        cert_store::lookup(hostname)
    }

    fn challenge(&self, hostname: &str) -> Option<Arc<CertifiedKey>> {
        cert_store::challenge(hostname)
    }

    fn readiness(&self) -> Readiness {
        cert_store::readiness()
    }

    fn page_gate(&self, page: &PageRef) -> PageGate {
        cert_store::page_gate(page)
    }

    fn record_peer(&self, private: bool) {
        cert_store::record_peer(private);
    }

    fn set_listening(&self, addr: SocketAddr) {
        cert_store::set_listening(addr);
    }

    fn begin_drain(&self) {
        cert_store::begin_drain();
    }

    fn loaded(&self) -> BoxFuture<'static, ()> {
        Box::pin(cert_store::loaded())
    }
}

/// The settings the listener reads, apart from whether built-in TLS is on.
struct Settings {
    https_port: u16,
    http_port: u16,
    health_port: u16,
    proxy_protocol: bool,
    trusted_cidrs: String,
    ipv6: bool,
    addr: String,
    shutdown_secs: u64,
    main_port: u16,
}

impl Settings {
    fn from_config() -> Self {
        let cfg = config::get_config();
        let domain = &cfg.status_page_domain;
        Self {
            https_port: domain.https_port,
            http_port: domain.http_port,
            health_port: domain.health_port,
            proxy_protocol: domain.proxy_protocol,
            trusted_cidrs: domain.proxy_trusted_cidrs.clone(),
            ipv6: cfg.http.ipv6_enabled,
            addr: cfg.http.addr.clone(),
            shutdown_secs: cfg.limit.http_shutdown_timeout,
            main_port: cfg.http.port,
        }
    }

    fn bind_addr(&self, port: u16) -> SocketAddr {
        let ip = if self.ipv6 {
            IpAddr::V6(Ipv6Addr::UNSPECIFIED)
        } else {
            self.addr
                .parse()
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
        };
        SocketAddr::new(ip, port)
    }
}

/// What to bind. A port of 0 turns the redirect and the health port off, and the TLS port turns
/// the whole listener off.
struct Plan {
    https: SocketAddr,
    redirect: Option<SocketAddr>,
    health: Option<SocketAddr>,
    proxy: Proxy,
    graceful: Duration,
    main_port: u16,
}

impl Plan {
    /// `enabled` is `cert_store::enabled()`; no target or mode is read here.
    fn decide(enabled: bool, node_serves: bool, settings: &Settings) -> Option<Self> {
        if !enabled || !node_serves || settings.https_port == 0 {
            return None;
        }
        let port = |port: u16| (port != 0).then(|| settings.bind_addr(port));
        let proxy = if settings.proxy_protocol {
            Proxy::Required(Arc::new(Trusted::parse(&settings.trusted_cidrs)))
        } else {
            Proxy::Off
        };
        Some(Self {
            https: settings.bind_addr(settings.https_port),
            redirect: port(settings.http_port),
            health: port(settings.health_port),
            proxy,
            graceful: Duration::from_secs(settings.shutdown_secs.max(1)),
            main_port: settings.main_port,
        })
    }

    fn start_notice(&self) -> Option<String> {
        match &self.proxy {
            Proxy::Required(trusted) => empty_list_notice(true, trusted),
            Proxy::Off | Proxy::Optional => None,
        }
    }

    /// Port 0 asks for any free port, which is never the main one.
    fn is_main_port(&self, addr: SocketAddr) -> bool {
        addr.port() != 0 && addr.port() == self.main_port
    }
}

struct Bound {
    addr: SocketAddr,
    handle: Handle<SocketAddr>,
    task: JoinHandle<()>,
}

/// The ports the listener holds, bound in the order the design gives.
struct Running {
    plan: Plan,
    directory: Arc<dyn Directory>,
    flags: Arc<Flags>,
    pages: Pages,
    stop: Arc<Stop>,
    /// The health port keeps admitting probes, which answer 503, until the other ports are
    /// drained.
    health_stop: Arc<Stop>,
    health: Option<Bound>,
    https: Option<Bound>,
    redirect: Option<Bound>,
}

impl Running {
    fn new(plan: Plan, directory: Arc<dyn Directory>, flags: Arc<Flags>, pages: Pages) -> Self {
        Self {
            plan,
            directory,
            flags,
            pages,
            stop: Stop::new(),
            health_stop: Stop::new(),
            health: None,
            https: None,
            redirect: None,
        }
    }

    /// The health port is first, so a load balancer sees 503 while the store loads.
    fn bind_health(&mut self) {
        let Some(addr) = self.plan.health else {
            return;
        };
        let app = health::router(self.flags.clone(), self.directory.clone());
        self.health = self.start_port("health", addr, |listener, handle| {
            let mut server = axum_server::from_tcp(listener)?
                .acceptor(HeaderAcceptor::health(self.health_stop.clone()))
                .handle(handle);
            apply_limits(&mut server);
            Ok(async move { server.serve(app.into_make_service()).await })
        });
    }

    /// Waits for the first load, then binds the TLS port and the redirect port.
    async fn bind_domain_ports(&mut self) {
        self.directory.loaded().await;
        self.bind_https();
        self.bind_redirect();
    }

    fn bind_https(&mut self) {
        let acceptor = DomainAcceptor::new(
            self.directory.clone(),
            self.plan.proxy.clone(),
            self.stop.clone(),
        );
        let app = router::router(self.directory.clone(), self.pages);
        self.https = self.start_port("TLS", self.plan.https, |listener, handle| {
            let mut server = axum_server::from_tcp(listener)?
                .acceptor(acceptor)
                .handle(handle);
            apply_limits(&mut server);
            Ok(async move { server.serve(app.into_make_service()).await })
        });
        if let Some(https) = &self.https {
            self.flags.set_listening(true);
            self.directory.set_listening(https.addr);
        }
    }

    fn bind_redirect(&mut self) {
        let Some(addr) = self.plan.redirect else {
            return;
        };
        let app = redirect_router(self.directory.clone());
        let acceptor = HeaderAcceptor::redirect(self.plan.proxy.clone(), self.stop.clone());
        self.redirect = self.start_port("redirect", addr, |listener, handle| {
            let mut server = axum_server::from_tcp(listener)?
                .acceptor(acceptor)
                .handle(handle);
            apply_limits(&mut server);
            Ok(async move { server.serve(app.into_make_service()).await })
        });
    }

    /// The main HTTP port is the main server's, whoever binds first: a domain port on it is a bind
    /// failure of the domain port, never of the main server.
    fn check_free(&self, addr: SocketAddr) -> io::Result<()> {
        if self.plan.is_main_port(addr) {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "the port is the one of the main HTTP server",
            ));
        }
        Ok(())
    }

    /// Binds the port and serves it in a task. A port that cannot be bound is an error in the log
    /// and a 503 on the health port, never more.
    fn start_port<F>(
        &self,
        port: &'static str,
        addr: SocketAddr,
        build: impl FnOnce(std::net::TcpListener, Handle<SocketAddr>) -> io::Result<F>,
    ) -> Option<Bound>
    where
        F: Future<Output = io::Result<()>> + Send + 'static,
    {
        let handle = Handle::new();
        let started = self
            .check_free(addr)
            .and_then(|()| bind(port, addr))
            .and_then(|(listener, bound)| {
                let serving = build(listener, handle.clone())?;
                let task = tokio::spawn(finish(port, self.flags.clone(), serving));
                Ok(Bound {
                    addr: bound,
                    handle: handle.clone(),
                    task,
                })
            });
        started
            .inspect_err(|e| {
                log::error!("[status_pages] the domain {port} port could not be bound: {e}");
                if port != "health" {
                    self.flags.set_listening(false);
                }
            })
            .ok()
    }

    /// Reports not ready first, stops accepting, lets connections finish, then closes health.
    async fn drain(self) {
        self.flags.begin_drain();
        self.directory.begin_drain();
        self.stop.signal();
        let domain = [self.https, self.redirect];
        for bound in domain.iter().flatten() {
            bound.handle.graceful_shutdown(Some(self.plan.graceful));
        }
        for bound in domain.into_iter().flatten() {
            let _ = bound.task.await;
        }
        if let Some(health) = self.health {
            self.health_stop.signal();
            health.handle.graceful_shutdown(Some(HEALTH_GRACE));
            let _ = health.task.await;
        }
    }

    #[cfg(test)]
    fn https_addr(&self) -> Option<SocketAddr> {
        self.https.as_ref().map(|bound| bound.addr)
    }

    #[cfg(test)]
    fn redirect_addr(&self) -> Option<SocketAddr> {
        self.redirect.as_ref().map(|bound| bound.addr)
    }

    #[cfg(test)]
    fn health_addr(&self) -> Option<SocketAddr> {
        self.health.as_ref().map(|bound| bound.addr)
    }
}

/// Starts the listener in the background when this node serves custom domains. The handle ends
/// after the drain; a failure inside it is logged and never reaches the caller.
pub fn spawn() -> Option<JoinHandle<()>> {
    let settings = Settings::from_config();
    let plan = Plan::decide(
        cert_store::enabled(),
        serves_domains(&config::cluster::LOCAL_NODE),
        &settings,
    )?;
    let stop = crate::server::shutdown_started();
    Some(tokio::spawn(run(
        plan,
        Arc::new(Global),
        FLAGS.clone(),
        Pages::live(),
        stop,
    )))
}

/// The state the health port reports; `domain-ops` reads it for the installation status.
pub fn health_state() -> HealthState {
    FLAGS.state(cert_store::readiness())
}

/// Router and `all` nodes, and local mode: the nodes that run the main server and its UI.
fn serves_domains(node: &Node) -> bool {
    node.is_single_node() || serves_roles(node)
}

fn serves_roles(node: &Node) -> bool {
    node.is_router() || node.role.contains(&Role::All)
}

async fn run(
    plan: Plan,
    directory: Arc<dyn Directory>,
    flags: Arc<Flags>,
    pages: Pages,
    stop: impl Future<Output = ()>,
) {
    if let Some(notice) = plan.start_notice() {
        log::error!("{notice}");
    }
    let mut running = Running::new(plan, directory, flags, pages);
    running.bind_health();
    tokio::pin!(stop);
    tokio::select! {
        () = &mut stop => {}
        () = running.bind_domain_ports() => stop.await,
    }
    running.drain().await;
}

fn bind(port: &str, addr: SocketAddr) -> io::Result<(std::net::TcpListener, SocketAddr)> {
    let listener = std::net::TcpListener::bind(addr)?;
    listener.set_nonblocking(true)?;
    let bound = listener.local_addr()?;
    log::info!("[status_pages] the domain {port} port listens on {bound}");
    Ok((listener, bound))
}

/// The HTTP limits of the design: the request head, and the streams of one HTTP/2 connection.
fn apply_limits<A>(server: &mut axum_server::Server<SocketAddr, A>) {
    let builder = server.http_builder();
    builder
        .http1()
        .timer(TokioTimer::new())
        .header_read_timeout(HEAD_TIMEOUT);
    builder
        .http2()
        .timer(TokioTimer::new())
        .max_concurrent_streams(MAX_STREAMS);
}

/// An accept loop that ends in an error leaves the port dead, so the health port says so.
async fn finish(
    port: &'static str,
    flags: Arc<Flags>,
    serving: impl Future<Output = io::Result<()>>,
) {
    if let Err(e) = serving.await {
        log::error!("[status_pages] the domain {port} port stopped accepting: {e}");
        if port != "health" {
            flags.set_listening(false);
        }
    }
}

/// A hostname in the store goes to HTTPS; any other gets 404.
fn redirect_router(directory: Arc<dyn Directory>) -> Router {
    Router::new().fallback(move |request: Request| {
        let response = redirect(directory.as_ref(), &request);
        async move { response }
    })
}

fn redirect(directory: &dyn Directory, request: &Request) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(':').next())
        .map(str::to_ascii_lowercase);
    let Some(host) = host.filter(|host| directory.entry(host).is_some()) else {
        return router::not_connected();
    };
    let target = request
        .uri()
        .path_and_query()
        .map_or("/", |target| target.as_str());
    Response::builder()
        .status(StatusCode::PERMANENT_REDIRECT)
        .header(header::LOCATION, format!("https://{host}{target}"))
        .body(Body::empty())
        .unwrap_or_else(|_| router::not_connected())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        sync::oneshot,
    };

    use super::{
        acceptor::{
            ESTABLISHED_PER_ADDRESS, HEAD_TIMEOUT, HEALTH_POOL, IDLE_TIMEOUT, REDIRECT_POOL,
        },
        testkit::{
            Fake, HOST, SLUG, connect, elapsed_until, free_port, is_closed, local_plan, near,
            plain_get, proxied, proxy_header,
        },
        *,
    };

    fn settings() -> Settings {
        Settings {
            https_port: 5443,
            http_port: 5088,
            health_port: 5089,
            proxy_protocol: false,
            trusted_cidrs: String::new(),
            ipv6: false,
            addr: String::new(),
            shutdown_secs: 10,
            main_port: 5080,
        }
    }

    fn node(roles: &[Role]) -> Node {
        Node {
            role: roles.to_vec(),
            ..Node::default()
        }
    }

    fn trusted() -> Proxy {
        Proxy::Required(Arc::new(Trusted::parse("127.0.0.0/8")))
    }

    #[test]
    fn the_gate_starts_nothing_unless_built_in_tls_is_on_on_a_serving_node_with_a_tls_port() {
        let plan = Plan::decide(true, true, &settings()).unwrap();
        assert_eq!(plan.https.port(), 5443);
        assert_eq!(plan.redirect.map(|addr| addr.port()), Some(5088));
        assert_eq!(plan.health.map(|addr| addr.port()), Some(5089));
        assert_eq!(plan.graceful, Duration::from_secs(10));

        for https_port in [0, 5443, 443] {
            for http_port in [0, 5088] {
                for health_port in [0, 5089] {
                    for proxy_protocol in [false, true] {
                        let settings = Settings {
                            https_port,
                            http_port,
                            health_port,
                            proxy_protocol,
                            ..settings()
                        };
                        assert!(
                            Plan::decide(false, true, &settings).is_none(),
                            "built-in TLS off"
                        );
                        assert!(
                            Plan::decide(true, false, &settings).is_none(),
                            "not a serving node"
                        );
                        assert_eq!(
                            Plan::decide(true, true, &settings).is_some(),
                            https_port != 0
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn the_gate_does_not_start_in_proxy_mode_with_or_without_a_target_and_does_in_built_in_mode() {
        use o2_enterprise::enterprise::status_pages::cert_store::{
            CertificateMode, built_in_tls_on,
        };

        for target in ["", "domains.example.com"] {
            let enabled = built_in_tls_on(CertificateMode::Proxy, target, false);
            assert!(!enabled, "proxy mode never runs built-in TLS: {target:?}");
            assert!(
                Plan::decide(enabled, true, &settings()).is_none(),
                "{target:?}"
            );
        }
        let built_in = built_in_tls_on(CertificateMode::BuiltIn, "domains.example.com", false);
        assert!(Plan::decide(built_in, true, &settings()).is_some());
    }

    #[test]
    fn the_redirect_and_health_ports_turn_off_with_a_zero_and_proxy_protocol_reads_the_list() {
        let settings = Settings {
            http_port: 0,
            health_port: 0,
            proxy_protocol: true,
            trusted_cidrs: "10.0.0.0/8".to_string(),
            ..settings()
        };
        let plan = Plan::decide(true, true, &settings).unwrap();
        assert_eq!((plan.redirect, plan.health), (None, None));
        assert!(matches!(&plan.proxy, Proxy::Required(trusted) if !trusted.is_empty()));
        assert_eq!(plan.start_notice(), None);
    }

    #[test]
    fn proxy_protocol_with_an_empty_list_trusts_nothing_and_the_start_notice_says_so() {
        let on = Settings {
            proxy_protocol: true,
            ..settings()
        };
        let plan = Plan::decide(true, true, &on).unwrap();
        assert!(matches!(&plan.proxy, Proxy::Required(trusted) if trusted.is_empty()));
        assert!(
            plan.start_notice()
                .unwrap()
                .contains("no source is trusted")
        );
        let off = Plan::decide(true, true, &settings()).unwrap();
        assert_eq!(off.start_notice(), None);
    }

    #[test]
    fn the_listen_address_follows_the_http_settings() {
        let plain = settings().bind_addr(5443);
        assert_eq!(plain, "0.0.0.0:5443".parse().unwrap());
        let bound = Settings {
            addr: "10.1.2.3".to_string(),
            ..settings()
        }
        .bind_addr(5443);
        assert_eq!(bound, "10.1.2.3:5443".parse().unwrap());
        let v6 = Settings {
            ipv6: true,
            ..settings()
        }
        .bind_addr(5088);
        assert_eq!(v6, "[::]:5088".parse().unwrap());
    }

    #[test]
    fn router_all_and_local_nodes_serve_domains_and_the_others_do_not() {
        assert!(serves_roles(&node(&[Role::Router])));
        assert!(serves_roles(&node(&[Role::All])));
        assert!(serves_roles(&node(&[Role::Router, Role::Querier])));
        assert!(!serves_roles(&node(&[Role::Ingester])));
        assert!(!serves_roles(&node(&[Role::Querier, Role::Scheduler])));
        assert!(!serves_roles(&node(&[Role::Compactor])));
        // local mode is the other half, and it is what the config of this process says
        assert_eq!(
            serves_domains(&node(&[Role::Ingester])),
            config::get_config().common.local_mode
        );
        assert!(serves_domains(&node(&[Role::Router])));
    }

    #[tokio::test]
    async fn a_process_without_built_in_tls_spawns_no_task_and_binds_no_port() {
        assert!(!cert_store::enabled());
        assert!(spawn().is_none());
    }

    #[tokio::test]
    async fn an_accept_loop_that_ends_in_an_error_turns_the_state_to_not_listening() {
        let flags = Arc::new(Flags::default());
        flags.set_listening(true);
        assert_eq!(flags.state(Readiness::Ready), HealthState::Ready);
        finish("health", flags.clone(), async {
            Err(io::Error::other("health died"))
        })
        .await;
        assert_eq!(flags.state(Readiness::Ready), HealthState::Ready);
        finish("TLS", flags.clone(), async {
            Err(io::Error::other("accept died"))
        })
        .await;
        assert_eq!(flags.state(Readiness::Ready), HealthState::NotListening);
        flags.set_listening(true);
        finish("TLS", flags.clone(), async { Ok(()) }).await;
        assert_eq!(flags.state(Readiness::Ready), HealthState::Ready);
    }

    #[tokio::test]
    async fn the_redirect_port_sends_a_store_hostname_to_https_and_answers_404_to_any_other() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let flags = Arc::new(Flags::default());
        let mut running = Running::new(local_plan(Proxy::Off), fake, flags, Pages::live());
        running.bind_domain_ports().await;
        let redirect = running.redirect_addr().unwrap();

        let (status, text) = plain_get(redirect, b"", Some(HOST), "/status/x?a=1")
            .await
            .unwrap();
        assert_eq!(status, 308);
        assert!(
            text.contains(&format!("location: https://{HOST}/status/x?a=1")),
            "{text}"
        );
        let (_, text) = plain_get(
            redirect,
            b"",
            Some(&format!("{}:5088", HOST.to_uppercase())),
            "/",
        )
        .await
        .unwrap();
        assert!(
            text.contains(&format!("location: https://{HOST}/")),
            "{text}"
        );
        for host in [Some("other.brand.test"), Some("127.0.0.1"), None] {
            let (status, _) = plain_get(redirect, b"", host, "/").await.unwrap();
            assert_eq!(status, 404, "{host:?}");
        }
        running.drain().await;
    }

    #[tokio::test]
    async fn the_redirect_port_needs_a_trusted_proxy_header_when_proxy_protocol_is_on() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let flags = Arc::new(Flags::default());
        let mut running = Running::new(
            local_plan(trusted()),
            fake.clone(),
            flags.clone(),
            Pages::live(),
        );
        running.bind_domain_ports().await;
        let redirect = running.redirect_addr().unwrap();
        for version in [1, 2] {
            let preface = proxy_header(version, "198.51.100.1");
            let (status, _) = plain_get(redirect, &preface, Some(HOST), "/")
                .await
                .unwrap();
            assert_eq!(status, 308, "version {version}");
        }
        let (status, _) = plain_get(redirect, b"", Some(HOST), "/").await.unwrap();
        assert_eq!(status, 0, "no header, no answer");
        let unknown = b"PROXY UNKNOWN\r\n";
        assert_eq!(
            plain_get(redirect, unknown, Some(HOST), "/")
                .await
                .unwrap()
                .0,
            0
        );
        running.drain().await;

        let empty = Proxy::Required(Arc::new(Trusted::parse("")));
        let mut running = Running::new(local_plan(empty), fake, flags, Pages::live());
        running.bind_domain_ports().await;
        let preface = proxy_header(1, "198.51.100.1");
        let refused = plain_get(running.redirect_addr().unwrap(), &preface, Some(HOST), "/").await;
        assert_eq!(refused.unwrap().0, 0, "an empty list trusts no source");
        running.drain().await;
    }

    #[tokio::test]
    async fn a_tls_port_that_cannot_be_bound_never_stops_run_and_the_listener_drains_on_stop() {
        let fake = Fake::new();
        let flags = Arc::new(Flags::default());
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut plan = local_plan(Proxy::Off);
        plan.https = taken.local_addr().unwrap();
        let (stop, stopped) = oneshot::channel::<()>();
        let run = tokio::spawn(run(
            plan,
            fake.clone(),
            flags.clone(),
            Pages::live(),
            async move {
                let _ = stopped.await;
            },
        ));
        let mut state = flags.state(fake.readiness());
        for _ in 0..100 {
            state = flags.state(fake.readiness());
            if state == HealthState::NotListening {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(state, HealthState::NotListening);
        assert!(
            !run.is_finished(),
            "the failure is logged and the task keeps going"
        );
        stop.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(10), run)
            .await
            .unwrap()
            .unwrap();
        assert!(fake.drained());
    }

    #[tokio::test]
    async fn a_stop_while_the_store_is_still_loading_ends_run_with_the_health_port_closed() {
        let fake = Fake::loading();
        let flags = Arc::new(Flags::default());
        let tls = free_port();
        let mut plan = local_plan(Proxy::Off);
        plan.https = tls;
        let (stop, stopped) = oneshot::channel::<()>();
        let run = tokio::spawn(run(plan, fake.clone(), flags, Pages::live(), async move {
            let _ = stopped.await;
        }));
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(tokio::net::TcpStream::connect(tls).await.is_err());
        stop.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(10), run)
            .await
            .unwrap()
            .unwrap();
        assert!(fake.drained());
        assert!(tokio::net::TcpStream::connect(tls).await.is_err());
    }

    #[tokio::test]
    async fn the_tls_port_serves_a_hostname_of_the_store() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let flags = Arc::new(Flags::default());
        let mut running = Running::new(local_plan(Proxy::Off), fake, flags, Pages::live());
        running.bind_domain_ports().await;
        assert!(
            connect(running.https_addr().unwrap(), HOST, &[b"h2"])
                .await
                .is_ok()
        );
        assert!(
            connect(running.https_addr().unwrap(), "other.brand.test", &[])
                .await
                .is_err()
        );
        running.drain().await;
    }

    async fn serving(proxy: Proxy) -> (Running, Arc<Fake>, Arc<Flags>) {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let flags = Arc::new(Flags::default());
        let mut running = Running::new(
            local_plan(proxy),
            fake.clone(),
            flags.clone(),
            Pages::live(),
        );
        running.bind_health();
        running.bind_domain_ports().await;
        (running, fake, flags)
    }

    async fn health_status(running: &Running) -> u16 {
        let addr = running.health_addr().unwrap();
        plain_get(addr, b"", None, "/healthz")
            .await
            .map_or(0, |answer| answer.0)
    }

    /// Reads until the server ends the connection; how long that took, in paused time.
    async fn closed_after(stream: &mut (impl AsyncReadExt + Unpin)) -> Duration {
        let mut rest = Vec::new();
        elapsed_until(stream.read_to_end(&mut rest)).await
    }

    #[tokio::test]
    async fn one_address_cannot_hold_more_redirect_connections_than_its_cap_and_health_still_answers()
     {
        let (running, ..) = serving(Proxy::Off).await;
        let redirect = running.redirect_addr().unwrap();
        let mut held = Vec::new();
        for _ in 0..ESTABLISHED_PER_ADDRESS {
            held.push(TcpStream::connect(redirect).await.unwrap());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut over = TcpStream::connect(redirect).await.unwrap();
        assert!(
            is_closed(&mut over).await,
            "the 65th connection of one address"
        );
        assert!(!is_closed(&mut held[0]).await);
        assert_eq!(health_status(&running).await, 200);
        drop(held);
        running.drain().await;
    }

    #[tokio::test]
    async fn the_redirect_pool_is_bounded_and_none_waits_while_health_keeps_its_own() {
        let (running, ..) = serving(trusted()).await;
        let redirect = running.redirect_addr().unwrap();
        let mut held = Vec::new();
        for i in 0..REDIRECT_POOL {
            let address = format!("198.51.100.{}", i / 64 + 1);
            held.push(proxied(redirect, 1, &address).await);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        let started = std::time::Instant::now();
        let mut late = proxied(redirect, 1, "198.51.100.200").await;
        assert!(is_closed(&mut late).await, "the 257th connection");
        assert!(started.elapsed() < Duration::from_secs(1));
        assert_eq!(health_status(&running).await, 200);
        drop(held);
        running.drain().await;
    }

    #[tokio::test]
    async fn the_health_pool_is_bounded_apart_from_the_redirect_pool() {
        let (running, ..) = serving(Proxy::Off).await;
        let health = running.health_addr().unwrap();
        let mut held = Vec::new();
        for _ in 0..HEALTH_POOL {
            held.push(TcpStream::connect(health).await.unwrap());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut over = TcpStream::connect(health).await.unwrap();
        assert!(is_closed(&mut over).await, "the 65th health connection");
        let redirect = running.redirect_addr().unwrap();
        let (status, _) = plain_get(redirect, b"", Some(HOST), "/").await.unwrap();
        assert_eq!(status, 308);
        drop(held);
        running.drain().await;
    }

    #[tokio::test]
    async fn a_silent_redirect_connection_is_cut_at_the_head_deadline() {
        let (running, ..) = serving(Proxy::Off).await;
        let mut tcp = TcpStream::connect(running.redirect_addr().unwrap())
            .await
            .unwrap();
        let took = closed_after(&mut tcp).await;
        assert!(near(took, HEAD_TIMEOUT), "{took:?}");
    }

    #[tokio::test]
    async fn an_http_2_connection_on_the_redirect_port_with_no_request_is_cut_at_the_head_deadline()
    {
        let (running, ..) = serving(Proxy::Off).await;
        let tcp = TcpStream::connect(running.redirect_addr().unwrap())
            .await
            .unwrap();
        let (_client, connection) = h2::client::handshake(tcp).await.unwrap();
        let took = elapsed_until(connection).await;
        assert!(near(took, HEAD_TIMEOUT), "{took:?}");
    }

    #[tokio::test]
    async fn an_http_2_connection_on_the_redirect_port_is_idle_for_60_seconds_after_its_request() {
        let (running, ..) = serving(Proxy::Off).await;
        let tcp = TcpStream::connect(running.redirect_addr().unwrap())
            .await
            .unwrap();
        let (client, connection) = h2::client::handshake(tcp).await.unwrap();
        let driver = tokio::spawn(connection);
        let request = http::Request::get("http://other.brand.test/")
            .body(())
            .unwrap();
        let (response, _) = client
            .clone()
            .ready()
            .await
            .unwrap()
            .send_request(request, true)
            .unwrap();
        assert_eq!(response.await.unwrap().status(), 404);
        let took = elapsed_until(driver).await;
        assert!(near(took, IDLE_TIMEOUT), "{took:?}");
    }

    #[tokio::test]
    async fn a_domain_port_that_is_the_main_port_is_refused_and_never_bound() {
        let main = free_port();
        let mut plan = local_plan(Proxy::Off);
        plan.main_port = main.port();
        (plan.https, plan.redirect, plan.health) = (main, Some(main), Some(main));
        let fake = Fake::new();
        let flags = Arc::new(Flags::default());
        let mut running = Running::new(plan, fake.clone(), flags.clone(), Pages::live());
        running.bind_health();
        running.bind_domain_ports().await;
        assert_eq!(running.https_addr(), None);
        assert_eq!(running.redirect_addr(), None);
        assert_eq!(running.health_addr(), None);
        assert_eq!(fake.listening(), None);
        assert_eq!(flags.state(Readiness::Ready), HealthState::NotListening);
        assert!(
            std::net::TcpListener::bind(main).is_ok(),
            "the main server can still take its port"
        );
        running.drain().await;
    }

    #[test]
    fn only_the_main_http_port_is_reserved_and_port_zero_never_is() {
        let reserved = Settings {
            main_port: 5080,
            ..settings()
        };
        let plan = Plan::decide(true, true, &reserved).unwrap();
        let at = |port: u16| plan.is_main_port(SocketAddr::from(([0, 0, 0, 0], port)));
        assert!(at(5080));
        assert!(!at(5443) && !at(5088) && !at(5089) && !at(0));
        let unset = Plan::decide(
            true,
            true,
            &Settings {
                main_port: 0,
                ..settings()
            },
        )
        .unwrap();
        assert!(!unset.is_main_port(SocketAddr::from(([0, 0, 0, 0], 0))));
    }

    #[tokio::test]
    async fn a_drain_closes_a_handshake_in_progress_at_once() {
        let (running, ..) = serving(Proxy::Off).await;
        let mut partial = TcpStream::connect(running.https_addr().unwrap())
            .await
            .unwrap();
        partial
            .write_all(&[0x16, 0x03, 0x01, 0x02, 0x00])
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        let draining = tokio::spawn(running.drain());
        let mut rest = Vec::new();
        let ended =
            tokio::time::timeout(Duration::from_millis(500), partial.read_to_end(&mut rest));
        assert!(
            ended.await.is_ok(),
            "closed by the drain, not by the 3 s ClientHello deadline"
        );
        tokio::time::timeout(Duration::from_secs(10), draining)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn a_drain_leaves_no_new_connection_to_the_tls_port() {
        let (running, ..) = serving(Proxy::Off).await;
        let https = running.https_addr().unwrap();
        running.drain().await;
        assert!(connect(https, HOST, &[]).await.is_err());
    }

    #[tokio::test]
    async fn a_probe_during_a_drain_gets_503_over_tcp() {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        let flags = Arc::new(Flags::default());
        let mut plan = local_plan(Proxy::Off);
        plan.graceful = Duration::from_secs(5);
        let mut running = Running::new(plan, fake.clone(), flags.clone(), Pages::live());
        running.bind_health();
        running.bind_domain_ports().await;
        let health = running.health_addr().unwrap();
        // a request whose body never completes holds the TLS port's drain open until the grace ends
        let mut held = connect(running.https_addr().unwrap(), HOST, &[b"http/1.1"])
            .await
            .unwrap();
        let head = format!(
            "POST /api/status_pages_public_by_host/auth HTTP/1.1\r\nHost: {HOST}\r\nContent-Length: 100\r\n\r\n{{"
        );
        held.write_all(head.as_bytes()).await.unwrap();
        // the request reached the page gate, so the handler is now waiting for the rest of the body
        for _ in 0..500 {
            if fake.gate_calls() > 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(fake.gate_calls(), 1, "the server dispatched the request");

        let draining = tokio::spawn(running.drain());
        for _ in 0..100 {
            if flags.state(Readiness::Ready) == HealthState::Draining {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        for _ in 0..3 {
            let (status, text) = plain_get(health, b"", None, "/healthz").await.unwrap();
            assert_eq!(status, 503, "{text}");
            assert!(text.ends_with("draining"), "{text}");
        }
        assert!(
            !draining.is_finished(),
            "the request in flight holds the drain open"
        );
        drop(held);
        tokio::time::timeout(Duration::from_secs(10), draining)
            .await
            .unwrap()
            .unwrap();
    }
}
