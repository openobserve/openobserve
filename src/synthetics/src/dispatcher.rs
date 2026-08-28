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

//! Synthetics dispatcher — leases pending checks and invokes probes via AWS Lambda.
//!
//! Runs every 2 seconds on scheduler nodes. For each pool it leases a batch
//! of pending checks and spawns an `invoke_probe` task per row.
//!
//! Region is derived from the job's `location` field (e.g. `aws-us-east-1` → `us-east-1`).
//! Lambda clients are cached per region to avoid recreating SDK clients on every tick.

use std::{
    sync::{Arc, LazyLock},
    time::Duration,
};

use aws_config::{BehaviorVersion, Region};
use aws_sdk_lambda::{Client as LambdaClient, primitives::Blob};
use dashmap::DashMap;
use infra::{
    db::get_orm_client_rw,
    table::{synthetics_checks, synthetics_jobs, synthetics_runs},
};

const TICK: Duration = Duration::from_secs(2);
const LEASE_BATCH_SIZE: i64 = 10;
/// How long a leased job may run before the reaper requeues it
/// (`reaper::requeue_expired`).
///
/// Must satisfy `(retries + 1) x journey_budget_ms + retries x
/// wait_before_retry_secs <= lease`, and the AWS Lambda function timeout must
/// be >= it or runs are killed mid-journey. That timeout is infrastructure
/// config, outside every repository, so no test can assert it.
///
/// Read per lease, not held as a constant: `const LEASE_SECS = 900` used to
/// override `ZO_SYNTHETICS_JOB_LEASE_SECS` outright, so a deployment that
/// lowered the lease still handed out 900s ones. `limits()` is the same source
/// `lease_batch` floors against, republished on every config reload.
fn lease_secs() -> i64 {
    config::get_config().synthetics.job_lease_secs
}

/// Pools the dispatcher serves — the Lambda venue. Evaluated per tick so
/// config/registry changes take effect without restart:
///   - `aws-browser` when a browser Lambda fn is configured (browser is Lambda-only)
///   - public `net-*` pools from the location registry when a net Lambda fn is configured
///     (`ZO_SYNTHETICS_LAMBDA_NET`, empty on self-hosted) — the per-deployment venue choice for
///     protocol checks
///
/// Everything else (agent-served `net-*` pools, `private-*` pools) is never
/// leased here: persistent agents pull those via `/synthetics/jobs/lease`.
async fn dispatcher_pools() -> Vec<String> {
    let cfg = config::get_config();
    let mut pools = Vec::new();
    if !cfg.synthetics.lambda_browser.is_empty() {
        pools.push("aws-browser".to_string());
    }
    if !cfg.synthetics.lambda_net.is_empty() {
        // Public rows only — list_visible("") matches no private org.
        if let Ok(locations) = infra::table::synthetics_locations::list_visible("").await {
            pools.extend(
                locations
                    .into_iter()
                    .filter(|l| l.enabled && l.org_id.is_none() && l.pool.starts_with("net-"))
                    .map(|l| l.pool),
            );
        }
    }
    pools
}

/// Cache of Lambda clients keyed by AWS region string.
static LAMBDA_CLIENTS: LazyLock<DashMap<String, Arc<LambdaClient>>> = LazyLock::new(DashMap::new);

/// This dispatcher's lease identity. Random per process so two scheduler
/// nodes never claim to be each other, and stable within it so `mark_failure` can
/// prove it still owns the row it is completing — the ack now carries the holder
/// and the server checks it.
static INSTANCE_ID: LazyLock<String> = LazyLock::new(|| {
    format!(
        "dispatcher-{}",
        config::utils::rand::generate_random_string(8)
    )
});

pub async fn run() {
    let instance_id = INSTANCE_ID.as_str();
    tracing::info!(instance_id = %instance_id, "[synthetics dispatcher] started");

    loop {
        tokio::time::sleep(TICK).await;

        let db = get_orm_client_rw().await;

        let now_us = config::utils::time::now_micros();

        for pool in dispatcher_pools().await {
            let rows = match synthetics_jobs::lease_batch(
                db,
                &pool,
                instance_id,
                LEASE_BATCH_SIZE,
                now_us,
                lease_secs(),
                None, // public pools are already type-segmented (net-* vs aws-browser)
            )
            .await
            {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(pool = %pool, "[synthetics dispatcher] lease_batch: {e}");
                    continue;
                }
            };

            for row in rows {
                tokio::spawn(invoke_probe(row));
            }
        }
    }
}

