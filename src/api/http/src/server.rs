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

use std::{cmp::max, net::SocketAddr, time::Duration};

use tower_http::{compression::CompressionLayer, trace::TraceLayer};

use crate::handler::http::router::create_app_router;

/// Run the primary HTTP frontend.
///
/// The UI route factory remains supplied by the binary so the API crate does
/// not depend on the web crate.
pub async fn run(ui_routes: fn() -> axum::Router) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    let haddr = server_addr()?;
    log::info!(
        "Starting {} server at: {haddr}",
        if cfg.http.tls_enabled {
            "HTTPS"
        } else {
            "HTTP"
        }
    );

    let app = apply_common_middlewares(create_app_router(ui_routes)).layer(CompressionLayer::new());
    let app = if !cfg.common.tracing_enabled
        && (cfg.common.tracing_search_enabled || cfg.common.search_inspector_enabled)
    {
        app
    } else {
        app.layer(TraceLayer::new_for_http())
    };

    serve(haddr, app).await
}

/// Resolve the HTTP listen address from config.
pub fn server_addr() -> Result<SocketAddr, anyhow::Error> {
    let cfg = config::get_config();
    let haddr = if cfg.http.ipv6_enabled {
        format!("[::]:{}", cfg.http.port).parse()?
    } else {
        let ip = if !cfg.http.addr.is_empty() {
            cfg.http.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, cfg.http.port).parse()?
    };
    Ok(haddr)
}

/// Apply access logging, slow logging and client IP resolution.
pub fn apply_common_middlewares(app: axum::Router) -> axum::Router {
    let cfg = config::get_config();
    let ip_sources = config::axum::middlewares::resolve_client_ip_sources(&cfg.http.real_ip_source);
    log::info!(
        "HTTP client IP sources (in order, implicit ConnectInfo fallback): {}",
        cfg.http.real_ip_source
    );
    app.layer(config::axum::middlewares::AccessLogLayer::new(
        config::axum::middlewares::get_http_access_log_format(),
    ))
    .layer(config::axum::middlewares::SlowLogLayer::new(
        cfg.limit.http_slow_log_threshold,
    ))
    .layer(axum::middleware::from_fn(
        config::axum::middlewares::extract_real_ip,
    ))
    .layer(axum::Extension(ip_sources))
}

/// Serve a router with the configured TLS and bounded graceful shutdown.
pub async fn serve(haddr: SocketAddr, app: axum::Router) -> Result<(), anyhow::Error> {
    let cfg = config::get_config();
    let handle = axum_server::Handle::new();
    let shutdown_timeout = cfg.limit.http_shutdown_timeout;

    tokio::spawn({
        let handle = handle.clone();
        async move {
            shutdown_signal().await;
            handle.graceful_shutdown(Some(Duration::from_secs(max(1, shutdown_timeout))));
        }
    });

    let service = app.into_make_service_with_connect_info::<SocketAddr>();
    if cfg.http.tls_enabled {
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(
            &cfg.http.tls_cert_path,
            &cfg.http.tls_key_path,
        )
        .await?;
        axum_server::bind_rustls(haddr, tls_config)
            .handle(handle)
            .serve(service)
            .await?;
    } else {
        axum_server::bind(haddr)
            .handle(handle)
            .serve(service)
            .await?;
    }

    Ok(())
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

    if let Err(e) = common::infra::cluster::set_offline().await {
        log::error!("set offline failed: {e}");
    }
    log::info!("Node is offline");
}
