// Copyright 2023 Zinc Labs Inc.
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

use bytes::BytesMut;
use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, UdpSocket},
};

use crate::{job::syslog_server::BROADCASTER, service::logs::syslog};

pub static STOP_SRV: &str = "ZO_STOP_TCP_UDP";

pub async fn udp_server(socket: UdpSocket) {
    let mut buf_udp = vec![0u8; 1472];
    let sender = BROADCASTER.read().await;
    let mut udp_receiver_rx = sender.subscribe();
    loop {
        let (recv_len, addr) = socket.recv_from(&mut buf_udp).await.unwrap();
        let message = BytesMut::from(&buf_udp[..recv_len]);
        let input_str = String::from_utf8(message.to_vec()).unwrap();
        if input_str != STOP_SRV {
            let _ = syslog::ingest(&input_str, addr).await;
        }
        if let Ok(val) = udp_receiver_rx.try_recv() {
            if !val {
                log::warn!("UDP server - received the stop signal, exiting.");
                drop(socket);
                break;
            }
        };
    }
}

pub async fn tcp_server(listener: TcpListener) {
    let sender = BROADCASTER.read().await;
    let mut tcp_receiver_rx = sender.subscribe();
    let mut buf_tcp = vec![0u8; 1460];
    loop {
        let (mut stream, _) = listener.accept().await.unwrap();

        match stream.peer_addr() {
            Ok(addr) => {
                let len = stream.read(&mut buf_tcp).await.unwrap();
                let message = BytesMut::from(&buf_tcp[..len]);
                let input_str = String::from_utf8(message.to_vec()).unwrap();
                if input_str != STOP_SRV {
                    let _ = syslog::ingest(&input_str, addr).await;
                }
                if let Ok(val) = tcp_receiver_rx.try_recv() {
                    if !val {
                        log::warn!("TCP server - received the stop signal, exiting.");
                        drop(listener);
                        break;
                    }
                };
            }
            Err(e) => {
                log::error!("Error while writing to TCP stream: {}", e);
                continue;
            }
        };
    }
}
