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

//! Failed-login lockout with escalating backoff.
//!
//! **Callers must exempt root.** Nothing in this module checks: it is reached from the credential
//! path, which is exactly where root's exemption has to hold. Anyone who knows root's address could
//! otherwise lock the one account with no recovery path out of the instance, without ever guessing
//! its password.
//!
//! State lives in `user_auth_state`, one row per user, written only after a failure. Every mutation
//! is a single conditional statement — the counter is incremented by the database and the lockout
//! is a compare-and-set — so concurrent attempts against one account cannot lose a failure or
//! escalate twice. There is no in-process state, so the count is shared across nodes.
//!
//! Accepted limitation: lockout is itself a denial-of-service vector, since anyone who knows an
//! address can lock it by guessing wrongly. That is the standard tradeoff against CAPTCHA-after-N
//! or IP throttling, and it is not a defect to be fixed here.

use config::{meta::password_policy::LockoutPolicy, utils::time::now_micros};
use infra::table::user_auth_state;

const MICROS_PER_SEC: i64 = 1_000_000;

/// Where a login attempt stands with the lockout policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginAttemptOutcome {
    /// Nothing bars the attempt, and there is no failure state to clear on success.
    Allowed,
    /// Nothing bars the attempt, but earlier failures are still recorded. Split from `Allowed` so
    /// the common case — a user who has never failed — costs no write on every successful request.
    AllowedWithFailures,
    Locked {
        retry_after_secs: i64,
    },
}

/// Whether `user_email` may attempt a password comparison at all.
///
/// Fails open. An instance that cannot read its lockout state should still let people log in;
/// refusing every attempt would turn a database blip into a total outage, which is a worse failure
/// than briefly not enforcing a lockout.
pub async fn check_lockout(user_email: &str, policy: &LockoutPolicy) -> LoginAttemptOutcome {
    if !policy.is_enabled() {
        return LoginAttemptOutcome::Allowed;
    }

    let state = match user_auth_state::get(user_email).await {
        Ok(Some(state)) => state,
        Ok(None) => return LoginAttemptOutcome::Allowed,
        Err(e) => {
            log::error!("Failed to read the lockout state for {user_email}: {e}");
            return LoginAttemptOutcome::Allowed;
        }
    };

    match remaining_lock_secs(state.locked_until, now_micros()) {
        Some(retry_after_secs) => LoginAttemptOutcome::Locked { retry_after_secs },
        // The level is left alone: it escalates the *next* lockout, even after this one expires.
        None if state.failed_attempts > 0 || state.lockout_level > 0 => {
            LoginAttemptOutcome::AllowedWithFailures
        }
        None => LoginAttemptOutcome::Allowed,
    }
}

/// Count a wrong password, and lock the account if that crossed the current bucket.
///
/// Returns the state the attempt leaves the account in, so a caller that wants to report a
/// retry-after can. The failure is recorded even when the caller ignores the result.
pub async fn record_failed_attempt(
    user_email: &str,
    policy: &LockoutPolicy,
) -> LoginAttemptOutcome {
    if !policy.is_enabled() {
        return LoginAttemptOutcome::Allowed;
    }

    let now = now_micros();
    if let Err(e) = increment_failure(user_email, now).await {
        // Fail open: reporting a lockout that was never stored would deny a correct password.
        log::error!("Failed to record a login failure for {user_email}: {e}");
        return LoginAttemptOutcome::AllowedWithFailures;
    }

    match escalate_if_spilling_bucket(user_email, policy, now).await {
        Ok(outcome) => outcome,
        Err(e) => {
            log::error!("Failed to evaluate the lockout for {user_email}: {e}");
            LoginAttemptOutcome::AllowedWithFailures
        }
    }
}

/// Clear the failure counters after a correct password.
///
/// Only worth calling when [`check_lockout`] reported [`LoginAttemptOutcome::AllowedWithFailures`];
/// for everyone else there is no row and nothing to clear.
pub async fn record_successful_login(user_email: &str) -> Result<(), anyhow::Error> {
    user_auth_state::reset(user_email)
        .await
        .map_err(|e| anyhow::anyhow!("Error resetting the lockout state for {user_email}: {e}"))
}

/// Increment the counter, inserting the row the first time. The insert ignores a conflict and the
/// caller retries the increment, so two simultaneous first failures still count as two.
async fn increment_failure(user_email: &str, now: i64) -> Result<(), infra::errors::Error> {
    if user_auth_state::increment_failed_attempts(user_email, now).await? {
        return Ok(());
    }
    if user_auth_state::insert_first_failure(user_email, now).await? {
        return Ok(());
    }
    user_auth_state::increment_failed_attempts(user_email, now).await?;
    Ok(())
}

