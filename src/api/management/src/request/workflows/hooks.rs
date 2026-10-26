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

//! Public workflow hook routes, authenticated here and never by `auth_middleware`.

use std::sync::Arc;

use axum::{
    Extension, Json,
    body::{Body, Bytes},
    extract::{OriginalUri, Path, Request},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{axum::middlewares::RealIp, utils::time::now_micros};
use futures::StreamExt;
use infra::{
    db::get_orm_client_rw,
    table::{
        organizations, workflow_http_trigger_requests as ledger,
        workflow_http_triggers::{AuthMode, CredentialKind},
    },
};
use openobserve_core::workflows::http_trigger::{
    HARD_BODY_CAP, HookReason,
    cache::{self, CachedTrigger},
    credentials,
    enqueue::{self, EnqueueOutcome, EnqueueRequest},
    payload::{self, HookInput},
    read_within_deadline, rejections,
    signature::{self, SigError, SignedContent, WebhookHeaders},
    worker,
};
use tokio::sync::{Semaphore, SemaphorePermit};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::{
        public_rate_limit::client_ip,
        workflows::hook_limits::{self, BUSY_RETRY_AFTER_SECS, LIMITERS, MINUTE},
    },
};

const CHALLENGE: &str = "Bearer realm=\"workflow-hooks\"";
const IDEMPOTENT_REPLAYED: &str = "idempotent-replayed";
const RATE_RETRY_AFTER_SECS: u64 = 60;
const QUEUE_RETRY_AFTER_SECS: u64 = 30;
const MAX_CONTENT_TYPE_LEN: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthShape {
    Token,
    Signature,
    Unknown,
}

impl AuthShape {
    fn of(headers: &HeaderMap) -> Self {
        if payload::bearer_token(headers).is_some() {
            Self::Token
        } else if headers.contains_key("webhook-signature") {
            Self::Signature
        } else {
            Self::Unknown
        }
    }
}

/// The facts of one call, fixed before any check runs.
struct HookCall {
    org_id: String,
    trigger_id: String,
    caller_ip: String,
    path: String,
    query: Option<String>,
    now_us: i64,
    poll: bool,
}

impl HookCall {
    fn new(
        org_id: String,
        trigger_id: String,
        ip: Option<RealIp>,
        req: &Request<Body>,
        poll: bool,
    ) -> Self {
        // A poll is signed over the path the caller sent, base URI included.
        let uri = req
            .extensions()
            .get::<OriginalUri>()
            .map_or(req.uri(), |original| &original.0);
        Self {
            org_id,
            trigger_id,
            caller_ip: client_ip(ip),
            path: uri.path().to_string(),
            query: uri.query().map(str::to_string),
            now_us: now_micros(),
            poll,
        }
    }
}

struct Authenticated {
    trigger: Arc<CachedTrigger>,
    credential_id: String,
    credential_prefix: String,
    body: Bytes,
}

pub async fn invoke(
    Path((org_id, trigger_id)): Path<(String, String)>,
    ip: Option<Extension<RealIp>>,
    req: Request<Body>,
) -> Response {
    let ip = ip.map(|Extension(ip)| ip);
    let call = HookCall::new(org_id, trigger_id, ip, &req, false);
    let (auth, headers) = match admit(&call, ip, req).await {
        Ok(admitted) => admitted,
        Err(resp) => return resp,
    };
    match accept(&call, &headers, auth).await {
        Ok(resp) => resp,
        Err((reason, retry_after)) => reject_call(&call, reason, retry_after).await,
    }
}

pub async fn run_status(
    Path((org_id, trigger_id, run_id)): Path<(String, String, String)>,
    ip: Option<Extension<RealIp>>,
    req: Request<Body>,
) -> Response {
    let ip = ip.map(|Extension(ip)| ip);
    let call = HookCall::new(org_id, trigger_id, ip, &req, true);
    let auth = match admit(&call, ip, req).await {
        Ok((auth, _)) => auth,
        Err(resp) => return resp,
    };
    match stored_status(&call, &auth, &run_id).await {
        Ok(resp) => resp,
        Err((reason, retry_after)) => reject_call(&call, reason, retry_after).await,
    }
}

