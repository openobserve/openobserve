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

use std::time::Duration;

use config::{META_ORG_ID, get_config, meta::otlp::OtlpRequestType};
use ingestion_common::{IngestUser, SystemJobType};
use opentelemetry_proto::tonic::collector::profiles::v1development::ExportProfilesServiceRequest;

use super::{STREAM_NAME, convert};

const REMOTE_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const REMOTE_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Ingest an OTLP profiles request locally or POST to a remote URL.
pub async fn ingest(request: ExportProfilesServiceRequest) -> Result<(), String> {
    let cfg = get_config();
    let url = cfg.self_profiles.url.trim();
    if url.is_empty() {
        ingest_local(request).await
    } else {
        ingest_remote(request, url, cfg.self_profiles.auth_header.as_str()).await
    }
}

async fn ingest_local(request: ExportProfilesServiceRequest) -> Result<(), String> {
    crate::profiles::handle_otlp_request(
        META_ORG_ID,
        request,
        OtlpRequestType::HttpProtobuf,
        Some(STREAM_NAME),
        IngestUser::SystemJob(SystemJobType::SelfReporting),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

async fn ingest_remote(
    request: ExportProfilesServiceRequest,
    url: &str,
    auth_header: &str,
) -> Result<(), String> {
    let body = convert::encode_otlp_request(&request);
    let client = reqwest::Client::builder()
        .timeout(REMOTE_REQUEST_TIMEOUT)
        .connect_timeout(REMOTE_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("remote self-profiles client build failed: {e}"))?;
    let mut builder = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/x-protobuf")
        .body(body);
    if !auth_header.is_empty() {
        builder = builder.header(reqwest::header::AUTHORIZATION, auth_header);
    }
    let resp = builder
        .send()
        .await
        .map_err(|e| format!("remote self-profiles POST failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "remote self-profiles POST returned {status}: {text}"
        ));
    }
    Ok(())
}
