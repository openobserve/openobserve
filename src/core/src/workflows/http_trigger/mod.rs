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

//! Runs workflows started by HTTP requests on a per-region worker, apart from the trigger queue.

pub mod cache;
pub mod credentials;
pub mod enqueue;
pub mod payload;
pub mod rejections;
pub mod signature;
pub mod sweeper;
pub mod wake;
pub mod worker;

use std::time::Duration;

use config::cluster::LOCAL_NODE;
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

pub const HEARTBEAT_KEY: &str = "/workflow_hook_worker/heartbeat";
pub const WORKER_LOCK_KEY: &str = "/workflow-hook-worker";
pub const WAKE_PREFIX: &str = "/workflow_hook_wake/";
// Spike S2: the JS runtime's 10 MiB heap does not hold a larger input.
pub const HARD_BODY_CAP: usize = 1024 * 1024;
pub const DEFAULT_MAX_BODY_BYTES: i64 = 1024 * 1024;
pub const DEFAULT_TRIGGER_RPM: i32 = 60;
// The server sets no body timeout, and a stalled body would hold its pre-auth permit.
pub const BODY_READ_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum HookReason {
    Unauthorized,
    InvalidToken,
    InvalidSignature,
    StaleTimestamp,
    CredentialInUrl,
    EndpointDisabled,
    WorkflowDisabled,
    WorkflowNotPublished,
    PayloadTooLarge,
    InvalidIdempotencyKey,
    IdempotencyKeyReused,
    RateLimited,
    QueueFull,
    WorkerUnavailable,
    RunNotFound,
    InternalError,
    RequestTimeout,
}