/// Pre-auth gates, URL refusal, the hard-cap precheck and authentication, in that order.
async fn admit(
    call: &HookCall,
    ip: Option<RealIp>,
    req: Request<Body>,
) -> Result<(Authenticated, HeaderMap), Response> {
    let permits = preauth(ip)?;
    if payload::credential_in_url(&call.path, call.query.as_deref()) {
        note_preauth(call, HookReason::CredentialInUrl).await;
        return Err(reject(HookReason::CredentialInUrl, None));
    }
    if declared_length(req.headers()).is_some_and(|len| len > HARD_BODY_CAP) {
        note_preauth(call, HookReason::PayloadTooLarge).await;
        return Err(reject(HookReason::PayloadTooLarge, None));
    }
    let (parts, body) = req.into_parts();
    let shape = AuthShape::of(&parts.headers);
    let auth = authenticate(call, &parts.headers, body, shape).await;
    drop(permits);
    match auth {
        Ok(auth) => Ok((auth, parts.headers)),
        Err(reason) => Err(reject(reason, None)),
    }
}

/// Every identity failure leaves here as the same 401; specific reasons are only recorded.
async fn authenticate(
    call: &HookCall,
    headers: &HeaderMap,
    body: Body,
    shape: AuthShape,
) -> Result<Authenticated, HookReason> {
    let trigger = cache::get(&call.trigger_id).await.map_err(|e| {
        log::error!("[WORKFLOW_HOOK] trigger lookup failed: {e}");
        HookReason::InternalError
    })?;
    let Some(trigger) = trigger.filter(|t| belongs_to(t, &call.org_id)) else {
        dummy_work(shape, headers);
        return Err(HookReason::Unauthorized);
    };
    // These routes sit outside blocked_orgs_middleware, so a deleting org must answer as missing.
    if db::org_status::is_blocked(&call.org_id) {
        dummy_work(shape, headers);
        return Err(HookReason::Unauthorized);
    }
    match organizations::find(&call.org_id).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            dummy_work(shape, headers);
            return Err(HookReason::Unauthorized);
        }
        Err(e) => {
            log::error!("[WORKFLOW_HOOK] organization lookup failed: {e}");
            return Err(HookReason::InternalError);
        }
    }
    let verified = match AuthMode::parse(&trigger.trigger.auth_mode) {
        Some(AuthMode::Token) => verify_token(call, &trigger, headers, body).await,
        Some(AuthMode::Signature) => verify_signature(call, &trigger, headers, body).await,
        None => Err(HookReason::InternalError),
    };
    if let Err(reason) = verified {
        note_rejection(call, reason).await;
    }
    verified
}

async fn verify_token(
    call: &HookCall,
    trigger: &Arc<CachedTrigger>,
    headers: &HeaderMap,
    body: Body,
) -> Result<Authenticated, HookReason> {
    let presented = payload::bearer_token(headers).unwrap_or_default();
    let Some(credential) = credentials::verify_token(presented, &trigger.credentials, call.now_us)
    else {
        return Err(HookReason::InvalidToken);
    };
    let body = if call.poll {
        Bytes::new()
    } else {
        read_capped(body, body_cap(trigger)).await?
    };
    Ok(Authenticated {
        trigger: trigger.clone(),
        credential_id: credential.id.clone(),
        credential_prefix: credential.display_prefix.clone(),
        body,
    })
}

/// Reads the body before the HMAC, since the signature covers its exact bytes.
async fn verify_signature(
    call: &HookCall,
    trigger: &Arc<CachedTrigger>,
    headers: &HeaderMap,
    body: Body,
) -> Result<Authenticated, HookReason> {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
    };
    let webhook = WebhookHeaders {
        id: header("webhook-id"),
        timestamp: header("webhook-timestamp"),
        signature: header("webhook-signature"),
    };
    if webhook.id.is_empty() || webhook.timestamp.is_empty() || webhook.signature.is_empty() {
        return Err(HookReason::InvalidSignature);
    }
    let body = if call.poll {
        Bytes::new()
    } else {
        read_capped(body, body_cap(trigger)).await?
    };
    let content = if call.poll {
        SignedContent::Poll(&call.path)
    } else {
        SignedContent::Invoke(&body)
    };
    let now_secs = call.now_us / 1_000_000;
    let mut matched = None;
    let mut stale = false;
    for credential in trigger
        .credentials
        .iter()
        .filter(|c| c.kind == CredentialKind::SigningSecret && c.is_live_at(call.now_us))
    {
        let Some(key) = credential.signing_key.as_deref() else {
            continue;
        };
        match signature::verify(&webhook, content, &[key], now_secs) {
            Ok(()) if matched.is_none() => matched = Some(credential),
            Err(SigError::StaleTimestamp) => stale = true,
            _ => {}
        }
    }
    match matched {
        Some(credential) => Ok(Authenticated {
            trigger: trigger.clone(),
            credential_id: credential.id.clone(),
            credential_prefix: credential.display_prefix.clone(),
            body,
        }),
        None if stale => Err(HookReason::StaleTimestamp),
        None => Err(HookReason::InvalidSignature),
    }
}

