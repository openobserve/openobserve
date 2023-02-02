use actix_cors::Cors;
use actix_web::{http::header, web};
use actix_web_httpauth::middleware::HttpAuthentication;
use std::sync::Arc;
use utoipa::OpenApi;
use utoipa_swagger_ui::{SwaggerUi, Url};

use super::auth::validator;
use super::request::alerts::*;
use super::request::dashboards::*;
use super::request::document::data_ingest::*;
use super::request::functions::udf::*;
use super::request::health::{cache_status, healthz};
use super::request::organization::*;
use super::request::prom::*;
use super::request::search;
use super::request::stream::*;
use super::request::traces::*;
use super::request::users::*;
use crate::infra::config::CONFIG;
use crate::meta::ingestion::{IngestionResponse, StreamStatus};
use crate::meta::stream;
use crate::meta::StreamType;

pub mod ui;

pub fn get_routes(cfg: &mut web::ServiceConfig) {
    #[derive(OpenApi)]
    #[openapi(
        paths(list_streams, bulk_ingest, multi_ingest),
        components(schemas(
            stream::ListStream,
            stream::Stream,
            StreamType,
            stream::Stats,
            stream::StreamProperty,
            IngestionResponse,
            StreamStatus,
            //SearchResponse
        )),
        tags(
            (name = "Ingestion", description = "Todo management endpoints.")
        )
    )]
    struct ApiDoc;

    let auth = HttpAuthentication::basic(validator);
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
            .service(authentication),
    );
    cfg.service(
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(cache_status)
            .service(bulk_ingest)
            .service(multi_ingest)
            .service(json_ingest)
            .service(search::search)
            .service(search::around)
            .service(stream_schema)
            .service(stream_settings)
            .service(list_streams)
            .service(org_index)
            .service(save_function)
            .service(list_functions)
            .service(delete_function)
            .service(save_stream_function)
            .service(list_stream_function)
            .service(delete_stream_function)
            .service(list_users)
            .service(delete_user)
            .service(post_user)
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
            .service(delete_alert),
    );

    cfg.service(SwaggerUi::new("/swagger-ui/{_:.*}").urls(vec![(
        Url::new("api", "/api-doc/openapi1.json"),
        ApiDoc::openapi(),
    )]));

    if CONFIG.common.ui_enabled {
        cfg.service(ui::serve);
    }
}
