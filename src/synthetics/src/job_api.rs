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

//! Synthetics job API — called by probe agents via `o2syn_` token auth.
//!
//! Routes (all `bypass: true` in RBAC — authenticated via `o2syn_` token):
//!   POST /api/synthetics/jobs/resolve
//!   POST /api/synthetics/jobs/lease
//!   POST /api/synthetics/jobs/ack

use std::collections::HashMap;

use config::meta::synthetics::{Synthetic, SyntheticAuth, for_each_string_at_path};
use infra::{
    db::{get_orm_client_ro, get_orm_client_rw},
    table::{
        org_ingestion_tokens, synthetics_checks, synthetics_jobs, synthetics_locations,
        synthetics_runs,
    },
};
use serde::{Deserialize, Serialize};

use crate::{RESULTS_STREAM, STEP_RESULTS_STREAM};

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ResolveRequest {
    pub job_id: String,
}

/// Viewport dimensions delivered to the probe so it doesn't need hardcoded device tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// One engine+device combination with a pre-generated execution_id (from the scheduler).
#[derive(Debug, Serialize, Deserialize)]
pub struct BrowserDeviceEntry {
    pub execution_id: String,
    pub engine: String,
    pub device: String,
    pub viewport: Viewport,
}

#[derive(Debug, Serialize)]
pub struct ResolveResponse {
    pub job_id: String,
    pub run_id: String,
    /// The synthetic definition (terminology rule: never "check" on the wire).
    pub synthetic: Synthetic,
    pub location: String,
    /// Human-readable location label (falls back to the id if the row is gone).
    pub location_label: String,
    pub scheduled_ts: i64,
    pub trigger_type: String,
    /// One entry per engine+device combination — browser checks only. Empty for protocol
    /// checks.
    pub browser_devices: Vec<BrowserDeviceEntry>,
    /// Decrypted credential env vars for this check, sent over TLS.
    /// Keys: `_AUTH_USERNAME`, `_AUTH_PASSWORD` (basic) or `_AUTH_TOKEN` (bearer).
    /// Auth is redacted from `check.auth` — probe reads credentials from here only.
    /// Empty when the synthetic has no auth configured.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub env_inject: HashMap<String, String>,
    /// Check-level metadata from the job row — flattened into stream records by the probe.
    /// Today carries `tags`; future fields added to `JobMetadata` flow automatically.
    pub metadata: serde_json::Value,
    /// Drop-dead time for stale catch-up work (mirrors the job row).
    pub valid_until: i64,
    /// "strict" (public pools) | "relaxed" (private locations — probing the
    /// customer's own network is the point; loopback/metadata still blocked).
    pub ssrf_policy: String,
    /// Result-stream destination + the org's `o2oi_` ingest token, looked up at
    /// resolve time (01 §7.1) so it is never at rest in the queue. Consumed by
    /// agent-mode probes; the Lambda path receives ingest creds in the invoke
    /// payload instead. None when the org has no enabled ingest token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingest: Option<IngestInfo>,
}

/// Ingest destination for probe result records.
#[derive(Debug, Serialize)]
pub struct IngestInfo {
    pub base_url: String,
    pub org: String,
    /// One row per execution. Carries `last_attempt_steps` as a JSON blob.
    pub stream: String,
    /// One row per (execution, step) — the step-grain stream (B10).
    ///
    /// Sent explicitly rather than derived as `{stream}_steps` by convention.
    /// A convention is undocumented coupling: a reader of either side cannot see
    /// it, and renaming the results stream would silently redirect step writes.
    /// Both sides are ours and the feature is dev/introspection-only, so there is
    /// no version-skew argument for guessing.
    ///
    /// Written by the BROWSER probe only. Steps are a browser concept; protocol
    /// checks have no steps and the Go agent never writes here.
    pub step_stream: String,
    pub token: String,
}

