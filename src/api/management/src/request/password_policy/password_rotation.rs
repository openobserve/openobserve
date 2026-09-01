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

//! The rotation countdown handed to a user when they sign in.
//!
//! Rotation itself is enforced at resource-access time, where an expired password is refused. This
//! is only the advance notice, and it is computed once per session rather than per request: the
//! number moves when the day ticks over, so repeating it on every response would restate a value
//! that had not changed.

use chrono::{DateTime, Utc};
use common::infra::config::USERS;
use config::meta::password_policy::RotationStatus;

/// Days left before `user_email`'s password expires, or `None` when there is nothing to say.
///
/// `None` covers every case the console must not draw a banner for: rotation off, a password too
/// young to warn about, an identity with no local password, root (exempt per design §4, principle
/// 5), and an already-expired password — that one is not a warning but a block, delivered by the
/// enforcement middleware as a `password_reset_required` refusal on the next request.
pub async fn warning_days(user_email: &str) -> Option<i64> {
    let user = USERS.get(&user_email.to_lowercase())?;
    if user.is_root {
        return None;
    }

    // An unrepresentable stored timestamp lands on the same never-expired reading as no timestamp
    // at all.
    let set_at = user
        .password_updated_at
        .and_then(DateTime::from_timestamp_micros);
    let policy = db::password_policy::get_effective_policy().await;
    match policy.rotation_status(set_at, Utc::now()) {
        RotationStatus::Warning { days_remaining } => Some(days_remaining),
        RotationStatus::Current | RotationStatus::Expired => None,
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeDelta;
    use common::infra::config::SYSTEM_SETTINGS;
    use config::{
        META_ORG_ID,
        meta::{
            password_policy::PasswordPolicy,
            system_settings::{SystemSetting, keys},
            user::UserType,
        },
    };
    use infra::table::users::UserRecord;

    use super::*;

    /// A user whose password was set `age_days` ago, with nothing else standing in rotation's way.
    fn user(email: &str, age_days: i64) -> UserRecord {
        UserRecord {
            email: email.to_string(),
            first_name: "T".to_string(),
            last_name: "U".to_string(),
            password: "hash".to_string(),
            salt: "salt".to_string(),
            is_root: false,
            password_ext: None,
            user_type: UserType::Internal,
            created_at: 0,
            updated_at: 0,
            must_reset_password: false,
            password_reset_reason: None,
            flagged_at: None,
            password_updated_at: Some((Utc::now() - TimeDelta::days(age_days)).timestamp_micros()),
        }
    }

    /// Seeding the settings cache keeps the policy read off the database. The key format is
    /// db::system_settings::cache_key's; a drift there fails these tests rather than silencing
    /// them, since the read would then fall back to a policy with rotation off.
    async fn set_policy(rotation_days: u32, rotation_warning_days: u32) {
        let policy = PasswordPolicy {
            rotation_days,
            rotation_warning_days,
            ..PasswordPolicy::default()
        };
        SYSTEM_SETTINGS.write().await.insert(
            format!("org:{META_ORG_ID}:_:{}", keys::PASSWORD_POLICY),
            SystemSetting::new_org(
                META_ORG_ID,
                keys::PASSWORD_POLICY,
                serde_json::to_value(policy).unwrap(),
            ),
        );
    }

    /// One test per process-wide cache: the settings cache is shared, so the cases that need
    /// different policies cannot run as separate `#[tokio::test]`s.
    #[tokio::test]
    async fn warns_only_inside_the_window() {
        let inside = "inside@b.com";
        let young = "young@b.com";
        let expired = "expired@b.com";
        let root = "root@b.com";
        USERS.insert(inside.to_string(), user(inside, 85));
        USERS.insert(young.to_string(), user(young, 1));
        USERS.insert(expired.to_string(), user(expired, 91));
        let mut root_user = user(root, 10_000);
        root_user.is_root = true;
        USERS.insert(root.to_string(), root_user);

        set_policy(90, 7).await;

        assert_eq!(warning_days(inside).await, Some(5));
        assert_eq!(warning_days(young).await, None);
        // Expired is the middleware's block to report, not a countdown.
        assert_eq!(warning_days(expired).await, None);
        assert_eq!(warning_days(root).await, None);
        // Authenticated against something the users cache does not hold — a token, or an
        // enterprise identity. There is no local password to have a policy about.
        assert_eq!(warning_days("absent@b.com").await, None);
        // The cache is keyed lowercase, so a sign-in that cased the email differently must still
        // find the row.
        assert_eq!(warning_days("Inside@B.com").await, Some(5));

        for email in [inside, young, expired, root] {
            USERS.remove(email);
        }
        SYSTEM_SETTINGS
            .write()
            .await
            .remove(&format!("org:{META_ORG_ID}:_:{}", keys::PASSWORD_POLICY));
    }
}
