use std::{future::IntoFuture, net::SocketAddr};

use tokio::net::TcpListener;

use crate::router::create_router;

pub async fn spawn_server() -> Result<(), anyhow::Error> {
    // Locate or fetch chromium
    _ = config::get_chrome_launch_options().await;

    log::info!("starting o2 chrome server");

    let cfg = config::get_config();
    if cfg.report_server.user_email.is_empty() || cfg.report_server.user_password.is_empty() {
        log::error!("Missing ZO_REPORT_USER_EMAIL or ZO_REPORT_USER_PASSWORD env vars");
        return Err(anyhow::anyhow!(
            "Please set ZO_REPORT_USER_EMAIL and ZO_REPORT_USER_PASSWORD to use report server"
        ));
    }

    let haddrs = report_server_bind_addrs(
        &cfg.report_server.addr,
        cfg.report_server.port,
        cfg.report_server.ipv6_enabled,
    )?;
    log::info!("starting Report server at: {haddrs:?}");

    // Create the axum router
    let app = create_router();

    // Bind and serve
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let mut servers = Vec::with_capacity(haddrs.len());
    for haddr in haddrs {
        let listener = TcpListener::bind(haddr).await?;
        let mut shutdown_rx = shutdown_rx.clone();
        servers.push(
            axum::serve(listener, app.clone().into_make_service())
                .with_graceful_shutdown(async move {
                    _ = shutdown_rx.wait_for(|stop| *stop).await;
                })
                .into_future(),
        );
    }
    tokio::spawn(async move {
        shutdown_signal().await;
        _ = shutdown_tx.send(true);
    });
    futures::future::try_join_all(servers).await?;

    log::info!("Report server stopped");
    Ok(())
}

fn report_server_bind_addrs(
    addr: &str,
    port: u16,
    ipv6_enabled: bool,
) -> Result<Vec<SocketAddr>, anyhow::Error> {
    if ipv6_enabled {
        // `::1` alone would refuse the IPv4 loopback clients the default URL resolves to
        if let Ok(std::net::IpAddr::V4(ip)) = addr.parse::<std::net::IpAddr>()
            && ip.is_loopback()
        {
            return Ok(vec![
                SocketAddr::new(ip.into(), port),
                SocketAddr::new(std::net::Ipv6Addr::LOCALHOST.into(), port),
            ]);
        }
        return Ok(vec![SocketAddr::new(
            report_server_ipv6_bind_addr(addr).into(),
            port,
        )]);
    }
    let ip = if addr.is_empty() { "0.0.0.0" } else { addr };
    Ok(vec![format!("{ip}:{port}").parse()?])
}

/// An IPv4 loopback bind stays on loopback (`::1`); any other non-IPv6 value falls back to `::`.
fn report_server_ipv6_bind_addr(addr: &str) -> std::net::Ipv6Addr {
    if addr.is_empty() {
        return std::net::Ipv6Addr::UNSPECIFIED;
    }
    match addr.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V6(ip)) => ip,
        Ok(std::net::IpAddr::V4(ip)) if ip.is_loopback() => std::net::Ipv6Addr::LOCALHOST,
        _ => {
            log::warn!("ZO_REPORT_SERVER_HTTP_ADDR '{addr}' is not a valid IPv6 address; using ::");
            std::net::Ipv6Addr::UNSPECIFIED
        }
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        let mut sigquit = signal(SignalKind::quit()).unwrap();
        let mut sigterm = signal(SignalKind::terminate()).unwrap();
        let mut sigint = signal(SignalKind::interrupt()).unwrap();

        tokio::select! {
            _ = sigquit.recv() =>  log::info!("SIGQUIT received"),
            _ = sigterm.recv() =>  log::info!("SIGTERM received"),
            _ = sigint.recv() =>   log::info!("SIGINT received"),
        }
    }

    #[cfg(not(unix))]
    {
        use tokio::signal::windows::*;

        let mut sigbreak = ctrl_break().unwrap();
        let mut sigint = ctrl_c().unwrap();
        let mut sigquit = ctrl_close().unwrap();
        let mut sigterm = ctrl_shutdown().unwrap();

        tokio::select! {
            _ = sigbreak.recv() =>  log::info!("ctrl-break received"),
            _ = sigquit.recv() =>  log::info!("ctrl-c received"),
            _ = sigterm.recv() =>  log::info!("ctrl-close received"),
            _ = sigint.recv() =>   log::info!("ctrl-shutdown received"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn connects(addr: SocketAddr) -> bool {
        tokio::net::TcpStream::connect(addr).await.is_ok()
    }

    async fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    #[tokio::test]
    async fn an_ipv6_listener_on_the_loopback_default_serves_both_loopbacks() {
        let port = free_port().await;
        let addrs = report_server_bind_addrs("127.0.0.1", port, true).unwrap();
        let mut listeners = Vec::new();
        for addr in &addrs {
            listeners.push(TcpListener::bind(addr).await.unwrap());
        }
        assert!(
            connects(SocketAddr::from(([127, 0, 0, 1], port))).await,
            "{addrs:?}"
        );
        assert!(
            connects(SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, port))).await,
            "{addrs:?}"
        );
        assert!(addrs.iter().all(|a| a.ip().is_loopback()), "{addrs:?}");
    }

    #[test]
    fn a_non_loopback_addr_keeps_its_single_bind() {
        assert_eq!(
            report_server_bind_addrs("0.0.0.0", 5082, true).unwrap(),
            vec![SocketAddr::from((std::net::Ipv6Addr::UNSPECIFIED, 5082))]
        );
        assert_eq!(
            report_server_bind_addrs("10.1.2.3", 5082, false).unwrap(),
            vec![SocketAddr::from(([10, 1, 2, 3], 5082))]
        );
        assert_eq!(
            report_server_bind_addrs("", 5082, false).unwrap(),
            vec![SocketAddr::from(([0, 0, 0, 0], 5082))]
        );
        assert_eq!(
            report_server_bind_addrs("127.0.0.1", 5082, false).unwrap(),
            vec![SocketAddr::from(([127, 0, 0, 1], 5082))]
        );
    }

    #[test]
    fn test_ipv6_bind_addr_empty_falls_back_to_unspecified() {
        assert_eq!(
            report_server_ipv6_bind_addr(""),
            std::net::Ipv6Addr::UNSPECIFIED
        );
    }

    #[test]
    fn test_ipv6_bind_addr_ipv4_loopback_default_maps_to_ipv6_loopback() {
        assert_eq!(
            report_server_ipv6_bind_addr("127.0.0.1"),
            std::net::Ipv6Addr::LOCALHOST
        );
    }

    #[test]
    fn test_ipv6_bind_addr_other_ipv4_falls_back_to_unspecified() {
        assert_eq!(
            report_server_ipv6_bind_addr("0.0.0.0"),
            std::net::Ipv6Addr::UNSPECIFIED
        );
    }

    #[test]
    fn test_ipv6_bind_addr_respects_a_configured_ipv6_literal() {
        assert_eq!(
            report_server_ipv6_bind_addr("::1"),
            std::net::Ipv6Addr::LOCALHOST
        );
    }
}
