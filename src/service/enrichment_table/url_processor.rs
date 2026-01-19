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

//! URL-based Enrichment Table Processor
//!
//! This module handles asynchronous processing of enrichment tables from public URLs.
//! It provides a background processing system that can fetch large CSV files (20GB+)
//! from URLs without blocking API requests.
//!
//! # Architecture
//!
//! The implementation uses an event-driven MPSC (Multi-Producer, Single-Consumer) channel
//! architecture instead of periodic polling. This design was chosen for several reasons:
//!
//! 1. **Immediate Processing**: Jobs start processing as soon as they're triggered, rather than
//!    waiting for the next polling interval, reducing latency.
//!
//! 2. **Simplicity**: No need for distributed job coordination, job claiming, or lock management.
//!    The router automatically handles load balancing across ingesters.
//!
//! 3. **Memory Efficiency**: Only one background task runs per ingester process, consuming minimal
//!    resources when idle. Jobs are processed sequentially but spawn separate tasks to avoid
//!    blocking the event loop.
//!
//! 4. **Scalability**: Multiple ingesters can process different jobs concurrently. The router
//!    distributes incoming requests, naturally balancing the load.
//!
//! # Processing Flow
//!
//! 1. API receives POST request with URL → Job saved to database with "Pending" status
//! 2. MPSC event sent to background processor → Job starts immediately
//! 3. CSV streamed in configurable chunks → Prevents OOM on large files
//! 4. Data parsed batch-by-batch → Schema generated from first batch only
//! 5. Each batch saved using existing enrichment logic → Leverages existing storage/indexing
//! 6. On success: Job marked "Completed", NATS broadcast sent → All nodes notified
//! 7. On failure: Retry with exponential backoff → Handles transient network issues
//!
//! # Memory Management
//!
//! The system is designed to handle files exceeding available RAM:
//! - HTTP streaming prevents loading entire file into memory
//! - Configurable chunk size (default 1GB) limits buffer growth
//! - CSV parsing handles incomplete lines across chunk boundaries
//! - Batch processing (10k records) limits in-memory accumulation

use anyhow::{Result, anyhow};
use config::{get_config, meta::enrichment_table::*, utils::json};
use futures::StreamExt;
use once_cell::sync::Lazy;
use reqwest::Client;
use tokio::sync::mpsc;

use crate::service::db;

// ============================================================================
// MPSC Channel and Event
// ============================================================================

/// Event sent through MPSC channel to trigger URL job processing.
///
/// This is a lightweight event that only contains identifiers, not the full job state.
/// The actual job details are fetched from the database when processing begins.
/// This design keeps events small and allows job state to be updated independently.
#[derive(Debug, Clone)]
pub struct EnrichmentUrlJobEvent {
    pub org_id: String,
    pub table_name: String,
}

/// Global MPSC sender initialized lazily on first access.
///
/// We use `Lazy` from `once_cell` to ensure the channel and background processor
/// are initialized exactly once, even in multi-threaded environments. This happens
/// automatically on the first call to `trigger_url_job_processing()`.
///
/// Why unbounded channel: Job events are extremely lightweight (just two strings).
/// Even with thousands of pending jobs, memory usage is negligible. An unbounded
/// channel prevents the API from blocking when many jobs are queued, ensuring
/// the API always returns quickly with 202 Accepted.
///
/// Why single consumer: Only one background task processes events on each ingester.
/// This prevents race conditions and simplifies job state management. Jobs can still
/// run concurrently because each event spawns a new tokio task.
static URL_JOB_SENDER: Lazy<mpsc::UnboundedSender<EnrichmentUrlJobEvent>> = Lazy::new(|| {
    let (tx, rx) = mpsc::unbounded_channel();

    // Spawn the processor task immediately during initialization.
    // This task runs for the lifetime of the process, continuously
    // waiting for events on the receiver channel.
    tokio::spawn(async move {
        process_url_jobs(rx).await;
    });

    // Spawn the stale job recovery task for distributed deployments.
    // This task runs periodically to recover jobs stuck in Processing status.
    // Note: This is a no-op for SQLite (single-node) deployments.
    tokio::spawn(async move {
        use config::get_config;

        log::info!("[ENRICHMENT::URL] Starting stale job recovery task");

        loop {
            let cfg = get_config();
            let stale_threshold_secs = cfg.enrichment_table.url_stale_job_threshold_secs;
            let check_interval_secs = cfg.enrichment_table.url_recovery_check_interval_secs;
            let jobs_per_check = cfg.enrichment_table.url_recovery_jobs_per_check;

            tokio::time::sleep(tokio::time::Duration::from_secs(check_interval_secs)).await;

            // Attempt to claim multiple stale jobs per check (configurable)
            match db::enrichment_table::claim_stale_url_jobs(stale_threshold_secs, jobs_per_check)
                .await
            {
                Ok(jobs) => {
                    if jobs.is_empty() {
                        log::debug!("[ENRICHMENT::URL] No stale jobs found during recovery check");
                    } else {
                        log::warn!("[ENRICHMENT::URL] Recovered {} stale job(s)", jobs.len());

                        for job in jobs {
                            log::warn!(
                                "[ENRICHMENT::URL] Recovered stale job: {}/{} (last updated: {} seconds ago)",
                                job.org_id,
                                job.table_name,
                                (chrono::Utc::now().timestamp_micros() - job.updated_at)
                                    / 1_000_000
                            );

                            if let Err(e) = trigger_url_job_processing(job.org_id, job.table_name) {
                                log::error!(
                                    "[ENRICHMENT::URL] Failed to trigger recovered job: {}",
                                    e
                                );
                            }
                        }
                    }
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    if error_msg.contains("SQLite") || error_msg.contains("single-node") {
                        log::debug!(
                            "[ENRICHMENT::URL] Stale job recovery skipped (SQLite single-node mode)"
                        );
                    } else {
                        log::error!("[ENRICHMENT::URL] Failed to claim stale jobs: {}", e);
                    }
                }
            }
        }
    });

    tx
});

/// Initializes the URL job processing system.
///
/// **CRITICAL**: This function MUST be called during ingester startup to ensure
/// the background processor and stale job recovery tasks are initialized.
///
/// # Why this is necessary
///
/// The `URL_JOB_SENDER` static is lazily initialized on first access. If an ingester
/// crashes while processing a job, and other ingesters have never received a URL job
/// event, they will never initialize the lazy static. This means:
///
/// 1. The main event processor never starts
/// 2. **The stale job recovery task never starts** - stale jobs are never recovered!
///
/// By calling this function eagerly on ingester startup, we ensure that all ingesters
/// have the recovery task running, even if they never process a URL job.
///
/// # When to call
///
/// Call this function once during ingester startup, after the database connection is
/// established but before starting the HTTP server. It's safe to call multiple times
/// (subsequent calls are no-ops due to the Lazy implementation).
///
/// # Example
///
/// ```rust,ignore
/// // In ingester initialization code:
/// if LOCAL_NODE.is_ingester() {
///     crate::service::enrichment_table::url_processor::init_url_processor();
/// }
/// ```
pub fn init_url_processor() {
    // Force initialization of the lazy static by accessing it.
    // This triggers the background tasks (event processor + stale job recovery).
    // We don't need to send an event - just touching the static is enough.
    let _ = &*URL_JOB_SENDER;
    log::info!("[ENRICHMENT::URL] URL job processor initialized");
}

/// Triggers URL job processing by sending an event to the MPSC channel.
///
/// This function is called from the API handler after saving the job to the database.
/// It's intentionally lightweight - just an event queue operation that returns immediately.
///
/// # Why separate trigger from API handler
///
/// The API handler needs to return quickly (within milliseconds) to avoid blocking
/// the HTTP thread pool. URL processing can take minutes or hours for large files.
/// By decoupling via events, the API provides immediate feedback while processing
/// happens asynchronously in the background.
///
/// # Error handling
///
/// Returns an error only if the channel is closed, which only happens during
/// process shutdown. In production, this should never fail during normal operation.
pub fn trigger_url_job_processing(org_id: String, table_name: String) -> Result<(), String> {
    URL_JOB_SENDER
        .send(EnrichmentUrlJobEvent { org_id, table_name })
        .map_err(|e| format!("Failed to send job event: {}", e))
}

