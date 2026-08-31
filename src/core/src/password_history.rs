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

//! Password reuse prevention.
//!
//! Every accepted password is written to `user_password_history`, so the candidate set the check
//! reads is that one table: `users.password` is never a second source of truth here.
//!
//! Hashing is per-user salted and deterministic, so a candidate is hashed once and compared as a
//! string against each stored hash — the depth of the history costs reads, not Argon2 passes.

use config::meta::password_policy::PasswordPolicy;
use infra::table::user_password_history;

use crate::auth::get_hash;

/// Reject `new_password` if the user has used it recently, and record it if they have not.
///
/// Returns the hash of `new_password`, so the caller stores that rather than paying for a second
/// Argon2 pass over the same string.
///
/// `current_hash` is the hash being replaced. It is compared directly and, when the history does
/// not already hold it, written there first: a user who predates reuse prevention has no history
/// rows at all, and without the backfill their first change under the new policy could be back to
/// the password they are already using.
///
/// Recording happens before the caller writes the new hash to `users`. If that write then fails,
/// the user is held to a password they never had — recoverable friction, where the reverse order
/// risks a live password absent from its own history and a reuse check that silently misses it.
pub async fn check_reuse_and_record(
    email: &str,
    salt: &str,
    new_password: &str,
    current_hash: &str,
    policy: &PasswordPolicy,
) -> Result<String, String> {
    let new_hash = get_hash(new_password, salt);
    if policy.history_count == 0 {
        return Ok(new_hash);
    }
    if new_hash == current_hash {
        return Err(reuse_message(policy.history_count));
    }

    let recent = user_password_history::list_recent(email, u64::from(policy.history_count))
        .await
        .map_err(|e| {
            log::error!("Failed to read the password history for {email}: {e}");
            "Could not check the new password against your password history".to_string()
        })?;
    if recent.iter().any(|entry| entry.password_hash == new_hash) {
        return Err(reuse_message(policy.history_count));
    }

    if !current_hash.is_empty()
        && !recent
            .iter()
            .any(|entry| entry.password_hash == current_hash)
    {
        record(email, current_hash).await?;
    }
    record(email, &new_hash).await?;

    if let Err(e) =
        user_password_history::prune(email, u64::from(policy.history_max_retained)).await
    {
        // The change has already landed, and the next one prunes what this one left behind.
        log::error!("Failed to prune the password history for {email}: {e}");
    }

    Ok(new_hash)
}

async fn record(email: &str, password_hash: &str) -> Result<(), String> {
    user_password_history::add(email, password_hash)
        .await
        .map_err(|e| {
            log::error!("Failed to record the password history for {email}: {e}");
            "Could not record the new password in your password history".to_string()
        })
}

fn reuse_message(history_count: u32) -> String {
    format!(
        "New password matches one of your last {history_count} passwords, please choose a different one"
    )
}

#[cfg(test)]
mod tests {
    use infra::{db::get_orm_client_rw, table as infra_table};

    use super::*;

    const SALT: &str = "history-salt";

    async fn set_up(email: &str) {
        let _ = get_orm_client_rw().await;
        let _ = infra_table::create_user_tables().await;
        let _ = user_password_history::delete_all_for_user(email).await;
    }

    fn policy(history_count: u32, history_max_retained: u32) -> PasswordPolicy {
        PasswordPolicy {
            history_count,
            history_max_retained,
            ..Default::default()
        }
    }

    async fn stored_hashes(email: &str) -> Vec<String> {
        user_password_history::list_recent(email, 100)
            .await
            .unwrap()
            .into_iter()
            .map(|entry| entry.password_hash)
            .collect()
    }

    #[tokio::test]
    async fn disabled_history_records_nothing() {
        let email = "reuse-disabled@zo.dev";
        set_up(email).await;

        let hash = check_reuse_and_record(email, SALT, "Pass#1234", "", &policy(0, 30))
            .await
            .unwrap();

        assert_eq!(hash, get_hash("Pass#1234", SALT));
        assert!(stored_hashes(email).await.is_empty());
    }

    #[tokio::test]
    async fn the_replaced_password_is_backfilled_into_an_empty_history() {
        let email = "reuse-backfill@zo.dev";
        set_up(email).await;
        let current = get_hash("Old#12345", SALT);

        let new_hash = check_reuse_and_record(email, SALT, "New#12345", &current, &policy(3, 30))
            .await
            .unwrap();

        assert_eq!(stored_hashes(email).await, vec![new_hash, current]);
    }

    #[tokio::test]
    async fn the_current_password_is_rejected_without_reading_history() {
        let email = "reuse-current@zo.dev";
        set_up(email).await;
        let current = get_hash("Same#12345", SALT);

        let err = check_reuse_and_record(email, SALT, "Same#12345", &current, &policy(3, 30))
            .await
            .unwrap_err();

        assert!(err.contains("last 3"), "{err}");
        assert!(stored_hashes(email).await.is_empty());
    }

    #[tokio::test]
    async fn only_the_configured_depth_is_checked() {
        let email = "reuse-depth@zo.dev";
        set_up(email).await;
        let deep = policy(3, 30);
        let original = get_hash("Old#12345", SALT);

        let first = check_reuse_and_record(email, SALT, "Aaa#12345", &original, &deep)
            .await
            .unwrap();
        let second = check_reuse_and_record(email, SALT, "Bbb#12345", &first, &deep)
            .await
            .unwrap();

        assert!(
            check_reuse_and_record(email, SALT, "Old#12345", &second, &deep)
                .await
                .is_err()
        );
        assert!(
            check_reuse_and_record(email, SALT, "Old#12345", &second, &policy(1, 30))
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn history_is_pruned_to_the_retained_depth() {
        let email = "reuse-prune@zo.dev";
        set_up(email).await;
        let shallow = policy(2, 2);
        let mut current = get_hash("Seed#1234", SALT);

        for i in 0..4 {
            current =
                check_reuse_and_record(email, SALT, &format!("Pass#{i}234"), &current, &shallow)
                    .await
                    .unwrap();
        }

        assert_eq!(stored_hashes(email).await.len(), 2);
    }

    #[tokio::test]
    async fn retention_is_capped_even_below_the_checked_depth() {
        let email = "reuse-retention-cap@zo.dev";
        set_up(email).await;
        // `PasswordPolicy::validate` rejects this, but an older build's row can still carry it.
        let inconsistent = policy(3, 1);
        let mut current = get_hash("Seed#1234", SALT);

        for i in 0..3 {
            current = check_reuse_and_record(
                email,
                SALT,
                &format!("Pass#{i}234"),
                &current,
                &inconsistent,
            )
            .await
            .unwrap();
        }

        assert_eq!(stored_hashes(email).await.len(), 1);
    }
}
