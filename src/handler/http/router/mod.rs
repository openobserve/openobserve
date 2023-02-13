use actix_cors::Cors;
use actix_web::{http::header, web};
use actix_web_httpauth::middleware::HttpAuthentication;
use std::sync::Arc;
use utoipa::OpenApi;
use utoipa_swagger_ui::{SwaggerUi, Url};

use super::auth::validator;
use super::request::alerts::*;
use super::request::dashboards::*;
use super::request::functions;
use super::request::ingest;
use super::request::organization::*;
use super::request::prom::*;
use super::request::search;
use super::request::status;
use super::request::stream;
use super::request::traces::*;
use super::request::users;
use crate::infra::config::CONFIG;

pub mod openapi;
pub mod ui;

pub fn get_routes(cfg: &mut web::ServiceConfig) {
    let auth = HttpAuthentication::basic(validator);
    cfg.service(status::healthz).service(status::versions);

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
    cfg.service(
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(status::cache_status)
            .service(ingest::bulk)
            .service(ingest::multi)
            .service(ingest::json)
            .service(search::search)
            .service(search::around)
            .service(stream::schema)
            .service(stream::settings)
            .service(stream::list)
            .service(stream::org_index)
            .service(functions::save_function)
            .service(functions::list_functions)
            .service(functions::delete_function)
            .service(functions::save_stream_function)
            .service(functions::list_stream_function)
            .service(functions::delete_stream_function)
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

    cfg.service(SwaggerUi::new("/swagger/{_:.*}").urls(vec![(
        Url::new("api", "/api-doc/openapi.json"),
        openapi::ApiDoc::openapi(),
    )]));

    if CONFIG.common.ui_enabled {
        cfg.service(ui::serve);
    }
}
