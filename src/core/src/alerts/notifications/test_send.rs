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

//! Test-send: post a REAL message to a REAL destination, marked `[TEST] `.
//!
//! This is the only notifications feature that reaches a live channel — a
//! Slack webhook, a PagerDuty service, an inbox. Two things follow:
//!
//! 1. Every rendered title is prefixed `[TEST] ` ([`build_test_message`]), so a test can never be
//!    mistaken for a real page.
//! 2. Sending is rate-capped per user ([`check_rate_limit`]) — a runaway UI loop or a scripted
//!    abuse case must not be able to spam someone's real channel.
//!
//! [`build_test_message`] is split from [`test_send`] specifically so the
//! `[TEST] ` marking can be asserted on the `RenderedMessage` without any
//! network I/O (brief Step 1).

use std::{
    collections::HashMap,
    sync::{LazyLock, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use config::{
    get_config,
    meta::{alerts::content_spec::ContentSpec, destinations::DestinationType},
};

use super::{
    context::NotificationContext, format::derive_channel_format, preview::synthetic_context,
    render::render, resolve::resolve_content,
};
use crate::alerts::alert::dispatch_test_message;
pub use crate::alerts::notifications::render::RenderedMessage;

/// Marker prepended to every test-send title/subject. Never remove or make
/// conditional — it is the entire reason a test-send is safe to build.
pub const TEST_MARKER: &str = "[TEST] ";

/// Per-user rolling 60s window: `(window_start_unix_secs, count)`.
static RATE_LIMITER: LazyLock<RwLock<HashMap<String, (i64, u32)>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TestSendError {
    /// Per-user rate cap exceeded — mapped to HTTP 429 by the handler.
    RateLimited {
        retry_after_secs: i64,
    },
    RenderFailed(String),
    DispatchFailed(String),
    /// Draft fails the same content validation `templates::save` applies.
    InvalidContent(String),
}

impl std::fmt::Display for TestSendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited { retry_after_secs } => write!(
                f,
                "Too many test-sends — try again in {retry_after_secs}s (limit: {}/min)",
                get_config().limit.alert_test_send_per_minute
            ),
            Self::RenderFailed(e) => write!(f, "test-send render failed: {e}"),
            Self::DispatchFailed(e) => write!(f, "test-send dispatch failed: {e}"),
            Self::InvalidContent(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for TestSendError {}

/// Check and record one test-send attempt for `user_id` against the
/// configured per-minute cap. Returns `Err(RateLimited)` without recording
/// the attempt when already at the cap — a rejected call must not itself
/// count against the next window.
pub fn check_rate_limit(user_id: &str) -> Result<(), TestSendError> {
    let limit = get_config().limit.alert_test_send_per_minute;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    check_rate_limit_at(user_id, limit, now)
}

/// [`check_rate_limit`] with the limit and current time as parameters —
/// split out so the `limit == 0` ("unlimited") branch and the sliding-window
/// arithmetic can be unit-tested deterministically without racing
/// `config::CONFIG` (a process-global `ArcSwap` shared with every other test
/// in this crate) or sleeping in a test.
fn check_rate_limit_at(user_id: &str, limit: u32, now: i64) -> Result<(), TestSendError> {
    if limit == 0 {
        // 0 = unlimited, consistent with the codebase's other `0 = unlimited`
        // knobs (e.g. `alert_max_group_notifications_per_eval`). Returns
        // immediately — no user/window bookkeeping happens below this line,
        // so an unlimited config never touches the rate-limiter map at all.
        return Ok(());
    }

    let mut map = RATE_LIMITER.write().unwrap_or_else(|e| e.into_inner());

    // Opportunistic pruning: every write drops entries whose window has
    // already elapsed. Without this the map is unbounded — one permanent
    // entry per distinct user id ever seen, i.e. a slow leak on a request
    // path. This keeps the map bounded to users active in the last 60s at
    // negligible per-call cost (a single pass over what is, in practice, a
    // small map).
    map.retain(|_, v| now - v.0 < 60);

    let entry = map.entry(user_id.to_string()).or_insert((now, 0));

    // New 60s window: reset.
    if now - entry.0 >= 60 {
        *entry = (now, 0);
    }

    if entry.1 >= limit {
        let retry_after_secs = 60 - (now - entry.0);
        return Err(TestSendError::RateLimited { retry_after_secs });
    }

    entry.1 += 1;
    Ok(())
}

/// Build the `[TEST] `-marked rendered message for a destination + content
/// spec, WITHOUT dispatching it. Pure and side-effect-free — reuses the exact
/// `synthetic_context` / `resolve_content` / `render` path the live preview
/// (Task 12/13) and send path (Task 9) share, so a test-send previews
/// identically to what a real alert would produce for the same spec.
///
/// The marker is stamped onto `content.title` BEFORE rendering, not by
/// post-processing the rendered payload: every renderer's output shape
/// differs (Slack is a Block Kit array with no top-level `title`/`text` key,
/// Teams is a card object, the webhook envelope has a `title` key, and
/// email's subject IS the title), and every renderer already reads
/// `content.title` verbatim — so mutating it once here guarantees the marker
/// lands correctly in whichever format the destination resolves to, current
/// or future, without the marker logic needing to know each payload shape.
pub fn build_test_message(
    dest_type: &DestinationType,
    spec: &ContentSpec,
) -> Result<RenderedMessage, TestSendError> {
    Ok(build_test_message_with_title(dest_type, spec)?.1)
}

/// Same as [`build_test_message`], but also returns the marked title used to
/// render it — needed by [`test_send`] as the SNS dispatch subject (the SNS
/// transport takes a subject as a separate argument rather than reading it
/// out of the rendered payload; see `dispatch_test_message`, alert.rs).
fn build_test_message_with_title(
    dest_type: &DestinationType,
    spec: &ContentSpec,
) -> Result<(String, RenderedMessage), TestSendError> {
    // Hold the draft to the same bar `templates::save` applies, so a
    // test-send cannot "succeed" on a template that cannot be saved.
    spec.validate().map_err(TestSendError::InvalidContent)?;

    let format = derive_channel_format(dest_type);
    let ctx: NotificationContext = synthetic_context(None);
    let mut content = resolve_content(spec, &ctx, format.channel_family());
    content.title = format!("{TEST_MARKER}{}", content.title);
    let title = content.title.clone();

    let rendered =
        render(format, &content, &ctx).map_err(|e| TestSendError::RenderFailed(e.to_string()))?;

    Ok((title, rendered))
}

/// Build the `[TEST] `-marked message and dispatch it to the real
/// destination transport. This is the only function in the module that
/// performs network I/O — callers that only need to assert on the rendered
/// shape (tests, previews) should call [`build_test_message`] instead.
pub async fn test_send(
    dest_type: &DestinationType,
    spec: &ContentSpec,
) -> Result<String, TestSendError> {
    let (title, rendered) = build_test_message_with_title(dest_type, spec)?;
    dispatch_test_message(dest_type, &title, rendered)
        .await
        .map_err(|e| TestSendError::DispatchFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use config::meta::destinations::Endpoint;

    use super::*;

    /// Serializes the rate-limiter tests against each other.
    ///
    /// They share the process-global [`RATE_LIMITER`], and every call prunes
    /// it with `retain(|_, v| now - v.0 < 60)` using the CALLER's `now`. So a
    /// test that steps its clock forward evicts a concurrently-running test's
    /// still-live entry. Distinct per-test user keys do NOT help — the prune
    /// is global, not per-key. Without this lock these tests fail
    /// intermittently depending purely on thread scheduling.
    static RATE_LIMIT_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Take [`RATE_LIMIT_TEST_LOCK`], surviving a panic in another test
    /// (a poisoned mutex would otherwise cascade one failure into all of them).
    fn rate_limit_guard() -> std::sync::MutexGuard<'static, ()> {
        RATE_LIMIT_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn slack_dest() -> DestinationType {
        DestinationType::Http(Endpoint {
            url: "https://hooks.slack.com/services/x".into(),
            destination_type: Some("slack".into()),
            ..Default::default()
        })
    }

    fn sample_spec() -> ContentSpec {
        ContentSpec {
            title: "{alert_name} fired".into(),
            body: "**{alert_name}** exceeded threshold at {alert_agg_value}".into(),
            ..Default::default()
        }
    }

    /// A draft whose link scheme `save` would reject must be rejected here
    /// too, or a test-send "succeeds" on a template that cannot be saved.
    #[test]
    fn test_send_rejects_a_draft_the_save_path_would_reject() {
        let mut spec = sample_spec();
        spec.links
            .push(config::meta::alerts::content_spec::ContentLink {
                label: "click".into(),
                url: "javascript:alert(1)".into(),
                show_when: None,
            });
        let err = build_test_message(&slack_dest(), &spec)
            .expect_err("hostile link built a test message cleanly");
        assert!(
            err.to_string().contains("click"),
            "error should name the offending link, got: {err}"
        );
    }

    #[test]
    fn test_send_title_is_test_marked() {
        let rendered = build_test_message(&slack_dest(), &sample_spec()).unwrap();
        let RenderedMessage::Http { body } = rendered else {
            panic!("expected Http rendered message for a Slack destination");
        };
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();
        // Slack Block Kit: the title is the first block of the first
        // severity-striped attachment — a bold mrkdwn LINK section
        // (`*<url|label>*`) when the context carries an alert URL, which the
        // synthetic context always does. The `[TEST]` marker must therefore
        // lead the link LABEL, not the raw string.
        let title = value
            .get("attachments")
            .and_then(|a| a.get(0))
            .and_then(|a| a.get("blocks"))
            .and_then(|b| b.get(0))
            .and_then(|b| b.get("text"))
            .and_then(|t| t.get("text"))
            .and_then(|v| v.as_str())
            .expect("slack payload carries a title block with text.text");
        let label = title.split_once('|').map(|(_, rest)| rest).unwrap_or(title);
        assert!(
            label.starts_with(TEST_MARKER),
            "test-send title label must start with `[TEST] `, got: {title}"
        );
    }

    #[test]
    fn webhook_fallback_is_also_test_marked() {
        let dest = DestinationType::Http(Endpoint {
            url: "https://example.com/webhook".into(),
            destination_type: Some("webhook".into()),
            ..Default::default()
        });
        let rendered = build_test_message(&dest, &sample_spec()).unwrap();
        let RenderedMessage::Http { body } = rendered else {
            panic!("expected Http rendered message");
        };
        let value: serde_json::Value = serde_json::from_str(&body).unwrap();
        let title = value
            .get("title")
            .and_then(|v| v.as_str())
            .expect("webhook envelope carries a title field");
        assert!(title.starts_with(TEST_MARKER));
    }

    #[test]
    fn email_subject_is_test_marked() {
        let dest = DestinationType::Email(config::meta::destinations::Email {
            recipients: vec!["test@example.com".into()],
        });
        let rendered = build_test_message(&dest, &sample_spec()).unwrap();
        let RenderedMessage::Email { subject, .. } = rendered else {
            panic!("expected Email rendered message");
        };
        assert!(subject.starts_with(TEST_MARKER));
    }

    #[test]
    fn rate_limit_allows_up_to_configured_cap_then_rejects() {
        let _guard = rate_limit_guard();
        let user = format!("rate-limit-test-user-{}", std::process::id());
        let limit = get_config().limit.alert_test_send_per_minute.max(1);
        for _ in 0..limit {
            check_rate_limit(&user).expect("within cap must succeed");
        }
        let err = check_rate_limit(&user).expect_err("exceeding cap must be rejected");
        assert!(matches!(err, TestSendError::RateLimited { .. }));
    }

    /// SNS subject: `test_send`'s dispatch subject is the marked title, not a
    /// hardcoded literal, and never drifts from `TEST_MARKER` (which includes
    /// the trailing space — a hardcoded `"[TEST]"` would silently diverge
    /// from it). This exercises the exact value `dispatch_test_message`
    /// (alert.rs) receives as its `title` argument for an SNS destination —
    /// the dispatch call itself is not unit-tested here because
    /// `send_sns_notification` performs real AWS I/O with no mock seam
    /// anywhere else in this codebase either.
    #[test]
    fn sns_dispatch_subject_is_the_marked_title_not_a_literal() {
        let dest = DestinationType::Sns(config::meta::destinations::AwsSns {
            sns_topic_arn: "arn:aws:sns:us-east-1:123456789012:topic".into(),
            aws_region: "us-east-1".into(),
        });
        let (title, rendered) = build_test_message_with_title(&dest, &sample_spec()).unwrap();
        assert!(title.starts_with(TEST_MARKER));
        assert_eq!(title, format!("{TEST_MARKER}Sample CPU alert fired"));
        match rendered {
            RenderedMessage::Sns { subject, .. } => assert_eq!(subject, title),
            other => panic!("expected Sns, got {other:?}"),
        }
    }

    // The remaining rate-limit tests use `check_rate_limit_at` with an
    // explicit `now` and `limit` rather than `check_rate_limit` (which reads
    // the real `limit` from `config::CONFIG`, a process-global `ArcSwap`
    // other tests in this crate also read — mutating it here would race
    // them). Deterministic time also avoids sleeping in a unit test to prove
    // window-reset behavior.
    //
    // These tests SHARE the process-global `RATE_LIMITER`, and every call
    // prunes it with `retain(|_, v| now - v.0 < 60)` using the CALLER's
    // `now`. A test stepping its clock forward therefore evicts a
    // concurrently-running test's still-live entry, and a real-clock caller
    // evicts every synthetic-clock entry. Distinct per-test user keys are NOT
    // sufficient — the prune is global. `RATE_LIMIT_TEST_LOCK` serializes
    // them; the distinct `t0` constants below additionally keep each test's
    // window far from its neighbours'.

    #[test]
    fn rate_limit_window_resets_after_60_seconds() {
        let _guard = rate_limit_guard();
        let user = format!("rate-limit-window-reset-{}", std::process::id());
        let limit = 3u32;
        let t0 = 1_000_000i64;
        for _ in 0..limit {
            check_rate_limit_at(&user, limit, t0).expect("within cap must succeed");
        }
        check_rate_limit_at(&user, limit, t0).expect_err("cap must be enforced within the window");
        // Still within the window one second later: still rejected.
        check_rate_limit_at(&user, limit, t0 + 1)
            .expect_err("still within the same 60s window must still be rejected");
        // 60s later: a new window, must allow requests again.
        check_rate_limit_at(&user, limit, t0 + 60)
            .expect("a new window (>= 60s later) must allow requests again");
    }

    #[test]
    fn rate_limit_zero_is_unlimited() {
        let _guard = rate_limit_guard();
        // ZO_ALERT_TEST_SEND_PER_MINUTE=0 documented as "0 = unlimited" —
        // verify the check never rejects regardless of call count, and never
        // touches the rate-limiter map, when the limit is 0.
        let user = format!("rate-limit-zero-is-unlimited-{}", std::process::id());
        for _ in 0..50 {
            check_rate_limit_at(&user, 0, 1_000_000).expect("limit == 0 must never reject");
        }
        assert!(
            !RATE_LIMITER.read().unwrap().contains_key(&user),
            "limit == 0 must return before any user/window bookkeeping"
        );
    }

    #[test]
    fn rate_limit_rejected_call_does_not_consume_quota() {
        let _guard = rate_limit_guard();
        let user = format!("rate-limit-no-consume-on-reject-{}", std::process::id());
        let limit = 3u32;
        let now = 2_000_000i64;
        for _ in 0..limit {
            check_rate_limit_at(&user, limit, now).expect("within cap must succeed");
        }
        // Exceed the cap several times — each rejection must NOT increment
        // the counter, so the window's count stays pinned at `limit`.
        for _ in 0..3 {
            check_rate_limit_at(&user, limit, now).expect_err("over cap must be rejected");
        }
        let count = {
            let map = RATE_LIMITER.read().unwrap();
            map.get(&user).unwrap().1
        };
        assert_eq!(
            count, limit,
            "repeated rejected calls must not inflate the recorded count"
        );
    }

    #[test]
    fn rate_limit_pruning_evicts_expired_entries() {
        let _guard = rate_limit_guard();
        let user = format!("rate-limit-pruning-{}", std::process::id());
        let t0 = 3_000_000i64;
        check_rate_limit_at(&user, 3, t0).expect("first call succeeds");
        assert!(
            RATE_LIMITER.read().unwrap().contains_key(&user),
            "entry recorded after a call"
        );

        // A write from a DIFFERENT user 61s later — opportunistic pruning
        // runs on every write, so the first user's now-expired entry must be
        // gone afterward without that user making another call.
        check_rate_limit_at(&format!("{user}-other"), 3, t0 + 61)
            .expect("other user's call succeeds");

        assert!(
            !RATE_LIMITER.read().unwrap().contains_key(&user),
            "expired entry must be pruned on the next write, bounding the map to active users"
        );
    }
}
