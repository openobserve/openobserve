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

//! Instance-wide authentication policy for native (email/password) users.
//!
//! The policy lives in a single `system_settings` row and is configured only through the admin API.
//! There is no environment-variable path: an instance that has never been configured enforces
//! [`PasswordPolicy::default`], which is the pre-feature behaviour.

use chrono::{DateTime, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How lockout duration grows with each successive lockout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum LockoutBackoff {
    Linear,
    #[default]
    Exponential,
}

/// What a policy violation blocks once it is detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementMode {
    /// Reject every request until the violation is resolved.
    #[default]
    HardBlock,
    /// Reject only mutating requests, leaving reads available.
    RestrictWrites,
}

/// Why a user must set a new password.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PasswordResetReason {
    /// The complexity policy was tightened under the user's existing password.
    PolicyTightened,
    /// The password is older than `rotation_days`. Never stored: rotation is recomputed from
    /// `password_updated_at` on every request, so a stored flag could only go stale.
    RotationExpired,
}

/// Where a password sits relative to the rotation deadline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotationStatus {
    /// Rotation is off, the password has no recorded age, or the deadline is not close yet.
    Current,
    /// Inside the warning window. `days_remaining` is rounded up, so the final day reads as 1
    /// rather than 0 and the message never says the password expires today when it does not.
    Warning {
        days_remaining: i64,
    },
    Expired,
}

/// Failed-login lockout knobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct LockoutPolicy {
    /// Failed attempts before the first lockout. `0` disables lockout entirely.
    pub threshold: u32,
    /// Failed attempts before each subsequent lockout. `0` reuses `threshold`.
    pub bucket_size: u32,
    pub start_secs: u32,
    pub max_secs: u32,
    pub backoff: LockoutBackoff,
}

/// The resolved instance-wide policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct PasswordPolicy {
    pub min_length: u32,
    /// `0` means unbounded.
    pub max_length: u32,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_digit: bool,
    pub require_special: bool,
    /// Empty means any non-alphanumeric character counts as special.
    pub special_char_set: String,
    /// `0` disables rotation enforcement.
    pub rotation_days: u32,
    /// Days before expiry to start warning. `0` = never warn; equal to `rotation_days` = warn on
    /// every request, since no live password is then outside the window.
    pub rotation_warning_days: u32,
    /// `0` disables reuse prevention.
    pub history_count: u32,
    /// Hashes retained per user; kept at or above `history_count` so a later increase to
    /// `history_count` has history to check against.
    pub history_max_retained: u32,
    pub lockout: LockoutPolicy,
    pub enforcement_mode: EnforcementMode,
}

/// The subset of the policy safe to show a non-admin: what a password must look like, and nothing
/// about how the instance defends itself.
///
/// Lockout thresholds and history depth are deliberately absent. A brute-forcer who can read
/// `lockout.threshold` and `lockout.start_secs` knows exactly how to pace attempts to stay under
/// them, which turns a defence into a published rate limit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PasswordComplexity {
    pub min_length: u32,
    /// `0` means unbounded.
    pub max_length: u32,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_digit: bool,
    pub require_special: bool,
    /// Empty means any non-alphanumeric character counts as special.
    pub special_char_set: String,
}

impl LockoutBackoff {
    pub fn as_str(&self) -> &'static str {
        match self {
            LockoutBackoff::Linear => "linear",
            LockoutBackoff::Exponential => "exponential",
        }
    }
}

impl std::fmt::Display for LockoutBackoff {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for LockoutBackoff {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "linear" => Ok(LockoutBackoff::Linear),
            "exponential" => Ok(LockoutBackoff::Exponential),
            _ => Err(format!("Invalid lockout backoff: {s}")),
        }
    }
}

impl EnforcementMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            EnforcementMode::HardBlock => "hard_block",
            EnforcementMode::RestrictWrites => "restrict_writes",
        }
    }
}

impl std::fmt::Display for EnforcementMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for EnforcementMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "hard_block" => Ok(EnforcementMode::HardBlock),
            "restrict_writes" => Ok(EnforcementMode::RestrictWrites),
            _ => Err(format!("Invalid password policy enforcement mode: {s}")),
        }
    }
}