/// Returns (or lazily creates) a Lambda client for the given AWS region.
async fn lambda_client_for_region(region: &str) -> Arc<LambdaClient> {
    if let Some(client) = LAMBDA_CLIENTS.get(region) {
        return client.clone();
    }
    let aws_cfg = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(region.to_owned()))
        .load()
        .await;
    let client = Arc::new(LambdaClient::new(&aws_cfg));
    LAMBDA_CLIENTS.insert(region.to_owned(), client.clone());
    client
}

/// Parses the AWS region from a location string.
/// `aws-us-east-1` → `us-east-1`, `aws-eu-west-1` → `eu-west-1`.
/// Returns None for non-AWS or malformed location strings.
fn aws_region_from_location(location: &str) -> Option<&str> {
    location.strip_prefix("aws-")
}

/// Maps pool name → configured Lambda function name.
fn lambda_fn_for_pool(pool: &str) -> Option<String> {
    let cfg = config::get_config();
    let name = match pool {
        "aws-browser" => cfg.synthetics.lambda_browser.clone(),
        // Public protocol pools (net-<location>) go to the net Lambda when one
        // is configured; empty name falls through to None (agent-served).
        p if p.starts_with("net-") => cfg.synthetics.lambda_net.clone(),
        _ => return None,
    };
    if name.is_empty() { None } else { Some(name) }
}

/// Marks the job as Error and increments the run counter. Called when Lambda dispatch fails.
///
/// Returns `false` when the failure was NOT recorded because the ack did not apply
/// — the job has already been completed, or it is held by someone else now. The
/// caller must then not report it either.
///
/// Honouring that is the whole point: `increment_jobs_done` used to run whether or
/// not the ack applied, which is the exact double-count the ack's status guard
/// exists to prevent — `jobs_done` overshoots `job_count`, the run is declared
/// complete on a partial set of results, and the alert streak advances twice for
/// one failure. The ownership guard adds a second way for an ack not to apply, so
/// ignoring the result is no longer survivable.
/// Reasons a dispatch was abandoned before the probe was ever invoked. These
/// land in the job's `result` so the run says why, instead of a bare "error"
/// whose only explanation is a WARN on whichever scheduler node leased the row.
pub(crate) const REASON_NO_PROBE_TOKEN: &str = "no probe token for this organisation";
pub(crate) const REASON_NO_REGION: &str = "cannot derive an AWS region from the job's location";
pub(crate) const REASON_NO_LAMBDA: &str = "no Lambda function configured for this pool";
pub(crate) const REASON_NO_INGEST_TOKEN: &str = "no enabled ingest token for this organisation";
pub(crate) const REASON_TOKEN_LOOKUP: &str = "token lookup failed";

