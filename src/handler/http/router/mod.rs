// Copyright 2023 Zinc Labs Inc.
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

use actix_cors::Cors;
use actix_web::{
    body::MessageBody,
    dev::{Service, ServiceResponse},
    http::header,
    web, HttpRequest, HttpResponse,
};
use actix_web_httpauth::middleware::HttpAuthentication;
use futures::FutureExt;
use std::rc::Rc;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use super::auth::{validator, validator_aws, validator_gcp, validator_proxy_url, validator_rum};
use super::request::{
    alerts, dashboards, enrichment_table, functions, kv, logs, metrics, organization, prom, rum,
    search, status, stream, syslog, traces, users,
};
use crate::common::{
    infra::config::CONFIG,
    meta::{middleware_data::RumExtraData, proxy::PathParamProxyURL},
};
use actix_web_lab::middleware::from_fn;
pub mod openapi;
pub mod ui;

fn get_cors() -> Rc<Cors> {
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
    Rc::new(cors)
}

/// This is a very trivial proxy to overcome the cors errors while
/// session-replay in rrweb.
pub fn get_proxy_routes(cfg: &mut web::ServiceConfig) {
    let auth = HttpAuthentication::with_fn(validator_proxy_url);
    let cors = Cors::default()
        .allow_any_origin()
        .allow_any_method()
        .allow_any_header();

    cfg.service(
        web::resource("/proxy/{org_id}/{target_url:.*}")
            .wrap(auth)
            .wrap(cors)
            .route(web::get().to(proxy)),
    );
}

async fn proxy(
    path: web::Path<PathParamProxyURL>,
    req: HttpRequest,
) -> actix_web::Result<HttpResponse> {
    let client = reqwest::Client::new();
    let method = req.method().clone();
    let forwarded_resp = client
        .request(method, &path.target_url)
        .send()
        .await
        .map_err(|e| {
            actix_web::error::ErrorInternalServerError(format!("Request failed: {}", e))
        })?;

    let status = forwarded_resp.status().as_u16();
    let body = forwarded_resp.bytes().await.map_err(|e| {
        actix_web::error::ErrorInternalServerError(format!("Failed to read the response: {}", e))
    })?;

    Ok(HttpResponse::build(actix_web::http::StatusCode::from_u16(status).unwrap()).body(body))
}

pub fn get_basic_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    cfg.service(status::healthz);
    cfg.service(
        web::scope("/auth")
            .wrap(cors)
            .service(users::authentication),
    );

    cfg.service(
        SwaggerUi::new("/swagger/{_:.*}")
            .url(
                format!("{}/api-doc/openapi.json", CONFIG.common.base_uri),
                openapi::ApiDoc::openapi(),
            )
            .url("/api-doc/openapi.json", openapi::ApiDoc::openapi()),
    );
    cfg.service(web::redirect("/swagger", "/swagger/"));
    cfg.service(web::redirect("/docs", "/swagger/"));

    if CONFIG.common.ui_enabled {
        cfg.service(web::redirect("/", "./web/"));
        cfg.service(web::redirect("/web", "./web/"));
        cfg.service(
            web::scope("/web")
                .wrap_fn(|req, srv| {
                    let prefix = format!("{}/web/", CONFIG.common.base_uri);
                    let path = req.path().strip_prefix(&prefix).unwrap().to_string();

                    srv.call(req).map(move |res| {
                        if path.starts_with("src/")
                            || path.starts_with("assets/")
                            || path.starts_with("monacoeditorwork/")
                            || path.eq("favicon.ico")
                        {
                            res
                        } else {
                            let res = res.unwrap();
                            let req = res.request().clone();
                            let body = res.into_body();
                            let body = body.try_into_bytes().unwrap();
                            let body = String::from_utf8(body.to_vec()).unwrap();
                            let body = body.replace(
                                r#"<base href="/" />"#,
                                &format!(r#"<base href="{prefix}" />"#),
                            );
                            Ok(ServiceResponse::new(
                                req,
                                HttpResponse::Ok()
                                    .content_type(header::ContentType::html())
                                    .body(body),
                            ))
                        }
                    })
                })
                .service(ui::serve),
        );
    }
}

pub fn get_config_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    cfg.service(web::scope("/config").wrap(cors).service(status::zo_config));
}

