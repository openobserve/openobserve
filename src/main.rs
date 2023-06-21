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

use actix_web::{middleware, web, App, HttpServer};
use actix_web_opentelemetry::RequestTracing;
use log::LevelFilter;
use opentelemetry::{
    sdk::{propagation::TraceContextPropagator, trace as sdktrace, Resource},
    KeyValue,
};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_proto::tonic::collector::trace::v1::trace_service_server::TraceServiceServer;
use std::{
    collections::HashMap,
    net::SocketAddr,
    str::FromStr,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
};
use tokio::sync::oneshot;
use tonic::codec::CompressionEncoding;
use tracing_subscriber::{prelude::*, Registry};

use openobserve::{
    common::zo_logger::{self, ZoLogger, EVENT_SENDER},
    handler::{
        grpc::{
            auth::check_auth,
            cluster_rpc::{
                event_server::EventServer, metrics_server::MetricsServer,
                search_server::SearchServer,
            },
            request::{event::Eventer, metrics::Querier, search::Searcher, traces::TraceServer},
        },
        http::router::*,
    },
    infra::{
        cluster,
        config::{self, CONFIG},
        metrics, wal,
    },
    job, meta,
    service::{db, router, users},
};

#[cfg(feature = "profiling")]
use pyroscope::PyroscopeAgent;
#[cfg(feature = "profiling")]
use pyroscope_pprofrs::{pprof_backend, PprofConfig};

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(feature = "jemalloc")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    #[cfg(feature = "profiling")]
    let agent = PyroscopeAgent::builder(
        &CONFIG.profiling.pyroscope_server_url,
        &CONFIG.profiling.pyroscope_project_name,
    )
    .tags([("Host", "Rust")].to_vec())
    .backend(pprof_backend(PprofConfig::new().sample_rate(100)))
    .build()
    .expect("Failed to setup pyroscope agent");
    #[cfg(feature = "profiling")]
    let agent_running = agent.start().expect("Failed to start pyroscope agent");

    if cli().await? {
        return Ok(());
    }

    if CONFIG.log.events_enabled {
        let logger = ZoLogger {
            sender: EVENT_SENDER.clone(),
        };
        log::set_boxed_logger(Box::new(logger)).map(|()| {
            log::set_max_level(
                LevelFilter::from_str(&CONFIG.log.level).unwrap_or(LevelFilter::Info),
            )
        })?;
    } else if CONFIG.common.tracing_enabled {
        enable_tracing()?;
    } else {
        env_logger::init_from_env(env_logger::Env::new().default_filter_or(&CONFIG.log.level));
    }
    log::info!("Starting OpenObserve {}", config::VERSION);

    // init jobs
    // it must be initialized before the server starts
    let (tx, rx) = oneshot::channel();
    tokio::task::spawn(async move {
        cluster::register_and_keepalive()
            .await
            .expect("cluster init failed");
        job::init().await.expect("job init failed");
        tx.send(true).unwrap();
    });

    // gRPC server
    rx.await?;
    if !cluster::is_router(&cluster::LOCAL_NODE_ROLE) {
        init_grpc_server()?;
    }

    // let node online
    let _ = cluster::set_online().await;

    //This is specifically for enrichment tables,as caching is happening using search service
    db::schema::cache().await.expect("schema cache failed");

    // metrics
    let prometheus = metrics::create_prometheus_handler();

    // HTTP server
    let thread_id = Arc::new(AtomicU8::new(0));
    let haddr: SocketAddr = format!("0.0.0.0:{}", CONFIG.http.port).parse()?;
    meta::telemetry::Telemetry::new()
        .event("OpenObserve - Starting server", None, false)
        .await;

    let server = HttpServer::new(move || {
        let local_id = thread_id.load(Ordering::SeqCst) as usize;
        if CONFIG.common.feature_per_thread_lock {
            thread_id.fetch_add(1, Ordering::SeqCst);
        }
        log::info!(
            "starting HTTP server at: {}, thread_id: {}",
            haddr,
            local_id
        );
        let app = if cluster::is_router(&cluster::LOCAL_NODE_ROLE) {
            if CONFIG.common.base_uri.is_empty() {
                App::new()
                    .wrap(prometheus.clone())
                    .service(router::config)
                    .service(router::api)
                    .service(router::aws)
                    .configure(get_basic_routes)
            } else {
                App::new().wrap(prometheus.clone()).service(
                    web::scope(&CONFIG.common.base_uri)
                        .service(router::config)
                        .service(router::api)
                        .service(router::aws)
                        .configure(get_basic_routes),
                )
            }
        } else if CONFIG.common.base_uri.is_empty() {
            App::new()
                .wrap(prometheus.clone())
                .configure(get_config_routes)
                .configure(get_service_routes)
                .configure(get_other_service_routes)
                .configure(get_basic_routes)
        } else {
            App::new().wrap(prometheus.clone()).service(
                web::scope(&CONFIG.common.base_uri)
                    .configure(get_config_routes)
                    .configure(get_service_routes)
                    .configure(get_other_service_routes)
                    .configure(get_basic_routes),
            )
        };
        app.app_data(web::JsonConfig::default().limit(CONFIG.limit.req_json_limit))
            .app_data(web::PayloadConfig::new(CONFIG.limit.req_payload_limit)) // size is in bytes
            .app_data(web::Data::new(local_id))
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new(
                r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
            ))
            .wrap(RequestTracing::new())
    })
    .bind(haddr)?;

    tokio::task::spawn(async move { zo_logger::send_logs().await });

    server.workers(CONFIG.limit.http_worker_num).run().await?;

    // stop telemetry
    meta::telemetry::Telemetry::new()
        .event("OpenObserve - Server stopped", None, false)
        .await;
    // leave the cluster
    let _ = cluster::leave().await;
    // flush WAL cache to disk
    wal::flush_all_to_disk();

    log::info!("server stopped");

    #[cfg(feature = "profiling")]
    let agent_ready = agent_running.stop().unwrap();
    #[cfg(feature = "profiling")]
    agent_ready.shutdown();

    Ok(())
}

