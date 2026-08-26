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

// =============================================================================
//  password policy
//  Single source of truth for human-set password strength rules.
//  Auto-generated tokens (service accounts, reports) bypass this and rely
//  on entropy from generate_random_string().
// =============================================================================

use crate::meta::password_policy::PasswordPolicy;

/// Minimum length for a user-set password.
pub const MIN_PASSWORD_LEN: usize = 8;

/// Upper bound to avoid pathological inputs hitting the KDF.
pub const MAX_PASSWORD_LEN: usize = 128;

/// Human-readable description of the policy, used in error messages and UI.
pub const PASSWORD_POLICY_HINT: &str = "Password must be 8-128 characters and contain at least one lowercase letter, \
     one uppercase letter, one digit, and one special character.";

/// Validate that a password meets the strength policy.
/// Returns the policy hint on failure so callers can surface a uniform message.
pub fn validate_password_strength(password: &str) -> Result<(), &'static str> {
    let len = password.chars().count();
    if !(MIN_PASSWORD_LEN..=MAX_PASSWORD_LEN).contains(&len) {
        return Err(PASSWORD_POLICY_HINT);
    }

    let mut has_lower = false;
    let mut has_upper = false;
    let mut has_digit = false;
    let mut has_special = false;

    for c in password.chars() {
        if c.is_ascii_lowercase() {
            has_lower = true;
        } else if c.is_ascii_uppercase() {
            has_upper = true;
        } else if c.is_ascii_digit() {
            has_digit = true;
        } else {
            // Anything that is not an ASCII letter/digit counts as special.
            // This covers symbols (!@#$...) and any non-ASCII character.
            has_special = true;
        }
    }

    if has_lower && has_upper && has_digit && has_special {
        Ok(())
    } else {
        Err(PASSWORD_POLICY_HINT)
    }
}