// ============================================================================
// Event Processor
// ============================================================================

/// Processes URL job events from the MPSC receiver in an infinite loop.
///
/// This function runs continuously in the background, waiting for events on the
/// receiver channel. When an event arrives, it spawns a new tokio task to handle
/// the job, then immediately returns to waiting for the next event.
///
/// # Why spawn separate tasks
///
/// Each job is processed in its own tokio task for several reasons:
///
/// 1. **Concurrency**: Multiple jobs can run simultaneously on the same ingester, maximizing
///    throughput and resource utilization.
///
/// 2. **Isolation**: If one job panics or hangs, it doesn't affect other jobs or the event loop.
///    The processor continues receiving new events.
///
/// 3. **Non-blocking**: The event loop never blocks waiting for a job to complete. It can
///    immediately start processing the next event.
///
/// # Why this never exits
///
/// The function only returns when the channel is closed (sender dropped), which
/// only happens during process shutdown. This is intentional - we want the processor
/// to run for the entire lifetime of the process.
async fn process_url_jobs(mut rx: mpsc::UnboundedReceiver<EnrichmentUrlJobEvent>) {
    log::info!("[ENRICHMENT::URL] Starting URL job processor");

    // Infinite loop waiting for events. This is the main event processing loop
    // that runs for the lifetime of the process.
    while let Some(event) = rx.recv().await {
        log::info!(
            "[ENRICHMENT::URL] Received job event for {}/{}",
            event.org_id,
            event.table_name
        );

        // Clone event before moving into spawned task. We need to clone because
        // the task takes ownership, but we want to keep using the receiver in
        // this loop without moving ownership of the event.
        let event_clone = event.clone();

        // Spawn a new tokio task to process this job concurrently.
        // We don't await this task - it runs independently while we
        // immediately go back to waiting for the next event.
        tokio::spawn(async move {
            if let Err(e) =
                process_single_url_job(&event_clone.org_id, &event_clone.table_name).await
            {
                // Log errors but don't crash the task. The job state in the database
                // will reflect the failure, and retry logic will handle it.
                log::error!(
                    "[ENRICHMENT::URL] Failed to process job {}/{}: {}",
                    event_clone.org_id,
                    event_clone.table_name,
                    e
                );
            }
        });
    }

    // This log only appears during process shutdown when the channel is closed.
    // In normal operation, this line is never reached.
    log::warn!("[ENRICHMENT::URL] URL job processor stopped (channel closed)");
}

/// Processes a single URL enrichment table job from start to finish.
///
/// This function handles the complete lifecycle of a URL job:
/// 1. Fetches job state from database
/// 2. Validates job isn't already running
/// 3. Marks job as processing
/// 4. Downloads and processes CSV data
/// 5. Updates job status and triggers notifications
/// 6. Handles retries on failure
///
/// # State Management Strategy
///
/// Job state is persisted to database at every transition (Pending → Processing →
/// Completed/Failed). This ensures that:
/// - The UI can poll for real-time status updates
/// - Jobs can be recovered after process crashes
/// - Multiple ingesters won't process the same job simultaneously
///
/// # Concurrency Safety
///
/// While multiple events for the same job could theoretically arrive (e.g., from retries),
/// the status check prevents duplicate processing. Only jobs in Pending or Failed status
/// will proceed past the initial checks.
async fn process_single_url_job(org_id: &str, table_name: &str) -> Result<()> {
    use crate::service::db::enrichment_table::{
        get_url_jobs_for_table, notify_update, save_url_job,
    };

    // ===== MULTI-URL SUPPORT: Process all pending jobs sequentially =====
    // Fetch all jobs for this table. We process them one by one in the order they appear.
    // This ensures data is ingested in a predictable sequence.
    let all_jobs = get_url_jobs_for_table(org_id, table_name).await?;

    if all_jobs.is_empty() {
        return Err(anyhow!("No jobs found for {}/{}", org_id, table_name));
    }

    // Filter to only pending or failed jobs (skip completed/processing)
    let pending_jobs: Vec<_> = all_jobs
        .into_iter()
        .filter(|job| {
            job.status == EnrichmentTableStatus::Pending
                || job.status == EnrichmentTableStatus::Failed
        })
        .collect();

    if pending_jobs.is_empty() {
        log::info!(
            "[ENRICHMENT::URL] No pending jobs for {}/{} (all completed or processing)",
            org_id,
            table_name
        );
        return Ok(());
    }

    log::info!(
        "[ENRICHMENT::URL] Found {} pending job(s) for {}/{}, processing sequentially",
        pending_jobs.len(),
        org_id,
        table_name
    );

    // Process each job sequentially
    for mut job in pending_jobs {
        // Check if job is already being processed by another task/ingester.
        // This prevents duplicate work if multiple events are triggered for the same job.
        // The Processing state acts as a distributed lock via the database.
        if job.status == EnrichmentTableStatus::Processing {
            log::warn!(
                "[ENRICHMENT::URL] Job {} for {}/{} is already being processed, skipping",
                job.id,
                org_id,
                table_name
            );
            continue;
        }

        // Don't reprocess successfully completed jobs. This check prevents unnecessary
        // work if an event is triggered for an already-completed job (e.g., from a retry).
        if job.status == EnrichmentTableStatus::Completed {
            log::info!(
                "[ENRICHMENT::URL] Job {} for {}/{} is already completed, skipping",
                job.id,
                org_id,
                table_name
            );
            continue;
        }

        // Mark job as processing and persist to database.
        // This atomically transitions from Pending/Failed → Processing and serves as a
        // distributed lock to prevent other ingesters from picking up the same job.
        job.mark_processing();
        if let Err(e) = save_url_job(&job).await {
            log::error!(
                "[ENRICHMENT::URL] Failed to save job {} for {}/{}: {}, skipping",
                job.id,
                org_id,
                table_name,
                e
            );
            continue;
        }

        log::info!(
            "[ENRICHMENT::URL] Processing job {} for {}/{} from {} (resume capable: {}, last byte: {})",
            job.id,
            org_id,
            table_name,
            job.url,
            job.supports_range,
            job.last_byte_position
        );

        // Delegate to the main CSV processing function which handles:
        // - URL validation via HEAD request (or header fetch if resuming)
        // - Streaming CSV data in configurable chunks (with optional Range request)
        // - Batch-by-batch parsing and storage
        // - Progress tracking (bytes and records)
        let job_id = job.id.clone(); // Save ID before moving job
        let result =
            process_enrichment_table_url(org_id, table_name, &job.url, job.append_data, &job).await;

        match result {
            // ===== SUCCESS PATH =====
            Ok((records, bytes)) => {
                log::info!(
                    "[ENRICHMENT::URL] Successfully processed job {} for {}/{}: {} records, {} bytes",
                    job_id,
                    org_id,
                    table_name,
                    records,
                    bytes
                );

                // Fetch the latest job state to preserve progress updates made during processing.
                // The process_enrichment_table_url function updates progress after each batch,
                // so we need the latest state before marking as completed.
                let mut job = match crate::service::db::enrichment_table::get_url_job_by_id(&job_id)
                    .await
                {
                    Ok(Some(j)) => j,
                    Ok(None) => {
                        log::warn!(
                            "[ENRICHMENT::URL] Job {} for {}/{} not found after successful processing",
                            job_id,
                            org_id,
                            table_name
                        );
                        continue;
                    }
                    Err(e) => {
                        log::error!(
                            "[ENRICHMENT::URL] Failed to fetch job {} after success: {}",
                            job_id,
                            e
                        );
                        continue;
                    }
                };

                // Mark as completed (progress already updated during processing)
                job.mark_completed();
                if let Err(e) = save_url_job(&job).await {
                    log::error!(
                        "[ENRICHMENT::URL] Failed to mark job {} as completed: {}",
                        job_id,
                        e
                    );
                    continue;
                }

                // Broadcast NATS notification to all nodes in the cluster.
                // This is CRITICAL - we only notify after complete success. This ensures:
                // 1. All nodes refresh their in-memory enrichment table cache
                // 2. New data is immediately available for lookups across the cluster
                // 3. Partial failures don't trigger premature cache invalidation
                //
                // Note: We don't fail the job if notification fails. The data is already
                // saved; worst case, nodes will pick up changes on next periodic sync.
                let stream_name = crate::service::format_stream_name(table_name.to_string());
                if let Err(e) = notify_update(org_id, &stream_name).await {
                    log::error!("[ENRICHMENT::URL] Failed to notify update: {}", e);
                }

                // Continue to next job
            }

            // ===== FAILURE PATH with RETRY LOGIC =====
            Err(e) => {
                log::error!(
                    "[ENRICHMENT::URL] Failed to process job {} for {}/{}: {}",
                    job_id,
                    org_id,
                    table_name,
                    e
                );

                // Fetch the latest job state to preserve progress updates (last_byte_position,
                // etc.) made during processing before the failure occurred.
                let mut job =
                    match crate::service::db::enrichment_table::get_url_job_by_id(&job_id).await {
                        Ok(Some(j)) => j,
                        Ok(None) => {
                            log::warn!(
                                "[ENRICHMENT::URL] Job {} for {}/{} not found after failure",
                                job_id,
                                org_id,
                                table_name
                            );
                            continue;
                        }
                        Err(e) => {
                            log::error!(
                                "[ENRICHMENT::URL] Failed to fetch job {} after failure: {}",
                                job_id,
                                e
                            );
                            continue;
                        }
                    };

                let cfg = get_config();
                job.retry_count += 1;

                // Check if we've exhausted all retry attempts.
                // Retries are useful for transient failures like:
                // - Network timeouts
                // - Temporary DNS issues
                // - Rate limiting from the source server
                // - Brief downtime of the source URL
                if job.retry_count >= cfg.enrichment_table.url_max_retries {
                    // Permanent failure - mark job as failed with error details.
                    // The user can see this in the status API and decide whether to:
                    // 1. Fix the URL and create a new job
                    // 2. Check if the CSV format is invalid
                    // 3. Verify the URL is publicly accessible
                    job.mark_failed(format!("Failed after {} retries: {}", job.retry_count, e));
                    if let Err(e) = save_url_job(&job).await {
                        log::error!(
                            "[ENRICHMENT::URL] Failed to mark job {} as failed: {}",
                            job_id,
                            e
                        );
                    }
                    // Continue to next job despite failure
                    continue;
                } else {
                    // Still have retries left - update job state and schedule retry.
                    // We keep the job in Pending status so it can be picked up again.
                    job.increment_retry(format!(
                        "Retry {}/{}: {}",
                        job.retry_count, cfg.enrichment_table.url_max_retries, e
                    ));
                    if let Err(e) = save_url_job(&job).await {
                        log::error!(
                            "[ENRICHMENT::URL] Failed to save retry state for job {}: {}",
                            job_id,
                            e
                        );
                        continue;
                    }

                    // Schedule retry with configurable delay.
                    // Why use delay:
                    // 1. Gives transient issues time to resolve (e.g., network congestion)
                    // 2. Prevents hammering a slow/rate-limited source server
                    // 3. Reduces thundering herd if many jobs fail simultaneously
                    //
                    // Why spawn separate task:
                    // We don't want to block this function for the delay duration.
                    // The delay task sleeps, then sends a new event to trigger retry.
                    let delay = cfg.enrichment_table.url_retry_delay_secs;
                    log::info!(
                        "[ENRICHMENT::URL] Retrying job {} for {}/{} after {} seconds",
                        job_id,
                        org_id,
                        table_name,
                        delay
                    );

                    // Convert to owned strings before moving into async block.
                    // The spawned task needs 'static lifetime, so we can't pass references.
                    let org_id_owned = org_id.to_string();
                    let table_name_owned = table_name.to_string();

                    tokio::spawn(async move {
                        // Sleep for configured delay. This doesn't block the event loop
                        // because we're in a separate tokio task.
                        tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;

                        // Trigger a new event to retry the job. This goes through the
                        // same MPSC channel as the original request, maintaining consistency.
                        if let Err(e) = trigger_url_job_processing(
                            org_id_owned.clone(),
                            table_name_owned.clone(),
                        ) {
                            log::error!(
                                "[ENRICHMENT::URL] Failed to re-trigger job for {}/{}: {}",
                                org_id_owned,
                                table_name_owned,
                                e
                            );
                        }
                    });

                    // Continue to next job (this job will be retried later)
                    continue;
                }
            }
        }
    }

    // All jobs processed
    Ok(())
}