#[derive(Debug, Deserialize)]
pub struct AckRequest {
    pub job_id: String,
    /// The acking probe's agent id — the same value it sent as `claimed_by` on
    /// lease. The server completes the job only if the row is still leased to it.
    ///
    /// `Option` on purpose, and it must stay optional until both probes are
    /// deployed: a probe built before this field existed acks without it, and
    /// rejecting those acks would throw away every result in the meantime. An ack
    /// without it falls back to the status guard alone — exactly the behaviour
    /// before this change, so an old probe is no worse off than it was.
    #[serde(default)]
    pub claimed_by: Option<String>,
    /// Check result status from the probe: "up" | "warning" | "down" | "error"
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub response_time_ms: f64,
    pub error: Option<String>,
    /// "scheduled" | "manual" — populated by the probe, defaults to "scheduled"
    #[serde(default = "default_trigger_type")]
    pub trigger_type: String,
    /// Why a warning is a warning: "flaky", "cert_expiring", "sftp_degraded".
    ///
    /// Authoritative when present — the probe knows, and `classify` believes it.
    /// `None` means the probe is too old to send one, in which case classification
    /// falls back to the `attempts` proxy below. That proxy is what reported an
    /// expiring certificate as "passed only after retries (flaky)", so it is a
    /// compatibility fallback, not the intended path.
    #[serde(default)]
    pub status_reason: Option<String>,
    /// Total attempts this execution took. 1 = passed or failed on the first try.
    ///
    /// Carried so the control plane can tell a FLAKY warning from a DEGRADED one
    /// without putting `status_reason` on this wire. The retry loop needs more
    /// than one attempt by definition, and A6 breaks the loop the moment a
    /// checker returns a degraded warning — so `attempts > 1` means it recovered
    /// by retrying, and `attempts <= 1` means a checker reported a reachable but
    /// degrading target. See `alerting::classify`.
    ///
    /// Defaults to 0, which classifies as degraded: a probe too old to report
    /// attempts must not have its warnings read as flaky.
    #[serde(default)]
    pub attempts: i32,
    /// Why this is an `error`, when it is one: `dispatch` | `probe` | `queue`.
    ///
    /// `queue` is the one that changes the decision — it means the job waited
    /// behind other jobs until it passed its own `valid_until` and was never
    /// executed. That is our scheduling lag, so it must not advance the failure
    /// streak and must not page the customer. See `alerting::classify`.
    #[serde(default)]
    pub error_source: String,
}

fn default_trigger_type() -> String {
    "scheduled".to_string()
}

/// Batch form of [`AckRequest`] — one HTTP call acking several jobs, each with
/// its full result ("batch of rich acks"). Cadence is the sender's choice: the
/// browser probe acks per execution (array of one), protocol agents accumulate
/// per lease cycle. Every element runs the same per-job bookkeeping/notification
/// path as a single ack.
#[derive(Debug, Deserialize)]
pub struct AckBatchRequest {
    pub acks: Vec<AckRequest>,
}

fn artifact_key(
    org_id: &str,
    synthetics_id: &str,
    run_id: &str,
    job_id: &str,
    execution_id: Option<&str>,
    attempt: u32,
    name: &str,
) -> String {
    let now = chrono::Utc::now();
    // run_id groups all artifacts of one scheduled slot under one prefix so
    // per-run listing/cleanup is a prefix op.
    // Leaf: execution_id for browser checks (one per engine+device combo),
    // job_id for protocol checks (single execution per job).
    let id = execution_id.unwrap_or(job_id);
    // Every attempt of one execution writes the same file names, so a retried
    // run would silently overwrite the earlier attempt's screenshots. Attempt 0
    // keeps the historical key so nothing already stored moves.
    let name = if attempt == 0 {
        name.to_string()
    } else {
        format!("attempt-{attempt}-{name}")
    };
    format!(
        "synthetics/{}/{}/{}/{}/{}/{}/{}/{}",
        org_id,
        synthetics_id,
        now.format("%Y"),
        now.format("%m"),
        now.format("%d"),
        run_id,
        id,
        name,
    )
}

#[derive(Debug, Deserialize)]
pub struct ArtifactUrlsRequest {
    pub job_id: String,
    /// execution_id for the specific engine+device execution — used as the S3 key namespace.
    /// Required for browser checks; omitted for protocol checks (falls back to job_id).
    pub execution_id: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub trace: bool,
    /// The browser-side evidence bundle (console, page errors, network) as
    /// NDJSON. A third artifact kind riding the same broker as screenshots and
    /// the trace; probes that predate it simply never set it.
    #[serde(default)]
    pub evidence: bool,
    /// Which attempt of this execution these artifacts belong to (0 = first).
    /// Keeps a retry from overwriting the artifacts of the attempt before it.
    #[serde(default)]
    pub attempt: u32,
}

