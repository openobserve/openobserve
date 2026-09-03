use infra::db::get_orm_client_ro;

use super::*;

// ── Runs API ──────────────────────────────────────────────────────────────────

/// One run in the list response. `status` is a human-readable string derived from `run_result`.
#[derive(Debug, Serialize)]
pub struct RunSummary {
    pub id: String,
    pub synthetics_id: String,
    pub org_id: String,
    pub scheduled_ts: i64,
    pub trigger_type: String,
    pub job_count: i32,
    pub jobs_done: i32,
    pub run_result: Option<i32>,
    /// Derived from run_result: "passed"|"warning"|"failed"|"error"|"pending"
    pub status: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ListRunsResponse {
    pub runs: Vec<RunSummary>,
    pub total: i64,
}

pub(crate) fn run_result_to_status(run_result: Option<i32>) -> &'static str {
    match run_result {
        Some(1) => "passed",
        Some(2) => "warning",
        Some(3) => "failed",
        Some(4) => "error",
        _ => "pending",
    }
}

pub(crate) fn row_to_summary(row: synthetics_runs::RunRow) -> RunSummary {
    let status = run_result_to_status(row.run_result).to_string();
    RunSummary {
        id: row.id,
        synthetics_id: row.synthetics_id,
        org_id: row.org_id,
        scheduled_ts: row.scheduled_ts,
        trigger_type: row.trigger_type,
        job_count: row.job_count,
        jobs_done: row.jobs_done,
        run_result: row.run_result,
        status,
        created_at: row.created_at,
        completed_at: row.completed_at,
    }
}

/// ⚠️ Region-local, and there is no way to make it otherwise: `synthetics_runs`
/// is never replicated (spec §3 — `jobs_done` is a counter, two copies produce
/// runs that never complete), and rows in a table are not reachable by
/// federated search the way `synthetics_results` is. Outside the region whose
/// scheduler enqueued the work this returns an empty list, not a short one.
///
/// No live-status marker is attached, unlike [`LocationEntry`], because nothing
/// consumes this: the UI reads run history by querying the `synthetics_results`
/// stream (`syntheticResultsSchema.ts`), which IS federated by default, and
/// `syntheticsService.getRuns` has no callers. The gap is real for a direct API
/// client and is deliberately left as a documented one rather than answered
/// with a field no reader would check.
pub async fn list_runs(
    org_id: &str,
    synthetics_id: &str,
    start_time: Option<i64>,
    end_time: Option<i64>,
    page: i64,
    page_size: i64,
) -> anyhow::Result<ListRunsResponse> {
    let conn = get_orm_client_ro().await;
    let (rows, total) = synthetics_runs::list_runs(
        conn,
        synthetics_runs::ListRunsParams {
            org_id,
            synthetics_id,
            start_time,
            end_time,
            page,
            page_size,
        },
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    Ok(ListRunsResponse {
        runs: rows.into_iter().map(row_to_summary).collect(),
        total,
    })
}

pub async fn get_run_detail(
    org_id: &str,
    synthetics_id: &str,
    run_id: &str,
) -> anyhow::Result<Option<RunSummary>> {
    let conn = get_orm_client_ro().await;
    let row = synthetics_runs::get_run(conn, run_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Verify the run belongs to this org and check.
    Ok(row
        .filter(|r| r.org_id == org_id && r.synthetics_id == synthetics_id)
        .map(row_to_summary))
}