// ============================================================================
// CSV Parsing Helper
// ============================================================================

/// Result type for CSV chunk parsing: (records, headers, leftover bytes)
type CsvChunkResult = (
    Vec<json::Map<String, json::Value>>,
    Option<Vec<String>>,
    Vec<u8>,
);

/// Parses CSV data from a buffer, handling incomplete lines across chunk boundaries.
///
/// This is the core parsing logic that makes streaming large CSVs possible. HTTP chunks
/// don't align with CSV line boundaries, so this function must handle partial lines.
///
/// # How it works
///
/// 1. Finds the last complete line (ending with \n) in the buffer
/// 2. Parses all complete lines as CSV records
/// 3. Returns leftover bytes to be prepended to the next chunk
///
/// # Why this approach
///
/// When streaming a 20GB CSV, HTTP chunks might arrive like this:
/// ```text
/// Chunk 1: "name,age\nAlice,30\nBob,2"  <- Bob's line is incomplete
/// Chunk 2: "5\nCarol,40\n"                <- Continues Bob, then Carol
/// ```
///
/// Without handling incomplete lines, we'd either:
/// - Parse invalid CSV (trying to parse "Bob,2" without the rest)
/// - Buffer the entire file before parsing (OOM on large files)
///
/// This function solves it by returning "Bob,2" as leftover bytes, which get
/// prepended to "5\nCarol,40\n" in the next iteration, forming complete lines.
///
/// # Parameters
///
/// - `buffer`: Raw bytes to parse (may contain incomplete line at end)
/// - `existing_headers`: Headers from a previous chunk, or None for first chunk
///
/// # Returns
///
/// - `records`: Parsed JSON records from complete lines
/// - `headers`: Column headers (Some on first chunk only, None afterwards)
/// - `leftover`: Incomplete line bytes to prepend to next chunk
fn parse_csv_chunk(
    buffer: &[u8],
    existing_headers: Option<&Vec<String>>,
) -> Result<CsvChunkResult> {
    // Find the last newline to split complete vs incomplete lines.
    // We search from the end (rposition) for efficiency on large buffers.
    let last_newline_pos = buffer.iter().rposition(|&b| b == b'\n');

    let (complete_data, leftover) = match last_newline_pos {
        Some(pos) => {
            // Split at the last newline (inclusive of the newline itself).
            // Everything before (and including) the newline is complete.
            // Everything after is an incomplete line for the next iteration.
            let complete = &buffer[..=pos];
            let leftover = buffer[pos + 1..].to_vec();
            (complete, leftover)
        }
        None => {
            // No newline found - the entire buffer is an incomplete line.
            // This happens when:
            // 1. First HTTP chunk arrives with only partial header line
            // 2. Single CSV line exceeds chunk size (edge case, will error later)
            //
            // Return empty records and keep all bytes as leftover.
            return Ok((Vec::new(), None, buffer.to_vec()));
        }
    };

    // Configure CSV reader based on whether we've seen headers yet.
    // If existing_headers is None, this is the first chunk and we expect
    // the CSV to start with a header row. Otherwise, it's all data rows.
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(existing_headers.is_none())
        .from_reader(complete_data);

    let mut records = Vec::new();
    let mut headers = None;

    // Extract headers from the first chunk only.
    // Subsequent chunks reuse these headers to construct JSON objects.
    if existing_headers.is_none() {
        headers = Some(
            reader
                .headers()?
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>(),
        );
    }

    // Determine which headers to use for mapping CSV fields to JSON keys.
    // Use existing headers if provided, otherwise use the ones we just parsed.
    let header_vec = existing_headers
        .cloned()
        .or_else(|| headers.clone())
        .ok_or_else(|| anyhow!("No headers found in CSV"))?;

    // Parse each CSV record into a JSON object.
    // We convert all fields to strings because enrichment tables are schema-less.
    // The enrichment lookup logic handles type coercion as needed.
    for result in reader.records() {
        let record = result?;
        let mut map = json::Map::new();

        // Map each CSV field to its corresponding header name.
        // If a row has fewer fields than headers, extra headers are ignored.
        // If a row has more fields than headers, extra fields are ignored.
        for (i, field) in record.iter().enumerate() {
            if let Some(header) = header_vec.get(i) {
                map.insert(header.clone(), json::Value::String(field.to_string()));
            }
        }

        records.push(map);
    }

    Ok((records, headers, leftover))
}