/// Post-auth checks in the order the spec fixes: enabled, limits, dry run, replay, capacity.
async fn accept(
    call: &HookCall,
    headers: &HeaderMap,
    auth: Authenticated,
) -> Result<Response, (HookReason, Option<u64>)> {
    check_enabled(call, &auth.trigger).await.map_err(no_retry)?;
    if over_limits(call, &auth) {
        return Err((HookReason::RateLimited, Some(RATE_RETRY_AFTER_SECS)));
    }
    let run_id = config::ider::uuid();
    let input = payload::build_input(
        &call.trigger_id,
        &run_id,
        call.now_us,
        headers,
        call.query.as_deref(),
        &auth.body,
    );
    rejections::record_use(&call.trigger_id, &auth.credential_id, call.now_us);
    if payload::is_dry_run(headers) {
        return Ok(dry_run(call, &auth, input).await);
    }
    let mode = AuthMode::parse(&auth.trigger.trigger.auth_mode).unwrap_or(AuthMode::Token);
    let idem_key = payload::idempotency_key(headers, mode).map_err(no_retry)?;
    let body_sha256 = credentials::sha256_hex_bytes(&auth.body);
    if let Some(key) = idem_key.as_deref()
        && let Some(outcome) = enqueue::replay_or_conflict(&call.trigger_id, key, &body_sha256)
            .await
            .map_err(no_retry)?
    {
        return Ok(answer(call, &auth, outcome).await);
    }
    enqueue::check_queue_capacity(&call.org_id)
        .await
        .map_err(|reason| (reason, Some(QUEUE_RETRY_AFTER_SECS)))?;
    if !worker::heartbeat_is_fresh().await {
        return Err((HookReason::WorkerUnavailable, Some(QUEUE_RETRY_AFTER_SECS)));
    }
    let request = enqueue_request(call, headers, &auth, input, idem_key, body_sha256)?;
    let outcome = enqueue::enqueue_run(request)
        .await
        .map_err(enqueue_refusal)?;
    Ok(answer(call, &auth, outcome).await)
}

async fn check_enabled(call: &HookCall, trigger: &CachedTrigger) -> Result<(), HookReason> {
    if !trigger.trigger.enabled {
        return Err(HookReason::EndpointDisabled);
    }
    match db::workflows::get_workflow(&call.org_id, &trigger.trigger.workflow_id).await {
        Ok(Some(workflow)) if workflow.enabled => Ok(()),
        Ok(Some(_)) => Err(HookReason::WorkflowDisabled),
        Ok(None) => Err(HookReason::WorkflowNotPublished),
        Err(e) => {
            log::error!("[WORKFLOW_HOOK] workflow lookup failed: {e}");
            Err(HookReason::InternalError)
        }
    }
}

/// Dry runs count here too, against calls and bytes, so a probe loop cannot run unmetered.
fn over_limits(call: &HookCall, auth: &Authenticated) -> bool {
    let limit = &config::get_config().limit;
    let trigger_rpm = hook_limits::trigger_budget(
        auth.trigger.trigger.rate_limit_per_minute,
        limit.workflow_hook_org_rpm,
    );
    let bytes = u32::try_from(auth.body.len()).unwrap_or(u32::MAX);
    LIMITERS
        .trigger
        .over_budget(&call.trigger_id, MINUTE, trigger_rpm)
        || LIMITERS
            .org
            .over_budget(&call.org_id, MINUTE, limit.workflow_hook_org_rpm)
        || LIMITERS.org_bytes.over_budget_by(
            &call.org_id,
            MINUTE,
            limit.workflow_hook_org_bytes_per_min,
            bytes,
        )
}

