// Copyright 2023 Zinc Labs Inc.
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
    io::Write,
    net::{SocketAddr, TcpStream},
};

use config::CONFIG;
use once_cell::sync::Lazy;
use tokio::{
    net::{TcpListener, UdpSocket},
    sync::{broadcast, RwLock},
};

use crate::{
    common::infra::config::SYSLOG_ENABLED,
    handler::tcp_udp::{tcp_server, udp_server, STOP_SRV},
    service::db::syslog::toggle_syslog_setting,
};

// TCP UDP Server
pub static BROADCASTER: Lazy<RwLock<broadcast::Sender<bool>>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(2);
    RwLock::new(tx)
});

pub async fn run(start_srv: bool, is_init: bool) -> Result<(), anyhow::Error> {
    let config = CONFIG.read().await;
    let server_running = *SYSLOG_ENABLED.read();
    let bind_addr = "0.0.0.0";
    let tcp_addr: SocketAddr = format!("{bind_addr}:{}", config.tcp.tcp_port).parse()?;
    let udp_addr: SocketAddr = format!("{bind_addr}:{}", config.tcp.udp_port).parse()?;
    if (!server_running || is_init) && start_srv {
        log::info!("Starting TCP UDP server");
        let tcp_listener: TcpListener = TcpListener::bind(tcp_addr).await?;
        let udp_socket = UdpSocket::bind(udp_addr).await?;
        tokio::task::spawn(async move {
            _ = tcp_server(tcp_listener).await;
        });
        tokio::task::spawn(async move {
            _ = udp_server(udp_socket).await;
        });
        toggle_syslog_setting(start_srv).await.unwrap();
    } else if server_running && !start_srv {
        // stop running server
        let sender = BROADCASTER.read().await;
        let _ = sender.send(start_srv);

        let socket = UdpSocket::bind("0.0.0.0:34254").await?;
        socket.send_to(STOP_SRV.as_bytes(), udp_addr).await?;
        let mut stream = TcpStream::connect(tcp_addr)?;
        stream.write_all(STOP_SRV.as_bytes())?;

        drop(socket);
        drop(stream);
        toggle_syslog_setting(start_srv).await.unwrap();
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
