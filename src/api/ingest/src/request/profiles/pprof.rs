// Copyright 2026 OpenObserve Inc.
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

use axum::{
    body::Body,
    extract::{Path, RawQuery},
    http::HeaderMap,
    response::Response,
};
use config::axum::middlewares::{get_process_time, insert_process_time_header};
use ingestion_common::IngestUser;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use crate::service::profiles;

/// Ingests one pprof `profile.proto` upload; compress it with `Content-Encoding: gzip`.
#[utoipa::path(
    post,
    path = "/{org_id}/ingest/profiles/pprof",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "PostProfilesPprof",
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("start_unix_nano" = String, Query, description = "Profile start time in Unix nanoseconds (decimal, greater than 0)"),
        ("duration_nano" = String, Query, description = "Profiled time in nanoseconds (decimal, at most 3600000000000)"),
        ("stream-name" = Option<String>, Header, description = "Profiles stream; defaults to default"),
        ("x-o2-resource-attributes" = String, Header, description = "Percent-encoded key=value pairs separated by commas; service.name is required; allowed keys: service.name, service.instance.id, service.namespace, deployment.environment, host.name, process.pid"),
        ("x-o2-source-root" = Option<String>, Header, description = "Percent-encoded source root; stripped from Node.js and Python frame paths at a directory boundary"),
        ("x-o2-pprof-runtime" = Option<String>, Header, description = "nodejs or python selects the type and frame mappings (frames keep file and line); anything else is generic"),
    ),
    summary = "Ingest profiles data as pprof",
    description = "Ingests a pprof profile.proto body into a profiles stream; a compressed body needs Content-Encoding: gzip. Answers an OTLP JSON body: {} on success, a code and message on failure.",
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(description = "pprof profile.proto, gzip-compressed when Content-Encoding: gzip is set", content(("application/octet-stream"))),
    security(("Authorization" = [])),
    responses(
        (status = 200, description = "Accepted; {} on a clean success", content((common::meta::otlp::OtlpProfilesExportJson = "application/json"))),
        (status = 400, description = "Invalid body, header or query parameter", content((Object = "application/json"))),
        (status = 408, description = "Request body not received in time", content((Object = "application/json"))),
        (status = 413, description = "Decoded body, profile size or stored volume over the limit", content((Object = "application/json"))),
        (status = 415, description = "Content-Encoding other than gzip or identity", content((Object = "application/json"))),
        (status = 429, description = "Trial period expired", content((Object = "application/json"))),
        (status = 500, description = "Failure", content((Object = "application/json"))),
        (status = 503, description = "Ingestion temporarily unavailable", content((Object = "application/json"))),
    )
)]
pub async fn pprof_profiles_write(
    Path(org_id): Path<String>,
    RawQuery(query): RawQuery,
    Headers(user_email): Headers<UserEmail>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let process_time = get_process_time();
    let user = IngestUser::from_user_email(&user_email.user_id);
    let mut response =
        profiles::handle_pprof_request(&org_id, &headers, query.as_deref(), body, user).await;
    insert_process_time_header(process_time, response.headers_mut());
    response
}