// ============================================================================
// Range Request Support for Resumable Downloads
// ============================================================================

/// Public wrapper to check if a URL supports HTTP Range requests.
///
/// This is called from the API handler when a new URL job is created.
/// It creates a temporary HTTP client and delegates to the internal check function.
///
/// # Returns
///
/// - `Ok(true)`: Server supports Range requests
/// - `Ok(false)`: Server doesn't support Range requests
/// - `Err`: Network error or server error
pub async fn check_range_support_for_url(
    url: &str,
    org_id: &str,
    table_name: &str,
) -> Result<bool> {
    let cfg = get_config();
    let timeout = std::time::Duration::from_secs(cfg.enrichment_table.url_fetch_timeout_secs);

    let client = Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| anyhow!("Failed to create HTTP client: {}", e))?;

    check_range_support(&client, url, org_id, table_name).await
}

/// Checks if the server supports HTTP Range requests.
///
/// This function performs a small test range request to determine if the server
/// supports partial content downloads (HTTP 206 responses). This is essential
/// for implementing resumable downloads.
///
/// # Detection Strategy
///
/// 1. Check for `Accept-Ranges: bytes` header in HEAD response
/// 2. If header present and value is "bytes", ranges are supported
/// 3. If header says "none", ranges are explicitly not supported
/// 4. If header missing, perform test range request to confirm
///
/// # Returns
///
/// - `Ok(true)`: Server supports Range requests (returns 206)
/// - `Ok(false)`: Server doesn't support Range requests (returns 200 or lacks capability)
/// - `Err`: Network error or server error
async fn check_range_support(
    client: &Client,
    url: &str,
    org_id: &str,
    table_name: &str,
) -> Result<bool> {
    // Use HEAD request to check for Accept-Ranges header (no body transfer)
    let head_response = client.head(url).send().await?;

    if let Some(accept_ranges) = head_response.headers().get("accept-ranges")
        && let Ok(value) = accept_ranges.to_str()
    {
        if value.eq_ignore_ascii_case("bytes") {
            log::info!(
                "[ENRICHMENT::URL] {}/{} - Server advertises Range support via Accept-Ranges: bytes",
                org_id,
                table_name
            );
            return Ok(true);
        }
        if value.eq_ignore_ascii_case("none") {
            log::info!(
                "[ENRICHMENT::URL] {}/{} - Server explicitly disables Range support (Accept-Ranges: none)",
                org_id,
                table_name
            );
            return Ok(false);
        }
    }

    // SAFETY: If Accept-Ranges header is missing or unclear, assume ranges are NOT supported.
    // We cannot safely test with a GET request because if the server doesn't support ranges,
    // it will return the entire file (potentially gigabytes) which could cause memory exhaustion.
    log::warn!(
        "[ENRICHMENT::URL] {}/{} - No Accept-Ranges header found. Assuming Range requests are NOT supported for safety. File will be downloaded in one pass without resume capability.",
        org_id,
        table_name
    );

    Ok(false)
}

/// Fetches only the CSV headers from a URL using a small Range request.
///
/// This is used when resuming a download - we need the headers to know the
/// column order, but we already have the data rows. This function fetches
/// just enough bytes to capture the header row.
///
/// # Why configurable size
///
/// - Most CSV headers are < 1KB
/// - Default 8KB provides buffer for files with many columns or long column names
/// - Tiny overhead compared to GB files
/// - Conservative enough to work with most reasonable CSV files
/// - Configurable via ZO_ENRICHMENT_URL_HEADER_FETCH_SIZE env variable
///
/// # Returns
///
/// - `Ok(headers)`: Vector of column names in order
/// - `Err`: Network error, parse error, or file doesn't start with valid CSV
async fn fetch_headers_only(
    client: &Client,
    url: &str,
    org_id: &str,
    table_name: &str,
) -> Result<Vec<String>> {
    let cfg = get_config();
    let header_size = cfg.enrichment_table.url_header_fetch_size_bytes;

    log::debug!(
        "[ENRICHMENT::URL] {}/{} - Fetching headers only via Range request (0-{} bytes)",
        org_id,
        table_name,
        header_size - 1
    );

    let response = client
        .get(url)
        .header("Range", format!("bytes=0-{}", header_size - 1))
        .send()
        .await?;

    // Read the small chunk into memory
    let bytes = response.bytes().await?;

    // Find first newline to extract header row
    let header_end = bytes.iter().position(|&b| b == b'\n').ok_or_else(|| {
        anyhow!(
            "{}/{} - No newline found in first {} bytes - invalid CSV or headers too large",
            org_id,
            table_name,
            header_size
        )
    })?;

    let header_line = &bytes[..header_end];

    // Parse header row as CSV
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(header_line);

    let headers = reader
        .headers()?
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<String>>();

    log::info!(
        "[ENRICHMENT::URL] {}/{} - Fetched {} headers: {:?}",
        org_id,
        table_name,
        headers.len(),
        headers
    );

    Ok(headers)
}

// ============================================================================
// CSV Processor
// ============================================================================

/// HTTP client for fetching and processing CSV files from URLs.
///
/// This struct encapsulates the configuration and HTTP client needed for
/// streaming large CSV files. It's designed to handle files that exceed
/// available system memory by processing them in configurable chunks.
pub struct UrlCsvProcessor {
    /// Configured HTTP client with appropriate timeout settings.
    /// Using reqwest for its robust async streaming support and production-ready
    /// error handling for network issues.
    client: Client,

    /// The public URL to fetch the CSV file from.
    url: String,

    /// Maximum buffer size in bytes before processing accumulated data.
    /// This limit is critical for preventing OOM on large files. If a single
    /// CSV line exceeds this size, the fetch will fail with an error.
    chunk_size: usize,
}

