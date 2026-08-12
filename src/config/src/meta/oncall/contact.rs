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

//! How to reach one person — `architecture/03` §5.
//!
//! The rule the whole design rests on: **send over whatever the person has,
//! and email always exists, because it is their login.** Everything here is
//! therefore optional. A missing phone narrows the chain for one person; it is
//! never an error, never an onboarding blocker, and never a reason a page
//! fails to go out.
//!
//! Verification is the one piece of rigour. SMS and voice transports are out
//! of scope for this release, so nothing can complete a verification yet — and
//! that is exactly why `phone_verified_at` has to exist NOW. A number typed
//! into a form is an unproven claim about which handset rings; a transport
//! added later must be able to tell the difference, and a `None` here is what
//! stops it paging a stranger who used to own that number.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The contact methods a person has volunteered, and whether each is proven.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Contact {
    pub org_id: String,
    pub user_email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    /// When somebody proved this number reaches this person, in micros.
    /// `None` means nobody has.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone_verified_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub push_verified_at: Option<i64>,
    /// Free text for now — §5 lists quiet hours as "later", and inventing a
    /// schema before a transport reads it would mean inventing it twice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quiet_hours: Option<String>,
    pub updated_at: i64,
}

impl Contact {
    /// An empty profile for somebody who has never saved one.
    ///
    /// Returned rather than a 404: "this person has no phone" is a complete,
    /// true answer, and making every caller branch on a missing row is how a
    /// screen ends up rendering nothing at all.
    pub fn empty(org_id: &str, user_email: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            user_email: user_email.to_string(),
            phone: None,
            phone_verified_at: None,
            push_token: None,
            push_verified_at: None,
            quiet_hours: None,
            updated_at: 0,
        }
    }

    /// Whether an SMS or voice transport may ring this number.
    ///
    /// Both halves are required. A number nobody has verified is a claim, not
    /// an address — the previous owner of a recycled mobile has not consented
    /// to being woken at 3am by somebody else's outage.
    pub fn phone_is_pageable(&self) -> bool {
        self.phone.as_ref().is_some_and(|p| !p.trim().is_empty()) && self.phone_verified_at.is_some()
    }

    /// The same test for push.
    pub fn push_is_pageable(&self) -> bool {
        self.push_token
            .as_ref()
            .is_some_and(|t| !t.trim().is_empty())
            && self.push_verified_at.is_some()
    }

    /// The methods on file that no transport may use yet, named so a profile
    /// screen can say so out loud.
    ///
    /// Silence is the failure this prevents: a person who typed their number
    /// in and saw it saved reasonably believes they will be phoned.
    pub fn unverified_methods(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.phone.as_ref().is_some_and(|p| !p.trim().is_empty()) && self.phone_verified_at.is_none()
        {
            out.push("phone");
        }
        if self
            .push_token
            .as_ref()
            .is_some_and(|t| !t.trim().is_empty())
            && self.push_verified_at.is_none()
        {
            out.push("push");
        }
        out
    }
}

/// A phone number as it may be stored.
///
/// Deliberately permissive — E.164-ish, not E.164. The strict thing to do is
/// refuse anything a carrier would, but this codebase cannot dial, so a
/// refusal here would only ever be this validator's opinion against a person
/// who knows their own number. What it does refuse is input that is not a
/// phone number at all: empty, absurdly long, or carrying characters no dial
/// string contains.
pub fn normalize_phone(raw: &str) -> Result<String, ContactError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ContactError::Invalid("phone is empty".to_string()));
    }
    // Longest real E.164 is 15 digits; the slack is for spaces, brackets and
    // an extension. Anything past it is a paste accident.
    if trimmed.chars().count() > 32 {
        return Err(ContactError::Invalid(
            "phone is longer than 32 characters".to_string(),
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || " +-().x".contains(c))
    {
        return Err(ContactError::Invalid(
            "phone may contain only digits, spaces and `+-().x`".to_string(),
        ));
    }
    if trimmed.chars().filter(char::is_ascii_digit).count() < 5 {
        return Err(ContactError::Invalid(
            "phone has too few digits to dial".to_string(),
        ));
    }
    Ok(trimmed.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContactError {
    Invalid(String),
}

impl std::fmt::Display for ContactError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for ContactError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_an_empty_profile_is_a_real_answer() {
        let c = Contact::empty("default", "ana@o2.ai");
        assert_eq!(c.user_email, "ana@o2.ai");
        assert_eq!(c.phone, None);
        assert!(!c.phone_is_pageable());
        assert!(c.unverified_methods().is_empty());
    }

    /// The interlock this release exists to install: a number on file is not
    /// permission to ring it. Until a transport can prove the handset, the
    /// only honest answer is "not pageable".
    #[test]
    fn test_an_unverified_phone_is_never_pageable() {
        let mut c = Contact::empty("default", "ana@o2.ai");
        c.phone = Some("+1 555 0100".to_string());
        assert!(!c.phone_is_pageable());
        assert_eq!(c.unverified_methods(), vec!["phone"]);

        c.phone_verified_at = Some(1_000);
        assert!(c.phone_is_pageable());
        assert!(c.unverified_methods().is_empty());
    }

    /// A verified-at left over from a previous number must not vouch for the
    /// new one. The write path clears it; this pins the property the write
    /// path is protecting.
    #[test]
    fn test_a_blank_phone_is_not_pageable_even_when_verified() {
        let mut c = Contact::empty("default", "ana@o2.ai");
        c.phone = Some("   ".to_string());
        c.phone_verified_at = Some(1_000);
        assert!(!c.phone_is_pageable());
        assert!(c.unverified_methods().is_empty(), "there is no method here");
    }

    #[test]
    fn test_push_follows_the_same_rule() {
        let mut c = Contact::empty("default", "ana@o2.ai");
        c.push_token = Some("tok".to_string());
        assert!(!c.push_is_pageable());
        assert_eq!(c.unverified_methods(), vec!["push"]);
        c.push_verified_at = Some(2);
        assert!(c.push_is_pageable());
    }

    #[test]
    fn test_a_phone_number_keeps_the_shape_a_person_typed() {
        for good in [
            "+15550100",
            "+1 (555) 010-0199",
            "555-0100 x22",
            "  +44 20 7946 0958  ",
        ] {
            assert_eq!(normalize_phone(good).unwrap(), good.trim(), "input={good}");
        }
    }

    /// What is refused is input that is not a dial string at all — not input a
    /// carrier might dislike.
    #[test]
    fn test_input_that_is_not_a_phone_number_is_refused() {
        for bad in [
            "",
            "   ",
            "not a phone",
            "1234",
            "+1 555 0100; DROP TABLE users",
            "<script>alert(1)</script>",
        ] {
            assert!(normalize_phone(bad).is_err(), "input={bad:?}");
        }
        assert!(normalize_phone(&"1".repeat(40)).is_err(), "absurdly long");
    }
}