/// Creates the org's default probe token. Returns the token, or None if it
/// could not be created and no concurrent creator won the race.
async fn mint_default_token(org_id: &str) -> Option<String> {
    match infra::table::synthetics_probe_tokens::create_for_org(org_id, "system:dispatcher").await {
        Ok(_record) => {
            tracing::info!(
                org_id = %org_id,
                "[synthetics dispatcher] org had no default probe token — minted one"
            );
            // The one token write on the dispatch path, and it has to replicate
            // for the same reason a UI-created one does: this token is handed
            // to a Lambda probe, and the probe calls back through whatever
            // endpoint it was given, which need not be this region. A token
            // minted here and nowhere else is the §8 401 with extra steps.
            //
            // Not a per-run publish: `find_default` above returned nothing,
            // which for any org created after the probe-token table shipped
            // never happens — this is the backfill path for older orgs, and it
            // fires at most once per org.
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
            {
                // Logged, not propagated: the local token is usable and the
                // caller's job can still dispatch. Failing the dispatch because
                // a broker was briefly unreachable would trade a cross-region
                // gap for a missed check run in this one.
                if let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::synthetics_probe_token_create(
                        (&_record).into(),
                    )
                    .await
                {
                    tracing::error!(
                        org_id = %org_id,
                        "[synthetics dispatcher] replicating the minted probe token failed: {e}"
                    );
                }
            }
        }
        Err(e) => {
            // A unique-constraint violation means a peer dispatcher created it
            // between our lookup and this insert. That is success, not failure,
            // so fall through to the re-read either way and let it decide.
            tracing::warn!(
                org_id = %org_id,
                "[synthetics dispatcher] minting default probe token: {e}"
            );
        }
    }
    match infra::table::synthetics_probe_tokens::find_default(org_id).await {
        Ok(Some(t)) => Some(t.token),
        Ok(None) => {
            tracing::error!(
                org_id = %org_id,
                "[synthetics dispatcher] no default probe token after minting — skipping"
            );
            None
        }
        Err(e) => {
            tracing::error!(
                org_id = %org_id,
                "[synthetics dispatcher] probe token re-read after minting failed: {e}"
            );
            None
        }
    }
}

async fn mark_failure(row: &synthetics_jobs::LeasedRow, reason: Option<&str>) -> bool {
    let db = get_orm_client_rw().await;
    let now_us = config::utils::time::now_micros();
    // SyntheticStatus Error = DB int 4; job status Error = 6.
    //
    // Acks as this dispatcher, which is who leased the row moments ago. If the
    // row has since been reassigned, the ownership guard drops this ack — correct,
    // because the new holder is the one that will report on it.
    // The reason rides on the job's `result` so the failure explains itself.
    // Without it a dispatch that never reached the probe is indistinguishable
    // from one that ran and failed — both surface as a bare "error".
    let result_json =
        reason.map(|r| serde_json::json!({ "error": r, "error_source": "dispatch" }).to_string());
    let acked = match synthetics_jobs::ack_complete(
        db,
        &row.id,
        6,
        result_json.as_deref(),
        now_us,
        Some(INSTANCE_ID.as_str()),
    )
    .await
    {
        Ok(acked) => acked,
        Err(e) => {
            tracing::error!(synthetics_id = %row.synthetics_id, run_id = %row.run_id, job_id = %row.id, "[synthetics dispatcher] ack_complete: {e}");
            return false;
        }
    };
    if acked.is_none() {
        tracing::warn!(
            synthetics_id = %row.synthetics_id,
            run_id = %row.run_id,
            job_id = %row.id,
            "[synthetics dispatcher] dispatch failure not recorded: job is no longer ours to complete"
        );
        return false;
    }
    if let Err(e) = synthetics_runs::increment_jobs_done(db, &row.run_id, 4, now_us).await {
        tracing::error!(synthetics_id = %row.synthetics_id, run_id = %row.run_id, job_id = %row.id, "[synthetics dispatcher] increment_jobs_done: {e}");
    }
    // The bool is whether the status actually changed. Publishing on that — not
    // on the write — is what keeps this off the per-run traffic budget: a check
    // that is already failing re-reports 4 on every dispatch failure and sends
    // nothing, while the first failure after a pass sends one message. Without
    // it the other regions' LIST would keep showing the last status they
    // themselves ran, or "Unknown".
    match synthetics_checks::update_last_check_status(db, &row.synthetics_id, 4).await {
        Ok(true) => {
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
                && let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::synthetics_check_last_status(
                        &row.org_id,
                        &row.synthetics_id,
                        4,
                    )
                    .await
            {
                // Logged, not returned: this function's caller reads the bool as
                // "the failure was recorded", and it was. A replication hiccup
                // must not make it look otherwise.
                tracing::warn!(synthetics_id = %row.synthetics_id, run_id = %row.run_id, job_id = %row.id, "[synthetics dispatcher] super-cluster last_check_status publish: {e}");
            }
        }
        // Unchanged — the steady state, and deliberately silent.
        Ok(false) => {}
        Err(e) => {
            tracing::error!(synthetics_id = %row.synthetics_id, run_id = %row.run_id, job_id = %row.id, "[synthetics dispatcher] update_last_check_status: {e}");
        }
    }
    true
}

