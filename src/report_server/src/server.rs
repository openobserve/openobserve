use std::net::SocketAddr;

use actix_web::{App, HttpServer, dev::ServerHandle, middleware, web};

use crate::router::{healthz, send_report};

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
        format!("[::]:{}", cfg.report_server.port).parse()?
    } else {
        let ip = if !cfg.report_server.addr.is_empty() {
            cfg.report_server.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, cfg.report_server.port).parse()?
    };
    log::info!("starting Report server at: {haddr}");
    let server = HttpServer::new(move || {
        App::new()
            .service(web::scope("/api").service(send_report).service(healthz))
            .wrap(middleware::Logger::new(
                r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
            ))
    })
    .bind(haddr)?
    .run();

    let handle = server.handle();
    tokio::task::spawn(graceful_shutdown(handle));
    server.await?;
    log::info!("Report server stopped");
    Ok(())
}

async fn graceful_shutdown(handle: ServerHandle) {
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
    // tokio::signal::ctrl_c().await.unwrap();
    // println!("ctrl-c received!");

    handle.stop(true).await;
}