async fn dry_run(call: &HookCall, auth: &Authenticated, input: HookInput) -> Response {
    enqueue::write_audit(|| {
        enqueue::hook_audit_message(
            &call.org_id,
            &call.trigger_id,
            &call.path,
            StatusCode::OK.as_u16(),
            enqueue::dry_run_audit_body(&auth.credential_prefix, &call.caller_ip),
        )
    })
    .await;
    let body = serde_json::json!({"dry_run": true, "accepted": true, "input": input});
    (StatusCode::OK, Json(body)).into_response()
}

fn enqueue_request(
    call: &HookCall,
    headers: &HeaderMap,
    auth: &Authenticated,
    input: HookInput,
    idem_key: Option<String>,
    body_sha256: String,
) -> Result<EnqueueRequest, (HookReason, Option<u64>)> {
    let meta = serde_json::to_string(&input.meta).map_err(|e| {
        log::error!("[WORKFLOW_HOOK] hook meta does not serialise: {e}");
        (HookReason::InternalError, None)
    })?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.chars().take(MAX_CONTENT_TYPE_LEN).collect());
    Ok(EnqueueRequest {
        request: ledger::NewHookRequest {
            trigger_id: call.trigger_id.clone(),
            org_id: call.org_id.clone(),
            workflow_id: auth.trigger.trigger.workflow_id.clone(),
            run_id: input.meta.run_id.clone(),
            idem_key,
            body_sha256,
            body_bytes: i64::try_from(auth.body.len()).unwrap_or(i64::MAX),
            content_type,
            meta,
            credential_id: auth.credential_id.clone(),
            credential_prefix: auth.credential_prefix.clone(),
            caller_ip: call.caller_ip.clone(),
            received_at: call.now_us,
        },
        input,
    })
}

/// 202 for a new run, 200 with `Idempotent-Replayed` for a replay; both point at the run.
async fn answer(call: &HookCall, auth: &Authenticated, outcome: EnqueueOutcome) -> Response {
    let (status, run_id, run_status, replay) = match &outcome {
        EnqueueOutcome::Accepted { run_id } => (StatusCode::ACCEPTED, run_id, "queued", false),
        EnqueueOutcome::Replayed { run_id, status } => {
            (StatusCode::OK, run_id, status.as_str(), true)
        }
    };
    let status_url = enqueue::status_url(&call.org_id, &call.trigger_id, run_id);
    enqueue::write_audit(|| {
        enqueue::hook_audit_message(
            &call.org_id,
            &call.trigger_id,
            &call.path,
            status.as_u16(),
            enqueue::accepted_audit_body(run_id, &auth.credential_prefix, &call.caller_ip, replay),
        )
    })
    .await;
    let body =
        serde_json::json!({"run_id": run_id, "status": run_status, "status_url": status_url});
    let mut resp = (status, Json(body)).into_response();
    if let Ok(location) = HeaderValue::from_str(&status_url) {
        resp.headers_mut().insert(header::LOCATION, location);
    }
    if replay {
        resp.headers_mut()
            .insert(IDEMPOTENT_REPLAYED, HeaderValue::from_static("true"));
    }
    resp
}

async fn stored_status(
    call: &HookCall,
    auth: &Authenticated,
    run_id: &str,
) -> Result<Response, (HookReason, Option<u64>)> {
    let org_rpm = config::get_config().limit.workflow_hook_org_rpm;
    let budget = hook_limits::status_budget(hook_limits::trigger_budget(
        auth.trigger.trigger.rate_limit_per_minute,
        org_rpm,
    ));
    if LIMITERS
        .status
        .over_budget(&call.trigger_id, MINUTE, budget)
    {
        return Err((HookReason::RateLimited, Some(RATE_RETRY_AFTER_SECS)));
    }
    let row = ledger::get_run(get_orm_client_rw().await, &call.trigger_id, run_id)
        .await
        .map_err(|e| {
            log::error!("[WORKFLOW_HOOK] run lookup failed: {e}");
            (HookReason::InternalError, None)
        })?
        // A revived trigger keeps its id; older runs belong to the endpoint it replaced.
        .filter(|row| row.received_at >= auth.trigger.trigger.created_at)
        .ok_or((HookReason::RunNotFound, None))?;
    let body = serde_json::json!({
        "run_id": row.run_id,
        "status": row.status,
        "received_at": row.received_at,
        "finished_at": row.finished_at,
        "error": row.error,
        "idempotency_key": row.idem_key,
    });
    Ok((StatusCode::OK, Json(body)).into_response())
}

