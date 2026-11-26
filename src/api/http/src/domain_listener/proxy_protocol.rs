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

//! PROXY protocol versions 1 and 2 on the connections of the domain ports: who may send a header,
//! how it is read, and the address it carries.

use std::{
    future::Future,
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use ppp::{v1, v2};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    net::TcpStream,
    time::{sleep, timeout},
};

pub(super) const HEADER_DEADLINE: Duration = Duration::from_secs(2);

/// The longest version 1 line, CRLF included.
const V1_MAX_LEN: usize = 107;
const V1_PREFIX: &[u8] = b"PROXY ";
const V2_SIGNATURE: [u8; 12] = *b"\r\n\r\n\0\r\nQUIT\n";
const V2_FIXED_LEN: usize = 16;
/// Addresses plus TLVs; a load balancer sends well under this.
const V2_MAX_PAYLOAD: usize = 1024;
const PEEK_RETRY: Duration = Duration::from_millis(5);

/// How a port treats the PROXY header of its connections.
#[derive(Clone)]
pub(super) enum Proxy {
    Off,
    /// A header from a trusted source is required; everything else is closed.
    Required(Arc<Trusted>),
    /// A header is read when one comes, from any source; the address is not used for limits.
    Optional,
}

/// The sources allowed to send a header; an empty list allows none.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Trusted(Vec<Cidr>);

