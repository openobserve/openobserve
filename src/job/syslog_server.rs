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

use std::{io::BufReader, net::SocketAddr, sync::Arc};

use once_cell::sync::Lazy;
use rustls::pki_types::ServerName;
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{RwLock, broadcast},
};
use tokio_rustls::{TlsAcceptor, TlsConnector};

use crate::{
    common::infra::config::SYSLOG_ENABLED,
    handler::tcp_udp::{STOP_SRV, tls_tcp_server, udp_server},
    service::{
        db::syslog::toggle_syslog_setting,
        tls::{
            get_server_url_from_cert, tcp_tls_self_connect_client_config, tcp_tls_server_config,
        },
    },
};

// TCP UDP Server
pub static BROADCASTER: Lazy<RwLock<broadcast::Sender<bool>>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(2);
    RwLock::new(tx)
});

pub async fn run(start_srv: bool, is_init: bool) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    let server_running = *SYSLOG_ENABLED.read();
    let bind_addr = "0.0.0.0";
    let tcp_addr: SocketAddr = format!("{bind_addr}:{}", cfg.tcp.tcp_port).parse()?;
    let udp_addr: SocketAddr = format!("{bind_addr}:{}", cfg.tcp.udp_port).parse()?;
    let tcp_tls_enabled = cfg.tcp.tcp_tls_enabled;
    if (!server_running || is_init) && start_srv {
        log::info!("Starting TCP UDP server on {tcp_addr}");
        let tcp_listener: TcpListener = TcpListener::bind(tcp_addr).await?;
        let udp_socket = UdpSocket::bind(udp_addr).await?;
        let tls_server_config = if tcp_tls_enabled {
            log::info!("TCP TLS enabled, preparing TLS server config");
            let tls_server_config = tcp_tls_server_config()?;
            log::info!("TCP TLS config prepared");
            Some(tls_server_config)
        } else {
            None
        };
        let tls_acceptor = tls_server_config.map(Arc::new).map(TlsAcceptor::from);

        tokio::task::spawn(async move {
            _ = tls_tcp_server(tcp_listener, tls_acceptor).await;
        });

        tokio::task::spawn(async move {
            _ = udp_server(udp_socket).await;
        });
        toggle_syslog_setting(start_srv).await?;
    } else if server_running && !start_srv {
        // stop running server
        let sender = BROADCASTER.read().await;
        let _ = sender.send(start_srv);

        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        socket.send_to(STOP_SRV.as_bytes(), udp_addr).await?;
        drop(socket);

        if tcp_tls_enabled {
            let config = tcp_tls_self_connect_client_config()?;
            let connector = TlsConnector::from(config);
            match TcpStream::connect(tcp_addr).await {
                Ok(stream) => {
                    let cert_file = &mut BufReader::new(
                        std::fs::File::open(&cfg.tcp.tcp_tls_cert_path).map_err(|e| {
                            anyhow::anyhow!(
                                "Failed to open TLS certificate file {}: {}",
                                &cfg.tcp.tcp_tls_cert_path,
                                e
                            )
                        })?,
                    );

                    let cert_chain = rustls_pemfile::certs(cert_file)
                        .collect::<Result<Vec<_>, _>>()
                        .map_err(|e| anyhow::anyhow!("Failed to parse TLS certificate: {}", e))?;
                    let der_encoded_cert = cert_chain
                        .first()
                        .ok_or(anyhow::anyhow!("TLS certificate not found"))?;
                    let server_san = get_server_url_from_cert(der_encoded_cert)?;
                    let server_name = ServerName::try_from(server_san)?;
                    log::info!(
                        "Connecting to TLS server for stop signal: {}",
                        server_name.to_str()
                    );
                    let mut tls_stream = connector.connect(server_name, stream).await?;
                    tls_stream.write_all(STOP_SRV.as_bytes()).await?;
                }
                Err(e) => {
                    log::error!("Failed to connect to TCP server for stop signal: {}", e);
                }
            }
        } else {
            // Plain TCP connection for non-TLS mode
            let mut stream = TcpStream::connect(tcp_addr).await?;
            stream.write_all(STOP_SRV.as_bytes()).await?;
        }
        toggle_syslog_setting(start_srv).await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run;

    #[tokio::test]
    async fn test_run() {
        run(false, true).await.unwrap();
    }
}