fn preauth(ip: Option<RealIp>) -> Result<Vec<SemaphorePermit<'static>>, Response> {
    let mut permits = Vec::with_capacity(2);
    match ip {
        Some(RealIp(addr)) => {
            let rpm = config::get_config().limit.workflow_hook_ip_rpm;
            if LIMITERS
                .ip
                .over_budget(&hook_limits::ip_key(addr), MINUTE, rpm)
            {
                return Err(reject(HookReason::RateLimited, Some(RATE_RETRY_AFTER_SECS)));
            }
        }
        None => permits.push(busy_gate(&LIMITERS.unresolved_ip)?),
    }
    permits.push(busy_gate(&LIMITERS.preauth)?);
    Ok(permits)
}

fn declared_length(headers: &HeaderMap) -> Option<usize> {
    headers
        .get(header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn body_cap(trigger: &CachedTrigger) -> usize {
    usize::try_from(trigger.trigger.max_body_bytes)
        .unwrap_or_default()
        .min(HARD_BODY_CAP)
}

fn belongs_to(trigger: &CachedTrigger, org_id: &str) -> bool {
    trigger.trigger.org_id == org_id && trigger.trigger.deleted_at.is_none()
}

async fn read_capped(body: Body, cap: usize) -> Result<Bytes, HookReason> {
    read_within_deadline(collect_capped(body, cap)).await
}

/// `DefaultBodyLimit` binds only body extractors, so the handler enforces the cap as it reads.
async fn collect_capped(body: Body, cap: usize) -> Result<Bytes, HookReason> {
    let mut stream = body.into_data_stream();
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            log::warn!("[WORKFLOW_HOOK] request body read failed: {e}");
            HookReason::InternalError
        })?;
        if buf.len() + chunk.len() > cap {
            return Err(HookReason::PayloadTooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(Bytes::from(buf))
}

/// A miss costs what a hit costs: one hash, or one HMAC over at most 64 KiB, and no body read.
fn dummy_work(shape: AuthShape, headers: &HeaderMap) {
    match shape {
        AuthShape::Signature => {
            signature::dummy_verify(declared_length(headers).unwrap_or_default());
        }
        AuthShape::Token | AuthShape::Unknown => {
            credentials::dummy_token_check(payload::bearer_token(headers).unwrap_or_default());
        }
    }
}

/// Refusals before authentication count only against a trigger of this org.
async fn note_preauth(call: &HookCall, reason: HookReason) {
    if !rejections::is_recordable_id(&call.trigger_id) {
        return;
    }
    match cache::get(&call.trigger_id).await {
        Ok(Some(trigger)) if belongs_to(&trigger, &call.org_id) => {
            rejections::record(&call.trigger_id, reason, &call.caller_ip, call.now_us);
        }
        Ok(_) => {}
        Err(e) => log::warn!("[WORKFLOW_HOOK] trigger lookup for a refused call failed: {e}"),
    }
}

async fn reject_call(call: &HookCall, reason: HookReason, retry_after: Option<u64>) -> Response {
    note_rejection(call, reason).await;
    reject(reason, retry_after)
}

/// Rejections on a known trigger feed its rejections panel and, sampled, the audit log.
async fn note_rejection(call: &HookCall, reason: HookReason) {
    rejections::record(&call.trigger_id, reason, &call.caller_ip, call.now_us);
    if call.poll || !reason.is_recorded() {
        return;
    }
    if !rejections::should_audit(&call.trigger_id, reason, call.now_us) {
        return;
    }
    enqueue::write_audit(|| {
        enqueue::hook_audit_message(
            &call.org_id,
            &call.trigger_id,
            &call.path,
            reason.status(),
            serde_json::json!({"rejected": reason.code(), "caller_ip": call.caller_ip}),
        )
    })
    .await;
}

fn reject(reason: HookReason, retry_after: Option<u64>) -> Response {
    let public = reason.public();
    if public == HookReason::Unauthorized {
        return unauthorized();
    }
    let status = StatusCode::from_u16(public.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut body = MetaHttpResponse::error(status, public.message());
    body.error_detail = Some(public.code().to_string());
    body.hint = public.hint().map(str::to_string);
    let mut resp = (status, Json(body)).into_response();
    if let Some(secs) = retry_after {
        resp.headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from(secs));
    }
    resp
}

fn unauthorized() -> Response {
    let mut body =
        MetaHttpResponse::error(StatusCode::UNAUTHORIZED, HookReason::Unauthorized.message());
    body.error_detail = Some(HookReason::Unauthorized.code().to_string());
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, CHALLENGE)],
        Json(body),
    )
        .into_response()
}

