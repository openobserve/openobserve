// Copyright 2025 OpenObserve Inc.
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

use std::io::Error;

use actix_web::{HttpRequest, HttpResponse, Result, get, http, put, route, web};

#[route("/{org_id}/", method = "GET", method = "HEAD")]
async fn org_index(_org_id: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    // eg.1: User-Agent:[elastic-transport-ruby/8.0.1 (RUBY_VERSION: 3.1.2; linux
    // x86_64; Faraday v1.10.0)] eg.2: Elastic-filebeat/7.17.1 (linux; arm64;
    // 1d05ba86138cfc9a5ae5c0acc64a57b8d81678ff; 2022-02-24 01:00:19 +0000 UTC)
    let mut version = "7.17.1";
    let user_agent = match req.headers().get("User-Agent") {
        Some(user_agent) => user_agent.to_str().unwrap(),
        None => "",
    };
    if user_agent.to_lowercase().contains("elastic") {
        let re = regex::Regex::new(r"(\d+\.\d+\.\d+)").unwrap();
        version = match re.captures(user_agent) {
            Some(caps) => caps.get(1).unwrap().as_str(),
            None => "8.1.0",
        };
    }
    let es_config_version = config::get_config().common.fake_es_version.to_string();
    if !es_config_version.is_empty() {
        version = &es_config_version;
    }
    let es_info = r#"{"name":"opensearch","cluster_name":"opensearch-cluster","cluster_uuid":"h3nGzoJ1R12fZz","version":{"number":"0.0.0","build_flavor":"default","build_hash":"0","build_date":"0","build_snapshot":false,"lucene_version":"8.9.0","minimum_wire_version":"7.10.0","minimum_index_compatibility":"8.1.0"},"tagline":"You Know, for Search"}"#;
    let es_info = es_info.replace("0.0.0", version);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[get("/{org_id}/_license")]
async fn org_license(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let es_info = r#"{"status":"active"}"#;
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[get("/{org_id}/_xpack")]
async fn org_xpack(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let es_info = r#"{"build":{},"features":{},"license":{"status":"active"}}"#;
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[route("/{org_id}/_ilm/policy/{name}", method = "GET", method = "HEAD")]
async fn org_ilm_policy(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_, name) = path.into_inner();
    let es_info = r#"{"__PH__":{"version":1,"modified_date":82392349,"policy":{"phases":{"warm":{"min_age":"10d","actions":{"forcemerge":{"max_num_segments":1}}},"delete":{"min_age":"30d","actions":{"delete":{"delete_searchable_snapshot":true}}}}},"in_use_by":{"indices":[],"data_streams":[],"composable_templates":[]}}}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[route("/{org_id}/_index_template/{name}", method = "GET", method = "HEAD")]
async fn org_index_template(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"index_patterns":["__PH__-*"],"name":"__PH__","priority":1,"template":{"mappings":{"properties":{"_timestamp":{"aggregatable":false,"highlightable":false,"index":true,"sortable":false,"store":false,"type":"date"}}},"settings":{"number_of_replicas":1,"number_of_shards":3}}}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[put("/{org_id}/_index_template/{name}")]
async fn org_index_template_create(
    path: web::Path<(String, String)>,
    _body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"name":"__PH__","message":"ok"}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[route("/{org_id}/_data_stream/{name}", method = "GET", method = "HEAD")]
async fn org_data_stream(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"data_streams":{"name":"__PH__","timestamp_field":{"name":"_timestamp"}}}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[put("/{org_id}/_data_stream/{name}")]
async fn org_data_stream_create(
    path: web::Path<(String, String)>,
    _body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"name":"__PH__","message":"ok"}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[route("/{org_id}/_ingest/pipeline/{name}", method = "GET", method = "HEAD")]
async fn org_pipeline(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"__PH__":{"description":"describe pipeline","version":123,"processors":[{"set":{"field":"foo","value":"bar"}}]}}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}

#[put("/{org_id}/_ingest/pipeline/{name}")]
async fn org_pipeline_create(
    path: web::Path<(String, String)>,
    _body: web::Bytes,
) -> Result<HttpResponse, Error> {
    let (_org_id, name) = path.into_inner();
    let es_info = r#"{"name":"__PH__","message":"ok"}"#;
    let es_info = es_info.replace("__PH__", &name);
    Ok(HttpResponse::Ok()
        .content_type(http::header::ContentType::json())
        .insert_header(("X-Elastic-Product", "Elasticsearch"))
        .body(es_info))
}