impl Trusted {
    /// Entries that do not parse are logged and dropped, which trusts less, never more.
    pub(super) fn parse(list: &str) -> Self {
        let cidrs = list
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .filter_map(|entry| {
                let cidr = Cidr::parse(entry);
                if cidr.is_none() {
                    log::error!("[status_pages] ignoring invalid trusted CIDR {entry:?}");
                }
                cidr
            })
            .collect();
        Self(cidrs)
    }

    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(super) fn contains(&self, ip: IpAddr) -> bool {
        let ip = ip.to_canonical();
        self.0.iter().any(|cidr| cidr.contains(ip))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Cidr {
    network: IpAddr,
    prefix: u8,
}

impl Cidr {
    fn parse(entry: &str) -> Option<Self> {
        let (address, prefix) = match entry.split_once('/') {
            Some((address, prefix)) => (address, Some(prefix.parse::<u8>().ok()?)),
            None => (entry, None),
        };
        let network = address.parse::<IpAddr>().ok()?.to_canonical();
        let width = if network.is_ipv4() { 32 } else { 128 };
        let prefix = prefix.unwrap_or(width);
        (prefix <= width).then_some(Self { network, prefix })
    }

    fn contains(&self, ip: IpAddr) -> bool {
        match (self.network, ip) {
            (IpAddr::V4(network), IpAddr::V4(ip)) => {
                let mask = u32::MAX
                    .checked_shl(32 - u32::from(self.prefix))
                    .unwrap_or(0);
                u32::from(network) & mask == u32::from(ip) & mask
            }
            (IpAddr::V6(network), IpAddr::V6(ip)) => {
                let mask = u128::MAX
                    .checked_shl(128 - u32::from(self.prefix))
                    .unwrap_or(0);
                u128::from(network) & mask == u128::from(ip) & mask
            }
            _ => false,
        }
    }
}

/// Why a connection is closed instead of served.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Close {
    Untrusted,
    /// A health check header (`LOCAL`, `UNKNOWN`) carries no visitor; closed without a log line.
    NoAddress,
    Malformed,
    Timeout,
    Io,
}

impl Close {
    pub(super) fn note(&self, peer: SocketAddr) {
        match self {
            Self::NoAddress => {}
            reason => log::debug!("[status_pages] closing {peer}: PROXY header {reason:?}"),
        }
    }
}

/// The visitor address of a connection under the port's proxy mode.
pub(super) async fn visitor(
    stream: &mut TcpStream,
    peer: SocketAddr,
    proxy: &Proxy,
) -> Result<SocketAddr, Close> {
    let peer = SocketAddr::new(peer.ip().to_canonical(), peer.port());
    match proxy {
        Proxy::Off => Ok(peer),
        Proxy::Required(trusted) => {
            if !trusted.contains(peer.ip()) {
                return Err(Close::Untrusted);
            }
            within(read_header(stream)).await
        }
        Proxy::Optional => match within(read_optional(stream)).await {
            Ok(Some(source)) => Ok(source),
            // a load balancer's health check sends a header that names nobody: the peer probes
            Ok(None) | Err(Close::NoAddress) => Ok(peer),
            Err(close) => Err(close),
        },
    }
}

/// The notice for the start log when PROXY protocol is on and no source is trusted.
pub(super) fn empty_list_notice(proxy_on: bool, trusted: &Trusted) -> Option<String> {
    (proxy_on && trusted.is_empty()).then(|| {
        "[status_pages] PROXY protocol is on and ZO_STATUS_PAGE_DOMAIN_PROXY_TRUSTED_CIDRS is \
         empty: no source is trusted, so every connection on the domain TLS and redirect ports \
         is closed"
            .to_string()
    })
}

async fn within<T>(work: impl Future<Output = Result<T, Close>>) -> Result<T, Close> {
    timeout(HEADER_DEADLINE, work)
        .await
        .unwrap_or(Err(Close::Timeout))
}

/// Reads a header only when the first bytes say one is coming; HTTP bytes stay in the socket.
async fn read_optional(stream: &mut TcpStream) -> Result<Option<SocketAddr>, Close> {
    let mut seen = [0u8; V2_SIGNATURE.len()];
    loop {
        let n = stream.peek(&mut seen).await.map_err(|_| Close::Io)?;
        if n == 0 {
            return Err(Close::Io);
        }
        match starts_a_header(&seen[..n]) {
            Some(true) => return read_header(stream).await.map(Some),
            Some(false) => return Ok(None),
            None => sleep(PEEK_RETRY).await,
        }
    }
}

/// `Some` once the bytes seen decide it; `None` while they are a prefix of a header.
fn starts_a_header(seen: &[u8]) -> Option<bool> {
    let mut undecided = false;
    for signature in [V1_PREFIX, V2_SIGNATURE.as_slice()] {
        let shared = seen.len().min(signature.len());
        if seen[..shared] == signature[..shared] {
            if seen.len() >= signature.len() {
                return Some(true);
            }
            undecided = true;
        }
    }
    if undecided { None } else { Some(false) }
}

/// Reads exactly one header, of either version, and nothing after it.
async fn read_header<R: AsyncRead + Unpin>(stream: &mut R) -> Result<SocketAddr, Close> {
    let first = stream.read_u8().await.map_err(|_| Close::Io)?;
    match first {
        b'P' => read_v1(stream, first).await,
        0x0D => read_v2(stream, first).await,
        _ => Err(Close::Malformed),
    }
}

async fn read_v1<R: AsyncRead + Unpin>(stream: &mut R, first: u8) -> Result<SocketAddr, Close> {
    let mut line = Vec::with_capacity(V1_MAX_LEN);
    line.push(first);
    while !line.ends_with(b"\r\n") {
        if line.len() == V1_MAX_LEN {
            return Err(Close::Malformed);
        }
        line.push(stream.read_u8().await.map_err(|_| Close::Io)?);
    }
    let header = v1::Header::try_from(line.as_slice()).map_err(|_| Close::Malformed)?;
    match header.addresses {
        v1::Addresses::Tcp4(a) => Ok(SocketAddr::new(a.source_address.into(), a.source_port)),
        v1::Addresses::Tcp6(a) => Ok(SocketAddr::new(a.source_address.into(), a.source_port)),
        v1::Addresses::Unknown => Err(Close::NoAddress),
    }
}

async fn read_v2<R: AsyncRead + Unpin>(stream: &mut R, first: u8) -> Result<SocketAddr, Close> {
    let mut buf = vec![0u8; V2_FIXED_LEN];
    buf[0] = first;
    stream
        .read_exact(&mut buf[1..])
        .await
        .map_err(|_| Close::Io)?;
    if buf[..V2_SIGNATURE.len()] != V2_SIGNATURE {
        return Err(Close::Malformed);
    }
    let payload = usize::from(u16::from_be_bytes([buf[14], buf[15]]));
    if payload > V2_MAX_PAYLOAD {
        return Err(Close::Malformed);
    }
    buf.resize(V2_FIXED_LEN + payload, 0);
    stream
        .read_exact(&mut buf[V2_FIXED_LEN..])
        .await
        .map_err(|_| Close::Io)?;
    let header = v2::Header::try_from(buf.as_slice()).map_err(|_| Close::Malformed)?;
    match (header.command, header.addresses) {
        (v2::Command::Proxy, v2::Addresses::IPv4(a)) => {
            Ok(SocketAddr::new(a.source_address.into(), a.source_port))
        }
        (v2::Command::Proxy, v2::Addresses::IPv6(a)) => {
            Ok(SocketAddr::new(a.source_address.into(), a.source_port))
        }
        _ => Err(Close::NoAddress),
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, Ipv6Addr};

    use tokio::{io::AsyncWriteExt, net::TcpListener, time::Instant};

    use super::*;

    const V6_LINE: &[u8] = b"PROXY TCP6 2001:db8::7 2001:db8::1 40000 443\r\n";

    fn v2_header(command: u8, family: u8, payload: &[u8]) -> Vec<u8> {
        let mut bytes = V2_SIGNATURE.to_vec();
        bytes.extend([command, family]);
        bytes.extend(u16::try_from(payload.len()).unwrap().to_be_bytes());
        bytes.extend(payload);
        bytes
    }

    fn v2_v4(source: [u8; 4], port: u16) -> Vec<u8> {
        let mut payload = source.to_vec();
        payload.extend([10, 0, 0, 1]);
        payload.extend(port.to_be_bytes());
        payload.extend(443u16.to_be_bytes());
        v2_header(0x21, 0x11, &payload)
    }

    fn v2_v6(source: Ipv6Addr, port: u16) -> Vec<u8> {
        let mut payload = source.octets().to_vec();
        payload.extend(Ipv6Addr::LOCALHOST.octets());
        payload.extend(port.to_be_bytes());
        payload.extend(443u16.to_be_bytes());
        v2_header(0x21, 0x21, &payload)
    }

    async fn parse(bytes: &[u8]) -> Result<SocketAddr, Close> {
        let mut reader = bytes;
        read_header(&mut reader).await
    }

    async fn pair() -> (TcpStream, TcpStream, SocketAddr) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap())
            .await
            .unwrap();
        let (server, peer) = listener.accept().await.unwrap();
        (client, server, peer)
    }

    fn trusted(list: &str) -> Proxy {
        Proxy::Required(Arc::new(Trusted::parse(list)))
    }

    #[tokio::test]
    async fn version_1_gives_the_source_of_tcp4_and_tcp6() {
        let v4 = parse(b"PROXY TCP4 198.51.100.7 10.0.0.1 40000 443\r\n").await;
        assert_eq!(v4, Ok("198.51.100.7:40000".parse().unwrap()));
        assert_eq!(
            parse(V6_LINE).await,
            Ok("[2001:db8::7]:40000".parse().unwrap())
        );
    }

    #[tokio::test]
    async fn version_2_gives_the_source_of_ipv4_and_ipv6() {
        let v4 = parse(&v2_v4([198, 51, 100, 7], 40000)).await;
        assert_eq!(v4, Ok("198.51.100.7:40000".parse().unwrap()));
        let source = "2001:db8::7".parse().unwrap();
        let v6 = parse(&v2_v6(source, 40001)).await;
        assert_eq!(v6, Ok("[2001:db8::7]:40001".parse().unwrap()));
    }

    #[tokio::test]
    async fn the_longest_version_1_line_is_read() {
        let line = b"PROXY TCP6 ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
            ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff 65535 65535\r\n";
        assert!(line.len() <= V1_MAX_LEN);
        assert!(parse(line).await.is_ok());
    }

    #[tokio::test]
    async fn a_header_with_no_address_is_closed_quietly() {
        assert_eq!(parse(b"PROXY UNKNOWN\r\n").await, Err(Close::NoAddress));
        assert_eq!(
            parse(&v2_header(0x20, 0x00, &[])).await,
            Err(Close::NoAddress)
        );
        let unspecified = v2_header(0x21, 0x00, &[]);
        assert_eq!(parse(&unspecified).await, Err(Close::NoAddress));
    }

    #[tokio::test]
    async fn an_over_long_version_1_line_and_garbage_are_closed() {
        let mut long = b"PROXY TCP4 ".to_vec();
        long.resize(V1_MAX_LEN + 1, b'1');
        assert_eq!(parse(&long).await, Err(Close::Malformed));
        assert_eq!(parse(b"GET / HTTP/1.1\r\n").await, Err(Close::Malformed));
        assert_eq!(parse(b"POST / HTTP/1.1\r\n").await, Err(Close::Malformed));
        assert_eq!(
            parse(&[0x16, 0x03, 0x01, 0x02, 0x00]).await,
            Err(Close::Malformed)
        );
    }

    #[tokio::test]
    async fn a_broken_version_2_header_is_closed() {
        let mut bad_signature = v2_v4([1, 2, 3, 4], 1);
        bad_signature[5] = b'X';
        assert_eq!(parse(&bad_signature).await, Err(Close::Malformed));
        let mut bad_version = v2_v4([1, 2, 3, 4], 1);
        bad_version[12] = 0x11;
        assert_eq!(parse(&bad_version).await, Err(Close::Malformed));
        let oversized = v2_header(0x21, 0x11, &vec![0; V2_MAX_PAYLOAD + 1]);
        assert_eq!(parse(&oversized).await, Err(Close::Malformed));
        let truncated = v2_v4([1, 2, 3, 4], 1);
        assert_eq!(parse(&truncated[..20]).await, Err(Close::Io));
    }

    #[test]
    fn an_empty_list_trusts_nothing_and_the_notice_says_so() {
        let none = Trusted::parse("");
        assert!(none.is_empty());
        assert!(!none.contains("127.0.0.1".parse().unwrap()));
        assert!(
            empty_list_notice(true, &none)
                .unwrap()
                .contains("no source is trusted")
        );
        assert_eq!(empty_list_notice(false, &none), None);
        assert_eq!(empty_list_notice(true, &Trusted::parse("10.0.0.0/8")), None);
    }

    #[test]
    fn cidrs_match_by_prefix_in_both_families() {
        let list = Trusted::parse("10.0.0.0/8, 192.0.2.7, fd00::/8,bogus,10.0.0.0/33");
        assert_eq!(list.0.len(), 3);
        assert!(list.contains(IpAddr::V4(Ipv4Addr::new(10, 200, 3, 4))));
        assert!(list.contains(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 7))));
        assert!(!list.contains(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 8))));
        assert!(!list.contains(IpAddr::V4(Ipv4Addr::new(11, 0, 0, 1))));
        assert!(list.contains("fd12:3456::1".parse().unwrap()));
        assert!(!list.contains("fe80::1".parse().unwrap()));
        let mapped: Ipv6Addr = "::ffff:10.1.2.3".parse().unwrap();
        assert!(list.contains(IpAddr::V6(mapped)));
        assert!(Trusted::parse("0.0.0.0/0").contains(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn a_prefix_of_a_header_waits_and_anything_else_is_not_one() {
        assert_eq!(starts_a_header(b"PROXY "), Some(true));
        assert_eq!(starts_a_header(b"PRO"), None);
        assert_eq!(starts_a_header(b"POST /"), Some(false));
        assert_eq!(starts_a_header(b"GET / HTTP/1.1"), Some(false));
        assert_eq!(starts_a_header(&V2_SIGNATURE), Some(true));
        assert_eq!(starts_a_header(&V2_SIGNATURE[..5]), None);
        assert_eq!(starts_a_header(&[0x16, 0x03, 0x01]), Some(false));
    }

    #[tokio::test]
    async fn an_untrusted_source_is_closed_before_a_byte_is_parsed() {
        let (mut client, mut server, peer) = pair().await;
        client.write_all(V6_LINE).await.unwrap();
        let outcome = visitor(&mut server, peer, &trusted("10.0.0.0/8")).await;
        assert_eq!(outcome, Err(Close::Untrusted));
        let mut seen = [0u8; 6];
        server.peek(&mut seen).await.unwrap();
        assert_eq!(&seen, b"PROXY ");
    }

    #[tokio::test]
    async fn an_empty_trusted_list_closes_every_connection() {
        let (mut client, mut server, peer) = pair().await;
        client.write_all(V6_LINE).await.unwrap();
        assert_eq!(
            visitor(&mut server, peer, &trusted("")).await,
            Err(Close::Untrusted)
        );
    }

    #[tokio::test]
    async fn a_trusted_source_gives_the_header_address_and_off_gives_the_peer() {
        let (mut client, mut server, peer) = pair().await;
        client.write_all(V6_LINE).await.unwrap();
        let source = visitor(&mut server, peer, &trusted("127.0.0.0/8")).await;
        assert_eq!(source, Ok("[2001:db8::7]:40000".parse().unwrap()));
        assert_eq!(visitor(&mut server, peer, &Proxy::Off).await, Ok(peer));
    }

    #[tokio::test]
    async fn a_required_header_that_never_comes_times_out_at_two_seconds() {
        let (_client, mut server, peer) = pair().await;
        let started = Instant::now();
        let outcome = visitor(&mut server, peer, &trusted("127.0.0.0/8")).await;
        assert_eq!(outcome, Err(Close::Timeout));
        assert!(started.elapsed() >= HEADER_DEADLINE);
    }

    #[tokio::test]
    async fn an_optional_header_is_read_when_it_comes_and_http_bytes_stay_unread() {
        let (mut client, mut server, peer) = pair().await;
        client
            .write_all(&v2_v4([198, 51, 100, 9], 5555))
            .await
            .unwrap();
        let source = visitor(&mut server, peer, &Proxy::Optional).await;
        assert_eq!(source, Ok("198.51.100.9:5555".parse().unwrap()));

        let (mut client, mut server, peer) = pair().await;
        client
            .write_all(b"GET /healthz HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        assert_eq!(visitor(&mut server, peer, &Proxy::Optional).await, Ok(peer));
        let mut seen = [0u8; 3];
        server.peek(&mut seen).await.unwrap();
        assert_eq!(&seen, b"GET");
    }

    #[tokio::test]
    async fn an_optional_header_that_arrives_in_pieces_is_still_read() {
        let (mut client, mut server, peer) = pair().await;
        client.write_all(b"PRO").await.unwrap();
        let reader =
            tokio::spawn(async move { visitor(&mut server, peer, &Proxy::Optional).await });
        tokio::time::sleep(Duration::from_millis(50)).await;
        client.write_all(&V6_LINE[3..]).await.unwrap();
        let source = reader.await.unwrap();
        assert_eq!(source, Ok("[2001:db8::7]:40000".parse().unwrap()));
    }

    #[tokio::test]
    async fn an_optional_header_without_an_address_is_consumed_and_the_peer_is_the_visitor() {
        let local = [V2_SIGNATURE.as_slice(), &[0x20, 0x00, 0x00, 0x00]].concat();
        let unspec = [V2_SIGNATURE.as_slice(), &[0x21, 0x00, 0x00, 0x00]].concat();
        for header in [b"PROXY UNKNOWN\r\n".to_vec(), local, unspec] {
            let (mut client, mut server, peer) = pair().await;
            client.write_all(&header).await.unwrap();
            client.write_all(b"GET /healthz").await.unwrap();
            assert_eq!(visitor(&mut server, peer, &Proxy::Optional).await, Ok(peer));
            let mut seen = [0u8; 3];
            server.peek(&mut seen).await.unwrap();
            assert_eq!(
                &seen, b"GET",
                "the header is gone and the request is next: {header:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_required_header_without_an_address_is_still_closed() {
        let (mut client, mut server, peer) = pair().await;
        client.write_all(b"PROXY UNKNOWN\r\n").await.unwrap();
        assert_eq!(
            visitor(&mut server, peer, &trusted("127.0.0.0/8")).await,
            Err(Close::NoAddress)
        );
    }
}