pub fn get_service_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    let auth = HttpAuthentication::basic(validator);
    cfg.service(
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(status::cache_status)
            .service(users::list)
            .service(users::save)
            .service(users::delete)
            .service(users::update)
            .service(users::add_user_to_org)
            .service(organization::organizations)
            .service(organization::settings::get)
            .service(organization::settings::create)
            .service(organization::org_summary)
            .service(organization::get_user_passcode)
            .service(organization::update_user_passcode)
            .service(organization::create_user_rumtoken)
            .service(organization::get_user_rumtoken)
            .service(organization::update_user_rumtoken)
            .service(organization::es::org_index)
            .service(organization::es::org_license)
            .service(organization::es::org_xpack)
            .service(organization::es::org_index_template)
            .service(organization::es::org_index_template_create)
            .service(organization::es::org_data_stream)
            .service(organization::es::org_data_stream_create)
            .service(stream::schema)
            .service(stream::settings)
            .service(stream::delete_fields)
            .service(stream::delete)
            .service(stream::list)
            .service(logs::ingest::bulk)
            .service(logs::ingest::multi)
            .service(logs::ingest::json)
            .service(logs::ingest::otlp_logs_write)
            .service(traces::traces_write)
            .service(traces::otlp_traces_write)
            .service(traces::get_latest_traces)
            .service(metrics::ingest::json)
            .service(metrics::ingest::otlp_metrics_write)
            .service(prom::remote_write)
            .service(prom::query_get)
            .service(prom::query_post)
            .service(prom::query_range_get)
            .service(prom::query_range_post)
            .service(prom::metadata)
            .service(prom::series_get)
            .service(prom::series_post)
            .service(prom::labels_get)
            .service(prom::labels_post)
            .service(prom::label_values)
            .service(prom::format_query_get)
            .service(prom::format_query_post)
            .service(enrichment_table::save_enrichment_table)
            .service(search::search)
            .service(search::around)
            .service(search::values)
            .service(search::saved_view::create_view)
            .service(search::saved_view::update_view)
            .service(search::saved_view::get_view)
            .service(search::saved_view::get_views)
            .service(search::saved_view::delete_view)
            .service(functions::save_function)
            .service(functions::list_functions)
            .service(functions::delete_function)
            .service(functions::update_function)
            .service(functions::add_function_to_stream)
            .service(functions::list_stream_functions)
            .service(functions::delete_stream_function)
            .service(dashboards::create_dashboard)
            .service(dashboards::update_dashboard)
            .service(dashboards::list_dashboards)
            .service(dashboards::get_dashboard)
            .service(dashboards::delete_dashboard)
            .service(dashboards::move_dashboard)
            .service(dashboards::folders::create_folder)
            .service(dashboards::folders::list_folders)
            .service(dashboards::folders::update_folder)
            .service(dashboards::folders::get_folder)
            .service(dashboards::folders::delete_folder)
            .service(alerts::save_alert)
            .service(alerts::get_alert)
            .service(alerts::list_alerts)
            .service(alerts::trigger_alert)
            .service(alerts::list_stream_alerts)
            .service(alerts::delete_alert)
            .service(alerts::enable_alert)
            .service(alerts::templates::save_template)
            .service(alerts::templates::get_template)
            .service(alerts::templates::delete_template)
            .service(alerts::templates::list_templates)
            .service(alerts::destinations::save_destination)
            .service(alerts::destinations::get_destination)
            .service(alerts::destinations::list_destinations)
            .service(alerts::destinations::delete_destination)
            .service(kv::get)
            .service(kv::set)
            .service(kv::delete)
            .service(kv::list)
            .service(syslog::list_routes)
            .service(syslog::create_route)
            .service(syslog::delete_route)
            .service(syslog::update_route)
            .service(syslog::toggle_state),
    );
}

pub fn get_other_service_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    let amz_auth = HttpAuthentication::with_fn(validator_aws);
    cfg.service(
        web::scope("/aws")
            .wrap(cors.clone())
            .wrap(amz_auth)
            .service(logs::ingest::handle_kinesis_request),
    );

    let gcp_auth = HttpAuthentication::with_fn(validator_gcp);
    cfg.service(
        web::scope("/gcp")
            .wrap(cors.clone())
            .wrap(gcp_auth)
            .service(logs::ingest::handle_gcp_request),
    );

    //NOTE: Here the order of middlewares matter. Once we consume the api-token in `rum_auth`,
    //we drop it in the RumExtraData data.
    //https://docs.rs/actix-web/latest/actix_web/middleware/index.html#ordering
    let rum_auth = HttpAuthentication::with_fn(validator_rum);
    cfg.service(
        web::scope("/rum")
            .wrap(cors)
            .wrap(from_fn(RumExtraData::extractor))
            .wrap(rum_auth)
            .service(rum::ingest::log)
            .service(rum::ingest::sessionreplay)
            .service(rum::ingest::data),
    );
}