impl PasswordResetReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            PasswordResetReason::PolicyTightened => "policy_tightened",
            PasswordResetReason::RotationExpired => "rotation_expired",
        }
    }
}

impl std::fmt::Display for PasswordResetReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for PasswordResetReason {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "policy_tightened" => Ok(PasswordResetReason::PolicyTightened),
            "rotation_expired" => Ok(PasswordResetReason::RotationExpired),
            _ => Err(format!("Invalid password reset reason: {s}")),
        }
    }
}

impl LockoutPolicy {
    /// Whether lockout is switched on at all. `0` is the default, so an unconfigured instance
    /// never reads or writes lockout state.
    pub fn is_enabled(&self) -> bool {
        self.threshold != 0
    }

    /// Failed attempts tolerated before the lockout at `level` (0 = not locked out yet) triggers.
    pub fn bucket(&self, level: u32) -> u32 {
        if level == 0 || self.bucket_size == 0 {
            self.threshold
        } else {
            self.bucket_size
        }
    }

    /// How long the lockout at `level` lasts. `level` is 1-based, so the first lockout is
    /// `start_secs` under either backoff.
    ///
    /// Saturating throughout: an exponential backoff that ran long enough would otherwise wrap and
    /// hand a serial attacker a *shorter* lockout the deeper they get.
    pub fn duration_secs(&self, level: u32) -> i64 {
        if level == 0 {
            return 0;
        }
        let start = u64::from(self.start_secs);
        let secs = match self.backoff {
            LockoutBackoff::Linear => start.saturating_mul(u64::from(level)),
            LockoutBackoff::Exponential => match level - 1 {
                shift if shift < 63 => start.saturating_mul(1u64 << shift),
                _ => u64::MAX,
            },
        };
        secs.min(u64::from(self.max_secs)) as i64
    }
}

impl Default for LockoutPolicy {
    fn default() -> Self {
        Self {
            threshold: 0,
            bucket_size: 0,
            start_secs: 60,
            max_secs: 3600,
            backoff: LockoutBackoff::Exponential,
        }
    }
}

impl Default for PasswordPolicy {
    /// What an unconfigured instance enforces: every enforcing feature off, and the historical
    /// 8-character minimum retained. Upgrading to this feature therefore changes nothing until an
    /// admin writes a policy.
    ///
    /// `rotation_warning_days` is the one non-zero optional default; it stays inert while
    /// `rotation_days` is 0, and exists so enabling rotation gives a grace period rather than a
    /// silent hard cutover.
    fn default() -> Self {
        Self {
            min_length: 8,
            max_length: 0,
            require_uppercase: false,
            require_lowercase: false,
            require_digit: false,
            require_special: false,
            special_char_set: String::new(),
            rotation_days: 0,
            rotation_warning_days: 7,
            history_count: 0,
            history_max_retained: 30,
            lockout: LockoutPolicy::default(),
            enforcement_mode: EnforcementMode::HardBlock,
        }
    }
}

impl From<&PasswordPolicy> for PasswordComplexity {
    fn from(policy: &PasswordPolicy) -> Self {
        Self {
            min_length: policy.min_length,
            max_length: policy.max_length,
            require_uppercase: policy.require_uppercase,
            require_lowercase: policy.require_lowercase,
            require_digit: policy.require_digit,
            require_special: policy.require_special,
            special_char_set: policy.special_char_set.clone(),
        }
    }
}

impl PasswordPolicy {
    /// Whether the complexity requirements grew, i.e. a password that satisfied `previous` may no
    /// longer satisfy `self`.
    ///
    /// Only complexity dimensions are considered. Rotation, reuse and lockout are all evaluated
    /// against live state at access time, so tightening them needs no stored flag.
    ///
    /// Known limitation: a changed `special_char_set` never counts as stricter — the sets have no
    /// defined ordering, so narrowing one is invisible here.
    pub fn is_stricter_than(&self, previous: &Self) -> bool {
        let newly_bounded_max = self.max_length != 0
            && (previous.max_length == 0 || self.max_length < previous.max_length);

        self.min_length > previous.min_length
            || newly_bounded_max
            || (self.require_uppercase && !previous.require_uppercase)
            || (self.require_lowercase && !previous.require_lowercase)
            || (self.require_digit && !previous.require_digit)
            || (self.require_special && !previous.require_special)
    }

