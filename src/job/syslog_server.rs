// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use once_cell::sync::Lazy;
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use tokio::sync::RwLock;
use tokio::{
    net::{TcpListener, UdpSocket},
    sync::broadcast,
};

use crate::handler::tcp_udp::STOP_SRV;
use crate::service::db::syslog::toggle_syslog_setting;
use crate::{
    handler::tcp_udp::{tcp_server, udp_server},
    infra::config::{CONFIG, SYSLOG_ENABLED},
};

//TCP UDP Server
pub static BROADCASTER: Lazy<RwLock<broadcast::Sender<bool>>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(2);
    RwLock::new(tx)
});

pub async fn run(start_srv: bool, is_init: bool) -> Result<(), anyhow::Error> {
    let server_running = *SYSLOG_ENABLED.read();
    let bind_addr = "0.0.0.0";
    let tcp_addr: SocketAddr = format!("{bind_addr}:{}", CONFIG.tcp.tcp_port).parse()?;
    let udp_addr: SocketAddr = format!("{bind_addr}:{}", CONFIG.tcp.udp_port).parse()?;
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

    #[actix_web::test]
    async fn test_run() {
        run(false, true).await.unwrap();
    }
}
