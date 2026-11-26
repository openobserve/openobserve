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

//! Helpers of the listener tests: an in-memory store whose keys count their signatures, a manual
//! clock, a TLS client that trusts anything, and one-request HTTP/1 calls.

use std::{
    collections::HashMap,
    io,
    net::SocketAddr,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{Extension, Router};
use axum_server::Handle;
use config::axum::middlewares::RealIp;
use futures::future::BoxFuture;
use o2_enterprise::enterprise::status_pages::cert_store::{
    PageGate, PageRef, Readiness, StoreEntry,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::watch,
    time::Instant,
};
use tokio_rustls::{
    TlsConnector,
    client::TlsStream,
    rustls::{
        ClientConfig, DigitallySignedStruct, Error, SignatureScheme,
        client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
        crypto::ring,
        pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
        sign::{CertifiedKey, Signer, SigningKey},
    },
};

use super::{
    Directory, Plan,
    acceptor::{DomainAcceptor, Stop, TlsHost},
    apply_limits,
    proxy_protocol::Proxy,
};

pub(super) const HOST: &str = "status.brand.test";
pub(super) const SLUG: &str = "brand-status";

/// An in-memory `Directory`; every certificate it hands out counts the signatures made with it.
pub(super) struct Fake {
    entries: Mutex<HashMap<String, Arc<StoreEntry>>>,
    challenges: Mutex<HashMap<String, Arc<CertifiedKey>>>,
    readiness: Mutex<Readiness>,
    gate: Mutex<PageGate>,
    peers: Mutex<Vec<bool>>,
    listening: Mutex<Option<SocketAddr>>,
    drained: AtomicBool,
    loaded: watch::Sender<bool>,
    signs: Arc<AtomicUsize>,
    gate_calls: AtomicUsize,
}

impl Fake {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self {
            entries: Mutex::new(HashMap::new()),
            challenges: Mutex::new(HashMap::new()),
            readiness: Mutex::new(Readiness::Ready),
            gate: Mutex::new(PageGate::Serve),
            peers: Mutex::new(Vec::new()),
            listening: Mutex::new(None),
            drained: AtomicBool::new(false),
            loaded: watch::channel(true).0,
            signs: Arc::new(AtomicUsize::new(0)),
            gate_calls: AtomicUsize::new(0),
        })
    }

    /// A store that is still loading: `loaded` does not resolve until `finish_loading`.
    pub(super) fn loading() -> Arc<Self> {
        let fake = Self::new();
        fake.loaded.send_replace(false);
        *fake.readiness.lock().unwrap() = Readiness::Loading;
        fake
    }

    pub(super) fn finish_loading(&self) {
        *self.readiness.lock().unwrap() = Readiness::Ready;
        self.loaded.send_replace(true);
    }

    /// A holder's hostname and page, served with a certificate of its own.
    pub(super) fn serve(&self, hostname: &str, slug: &str) {
        let page = PageRef {
            claim_id: format!("claim-{hostname}"),
            org_id: "org-a".to_string(),
            page_id: format!("page-{hostname}"),
            slug: slug.to_string(),
        };
        self.put(hostname, Some(page));
    }

    /// The domain target: a certificate and no page.
    pub(super) fn serve_target(&self, hostname: &str) {
        self.put(hostname, None);
    }

    pub(super) fn release(&self, hostname: &str) {
        self.entries.lock().unwrap().remove(hostname);
    }

    /// The RFC 8737 certificate for a pending challenge; its leaf comes back.
    pub(super) fn challenge_for(&self, hostname: &str) -> CertificateDer<'static> {
        let (key, der) = self.certificate(hostname);
        self.challenges
            .lock()
            .unwrap()
            .insert(hostname.to_string(), key);
        der
    }

    pub(super) fn set_readiness(&self, readiness: Readiness) {
        *self.readiness.lock().unwrap() = readiness;
    }

    pub(super) fn set_gate(&self, gate: PageGate) {
        *self.gate.lock().unwrap() = gate;
    }

    /// Signatures made with any certificate of this store so far.
    pub(super) fn signatures(&self) -> usize {
        self.signs.load(Ordering::SeqCst)
    }

    pub(super) fn peers(&self) -> Vec<bool> {
        self.peers.lock().unwrap().clone()
    }

    pub(super) fn listening(&self) -> Option<SocketAddr> {
        *self.listening.lock().unwrap()
    }

    /// How many requests reached the page gate, which they do once their head is dispatched.
    pub(super) fn gate_calls(&self) -> usize {
        self.gate_calls.load(Ordering::SeqCst)
    }

    pub(super) fn drained(&self) -> bool {
        self.drained.load(Ordering::SeqCst)
    }

    fn put(&self, hostname: &str, page: Option<PageRef>) {
        let (certified_key, _) = self.certificate(hostname);
        let entry = StoreEntry {
            hostname: hostname.to_string(),
            certified_key,
            fingerprint: "fingerprint".to_string(),
            not_after: i64::MAX,
            page,
        };
        self.entries
            .lock()
            .unwrap()
            .insert(hostname.to_string(), Arc::new(entry));
    }

    /// A P-256 certificate for the hostname whose key counts its signatures.
    fn certificate(&self, hostname: &str) -> (Arc<CertifiedKey>, CertificateDer<'static>) {
        let made = rcgen::generate_simple_self_signed(vec![hostname.to_string()]).unwrap();
        let private =
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(made.signing_key.serialize_der()));
        let inner = ring::default_provider()
            .key_provider
            .load_private_key(private)
            .unwrap();
        let counting = Arc::new(CountingKey {
            inner,
            signs: self.signs.clone(),
        });
        let der = made.cert.der().clone();
        (
            Arc::new(CertifiedKey::new(vec![der.clone()], counting)),
            der,
        )
    }
}