/// POSTs one failure record per browser×device combo to the synthetics_results stream.
/// Falls back to a single record when no browser_devices are present (e.g. net probes).
/// Minimal subset of a browser_devices entry — only the fields stored in the DB JSON.
/// BrowserDeviceEntry from job_api also carries `viewport` which is not persisted,
/// so we use this local struct to avoid silent deserialization failures.
#[derive(serde::Deserialize)]
struct StoredBdEntry {
    execution_id: String,
    engine: String,
    device: String,
}

async fn report_to_stream(
    row: &synthetics_jobs::LeasedRow,
    ingest_token: &str,
    api_endpoint: &str,
    error_msg: &str,
) {
    let now_us = config::utils::time::now_micros();
    let meta: infra::table::synthetics_jobs::JobMetadata =
        serde_json::from_str(&row.metadata).unwrap_or_default();
    let tags = serde_json::json!(meta.tags);

    // Parse browser_devices so each combo gets its own stream record with engine/device set.
    let bds: Vec<StoredBdEntry> = row
        .browser_devices
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let records: Vec<serde_json::Value> = if bds.is_empty() {
        vec![serde_json::json!({
            "_timestamp": now_us,
            "job_id": row.id,
            "run_id": row.run_id,
            // Protocol checks have no engine/device fan-out: execution_id ==
            // job_id (same fallback as job_api resolve). Without it the UI
            // can't open the run-detail drawer for this row.
            "execution_id": row.id,
            "scheduled_ts": row.scheduled_ts,
            "trigger_type": "schedule",
            "type": meta.synthetic_type,
            "synthetics_id": row.synthetics_id,
            "synthetics_name": row.synthetics_name,
            "tags": tags,
            "org_id": row.org_id,
            "location": row.location,
            "status": "error",
            // A7: `error` covers two structurally different records — the probe
            // never ran (control plane wrote this), or the probe ran and
            // crashed (probe wrote it). They used to be told apart only by
            // sniffing which fields happened to be present.
            "error_source": "dispatch",
            "error": error_msg,
            "response_time_ms": 0,
            "dispatch_attempt": row.dispatch_attempts
        })]
    } else {
        bds.iter()
            .map(|bd| {
                serde_json::json!({
                    "_timestamp": now_us,
                    "job_id": row.id,
                    "run_id": row.run_id,
                    "scheduled_ts": row.scheduled_ts,
                    "trigger_type": "schedule",
                    "type": meta.synthetic_type,
                    "execution_id": bd.execution_id,
                    "engine": bd.engine,
                    "device": bd.device,
                    "synthetics_id": row.synthetics_id,
                    "synthetics_name": row.synthetics_name,
                    "tags": tags,
                    "org_id": row.org_id,
                    "location": row.location,
                    "status": "error",
                    "error_source": "dispatch",
                    "error": error_msg,
                    "response_time_ms": 0,
                    "dispatch_attempt": row.dispatch_attempts
                })
            })
            .collect()
    };

    let payload = serde_json::Value::Array(records);
    let url = format!(
        "{}/api/{}/synthetics_results/_json",
        api_endpoint, row.org_id
    );
    let client = reqwest::Client::new();
    if let Err(e) = client
        .post(&url)
        .basic_auth("ingest", Some(ingest_token))
        .json(&payload)
        .send()
        .await
    {
        tracing::error!(
            synthetics_id = %row.synthetics_id,
            run_id = %row.run_id,
            job_id = %row.id,
            "[synthetics dispatcher] stream write failed: {e}"
        );
    }
}

