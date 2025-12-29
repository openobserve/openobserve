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

use actix_multipart::Multipart;
use actix_web::{HttpRequest, HttpResponse, get, post, web};
use config::SIZE_IN_MB;
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::enrichment_table::{extract_multipart, save_enrichment_data},
};

/// CreateEnrichmentTable

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "CreateUpdateEnrichmentTable",
    summary = "Create or update enrichment table",
    description = "Creates a new enrichment table or updates existing table data for log enrichment",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("table_name" = String, Path, description = "Table name"),
    ),
    responses(
        (status = StatusCode::CREATED, description = "Saved enrichment table", body = ()),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Enrichment Table", "operation": "create"}))
    )
)]
#[post("/{org_id}/enrichment_tables/{table_name}")]
pub async fn save_enrichment_table(
    path: web::Path<(String, String)>,
    payload: Multipart,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, table_name) = path.into_inner();

    let bad_req_msg = if org_id.trim().is_empty() {
        Some("Organization cannot be empty")
    } else if table_name.trim().is_empty() {
        Some("Table name cannot be empty")
    } else {
        None
    };

    if let Some(msg) = bad_req_msg {
        return Ok(MetaHttpResponse::bad_request(msg));
    }
    let content_type = req.headers().get("content-type");
    let content_length = match req.headers().get("content-length") {
        None => 0.0,
        Some(content_length) => {
            content_length
                .to_str()
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0)
                / SIZE_IN_MB
        }
    };
    let cfg = config::get_config();
    log::debug!(
        "Enrichment table {} content length in mb: {}, max size in mb: {}",
        table_name,
        content_length,
        cfg.limit.enrichment_table_max_size
    );
    if content_length > cfg.limit.enrichment_table_max_size as f64 {
        return Ok(MetaHttpResponse::bad_request(format!(
            "exceeds allowed limit of {} mb",
            cfg.limit.enrichment_table_max_size
        )));
    }
    match content_type {
        Some(content_type) => {
            if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("multipart/form-data")
            {
                let query =
                    web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
                let append_data = match query.get("append") {
                    Some(append_data) => append_data.parse::<bool>().unwrap_or(false),
                    None => false,
                };
                let json_record = extract_multipart(payload, append_data).await?;
                save_enrichment_data(&org_id, &table_name, json_record, append_data).await
            } else {
                Ok(MetaHttpResponse::bad_request(
                    "Bad Request, content-type must be multipart/form-data",
                ))
            }
        }
        None => Ok(MetaHttpResponse::bad_request(
            "Bad Request, content-type must be multipart/form-data",
        )),
    }
}

// ============================================================================
// URL-based Enrichment Table Endpoints
// ============================================================================
//
// These endpoints provide asynchronous enrichment table population from public URLs.
// Unlike the file upload endpoint (save_enrichment_table), these endpoints:
//
// 1. Return immediately (202 Accepted) without blocking the HTTP thread
// 2. Process data in the background using MPSC event-driven architecture
// 3. Support files exceeding available RAM via streaming
// 4. Provide status polling for UI progress updates
// 5. Include retry logic for transient network failures
//
// This design was chosen over synchronous processing because:
// - File downloads can take minutes to hours for large files
// - Network issues require retry logic that's better handled asynchronously
// - Users need real-time feedback without keeping HTTP connections open
// - Background processing allows horizontal scaling across multiple ingesters

/// Request body for creating an enrichment table from a public URL.
///
/// The URL must point to a publicly accessible CSV file. Authentication-required
/// URLs (e.g., S3 presigned URLs with complex headers) are not currently supported.
///
/// The `append` behavior is controlled via query parameter, matching the file upload endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EnrichmentTableUrlRequest {
    /// Public URL to the CSV file.
    ///
    /// Requirements:
    /// - Must start with http:// or https://
    /// - Must be publicly accessible (no authentication)
    /// - Should return CSV content-type (not enforced but recommended)
    /// - File can be any size - streaming handles large files efficiently
    pub url: String,
}