impl Directory for Fake {
    fn entry(&self, hostname: &str) -> Option<Arc<StoreEntry>> {
        self.entries.lock().unwrap().get(hostname).cloned()
    }

    fn challenge(&self, hostname: &str) -> Option<Arc<CertifiedKey>> {
        self.challenges.lock().unwrap().get(hostname).cloned()
    }

    fn readiness(&self) -> Readiness {
        *self.readiness.lock().unwrap()
    }

    fn page_gate(&self, _: &PageRef) -> PageGate {
        self.gate_calls.fetch_add(1, Ordering::SeqCst);
        *self.gate.lock().unwrap()
    }

    fn record_peer(&self, private: bool) {
        self.peers.lock().unwrap().push(private);
    }

    fn set_listening(&self, addr: SocketAddr) {
        *self.listening.lock().unwrap() = Some(addr);
    }

    fn begin_drain(&self) {
        self.drained.store(true, Ordering::SeqCst);
    }

    fn loaded(&self) -> BoxFuture<'static, ()> {
        let mut loaded = self.loaded.subscribe();
        Box::pin(async move {
            let _ = loaded.wait_for(|loaded| *loaded).await;
        })
    }
}

#[derive(Debug)]
struct CountingKey {
    inner: Arc<dyn SigningKey>,
    signs: Arc<AtomicUsize>,
}

impl SigningKey for CountingKey {
    fn choose_scheme(&self, offered: &[SignatureScheme]) -> Option<Box<dyn Signer>> {
        let inner = self.inner.choose_scheme(offered)?;
        Some(Box::new(CountingSigner {
            inner,
            signs: self.signs.clone(),
        }))
    }

    fn algorithm(&self) -> tokio_rustls::rustls::SignatureAlgorithm {
        self.inner.algorithm()
    }
}

#[derive(Debug)]
struct CountingSigner {
    inner: Box<dyn Signer>,
    signs: Arc<AtomicUsize>,
}

impl Signer for CountingSigner {
    fn sign(&self, message: &[u8]) -> Result<Vec<u8>, Error> {
        self.signs.fetch_add(1, Ordering::SeqCst);
        self.inner.sign(message)
    }

    fn scheme(&self) -> SignatureScheme {
        self.inner.scheme()
    }
}

