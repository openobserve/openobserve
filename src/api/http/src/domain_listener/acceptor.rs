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

//! The acceptor of the domain listener: the eight connection steps of the design, from memory
//! only. A connection that fails a step is closed; nothing before step 8 signs or reads a database.

use std::{
    collections::HashMap,
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    pin::Pin,
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
    time::Duration,
};

use axum_server::accept::Accept;
use config::axum::middlewares::RealIp;
use futures::future::BoxFuture;
use http::Request;
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::TcpStream,
    sync::{OwnedSemaphorePermit, Semaphore, watch},
    time::{Instant, Sleep, sleep, timeout},
};
use tokio_rustls::{
    LazyConfigAcceptor, StartHandshake,
    rustls::{
        ServerConfig,
        crypto::ring,
        server::{Acceptor, ClientHello, NoServerSessionStorage, ResolvesServerCert},
        sign::CertifiedKey,
    },
    server::TlsStream,
};
use tower::Service;

use super::{
    Directory,
    proxy_protocol::{Proxy, visitor},
};

pub(super) const CLIENT_HELLO_DEADLINE: Duration = Duration::from_secs(3);
pub(super) const HANDSHAKE_DEADLINE: Duration = Duration::from_secs(10);
/// A validator finishes a challenge handshake at once, so a stalled one is given up early.
pub(super) const CHALLENGE_HANDSHAKE_DEADLINE: Duration = Duration::from_secs(3);
/// From admission to the first request, however many bytes arrive; it also covers the HTTP
/// version detection that comes before hyper's own head timer.
pub(super) const HEAD_TIMEOUT: Duration = Duration::from_secs(15);
/// No byte either way for this long ends a connection that has made its first request.
pub(super) const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const PRE_HANDSHAKE_POOL: usize = 256;
pub(super) const CHALLENGE_POOL: usize = 16;
pub(super) const MAIN_POOL: usize = 4096;
pub(super) const REDIRECT_POOL: usize = 256;
pub(super) const HEALTH_POOL: usize = 64;
pub(super) const PRE_HANDSHAKE_PER_ADDRESS: u32 = 8;
pub(super) const ESTABLISHED_PER_ADDRESS: u32 = 64;
pub(super) const CHALLENGE_PER_ADDRESS: u32 = 4;
/// 10 handshakes a second with a burst of 20.
const ADDRESS_RATE: Gcra = Gcra {
    interval: Duration::from_millis(100),
    burst: 20,
};
/// 200 handshakes a second with a burst of 400.
const LISTENER_RATE: Gcra = Gcra {
    interval: Duration::from_millis(5),
    burst: 400,
};
/// Idle entries are dropped only when the map is full.
const MAX_TRACKED_ADDRESSES: usize = 65_536;
const ACME_ALPN: &[u8] = b"acme-tls/1";
const CHALLENGE_CLOSE_GRACE: Duration = Duration::from_secs(1);

pub(super) type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

/// The validated TLS hostname of a connection, put on every request of it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TlsHost(pub(super) Arc<str>);

/// An address as the limits count it: an IPv4 address, or an IPv6 /64.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum AddrKey {
    V4(Ipv4Addr),
    V6([u8; 8]),
}

impl AddrKey {
    pub(super) fn of(ip: IpAddr) -> Self {
        match ip.to_canonical() {
            IpAddr::V4(ip) => Self::V4(ip),
            IpAddr::V6(ip) => {
                let octets = ip.octets();
                let mut prefix = [0u8; 8];
                prefix.copy_from_slice(&octets[..8]);
                Self::V6(prefix)
            }
        }
    }
}

/// The connection's service with the visitor address and the TLS hostname on every request. The
/// first request tells the stream that the head deadline is met.
#[derive(Clone)]
pub(super) struct Tagged<S> {
    inner: S,
    ip: RealIp,
    host: Option<TlsHost>,
    seen: Arc<AtomicBool>,
}

impl<S, B> Service<Request<B>> for Tagged<S>
where
    S: Service<Request<B>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = S::Future;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut request: Request<B>) -> Self::Future {
        self.seen.store(true, Ordering::Release);
        request.extensions_mut().insert(self.ip);
        if let Some(host) = &self.host {
            request.extensions_mut().insert(host.clone());
        }
        self.inner.call(request)
    }
}

/// Tells every acceptor of a port that the listener is draining, so no admission or handshake
/// outlives the shutdown grace.
pub(super) struct Stop(watch::Sender<bool>);

impl Stop {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self(watch::channel(false).0))
    }

    pub(super) fn signal(&self) {
        self.0.send_replace(true);
    }

    async fn wait(&self) {
        let mut stopped = self.0.subscribe();
        let _ = stopped.wait_for(|stopped| *stopped).await;
    }
}

/// Serves the TLS port.
#[derive(Clone)]
pub(super) struct DomainAcceptor {
    inner: Arc<Inner>,
}

impl DomainAcceptor {
    pub(super) fn new(directory: Arc<dyn Directory>, proxy: Proxy, stop: Arc<Stop>) -> Self {
        Self::with_clock(directory, proxy, stop, Arc::new(Instant::now))
    }

    /// The clock only feeds the handshake rate limits; a test moves it by hand.
    pub(super) fn with_clock(
        directory: Arc<dyn Directory>,
        proxy: Proxy,
        stop: Arc<Stop>,
        clock: Clock,
    ) -> Self {
        let web = tls_config(
            Arc::new(ByHostname::new(directory.clone(), false)),
            vec![b"h2".to_vec(), b"http/1.1".to_vec()],
        );
        let acme = tls_config(
            Arc::new(ByHostname::new(directory.clone(), true)),
            vec![ACME_ALPN.to_vec()],
        );
        Self {
            inner: Arc::new(Inner {
                directory,
                proxy,
                stop,
                pre: Arc::new(Semaphore::new(PRE_HANDSHAKE_POOL)),
                challenge: Arc::new(Semaphore::new(CHALLENGE_POOL)),
                main: Arc::new(Semaphore::new(MAIN_POOL)),
                caps: Arc::new(Caps::default()),
                rates: Rates::new(clock),
                web,
                acme,
            }),
        }
    }

    #[cfg(test)]
    pub(super) fn pre_handshake_free(&self) -> usize {
        self.inner.pre.available_permits()
    }

    #[cfg(test)]
    pub(super) fn stop(&self) -> Arc<Stop> {
        self.inner.stop.clone()
    }
}