fn busy_gate(gate: &Semaphore) -> Result<SemaphorePermit<'_>, Response> {
    hook_limits::enter(gate)
        .ok_or_else(|| reject(HookReason::RateLimited, Some(BUSY_RETRY_AFTER_SECS)))
}

fn no_retry(reason: HookReason) -> (HookReason, Option<u64>) {
    (reason, None)
}

/// The enqueue's own cap check races past the pre-check, so it answers with the same hint.
fn enqueue_refusal(reason: HookReason) -> (HookReason, Option<u64>) {
    match reason {
        HookReason::QueueFull => (reason, Some(QUEUE_RETRY_AFTER_SECS)),
        _ => no_retry(reason),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{StatusCode, header};

    use super::*;

    async fn body_of(resp: Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn a_full_preauth_semaphore_answers_429_retry_after_1() {
        let gate = Semaphore::new(1);
        let _held = busy_gate(&gate).unwrap();
        let refused = busy_gate(&gate).unwrap_err();
        assert_eq!(refused.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(refused.headers()[header::RETRY_AFTER], "1");
        assert!(
            body_of(refused)
                .await
                .contains("\"error_detail\":\"rate_limited\"")
        );
    }

    #[test]
    fn a_queue_full_from_the_enqueue_itself_carries_retry_after() {
        assert_eq!(
            enqueue_refusal(HookReason::QueueFull),
            (HookReason::QueueFull, Some(QUEUE_RETRY_AFTER_SECS))
        );
        assert_eq!(
            enqueue_refusal(HookReason::InternalError),
            (HookReason::InternalError, None)
        );
        let (reason, retry_after) = enqueue_refusal(HookReason::QueueFull);
        let resp = reject(reason, retry_after);
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(resp.headers()[header::RETRY_AFTER], "30");
    }

    #[tokio::test]
    async fn the_401_is_the_same_bytes_for_every_identity_reason() {
        let expected = r#"{"code":401,"message":"Unauthorized","error_detail":"unauthorized"}"#;
        for reason in [
            HookReason::Unauthorized,
            HookReason::InvalidToken,
            HookReason::InvalidSignature,
            HookReason::StaleTimestamp,
        ] {
            let resp = reject(reason, None);
            assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
            assert!(resp.headers().contains_key(header::WWW_AUTHENTICATE));
            assert_eq!(body_of(resp).await, expected, "{reason:?}");
        }
        assert_eq!(body_of(unauthorized()).await, expected);
    }

    #[tokio::test]
    async fn every_non_2xx_uses_the_http_response_shape() {
        for (reason, retry) in [
            (HookReason::CredentialInUrl, None),
            (HookReason::PayloadTooLarge, None),
            (HookReason::RequestTimeout, None),
            (HookReason::IdempotencyKeyReused, None),
            (HookReason::RateLimited, Some(60)),
            (HookReason::QueueFull, Some(30)),
            (HookReason::WorkerUnavailable, Some(30)),
            (HookReason::RunNotFound, None),
            (HookReason::InternalError, None),
        ] {
            let resp = reject(reason, retry);
            assert_eq!(resp.status().as_u16(), reason.status(), "{reason:?}");
            assert_eq!(
                resp.headers()
                    .get(header::RETRY_AFTER)
                    .map(|v| v.to_str().unwrap().to_string()),
                retry.map(|s| s.to_string()),
                "{reason:?}"
            );
            let json: serde_json::Value = serde_json::from_str(&body_of(resp).await).unwrap();
            assert_eq!(json["code"], reason.status());
            assert_eq!(json["error_detail"], reason.code());
            assert!(json["message"].as_str().is_some_and(|m| !m.is_empty()));
        }
    }
}
