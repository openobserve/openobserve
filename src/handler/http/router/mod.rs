use actix_cors::Cors;
use actix_web::{http::header, web};
use actix_web_httpauth::middleware::HttpAuthentication;
use std::sync::Arc;
use utoipa::OpenApi;
use utoipa_swagger_ui::{SwaggerUi, Url};

use super::auth::validator;
use super::request::alerts::*;
use super::request::dashboards::*;
#[cfg(feature = "zo_functions")]
use super::request::functions;
use super::request::health::{cache_status, healthz};
use super::request::ingest;
use super::request::organization::*;
use super::request::prom::*;
use super::request::search;
use super::request::stream;
use super::request::traces::*;
use super::request::users;
use crate::infra::config::CONFIG;

pub mod openapi;
pub mod ui;

pub fn get_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(healthz);

    let cors = Cors::default()
        .send_wildcard()
        .allowed_methods(vec!["HEAD", "GET", "POST", "PUT", "OPTIONS", "DELETE"])
        .allowed_headers(vec![
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
        ])
        .allow_any_origin()
        .max_age(3600);
    let cors = Arc::new(cors);

    cfg.service(
        web::scope("/auth")
            .wrap(cors.clone())
            .service(organizarions_by_username)
            .service(users::authentication),
    );

    #[cfg(feature = "zo_functions")]
    zo_apis_with_functions(cfg, cors);
    #[cfg(feature = "zo_functions")]
    cfg.service(SwaggerUi::new("/swagger/{_:.*}").urls(vec![(
        Url::new("api", "/api-doc/openapi.json"),
        openapi::ZoFnApiDoc::openapi(),
    )]));

    #[cfg(not(feature = "zo_functions"))]
    cfg.service(SwaggerUi::new("/swagger/{_:.*}").urls(vec![(
        Url::new("api", "/api-doc/openapi.json"),
        openapi::ApiDoc::openapi(),
    )]));
    #[cfg(not(feature = "zo_functions"))]
    zo_apis(cfg, cors);

    if CONFIG.common.ui_enabled {
        cfg.service(ui::serve);
    }
}

fn zo_apis(cfg: &mut web::ServiceConfig, cors: Arc<Cors>) {
    let auth = HttpAuthentication::basic(validator);
    cfg.service(
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(cache_status)
            .service(ingest::bulk)
            .service(ingest::multi)
            .service(ingest::json)
            .service(search::search)
            .service(search::around)
            .service(stream::schema)
            .service(stream::settings)
            .service(stream::list)
            .service(stream::org_index)
            .service(users::list)
            .service(users::save)
            .service(users::delete)
            .service(prometheus_write)
            .service(save_dashboard)
            .service(get_dashboard)
            .service(list_dashboards)
            .service(delete_dashboard)
            .service(traces_write)
            .service(organizations)
            .service(save_alert)
            .service(get_alert)
            .service(list_alerts)
            .service(list_stream_alerts)
            .service(delete_alert)
            .service(org_summary),
    );
}

#[cfg(feature = "zo_functions")]
fn zo_apis_with_functions(cfg: &mut web::ServiceConfig, cors: Arc<Cors>) {
    let auth = HttpAuthentication::basic(validator);
    cfg.service(
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(cache_status)
            .service(ingest::bulk)
            .service(ingest::multi)
            .service(ingest::json)
            .service(search::search)
            .service(search::around)
            .service(stream::schema)
            .service(stream::settings)
            .service(stream::list)
            .service(stream::org_index)
            .service(users::list)
            .service(users::save)
            .service(users::delete)
            .service(prometheus_write)
            .service(save_dashboard)
            .service(get_dashboard)
            .service(list_dashboards)
            .service(delete_dashboard)
            .service(traces_write)
            .service(organizations)
            .service(save_alert)
            .service(get_alert)
            .service(list_alerts)
            .service(list_stream_alerts)
            .service(delete_alert)
            .service(org_summary)
            .service(functions::save_function)
            .service(functions::list_functions)
            .service(functions::delete_function)
            .service(functions::save_stream_function)
            .service(functions::list_stream_function)
            .service(functions::delete_stream_function),
    );
}