impl UrlCsvProcessor {
    /// Creates a new CSV processor with configuration from global settings.
    ///
    /// # Configuration
    ///
    /// - `url_fetch_max_size_mb`: Controls memory usage. Larger values = fewer HTTP round-trips but
    ///   more memory. Default 1GB is a good balance for most scenarios.
    ///
    /// - `url_fetch_timeout_secs`: Prevents hanging on slow/stalled connections. This timeout
    ///   applies per HTTP operation (connect, read), not total duration. A 300-second default
    ///   allows fetching large chunks over slow networks while still catching truly stalled
    ///   connections.
    ///
    /// # Why panic on client creation failure
    ///
    /// Client creation only fails if the TLS backend is misconfigured or unavailable,
    /// which is a deployment issue that should be caught during startup, not runtime.
    /// We panic to fail fast and make the issue immediately visible.
    pub fn new(url: String) -> Self {
        let cfg = get_config();
        let chunk_size = cfg.enrichment_table.url_fetch_max_size_mb * 1024 * 1024;
        let timeout = std::time::Duration::from_secs(cfg.enrichment_table.url_fetch_timeout_secs);

        let client = Client::builder()
            .timeout(timeout)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            url,
            chunk_size,
        }
    }

    /// Validates that the URL is accessible and returns file size if available.
    ///
    /// This performs a HEAD request (not GET) to avoid downloading the entire file.
    /// HEAD requests fetch only the response headers, not the body, making this
    /// check fast and cheap even for multi-GB files.
    ///
    /// # Why validate before downloading
    ///
    /// 1. **Fail Fast**: Catch invalid URLs before starting the expensive download
    /// 2. **Better Error Messages**: "404 Not Found" is more actionable than "unexpected end of
    ///    stream" 10 minutes into a download
    /// 3. **Cost Optimization**: Some CDNs charge for egress. Failed validations cost almost
    ///    nothing compared to partial downloads.
    ///
    /// # Return Value
    ///
    /// Returns `Some(size)` if the server provides a Content-Length header,
    /// `None` if the header is missing (common with dynamic/chunked responses).
    /// The size can be logged for monitoring but isn't required for processing.
    pub async fn validate_url(&self) -> Result<Option<u64>> {
        let response = self.client.head(&self.url).send().await?;

        // Check HTTP status. Anything outside 2xx range is a failure.
        // Common failure codes:
        // - 403 Forbidden: URL requires authentication or is not publicly accessible
        // - 404 Not Found: Typo in URL or file was moved/deleted
        // - 500 Server Error: Source server is having issues
        if !response.status().is_success() {
            return Err(anyhow!("URL returned status: {}", response.status()));
        }

        // Try to extract Content-Length header for logging/monitoring purposes.
        // Note: This header is optional in HTTP and may be absent for:
        // - Dynamically generated content
        // - Servers using chunked transfer encoding
        // - Misconfigured servers
        //
        // We return None instead of erroring if it's missing, since we can still
        // stream the file without knowing its size upfront.
        let content_length = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        Ok(content_length)
    }

    /// Returns the URL being processed
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Fetches and parses CSV data from URL, processing each batch with a callback.
    ///
    /// This is the core streaming implementation that enables processing files
    /// larger than available RAM. It combines HTTP streaming, incremental CSV
    /// parsing, and immediate batch processing.
    ///
    /// # Algorithm Overview
    ///
    /// ```text
    /// HTTP Stream:  [chunk1][chunk2][chunk3]...
    ///                  ↓       ↓       ↓
    /// Buffer:       "name,age\nAlice,30\nBob,2" + "5\nCarol,40\n" + ...
    ///                  ↓
    /// Parser:       Extract complete lines, keep leftover bytes
    ///                  ↓
    /// Records:      [{name: Alice, age: 30}, {name: Bob, age: 25}, ...]
    ///                  ↓
    /// Batches:      When 10k records accumulated → process immediately via callback
    /// ```
    ///
    /// # Memory Management Strategy
    ///
    /// We maintain three memory bounds:
    ///
    /// 1. **HTTP Chunk Size**: Controlled by reqwest/server (typically 8-64KB)
    ///    - Small enough to yield frequently to tokio scheduler
    ///    - Large enough to amortize syscall overhead
    ///
    /// 2. **Buffer Size** (our `chunk_size`, default 1GB):
    ///    - Accumulates HTTP chunks until we have parseable CSV lines
    ///    - Grows as chunks arrive, shrinks as lines are parsed
    ///    - Hard limit to prevent unbounded growth (single line > 1GB = error)
    ///
    /// 3. **Batch Size** (10k records):
    ///    - Groups records before processing
    ///    - Balances between:
    ///       * Too small → excessive overhead per batch
    ///       * Too large → high memory usage, slow failure recovery
    ///
    /// # Why use callback instead of returning Vec
    ///
    /// We process each batch immediately via callback instead of accumulating them.
    /// This is critical for true streaming:
    ///
    /// 1. **Bounded Memory**: Only one batch (10k records) in memory at a time, not the entire 20GB
    ///    file
    ///
    /// 2. **Immediate Processing**: Each batch is saved to storage as soon as ready, providing
    ///    progress and early error detection
    ///
    /// 3. **Failure Handling**: Caller can track which batches succeeded before an error occurred
    ///
    /// # Parameters
    ///
    /// - `batch_size_records`: Max records per batch (0 = unlimited, focus on byte limit)
    /// - `batch_size_bytes`: Max bytes per batch (triggers batch save when approaching this limit)
    /// - `resume_from_byte`: Optional byte position to resume from (uses Range request if
    ///   supported)
    /// - `resume_headers`: Optional CSV headers when resuming (to maintain column order)
    /// - `on_batch`: Async callback called for each completed batch
    ///   - Parameters: (records, batch_bytes, batch_idx, total_bytes_fetched_so_far)
    ///
    /// # Returns
    ///
    /// Total number of batches processed
    ///
    /// # Resume Behavior
    ///
    /// When `resume_from_byte` is provided:
    /// - Uses HTTP Range request: `Range: bytes={resume_from_byte}-`
    /// - Expects HTTP 206 Partial Content response
    /// - Uses provided `resume_headers` instead of parsing from first chunk
    /// - If server returns 200 OK instead of 206, returns error (indicates resume not supported)
    ///
    /// # Batch Processing Strategy
    ///
    /// With batch_size_records=0 and batch_size_bytes=500MB:
    /// - Accumulates records until batch size approaches 500MB
    /// - Reduces database checkpoint frequency (fewer writes)
    /// - Balances memory usage vs. checkpoint overhead
    #[allow(clippy::too_many_arguments)]
    pub async fn fetch_and_process_batches<F, Fut>(
        &self,
        org_id: &str,
        table_name: &str,
        batch_size_records: usize,
        batch_size_bytes: u64,
        resume_from_byte: Option<u64>,
        resume_headers: Option<Vec<String>>,
        mut on_batch: F,
    ) -> Result<usize>
    where
        F: FnMut(Vec<json::Map<String, json::Value>>, u64, usize, u64) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        // Track total batches processed
        let mut batch_count = 0usize;

        // Buffer for accumulating HTTP chunks until we have complete CSV lines
        let mut buffer = Vec::new();

        // CSV column headers - use provided headers if resuming, otherwise extract from first chunk
        let mut headers: Option<Vec<String>> = resume_headers.clone();

        // Current batch being accumulated (will be processed when full)
        let mut current_batch_records = Vec::new();

        // Size tracking for current batch (for progress reporting)
        let mut total_bytes_in_batch = 0u64;

        // Build HTTP GET request with optional Range header for resume
        let mut request = self.client.get(&self.url);

        if let Some(start_byte) = resume_from_byte {
            log::info!(
                "[ENRICHMENT::URL] {}/{} - Attempting to resume download from byte {} using Range request",
                org_id,
                table_name,
                start_byte
            );
            request = request.header("Range", format!("bytes={}-", start_byte));
        } else {
            log::info!(
                "[ENRICHMENT::URL] {}/{} - Starting fresh download from {} with chunk_size={} MB",
                org_id,
                table_name,
                self.url,
                self.chunk_size / 1024 / 1024
            );
        }

        // Initiate HTTP request
        let response = request.send().await?;

        // Handle both full (200) and partial (206) responses
        let status = response.status();
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            log::info!(
                "[ENRICHMENT::URL] {}/{} - Server returned 206 Partial Content - resume successful",
                org_id,
                table_name
            );
        } else if status == reqwest::StatusCode::OK {
            if resume_from_byte.is_some() {
                // Server ignored Range request and returned full content
                // This is technically valid HTTP behavior - server can ignore Range requests
                log::warn!(
                    "[ENRICHMENT::URL] {}/{} - Server returned 200 OK despite Range request - resume not supported. Starting from beginning.",
                    org_id,
                    table_name
                );
                // Clear resume headers since we're getting the full file with headers
                headers = None;
            }
            // Normal full download
        } else {
            return Err(anyhow!(
                "{}/{} - URL returned status: {}",
                org_id,
                table_name,
                status
            ));
        }

        // Get streaming handle to response body. bytes_stream() provides
        // chunked access without buffering the entire response.
        let mut stream = response.bytes_stream();

        // Track total bytes successfully processed (excluding incomplete lines in buffer).
        // This is critical for resume functionality - we can only resume from complete CSV rows.
        let mut total_bytes_processed = 0u64;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            let chunk_len = chunk.len() as u64;

            log::debug!(
                "[ENRICHMENT::URL] {}/{} - Received HTTP chunk: {} bytes (url: {})",
                org_id,
                table_name,
                chunk_len,
                self.url
            );

            // Append chunk to buffer
            buffer.extend_from_slice(&chunk);

            // Calculate how many bytes we're about to parse (before leftover is calculated)
            let bytes_before_parse = buffer.len() as u64;

            // Parse complete lines from buffer
            let (records, parsed_headers, leftover) = parse_csv_chunk(&buffer, headers.as_ref())?;

            // Calculate how many bytes were successfully parsed (excluding leftover)
            let bytes_parsed = bytes_before_parse - leftover.len() as u64;
            total_bytes_processed += bytes_parsed;

            // If we got headers for the first time, store them
            if headers.is_none() && parsed_headers.is_some() {
                headers = parsed_headers;
                log::info!(
                    "[ENRICHMENT::URL] {}/{} - Parsed CSV headers: {:?}",
                    org_id,
                    table_name,
                    headers.as_ref().unwrap()
                );
            }

            // Keep leftover bytes for next iteration
            buffer = leftover;

            // Add records to current batch
            for record in records {
                let record_size = serde_json::to_string(&record)
                    .map(|s| s.len() as u64)
                    .unwrap_or(0);

                current_batch_records.push(record);
                total_bytes_in_batch += record_size;

                // Check if we should process this batch:
                // 1. If batch_size_records > 0, check if we've reached that limit
                // 2. Always check if we've reached the byte size limit (with 95% threshold)
                let should_process_batch = (batch_size_records > 0
                    && current_batch_records.len() >= batch_size_records)
                    || (total_bytes_in_batch >= (batch_size_bytes * 95 / 100)); // 95% threshold

                if should_process_batch {
                    let reason = if batch_size_records > 0
                        && current_batch_records.len() >= batch_size_records
                    {
                        "record limit"
                    } else {
                        "byte limit"
                    };

                    log::info!(
                        "[ENRICHMENT::URL] {}/{} - Completed batch {} with {} records, {} MB (total processed: {} MB) - triggered by {}",
                        org_id,
                        table_name,
                        batch_count + 1,
                        current_batch_records.len(),
                        total_bytes_in_batch / 1024 / 1024,
                        total_bytes_processed / 1024 / 1024,
                        reason
                    );

                    // Process batch immediately via callback
                    // Pass total_bytes_processed so caller can track resume position
                    // This excludes incomplete lines still in buffer, ensuring we can resume from a
                    // valid CSV row
                    on_batch(
                        std::mem::take(&mut current_batch_records),
                        total_bytes_in_batch,
                        batch_count,
                        total_bytes_processed,
                    )
                    .await?;

                    batch_count += 1;
                    total_bytes_in_batch = 0;
                }
            }

            // Check if we've exceeded chunk size limit
            if buffer.len() > self.chunk_size {
                return Err(anyhow!(
                    "{}/{} - Buffer size ({} bytes) exceeded chunk limit ({} bytes). Single CSV line may be too large.",
                    org_id,
                    table_name,
                    buffer.len(),
                    self.chunk_size
                ));
            }
        }

        // Process any remaining data in buffer
        // At this point, buffer contains the incomplete line(s) at the end of the file
        if !buffer.is_empty() {
            let buffer_size = buffer.len() as u64;
            total_bytes_processed += buffer_size; // Now we can count these bytes as processed

            let (records, ..) = parse_csv_chunk(&buffer, headers.as_ref())?;
            for record in records {
                let record_size = serde_json::to_string(&record)
                    .map(|s| s.len() as u64)
                    .unwrap_or(0);

                current_batch_records.push(record);
                total_bytes_in_batch += record_size;
            }
        }

        // Process final batch if it has any records
        if !current_batch_records.is_empty() {
            log::debug!(
                "[ENRICHMENT::URL] {}/{} - Final batch {} with {} records, {} bytes (total processed: {} bytes)",
                org_id,
                table_name,
                batch_count + 1,
                current_batch_records.len(),
                total_bytes_in_batch,
                total_bytes_processed
            );

            // Process final batch via callback
            // This is the last batch, so total_bytes_processed represents the complete download
            // position
            on_batch(
                current_batch_records,
                total_bytes_in_batch,
                batch_count,
                total_bytes_processed,
            )
            .await?;
            batch_count += 1;
        }

        log::info!(
            "[ENRICHMENT::URL] {}/{} - Completed fetching CSV: {} batches, {} total bytes processed",
            org_id,
            table_name,
            batch_count,
            total_bytes_processed
        );

        Ok(batch_count)
    }
}