/// Validate a password against a configured policy, naming every requirement it fails.
///
/// The static [`validate_password_strength`] above stays for bootstrap paths that run before the
/// settings cache exists; everything with a live policy in hand should call this instead.
pub fn validate_password_strength_with_policy(
    password: &str,
    policy: &PasswordPolicy,
) -> Result<(), String> {
    let len = password.chars().count() as u32;
    let mut failures: Vec<String> = Vec::new();

    if len < policy.min_length {
        failures.push(format!("be at least {} characters", policy.min_length));
    }
    // 0 means unbounded, so the upper bound is only checked when one is configured.
    if policy.max_length != 0 && len > policy.max_length {
        failures.push(format!("be at most {} characters", policy.max_length));
    }

    let mut has_lower = false;
    let mut has_upper = false;
    let mut has_digit = false;
    let mut has_special = false;

    for c in password.chars() {
        if c.is_ascii_lowercase() {
            has_lower = true;
        } else if c.is_ascii_uppercase() {
            has_upper = true;
        } else if c.is_ascii_digit() {
            has_digit = true;
        } else if policy.special_char_set.is_empty() {
            // Empty set keeps the historical rule: anything that is not an ASCII letter or digit
            // counts, including non-ASCII characters.
            has_special = true;
        }

        if !policy.special_char_set.is_empty() && policy.special_char_set.contains(c) {
            has_special = true;
        }
    }

    if policy.require_lowercase && !has_lower {
        failures.push("contain a lowercase letter".to_string());
    }
    if policy.require_uppercase && !has_upper {
        failures.push("contain an uppercase letter".to_string());
    }
    if policy.require_digit && !has_digit {
        failures.push("contain a digit".to_string());
    }
    if policy.require_special && !has_special {
        failures.push(if policy.special_char_set.is_empty() {
            "contain a special character".to_string()
        } else {
            format!(
                "contain one of these special characters: {}",
                policy.special_char_set
            )
        });
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("Password must {}.", failures.join(", ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_too_short() {
        assert!(validate_password_strength("Aa1!").is_err());
        assert!(validate_password_strength("Aa1!Aa").is_err());
    }

    #[test]
    fn rejects_too_long() {
        let long = "Aa1!".repeat(40); // 160 chars
        assert!(validate_password_strength(&long).is_err());
    }

    #[test]
    fn rejects_missing_uppercase() {
        assert!(validate_password_strength("abcdef1!").is_err());
    }

    #[test]
    fn rejects_missing_lowercase() {
        assert!(validate_password_strength("ABCDEF1!").is_err());
    }

    #[test]
    fn rejects_missing_digit() {
        assert!(validate_password_strength("Abcdefg!").is_err());
    }

    #[test]
    fn rejects_missing_special() {
        assert!(validate_password_strength("Abcdef12").is_err());
    }

    #[test]
    fn rejects_legacy_simple_password() {
        // The pre-policy minimum "any 8 chars" no longer passes.
        assert!(validate_password_strength("password").is_err());
        assert!(validate_password_strength("12345678").is_err());
        assert!(validate_password_strength("validpassword123").is_err());
    }

    #[test]
    fn accepts_minimum_valid() {
        assert!(validate_password_strength("Abcdef1!").is_ok());
    }

    #[test]
    fn accepts_unicode_as_special() {
        // Non-ASCII characters satisfy the special-character requirement.
        assert!(validate_password_strength("Abcdef1π").is_ok());
    }

    fn policy() -> PasswordPolicy {
        PasswordPolicy::default()
    }

    #[test]
    fn policy_default_accepts_any_eight_chars() {
        // The default policy is the pre-feature rule: length only, no character classes. A
        // password the static validator rejects must still pass here, or upgrading would lock
        // existing users out of changing their own password.
        assert!(validate_password_strength("password").is_err());
        assert!(validate_password_strength_with_policy("password", &policy()).is_ok());
    }

    #[test]
    fn policy_reports_every_failed_requirement_at_once() {
        let mut p = policy();
        p.min_length = 12;
        p.require_uppercase = true;
        p.require_digit = true;

        let err = validate_password_strength_with_policy("short", &p).unwrap_err();
        assert!(err.contains("at least 12"));
        assert!(err.contains("uppercase"));
        assert!(err.contains("digit"));
        // Not required, so never mentioned.
        assert!(!err.contains("special"));
    }

    #[test]
    fn policy_max_length_zero_is_unbounded() {
        let mut p = policy();
        p.max_length = 0;
        let long = "a".repeat(5_000);
        assert!(validate_password_strength_with_policy(&long, &p).is_ok());

        p.max_length = 16;
        assert!(validate_password_strength_with_policy(&long, &p).is_err());
    }

    #[test]
    fn policy_special_char_set_restricts_what_counts() {
        let mut p = policy();
        p.require_special = true;
        p.special_char_set = "!@#".to_string();

        assert!(validate_password_strength_with_policy("passwor$", &p).is_err());
        assert!(validate_password_strength_with_policy("passwor!", &p).is_ok());
        // The error names the acceptable set rather than leaving the user guessing.
        let err = validate_password_strength_with_policy("passwor$", &p).unwrap_err();
        assert!(err.contains("!@#"));
    }

    #[test]
    fn policy_empty_special_char_set_accepts_any_non_alnum() {
        let mut p = policy();
        p.require_special = true;
        assert!(p.special_char_set.is_empty());

        assert!(validate_password_strength_with_policy("passwor$", &p).is_ok());
        assert!(validate_password_strength_with_policy("passwordπ", &p).is_ok());
        assert!(validate_password_strength_with_policy("password", &p).is_err());
    }

    #[test]
    fn accepts_at_max_length() {
        let mut pw = String::from("Aa1!");
        pw.push_str(&"x".repeat(MAX_PASSWORD_LEN - 4));
        assert_eq!(pw.len(), MAX_PASSWORD_LEN);
        assert!(validate_password_strength(&pw).is_ok());
    }
}
