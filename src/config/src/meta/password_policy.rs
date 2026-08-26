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

/// Why a user was flagged for a forced password reset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PasswordResetReason {
    /// The complexity policy was tightened under the user's existing password.
    PolicyTightened,
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
    /// Days before expiry to start warning. `0` = never warn.
    pub rotation_warning_days: u32,
    /// `0` disables reuse prevention.
    pub history_count: u32,
    /// Hashes retained per user; kept at or above `history_count` so a later increase to
    /// `history_count` has history to check against.
    pub history_max_retained: u32,
    pub lockout: LockoutPolicy,
    pub enforcement_mode: EnforcementMode,
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
            _ => Err(format!("Invalid password reset reason: {s}")),
        }
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

    /// Failed attempts tolerated before the lockout at `level` (0 = no lockout yet) triggers.
    pub fn lockout_bucket(&self, level: u32) -> u32 {
        if level == 0 || self.lockout.bucket_size == 0 {
            self.lockout.threshold
        } else {
            self.lockout.bucket_size
        }
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
        // Otherwise every password sits inside the warning window from the moment it is set, so the
        // warning is permanent and stops carrying information.
        if self.rotation_days != 0 && self.rotation_warning_days >= self.rotation_days {
            return Err(format!(
                "rotation_warning_days ({}) must be less than rotation_days ({})",
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
        assert!("other".parse::<PasswordResetReason>().is_err());
        assert_eq!(
            PasswordResetReason::PolicyTightened.as_str(),
            "policy_tightened"
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
    fn test_validate_rejects_warning_window_covering_whole_rotation() {
        let mut p = base();
        p.rotation_days = 5;
        // default warning is 7, so enabling a shorter rotation is a self-contradiction
        assert!(p.validate().unwrap_err().contains("rotation_warning_days"));

        p.rotation_warning_days = 5;
        assert!(p.validate().is_err(), "equal is still a permanent warning");

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