/// Process enrichment table URL by fetching and saving in batches
///
/// Returns: (total_records, total_bytes)
///
/// This function handles both fresh downloads and resume scenarios:
/// - If job.supports_range == true and job.last_byte_position > 0: Attempts resume
/// - Otherwise: Performs fresh download from beginning
async fn process_enrichment_table_url(
    org_id: &str,
    table_name: &str,
    url: &str,
    append_data: bool,
    job: &EnrichmentTableUrlJob,
) -> Result<(i64, u64)> {
    // Create CSV processor
    let processor = UrlCsvProcessor::new(url.to_string());

    // Determine if we should attempt resume
    let should_resume = job.supports_range && job.last_byte_position > 0;

    // Fetch headers if resuming (we need them for CSV parsing since they won't be in the resumed
    // data)
    let resume_headers = if should_resume {
        log::info!(
            "[ENRICHMENT::URL] {}/{} - Attempting resume from byte {}",
            org_id,
            table_name,
            job.last_byte_position
        );

        match fetch_headers_only(&processor.client, url, org_id, table_name).await {
            Ok(headers) => {
                log::info!(
                    "[ENRICHMENT::URL] {}/{} - Fetched headers for resume: {:?}",
                    org_id,
                    table_name,
                    headers
                );
                Some(headers)
            }
            Err(e) => {
                log::warn!(
                    "[ENRICHMENT::URL] {}/{} - Failed to fetch headers for resume: {}. Will try fresh download.",
                    org_id,
                    table_name,
                    e
                );
                None
            }
        }
    } else {
        // Not resuming - either first attempt or server doesn't support ranges
        log::info!(
            "[ENRICHMENT::URL] {}/{} - Validating URL: {}",
            org_id,
            table_name,
            url
        );

        match processor.validate_url().await? {
            Some(size) => {
                log::info!(
                    "[ENRICHMENT::URL] {}/{} - URL validation successful, content-length: {} bytes ({} MB)",
                    org_id,
                    table_name,
                    size,
                    size / 1024 / 1024
                );
            }
            None => {
                log::warn!(
                    "[ENRICHMENT::URL] {}/{} - URL validation successful, but no content-length header",
                    org_id,
                    table_name
                );
            }
        }
        None
    };

    // Determine byte position to resume from
    let resume_from_byte = if should_resume && resume_headers.is_some() {
        Some(job.last_byte_position)
    } else {
        None
    };

    // Batch size: 0 means unlimited records, focus on byte limit instead
    // This reduces database checkpoint frequency while ensuring batches don't get too large
    let cfg = get_config();
    let batch_size_records = 0; // Unlimited records per batch
    let batch_size_bytes = (cfg.enrichment_table.url_fetch_max_size_mb * 1024 * 1024) as u64; // Convert MB to bytes

    log::info!(
        "[ENRICHMENT::URL] {}/{} - Fetching CSV in batches of {} MB ({} bytes)",
        org_id,
        table_name,
        cfg.enrichment_table.url_fetch_max_size_mb,
        batch_size_bytes
    );

    let started_at = chrono::Utc::now().timestamp_micros();

    // Track totals across all batches
    let total_records = std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0));
    let total_bytes = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let has_schema = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let last_batch_timestamp = std::sync::Arc::new(std::sync::atomic::AtomicI64::new(0));

    // Determine if we're resuming (important for append behavior)
    let is_resuming = resume_from_byte.is_some();

    // Clone Arc references for the callback
    let total_records_clone = total_records.clone();
    let total_bytes_clone = total_bytes.clone();
    let has_schema_clone = has_schema.clone();
    let last_batch_timestamp_clone = last_batch_timestamp.clone();

    // Clone job ID for callback (need to save progress after each batch)
    let job_id_for_save = job.id.clone();

    // Process each batch as it arrives using a callback
    let total_batches = processor
        .fetch_and_process_batches(
            org_id,
            table_name,
            batch_size_records,
            batch_size_bytes,
            resume_from_byte,
            resume_headers,
            |records, batch_bytes, batch_idx, bytes_processed_so_far| {
            // Clone variables needed in async block
            let org_id = org_id.to_string();
            let table_name = table_name.to_string();
            let job_id_for_save = job_id_for_save.clone();
            let total_records = total_records_clone.clone();
            let total_bytes = total_bytes_clone.clone();
            let has_schema = has_schema_clone.clone();
            let last_batch_timestamp = last_batch_timestamp_clone.clone();

            async move {
                let is_first_batch = batch_idx == 0;
                let record_count = records.len();

                log::info!(
                    "[ENRICHMENT::URL] {}/{} - Processing batch {}: {} records, {} bytes",
                    org_id,
                    table_name,
                    batch_idx + 1,
                    record_count,
                    batch_bytes
                );

                // Determine append behavior:
                // - If resuming: Always append (data already exists from previous attempt)
                // - If first batch and not resuming: Use user's append_data preference
                // - If subsequent batch: Always append
                let should_append = if is_resuming {
                    true // Always append when resuming to preserve existing data
                } else if is_first_batch {
                    append_data // Use user preference for first batch of fresh download
                } else {
                    true // Always append for subsequent batches
                };

                // Save batch using batch-optimized logic
                match save_enrichment_batch(
                    &org_id,
                    &table_name,
                    records,
                    should_append,
                    is_first_batch,
                )
                .await
                {
                    Ok((batch_schema, batch_timestamp)) => {
                        if is_first_batch {
                            // If first batch returned empty schema, we can't proceed
                            if batch_schema.fields().is_empty() {
                                log::error!(
                                    "[ENRICHMENT::URL] {}/{} - First batch returned empty schema, cannot proceed",
                                    org_id,
                                    table_name
                                );
                                return Err(anyhow!(
                                    "{}/{} - First batch returned empty schema, cannot store enrichment table",
                                    org_id,
                                    table_name
                                ));
                            }
                            has_schema.store(true, std::sync::atomic::Ordering::Relaxed);
                        }

                        // Store the timestamp from this batch (will be used as end_time after all batches)
                        last_batch_timestamp.store(batch_timestamp, std::sync::atomic::Ordering::Relaxed);

                        // Update totals
                        total_records.fetch_add(record_count as i64, std::sync::atomic::Ordering::Relaxed);
                        total_bytes.fetch_add(batch_bytes, std::sync::atomic::Ordering::Relaxed);

                        log::info!(
                            "[ENRICHMENT::URL] {}/{} - Successfully saved batch {}",
                            org_id,
                            table_name,
                            batch_idx + 1
                        );

                        // Save progress checkpoint after successful batch save
                        // This allows resume from this position if the job fails later
                        // Calculate absolute byte position (add resume offset if resuming)
                        let absolute_byte_position = resume_from_byte.unwrap_or(0) + bytes_processed_so_far;

                        if let Ok(Some(mut current_job)) = db::enrichment_table::get_url_job_by_id(&job_id_for_save).await {
                            current_job.last_byte_position = absolute_byte_position;
                            current_job.total_bytes_fetched = absolute_byte_position;
                            current_job.total_records_processed += record_count as i64;

                            if let Err(e) = db::enrichment_table::save_url_job(&current_job).await {
                                // Log error but don't fail the batch - progress tracking is best-effort
                                log::warn!(
                                    "[ENRICHMENT::URL] {}/{} (job {}) - Failed to save progress checkpoint: {}",
                                    org_id,
                                    table_name,
                                    job_id_for_save,
                                    e
                                );
                            } else {
                                log::debug!(
                                    "[ENRICHMENT::URL] {}/{} (job {}) - Saved progress checkpoint at byte {}",
                                    org_id,
                                    table_name,
                                    job_id_for_save,
                                    absolute_byte_position
                                );
                            }
                        }

                        Ok(())
                    }
                    Err(e) => {
                        log::error!(
                            "[ENRICHMENT::URL] {}/{} - Failed to save batch {}: {}",
                            org_id,
                            table_name,
                            batch_idx + 1,
                            e
                        );
                        Err(anyhow!(
                            "{}/{} - Failed to save batch {}: {}",
                            org_id,
                            table_name,
                            batch_idx + 1,
                            e
                        ))
                    }
                }
            }
        })
        .await?;

    if total_batches == 0 {
        return Err(anyhow!(
            "{}/{} - No data found in CSV file",
            org_id,
            table_name
        ));
    }

    // Extract final totals
    let final_total_records = total_records.load(std::sync::atomic::Ordering::Relaxed);
    let final_total_bytes = total_bytes.load(std::sync::atomic::Ordering::Relaxed);

    log::info!(
        "[ENRICHMENT::URL] {}/{} - Processed {} batches from URL ({} records, {} bytes)",
        org_id,
        table_name,
        total_batches,
        final_total_records,
        final_total_bytes
    );

    // Now that all batches are processed, update meta stats and notify
    // We need to get the schema from the stream_schema_map since we can't pass it from callback
    let stream_name = crate::service::format_stream_name(table_name.to_string());
    // Use the timestamp from the last batch instead of generating a new one
    let timestamp = last_batch_timestamp.load(std::sync::atomic::Ordering::Relaxed);

    log::info!(
        "[ENRICHMENT::URL] {}/{} - All batches processed. Updating meta stats and notifying",
        org_id,
        table_name
    );

    // Get schema from stream_schema_map
    use std::collections::HashMap;

    use config::meta::stream::StreamType;

    use crate::service::schema::stream_schema_exists;

    let mut stream_schema_map: HashMap<String, infra::schema::SchemaCache> = HashMap::new();
    stream_schema_exists(
        org_id,
        &stream_name,
        StreamType::EnrichmentTables,
        &mut stream_schema_map,
    )
    .await;

    let schema = stream_schema_map
        .get(&stream_name)
        .map(|s| s.schema().as_ref().clone())
        .unwrap_or(arrow_schema::Schema::empty());

    // Calculate total expected size
    let current_size_in_bytes = if append_data {
        db::enrichment_table::get_table_size(org_id, &stream_name).await
    } else {
        0.0
    };
    let total_expected_size_in_bytes = current_size_in_bytes + final_total_bytes as f64;

    // Update meta table stats
    let mut enrich_meta_stats = db::enrichment_table::get_meta_table_stats(org_id, &stream_name)
        .await
        .unwrap_or_default();

    if !append_data {
        enrich_meta_stats.start_time = started_at;
    }
    if enrich_meta_stats.start_time == 0 {
        enrich_meta_stats.start_time =
            db::enrichment_table::get_start_time(org_id, &stream_name).await;
    }
    enrich_meta_stats.end_time = timestamp;
    enrich_meta_stats.size = total_expected_size_in_bytes as i64;

    // The stream_stats table takes some time to update, so we need to update the enrichment table
    // size in the meta table to avoid exceeding the `ZO_ENRICHMENT_TABLE_LIMIT`.
    if let Err(e) =
        db::enrichment_table::update_meta_table_stats(org_id, &stream_name, enrich_meta_stats).await
    {
        log::error!(
            "[ENRICHMENT::URL] {}/{} - Error updating meta table stats: {}",
            org_id,
            table_name,
            e
        );
    }

    // Notify update
    if !schema.fields().is_empty()
        && let Err(e) = db::enrichment_table::notify_update(org_id, &stream_name).await
    {
        log::error!(
            "[ENRICHMENT::URL] {}/{} - Error notifying enrichment table update: {}",
            org_id,
            table_name,
            e
        );
    }

    log::info!(
        "[ENRICHMENT::URL] {}/{} - Completed processing: {} total records, {} total bytes",
        org_id,
        table_name,
        final_total_records,
        final_total_bytes
    );

    Ok((final_total_records, final_total_bytes))
}

