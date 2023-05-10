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
use opentelemetry::sdk::propagation::TraceContextPropagator;
use opentelemetry::sdk::{trace as sdktrace, Resource};
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_proto::tonic::collector::trace::v1::trace_service_server::TraceServiceServer;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tonic::codec::CompressionEncoding;
use tracing_subscriber::prelude::*;
use tracing_subscriber::Registry;
use zincobserve::handler::grpc::auth::check_auth;
use zincobserve::handler::grpc::cluster_rpc::event_server::EventServer;
use zincobserve::handler::grpc::cluster_rpc::search_server::SearchServer;
use zincobserve::handler::grpc::request::{event::Eventer, search::Searcher, traces::TraceServer};
use zincobserve::handler::http::router::{
    get_basic_routes, get_other_service_routes, get_service_routes,
};
use zincobserve::infra::cluster;
use zincobserve::infra::config::{self, CONFIG};
use zincobserve::infra::file_lock;
use zincobserve::infra::metrics;
use zincobserve::meta::telemetry::Telemetry;
use zincobserve::service::db;
use zincobserve::service::router;
use zincobserve::service::users;

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    if cli().await? {
        return Ok(());
    }
    let _guard;
    if CONFIG.common.tracing_enabled {
        let service_name = format!("zo-{}", CONFIG.common.instance_name);
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
                KeyValue::new("service.name", service_name),
                KeyValue::new("deployment_type", "k8s"),
            ])))
            .install_batch(opentelemetry::runtime::Tokio)?;

        Registry::default()
            .with(tracing_subscriber::EnvFilter::new(&CONFIG.log.level))
            .with(tracing_subscriber::fmt::layer())
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .init();
    } else if CONFIG.common.sentry_enabled {
        let mut log_builder = env_logger::builder();
        log_builder.parse_filters(&CONFIG.log.level);
        log::set_boxed_logger(Box::new(
            sentry::integrations::log::SentryLogger::with_dest(log_builder.build()),
        ))
        .unwrap();
        log::set_max_level(log::LevelFilter::Debug);
        _guard = sentry::init(CONFIG.common.sentry_url.clone());
    } else {
        env_logger::init_from_env(env_logger::Env::new().default_filter_or(&CONFIG.log.level));
    }
    log::info!("Starting ZincObserve {}", config::VERSION);

    // init jobs
    // it must be initialized before the server starts
    let (tx, rx) = oneshot::channel();
    tokio::task::spawn(async move {
        cluster::register_and_keepalive()
            .await
            .expect("cluster init failed");
        zincobserve::job::init().await.expect("job init failed");
        tx.send(true).unwrap();
    });

    // gRPC server
    rx.await?;
    if !router::is_router() {
        let gaddr: SocketAddr = format!("0.0.0.0:{}", CONFIG.grpc.port).parse()?;
        let searcher = Searcher::default();
        let search_svc = SearchServer::new(searcher)
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip);
        let eventer = Eventer::default();
        let event_svc = EventServer::new(eventer)
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip);
        let tracer = TraceServer::default();
        let trace_svc = TraceServiceServer::new(tracer);

        tokio::task::spawn(async move {
            log::info!("starting gRPC server at {}", gaddr);
            tonic::transport::Server::builder()
                .layer(tonic::service::interceptor(check_auth))
                .add_service(search_svc)
                .add_service(event_svc)
                .add_service(trace_svc)
                .serve(gaddr)
                .await
                .expect("gRPC server init failed");
        });
    }

    // let node online
    let _ = cluster::set_online().await;

    // metrics
    let prometheus = metrics::create_prometheus_handler();

    // HTTP server
    let thread_id = Arc::new(AtomicU8::new(0));
    let haddr: SocketAddr = format!("0.0.0.0:{}", CONFIG.http.port).parse()?;
    Telemetry::new()
        .event("ZincObserve - Starting server", None, false)
        .await;
    if router::is_router() {
        HttpServer::new(move || {
            log::info!("starting HTTP server at: {}", haddr);
            let app = if CONFIG.common.base_uri.is_empty() {
                App::new()
                    .wrap(prometheus.clone())
                    .service(router::api)
                    .service(router::aws)
                    .configure(get_basic_routes)
            } else {
                App::new().wrap(prometheus.clone()).service(
                    web::scope(&CONFIG.common.base_uri)
                        .service(router::api)
                        .service(router::aws)
                        .configure(get_basic_routes),
                )
            };
            app.app_data(web::JsonConfig::default().limit(CONFIG.limit.req_json_limit))
                .app_data(web::PayloadConfig::new(CONFIG.limit.req_payload_limit)) // size is in bytes
                .app_data(web::Data::new(
                    awc::Client::builder()
                        .timeout(Duration::from_secs(CONFIG.route.timeout))
                        .finish(),
                ))
                .wrap(middleware::Compress::default())
                .wrap(middleware::Logger::new(
                    r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
                ))
                .wrap(RequestTracing::new())
        })
        .bind(haddr)?
        .run()
        .await?;
    } else {
        HttpServer::new(move || {
            let local_id = thread_id.load(Ordering::SeqCst) as usize;
            if CONFIG.common.feature_per_thread_lock {
                thread_id.fetch_add(1, Ordering::SeqCst);
            }
            log::info!(
                "starting HTTP server at: {}, thread_id: {}",
                haddr,
                local_id
            );

            let app = if CONFIG.common.base_uri.is_empty() {
                App::new()
                    .wrap(prometheus.clone())
                    .configure(get_service_routes)
                    .configure(get_other_service_routes)
                    .configure(get_basic_routes)
            } else {
                App::new().wrap(prometheus.clone()).service(
                    web::scope(&CONFIG.common.base_uri)
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
        .bind(haddr)?
        .run()
        .await?;
    };
    Telemetry::new()
        .event("ZincObserve - Server stopped", None, false)
        .await;
    // leave the cluster
    let _ = cluster::leave().await;
    // flush WAL cache to disk
    file_lock::flush_all();

    log::info!("server stopped");

    Ok(())
}

async fn cli() -> Result<bool, anyhow::Error> {
    let app = clap::Command::new("zincobserve")
        .version(env!("GIT_VERSION"))
        .about(clap::crate_description!())
        .subcommands(&[
            clap::Command::new("reset")
                .about("reset zincobserve data")
                .arg(
                    clap::Arg::new("component")
                        .short('c')
                        .long("component")
                        .help(
                            "reset data of the component: root, user, alert, dashboard, function",
                        ),
                ),
            clap::Command::new("view")
                .about("view zincobserve data")
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
                        zincobserve::meta::organization::DEFAULT_ORG,
                        zincobserve::meta::user::UserRequest {
                            email: CONFIG.auth.root_user_email.clone(),
                            password: CONFIG.auth.root_user_password.clone(),
                            role: zincobserve::meta::user::UserRole::Root,
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