/// CreateEnrichmentTableFromUrl
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "CreateEnrichmentTableFromUrl",
    summary = "Create enrichment table from URL",
    description = "Creates a new enrichment table by fetching CSV data from a public URL. The process runs asynchronously in the background.",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("table_name" = String, Path, description = "Table name"),
        ("append" = Option<bool>, Query, description = "Whether to append data to existing table (default: false)"),
    ),
    request_body(
        content = EnrichmentTableUrlRequest,
        description = "URL for the CSV file",
        content_type = "application/json"
    ),
    responses(
        (status = StatusCode::ACCEPTED, description = "Job created successfully", body = String),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = String),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = String),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Enrichment Table", "operation": "create"}))
    )
)]
#[post("/{org_id}/enrichment_tables/{table_name}/url")]
pub async fn save_enrichment_table_from_url(
    path: web::Path<(String, String)>,
    body: web::Json<EnrichmentTableUrlRequest>,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    use std::collections::HashMap;

    use config::meta::enrichment_table::{EnrichmentTableStatus, EnrichmentTableUrlJob};

    use crate::service::{
        db::enrichment_table::{get_url_job, save_url_job},
        enrichment_table::url_processor::trigger_url_job_processing,
    };

    let (org_id, table_name) = path.into_inner();
    let request_body = body.into_inner();

    // ===== PARSE QUERY PARAMETERS =====
    // Extract append_data from query parameter to match file upload endpoint consistency.
    // This keeps both endpoints (file upload and URL) using the same parameter pattern.
    // Also extract resume parameter to support resuming from last byte position on retry.
    let query = web::Query::<HashMap<String, String>>::from_query(req.query_string()).unwrap();
    let append_data = match query.get("append") {
        Some(append_str) => append_str.parse::<bool>().unwrap_or(false),
        None => false,
    };
    let resume = match query.get("resume") {
        Some(resume_str) => resume_str.parse::<bool>().unwrap_or(false),
        None => false,
    };

    // ===== INPUT VALIDATION =====
    // We validate all inputs before doing any database operations to fail fast
    // and provide clear error messages to users.

    if org_id.trim().is_empty() {
        return Ok(MetaHttpResponse::bad_request(
            "Organization cannot be empty",
        ));
    }
    if table_name.trim().is_empty() {
        return Ok(MetaHttpResponse::bad_request("Table name cannot be empty"));
    }
    if request_body.url.trim().is_empty() {
        return Ok(MetaHttpResponse::bad_request("URL cannot be empty"));
    }

    // Validate URL scheme to prevent potential security issues.
    // We only support http/https, not file://, ftp://, etc.
    // This prevents:
    // - Local file access via file:// URLs
    // - SSRF attacks via internal network protocols
    // - Confusion with non-HTTP transports
    if !request_body.url.starts_with("http://") && !request_body.url.starts_with("https://") {
        return Ok(MetaHttpResponse::bad_request(
            "URL must start with http:// or https://",
        ));
    }

    // SSRF protection: Block internal IPs and localhost
    if let Ok(parsed_url) = url::Url::parse(&request_body.url)
        && let Some(host) = parsed_url.host_str()
    {
        // Block localhost
        if host == "localhost" || host == "127.0.0.1" || host == "::1" {
            return Ok(MetaHttpResponse::bad_request(
                "Cannot access localhost URLs",
            ));
        }

        // Block private IP ranges and AWS metadata endpoint
        if let Ok(ip) = host.parse::<std::net::IpAddr>() {
            match ip {
                std::net::IpAddr::V4(v4) => {
                    let octets = v4.octets();
                    // RFC1918 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
                    // AWS metadata: 169.254.169.254
                    if octets[0] == 10
                        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                        || (octets[0] == 192 && octets[1] == 168)
                        || (octets[0] == 169 && octets[1] == 254)
                    {
                        return Ok(MetaHttpResponse::bad_request(
                            "Cannot access private IP addresses",
                        ));
                    }
                }
                std::net::IpAddr::V6(v6) => {
                    // Block IPv6 localhost and private ranges
                    if v6.is_loopback() || v6.segments()[0] & 0xfe00 == 0xfc00 {
                        return Ok(MetaHttpResponse::bad_request(
                            "Cannot access private IP addresses",
                        ));
                    }
                }
            }
        }
    }

    // ===== DUPLICATE JOB PREVENTION & RESUME HANDLING =====
    // Check if there's already a job in progress for this table.
    // This prevents:
    // 1. Wasted resources from duplicate downloads
    // 2. Race conditions where two jobs write to the same table
    // 3. Confusing UI state where multiple jobs exist for same table
    //
    // We allow replacing completed/failed jobs to support retrying with
    // different URLs or re-importing updated data.
    let existing_job = match get_url_job(&org_id, &table_name).await {
        Ok(Some(existing_job)) => {
            // Only block if job is actively processing.
            // This check is eventually consistent (job could complete between
            // check and new job creation), but the race window is milliseconds
            // and worst case is a harmless duplicate completion.
            if existing_job.status == EnrichmentTableStatus::Processing {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "Job already in progress for table {}/{}",
                    org_id, table_name
                )));
            }
            // If status is Completed or Failed, we allow creating a new job.
            // Store existing job for potential resume.
            Some(existing_job)
        }
        Ok(None) => {
            // No existing job found - this is the common case for first-time
            // imports. Proceed with creating new job.
            None
        }
        Err(e) => {
            // Database error while checking for existing job.
            // We fail the request rather than proceeding blindly, because:
            // 1. There might actually be a job in progress that we can't see
            // 2. Database issues indicate broader system problems
            // 3. Better to fail safe than risk duplicate work or data corruption
            log::error!(
                "[ENRICHMENT::URL] Failed to check existing job for {}/{}: {}",
                org_id,
                table_name,
                e
            );
            return Ok(MetaHttpResponse::internal_error(
                "Failed to check job status",
            ));
        }
    };

    // ===== JOB CREATION OR RESUME =====
    // If resume=true and there's an existing failed job with Range support,
    // preserve its progress (last_byte_position, etc.) and just reset to Pending.
    // Otherwise, create a fresh job from scratch.
    let mut job = if resume
        && existing_job.is_some()
        && existing_job.as_ref().unwrap().status == EnrichmentTableStatus::Failed
        && existing_job.as_ref().unwrap().supports_range
    {
        log::info!(
            "[ENRICHMENT::URL] Resuming job for {}/{} from byte {}",
            org_id,
            table_name,
            existing_job.as_ref().unwrap().last_byte_position
        );
        let mut existing = existing_job.unwrap();
        // Reset status to Pending but preserve progress
        existing.status = EnrichmentTableStatus::Pending;
        existing.error_message = None;
        existing.updated_at = chrono::Utc::now().timestamp_micros();
        existing
    } else {
        // Create a new job record with Pending status from scratch.
        // This immediately makes the job visible to the status API, allowing
        // the UI to start polling for updates even before processing begins.
        log::info!(
            "[ENRICHMENT::URL] Creating new job for {}/{} from scratch",
            org_id,
            table_name
        );
        EnrichmentTableUrlJob::new(
            org_id.clone(),
            table_name.clone(),
            request_body.url.clone(),
            append_data,
        )
    };

    // ===== CHECK RANGE REQUEST SUPPORT =====
    // Check if the URL supports HTTP Range requests for resumable downloads.
    // This check is done once at job creation and cached in the database.
    // The processor will use this flag to decide whether to use Range requests on retry.
    //
    // Skip this check if we're resuming (we already have the cached value).
    //
    // Why check now instead of during processing:
    // 1. Fail fast - detect unsupported URLs before accepting the job
    // 2. Cache the capability - avoid redundant checks on every retry
    // 3. Simplify retry logic - processor just reads the flag from DB
    //
    // Why we don't fail if check fails:
    // Range support is optional. If the check fails (network error, timeout),
    // we still create the job and assume no Range support (safer fallback).
    if !resume || !job.supports_range {
        let supports_range = {
            use crate::service::enrichment_table::url_processor::check_range_support_for_url;
            match check_range_support_for_url(&request_body.url, &org_id, &table_name).await {
                Ok(true) => {
                    log::info!(
                        "[ENRICHMENT::URL] URL {} supports Range requests - resume capability enabled",
                        request_body.url
                    );
                    true
                }
                Ok(false) => {
                    log::info!(
                        "[ENRICHMENT::URL] URL {} does not support Range requests - will use delete-and-retry on failure",
                        request_body.url
                    );
                    false
                }
                Err(e) => {
                    log::warn!(
                        "[ENRICHMENT::URL] Failed to check Range support for {}: {}. Assuming no support.",
                        request_body.url,
                        e
                    );
                    false
                }
            }
        };
        job.supports_range = supports_range;
    }

    // ===== PERSIST JOB TO DATABASE =====
    // Save job to database before triggering processing.
    // This ordering is critical:
    // 1. If save succeeds but trigger fails → Job exists in DB but not processing. User can retry
    //    or we can add recovery mechanism.
    // 2. If trigger succeeds but save fails → Processing starts without job record. Status API
    //    returns 404, UI shows no progress, chaos ensues.
    //
    // Therefore: save first, trigger second.
    if let Err(e) = save_url_job(&job).await {
        log::error!(
            "[ENRICHMENT::URL] Failed to save job for {}/{}: {}",
            org_id,
            table_name,
            e
        );
        return Ok(MetaHttpResponse::internal_error("Failed to create job"));
    }

    // ===== TRIGGER BACKGROUND PROCESSING =====
    // Send MPSC event to background processor.
    // This is a non-blocking operation that just queues an event.
    // Actual processing begins when the background task receives the event.
    //
    // Why we can fail here:
    // If this fails, the job exists in the database but will never process.
    // That's acceptable because:
    // 1. This only fails during process shutdown (channel closed)
    // 2. We return 500, so user knows the request failed
    // 3. User can retry, which will trigger processing of the existing job
    if let Err(e) = trigger_url_job_processing(org_id.clone(), table_name.clone()) {
        log::error!(
            "[ENRICHMENT::URL] Failed to trigger job processing for {}/{}: {}",
            org_id,
            table_name,
            e
        );
        return Ok(MetaHttpResponse::internal_error(
            "Failed to trigger job processing",
        ));
    }

    log::info!(
        "[ENRICHMENT::URL] Created and triggered job for {}/{} from URL: {}",
        org_id,
        table_name,
        request_body.url
    );

    // ===== SUCCESS RESPONSE =====
    // Return 202 Accepted (not 200 OK or 201 Created) because:
    // - The job is accepted but not yet processed
    // - Processing happens asynchronously in the background
    // - Final outcome (success/failure) is unknown at this point
    // - Client should poll the status endpoint for progress
    Ok(MetaHttpResponse::json(serde_json::json!({
        "message": "Enrichment table job created successfully",
        "org_id": org_id,
        "table_name": table_name,
        "status": "pending"
    })))
}