impl HookReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::InvalidToken => "invalid_token",
            Self::InvalidSignature => "invalid_signature",
            Self::StaleTimestamp => "stale_timestamp",
            Self::CredentialInUrl => "credential_in_url",
            Self::EndpointDisabled => "endpoint_disabled",
            Self::WorkflowDisabled => "workflow_disabled",
            Self::WorkflowNotPublished => "workflow_not_published",
            Self::PayloadTooLarge => "payload_too_large",
            Self::InvalidIdempotencyKey => "invalid_idempotency_key",
            Self::IdempotencyKeyReused => "idempotency_key_reused",
            Self::RateLimited => "rate_limited",
            Self::QueueFull => "queue_full",
            Self::WorkerUnavailable => "worker_unavailable",
            Self::RunNotFound => "run_not_found",
            Self::InternalError => "internal_error",
            Self::RequestTimeout => "request_timeout",
        }
    }

    pub fn status(self) -> u16 {
        match self {
            Self::Unauthorized
            | Self::InvalidToken
            | Self::InvalidSignature
            | Self::StaleTimestamp => 401,
            Self::CredentialInUrl | Self::InvalidIdempotencyKey => 400,
            Self::EndpointDisabled | Self::WorkflowDisabled | Self::WorkflowNotPublished => 403,
            Self::RunNotFound => 404,
            Self::RequestTimeout => 408,
            Self::PayloadTooLarge => 413,
            Self::IdempotencyKeyReused => 422,
            Self::RateLimited => 429,
            Self::InternalError => 500,
            Self::QueueFull | Self::WorkerUnavailable => 503,
        }
    }

    /// Stored-only identity reasons collapse to `Unauthorized` on the wire so callers cannot probe.
    pub fn public(self) -> Self {
        match self {
            Self::InvalidToken | Self::InvalidSignature | Self::StaleTimestamp => {
                Self::Unauthorized
            }
            other => other,
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Unauthorized
            | Self::InvalidToken
            | Self::InvalidSignature
            | Self::StaleTimestamp => "Unauthorized",
            Self::CredentialInUrl => "A credential was found in the request URL",
            Self::EndpointDisabled => "This HTTP endpoint is turned off",
            Self::WorkflowDisabled => "The workflow is disabled",
            Self::WorkflowNotPublished => "The workflow is not published",
            Self::PayloadTooLarge => "The request body is too large",
            Self::InvalidIdempotencyKey => "The idempotency key is invalid",
            Self::IdempotencyKeyReused => "The idempotency key was used with a different body",
            Self::RateLimited => "Too many requests",
            Self::QueueFull => "Too many runs are waiting for this organization",
            Self::WorkerUnavailable => "No worker is available to run the workflow",
            Self::RunNotFound => "Run not found",
            Self::InternalError => "Internal error; nothing was queued",
            Self::RequestTimeout => "The request body did not arrive in time",
        }
    }

    pub fn hint(self) -> Option<&'static str> {
        match self {
            Self::CredentialInUrl => Some(
                "Send the token as an Authorization: Bearer header, then rotate it: URLs are logged",
            ),
            Self::EndpointDisabled => {
                Some("Turn the endpoint on in the workflow's HTTP endpoint settings")
            }
            Self::WorkflowDisabled => Some("Enable the workflow"),
            Self::WorkflowNotPublished => Some("Publish the workflow"),
            Self::PayloadTooLarge => Some("Send a smaller body or raise the endpoint's body limit"),
            Self::RequestTimeout => Some("Send the whole body without pausing"),
            Self::InvalidIdempotencyKey => Some("Use 1 to 255 printable ASCII characters"),
            Self::IdempotencyKeyReused => Some("Use a new idempotency key for a different body"),
            Self::RateLimited | Self::QueueFull | Self::WorkerUnavailable => {
                Some("Retry after the number of seconds in Retry-After")
            }
            Self::Unauthorized
            | Self::InvalidToken
            | Self::InvalidSignature
            | Self::StaleTimestamp
            | Self::RunNotFound
            | Self::InternalError => None,
        }
    }

    pub fn is_recorded(self) -> bool {
        !matches!(
            self,
            Self::Unauthorized | Self::RunNotFound | Self::InternalError | Self::RequestTimeout
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NodeTasks {
    pub cache_watch: bool,
    pub rejection_merge: bool,
    pub wake_coalescer: bool,
    pub workflow_cache_watch: bool,
    pub worker: bool,
}

/// Phase 1 keeps Cloud off until spike S1 sizes its caps.
pub fn hooks_enabled() -> bool {
    let common = &get_o2_config().common;
    hooks_enabled_for(
        cfg!(feature = "cloud"),
        common.workflows_enabled,
        common.workflow_hooks_enabled,
    )
}

/// Router-only nodes return early from `jobs::init`, so they need their own selection.
pub fn node_tasks(
    is_router_only: bool,
    is_scheduler: bool,
    hooks_enabled: bool,
    worker_disabled: bool,
) -> NodeTasks {
    if !hooks_enabled {
        return NodeTasks::default();
    }
    NodeTasks {
        cache_watch: true,
        rejection_merge: true,
        wake_coalescer: true,
        workflow_cache_watch: is_router_only,
        worker: is_scheduler && !worker_disabled,
    }
}

pub fn spawn_node_tasks() {
    let tasks = node_tasks(
        LOCAL_NODE.is_router() && LOCAL_NODE.is_single_role(),
        LOCAL_NODE.is_scheduler(),
        hooks_enabled(),
        config::get_config().limit.workflow_hook_worker_disabled,
    );
    if tasks.cache_watch {
        tokio::task::spawn(cache::watch());
    }
    if tasks.rejection_merge {
        tokio::task::spawn(rejections::run_merge_loop());
    }
    if tasks.wake_coalescer {
        tokio::task::spawn(wake::run_coalescer());
    }
    // Other nodes already run this watch from `jobs::init`, past the router early return.
    if tasks.workflow_cache_watch {
        tokio::task::spawn(db::workflows::watch());
    }
    if tasks.worker {
        tokio::task::spawn(worker::run_supervisor());
    }
}

/// `RequestTimeout` once the read has taken `BODY_READ_TIMEOUT`.
pub async fn read_within_deadline<T>(
    read: impl Future<Output = Result<T, HookReason>>,
) -> Result<T, HookReason> {
    tokio::time::timeout(BODY_READ_TIMEOUT, read)
        .await
        .unwrap_or(Err(HookReason::RequestTimeout))
}

fn hooks_enabled_for(is_cloud: bool, workflows_enabled: bool, hooks_flag: bool) -> bool {
    !is_cloud && workflows_enabled && hooks_flag
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_are_off_when_workflows_are_off() {
        assert!(!hooks_enabled_for(false, false, true));
        assert!(!hooks_enabled_for(false, true, false));
        assert!(hooks_enabled_for(false, true, true));
    }

    #[test]
    fn hooks_stay_off_in_cloud_builds() {
        assert!(!hooks_enabled_for(true, true, true));
    }

    #[test]
    fn router_only_nodes_get_the_hook_node_tasks() {
        let tasks = node_tasks(true, false, true, false);
        assert_eq!(
            tasks,
            NodeTasks {
                cache_watch: true,
                rejection_merge: true,
                wake_coalescer: true,
                workflow_cache_watch: true,
                worker: false,
            }
        );
    }

    #[test]
    fn every_hook_node_evicts_its_cache_and_merges_rejections() {
        for (router_only, scheduler) in [(true, false), (false, true), (false, false)] {
            let tasks = node_tasks(router_only, scheduler, true, false);
            assert!(tasks.cache_watch && tasks.rejection_merge);
        }
    }

    #[test]
    fn every_reason_has_a_status_and_code() {
        use HookReason::*;
        let table = [
            (Unauthorized, 401, "unauthorized"),
            (InvalidToken, 401, "invalid_token"),
            (InvalidSignature, 401, "invalid_signature"),
            (StaleTimestamp, 401, "stale_timestamp"),
            (CredentialInUrl, 400, "credential_in_url"),
            (EndpointDisabled, 403, "endpoint_disabled"),
            (WorkflowDisabled, 403, "workflow_disabled"),
            (WorkflowNotPublished, 403, "workflow_not_published"),
            (PayloadTooLarge, 413, "payload_too_large"),
            (InvalidIdempotencyKey, 400, "invalid_idempotency_key"),
            (IdempotencyKeyReused, 422, "idempotency_key_reused"),
            (RateLimited, 429, "rate_limited"),
            (QueueFull, 503, "queue_full"),
            (WorkerUnavailable, 503, "worker_unavailable"),
            (RunNotFound, 404, "run_not_found"),
            (InternalError, 500, "internal_error"),
            (RequestTimeout, 408, "request_timeout"),
        ];
        for (reason, status, code) in table {
            assert_eq!(reason.status(), status, "{reason:?}");
            assert_eq!(reason.code(), code, "{reason:?}");
            assert!(!reason.message().is_empty(), "{reason:?}");
            let text = format!("{} {}", reason.message(), reason.hint().unwrap_or_default());
            assert!(!text.contains("trigger step"), "{reason:?}: {text}");
        }
        assert_eq!(
            EndpointDisabled.hint(),
            Some("Turn the endpoint on in the workflow's HTTP endpoint settings")
        );
        for identity in [InvalidToken, InvalidSignature, StaleTimestamp] {
            assert_eq!(identity.public(), Unauthorized);
            assert!(identity.is_recorded());
        }
        for (reason, ..) in table {
            if !matches!(reason, InvalidToken | InvalidSignature | StaleTimestamp) {
                assert_eq!(reason.public(), reason);
            }
        }
        assert!(!Unauthorized.is_recorded());
        assert!(!RunNotFound.is_recorded());
        assert!(!InternalError.is_recorded());
        assert!(!RequestTimeout.is_recorded());
        assert_eq!(
            table
                .iter()
                .filter(|(reason, ..)| reason.is_recorded())
                .count(),
            13,
            "the stored reasons are the 13 the rejections panel names"
        );
        assert!(Unauthorized.hint().is_none());
        assert!(CredentialInUrl.hint().is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn a_body_read_past_the_deadline_is_a_request_timeout() {
        let started = tokio::time::Instant::now();
        let stalled = read_within_deadline(std::future::pending::<Result<(), HookReason>>()).await;
        assert_eq!(stalled, Err(HookReason::RequestTimeout));
        assert_eq!(started.elapsed(), BODY_READ_TIMEOUT);
        assert_eq!(read_within_deadline(async { Ok(7) }).await, Ok(7));
        assert_eq!(
            read_within_deadline(async { Err::<(), _>(HookReason::PayloadTooLarge) }).await,
            Err(HookReason::PayloadTooLarge)
        );
    }

    #[test]
    fn schedulers_get_the_worker() {
        let tasks = node_tasks(false, true, true, false);
        assert!(tasks.worker);
        assert!(tasks.wake_coalescer);
        assert!(
            !tasks.workflow_cache_watch,
            "a scheduler already runs the workflow watch from jobs::init"
        );
        assert!(!node_tasks(false, false, true, false).worker);
    }

    #[test]
    fn a_disabled_worker_is_not_spawned() {
        let tasks = node_tasks(false, true, true, true);
        assert!(!tasks.worker);
        assert!(tasks.wake_coalescer);
    }

    #[test]
    fn nothing_spawns_when_hooks_are_off() {
        for (router_only, scheduler) in [(true, false), (false, true), (false, false)] {
            assert_eq!(
                node_tasks(router_only, scheduler, false, false),
                NodeTasks::default()
            );
        }
    }
}
