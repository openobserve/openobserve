use std::net::SocketAddr;

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

    let haddr: SocketAddr = if cfg.report_server.ipv6_enabled {
        SocketAddr::new(
            report_server_ipv6_bind_addr(&cfg.report_server.addr).into(),
            cfg.report_server.port,
        )
    } else {
        let ip = if !cfg.report_server.addr.is_empty() {
            cfg.report_server.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, cfg.report_server.port).parse()?
    };
    log::info!("starting Report server at: {haddr}");

    // Create the axum router
    let app = create_router();

    // Bind and serve
    let listener = TcpListener::bind(haddr).await?;
    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    log::info!("Report server stopped");
    Ok(())
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