    /// Where a password last set at `password_updated_at` sits relative to the rotation deadline,
    /// as of `now`.
    ///
    /// A `None` timestamp reads as never-expired rather than as the epoch. It should not survive
    /// the column backfill, but if one ever appears the alternative failure mode is expiring every
    /// password on the instance at once.
    ///
    /// Rotation is recomputed here on every check, so lowering `rotation_days` takes effect on the
    /// next request with no sweep and nothing stored.
    pub fn rotation_status(
        &self,
        password_updated_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> RotationStatus {
        if self.rotation_days == 0 {
            return RotationStatus::Current;
        }
        let Some(updated_at) = password_updated_at else {
            return RotationStatus::Current;
        };

        // A deadline that falls outside the representable range is one no password can ever reach,
        // so it reads as no deadline at all rather than as one that has already passed.
        let Some(expires_at) = TimeDelta::try_days(i64::from(self.rotation_days))
            .and_then(|lifetime| updated_at.checked_add_signed(lifetime))
        else {
            return RotationStatus::Current;
        };

        let remaining = expires_at - now;
        if remaining <= TimeDelta::zero() {
            return RotationStatus::Expired;
        }
        if self.rotation_warning_days == 0 {
            return RotationStatus::Current;
        }

        // Any part of a day still counts as a day, so the final day reads as 1 rather than 0.
        let whole_days = remaining.num_days();
        let days_remaining = if remaining > TimeDelta::days(whole_days) {
            whole_days + 1
        } else {
            whole_days
        };
        // A window as long as the rotation period leaves no password outside it, which is how an
        // admin asks for the countdown on every sign-in rather than only near the deadline.
        if days_remaining <= i64::from(self.rotation_warning_days) {
            RotationStatus::Warning { days_remaining }
        } else {
            RotationStatus::Current
        }
    }

    /// Failed attempts tolerated before the lockout at `level` (0 = no lockout yet) triggers.
    pub fn lockout_bucket(&self, level: u32) -> u32 {
        self.lockout.bucket(level)
    }

    /// Reject combinations that contradict themselves. Errors name the offending field so the API
    /// can hand the message straight back to the caller.
    ///
    /// These are consistency checks only — a permissive policy is a legitimate configuration, so
    /// nothing here imposes a floor on `min_length` or refuses to disable a feature.
    pub fn validate(&self) -> Result<(), String> {
        if self.max_length != 0 && self.max_length < self.min_length {
            return Err(format!(
                "max_length ({}) must be at least min_length ({}), or 0 for unbounded",
                self.max_length, self.min_length
            ));
        }
        // Equal is allowed and is what an unset window resolves to: the countdown then rides on
        // every response. Beyond the rotation period it would only describe days that never exist.
        if self.rotation_days != 0 && self.rotation_warning_days > self.rotation_days {
            return Err(format!(
                "rotation_warning_days ({}) must not exceed rotation_days ({})",
                self.rotation_warning_days, self.rotation_days
            ));
        }
        if self.history_max_retained < self.history_count {
            return Err(format!(
                "history_max_retained ({}) must be at least history_count ({})",
                self.history_max_retained, self.history_count
            ));
        }
        if self.lockout.start_secs > self.lockout.max_secs {
            return Err(format!(
                "lockout.start_secs ({}) must not exceed lockout.max_secs ({})",
                self.lockout.start_secs, self.lockout.max_secs
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PasswordPolicy {
        PasswordPolicy::default()
    }

    #[test]
    fn test_lockout_backoff_round_trip() {
        assert_eq!(
            "linear".parse::<LockoutBackoff>().unwrap(),
            LockoutBackoff::Linear
        );
        assert_eq!(
            "EXPONENTIAL".parse::<LockoutBackoff>().unwrap(),
            LockoutBackoff::Exponential
        );
        assert!("cubic".parse::<LockoutBackoff>().is_err());
        assert_eq!(LockoutBackoff::Linear.to_string(), "linear");
    }

    #[test]
    fn test_enforcement_mode_round_trip() {
        assert_eq!(
            "hard_block".parse::<EnforcementMode>().unwrap(),
            EnforcementMode::HardBlock
        );
        assert_eq!(
            "restrict_writes".parse::<EnforcementMode>().unwrap(),
            EnforcementMode::RestrictWrites
        );
        assert!("nope".parse::<EnforcementMode>().is_err());
        assert_eq!(
            EnforcementMode::RestrictWrites.to_string(),
            "restrict_writes"
        );
    }

    #[test]
    fn test_password_reset_reason_round_trip() {
        assert_eq!(
            "policy_tightened".parse::<PasswordResetReason>().unwrap(),
            PasswordResetReason::PolicyTightened
        );
        assert_eq!(
            "rotation_expired".parse::<PasswordResetReason>().unwrap(),
            PasswordResetReason::RotationExpired
        );
        assert!("other".parse::<PasswordResetReason>().is_err());
        assert_eq!(
            PasswordResetReason::PolicyTightened.as_str(),
            "policy_tightened"
        );
        assert_eq!(
            PasswordResetReason::RotationExpired.as_str(),
            "rotation_expired"
        );
    }

    #[test]
    fn test_default_enforces_nothing() {
        let p = base();
        assert_eq!(p.min_length, 8);
        assert_eq!(p.max_length, 0);
        assert_eq!(p.rotation_days, 0);
        assert_eq!(p.history_count, 0);
        assert_eq!(p.history_max_retained, 30);
        assert_eq!(p.lockout.threshold, 0);
        assert_eq!(p.enforcement_mode, EnforcementMode::HardBlock);
        // Non-zero, but inert while rotation_days is 0.
        assert_eq!(p.rotation_warning_days, 7);
    }

    #[test]
    fn test_no_op_is_not_stricter() {
        assert!(!base().is_stricter_than(&base()));
    }

    #[test]
    fn test_min_length_increase_is_stricter() {
        let mut next = base();
        next.min_length += 1;
        assert!(next.is_stricter_than(&base()));
        assert!(!base().is_stricter_than(&next));
    }

    #[test]
    fn test_max_length_newly_bounded_is_stricter() {
        let mut next = base();
        next.max_length = 64;
        assert!(next.is_stricter_than(&base()));

        let mut tighter = next.clone();
        tighter.max_length = 32;
        assert!(tighter.is_stricter_than(&next));

        let mut looser = next.clone();
        looser.max_length = 128;
        assert!(!looser.is_stricter_than(&next));

        // back to unbounded
        assert!(!base().is_stricter_than(&next));
    }

    #[test]
    fn test_each_require_flag_flip_is_stricter() {
        let flags: [fn(&mut PasswordPolicy); 4] = [
            |p| p.require_uppercase = true,
            |p| p.require_lowercase = true,
            |p| p.require_digit = true,
            |p| p.require_special = true,
        ];
        for set in flags {
            let mut next = base();
            set(&mut next);
            assert!(next.is_stricter_than(&base()));
            assert!(!base().is_stricter_than(&next));
        }
    }

    #[test]
    fn test_non_complexity_changes_are_not_stricter() {
        let mut next = base();
        next.rotation_days = 30;
        next.history_count = 5;
        next.lockout.threshold = 3;
        next.enforcement_mode = EnforcementMode::RestrictWrites;
        next.special_char_set = "!@#".to_string();
        assert!(!next.is_stricter_than(&base()));
    }

    #[test]
    fn test_lockout_bucket() {
        let mut p = base();
        p.lockout.threshold = 5;
        p.lockout.bucket_size = 0;
        assert_eq!(p.lockout_bucket(0), 5);
        assert_eq!(p.lockout_bucket(3), 5);

        p.lockout.bucket_size = 2;
        assert_eq!(p.lockout_bucket(0), 5);
        assert_eq!(p.lockout_bucket(1), 2);
    }

    #[test]
    fn test_lockout_duration_backoff() {
        let mut lockout = LockoutPolicy {
            threshold: 3,
            bucket_size: 0,
            start_secs: 60,
            max_secs: 3600,
            backoff: LockoutBackoff::Linear,
        };
        assert_eq!(lockout.duration_secs(0), 0);
        assert_eq!(lockout.duration_secs(1), 60);
        assert_eq!(lockout.duration_secs(3), 180);
        assert_eq!(lockout.duration_secs(100), 3600, "clamped to max_secs");

        lockout.backoff = LockoutBackoff::Exponential;
        assert_eq!(lockout.duration_secs(1), 60, "first lockout matches linear");
        assert_eq!(lockout.duration_secs(2), 120);
        assert_eq!(lockout.duration_secs(3), 240);
        assert_eq!(lockout.duration_secs(7), 3600, "clamped to max_secs");
    }

    #[test]
    fn test_lockout_duration_never_wraps() {
        let lockout = LockoutPolicy {
            threshold: 3,
            bucket_size: 0,
            start_secs: u32::MAX,
            max_secs: u32::MAX,
            backoff: LockoutBackoff::Exponential,
        };
        // A level deep enough to overflow must stay clamped at the maximum, never wrap to a
        // shorter lockout than the level before it.
        assert_eq!(lockout.duration_secs(64), i64::from(u32::MAX));
        assert_eq!(lockout.duration_secs(u32::MAX), i64::from(u32::MAX));
    }

    #[test]
    fn test_lockout_is_enabled() {
        let mut lockout = LockoutPolicy::default();
        assert!(!lockout.is_enabled(), "off by default");
        lockout.threshold = 1;
        assert!(lockout.is_enabled());
    }

    fn rotating(days: u32, warning_days: u32) -> PasswordPolicy {
        let mut p = base();
        p.rotation_days = days;
        p.rotation_warning_days = warning_days;
        p
    }

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_700_000_000, 0).unwrap()
    }

    fn days_ago(n: i64) -> Option<DateTime<Utc>> {
        Some(now() - TimeDelta::days(n))
    }

    #[test]
    fn test_rotation_off_never_expires() {
        let p = base();
        assert_eq!(p.rotation_days, 0);
        assert_eq!(
            p.rotation_status(days_ago(10_000), now()),
            RotationStatus::Current
        );
    }

    #[test]
    fn test_rotation_expires_at_the_threshold_not_after() {
        let p = rotating(90, 7);
        // Exactly at the deadline counts as expired: the password has had its full 90 days.
        assert_eq!(
            p.rotation_status(days_ago(90), now()),
            RotationStatus::Expired
        );
        assert_eq!(
            p.rotation_status(days_ago(90).map(|t| t + TimeDelta::microseconds(1)), now()),
            RotationStatus::Warning { days_remaining: 1 }
        );
        assert_eq!(
            p.rotation_status(days_ago(91), now()),
            RotationStatus::Expired
        );
    }

    #[test]
    fn test_rotation_warning_window_edges() {
        let p = rotating(90, 7);
        assert_eq!(
            p.rotation_status(days_ago(83), now()),
            RotationStatus::Warning { days_remaining: 7 }
        );
        // One day earlier is outside the window and must stay silent.
        assert_eq!(
            p.rotation_status(days_ago(82), now()),
            RotationStatus::Current
        );
    }

    #[test]
    fn test_rotation_days_remaining_rounds_up() {
        let p = rotating(90, 7);
        // 6.5 days left reads as 7, never as 6.
        assert_eq!(
            p.rotation_status(days_ago(83).map(|t| t - TimeDelta::hours(12)), now()),
            RotationStatus::Warning { days_remaining: 7 }
        );
    }

    #[test]
    fn test_rotation_warning_disabled_still_expires() {
        let p = rotating(90, 0);
        assert_eq!(
            p.rotation_status(days_ago(89), now()),
            RotationStatus::Current
        );
        assert_eq!(
            p.rotation_status(days_ago(90), now()),
            RotationStatus::Expired
        );
    }

    #[test]
    fn test_warning_window_equal_to_the_period_warns_from_the_first_day() {
        let p = rotating(90, 90);
        assert!(p.validate().is_ok());
        assert_eq!(
            p.rotation_status(days_ago(0), now()),
            RotationStatus::Warning { days_remaining: 90 }
        );
        assert_eq!(
            p.rotation_status(days_ago(45), now()),
            RotationStatus::Warning { days_remaining: 45 }
        );
    }

    #[test]
    fn test_rotation_treats_missing_timestamp_as_current() {
        // The alternative reading — None as the epoch — expires every user at once.
        assert_eq!(
            rotating(1, 0).rotation_status(None, now()),
            RotationStatus::Current
        );
    }

    #[test]
    fn test_rotation_deadline_beyond_the_calendar_never_arrives() {
        assert_eq!(
            rotating(u32::MAX, 7).rotation_status(Some(now()), now()),
            RotationStatus::Current
        );
    }

    #[test]
    fn test_complexity_projection_exposes_only_complexity() {
        let mut p = base();
        p.rotation_days = 90;
        p.history_count = 5;
        p.lockout.threshold = 3;
        p.lockout.start_secs = 300;
        p.min_length = 12;
        p.require_digit = true;
        p.special_char_set = "!@#".to_string();

        let json = serde_json::to_value(PasswordComplexity::from(&p)).unwrap();
        // Sorted explicitly rather than relying on serde_json's map ordering, which changes if the
        // preserve_order feature is ever enabled.
        let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        keys.sort();

        // Pinned exactly: a new PasswordPolicy field must not reach non-admins by default.
        assert_eq!(
            keys,
            vec![
                "max_length",
                "min_length",
                "require_digit",
                "require_lowercase",
                "require_special",
                "require_uppercase",
                "special_char_set",
            ]
        );
        assert_eq!(json["min_length"], 12);
        assert_eq!(json["special_char_set"], "!@#");
    }

    #[test]
    fn test_default_passes_validation() {
        assert!(base().validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_max_length_below_min() {
        let mut p = base();
        p.max_length = p.min_length - 1;
        assert!(p.validate().unwrap_err().contains("max_length"));

        // 0 is unbounded, not a violation
        p.max_length = 0;
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_warning_window_longer_than_the_rotation_period() {
        let mut p = base();
        p.rotation_days = 5;
        p.rotation_warning_days = 6;
        // The extra day describes a deadline that never exists.
        assert!(p.validate().unwrap_err().contains("rotation_warning_days"));

        p.rotation_warning_days = 5;
        assert!(
            p.validate().is_ok(),
            "warning for the whole period is valid"
        );

        p.rotation_warning_days = 4;
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_ignores_warning_window_when_rotation_is_off() {
        let mut p = base();
        p.rotation_days = 0;
        p.rotation_warning_days = 90;
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_retained_below_history_count() {
        let mut p = base();
        p.history_count = 31;
        assert!(p.validate().unwrap_err().contains("history_max_retained"));

        p.history_max_retained = 31;
        assert!(p.validate().is_ok());
    }

    #[test]
    fn test_validate_rejects_lockout_start_above_max() {
        let mut p = base();
        p.lockout.start_secs = p.lockout.max_secs + 1;
        assert!(p.validate().unwrap_err().contains("lockout.start_secs"));
    }

    #[test]
    fn test_serde_round_trip_and_partial_row() {
        let policy = base();
        let json = serde_json::to_value(&policy).unwrap();
        assert_eq!(
            serde_json::from_value::<PasswordPolicy>(json).unwrap(),
            policy
        );

        // A row written by an older build must still deserialize.
        let partial: PasswordPolicy = serde_json::from_value(serde_json::json!({
            "min_length": 10,
        }))
        .unwrap();
        assert_eq!(partial.min_length, 10);
        assert_eq!(partial.enforcement_mode, EnforcementMode::HardBlock);
    }
}