async fn escalate_if_spilling_bucket(
    user_email: &str,
    policy: &LockoutPolicy,
    now: i64,
) -> Result<LoginAttemptOutcome, infra::errors::Error> {
    let Some(state) = user_auth_state::get(user_email).await? else {
        return Ok(LoginAttemptOutcome::AllowedWithFailures);
    };

    if let Some(retry_after_secs) = remaining_lock_secs(state.locked_until, now) {
        return Ok(LoginAttemptOutcome::Locked { retry_after_secs });
    }

    let level = u32::try_from(state.lockout_level).unwrap_or(0);
    let bucket = i32::try_from(policy.bucket(level)).unwrap_or(i32::MAX);
    if state.failed_attempts < bucket {
        return Ok(LoginAttemptOutcome::AllowedWithFailures);
    }

    let duration_secs = policy.duration_secs(level + 1);
    let locked_until = now + duration_secs.saturating_mul(MICROS_PER_SEC);
    if user_auth_state::escalate(user_email, state.lockout_level, bucket, locked_until).await? {
        log::warn!("Locked {user_email} out for {duration_secs}s after repeated login failures");
        return Ok(LoginAttemptOutcome::Locked {
            retry_after_secs: duration_secs,
        });
    }

    // Another request escalated first, so report its lockout rather than stacking a second.
    let locked_until = user_auth_state::get(user_email)
        .await?
        .and_then(|state| state.locked_until);
    Ok(match remaining_lock_secs(locked_until, now) {
        Some(retry_after_secs) => LoginAttemptOutcome::Locked { retry_after_secs },
        None => LoginAttemptOutcome::AllowedWithFailures,
    })
}

/// Seconds left on a lock, or `None` once it has expired. Rounds up, so the last partial second
/// reads as 1 rather than as "try again now".
fn remaining_lock_secs(locked_until: Option<i64>, now: i64) -> Option<i64> {
    let remaining = locked_until? - now;
    if remaining <= 0 {
        return None;
    }
    Some((remaining + MICROS_PER_SEC - 1) / MICROS_PER_SEC)
}

#[cfg(test)]
mod tests {
    use config::meta::password_policy::LockoutBackoff;
    use infra::{db::get_orm_client_rw, table as infra_table};

    use super::*;

    /// Lockout state carries a foreign key to `users`, and SQLite enforces it here, so the account
    /// has to exist before it can be locked — as it always does in production, where the credential
    /// path has already looked the user up.
    async fn set_up(email: &str) {
        let _ = get_orm_client_rw().await;
        infra_table::create_user_tables().await.unwrap();
        user_auth_state::delete(email).await.unwrap();
        infra_table::users::add(infra_table::users::UserRecord {
            email: email.to_string(),
            first_name: "lockout".to_string(),
            last_name: "test".to_string(),
            password: "hash".to_string(),
            salt: "salt".to_string(),
            is_root: false,
            password_ext: None,
            user_type: config::meta::user::UserType::Internal,
            created_at: 0,
            updated_at: 0,
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: None,
        })
        .await
        .unwrap();
    }

    /// Move an active lockout into the past without touching the escalation level, which is what
    /// waiting one out would do. `escalate` cannot stand in for this — it bumps the level.
    async fn expire_lock(email: &str) {
        user_auth_state::set_locked_until(email, Some(now_micros() - MICROS_PER_SEC))
            .await
            .unwrap();
    }

    fn policy(threshold: u32, bucket_size: u32) -> LockoutPolicy {
        LockoutPolicy {
            threshold,
            bucket_size,
            start_secs: 60,
            max_secs: 3600,
            backoff: LockoutBackoff::Exponential,
        }
    }

    #[test]
    fn test_remaining_lock_secs_rounds_up_and_expires() {
        assert_eq!(remaining_lock_secs(None, 100), None);
        assert_eq!(remaining_lock_secs(Some(100), 100), None, "expired exactly");
        assert_eq!(remaining_lock_secs(Some(99), 100), None);
        assert_eq!(
            remaining_lock_secs(Some(100 + MICROS_PER_SEC), 100),
            Some(1)
        );
        assert_eq!(remaining_lock_secs(Some(101), 100), Some(1), "rounds up");
    }