#[derive(Debug, Serialize)]
pub struct ArtifactUploadRef {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direct_upload_url: Option<String>,
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct ArtifactUrlsResponse {
    pub mode: String,
    pub screenshots: Vec<ArtifactUploadRef>,
    pub trace: Option<ArtifactUploadRef>,
    /// Absent when the probe did not ask for one, so a probe that predates
    /// evidence sees exactly the response it saw before.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<ArtifactUploadRef>,
}

pub async fn artifact_urls(
    req: ArtifactUrlsRequest,
    token_org: &str,
) -> anyhow::Result<ArtifactUrlsResponse> {
    let conn = get_orm_client_ro().await;

    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary — same as resolve/ack.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    let is_local = config::is_local_disk_storage();
    let expires = std::time::Duration::from_secs(30 * 60);

    let exec_id = req.execution_id.as_deref();

    let mut screenshots = Vec::with_capacity(req.screenshots.len());
    for step_id in &req.screenshots {
        let name = format!("screenshot-{step_id}.png");
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            &name,
        );
        if is_local {
            screenshots.push(ArtifactUploadRef {
                step_id: Some(step_id.clone()),
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            });
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign screenshot: {e}"))?;
            screenshots.push(ArtifactUploadRef {
                step_id: Some(step_id.clone()),
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            });
        }
    }

    let trace = if req.trace {
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            "trace.zip",
        );
        // TODO: trace viewing requires design discussion for the end user UI (embedded viewer vs
        // external)
        if is_local {
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            })
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign trace: {e}"))?;
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            })
        }
    } else {
        None
    };

    // Same shape as the trace above: NDJSON rather than a zip, and named so the
    // key is self-describing in object storage.
    let evidence = if req.evidence {
        let key = artifact_key(
            &check.org_id,
            &check.synthetics_id,
            &check.run_id,
            &req.job_id,
            exec_id,
            req.attempt,
            "evidence.ndjson",
        );
        if is_local {
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: None,
                direct_upload_url: Some(format!(
                    "/api/{}/synthetics/jobs/upload?key={}",
                    check.org_id,
                    urlencoding::encode(&key)
                )),
                key,
            })
        } else {
            let url = infra::storage::presign_url(&key, reqwest::Method::PUT, expires)
                .await
                .map_err(|e| anyhow::anyhow!("presign evidence: {e}"))?;
            Some(ArtifactUploadRef {
                step_id: None,
                upload_url: Some(url.to_string()),
                direct_upload_url: None,
                key,
            })
        }
    } else {
        None
    };

    Ok(ArtifactUrlsResponse {
        mode: if is_local {
            "direct".to_string()
        } else {
            "presigned".to_string()
        },
        screenshots,
        trace,
        evidence,
    })
}

// ── Artifact download: presigned URLs for the UI ─────────────────────────────

/// How long presigned download URLs stay valid (seconds).
const PRESIGN_DOWNLOAD_EXPIRES_SECS: u64 = 180;