/// Batch-optimized version of save_enrichment_data for URL processing.
///
/// This function is designed to efficiently process multiple batches:
/// - For first batch: validates schema and handles create/replace logic
/// - For all batches: performs threshold-based storage (database vs remote)
/// - Skips local storage (done once at the end)
/// - Skips meta stats updates and notifications (done once at the end)
///
/// Returns a tuple of (schema, timestamp) where timestamp is the one used for all records in this
/// batch.
async fn save_enrichment_batch(
    org_id: &str,
    table_name: &str,
    payload: Vec<json::Map<String, json::Value>>,
    append_data: bool,
    is_first_batch: bool,
) -> Result<(arrow_schema::Schema, i64)> {
    use std::collections::HashMap;

    use config::{
        SIZE_IN_MB, TIMESTAMP_COL_NAME,
        cluster::LOCAL_NODE,
        meta::stream::StreamType,
        utils::{json, schema::infer_json_schema_from_map, time::BASE_TIME},
    };

    use crate::service::{
        db, format_stream_name,
        schema::{check_for_schema, stream_schema_exists},
    };

    let stream_name = format_stream_name(table_name.to_string());

    if !LOCAL_NODE.is_ingester() {
        return Err(anyhow!("not an ingester"));
    }

    // Check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(
        org_id,
        StreamType::EnrichmentTables,
        &stream_name,
        None,
    ) {
        return Err(anyhow!("enrichment table [{stream_name}] is being deleted"));
    }

    // For first batch only, handle schema validation and deletion if not appending
    let mut stream_schema_map: HashMap<String, infra::schema::SchemaCache> = HashMap::new();

    if is_first_batch {
        let stream_schema = stream_schema_exists(
            org_id,
            &stream_name,
            StreamType::EnrichmentTables,
            &mut stream_schema_map,
        )
        .await;

        if stream_schema.has_fields && !append_data {
            let start_time = BASE_TIME.timestamp_micros();
            let now = chrono::Utc::now().timestamp_micros();
            super::delete_enrichment_table(
                org_id,
                &stream_name,
                StreamType::EnrichmentTables,
                (start_time, now),
            )
            .await;
            stream_schema_map.remove(&stream_name);
        }
    } else {
        // For subsequent batches, load existing schema
        stream_schema_exists(
            org_id,
            &stream_name,
            StreamType::EnrichmentTables,
            &mut stream_schema_map,
        )
        .await;
    }

    // Prepare records with timestamp
    let mut records = vec![];
    let mut records_size = 0;
    let timestamp = chrono::Utc::now().timestamp_micros();

    for mut json_record in payload {
        // Use now as _timestamp in the json records
        json_record.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number(timestamp.into()),
        );

        let record = json::Value::Object(json_record);
        let record_size = json::estimate_json_bytes(&record);
        records.push(record);
        records_size += record_size;
    }

    let mut record_vals = vec![];
    for record in records.iter() {
        record_vals.push(record.as_object().unwrap());
    }

    // For first batch, validate schema compatibility
    if is_first_batch {
        let value_iter = record_vals.iter().take(1).cloned().collect::<Vec<_>>();
        let inferred_schema =
            infer_json_schema_from_map(value_iter.into_iter(), StreamType::EnrichmentTables)
                .map_err(|e| anyhow!("Error inferring schema: {}", e))?;

        let db_schema = stream_schema_map
            .get(&stream_name)
            .map(|s| s.schema().as_ref().clone())
            .unwrap_or(arrow_schema::Schema::empty());

        if !db_schema.fields().is_empty() && db_schema.fields().ne(inferred_schema.fields()) {
            return Err(anyhow!(
                "Schema mismatch for enrichment table {org_id}/{stream_name}"
            ));
        }
    }

    // Check for schema evolution
    check_for_schema(
        org_id,
        &stream_name,
        StreamType::EnrichmentTables,
        &mut stream_schema_map,
        record_vals,
        timestamp,
        false,
    )
    .await
    .map_err(|e| anyhow!("Error checking schema: {}", e))?;

    if records.is_empty() {
        // Return empty schema if no records
        return Ok((arrow_schema::Schema::empty(), timestamp));
    }

    let schema = stream_schema_map
        .get(&stream_name)
        .ok_or_else(|| anyhow!("Schema not found after check_for_schema"))?
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());

    // If this is the first batch and schema is empty, return it immediately
    if is_first_batch && schema.fields().is_empty() {
        return Ok((schema, timestamp));
    }

    // Store data based on size threshold
    // If data size is less than the merge threshold, store in database
    // Otherwise, store directly to remote storage
    let merge_threshold_mb = crate::service::enrichment::storage::remote::get_merge_threshold_mb()
        .await
        .unwrap_or(100) as f64;

    if (records_size as f64) < merge_threshold_mb * SIZE_IN_MB {
        crate::service::enrichment::storage::database::store(
            org_id,
            &stream_name,
            &records,
            timestamp,
        )
        .await
        .map_err(|e| anyhow!("Error writing enrichment table to database: {}", e))?;
    } else {
        crate::service::enrichment::storage::remote::store(
            org_id,
            &stream_name,
            &records,
            timestamp,
        )
        .await
        .map_err(|e| anyhow!("Error writing enrichment table to remote storage: {}", e))?;
    }

    // Note: We skip local storage here - it will be done once at the end for efficiency
    // Note: We skip meta stats updates and notifications here - done once at the end

    Ok((schema, timestamp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mpsc_trigger() {
        let result = trigger_url_job_processing("test_org".to_string(), "test_table".to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_csv_chunk_complete_lines() {
        let csv_data = b"name,age,city\nAlice,30,NYC\nBob,25,LA\n";
        let (records, headers, leftover) = parse_csv_chunk(csv_data, None).unwrap();

        assert_eq!(headers.as_ref().unwrap().len(), 3);
        assert_eq!(headers.as_ref().unwrap()[0], "name");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].get("name").unwrap().as_str().unwrap(), "Alice");
        assert_eq!(records[1].get("name").unwrap().as_str().unwrap(), "Bob");
        assert_eq!(leftover.len(), 0);
    }

    #[test]
    fn test_parse_csv_chunk_incomplete_line() {
        let csv_data = b"name,age,city\nAlice,30,NYC\nBob,25";
        let (records, headers, leftover) = parse_csv_chunk(csv_data, None).unwrap();

        assert_eq!(headers.as_ref().unwrap().len(), 3);
        assert_eq!(records.len(), 1); // Only Alice is complete
        assert_eq!(records[0].get("name").unwrap().as_str().unwrap(), "Alice");
        assert_eq!(leftover, b"Bob,25"); // Bob's incomplete line is leftover
    }

    #[test]
    fn test_parse_csv_chunk_with_existing_headers() {
        let headers = vec!["name".to_string(), "age".to_string(), "city".to_string()];
        let csv_data = b"Charlie,35,SF\nDiana,28,Boston\n";
        let (records, parsed_headers, leftover) =
            parse_csv_chunk(csv_data, Some(&headers)).unwrap();

        assert!(parsed_headers.is_none()); // Headers should not be parsed again
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].get("name").unwrap().as_str().unwrap(), "Charlie");
        assert_eq!(records[1].get("name").unwrap().as_str().unwrap(), "Diana");
        assert_eq!(leftover.len(), 0);
    }

    #[test]
    fn test_parse_csv_chunk_no_complete_lines() {
        let csv_data = b"name,age";
        let (records, headers, leftover) = parse_csv_chunk(csv_data, None).unwrap();

        assert!(headers.is_none());
        assert_eq!(records.len(), 0);
        assert_eq!(leftover, csv_data);
    }

    #[test]
    fn test_parse_csv_chunk_empty_buffer() {
        let csv_data = b"";
        let (records, headers, leftover) = parse_csv_chunk(csv_data, None).unwrap();

        assert!(headers.is_none());
        assert_eq!(records.len(), 0);
        assert_eq!(leftover.len(), 0);
    }
}
