// Copyright 2023 Zinc Labs Inc.
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

use std::rc::Rc;

use actix_cors::Cors;
use actix_web::{
    body::MessageBody,
    dev::{Service, ServiceResponse},
    http::header,
    web, HttpRequest, HttpResponse,
};
use actix_web_httpauth::middleware::HttpAuthentication;
use actix_web_lab::middleware::from_fn;
use config::CONFIG;
use futures::FutureExt;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use super::{
    auth::validator::{validator_aws, validator_gcp, validator_proxy_url, validator_rum},
    request::{
        dashboards::{folders::*, *},
        enrichment_table, functions, kv, logs, metrics, organization, prom, rum, search, status,
        stream, syslog, traces, users, *,
    },
};
use crate::common::meta::{middleware_data::RumExtraData, proxy::PathParamProxyURL};

pub mod openapi;
pub mod ui;

#[cfg(feature = "enterprise")]
fn get_cors() -> Rc<Cors> {
    let cors = Cors::default()
        .allowed_methods(vec!["HEAD", "GET", "POST", "PUT", "OPTIONS", "DELETE"])
        .allowed_headers(vec![
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
        ])
        .allow_any_origin()
        .supports_credentials()
        .max_age(3600);
    Rc::new(cors)
}

/// #[cfg(not(feature = "enterprise"))]
#[cfg(not(feature = "enterprise"))]
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
            .wrap(cors.clone())
            .service(users::authentication),
    );

    cfg.service(
        web::scope("/node")
            .wrap(HttpAuthentication::with_fn(
                super::auth::validator::oo_validator,
            ))
            .wrap(cors)
            .service(status::cache_status)
            .service(status::enable_node)
            .service(status::flush_node),
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

#[cfg(not(feature = "enterprise"))]
pub fn get_config_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    cfg.service(web::scope("/config").wrap(cors).service(status::zo_config));
}

#[cfg(feature = "enterprise")]
pub fn get_config_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();
    cfg.service(
        web::scope("/config")
            .wrap(cors)
            .service(status::zo_config)
            .service(status::redirect)
            .service(status::dex_login)
            .service(status::refresh_token_with_dex),
    );
}

pub fn get_service_routes(cfg: &mut web::ServiceConfig) {
    let cors = get_cors();

    cfg.service(
        web::scope("/api")
            .wrap(HttpAuthentication::with_fn(
                super::auth::validator::oo_validator,
            ))
            .wrap(cors.clone())
            .service(users::list)
            .service(users::save)
            .service(users::delete)
            .service(users::update)
            .service(users::add_user_to_org)
            .service(organization::org::organizations)
            .service(organization::settings::get)
            .service(organization::settings::create)
            .service(organization::org::org_summary)
            .service(organization::org::get_user_passcode)
            .service(organization::org::update_user_passcode)
            .service(organization::org::create_user_rumtoken)
            .service(organization::org::get_user_rumtoken)
            .service(organization::org::update_user_rumtoken)
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
            .service(search::search_partition)
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
            .service(alerts::update_alert)
            .service(alerts::get_alert)
            .service(alerts::list_alerts)
            .service(alerts::list_stream_alerts)
            .service(alerts::delete_alert)
            .service(alerts::enable_alert)
            .service(alerts::trigger_alert)
            .service(alerts::templates::save_template)
            .service(alerts::templates::update_template)
            .service(alerts::templates::get_template)
            .service(alerts::templates::delete_template)
            .service(alerts::templates::list_templates)
            .service(alerts::destinations::save_destination)
            .service(alerts::destinations::update_destination)
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
            .service(syslog::toggle_state)
            .service(enrichment_table::save_enrichment_table)
            .service(metrics::ingest::otlp_metrics_write)
            .service(logs::ingest::otlp_logs_write)
            .service(traces::otlp_traces_write)
            .service(create_folder)
            .service(list_folders)
            .service(update_folder)
            .service(get_folder)
            .service(delete_folder)
            .service(move_dashboard)
            .service(traces::get_latest_traces)
            .service(logs::ingest::multi)
            .service(logs::ingest::json)
            .service(logs::ingest::handle_kinesis_request)
            .service(logs::ingest::handle_gcp_request)
            .service(organization::org::create_org)
            .service(authz::fga::create_role)
            .service(authz::fga::get_roles)
            .service(authz::fga::update_role)
            .service(authz::fga::get_role_permissions)
            .service(authz::fga::create_group)
            .service(authz::fga::update_group)
            .service(authz::fga::get_groups)
            .service(authz::fga::get_group_details)
            .service(authz::fga::get_resources)
            .service(authz::fga::get_users_with_role)
            .service(authz::fga::delete_role)
            .service(authz::fga::delete_group)
            .service(users::list_roles)
            .service(search::multi_streams::search_multi)
            .service(search::multi_streams::_search_partition_multi),
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

    // NOTE: Here the order of middlewares matter. Once we consume the api-token in
    // `rum_auth`, we drop it in the RumExtraData data.
    // https://docs.rs/actix-web/latest/actix_web/middleware/index.html#ordering
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