#[derive(Debug, Deserialize)]
pub struct PresignArtifactsRequest {
    /// Full object-store keys as stored in the stream records
    /// (`screenshot_key`, `trace_key`).
    pub keys: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PresignedArtifact {
    pub key: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct PresignArtifactsResponse {
    /// "presigned" — urls point directly at object storage (S3/MinIO/Azure).
    /// "proxy" — local disk mode; urls are relative API paths that stream bytes.
    pub mode: String,
    pub expires_in: u64,
    pub urls: Vec<PresignedArtifact>,
}

/// Batch-signs download URLs for artifacts of one synthetic.
///
/// Every key must live under `synthetics/{org_id}/{synthetics_id}/` — the org
/// and synthetic come from the authenticated route, so a caller can only sign
/// keys belonging to that synthetic (no cross-org/bucket access).
pub async fn presign_artifacts(
    org_id: &str,
    synthetics_id: &str,
    req: PresignArtifactsRequest,
) -> anyhow::Result<PresignArtifactsResponse> {
    let prefix = format!("synthetics/{org_id}/{synthetics_id}/");
    for key in &req.keys {
        if !key.starts_with(&prefix) || key.contains("..") {
            anyhow::bail!("invalid artifact key: {key}");
        }
    }

    if config::is_local_disk_storage() {
        let urls = req
            .keys
            .into_iter()
            .map(|key| PresignedArtifact {
                url: format!(
                    "/api/{org_id}/synthetics/{synthetics_id}/artifact?key={}",
                    urlencoding::encode(&key)
                ),
                key,
            })
            .collect();
        return Ok(PresignArtifactsResponse {
            mode: "proxy".to_string(),
            expires_in: PRESIGN_DOWNLOAD_EXPIRES_SECS,
            urls,
        });
    }

    let expires = std::time::Duration::from_secs(PRESIGN_DOWNLOAD_EXPIRES_SECS);
    let mut urls = Vec::with_capacity(req.keys.len());
    for key in req.keys {
        let url = infra::storage::presign_url(&key, reqwest::Method::GET, expires)
            .await
            .map_err(|e| anyhow::anyhow!("presign {key}: {e}"))?;
        urls.push(PresignedArtifact {
            key,
            url: url.to_string(),
        });
    }
    Ok(PresignArtifactsResponse {
        mode: "presigned".to_string(),
        expires_in: PRESIGN_DOWNLOAD_EXPIRES_SECS,
        urls,
    })
}

#[derive(Debug, Serialize)]
pub struct AckResponse {
    pub run_complete: bool,
    /// Aggregate run status string when run_complete = true: "passed"|"warning"|"failed"|"error".
    /// None while the run still has pending jobs.
    pub run_status: Option<String>,
    /// Total number of jobs (locations) in this run — for notification context.
    pub job_count: i32,
    pub org_id: String,
    pub job_id: String,
    pub run_id: String,
    pub synthetics_id: String,
    pub synthetics_name: String,
    pub synthetic_type: String,
    pub target: String,
    pub destinations: Vec<String>,
    pub location: String,
    pub pool: String,
    pub trigger_type: String,
    /// Whether this completed run should notify, and with what.
    ///
    /// The caller used to notify on every completed run that had a destination,
    /// which ignored `alert_if_fails` and `cooldown_mins` entirely. The
    /// decision belongs here because it needs the persisted failure streak,
    /// which only the ack path holds.
    pub alert: AlertDecision,
    /// Runs that had failed back to back when `alert` was resolved. 0 unless
    /// firing — a notification that says "failing" is more useful when it also
    /// says for how long.
    /// Why the run was a warning, echoed from the ack so the notification can say
    /// "the certificate is expiring" rather than a generic "degrading".
    pub status_reason: Option<String>,
    pub consecutive_failures: i32,
    /// Locations of this run's jobs that did not pass, worst first.
    ///
    /// Empty unless the run completed and something failed. Without it a
    /// notification for a six-location check could only say "the check is
    /// failing" — the reader had to open the UI to find out where.
    pub failing_locations: Vec<String>,
    /// Locations of this run's jobs that passed, alphabetical.
    ///
    /// Carried alongside the failing set because a recovery notification has no
    /// failing locations to name — that is what "recovered" means — so without
    /// this the message degraded to a bare count. Both sides also make a
    /// partial recovery expressible.
    pub passing_locations: Vec<String>,
}

/// The notification a completed run should send, resolved against the check's
/// `alert_if_fails` / `cooldown_mins` settings and its persisted alert state.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub enum AlertDecision {
    /// Say nothing: the run is still below the failure threshold, inside the
    /// cooldown window, or healthy and was never alerting.
    #[default]
    Silent,
    /// The check is failing and should be reported.
    Firing,
    /// The check passed after having alerted. Mandatory once a cooldown exists:
    /// with one, silence stops meaning "recovered".
    Recovered,
    /// The run recovered by retrying. Informational, not an incident.
    Flaky,
    /// The target is reachable but degrading — a certificate inside its warning
    /// window, or a failing SFTP probe on a host that authenticated.
    Degraded,
}

// ── Service functions (called by OSS handlers) ────────────────────────────────

/// Returns full synthetic config for a pending check so the probe knows what to execute.
///
/// Credentials stored AES-encrypted at rest are decrypted here with the org DEK
/// and returned as plain `env_inject` key-value pairs. This is safe because:
///   - The job API is only reachable over TLS (required for all O2 deployments).
///   - The `o2syn_` probe token is scoped to this org only.
///
/// `check.auth` is redacted in the response — the probe reads credentials from
/// `env_inject` only so the encrypted blob never leaves the backend.
pub async fn resolve(req: ResolveRequest, token_org: &str) -> anyhow::Result<ResolveResponse> {
    let conn = get_orm_client_rw().await;

    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary: the caller's token org must own the job. `job_id` is a
    // KSUID that leaks into result streams and logs, so without this a valid
    // token from another org could resolve this job's decrypted secrets.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    // Definition only (config/secrets/type) — served from the definition cache.
    let mut synthetic = synthetics_checks::get_cached(conn, &check.org_id, &check.synthetics_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {}", check.synthetics_id))?;

    // Decrypt credentials and variables; build env_inject for the probe.
    // Extracted config secrets live in config_secrets; legacy rows may still
    // carry AESenc: values in-place inside config.
    let mut has_encrypted_config = !synthetic.config_secrets.is_empty();
    for path in synthetic.check_type.secret_config_paths() {
        let _ = for_each_string_at_path(&mut synthetic.config, path, &mut |s: &mut String| {
            if s.starts_with("AESenc:") {
                has_encrypted_config = true;
            }
            Ok::<(), ()>(())
        });
    }
    let needs_dek = synthetic.auth.is_some()
        || !synthetic.variables.is_empty()
        || !synthetic.cookies.is_empty()
        || has_encrypted_config;
    let mut env_inject = HashMap::new();

    if needs_dek {
        let dek = crate::service::synthetics_dek(&check.org_id).await?;

        if let Some(ref auth) = synthetic.auth {
            env_inject.extend(build_env_map(auth, &dek)?);
        }

        // Inject decrypted variable values so the probe can substitute {{ VAR }}.
        // All values are AESenc: at rest regardless of the secure flag.
        for var in &synthetic.variables {
            let value = if var.value.starts_with("AESenc:") {
                crate::service::decrypt_secret(&dek, &var.value)?
            } else {
                var.value.clone()
            };
            env_inject.insert(var.name.clone(), value);
        }

        // Decrypt top-level cookies and serialize as _AUTH_COOKIES JSON for the probe.
        // Probe calls context.addCookies(JSON.parse(envVars._AUTH_COOKIES)) regardless of auth
        // type.
        if !synthetic.cookies.is_empty() {
            let decrypted: Vec<serde_json::Value> = synthetic
                .cookies
                .iter()
                .map(|c| {
                    let value = if c.value.is_empty() {
                        Ok(String::new())
                    } else {
                        crate::service::decrypt_secret(&dek, &c.value)
                    }?;
                    Ok(serde_json::json!({
                        "name":     c.name,
                        "value":    value,
                        "domain":   c.domain,
                        "path":     c.path,
                        "httpOnly": c.http_only,
                        "secure":   c.secure,
                    }))
                })
                .collect::<anyhow::Result<_>>()?;
            env_inject.insert(
                "_AUTH_COOKIES".into(),
                serde_json::to_string(&decrypted)
                    .map_err(|e| anyhow::anyhow!("cookies serialize failed: {e}"))?,
            );
        }

        // Rehydrate config-embedded secrets (SSH password, headers, browser
        // recorded secrets) — the probe reads them from `config` verbatim.
        if has_encrypted_config {
            for (pointer, encrypted) in std::mem::take(&mut synthetic.config_secrets) {
                if let Some(slot) = synthetic.config.pointer_mut(&pointer) {
                    *slot = serde_json::Value::String(crate::service::decrypt_secret(
                        &dek, &encrypted,
                    )?);
                }
            }
            // Legacy rows: AESenc: values still stored in-place inside config.
            for path in synthetic.check_type.secret_config_paths() {
                for_each_string_at_path(&mut synthetic.config, path, &mut |s: &mut String| {
                    if s.starts_with("AESenc:") {
                        *s = crate::service::decrypt_secret(&dek, s)?;
                    }
                    Ok::<(), anyhow::Error>(())
                })?;
            }
        }
    }

    // Redact password/token from auth before sending — probe uses env_inject instead.
    synthetic.auth = synthetic.auth.map(redact_auth);
    // Redact cookie values — probe reads from env_inject._AUTH_COOKIES instead.
    for c in &mut synthetic.cookies {
        c.value = String::new();
    }

    // Deserialise browser_devices from the job row, then enrich each entry with
    // the viewport dimensions from env config so the probe doesn't need a local
    // device table.
    #[derive(Deserialize)]
    struct StoredBrowserDevice {
        execution_id: String,
        engine: String,
        device: String,
    }
    let raw_devices: Vec<StoredBrowserDevice> = check
        .browser_devices
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let browser_devices: Vec<BrowserDeviceEntry> = raw_devices
        .into_iter()
        .map(|bd| {
            let (width, height) =
                config::meta::synthetics::device_viewport(&bd.device).unwrap_or((1440, 900));
            BrowserDeviceEntry {
                execution_id: bd.execution_id,
                engine: bd.engine,
                device: bd.device,
                viewport: Viewport { width, height },
            }
        })
        .collect();

    let trigger_type = synthetics_runs::get_run(conn, &check.run_id)
        .await
        .ok()
        .flatten()
        .map(|r| r.trigger_type)
        .unwrap_or_else(|| "schedule".to_string());

    let metadata: serde_json::Value =
        serde_json::from_str(&check.metadata).unwrap_or(serde_json::json!({}));

    // SSRF policy from the location registry: private locations run relaxed
    // (probing the customer's own network is the point), everything else strict.
    let location_record = synthetics_locations::get(&check.location)
        .await
        .ok()
        .flatten();
    let ssrf_policy = match &location_record {
        Some(l) if l.kind == synthetics_locations::KIND_PRIVATE => "relaxed".to_string(),
        _ => "strict".to_string(),
    };
    // Human label for the result record (id fallback keeps it non-empty).
    let location_label = location_record
        .map(|l| l.label)
        .unwrap_or_else(|| check.location.clone());

    // Ingest destination for agent-mode probes — looked up at resolve time so
    // the token is never at rest in the queue (01 §7.1).
    let ingest = org_ingestion_tokens::find_default_enabled(&check.org_id)
        .await
        .ok()
        .flatten()
        .map(|t| IngestInfo {
            base_url: config::meta::synthetics::api_endpoint(),
            org: check.org_id.clone(),
            stream: RESULTS_STREAM.to_string(),
            step_stream: STEP_RESULTS_STREAM.to_string(),
            token: t.token,
        });

    Ok(ResolveResponse {
        job_id: req.job_id,
        run_id: check.run_id,
        synthetic,
        location: check.location,
        location_label,
        scheduled_ts: check.scheduled_ts,
        trigger_type,
        browser_devices,
        env_inject,
        metadata,
        valid_until: check.valid_until,
        ssrf_policy,
        ingest,
    })
}

/// AES-decrypt credentials from `auth` and return as env var map.
fn build_env_map(auth: &SyntheticAuth, dek: &[u8]) -> anyhow::Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    match auth {
        SyntheticAuth::Basic { username, password } => {
            map.insert("_AUTH_USERNAME".into(), username.clone());
            if !password.is_empty() {
                map.insert(
                    "_AUTH_PASSWORD".into(),
                    crate::service::decrypt_secret(dek, password)?,
                );
            }
        }
        SyntheticAuth::Bearer { token } => {
            if !token.is_empty() {
                map.insert(
                    "_AUTH_TOKEN".into(),
                    crate::service::decrypt_secret(dek, token)?,
                );
            }
        }
        SyntheticAuth::Secret { .. } => {}
    }
    Ok(map)
}

/// Keep auth type + non-secret fields (tells probe how to apply), clear secret values.
fn redact_auth(auth: SyntheticAuth) -> SyntheticAuth {
    match auth {
        SyntheticAuth::Basic { username, .. } => SyntheticAuth::Basic {
            username,
            password: String::new(),
        },
        SyntheticAuth::Bearer { .. } => SyntheticAuth::Bearer {
            token: String::new(),
        },
        other => other,
    }
}

/// Acknowledges completion of a job.
/// Marks the job complete, increments the run counter, and returns context for notifications.
/// Returns `run_complete = true` when all jobs in the run have acked.
pub async fn ack(req: AckRequest, token_org: &str) -> anyhow::Result<AckResponse> {
    let conn = get_orm_client_rw().await;

    // Fetch the leased row first for context (location, check_id, org_id).
    let check = synthetics_jobs::get_by_id(conn, &req.job_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("job not found: {}", req.job_id))?;

    // Tenant boundary — same as resolve.
    if check.org_id != token_org {
        anyhow::bail!(
            "forbidden: job {:?} does not belong to this org",
            req.job_id
        );
    }

    // Convert probe status string to SyntheticStatus DB integer.
    let synthetic_status = config::meta::synthetics::SyntheticStatus::from_probe_str(&req.status);
    let status_db = synthetic_status.to_db();

    // Map SyntheticStatus DB int → synthetics_jobs status int.
    // Jobs use: 3=Passed, 4=Failed, 5=Warning, 6=Error.
    let job_status = match status_db {
        1 => 3, // Passed
        2 => 5, // Warning
        3 => 4, // Failed
        4 => 6, // Error
        _ => 4,
    };

    let now_us = config::utils::time::now_micros();

    // Mark job complete. `None` means the ack did not apply: the job was no longer
    // Claimed (a duplicate ack), or it is claimed by a different agent now (a late
    // ack from a holder the reaper already evicted).
    let acked = synthetics_jobs::ack_complete(
        conn,
        &req.job_id,
        job_status,
        None,
        now_us,
        req.claimed_by.as_deref(),
    )
    .await
    .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    if acked.is_none() {
        // Dropped, not errored: the probe did its work and is entitled to a 200.
        // What must not happen is touching run accounting a second time —
        // `jobs_done` would overshoot `job_count`, the run would be declared
        // complete on a partial set, and `resolve_alert` would advance the failure
        // streak twice for one failure.
        tracing::warn!(
            job_id = %req.job_id,
            synthetics_id = %check.synthetics_id,
            claimed_by = req.claimed_by.as_deref().unwrap_or("<not sent>"),
            "[synthetics] stale_lease: ack dropped, job is no longer claimed by this agent"
        );
        return Ok(AckResponse {
            run_complete: false,
            run_status: None,
            job_count: 0,
            org_id: check.org_id,
            job_id: req.job_id,
            run_id: check.run_id,
            synthetics_id: check.synthetics_id,
            synthetics_name: check.synthetics_name,
            synthetic_type: String::new(),
            target: String::new(),
            destinations: Vec::new(),
            location: check.location,
            pool: check.pool,
            trigger_type: req.trigger_type,
            alert: AlertDecision::Silent,
            status_reason: None,
            consecutive_failures: 0,
            failing_locations: Vec::new(),
            passing_locations: Vec::new(),
        });
    }

    // Increment run counter; Some(run_result) when all jobs have acked.
    let run_completion =
        synthetics_runs::increment_jobs_done(conn, &check.run_id, status_db, now_us)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let run_complete = run_completion.is_some();
    let (run_status, job_count) = match run_completion {
        Some((run_result, count)) => {
            let status = match config::meta::synthetics::SyntheticStatus::from_db(run_result) {
                config::meta::synthetics::SyntheticStatus::Passed => "passed",
                config::meta::synthetics::SyntheticStatus::Warning => "warning",
                config::meta::synthetics::SyntheticStatus::Failed => "failed",
                _ => "error",
            }
            .to_string();
            (Some(status), count)
        }
        None => (None, 1),
    };

    // Denormalize last check status onto the synthetic row.
    //
    // The write returns whether it CHANGED the stored value, and that bool is
    // the whole reason the publish below is affordable: this runs on every ack,
    // so publishing unconditionally would put a super-cluster message on the
    // queue for every run of every check. Publishing on the transition instead
    // means a check that keeps passing sends nothing at all.
    match synthetics_checks::update_last_check_status(conn, &check.synthetics_id, status_db).await {
        // Only the region that ran the check writes this column, so without the
        // broadcast every other region's LIST shows "Unknown" for a check its
        // own detail page — federated search over the results stream — reports
        // as passing.
        Ok(true) => {
            #[cfg(feature = "enterprise")]
            if o2_enterprise::enterprise::common::config::get_config()
                .super_cluster
                .enabled
                && let Err(e) =
                    o2_enterprise::enterprise::super_cluster::queue::synthetics_check_last_status(
                        &check.org_id,
                        &check.synthetics_id,
                        status_db,
                    )
                    .await
            {
                // Logged, never propagated. The probe has done its work and is
                // owed its 200; failing the ack here would lose the run, and a
                // status badge that is stale in another region until the next
                // flip is cosmetic by comparison.
                tracing::warn!(
                    synthetics_id = %check.synthetics_id,
                    "[synthetics] super-cluster last_check_status publish: {e}"
                );
            }
        }
        // Unchanged — the steady state, and deliberately silent.
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(
                synthetics_id = %check.synthetics_id,
                "[synthetics] update_last_check_status: {e}"
            );
        }
    }