impl<S: Send + 'static> Accept<TcpStream, S> for DomainAcceptor {
    type Stream = Guarded<TlsStream<TcpStream>>;
    type Service = Tagged<S>;
    type Future = BoxFuture<'static, io::Result<(Self::Stream, Tagged<S>)>>;

    fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
        let inner = self.inner.clone();
        Box::pin(async move {
            let admitted = tokio::select! {
                biased;
                () = inner.stop.wait() => return Err(closed("the listener is draining")),
                admitted = inner.admit(stream) => admitted?,
            };
            let service = Tagged {
                inner: service,
                ip: admitted.ip,
                host: Some(admitted.host),
                seen: admitted.stream.seen(),
            };
            Ok((admitted.stream, service))
        })
    }
}

/// Serves the redirect and health ports: a bounded number of plain connections, each with the
/// visitor address under the port's proxy mode and the head deadline of its first request.
#[derive(Clone)]
pub(super) struct HeaderAcceptor {
    proxy: Proxy,
    stop: Arc<Stop>,
    pool: Arc<Semaphore>,
    caps: Option<Arc<Caps>>,
}

impl HeaderAcceptor {
    /// The public redirect port: a pool of its own and a cap per address.
    pub(super) fn redirect(proxy: Proxy, stop: Arc<Stop>) -> Self {
        Self {
            proxy,
            stop,
            pool: Arc::new(Semaphore::new(REDIRECT_POOL)),
            caps: Some(Arc::new(Caps::default())),
        }
    }

    /// The health port: its own small pool, so it answers while the redirect pool is full, and an
    /// optional header whose address is not used for any limit.
    pub(super) fn health(stop: Arc<Stop>) -> Self {
        Self {
            proxy: Proxy::Optional,
            stop,
            pool: Arc::new(Semaphore::new(HEALTH_POOL)),
            caps: None,
        }
    }

    async fn admit(&self, mut stream: TcpStream) -> io::Result<(Guarded<TcpStream>, RealIp)> {
        let permit = self
            .pool
            .clone()
            .try_acquire_owned()
            .map_err(|_| closed("the plain connection pool is full"))?;
        let peer = stream.peer_addr()?;
        let source = visitor(&mut stream, peer, &self.proxy)
            .await
            .map_err(|close| {
                close.note(peer);
                closed("PROXY header refused")
            })?;
        let cap = match &self.caps {
            Some(caps) => Some(
                caps.established(AddrKey::of(source.ip()))
                    .ok_or_else(|| closed("the connection cap of the address"))?,
            ),
            None => None,
        };
        let hold = Hold {
            _pool: Some(permit),
            _cap: cap,
        };
        Ok((Guarded::new(stream, hold, false), RealIp(source.ip())))
    }
}

impl<S: Send + 'static> Accept<TcpStream, S> for HeaderAcceptor {
    type Stream = Guarded<TcpStream>;
    type Service = Tagged<S>;
    type Future = BoxFuture<'static, io::Result<(Self::Stream, Tagged<S>)>>;

    fn accept(&self, stream: TcpStream, service: S) -> Self::Future {
        let this = self.clone();
        Box::pin(async move {
            let (stream, ip) = tokio::select! {
                biased;
                () = this.stop.wait() => return Err(closed("the listener is draining")),
                admitted = this.admit(stream) => admitted?,
            };
            let service = Tagged {
                inner: service,
                ip,
                host: None,
                seen: stream.seen(),
            };
            Ok((stream, service))
        })
    }
}

/// What a connection holds from admission until it drops.
#[derive(Default)]
struct Hold {
    _pool: Option<OwnedSemaphorePermit>,
    _cap: Option<CapGuard>,
}

/// A connection that holds its slots until it drops. Until its first request reaches the service
/// it has `HEAD_TIMEOUT` in all, whatever it sends; after that `IDLE_TIMEOUT` of silence ends it.
pub(super) struct Guarded<T> {
    io: T,
    timer: Pin<Box<Sleep>>,
    seen: Arc<AtomicBool>,
    idle: bool,
    _hold: Hold,
}

impl<T> Guarded<T> {
    fn new(io: T, hold: Hold, idle: bool) -> Self {
        let wait = if idle { IDLE_TIMEOUT } else { HEAD_TIMEOUT };
        Self {
            io,
            timer: Box::pin(sleep(wait)),
            seen: Arc::new(AtomicBool::new(false)),
            idle,
            _hold: hold,
        }
    }

    fn seen(&self) -> Arc<AtomicBool> {
        self.seen.clone()
    }

    /// Moves to the idle rule once the first request is in.
    fn settle(&mut self) {
        if !self.idle && self.seen.load(Ordering::Acquire) {
            self.idle = true;
            self.timer.as_mut().reset(Instant::now() + IDLE_TIMEOUT);
        }
    }

    fn touch(&mut self) {
        self.settle();
        if self.idle {
            self.timer.as_mut().reset(Instant::now() + IDLE_TIMEOUT);
        }
    }

    fn expired(&mut self, cx: &mut Context<'_>) -> bool {
        self.settle();
        self.timer.as_mut().poll(cx).is_ready()
    }
}

impl<T: AsyncRead + Unpin> AsyncRead for Guarded<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = &mut *self;
        let before = buf.filled().len();
        match Pin::new(&mut this.io).poll_read(cx, buf) {
            Poll::Ready(result) => {
                if buf.filled().len() > before {
                    this.touch();
                }
                Poll::Ready(result)
            }
            Poll::Pending if this.expired(cx) => Poll::Ready(Err(io::ErrorKind::TimedOut.into())),
            Poll::Pending => Poll::Pending,
        }
    }
}

impl<T: AsyncWrite + Unpin> AsyncWrite for Guarded<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = &mut *self;
        match Pin::new(&mut this.io).poll_write(cx, data) {
            Poll::Ready(result) => {
                if matches!(result, Ok(written) if written > 0) {
                    this.touch();
                }
                Poll::Ready(result)
            }
            Poll::Pending if this.expired(cx) => Poll::Ready(Err(io::ErrorKind::TimedOut.into())),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_shutdown(cx)
    }
}