fn init_grpc_server() -> Result<(), anyhow::Error> {
    let gaddr: SocketAddr = format!("0.0.0.0:{}", CONFIG.grpc.port).parse()?;
    let event_svc = EventServer::new(Eventer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let search_svc = SearchServer::new(Searcher)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let metrics_svc = MetricsServer::new(Querier)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let tracer = TraceServer::default();
    let trace_svc = TraceServiceServer::new(tracer);

    tokio::task::spawn(async move {
        log::info!("starting gRPC server at {}", gaddr);
        tonic::transport::Server::builder()
            .layer(tonic::service::interceptor(check_auth))
            .add_service(event_svc)
            .add_service(search_svc)
            .add_service(metrics_svc)
            .add_service(trace_svc)
            .serve(gaddr)
            .await
            .expect("gRPC server init failed");
    });
    Ok(())
}

fn enable_tracing() -> Result<(), anyhow::Error> {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let mut headers = HashMap::new();
    headers.insert(
        CONFIG.common.tracing_header_key.clone(),
        CONFIG.common.tracing_header_value.clone(),
    );
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .http()
                .with_endpoint(&CONFIG.common.otel_otlp_url)
                .with_headers(headers),
        )
        .with_trace_config(sdktrace::config().with_resource(Resource::new(vec![
            KeyValue::new("instance_name", CONFIG.common.instance_name.as_str()),
            KeyValue::new("deployment_type", "k8s"),
        ])))
        .install_batch(opentelemetry::runtime::Tokio)?;

    Registry::default()
        .with(tracing_subscriber::EnvFilter::new(&CONFIG.log.level))
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .init();
    Ok(())
}

async fn cli() -> Result<bool, anyhow::Error> {
    let app = clap::Command::new("openobserve")
        .version(env!("GIT_VERSION"))
        .about(clap::crate_description!())
        .subcommands(&[
            clap::Command::new("reset")
                .about("reset openobserve data")
                .arg(
                    clap::Arg::new("component")
                        .short('c')
                        .long("component")
                        .help(
                            "reset data of the component: root, user, alert, dashboard, function",
                        ),
                ),
            clap::Command::new("view")
                .about("view openobserve data")
                .arg(
                    clap::Arg::new("component")
                        .short('c')
                        .long("component")
                        .help("view data of the component: version, user"),
                ),
        ])
        .get_matches();

    if app.subcommand().is_none() {
        return Ok(false);
    }

    let (name, command) = app.subcommand().unwrap();
    match name {
        "reset" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "root" => {
                    let _ = users::post_user(
                        meta::organization::DEFAULT_ORG,
                        meta::user::UserRequest {
                            email: CONFIG.auth.root_user_email.clone(),
                            password: CONFIG.auth.root_user_password.clone(),
                            role: meta::user::UserRole::Root,
                            first_name: "root".to_owned(),
                            last_name: "".to_owned(),
                        },
                    )
                    .await?;
                }
                "user" => {
                    db::user::reset().await?;
                }
                "alert" => {
                    db::alerts::reset().await?;
                }
                "dashboard" => {
                    db::dashboard::reset().await?;
                }
                "function" => {
                    db::functions::reset().await?;
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupport reset component: {}", component));
                }
            }
        }
        "view" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "version" => {
                    println!("version: {}", db::version::get().await?);
                }
                "user" => {
                    db::user::cache().await?;
                    let mut id = 0;
                    for user in config::USERS.iter() {
                        id += 1;
                        println!("{id}\t{:?}\n{:?}", user.key(), user.value());
                    }
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupport reset component: {component}"));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!("unsupport sub command: {name}"));
        }
    }

    println!("command {name} execute succeeded");

    Ok(true)
}