/// Invokes the browser probe Lambda for a leased check row.
async fn invoke_probe(row: synthetics_jobs::LeasedRow) {
    // Derive AWS region from the job's location field.
    let region = match aws_region_from_location(&row.location) {
        Some(r) => r.to_owned(),
        None => {
            tracing::warn!(
                job_id = %row.id,
                location = %row.location,
                "[synthetics dispatcher] cannot derive AWS region from location — skipping"
            );
            let _ = mark_failure(&row, Some(REASON_NO_REGION)).await;
            return;
        }
    };

    let fn_name = match lambda_fn_for_pool(&row.pool) {
        Some(name) => name,
        None => {
            tracing::warn!(
                job_id = %row.id,
                pool = %row.pool,
                "[synthetics dispatcher] no Lambda function configured for pool — skipping"
            );
            let _ = mark_failure(&row, Some(REASON_NO_LAMBDA)).await;
            return;
        }
    };

    // o2syn_ token from dedicated synthetics_probe_tokens table.
    //
    // Minted here when absent rather than skipping. `create_for_org` is the only
    // thing that sets `is_default`, and it runs at org creation — so an org that
    // missed it could never dispatch again: `create_agent_token` hardcodes
    // `is_default: false` and refuses the reserved name, meaning no API call
    // could produce a token `find_default` would select. Orgs whose locations
    // are all public never hit the private-location setup path that would
    // otherwise surface one, so this was reachable in normal use, not just on a
    // broken bootstrap.
    //
    // Safe to do here: reaching this line means the org has an enabled location
    // and a scheduled job, which is the same entitlement org creation would have
    // granted. `add` invalidates and publishes the token cache, so peers see it
    // without waiting for the TTL.
    let probe_token = match infra::table::synthetics_probe_tokens::find_default(&row.org_id).await {
        Ok(Some(t)) => t.token,
        Ok(None) => match mint_default_token(&row.org_id).await {
            Some(t) => t,
            None => {
                let _ = mark_failure(&row, Some(REASON_NO_PROBE_TOKEN)).await;
                return;
            }
        },
        Err(e) => {
            tracing::error!(
                job_id = %row.id,
                org_id = %row.org_id,
                "[synthetics dispatcher] probe token lookup failed: {e}"
            );
            let _ = mark_failure(&row, Some(REASON_TOKEN_LOOKUP)).await;
            return;
        }
    };

    // o2oi_ token from org_ingestion_tokens — probe uses for ingest
    let ingest_token =
        match infra::table::org_ingestion_tokens::find_default_enabled(&row.org_id).await {
            Ok(found) => match found {
                Some(t) => t.token,
                None => {
                    tracing::warn!(
                        job_id = %row.id,
                        org_id = %row.org_id,
                        "[synthetics dispatcher] no enabled o2oi_ ingest token for org — skipping"
                    );
                    let _ = mark_failure(&row, Some(REASON_NO_INGEST_TOKEN)).await;
                    return;
                }
            },
            Err(e) => {
                tracing::error!(
                    job_id = %row.id,
                    org_id = %row.org_id,
                    "[synthetics dispatcher] ingest token lookup failed: {e}"
                );
                let _ = mark_failure(&row, Some(REASON_TOKEN_LOOKUP)).await;
                return;
            }
        };

    let payload = serde_json::json!({
        "job_id":            &row.id,
        "org_id":            &row.org_id,   // scopes the org-pathed Job API calls
        "synthetics_name":   row.synthetics_name,
        "dispatch_attempt":  row.dispatch_attempts,
        "job_api_endpoint":  config::meta::synthetics::api_endpoint(),
        "job_api_token":     probe_token,   // o2syn_ — for /resolve + /ack
        "ingest_token":      ingest_token,  // o2oi_  — for /{org}/synthetics_results/_json
    });

    let payload_bytes = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(e) => {
            let error_msg = format!("payload serialize: {e}");
            tracing::error!(job_id = %row.id, "[synthetics dispatcher] {error_msg}");
            let _ = mark_failure(&row, Some(&error_msg)).await;
            return;
        }
    };

    let lambda = lambda_client_for_region(&region).await;

    log::info!(
        "[synthetics dispatcher] attempting Lambda invoke: job_id={} fn={} region={}",
        row.id,
        fn_name,
        region
    );

    match lambda
        .invoke()
        .function_name(&fn_name)
        .payload(Blob::new(payload_bytes))
        .send()
        .await
    {
        Ok(resp) => {
            // A Lambda that panics, throws, or hits its function timeout still
            // returns HTTP 200 — the failure is reported in `FunctionError`, not in
            // the status code. Reading only `status_code` meant every one of those
            // logged as "Lambda invoked" and the job was left to time out its lease
            // ~15 minutes later under a generic "probe did not respond", with the
            // actual stack trace discarded.
            if let Some(kind) = resp.function_error() {
                // The payload carries the real error. Truncated because a stack
                // trace can be large and this goes to a log line, but included
                // because "Unhandled" on its own says nothing actionable.
                let detail = resp
                    .payload()
                    .map(|b| {
                        String::from_utf8_lossy(b.as_ref())
                            .chars()
                            .take(600)
                            .collect::<String>()
                    })
                    .unwrap_or_default();
                let error_msg = format!(
                    "Lambda function error (fn={fn_name} region={region} kind={kind}): {detail}"
                );
                tracing::error!(
                    job_id = %row.id,
                    synthetics_id = %row.synthetics_id,
                    "[synthetics dispatcher] {error_msg}"
                );
                handle_dispatch_failure(&row, &ingest_token, &error_msg).await;
                return;
            }
            tracing::info!(
                job_id = %row.id,
                synthetics_id = %row.synthetics_id,
                synthetics_name = %row.synthetics_name,
                org_id = %row.org_id,
                pool = %row.pool,
                region = %region,
                fn_name = %fn_name,
                status_code = resp.status_code(),
                "[synthetics dispatcher] Lambda invoked"
            );
        }
        Err(e) => {
            let error_msg = format!("Lambda invoke failed (fn={fn_name} region={region}): {e:#?}");
            tracing::error!(job_id = %row.id, "[synthetics dispatcher] {error_msg}");
            handle_dispatch_failure(&row, &ingest_token, &error_msg).await;
        }
    }
}