/// A clock the test moves, for the handshake rate limits.
pub(super) struct ManualClock {
    base: Instant,
    micros: AtomicU64,
}

impl ManualClock {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self {
            base: Instant::now(),
            micros: AtomicU64::new(0),
        })
    }

    pub(super) fn now(&self) -> Instant {
        self.base + Duration::from_micros(self.micros.load(Ordering::SeqCst))
    }

    pub(super) fn advance(&self, by: Duration) {
        let micros = u64::try_from(by.as_micros()).unwrap();
        self.micros.fetch_add(micros, Ordering::SeqCst);
    }
}

/// A TLS port on loopback with the acceptor under test and a router that echoes what it got.
pub(super) struct Port {
    pub(super) addr: SocketAddr,
    pub(super) handle: Handle<SocketAddr>,
    pub(super) stop: Arc<Stop>,
}

impl Port {
    pub(super) async fn open(directory: Arc<Fake>, proxy: Proxy) -> Self {
        let stop = Stop::new();
        Self::open_with(DomainAcceptor::new(directory, proxy, stop)).await
    }

    pub(super) async fn open_with(acceptor: DomainAcceptor) -> Self {
        let stop = acceptor.stop();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = Handle::new();
        let mut server = axum_server::from_tcp(listener)
            .unwrap()
            .acceptor(acceptor)
            .handle(handle.clone());
        apply_limits(&mut server);
        let app = Router::new().fallback(
            |Extension(host): Extension<TlsHost>, Extension(ip): Extension<RealIp>| async move {
                format!("{} {}", host.0, ip.0)
            },
        );
        tokio::spawn(async move { server.serve(app.into_make_service()).await });
        Self { addr, handle, stop }
    }
}

impl Drop for Port {
    fn drop(&mut self) {
        self.handle.shutdown();
    }
}

/// The certificate verifier that accepts anything: tests compare the certificate they get.
#[derive(Debug)]
struct AnyCertificate;

impl ServerCertVerifier for AnyCertificate {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &CertificateDer<'_>,
        _: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub(super) fn client_config(alpn: &[&[u8]]) -> ClientConfig {
    let mut config = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AnyCertificate))
        .with_no_client_auth();
    config.alpn_protocols = alpn.iter().map(|protocol| protocol.to_vec()).collect();
    config
}

/// A TLS handshake with `sni` as the server name; an IP literal sends none.
pub(super) async fn connect(
    addr: SocketAddr,
    sni: &str,
    alpn: &[&[u8]],
) -> io::Result<TlsStream<TcpStream>> {
    let tcp = TcpStream::connect(addr).await?;
    handshake(tcp, sni, alpn).await
}

pub(super) async fn handshake(
    tcp: TcpStream,
    sni: &str,
    alpn: &[&[u8]],
) -> io::Result<TlsStream<TcpStream>> {
    let name = ServerName::try_from(sni.to_string()).unwrap();
    TlsConnector::from(Arc::new(client_config(alpn)))
        .connect(name, tcp)
        .await
}

/// One request on an established connection; the status and the whole response text.
pub(super) async fn get(
    stream: &mut TlsStream<TcpStream>,
    host: &str,
    path: &str,
    extra: &str,
) -> io::Result<(u16, String)> {
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await?;
    let mut text = Vec::new();
    let _ = stream.read_to_end(&mut text).await;
    let text = String::from_utf8_lossy(&text).into_owned();
    let status = text
        .split(' ')
        .nth(1)
        .and_then(|status| status.parse().ok())
        .unwrap_or(0);
    Ok((status, text))
}

/// The body of an HTTP/1 response text.
pub(super) fn body(response: &str) -> &str {
    response.split("\r\n\r\n").nth(1).unwrap_or("")
}

/// Whether the server end has closed the connection: a read ends with EOF or an error.
pub(super) async fn is_closed(stream: &mut TcpStream) -> bool {
    let mut byte = [0u8; 1];
    match tokio::time::timeout(Duration::from_millis(200), stream.read(&mut byte)).await {
        Ok(Ok(0) | Err(_)) => true,
        Ok(Ok(_)) | Err(_) => false,
    }
}