    // Fetch synthetic for type, target, and destinations — all definition
    // fields, so the cached read is correct here. Alert state is read
    // separately via resolve_alert/get_alert_state, which go to the DB.
    let synthetic = synthetics_checks::get_cached(conn, &check.org_id, &check.synthetics_id)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?
        .ok_or_else(|| anyhow::anyhow!("check not found: {}", check.synthetics_id))?;

    let synthetic_type = serde_json::to_value(&synthetic.check_type)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();

    // Decide the notification, once per RUN. Per-job would alert once per
    // location for the same outage, and would advance the failure streak by the
    // fan-out factor rather than by one.
    let (alert, consecutive_failures) = if run_complete {
        resolve_alert(
            conn,
            &check.synthetics_id,
            RunOutcome {
                status: run_status.as_deref(),
                attempts: req.attempts,
                status_reason: req.status_reason.as_deref(),
                error_source: &req.error_source,
            },
            &synthetic,
            now_us,
        )
        .await
    } else {
        (AlertDecision::Silent, 0)
    };

    // Which locations broke and which came back. Only worth a query when the run
    // finished and we are going to say something about it. Both sides are needed:
    // a recovery has nothing failing to name, and a partial recovery needs both.
    let outcomes = if run_complete && !matches!(alert, AlertDecision::Silent) {
        synthetics_jobs::run_location_outcomes(conn, &check.run_id)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!(run_id = %check.run_id, "[synthetics] run_location_outcomes: {e}");
                Default::default()
            })
    } else {
        Default::default()
    };
    let (failing_locations, passing_locations) = (outcomes.failing, outcomes.passing);

    Ok(AckResponse {
        run_complete,
        run_status,
        job_count,
        org_id: check.org_id,
        job_id: req.job_id,
        run_id: check.run_id,
        synthetics_id: check.synthetics_id,
        synthetics_name: synthetic.name,
        synthetic_type,
        target: synthetic.target,
        destinations: synthetic.destinations,
        location: check.location,
        pool: check.pool,
        trigger_type: req.trigger_type,
        alert,
        // Echoed straight back so the notification can name the condition.
        status_reason: req.status_reason.clone(),
        consecutive_failures,
        failing_locations,
        passing_locations,
    })
}