/// Shared tail for a dispatch that did not produce a usable run, whether the
/// invoke was rejected outright or the function itself failed.
///
/// Spends the job's `dispatch_attempts` budget rather than treating one failure as
/// terminal, so a job gets the same number of tries however it fails — this path
/// and the reaper's lease-timeout path share the counter.
async fn handle_dispatch_failure(
    row: &synthetics_jobs::LeasedRow,
    ingest_token: &str,
    error_msg: &str,
) {
    let db = get_orm_client_rw().await;
    let outcome = synthetics_jobs::fail_dispatch(
        db,
        &row.id,
        row.dispatch_attempts,
        crate::MAX_DISPATCH_ATTEMPTS,
    )
    .await
    .unwrap_or(synthetics_jobs::DispatchFailureOutcome::DeadLettered);

    match outcome {
        synthetics_jobs::DispatchFailureOutcome::Requeued => {
            // Transient — stay silent on the results stream here, same as the
            // reaper does on a timeout-retry. Only report once the budget is
            // exhausted (DeadLettered below).
            tracing::warn!(
                job_id = %row.id,
                dispatch_attempt = row.dispatch_attempts,
                "[synthetics dispatcher] dispatch failed, requeued for another attempt"
            );
        }
        synthetics_jobs::DispatchFailureOutcome::AlreadySettled => {
            // The probe reported before we judged the dispatch failed — a function
            // that acks and then panics is exactly this. Its result stands; writing
            // a dispatch error over it would replace a real measurement with an
            // infrastructure complaint, and re-running the check would bill a
            // second execution for one scheduled slot.
            tracing::warn!(
                job_id = %row.id,
                synthetics_id = %row.synthetics_id,
                "[synthetics dispatcher] dispatch failed after the probe already reported — \
                 keeping the probe's result: {error_msg}"
            );
        }
        synthetics_jobs::DispatchFailureOutcome::DeadLettered => {
            // Only report what we actually recorded. `mark_failure` returns false
            // when the job was completed or reassigned between the budget check and
            // the ack, and a results-stream record cannot be taken back — so writing
            // one anyway would put a dispatch error next to the probe's real result
            // for the same job.
            if mark_failure(row, Some(error_msg)).await {
                report_to_stream(
                    row,
                    ingest_token,
                    &config::meta::synthetics::api_endpoint(),
                    error_msg,
                )
                .await;
            }
            // Lambda dispatch failures are an OO infrastructure issue — not the
            // customer's website being down. Do NOT send to customer alert
            // destinations.
        }
    }
}
