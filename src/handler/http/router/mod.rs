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

use actix_cors::Cors;
use actix_web::dev::{Service, ServiceResponse};
use actix_web::{body::MessageBody, http::header, web, HttpResponse};

use actix_web_httpauth::middleware::HttpAuthentication;
use futures::FutureExt;
use std::sync::Arc;
use utoipa::OpenApi;
use utoipa_swagger_ui::{SwaggerUi, Url};

use super::auth::{validator, validator_aws};
use super::request::alerts::*;
use super::request::dashboards::*;
use super::request::functions;
use super::request::kv;
use super::request::logs;
use super::request::organization;
use super::request::prom;
use super::request::search;
use super::request::status;
use super::request::stream;
use super::request::syslog;
use super::request::traces::*;
use super::request::users;
use crate::infra::config::CONFIG;

pub mod openapi;
pub mod ui;

pub fn get_basic_routes(cfg: &mut web::ServiceConfig) {
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

    cfg.service(status::healthz);
    cfg.service(
        web::scope("/auth")
            .wrap(cors.clone())
            .service(users::authentication),
    );
    cfg.service(web::scope("/config").wrap(cors).service(status::zo_config));

    cfg.service(SwaggerUi::new("/swagger/{_:.*}").urls(vec![(
        Url::new("api", "/api-doc/openapi.json"),
        openapi::ApiDoc::openapi(),
    )]));

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
                            Ok(ServiceResponse::new(req, HttpResponse::Ok().body(body)))
                        }
                    })
                })
                .service(ui::serve),
        );
    }
}

pub fn get_service_routes(cfg: &mut web::ServiceConfig) {
    let auth = HttpAuthentication::basic(validator);
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
        web::scope("/api")
            .wrap(auth)
            .wrap(cors)
            .service(logs::ingest::bulk)
            .service(logs::ingest::multi)
            .service(logs::ingest::json)
            .service(search::search)
            .service(search::around)
            .service(search::values)
            .service(stream::schema)
            .service(stream::settings)
            .service(stream::delete)
            .service(stream::list)
            .service(functions::save_function)
            .service(functions::list_functions)
            .service(functions::delete_function)
            .service(functions::update_function)
            .service(functions::add_function_to_stream)
            .service(functions::list_stream_functions)
            .service(functions::delete_stream_function)
            .service(users::list)
            .service(users::save)
            .service(users::delete)
            .service(users::add_user_to_org)
            .service(prom::remote_write)
            .service(prom::query)
            .service(prom::query_range)
            .service(prom::metadata)
            .service(prom::series)
            .service(prom::labels)
            .service(prom::values)
            .service(create_dashboard)
            .service(update_dashboard)
            .service(list_dashboards)
            .service(get_dashboard)
            .service(delete_dashboard)
            .service(traces_write)
            .service(save_alert)
            .service(get_alert)
            .service(list_alerts)
            .service(list_stream_alerts)
            .service(delete_alert)
            .service(organization::organizations)
            .service(organization::org_summary)
            .service(organization::get_user_passcode)
            .service(organization::update_user_passcode)
            .service(organization::es::org_index)
            .service(organization::es::org_license)
            .service(organization::es::org_xpack)
            .service(organization::es::org_index_template)
            .service(organization::es::org_index_template_create)
            .service(organization::es::org_data_stream)
            .service(organization::es::org_data_stream_create)
            .service(users::update)
            .service(templates::save_template)
            .service(templates::get_template)
            .service(templates::delete_template)
            .service(templates::list_templates)
            .service(destinations::save_destination)
            .service(destinations::get_destination)
            .service(destinations::list_destinations)
            .service(destinations::delete_destination)
            .service(kv::get)
            .service(kv::set)
            .service(kv::delete)
            .service(kv::list)
            .service(syslog::list_routes)
            .service(syslog::create_route)
            .service(syslog::delete_route)
            .service(syslog::update_route),
    );
}

pub fn get_other_service_routes(cfg: &mut web::ServiceConfig) {
    let amz_auth = HttpAuthentication::with_fn(validator_aws);
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
        web::scope("/aws")
            .wrap(cors)
            .wrap(amz_auth)
            .service(logs::ingest::handle_kinesis_request),
    );
}