/// GetAllEnrichmentTableStatuses
#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "GetAllEnrichmentTableStatuses",
    summary = "Get all enrichment table statuses for an organization",
    description = "Get the status of all enrichment tables (both file and URL-based) for an organization in a single request",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = StatusCode::OK, description = "Statuses retrieved", body = HashMap<String, config::meta::enrichment_table::EnrichmentTableUrlJob>),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = String),
        (status = StatusCode::FORBIDDEN, description = "Forbidden", body = String),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = String),
    )
)]
#[get("/{org_id}/enrichment_tables/status")]
pub async fn get_all_enrichment_table_statuses(
    path: web::Path<String>,
    crate::handler::http::extractors::Headers(_user_email): crate::handler::http::extractors::Headers<
        crate::common::utils::auth::UserEmail,
    >,
) -> Result<HttpResponse, Error> {
    use crate::service::db::enrichment_table::list_url_jobs;

    let org_id = path.into_inner();

    // ===== INPUT VALIDATION =====
    if org_id.trim().is_empty() {
        return Ok(MetaHttpResponse::bad_request(
            "Organization cannot be empty",
        ));
    }

    // ===== OPENFGA PERMISSION CHECK (ENTERPRISE) =====
    // Get list of enrichment tables the user has permission to access.
    // This follows the same pattern as stream list endpoint.
    #[cfg(feature = "enterprise")]
    let permitted_tables: Option<Vec<String>> = {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            &_user_email.user_id,
            "GET",
            OFGA_MODELS
                .get("enrichment_tables")
                .map_or("enrichment_tables", |model| model.key),
        )
        .await
        {
            Ok(table_list) => table_list,
            Err(e) => {
                return Ok(MetaHttpResponse::forbidden(e.to_string()));
            }
        }
    };

    #[cfg(not(feature = "enterprise"))]
    let permitted_tables: Option<Vec<String>> = None;

    // ===== FETCH ALL URL JOBS FOR THIS ORG =====
    // This returns all URL-based enrichment table jobs in a single query.
    // Much more efficient than N separate queries for N tables.
    // Frontend can then map table names to their job status locally.
    match list_url_jobs(&org_id).await {
        Ok(jobs) => {
            // ===== FILTER BY OPENFGA PERMISSIONS =====
            // Filter jobs based on user permissions, following the same pattern
            // as stream::get_streams() function.
            let filtered_jobs = if let Some(permitted) = permitted_tables {
                // Check if user has access to all enrichment tables
                let all_tables_key = format!("enrichment_table:_all_{}", org_id);
                if permitted.contains(&all_tables_key) {
                    // User has wildcard access to all tables
                    jobs
                } else {
                    // Filter to only tables the user has explicit permission for
                    jobs.into_iter()
                        .filter(|job| {
                            permitted.contains(&format!("enrichment_table:{}", job.table_name))
                        })
                        .collect::<Vec<_>>()
                }
            } else {
                // No OpenFGA filtering (non-enterprise or permission check disabled)
                jobs
            };

            // Convert Vec<Job> to HashMap<table_name, Job> for easier frontend lookup
            let job_map: HashMap<String, config::meta::enrichment_table::EnrichmentTableUrlJob> =
                filtered_jobs
                    .into_iter()
                    .map(|job| (job.table_name.clone(), job))
                    .collect();

            Ok(MetaHttpResponse::json(job_map))
        }
        Err(e) => {
            log::error!(
                "[ENRICHMENT::URL] Failed to list URL jobs for org {}: {}",
                org_id,
                e
            );
            Ok(MetaHttpResponse::internal_error(
                "Failed to retrieve enrichment table statuses",
            ))
        }
    }
}