/// A PROXY header of version 1 or 2 that names `ip` as the visitor.
pub(super) fn proxy_header(version: u8, ip: &str) -> Vec<u8> {
    let ip: std::net::IpAddr = ip.parse().unwrap();
    if version == 1 {
        return match ip {
            std::net::IpAddr::V4(ip) => format!("PROXY TCP4 {ip} 10.0.0.1 40000 443\r\n"),
            std::net::IpAddr::V6(ip) => format!("PROXY TCP6 {ip} ::1 40000 443\r\n"),
        }
        .into_bytes();
    }
    let mut bytes = b"\r\n\r\n\0\r\nQUIT\n".to_vec();
    let (family, mut payload) = match ip {
        std::net::IpAddr::V4(ip) => (0x11, [ip.octets().as_slice(), &[10, 0, 0, 1]].concat()),
        std::net::IpAddr::V6(ip) => (
            0x21,
            [
                ip.octets().as_slice(),
                std::net::Ipv6Addr::LOCALHOST.octets().as_slice(),
            ]
            .concat(),
        ),
    };
    payload.extend(40000u16.to_be_bytes());
    payload.extend(443u16.to_be_bytes());
    bytes.extend([0x21, family]);
    bytes.extend(u16::try_from(payload.len()).unwrap().to_be_bytes());
    bytes.extend(payload);
    bytes
}

/// A connection that has sent its PROXY header and nothing else.
pub(super) async fn proxied(addr: SocketAddr, version: u8, ip: &str) -> TcpStream {
    let mut tcp = TcpStream::connect(addr).await.unwrap();
    tcp.write_all(&proxy_header(version, ip)).await.unwrap();
    tcp
}

/// A plan that binds every port on an ephemeral loopback port.
pub(super) fn local_plan(proxy: Proxy) -> Plan {
    let any: SocketAddr = "127.0.0.1:0".parse().unwrap();
    Plan {
        https: any,
        redirect: Some(any),
        health: Some(any),
        proxy,
        graceful: Duration::from_secs(2),
        main_port: 0,
    }
}

/// A loopback port nothing listens on right now.
pub(super) fn free_port() -> SocketAddr {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap()
}

/// One plain HTTP/1 request, after whatever bytes `preface` holds; the status and the response.
pub(super) async fn plain_get(
    addr: SocketAddr,
    preface: &[u8],
    host: Option<&str>,
    path: &str,
) -> io::Result<(u16, String)> {
    let mut tcp = TcpStream::connect(addr).await?;
    let host = host.map_or(String::new(), |host| format!("Host: {host}\r\n"));
    let request = format!("GET {path} HTTP/1.1\r\n{host}Connection: close\r\n\r\n");
    tcp.write_all(&[preface, request.as_bytes()].concat())
        .await?;
    let mut text = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(5), tcp.read_to_end(&mut text)).await;
    let text = String::from_utf8_lossy(&text).into_owned();
    let status = text
        .split(' ')
        .nth(1)
        .and_then(|status| status.parse().ok())
        .unwrap_or(0);
    Ok((status, text))
}

/// How long `done` takes in paused time. The server finishes its side of the handshake in real
/// time first, and a one-second ticker keeps the clock moving in small steps, so the server's own
/// timers are armed before the clock reaches them.
pub(super) async fn elapsed_until<T>(done: impl Future<Output = T>) -> Duration {
    tokio::time::sleep(Duration::from_millis(100)).await;
    tokio::time::pause();
    let started = Instant::now();
    let mut done = std::pin::pin!(done);
    loop {
        tokio::select! {
            _ = &mut done => break,
            () = tokio::time::sleep(Duration::from_secs(1)) => {
                if started.elapsed() > Duration::from_secs(300) {
                    break;
                }
            }
        }
    }
    started.elapsed()
}

/// `took` is the deadline, give or take the tick of the helper and the settling before it.
pub(super) fn near(took: Duration, deadline: Duration) -> bool {
    took + Duration::from_secs(1) >= deadline && took < deadline + Duration::from_secs(2)
}
