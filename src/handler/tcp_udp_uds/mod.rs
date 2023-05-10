use bytes::BytesMut;
use std::error::Error;
use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, UdpSocket},
};

use crate::service::logs::syslog;

pub async fn udp_server(socket: UdpSocket) -> Result<(), Box<dyn Error>> {
    let mut buf = vec![0u8; 1024];

    loop {
        let (recv_len, addr) = socket.recv_from(&mut buf).await?;
        let message = BytesMut::from(&buf[..recv_len]);
        let input_str = String::from_utf8(message.to_vec()).unwrap();
        let _ = syslog::ingest(&input_str, addr).await;
    }
}

pub async fn tcp_server(listener: TcpListener) -> Result<(), Box<dyn Error>> {
    let mut buf = vec![0u8; 1024];
    loop {
        let (mut stream, addr) = listener.accept().await?;
        let len = stream.read(&mut buf).await?;
        let message = BytesMut::from(&buf[..len]);
        let input_str = String::from_utf8(message.to_vec()).unwrap();
        let _ = syslog::ingest(&input_str, addr).await;
    }
}