struct Inner {
    directory: Arc<dyn Directory>,
    proxy: Proxy,
    stop: Arc<Stop>,
    pre: Arc<Semaphore>,
    challenge: Arc<Semaphore>,
    main: Arc<Semaphore>,
    caps: Arc<Caps>,
    rates: Rates,
    web: Arc<ServerConfig>,
    acme: Arc<ServerConfig>,
}

impl Inner {
    /// Steps 1 to 8; an `Err` is a closed connection, and a challenge answer always ends in one.
    async fn admit(&self, stream: TcpStream) -> io::Result<Admitted> {
        let peer = stream.peer_addr()?;
        let slot = self
            .pre
            .clone()
            .try_acquire_owned()
            .map_err(|_| closed("the pre-handshake pool is full"))?;
        let (stream, source) = self.source(stream, peer).await?;
        let key = AddrKey::of(source.ip());
        let cap = self
            .caps
            .pre_handshake(key)
            .ok_or_else(|| closed("the pre-handshake cap of the address"))?;
        self.directory.record_peer(is_private(source.ip()));
        let start = timeout(
            CLIENT_HELLO_DEADLINE,
            LazyConfigAcceptor::new(Acceptor::default(), stream),
        )
        .await
        .map_err(|_| closed("no ClientHello in time"))??;
        let pre = PreHandshake {
            _slot: slot,
            _cap: cap,
        };
        let (host, challenge) = hello_target(&start)?;
        if challenge {
            return Err(self.answer_challenge(start, &host, key, pre).await);
        }
        let stream = self.establish(start, &host, key, pre).await?;
        Ok(Admitted {
            stream,
            host: TlsHost(host.into()),
            ip: RealIp(source.ip()),
        })
    }

    async fn source(
        &self,
        mut stream: TcpStream,
        peer: SocketAddr,
    ) -> io::Result<(TcpStream, SocketAddr)> {
        match visitor(&mut stream, peer, &self.proxy).await {
            Ok(source) => Ok((stream, source)),
            Err(close) => {
                close.note(peer);
                Err(closed("PROXY header refused"))
            }
        }
    }

    /// Step 6: the reserved pool and a cap per address, no rate limit; always closes after.
    async fn answer_challenge(
        &self,
        start: StartHandshake<TcpStream>,
        host: &str,
        key: AddrKey,
        pre: PreHandshake,
    ) -> io::Error {
        let Some(cap) = self.caps.challenge(key) else {
            return closed("the challenge cap of the address");
        };
        let Ok(permit) = self.challenge.clone().try_acquire_owned() else {
            return closed("the challenge pool is full");
        };
        if self.directory.challenge(host).is_none() {
            return closed("no pending challenge for the hostname");
        }
        drop(pre);
        let answered = timeout(
            CHALLENGE_HANDSHAKE_DEADLINE,
            start.into_stream(self.acme.clone()),
        )
        .await;
        let Ok(Ok(mut tls)) = answered else {
            return closed("the challenge handshake failed");
        };
        let _ = timeout(CHALLENGE_CLOSE_GRACE, tls.shutdown()).await;
        drop((permit, cap));
        closed("challenge answered")
    }

    /// Steps 7 and 8: the hostname, the caps and the tokens come before any signature.
    async fn establish(
        &self,
        start: StartHandshake<TcpStream>,
        host: &str,
        key: AddrKey,
        pre: PreHandshake,
    ) -> io::Result<Guarded<TlsStream<TcpStream>>> {
        if self.directory.entry(host).is_none() {
            return Err(closed("the hostname is not in the store"));
        }
        let cap = self
            .caps
            .established(key)
            .ok_or_else(|| closed("the established cap of the address"))?;
        let main = self
            .main
            .clone()
            .try_acquire_owned()
            .map_err(|_| closed("the main pool is full"))?;
        if !self.rates.take(key) {
            return Err(closed("the handshake rate limit"));
        }
        drop(pre);
        let tls = timeout(HANDSHAKE_DEADLINE, start.into_stream(self.web.clone()))
            .await
            .map_err(|_| closed("the handshake took too long"))??;
        // an HTTP/2 client sends nothing until it has something to ask, so it starts on the idle
        // rule
        let h2 = tls.get_ref().1.alpn_protocol() == Some(b"h2".as_slice());
        let hold = Hold {
            _pool: Some(main),
            _cap: Some(cap),
        };
        Ok(Guarded::new(tls, hold, h2))
    }
}

struct Admitted {
    stream: Guarded<TlsStream<TcpStream>>,
    host: TlsHost,
    ip: RealIp,
}

/// What a connection holds from accept until its ClientHello is classified.
struct PreHandshake {
    _slot: OwnedSemaphorePermit,
    _cap: CapGuard,
}

#[derive(Default)]
struct Caps {
    counts: Mutex<HashMap<AddrKey, Counts>>,
}

#[derive(Default, Clone, Copy)]
struct Counts {
    pre_handshake: u32,
    established: u32,
    challenge: u32,
}

#[derive(Clone, Copy)]
enum CapKind {
    PreHandshake,
    Established,
    Challenge,
}

impl Caps {
    fn pre_handshake(self: &Arc<Self>, key: AddrKey) -> Option<CapGuard> {
        self.take(key, CapKind::PreHandshake)
    }

    fn established(self: &Arc<Self>, key: AddrKey) -> Option<CapGuard> {
        self.take(key, CapKind::Established)
    }

    fn challenge(self: &Arc<Self>, key: AddrKey) -> Option<CapGuard> {
        self.take(key, CapKind::Challenge)
    }

    fn take(self: &Arc<Self>, key: AddrKey, kind: CapKind) -> Option<CapGuard> {
        let mut counts = self.counts.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = counts.entry(key).or_default();
        let (count, cap) = match kind {
            CapKind::PreHandshake => (&mut entry.pre_handshake, PRE_HANDSHAKE_PER_ADDRESS),
            CapKind::Established => (&mut entry.established, ESTABLISHED_PER_ADDRESS),
            CapKind::Challenge => (&mut entry.challenge, CHALLENGE_PER_ADDRESS),
        };
        if *count >= cap {
            return None;
        }
        *count += 1;
        Some(CapGuard {
            caps: self.clone(),
            key,
            kind,
        })
    }
}

/// One counted connection of an address; the count drops with it.
struct CapGuard {
    caps: Arc<Caps>,
    key: AddrKey,
    kind: CapKind,
}