/// Resolves the alert decision for a completed run and persists the new state.
///
/// A failure to read or write the state is never allowed to fail the ack: the
/// probe has already done its work and the result is already ingested. It
/// degrades to `Silent` and says so in the log, rather than making a
/// notification bookkeeping error look like a probe error.
/// What a completed run reported, as far as alerting is concerned.
///
/// Grouped rather than passed as four loose arguments because they are one fact
/// about one run — they are always read together, and `classify` takes all four.
/// Splitting them across a long parameter list is also how a caller ends up
/// transposing two `&str`s the compiler cannot tell apart.
struct RunOutcome<'a> {
    status: Option<&'a str>,
    attempts: i32,
    /// `flaky`, `cert_expiring`, `sftp_degraded`. `None` from a probe too old to
    /// report one, which falls back to the `attempts` proxy.
    status_reason: Option<&'a str>,
    error_source: &'a str,
}

async fn resolve_alert<C: sea_orm::ConnectionTrait>(
    conn: &C,
    synthetics_id: &str,
    outcome: RunOutcome<'_>,
    check: &config::meta::synthetics::Synthetic,
    now_us: i64,
) -> (AlertDecision, i32) {
    // See `alerting::classify`. Four outcomes, not two: an outage accumulates and
    // drives the streak, a degradation does not (a certificate is not "more
    // expired" on the twentieth check), and `error` is an outage rather than a
    // reason for silence.
    let class = crate::alerting::classify(
        outcome.status,
        outcome.attempts,
        outcome.error_source,
        outcome.status_reason,
    );

    let prior = match infra::table::synthetics_checks::get_alert_state(conn, synthetics_id).await {
        Ok(Some(state)) => state,
        Ok(None) => return (AlertDecision::Silent, 0), // deleted mid-run
        Err(e) => {
            tracing::warn!(%synthetics_id, "[synthetics] get_alert_state: {e}");
            return (AlertDecision::Silent, 0);
        }
    };

    // A check with no destination cannot notify, so it must not accumulate alert
    // state. Advancing it anyway produced a check sitting at `alerting = true`
    // having never sent anything — and two follow-on faults:
    //
    //   1. Add a destination later, let the check recover, and the FIRST thing the user receives is
    //      "RECOVERED" for an incident they were never told about. Suppressing exactly that is why
    //      `alerting` exists.
    //   2. `last_alert_at` was stamped without a send, so the first real failure after adding a
    //      destination lands inside a cooldown it never earned and is silenced.
    //
    // Stale state is cleared rather than merely left alone: a destination can be
    // removed mid-incident, and `alerting = true` must not outlive the ability
    // to act on it.
    if check.destinations.is_empty() {
        if prior != infra::table::synthetics_checks::AlertState::default()
            && let Err(e) = infra::table::synthetics_checks::update_alert_state_if(
                conn,
                synthetics_id,
                prior,
                infra::table::synthetics_checks::AlertState::default(),
            )
            .await
        {
            tracing::warn!(%synthetics_id, "[synthetics] clear_alert_state: {e}");
        }
        return (AlertDecision::Silent, 0);
    }

    let (outcome, next) = crate::alerting::decide(
        prior,
        class,
        check.alert_if_fails,
        check.cooldown_mins,
        now_us,
    );

    // Compare-and-swap on the state we decided against. `resolve_alert` is a
    // read-modify-write with no transaction, and two runs of the same check can
    // complete close together — a run outlasts its interval precisely when the
    // target is slow, which is when it is failing. Losing the race means our
    // decision was made against a stale read, so we discard it rather than
    // overwrite the winner: the streak would otherwise undercount and the
    // notification would double.
    if next != prior {
        match infra::table::synthetics_checks::update_alert_state_if(
            conn,
            synthetics_id,
            prior,
            next,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                tracing::info!(
                    %synthetics_id,
                    "[synthetics] alert state changed under us; another run decided this one"
                );
                return (AlertDecision::Silent, next.consecutive_failures);
            }
            Err(e) => tracing::warn!(%synthetics_id, "[synthetics] update_alert_state: {e}"),
        }
    }

    let decision = match outcome {
        crate::alerting::AlertOutcome::Silent => AlertDecision::Silent,
        crate::alerting::AlertOutcome::Firing => AlertDecision::Firing,
        crate::alerting::AlertOutcome::Flaky => AlertDecision::Flaky,
        crate::alerting::AlertOutcome::Degraded => AlertDecision::Degraded,
        crate::alerting::AlertOutcome::Recovered => AlertDecision::Recovered,
    };
    (decision, next.consecutive_failures)
}