    #[tokio::test]
    async fn disabled_lockout_touches_nothing() {
        let email = "lockout-disabled@zo.dev";
        set_up(email).await;
        let off = policy(0, 0);

        assert_eq!(
            check_lockout(email, &off).await,
            LoginAttemptOutcome::Allowed
        );
        assert_eq!(
            record_failed_attempt(email, &off).await,
            LoginAttemptOutcome::Allowed
        );
        assert!(user_auth_state::get(email).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn the_account_locks_on_the_threshold_not_before() {
        let email = "lockout-threshold@zo.dev";
        set_up(email).await;
        let p = policy(3, 0);

        for _ in 0..2 {
            assert_eq!(
                record_failed_attempt(email, &p).await,
                LoginAttemptOutcome::AllowedWithFailures
            );
        }

        let outcome = record_failed_attempt(email, &p).await;
        assert_eq!(
            outcome,
            LoginAttemptOutcome::Locked {
                retry_after_secs: 60
            }
        );
        assert!(matches!(
            check_lockout(email, &p).await,
            LoginAttemptOutcome::Locked { .. }
        ));

        let state = user_auth_state::get(email).await.unwrap().unwrap();
        assert_eq!(state.lockout_level, 1);
        assert_eq!(state.failed_attempts, 0, "the next bucket starts at zero");
    }

    #[tokio::test]
    async fn a_second_lockout_uses_the_bucket_size_and_the_next_backoff_step() {
        let email = "lockout-escalation@zo.dev";
        set_up(email).await;
        let p = policy(3, 1);

        for _ in 0..3 {
            record_failed_attempt(email, &p).await;
        }
        expire_lock(email).await;

        let outcome = record_failed_attempt(email, &p).await;
        assert_eq!(
            outcome,
            LoginAttemptOutcome::Locked {
                retry_after_secs: 120
            },
            "one more failure is enough at bucket_size 1, and the backoff has doubled"
        );
        assert_eq!(
            user_auth_state::get(email)
                .await
                .unwrap()
                .unwrap()
                .lockout_level,
            2
        );
    }

    #[tokio::test]
    async fn a_successful_login_clears_the_escalation() {
        let email = "lockout-reset@zo.dev";
        set_up(email).await;
        let p = policy(3, 0);

        record_failed_attempt(email, &p).await;
        assert_eq!(
            check_lockout(email, &p).await,
            LoginAttemptOutcome::AllowedWithFailures
        );

        record_successful_login(email).await.unwrap();

        assert_eq!(check_lockout(email, &p).await, LoginAttemptOutcome::Allowed);
        let state = user_auth_state::get(email).await.unwrap().unwrap();
        assert_eq!(state.failed_attempts, 0);
        assert_eq!(state.lockout_level, 0);
        assert!(state.locked_until.is_none());
    }

    #[tokio::test]
    async fn an_expired_lockout_lets_the_user_try_again() {
        let email = "lockout-expiry@zo.dev";
        set_up(email).await;
        let p = policy(2, 0);

        record_failed_attempt(email, &p).await;
        record_failed_attempt(email, &p).await;
        assert!(matches!(
            check_lockout(email, &p).await,
            LoginAttemptOutcome::Locked { .. }
        ));

        expire_lock(email).await;

        assert_eq!(
            check_lockout(email, &p).await,
            LoginAttemptOutcome::AllowedWithFailures,
            "the level survives the expiry so the next lockout is longer"
        );
    }

    /// The one that matters: simultaneous failures must all be counted, and must produce exactly
    /// one lockout rather than racing past the threshold or stacking escalations.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_failures_neither_lose_a_count_nor_escalate_twice() {
        let email = "lockout-concurrent@zo.dev";
        set_up(email).await;
        let p = policy(10, 0);

        // Spawned rather than joined on one task: these have to land on different worker threads
        // for the race to be real.
        let attempts: Vec<_> = (0..10)
            .map(|_| {
                let email = email.to_string();
                let policy = p.clone();
                tokio::spawn(async move { record_failed_attempt(&email, &policy).await })
            })
            .collect();
        let mut outcomes = Vec::with_capacity(attempts.len());
        for attempt in attempts {
            outcomes.push(attempt.await.unwrap());
        }

        let locked = outcomes
            .iter()
            .filter(|outcome| matches!(outcome, LoginAttemptOutcome::Locked { .. }))
            .count();
        assert!(locked >= 1, "the burst must lock the account: {outcomes:?}");

        let state = user_auth_state::get(email).await.unwrap().unwrap();
        assert_eq!(
            state.lockout_level, 1,
            "exactly one escalation, whatever the interleaving"
        );
        assert!(state.locked_until.is_some());
    }
}