impl Drop for CapGuard {
    fn drop(&mut self) {
        let mut counts = self
            .caps
            .counts
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let Some(entry) = counts.get_mut(&self.key) else {
            return;
        };
        match self.kind {
            CapKind::PreHandshake => entry.pre_handshake = entry.pre_handshake.saturating_sub(1),
            CapKind::Established => entry.established = entry.established.saturating_sub(1),
            CapKind::Challenge => entry.challenge = entry.challenge.saturating_sub(1),
        }
        if entry.pre_handshake == 0 && entry.established == 0 && entry.challenge == 0 {
            counts.remove(&self.key);
        }
    }
}

/// A rate with a burst, as the generic cell rate algorithm: one instant per limiter, no tokens.
struct Gcra {
    interval: Duration,
    burst: u32,
}

impl Gcra {
    /// The next theoretical arrival time when one more is allowed at `now`.
    fn admit(&self, tat: Instant, now: Instant) -> Option<Instant> {
        let next = tat.max(now) + self.interval;
        match next.checked_sub(self.interval * self.burst) {
            Some(allowed_from) if now < allowed_from => None,
            _ => Some(next),
        }
    }
}

struct Rates {
    state: Mutex<RateState>,
    clock: Clock,
}

struct RateState {
    listener: Instant,
    addresses: HashMap<AddrKey, Instant>,
}

impl Rates {
    fn new(clock: Clock) -> Self {
        Self {
            state: Mutex::new(RateState {
                listener: clock(),
                addresses: HashMap::new(),
            }),
            clock,
        }
    }

    /// One handshake from `key` and for the listener, or none at all.
    fn take(&self, key: AddrKey) -> bool {
        let now = (self.clock)();
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(listener) = LISTENER_RATE.admit(state.listener, now) else {
            return false;
        };
        if state.addresses.len() >= MAX_TRACKED_ADDRESSES && !state.addresses.contains_key(&key) {
            state.addresses.retain(|_, tat| *tat > now);
            if state.addresses.len() >= MAX_TRACKED_ADDRESSES {
                return false;
            }
        }
        let tat = state.addresses.get(&key).copied().unwrap_or(now);
        let Some(next) = ADDRESS_RATE.admit(tat, now) else {
            return false;
        };
        state.listener = listener;
        state.addresses.insert(key, next);
        true
    }
}

/// Picks the certificate of a handshake by the TLS hostname, from memory.
struct ByHostname {
    directory: Arc<dyn Directory>,
    challenge: bool,
}

impl ByHostname {
    fn new(directory: Arc<dyn Directory>, challenge: bool) -> Self {
        Self {
            directory,
            challenge,
        }
    }
}

impl std::fmt::Debug for ByHostname {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ByHostname")
            .field("challenge", &self.challenge)
            .finish_non_exhaustive()
    }
}

impl ResolvesServerCert for ByHostname {
    fn resolve(&self, hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        let host = hello.server_name()?;
        if self.challenge {
            self.directory.challenge(host)
        } else {
            self.directory
                .entry(host)
                .map(|entry| entry.certified_key.clone())
        }
    }
}

/// The ring provider explicitly; resumption is off so a released hostname cannot resume.
fn tls_config(resolver: Arc<dyn ResolvesServerCert>, alpn: Vec<Vec<u8>>) -> Arc<ServerConfig> {
    let mut config = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("the ring provider supports the default protocol versions")
        .with_no_client_auth()
        .with_cert_resolver(resolver);
    config.alpn_protocols = alpn;
    config.session_storage = Arc::new(NoServerSessionStorage {});
    config.send_tls13_tickets = 0;
    Arc::new(config)
}

/// Step 5 and the test of step 6: the TLS hostname, and whether `acme-tls/1` is all that is
/// offered.
fn hello_target(start: &StartHandshake<TcpStream>) -> io::Result<(String, bool)> {
    let hello = start.client_hello();
    let host = hello
        .server_name()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| closed("no TLS hostname"))?;
    if is_ip_literal(&host) {
        return Err(closed("an IP literal as TLS hostname"));
    }
    let challenge = hello
        .alpn()
        .is_some_and(|mut offered| offered.next() == Some(ACME_ALPN) && offered.next().is_none());
    Ok((host, challenge))
}

fn is_ip_literal(host: &str) -> bool {
    host.trim_matches(['[', ']']).parse::<IpAddr>().is_ok()
}

/// Private, loopback, link-local and shared-address-space peers, as the heartbeat counts them.
fn is_private(ip: IpAddr) -> bool {
    match ip.to_canonical() {
        IpAddr::V4(ip) => {
            let shared = ip.octets()[0] == 100 && ip.octets()[1] & 0xc0 == 64;
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || shared
        }
        IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            ip.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    }
}

