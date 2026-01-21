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
    Json,
    extract::{Multipart, Path, Query},
    http::HeaderMap,
    response::Response,
};
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
    post,
    path = "/{org_id}/enrichment_tables/{table_name}",
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
        ("x-o2-ratelimit" = json!({"module": "Enrichment Table", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create/update enrichment table", "category": "enrichment"}))
    )
)]
pub async fn save_enrichment_table(
    Path((org_id, table_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    payload: Multipart,
) -> Response {
    let bad_req_msg = if org_id.trim().is_empty() {
        Some("Organization cannot be empty")
    } else if table_name.trim().is_empty() {
        Some("Table name cannot be empty")
    } else {
        None
    };

    if let Some(msg) = bad_req_msg {
        return MetaHttpResponse::bad_request(msg);
    }

    let content_type = headers.get("content-type");
    let content_length = match headers.get("content-length") {
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
        return MetaHttpResponse::bad_request(format!(
            "exceeds allowed limit of {} mb",
            cfg.limit.enrichment_table_max_size
        ));
    }

    match content_type {
        Some(content_type) => {
            if content_type
                .to_str()
                .unwrap_or("")
                .starts_with("multipart/form-data")
            {
                let append_data = match query.get("append") {
                    Some(append_data) => append_data.parse::<bool>().unwrap_or(false),
                    None => false,
                };

                // Extract multipart data using axum's Multipart
                match extract_multipart(payload, append_data).await {
                    Ok(json_record) => {
                        match save_enrichment_data(&org_id, &table_name, json_record, append_data)
                            .await
                        {
                            Ok(resp) => resp,
                            Err(e) => MetaHttpResponse::internal_error(e.to_string()),
                        }
                    }
                    Err(e) => MetaHttpResponse::bad_request(e),
                }
            } else {
                MetaHttpResponse::bad_request(
                    "Bad Request, content-type must be multipart/form-data",
                )
            }
        }
        None => {
            MetaHttpResponse::bad_request("Bad Request, content-type must be multipart/form-data")
        }
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

    /// Replace only the failed job's URL (optional, default: false)
    ///
    /// When true, only updates the failed job with the new URL while keeping
    /// all successful jobs unchanged. Useful for fixing typos or broken URLs
    /// without re-downloading working data sources.
    #[serde(default)]
    pub replace_failed: bool,
}

/// CreateEnrichmentTableFromUrl
#[utoipa::path(
    post,
    path = "/{org_id}/enrichment_tables/{table_name}/url",
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
        ("x-o2-ratelimit" = json!({"module": "Enrichment Table", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create table from URL", "category": "enrichment"}))
    )
)]
pub async fn save_enrichment_table_from_url(
    Path((org_id, table_name)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<EnrichmentTableUrlRequest>,
) -> Response {
    use config::meta::enrichment_table::{EnrichmentTableStatus, EnrichmentTableUrlJob};

    use crate::service::{
        db::enrichment_table::{delete_url_job, get_url_jobs_for_table, save_url_job},
        enrichment_table::url_processor::trigger_url_job_processing,
    };

    let request_body = body;

    // ===== PARSE QUERY PARAMETERS =====
    // Extract append_data from query parameter to match file upload endpoint consistency.
    // This keeps both endpoints (file upload and URL) using the same parameter pattern.
    // Also extract resume parameter to support resuming from last byte position on retry.
    // Also extract retry parameter to distinguish between retry (recreate all jobs) vs update (new
    // URL).
    let append_data = match query.get("append") {
        Some(append_str) => append_str.parse::<bool>().unwrap_or(false),
        None => false,
    };
    let resume = match query.get("resume") {
        Some(resume_str) => resume_str.parse::<bool>().unwrap_or(false),
        None => false,
    };
    let retry = match query.get("retry") {
        Some(retry_str) => retry_str.parse::<bool>().unwrap_or(false),
        None => false,
    };

    // Extract replace_failed from request body
    let replace_failed = request_body.replace_failed;

    // ===== INPUT VALIDATION =====
    // We validate all inputs before doing any database operations to fail fast
    // and provide clear error messages to users.

    if org_id.trim().is_empty() {
        return MetaHttpResponse::bad_request("Organization cannot be empty");
    }
    if table_name.trim().is_empty() {
        return MetaHttpResponse::bad_request("Table name cannot be empty");
    }
    if request_body.url.trim().is_empty() {
        return MetaHttpResponse::bad_request("URL cannot be empty");
    }

    // URL validation: Skip if retry mode (we're just reprocessing existing URLs)
    // Apply validation for normal updates and replace_failed mode
    if !retry && let Err(err_msg) = validate_enrichment_url(&request_body.url) {
        return MetaHttpResponse::bad_request(err_msg);
    }

    // ===== MULTI-URL SUPPORT: JOB STATUS VALIDATION =====
    // Fetch all existing jobs for this table
    let existing_jobs = match get_url_jobs_for_table(&org_id, &table_name).await {
        Ok(jobs) => jobs,
        Err(e) => {
            log::error!(
                "[ENRICHMENT::URL] Failed to fetch existing jobs for {}/{}: {}",
                org_id,
                table_name,
                e
            );
            return MetaHttpResponse::internal_error("Failed to check job status");
        }
    };

    // Check job statuses
    let has_processing = existing_jobs
        .iter()
        .any(|j| j.status == EnrichmentTableStatus::Processing);
    let has_failed = existing_jobs
        .iter()
        .any(|j| j.status == EnrichmentTableStatus::Failed);

    // RULE 1: Block ALL operations if any job is processing
    // Reason: Cannot safely write to table while another job is writing
    if has_processing {
        return MetaHttpResponse::bad_request(format!(
            "Cannot create new job: a job is currently processing for table {}/{}. Please wait for it to complete.",
            org_id, table_name
        ));
    }

    // RULE 2: Block APPEND (adding new URL) if any job has failed
    // Reason: Failed jobs indicate data integrity issues; user should resolve them first
    // Allow: retry (reload all), replace_failed (fix failed URL), or replace mode (start fresh)
    if append_data && has_failed && !retry && !replace_failed {
        return MetaHttpResponse::bad_request(format!(
            "Cannot add new URL: table {}/{} has failed jobs. Please reload, replace the failed URL, or use replace mode to start fresh.",
            org_id, table_name
        ));
    }

    // ===== RETRY vs UPDATE vs RESUME LOGIC =====
    // Three scenarios:
    // 1. resume=true: Resume a specific failed job from last byte position
    // 2. retry=true: Retry all existing jobs from scratch (reset their state)
    // 3. Neither: Update mode - replace all jobs with this new URL

    let jobs_to_save: Vec<EnrichmentTableUrlJob> = if resume {
        // ===== SCENARIO 1: RESUME =====
        // Find failed job with matching URL that supports Range requests
        let resumable_job = existing_jobs
            .iter()
            .find(|j| {
                j.status == EnrichmentTableStatus::Failed
                    && j.supports_range
                    && j.url == request_body.url
            })
            .cloned();

        if let Some(existing) = resumable_job {
            log::info!(
                "[ENRICHMENT::URL] Resuming job {} for {}/{} from byte {}",
                existing.id,
                org_id,
                table_name,
                existing.last_byte_position
            );
            let mut job = existing;
            job.status = EnrichmentTableStatus::Pending;
            job.error_message = None;
            job.updated_at = chrono::Utc::now().timestamp_micros();
            vec![job]
        } else {
            log::info!(
                "[ENRICHMENT::URL] No resumable job found, creating new job for {}/{}",
                org_id,
                table_name
            );
            vec![EnrichmentTableUrlJob::new(
                org_id.clone(),
                table_name.clone(),
                request_body.url.clone(),
                false, // retry from scratch, so don't append
            )]
        }
    } else if retry {
        // ===== SCENARIO 2: RETRY ALL JOBS =====
        // Reset all existing jobs to start from scratch
        // This preserves job IDs and created_at timestamps
        log::info!(
            "[ENRICHMENT::URL] Retry mode: resetting all {} job(s) for {}/{} to retry from scratch",
            existing_jobs.len(),
            org_id,
            table_name
        );

        existing_jobs
            .into_iter()
            .enumerate()
            .map(|(idx, mut job)| {
                // Reset job state to retry from beginning
                job.status = EnrichmentTableStatus::Pending;
                job.last_byte_position = 0;
                job.total_bytes_fetched = 0;
                job.total_records_processed = 0;
                job.retry_count = 0;
                job.error_message = None;
                // First job deletes+recreates table (replace mode)
                // Subsequent jobs append to the table
                job.append_data = idx > 0;
                job.updated_at = chrono::Utc::now().timestamp_micros();
                job
            })
            .collect()
    } else if replace_failed {
        // ===== SCENARIO 3: REPLACE FAILED URL ONLY =====
        // Replace only the failed job's URL while keeping successful jobs
        log::info!(
            "[ENRICHMENT::URL] Replace failed mode: updating failed job URL for {}/{}",
            org_id,
            table_name
        );

        // Find the failed job
        // Note: We block adding new URLs when a job has failed (see RULE 2 validation above),
        // so there should ideally be only one failed job at any given time. We find the first
        // failed job if multiple exist (which shouldn't happen in normal operation).
        let failed_job = existing_jobs
            .iter()
            .find(|j| j.status == EnrichmentTableStatus::Failed)
            .cloned();

        if let Some(mut job) = failed_job {
            // Update the failed job with new URL and reset its state
            job.url = request_body.url.clone();
            job.status = EnrichmentTableStatus::Pending;
            job.last_byte_position = 0;
            job.total_bytes_fetched = 0;
            job.total_records_processed = 0;
            job.retry_count = 0;
            job.error_message = None;
            job.updated_at = chrono::Utc::now().timestamp_micros();
            // Keep append_data as-is to maintain the original job order behavior

            vec![job]
        } else {
            return MetaHttpResponse::bad_request("No failed job found to replace");
        }
    } else {
        // ===== SCENARIO 4: UPDATE MODE =====
        // Replace all existing jobs with this new URL
        log::info!(
            "[ENRICHMENT::URL] Update mode: replacing all jobs with new URL for {}/{}",
            org_id,
            table_name
        );

        // Delete all existing job records if in replace mode
        if !append_data
            && !existing_jobs.is_empty()
            && let Err(e) = delete_url_job(&org_id, &table_name).await
        {
            log::error!(
                "[ENRICHMENT::URL] Failed to delete existing jobs for {}/{}: {}",
                org_id,
                table_name,
                e
            );
            // Continue anyway - we'll create the new job
        }

        vec![EnrichmentTableUrlJob::new(
            org_id.clone(),
            table_name.clone(),
            request_body.url.clone(),
            append_data,
        )]
    };

    // ===== CHECK RANGE REQUEST SUPPORT & PERSIST JOBS =====
    // For each job, check Range support (if needed) and save to database
    let mut saved_job_count = 0;
    for mut job in jobs_to_save {
        // Check Range support only for new jobs (not resume or retry)
        // Resume: already has cached value
        // Retry: already checked before, reuse the value
        if !resume && !retry {
            let supports_range = {
                use crate::service::enrichment_table::url_processor::check_range_support_for_url;
                match check_range_support_for_url(&job.url, &org_id, &table_name).await {
                    Ok(true) => {
                        log::info!(
                            "[ENRICHMENT::URL] URL {} supports Range requests - resume capability enabled",
                            job.url
                        );
                        true
                    }
                    Ok(false) => {
                        log::info!(
                            "[ENRICHMENT::URL] URL {} does not support Range requests - will use delete-and-retry on failure",
                            job.url
                        );
                        false
                    }
                    Err(e) => {
                        log::warn!(
                            "[ENRICHMENT::URL] Failed to check Range support for {}: {}. Assuming no support.",
                            job.url,
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
        // This ordering is critical - see comments in original single-job flow.
        if let Err(e) = save_url_job(&job).await {
            log::error!(
                "[ENRICHMENT::URL] Failed to save job {} for {}/{}: {}",
                job.id,
                org_id,
                table_name,
                e
            );
            return MetaHttpResponse::internal_error("Failed to save job");
        }

        saved_job_count += 1;
        log::info!(
            "[ENRICHMENT::URL] Saved job {} for {}/{} (URL: {})",
            job.id,
            org_id,
            table_name,
            job.url
        );
    }

    // ===== TRIGGER BACKGROUND PROCESSING =====
    // Send MPSC event to background processor to process all pending jobs for this table.
    // The processor will pick up all pending jobs and process them sequentially.
    if let Err(e) = trigger_url_job_processing(org_id.clone(), table_name.clone()) {
        log::error!(
            "[ENRICHMENT::URL] Failed to trigger job processing for {}/{}: {}",
            org_id,
            table_name,
            e
        );
        return MetaHttpResponse::internal_error("Failed to trigger job processing");
    }

    log::info!(
        "[ENRICHMENT::URL] Created and triggered {} job(s) for {}/{}",
        saved_job_count,
        org_id,
        table_name
    );

    // ===== SUCCESS RESPONSE =====
    // Return 202 Accepted (not 200 OK or 201 Created) because:
    // - The job is accepted but not yet processed
    // - Processing happens asynchronously in the background
    // - Final outcome (success/failure) is unknown at this point
    // - Client should poll the status endpoint for progress
    MetaHttpResponse::json(serde_json::json!({
        "message": "Enrichment table job created successfully",
        "org_id": org_id,
        "table_name": table_name,
        "status": "pending"
    }))
}

/// GetAllEnrichmentTableStatuses
#[utoipa::path(
    get,
    path = "/{org_id}/enrichment_tables/status",
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
        (status = StatusCode::OK, description = "Statuses retrieved", body = HashMap<String, Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>>),
        (status = StatusCode::BAD_REQUEST, description = "Bad Request", body = String),
        (status = StatusCode::FORBIDDEN, description = "Forbidden", body = String),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal Server Error", body = String),
    )
)]
pub async fn get_all_enrichment_table_statuses(
    Path(org_id): Path<String>,
    crate::handler::http::extractors::Headers(_user_email): crate::handler::http::extractors::Headers<
        crate::common::utils::auth::UserEmail,
    >,
) -> Response {
    use crate::service::db::enrichment_table::list_url_jobs;

    // ===== INPUT VALIDATION =====
    if org_id.trim().is_empty() {
        return MetaHttpResponse::bad_request("Organization cannot be empty");
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
                return MetaHttpResponse::forbidden(e.to_string());
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

            // Convert Vec<Job> to HashMap<table_name, Vec<Job>> for multi-URL support
            // Group jobs by table_name
            let mut job_map: HashMap<
                String,
                Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>,
            > = HashMap::new();

            for job in filtered_jobs {
                job_map
                    .entry(job.table_name.clone())
                    .or_insert_with(Vec::new)
                    .push(job);
            }

            MetaHttpResponse::json(job_map)
        }
        Err(e) => {
            log::error!(
                "[ENRICHMENT::URL] Failed to list URL jobs for org {}: {}",
                org_id,
                e
            );
            MetaHttpResponse::internal_error("Failed to retrieve enrichment table statuses")
        }
    }
}

/// Validates a URL for enrichment table ingestion
///
/// Performs security checks including:
/// - Non-empty URL
/// - HTTP/HTTPS scheme only
/// - SSRF protection (blocks localhost and private IPs)
///
/// # Returns
/// - `Ok(())` if validation passes
/// - `Err(String)` with error message if validation fails
fn validate_enrichment_url(url: &str) -> Result<(), String> {
    // Check for empty URL
    if url.trim().is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    // Validate URL scheme
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    // Parse URL for SSRF protection
    let parsed_url = url::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

    let host = parsed_url
        .host_str()
        .ok_or_else(|| "URL must have a valid host".to_string())?;

    // Block localhost
    if host == "localhost" || host == "127.0.0.1" || host == "::1" {
        return Err("Cannot access localhost URLs".to_string());
    }

    // Block private IP ranges
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
                    return Err("Cannot access private IP addresses".to_string());
                }
            }
            std::net::IpAddr::V6(v6) => {
                // Block IPv6 localhost and private ranges
                if v6.is_loopback() || v6.segments()[0] & 0xfe00 == 0xfc00 {
                    return Err("Cannot access private IP addresses".to_string());
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_enrichment_url_valid_http() {
        assert!(validate_enrichment_url("http://example.com/data.csv").is_ok());
    }

    #[test]
    fn test_validate_enrichment_url_valid_https() {
        assert!(validate_enrichment_url("https://example.com/data.csv").is_ok());
    }

    #[test]
    fn test_validate_enrichment_url_empty() {
        let result = validate_enrichment_url("");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "URL cannot be empty");
    }

    #[test]
    fn test_validate_enrichment_url_whitespace() {
        let result = validate_enrichment_url("   ");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "URL cannot be empty");
    }

    #[test]
    fn test_validate_enrichment_url_invalid_scheme() {
        let result = validate_enrichment_url("ftp://example.com/data.csv");
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "URL must start with http:// or https://"
        );
    }

    #[test]
    fn test_validate_enrichment_url_file_scheme() {
        let result = validate_enrichment_url("file:///etc/passwd");
        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "URL must start with http:// or https://"
        );
    }

    #[test]
    fn test_validate_enrichment_url_localhost() {
        let result = validate_enrichment_url("http://localhost/data.csv");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access localhost URLs");
    }

    #[test]
    fn test_validate_enrichment_url_127_0_0_1() {
        let result = validate_enrichment_url("http://127.0.0.1/data.csv");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access localhost URLs");
    }

    #[test]
    fn test_validate_enrichment_url_private_ip_10() {
        let result = validate_enrichment_url("http://10.0.0.1/data.csv");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access private IP addresses");
    }

    #[test]
    fn test_validate_enrichment_url_private_ip_192_168() {
        let result = validate_enrichment_url("http://192.168.1.1/data.csv");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access private IP addresses");
    }

    #[test]
    fn test_validate_enrichment_url_private_ip_172() {
        let result = validate_enrichment_url("http://172.16.0.1/data.csv");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access private IP addresses");
    }

    #[test]
    fn test_validate_enrichment_url_aws_metadata() {
        let result = validate_enrichment_url("http://169.254.169.254/latest/meta-data/");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Cannot access private IP addresses");
    }

    #[test]
    fn test_validate_enrichment_url_public_ip() {
        assert!(validate_enrichment_url("http://8.8.8.8/data.csv").is_ok());
    }

    #[test]
    fn test_validate_enrichment_url_github() {
        assert!(
            validate_enrichment_url("https://raw.githubusercontent.com/user/repo/main/data.csv")
                .is_ok()
        );
    }
}
