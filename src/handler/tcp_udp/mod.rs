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

use std::net::SocketAddr;

use bytes::BytesMut;
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    net::{TcpListener, UdpSocket},
};
use tokio_rustls::TlsAcceptor;

use crate::{job::syslog_server::BROADCASTER, service::logs::syslog};

pub static STOP_SRV: &str = "ZO_STOP_TCP_UDP";

pub async fn udp_server(socket: UdpSocket) {
    let mut buf_udp = vec![0u8; 1472];
    let sender = BROADCASTER.read().await;
    let mut udp_receiver_rx = sender.subscribe();
    loop {
        let (recv_len, addr) = match socket.recv_from(&mut buf_udp).await {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error while reading from UDP socket: {}", e);
                continue;
            }
        };
        let message = BytesMut::from(&buf_udp[..recv_len]);
        let input_str = match String::from_utf8(message.to_vec()) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error while converting UDP message to UTF8 string: {}", e);
                continue;
            }
        };
        if input_str != STOP_SRV {
            let _ = syslog::ingest(&input_str, addr).await;
        }
        if let Ok(val) = udp_receiver_rx.try_recv()
            && !val
        {
            log::warn!("UDP server - received the stop signal, exiting.");
            break;
        }
    }
}

pub async fn tls_tcp_server(listener: TcpListener, tls_acceptor: Option<TlsAcceptor>) {
    let sender = BROADCASTER.read().await;
    let mut tcp_receiver_rx = sender.subscribe();
    loop {
        let (tcp_stream, peer_addr) = match listener.accept().await {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error while accepting TCP connection: {}", e);
                continue;
            }
        };
        match tls_acceptor.clone() {
            Some(acceptor) => match acceptor.accept(tcp_stream).await {
                Ok(tls_stream) => {
                    log::info!("accepted TLS connection for peer {}", peer_addr);
                    tokio::task::spawn(handle_connection(tls_stream, peer_addr));
                }
                Err(e) => {
                    log::error!("TLS accept error: {}", e);
                }
            },
            None => {
                tokio::task::spawn(handle_connection(tcp_stream, peer_addr));
            }
        }

        if let Ok(val) = tcp_receiver_rx.try_recv()
            && !val
        {
            log::warn!("TCP server - received the stop signal, exiting.");
            drop(listener);
            break;
        }
    }
}

async fn handle_connection<S>(mut stream: S, peer_addr: SocketAddr)
where
    S: AsyncRead + Unpin + Send + 'static,
{
    let mut buf_tcp = vec![0u8; 1460];
    log::info!("spawned new syslog tcp receiver for peer {}", peer_addr);
    loop {
        let n = match stream.read(&mut buf_tcp).await {
            Ok(0) => {
                log::info!("received 0 bytes, closing for peer {}", peer_addr);
                break;
            }
            Ok(n) => n,
            Err(e) => {
                log::error!("Error while reading from TCP stream: {}", e);
                break;
            }
        };
        let message = BytesMut::from(&buf_tcp[..n]);
        let input_str = match String::from_utf8(message.to_vec()) {
            Ok(val) => val,
            Err(e) => {
                log::error!("Error while converting TCP message to UTF8 string: {}", e);
                continue;
            }
        };
        if input_str != STOP_SRV {
            if let Err(e) = syslog::ingest(&input_str, peer_addr).await {
                log::error!("Error while ingesting TCP message: {}", e);
            }
        } else {
            log::info!("received stop signal, closing for peer {}", peer_addr);
            break;
        }
    }
}