pub(super) fn closed(reason: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, reason)
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::{
        super::{
            proxy_protocol::Trusted,
            testkit::{
                Fake, HOST, ManualClock, Port, SLUG, body, client_config, connect, elapsed_until,
                get, handshake, is_closed, near, proxied,
            },
        },
        *,
    };

    fn trusted() -> Proxy {
        Proxy::Required(Arc::new(Trusted::parse("127.0.0.0/8")))
    }

    fn served() -> Arc<Fake> {
        let fake = Fake::new();
        fake.serve(HOST, SLUG);
        fake
    }

    /// An acceptor whose rate limits run on a clock the test moves.
    fn on_manual_clock(fake: &Arc<Fake>, proxy: Proxy) -> (DomainAcceptor, Arc<ManualClock>) {
        let clock = ManualClock::new();
        let source = clock.clone();
        let acceptor = DomainAcceptor::with_clock(
            fake.clone(),
            proxy,
            Stop::new(),
            Arc::new(move || source.now()),
        );
        (acceptor, clock)
    }

    fn rates() -> (Rates, Arc<ManualClock>) {
        let clock = ManualClock::new();
        let source = clock.clone();
        (Rates::new(Arc::new(move || source.now())), clock)
    }

    fn key(ip: &str) -> AddrKey {
        AddrKey::of(ip.parse().unwrap())
    }

    fn peer_certificate(tls: &tokio_rustls::client::TlsStream<TcpStream>) -> Vec<u8> {
        tls.get_ref().1.peer_certificates().unwrap()[0].to_vec()
    }

    /// Sends a ClientHello that offers `alpn` and nothing after it: the server signs and waits.
    async fn send_hello(tcp: &mut TcpStream, alpn: &[&[u8]]) {
        let name = tokio_rustls::rustls::pki_types::ServerName::try_from(HOST.to_string()).unwrap();
        let config = Arc::new(client_config(alpn));
        let mut client = tokio_rustls::rustls::ClientConnection::new(config, name).unwrap();
        let mut hello = Vec::new();
        client.write_tls(&mut hello).unwrap();
        tcp.write_all(&hello).await.unwrap();
    }

    /// A request over HTTP/2 on an established connection: the status and the body.
    async fn h2_get(
        tls: tokio_rustls::client::TlsStream<TcpStream>,
    ) -> (h2::client::SendRequest<bytes::Bytes>, u16, String) {
        let (client, connection) = h2::client::handshake(tls).await.unwrap();
        tokio::spawn(connection);
        let request = http::Request::get(format!("https://{HOST}/"))
            .body(())
            .unwrap();
        let (response, _) = client
            .clone()
            .ready()
            .await
            .unwrap()
            .send_request(request, true)
            .unwrap();
        let response = response.await.unwrap();
        let status = response.status().as_u16();
        let mut stream = response.into_body();
        let mut text = Vec::new();
        while let Some(chunk) = stream.data().await {
            text.extend(chunk.unwrap());
        }
        (client, status, String::from_utf8(text).unwrap())
    }

    #[test]
    fn an_address_is_an_ipv4_address_or_an_ipv6_64() {
        assert_eq!(key("2001:db8:1:1::1"), key("2001:db8:1:1:ffff::2"));
        assert_ne!(key("2001:db8:1:1::1"), key("2001:db8:1:2::1"));
        assert_ne!(key("192.0.2.1"), key("192.0.2.2"));
        assert_eq!(key("::ffff:192.0.2.1"), key("192.0.2.1"));
    }

    #[test]
    fn the_21st_handshake_of_an_address_in_a_second_waits_for_its_tokens() {
        let (rates, clock) = rates();
        let address = key("192.0.2.1");
        assert!((0..20).all(|_| rates.take(address)));
        assert!(!rates.take(address));
        clock.advance(Duration::from_millis(99));
        assert!(!rates.take(address));
        clock.advance(Duration::from_millis(1));
        assert!(rates.take(address));
        assert!(!rates.take(address));
    }

    #[test]
    fn the_whole_listener_is_held_to_200_a_second_with_a_burst_of_400() {
        let (rates, clock) = rates();
        let address = |i: u32| AddrKey::V4(Ipv4Addr::from(0x0a00_0000 + i));
        assert!((0..400).all(|i| rates.take(address(i))));
        assert!(!rates.take(address(400)));
        clock.advance(Duration::from_millis(5));
        assert!(rates.take(address(401)));
        assert!(!rates.take(address(402)));
    }

    #[test]
    fn two_addresses_of_one_ipv6_64_share_both_caps_and_the_rate() {
        let (one, two, other) = (
            key("2001:db8:1:1::1"),
            key("2001:db8:1:1::2"),
            key("2001:db8:1:2::1"),
        );
        let (rates, _) = rates();
        assert!((0..20).all(|i| rates.take(if i % 2 == 0 { one } else { two })));
        assert!(!rates.take(one) && !rates.take(two));
        assert!(rates.take(other));

        let caps = Arc::new(Caps::default());
        let held: Vec<_> = (0..ESTABLISHED_PER_ADDRESS)
            .map(|i| {
                caps.established(if i % 2 == 0 { one } else { two })
                    .unwrap()
            })
            .collect();
        assert!(caps.established(one).is_none() && caps.established(two).is_none());
        assert!(caps.established(other).is_some());
        let pre: Vec<_> = (0..PRE_HANDSHAKE_PER_ADDRESS)
            .map(|i| {
                caps.pre_handshake(if i % 2 == 0 { one } else { two })
                    .unwrap()
            })
            .collect();
        assert!(caps.pre_handshake(two).is_none());
        drop((held, pre));
        assert!(caps.established(one).is_some() && caps.pre_handshake(two).is_some());
    }

    #[test]
    fn ipv4_addresses_are_each_their_own_address() {
        let (rates, _) = rates();
        assert!((0..20).all(|_| rates.take(key("192.0.2.1"))));
        assert!(!rates.take(key("192.0.2.1")));
        assert!(rates.take(key("192.0.2.2")));
        let caps = Arc::new(Caps::default());
        let held: Vec<_> = (0..PRE_HANDSHAKE_PER_ADDRESS)
            .map(|_| caps.pre_handshake(key("192.0.2.1")).unwrap())
            .collect();
        assert!(caps.pre_handshake(key("192.0.2.1")).is_none());
        assert!(caps.pre_handshake(key("192.0.2.2")).is_some());
        drop(held);
    }

    #[test]
    fn two_addresses_of_one_ipv6_64_share_the_challenge_cap() {
        let (one, two, other) = (
            key("2001:db8:1:1::1"),
            key("2001:db8:1:1::2"),
            key("2001:db8:1:2::1"),
        );
        let caps = Arc::new(Caps::default());
        let held: Vec<_> = (0..CHALLENGE_PER_ADDRESS)
            .map(|i| caps.challenge(if i % 2 == 0 { one } else { two }).unwrap())
            .collect();
        assert!(caps.challenge(one).is_none() && caps.challenge(two).is_none());
        assert!(caps.challenge(other).is_some());
        assert!(
            caps.established(one).is_some() && caps.pre_handshake(one).is_some(),
            "the challenge cap is a count of its own"
        );
        drop(held);
        assert!(caps.challenge(one).is_some());
    }

    #[test]
    fn the_rate_state_is_bounded_and_forgets_idle_addresses() {
        let (rates, clock) = rates();
        for i in 0..MAX_TRACKED_ADDRESSES {
            clock.advance(Duration::from_millis(5));
            let address = AddrKey::V4(Ipv4Addr::from(u32::try_from(i).unwrap()));
            assert!(rates.take(address));
        }
        let tracked = |rates: &Rates| rates.state.lock().unwrap().addresses.len();
        assert_eq!(tracked(&rates), MAX_TRACKED_ADDRESSES);
        clock.advance(Duration::from_millis(5));
        assert!(rates.take(AddrKey::V4(Ipv4Addr::new(255, 255, 255, 255))));
        assert!(tracked(&rates) < 100);
    }

    #[test]
    fn resumption_is_off_so_a_released_hostname_cannot_resume() {
        let config = tls_config(Arc::new(ByHostname::new(Fake::new(), false)), vec![]);
        assert!(!config.session_storage.can_cache());
        assert_eq!(config.send_tls13_tickets, 0);
    }

    #[test]
    fn private_and_shared_peers_are_private_and_public_ones_are_not() {
        let private = |ip: &str| is_private(ip.parse().unwrap());
        assert!(private("10.1.2.3") && private("192.168.0.9") && private("127.0.0.1"));
        assert!(
            private("100.64.1.1") && private("fd00::1") && private("fe80::1") && private("::1")
        );
        assert!(private("::ffff:10.0.0.1"));
        assert!(!private("198.51.100.7") && !private("100.128.0.1") && !private("2001:db8::1"));
    }

    #[tokio::test]
    async fn no_tls_hostname_and_an_ip_literal_are_closed_without_a_signature() {
        let fake = served();
        let port = Port::open(fake.clone(), Proxy::Off).await;
        assert!(connect(port.addr, "127.0.0.1", &[]).await.is_err());
        assert!(connect(port.addr, "::1", &[]).await.is_err());
        assert_eq!(fake.signatures(), 0);
    }

    #[tokio::test]
    async fn an_unknown_hostname_is_closed_before_a_handshake_and_takes_no_token() {
        let fake = served();
        let (acceptor, _clock) = on_manual_clock(&fake, Proxy::Off);
        let port = Port::open_with(acceptor).await;
        for _ in 0..30 {
            assert!(connect(port.addr, "other.brand.test", &[]).await.is_err());
        }
        assert_eq!(fake.signatures(), 0);
        for _ in 0..20 {
            assert!(connect(port.addr, HOST, &[]).await.is_ok());
        }
        assert_eq!(fake.signatures(), 20);
    }

    #[tokio::test]
    async fn acme_tls_is_answered_from_the_challenge_map_and_closed_when_there_is_none() {
        let fake = served();
        let port = Port::open(fake.clone(), Proxy::Off).await;
        assert!(connect(port.addr, HOST, &[b"acme-tls/1"]).await.is_err());
        assert_eq!(fake.signatures(), 0);

        let expected = fake.challenge_for(HOST);
        let mut tls = connect(port.addr, HOST, &[b"acme-tls/1"]).await.unwrap();
        assert_eq!(peer_certificate(&tls), expected.to_vec());
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"acme-tls/1"[..]));
        let mut rest = Vec::new();
        assert_eq!(tls.read_to_end(&mut rest).await.unwrap_or(0), 0);

        let mixed = connect(port.addr, HOST, &[b"acme-tls/1", b"h2"])
            .await
            .unwrap();
        assert_ne!(peer_certificate(&mixed), expected.to_vec());
        assert_eq!(mixed.get_ref().1.alpn_protocol(), Some(&b"h2"[..]));
    }

    #[tokio::test]
    async fn a_slow_client_hello_is_cut_at_its_deadline() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tcp = TcpStream::connect(port.addr).await.unwrap();
        let mut byte = [0u8; 1];
        let took = elapsed_until(tcp.read(&mut byte)).await;
        assert!(near(took, CLIENT_HELLO_DEADLINE), "{took:?}");
    }

    #[tokio::test]
    async fn a_stalled_challenge_handshake_is_cut_at_its_own_deadline() {
        let fake = served();
        fake.challenge_for(HOST);
        let port = Port::open(fake.clone(), Proxy::Off).await;
        let mut tcp = TcpStream::connect(port.addr).await.unwrap();
        send_hello(&mut tcp, &[ACME_ALPN]).await;
        let took = closed_after(&mut tcp).await;
        assert!(near(took, CHALLENGE_HANDSHAKE_DEADLINE), "{took:?}");
        assert_eq!(fake.signatures(), 1, "the handshake had started");
    }

    #[tokio::test]
    async fn a_fifth_concurrent_challenge_of_an_address_is_refused_and_another_address_is_not() {
        let fake = served();
        fake.challenge_for(HOST);
        let port = Port::open(fake.clone(), trusted()).await;
        let mut held = Vec::new();
        for _ in 0..CHALLENGE_PER_ADDRESS {
            let mut tcp = proxied(port.addr, 1, "198.51.100.1").await;
            send_hello(&mut tcp, &[ACME_ALPN]).await;
            held.push(tcp);
        }
        for _ in 0..100 {
            if fake.signatures() == held.len() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(fake.signatures(), held.len(), "each one is mid-handshake");

        let fifth = proxied(port.addr, 1, "198.51.100.1").await;
        assert!(handshake(fifth, HOST, &[ACME_ALPN]).await.is_err());
        assert_eq!(fake.signatures(), held.len(), "no signature for the fifth");
        let other = proxied(port.addr, 1, "198.51.100.2").await;
        assert!(handshake(other, HOST, &[ACME_ALPN]).await.is_ok());

        held.pop();
        let mut answered_again = false;
        for _ in 0..50 {
            let tcp = proxied(port.addr, 1, "198.51.100.1").await;
            answered_again = handshake(tcp, HOST, &[ACME_ALPN]).await.is_ok();
            if answered_again {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(answered_again, "a closed challenge frees its slot");
    }

    /// How long the server takes to end the connection, in paused time.
    async fn closed_after<R: AsyncRead + Unpin>(stream: &mut R) -> Duration {
        let mut rest = Vec::new();
        elapsed_until(stream.read_to_end(&mut rest)).await
    }

    fn at_the_head_deadline(took: Duration) -> bool {
        near(took, HEAD_TIMEOUT)
    }

    #[tokio::test]
    async fn a_silent_http_1_1_connection_is_cut_at_the_head_deadline() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tls = connect(port.addr, HOST, &[b"http/1.1"]).await.unwrap();
        let took = closed_after(&mut tls).await;
        assert!(at_the_head_deadline(took), "{took:?}");
    }

    #[tokio::test]
    async fn a_partial_first_request_is_cut_at_the_head_deadline() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tls = connect(port.addr, HOST, &[b"http/1.1"]).await.unwrap();
        tls.write_all(b"GET / HT").await.unwrap();
        let took = closed_after(&mut tls).await;
        assert!(at_the_head_deadline(took), "{took:?}");
    }

    #[tokio::test]
    async fn a_first_request_that_trickles_in_is_still_cut_at_the_head_deadline() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tls = connect(port.addr, HOST, &[b"http/1.1"]).await.unwrap();
        tls.write_all(b"GET /").await.unwrap();
        let (mut read, mut write) = tokio::io::split(tls);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if write.write_all(b" ").await.is_err() {
                    break;
                }
            }
        });
        let took = closed_after(&mut read).await;
        assert!(at_the_head_deadline(took), "{took:?}");
    }

    #[tokio::test]
    async fn a_partial_second_request_is_cut_at_the_head_deadline_of_hyper() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tls = connect(port.addr, HOST, &[b"http/1.1"]).await.unwrap();
        let request = format!("GET / HTTP/1.1\r\nHost: {HOST}\r\n\r\n");
        tls.write_all(request.as_bytes()).await.unwrap();
        let mut answer = [0u8; 512];
        let read = tls.read(&mut answer).await.unwrap();
        assert!(String::from_utf8_lossy(&answer[..read]).starts_with("HTTP/1.1 200"));
        tls.write_all(b"GET / HT").await.unwrap();
        let took = closed_after(&mut tls).await;
        assert!(near(took, HEAD_TIMEOUT), "{took:?}");
    }

    #[tokio::test]
    async fn a_drain_closes_pending_admissions_and_handshakes_and_frees_their_slots() {
        let fake = served();
        let acceptor = DomainAcceptor::new(fake.clone(), Proxy::Off, Stop::new());
        let port = Port::open_with(acceptor.clone()).await;
        let mut silent = TcpStream::connect(port.addr).await.unwrap();
        let mut partial = TcpStream::connect(port.addr).await.unwrap();
        partial
            .write_all(&[0x16, 0x03, 0x01, 0x02, 0x00])
            .await
            .unwrap();

        let mut mid_handshake = TcpStream::connect(port.addr).await.unwrap();
        send_hello(&mut mid_handshake, &[]).await;
        for _ in 0..100 {
            if fake.signatures() == 1 && acceptor.pre_handshake_free() == PRE_HANDSHAKE_POOL - 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(
            fake.signatures(),
            1,
            "the server is waiting for the client's Finished"
        );
        assert_eq!(acceptor.pre_handshake_free(), PRE_HANDSHAKE_POOL - 2);

        port.stop.signal();
        for stream in [&mut silent, &mut partial, &mut mid_handshake] {
            let mut rest = Vec::new();
            let ended =
                tokio::time::timeout(Duration::from_millis(500), stream.read_to_end(&mut rest));
            assert!(
                ended.await.is_ok(),
                "closed within 500 ms, not at the 3 s or 10 s deadline"
            );
        }
        assert_eq!(acceptor.pre_handshake_free(), PRE_HANDSHAKE_POOL);
        assert!(
            connect(port.addr, HOST, &[]).await.is_err(),
            "nothing is admitted after the stop"
        );
    }

    #[tokio::test]
    async fn a_silent_http_2_connection_ends_after_the_idle_timeout() {
        let port = Port::open(served(), Proxy::Off).await;
        let tls = connect(port.addr, HOST, &[b"h2"]).await.unwrap();
        let (_client, connection) = h2::client::handshake(tls).await.unwrap();
        let took = elapsed_until(connection).await;
        assert!(near(took, IDLE_TIMEOUT), "{took:?}");
    }

    #[tokio::test]
    async fn http_1_1_and_http_2_both_serve_and_headers_never_name_the_visitor() {
        let port = Port::open(served(), Proxy::Off).await;
        let mut tls = connect(port.addr, HOST, &[b"http/1.1"]).await.unwrap();
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"http/1.1"[..]));
        let spoofed = "X-Forwarded-For: 203.0.113.9\r\nX-Real-IP: 203.0.113.10\r\n";
        let (status, response) = get(&mut tls, HOST, "/", spoofed).await.unwrap();
        assert_eq!(status, 200);
        assert_eq!(body(&response), format!("{HOST} 127.0.0.1"));

        let tls = connect(port.addr, HOST, &[b"h2"]).await.unwrap();
        assert_eq!(tls.get_ref().1.alpn_protocol(), Some(&b"h2"[..]));
        let (_client, status, text) = h2_get(tls).await;
        assert_eq!(
            (status, text.as_str()),
            (200, "status.brand.test 127.0.0.1")
        );
    }

    #[tokio::test]
    async fn an_http_2_connection_is_limited_to_32_streams() {
        let port = Port::open(served(), Proxy::Off).await;
        let tls = connect(port.addr, HOST, &[b"h2"]).await.unwrap();
        let (client, status, _) = h2_get(tls).await;
        assert_eq!(status, 200);
        assert_eq!(client.current_max_send_streams(), 32);
    }

    #[tokio::test]
    async fn one_address_cannot_hold_more_established_connections_than_its_cap() {
        let fake = served();
        let (acceptor, clock) = on_manual_clock(&fake, Proxy::Off);
        let port = Port::open_with(acceptor).await;
        let mut held = Vec::new();
        for i in 0..ESTABLISHED_PER_ADDRESS {
            if i % 10 == 0 {
                clock.advance(Duration::from_secs(1));
            }
            held.push(connect(port.addr, HOST, &[]).await.unwrap());
        }
        clock.advance(Duration::from_secs(1));
        assert!(connect(port.addr, HOST, &[]).await.is_err());

        fake.challenge_for(HOST);
        let challenge = connect(port.addr, HOST, &[b"acme-tls/1"]).await;
        assert!(
            challenge.is_ok(),
            "a challenge is exempt from the established cap"
        );

        held.pop();
        let mut served_again = false;
        for _ in 0..50 {
            clock.advance(Duration::from_secs(1));
            served_again = connect(port.addr, HOST, &[]).await.is_ok();
            if served_again {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(served_again, "a closed connection frees its slot");
    }

    #[tokio::test]
    async fn the_21st_handshake_in_a_second_is_closed_before_any_signature_and_served_after_refill()
    {
        let fake = served();
        fake.challenge_for(HOST);
        let (acceptor, clock) = on_manual_clock(&fake, Proxy::Off);
        let port = Port::open_with(acceptor).await;
        let mut held = Vec::new();
        for _ in 0..20 {
            held.push(connect(port.addr, HOST, &[]).await.unwrap());
        }
        assert_eq!(fake.signatures(), 20);
        assert!(connect(port.addr, HOST, &[]).await.is_err());
        assert_eq!(
            fake.signatures(),
            20,
            "no signature for the refused handshake"
        );

        assert!(connect(port.addr, HOST, &[b"acme-tls/1"]).await.is_ok());
        assert_eq!(
            fake.signatures(),
            21,
            "the challenge handshake signs and is exempt"
        );

        clock.advance(Duration::from_millis(100));
        held.push(connect(port.addr, HOST, &[]).await.unwrap());
        assert!(connect(port.addr, HOST, &[]).await.is_err());
    }

    #[tokio::test]
    async fn many_addresses_hit_the_whole_listener_limit_at_the_401st_handshake() {
        let fake = served();
        fake.challenge_for(HOST);
        let (acceptor, clock) = on_manual_clock(&fake, trusted());
        let port = Port::open_with(acceptor).await;
        let address = |i: u32| format!("198.18.{}.{}", i / 250 + 1, i % 250 + 1);
        let mut held = Vec::new();
        for i in 0..400 {
            let tcp = proxied(port.addr, 1, &address(i)).await;
            held.push(handshake(tcp, HOST, &[]).await.unwrap());
        }
        let refused = proxied(port.addr, 1, &address(400)).await;
        assert!(handshake(refused, HOST, &[]).await.is_err());

        let tcp = proxied(port.addr, 1, &address(401)).await;
        assert!(handshake(tcp, HOST, &[b"acme-tls/1"]).await.is_ok());

        clock.advance(Duration::from_millis(5));
        let tcp = proxied(port.addr, 1, &address(402)).await;
        assert!(handshake(tcp, HOST, &[]).await.is_ok());
    }

    #[tokio::test]
    async fn each_proxy_version_gives_its_address_to_the_pre_handshake_cap_and_to_real_ip() {
        for version in [1, 2] {
            let fake = served();
            fake.challenge_for(HOST);
            let port = Port::open(fake.clone(), trusted()).await;
            let mut held = Vec::new();
            for _ in 0..PRE_HANDSHAKE_PER_ADDRESS {
                held.push(proxied(port.addr, version, "198.51.100.1").await);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            let mut ninth = proxied(port.addr, version, "198.51.100.1").await;
            assert!(
                is_closed(&mut ninth).await,
                "version {version}: the cap of the address"
            );

            let tcp = proxied(port.addr, version, "198.51.100.2").await;
            assert!(handshake(tcp, HOST, &[b"acme-tls/1"]).await.is_ok());

            let tcp = proxied(port.addr, version, "198.51.100.3").await;
            let mut tls = handshake(tcp, HOST, &[b"http/1.1"]).await.unwrap();
            let (_, response) = get(&mut tls, HOST, "/", "X-Forwarded-For: 203.0.113.9\r\n")
                .await
                .unwrap();
            assert_eq!(body(&response), format!("{HOST} 198.51.100.3"));
            assert_eq!(fake.peers().last(), Some(&false));
        }
    }

    #[tokio::test]
    async fn two_ipv6_addresses_in_one_64_share_the_pre_handshake_cap() {
        let port = Port::open(served(), trusted()).await;
        let mut held = Vec::new();
        for i in 0..PRE_HANDSHAKE_PER_ADDRESS {
            held.push(proxied(port.addr, 1, &format!("2001:db8:1:1::{}", i + 1)).await);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut same_prefix = proxied(port.addr, 2, "2001:db8:1:1::ff").await;
        assert!(is_closed(&mut same_prefix).await);
        let mut other_prefix = proxied(port.addr, 2, "2001:db8:1:2::1").await;
        assert!(!is_closed(&mut other_prefix).await);
    }

    #[tokio::test]
    async fn with_the_pre_handshake_pool_full_further_connections_are_closed_and_none_waits() {
        let port = Port::open(served(), trusted()).await;
        let mut held = Vec::new();
        for pool_slot in 0..PRE_HANDSHAKE_POOL {
            let address = format!("198.51.100.{}", pool_slot / 8 + 1);
            held.push(proxied(port.addr, 1, &address).await);
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
        let started = std::time::Instant::now();
        let mut late = proxied(port.addr, 1, "198.51.100.200").await;
        assert!(is_closed(&mut late).await);
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(!is_closed(&mut held[0]).await);
    }

    #[tokio::test]
    async fn proxy_protocol_closes_what_it_must_not_trust_or_cannot_read() {
        let fake = served();
        let untrusted = Proxy::Required(Arc::new(Trusted::parse("10.0.0.0/8")));
        let port = Port::open(fake.clone(), untrusted).await;
        let tcp = proxied(port.addr, 1, "198.51.100.1").await;
        assert!(handshake(tcp, HOST, &[]).await.is_err());

        let empty = Proxy::Required(Arc::new(Trusted::parse("")));
        let port = Port::open(fake.clone(), empty).await;
        let tcp = proxied(port.addr, 2, "198.51.100.1").await;
        assert!(handshake(tcp, HOST, &[]).await.is_err());

        let port = Port::open(fake.clone(), trusted()).await;
        assert!(
            connect(port.addr, HOST, &[]).await.is_err(),
            "a ClientHello where a header is due"
        );
        let mut unknown = TcpStream::connect(port.addr).await.unwrap();
        unknown.write_all(b"PROXY UNKNOWN\r\n").await.unwrap();
        assert!(is_closed(&mut unknown).await);
        let mut local = TcpStream::connect(port.addr).await.unwrap();
        local
            .write_all(b"\r\n\r\n\0\r\nQUIT\n\x20\x00\x00\x00")
            .await
            .unwrap();
        assert!(is_closed(&mut local).await);
        let mut long = TcpStream::connect(port.addr).await.unwrap();
        long.write_all(&[b'P'; 120]).await.unwrap();
        assert!(is_closed(&mut long).await);
        let mut garbage = TcpStream::connect(port.addr).await.unwrap();
        garbage.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
        assert!(is_closed(&mut garbage).await);
        assert_eq!(fake.signatures(), 0);
    }

    #[tokio::test]
    async fn every_accepted_peer_is_recorded_as_private_or_public() {
        let fake = served();
        let port = Port::open(fake.clone(), trusted()).await;
        for ip in ["10.1.2.3", "198.51.100.4"] {
            let tcp = proxied(port.addr, 1, ip).await;
            drop(handshake(tcp, HOST, &[]).await.unwrap());
        }
        assert_eq!(fake.peers(), vec![true, false]);
    }
}
