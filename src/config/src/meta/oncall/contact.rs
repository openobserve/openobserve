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

//! How to reach one person, all optional; `phone_verified_at` guards an unproven number.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How long a texted code stays valid.
pub const CODE_TTL_MICROS: i64 = 10 * 60 * 1_000_000;
/// Wrong entries allowed per code, so six digits cannot be guessed.
pub const CODE_MAX_ATTEMPTS: u32 = 5;
/// Minimum wait between two codes from one user to one number.
pub const SEND_GAP_MICROS: i64 = 60 * 1_000_000;
/// Codes one user may send per window across all numbers; caps the org's SMS bill.
pub const SENDS_PER_USER_PER_WINDOW: u32 = 5;
/// Codes one number may receive per window from all users; protects the phone's owner.
pub const SENDS_PER_NUMBER_PER_WINDOW: u32 = 10;
/// The rolling hour the send caps count over; short so a locked-out user is not stuck for a day.
pub const SEND_WINDOW_MICROS: i64 = 60 * 60 * 1_000_000;

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
    /// An empty profile for somebody who never saved one; "no phone" is a true answer, not a 404.
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

    /// Whether SMS or voice may ring this number; unverified, it may belong to a stranger.
    pub fn phone_is_pageable(&self) -> bool {
        self.phone.as_ref().is_some_and(|p| !p.trim().is_empty())
            && self.phone_verified_at.is_some()
    }

    /// The same test for push.
    pub fn push_is_pageable(&self) -> bool {
        self.push_token
            .as_ref()
            .is_some_and(|t| !t.trim().is_empty())
            && self.push_verified_at.is_some()
    }

    /// The methods on file that no transport may use yet, named so a profile
    /// screen can say so out loud. Silence is the failure this prevents: a
    /// person who typed their number in and saw it saved reasonably believes
    /// they will be phoned.
    pub fn unverified_methods(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.phone.as_ref().is_some_and(|p| !p.trim().is_empty())
            && self.phone_verified_at.is_none()
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

/// The fields of one (user, number) verification row that the code decisions read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeRow {
    pub user_email: String,
    pub target: String,
    pub has_code: bool,
    pub attempts: u32,
    pub sent_at: i64,
    /// Codes sent in the rolling 24 h window that began at `day_started_at`.
    pub sends_today: u32,
    /// When the current rolling 24 h window began, in micros.
    pub day_started_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendDecision {
    Send,
    Wait { micros: i64, limit: WaitLimit },
}

/// The V7 limit that produced a send's wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaitLimit {
    Gap,
    User,
    Number,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeCheck {
    Verified,
    Wrong { attempts_left: u32 },
    Expired,
    TooManyAttempts,
    NoPendingCode,
}

/// The number as E.164 (`+`, 7 to 15 digits, no leading 0), minus spaces and `-().`. [pure]
pub fn to_e164(raw: &str) -> Result<String, ContactError> {
    let compact: String = raw
        .trim()
        .chars()
        .filter(|c| !" -().".contains(*c))
        .collect();
    let digits = compact.strip_prefix('+').unwrap_or_default();
    let valid = (7..=15).contains(&digits.len())
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !digits.starts_with('0');
    if !valid {
        return Err(ContactError::Invalid(
            "phone must be in international format: + then country code and number, e.g. +14155550100"
                .to_string(),
        ));
    }
    Ok(compact)
}

/// Whether a code may be texted now, else the longest wait and which limit caused it. [pure]
pub fn code_send_decision(
    user_email: &str,
    target: &str,
    user_rows: &[CodeRow],
    number_rows: &[CodeRow],
    now: i64,
) -> SendDecision {
    let email = user_email.to_lowercase();
    let mine = || {
        user_rows
            .iter()
            .filter(|r| r.user_email.to_lowercase() == email)
    };
    let gap = mine()
        .filter(|r| r.target == target)
        .map(|r| SEND_GAP_MICROS - (now - r.sent_at))
        .max();
    let waits = [
        (gap, WaitLimit::Gap),
        (
            window_wait(mine(), SENDS_PER_USER_PER_WINDOW, now),
            WaitLimit::User,
        ),
        (
            window_wait(
                number_rows.iter().filter(|r| r.target == target),
                SENDS_PER_NUMBER_PER_WINDOW,
                now,
            ),
            WaitLimit::Number,
        ),
    ];
    let longest = waits
        .into_iter()
        .filter_map(|(w, limit)| w.filter(|w| *w > 0).map(|micros| (micros, limit)))
        .max_by_key(|(micros, _)| *micros);
    match longest {
        Some((micros, limit)) => SendDecision::Wait { micros, limit },
        None => SendDecision::Send,
    }
}

/// The rolling-window counts to store after a send, so the send caps see it. [pure]
pub fn next_counts(row: Option<&CodeRow>, now: i64) -> (u32, i64) {
    match row {
        Some(r) if now - r.day_started_at < SEND_WINDOW_MICROS => {
            (r.sends_today + 1, r.day_started_at)
        }
        _ => (1, now),
    }
}

/// Whether an entered code verifies the user's current number, or why it does not. [pure]
pub fn code_check(
    row: Option<&CodeRow>,
    current_phone: Option<&str>,
    code_matches: bool,
    now: i64,
) -> CodeCheck {
    let Some(r) = row.filter(|r| r.has_code && Some(r.target.as_str()) == current_phone) else {
        return CodeCheck::NoPendingCode;
    };
    if now - r.sent_at >= CODE_TTL_MICROS {
        return CodeCheck::Expired;
    }
    if r.attempts >= CODE_MAX_ATTEMPTS {
        return CodeCheck::TooManyAttempts;
    }
    if code_matches {
        return CodeCheck::Verified;
    }
    CodeCheck::Wrong {
        attempts_left: CODE_MAX_ATTEMPTS - r.attempts - 1,
    }
}

/// The refusal text and the `retry_after_secs` body field telling a user when to ask again. [pure]
pub fn wait_message(micros: i64) -> (String, i64) {
    let secs = ((micros + 999_999) / 1_000_000).max(1);
    let minutes = (secs + 59) / 60;
    let unit = if minutes == 1 { "minute" } else { "minutes" };
    (
        format!("Too many codes. Try again in {minutes} {unit}."),
        secs,
    )
}

/// How long until a send cap frees a send, or `None` while `rows` are under `cap`.
fn window_wait<'a>(rows: impl Iterator<Item = &'a CodeRow>, cap: u32, now: i64) -> Option<i64> {
    let live: Vec<&CodeRow> = rows
        .filter(|r| now - r.day_started_at < SEND_WINDOW_MICROS)
        .collect();
    let sent: u32 = live.iter().map(|r| r.sends_today).sum();
    if sent < cap {
        return None;
    }
    live.iter()
        .map(|r| r.day_started_at + SEND_WINDOW_MICROS - now)
        .min()
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

    const NOW: i64 = 100 * SEND_WINDOW_MICROS;
    const SEC: i64 = 1_000_000;

    fn row(email: &str, target: &str, sent_ago: i64, sends: u32, day_ago: i64) -> CodeRow {
        CodeRow {
            user_email: email.to_string(),
            target: target.to_string(),
            has_code: true,
            attempts: 0,
            sent_at: NOW - sent_ago,
            sends_today: sends,
            day_started_at: NOW - day_ago,
        }
    }

    #[test]
    fn test_an_empty_profile_is_a_real_answer() {
        let c = Contact::empty("default", "ana@o2.ai");
        assert_eq!(c.user_email, "ana@o2.ai");
        assert_eq!(c.phone, None);
        assert!(!c.phone_is_pageable());
        assert!(c.unverified_methods().is_empty());
    }

    /// The interlock this release installs: a number on file is not permission
    /// to ring it. Until a transport can prove the handset, the only honest
    /// answer is "not pageable".
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

    /// A verified-at left over from a previous number must not vouch for the new
    /// one. The write path clears it; this pins the property it is protecting.
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

    /// V1: only a dialable E.164 number is stored, whatever separators were typed around it.
    #[test]
    fn test_a_phone_is_stored_as_e164() {
        let ok = |s: &str| Ok(s.to_string());
        let cases: [(&str, Result<String, ()>); 13] = [
            ("+1 (555) 010-0199", ok("+15550100199")),
            ("  +44 20 7946 0958  ", ok("+442079460958")),
            ("+1.555.010.0199", ok("+15550100199")),
            ("15550100199", Err(())),
            ("+05550100199", Err(())),
            ("+123456", Err(())),
            ("+1234567", ok("+1234567")),
            ("+123456789012345", ok("+123456789012345")),
            ("+1234567890123456", Err(())),
            ("+1 555 CALL NOW", Err(())),
            ("+1 555 010 0199 x22", Err(())),
            ("", Err(())),
            ("   ", Err(())),
        ];
        for (input, want) in cases {
            assert_eq!(to_e164(input).map_err(|_| ()), want, "input={input:?}");
        }
    }

    /// V7: each limit at and one below its boundary, expired windows, the longest wait, email case.
    #[test]
    fn test_code_send_decision() {
        let a = "ana@o2.ai";
        let n = "+15550100199";
        let wait = |micros, limit| SendDecision::Wait { micros, limit };
        let tick = SEND_WINDOW_MICROS / 24;
        let shared = row(a, n, tick, 3, tick);
        let cases: Vec<(&str, Vec<CodeRow>, Vec<CodeRow>, SendDecision)> = vec![
            ("no rows", vec![], vec![], SendDecision::Send),
            (
                "pair 59s ago",
                vec![row(a, n, 59 * SEC, 1, tick)],
                vec![],
                wait(SEC, WaitLimit::Gap),
            ),
            (
                "pair 60s ago",
                vec![row(a, n, 60 * SEC, 1, tick)],
                vec![],
                SendDecision::Send,
            ),
            (
                "user 4 of 5",
                vec![
                    row(a, "+1111111", tick, 2, tick),
                    row(a, "+2222222", tick, 2, 2 * tick),
                ],
                vec![],
                SendDecision::Send,
            ),
            (
                "user 5 of 5 waits for earliest live window",
                vec![
                    row(a, "+1111111", tick, 2, tick),
                    row(a, "+2222222", tick, 3, 2 * tick),
                ],
                vec![],
                wait(SEND_WINDOW_MICROS - 2 * tick, WaitLimit::User),
            ),
            (
                "a user cap reached 61 minutes ago has lapsed",
                vec![row(a, "+1111111", 61 * 60 * SEC, 5, 61 * 60 * SEC)],
                vec![],
                SendDecision::Send,
            ),
            (
                "a user cap reached 59 minutes ago still holds",
                vec![row(a, "+1111111", 59 * 60 * SEC, 5, 59 * 60 * SEC)],
                vec![],
                wait(60 * SEC, WaitLimit::User),
            ),
            (
                "a user window that has ended is not counted",
                vec![
                    row(a, "+1111111", tick, 2, tick),
                    row(a, "+2222222", tick, 3, SEND_WINDOW_MICROS),
                ],
                vec![],
                SendDecision::Send,
            ),
            (
                "user emails differing in case are one user",
                vec![
                    row(a, "+1111111", tick, 2, tick),
                    row("ANA@O2.ai", "+2222222", tick, 3, tick),
                ],
                vec![],
                wait(SEND_WINDOW_MICROS - tick, WaitLimit::User),
            ),
            (
                "number 9 of 10",
                vec![],
                vec![
                    row("b@o2.ai", n, tick, 4, tick),
                    row("c@o2.ai", n, tick, 5, tick),
                ],
                SendDecision::Send,
            ),
            (
                "number 10 of 10",
                vec![],
                vec![
                    row("b@o2.ai", n, tick, 4, 3 * tick),
                    row("c@o2.ai", n, tick, 6, tick),
                ],
                wait(SEND_WINDOW_MICROS - 3 * tick, WaitLimit::Number),
            ),
            (
                "pair gap and number limit: longest wait wins",
                vec![row(a, n, 10 * SEC, 1, tick)],
                vec![
                    row(a, n, 10 * SEC, 1, tick),
                    row("c@o2.ai", n, tick, 9, tick),
                ],
                wait(SEND_WINDOW_MICROS - tick, WaitLimit::Number),
            ),
            (
                "user and number limits: longest wait wins",
                vec![row(a, "+1111111", tick, 5, 20 * tick)],
                vec![row("c@o2.ai", n, tick, 10, tick)],
                wait(SEND_WINDOW_MICROS - tick, WaitLimit::Number),
            ),
            (
                "user limit outlasts number limit: user wins",
                vec![row(a, "+1111111", tick, 5, tick)],
                vec![row("c@o2.ai", n, tick, 10, 20 * tick)],
                wait(SEND_WINDOW_MICROS - tick, WaitLimit::User),
            ),
            (
                "the pair row in both lists counts once per limit",
                vec![shared.clone(), row(a, "+1111111", tick, 1, tick)],
                vec![shared, row("c@o2.ai", n, tick, 6, tick)],
                SendDecision::Send,
            ),
        ];
        for (name, user_rows, number_rows, want) in cases {
            assert_eq!(
                code_send_decision(a, n, &user_rows, &number_rows, NOW),
                want,
                "{name}"
            );
        }
    }

    /// V8: a send opens a new window unless the stored one is still live.
    #[test]
    fn test_next_counts() {
        let live = row("ana@o2.ai", "+15550100199", SEC, 3, SEND_WINDOW_MICROS - 1);
        let ended = row("ana@o2.ai", "+15550100199", SEC, 3, SEND_WINDOW_MICROS);
        let cases = [
            ("no row", None, (1, NOW)),
            (
                "live window",
                Some(&live),
                (4, NOW - SEND_WINDOW_MICROS + 1),
            ),
            ("ended window", Some(&ended), (1, NOW)),
        ];
        for (name, r, want) in cases {
            assert_eq!(next_counts(r, NOW), want, "{name}");
        }
    }

    /// V2 and V6: one row per outcome, the 10 min and 5 attempt boundaries, a changed number.
    #[test]
    fn test_code_check() {
        let n = "+15550100199";
        let with = |sent_ago: i64, attempts: u32, has_code: bool| CodeRow {
            attempts,
            has_code,
            ..row("ana@o2.ai", n, sent_ago, 1, sent_ago)
        };
        let fresh = with(SEC, 0, true);
        let cases = vec![
            ("no row", None, Some(n), true, CodeCheck::NoPendingCode),
            (
                "no code",
                Some(with(SEC, 0, false)),
                Some(n),
                true,
                CodeCheck::NoPendingCode,
            ),
            (
                "no phone",
                Some(fresh.clone()),
                None,
                true,
                CodeCheck::NoPendingCode,
            ),
            (
                "number changed",
                Some(fresh.clone()),
                Some("+442079460958"),
                true,
                CodeCheck::NoPendingCode,
            ),
            (
                "verified",
                Some(fresh.clone()),
                Some(n),
                true,
                CodeCheck::Verified,
            ),
            (
                "wrong first try",
                Some(fresh),
                Some(n),
                false,
                CodeCheck::Wrong { attempts_left: 4 },
            ),
            (
                "wrong fifth try",
                Some(with(SEC, 4, true)),
                Some(n),
                false,
                CodeCheck::Wrong { attempts_left: 0 },
            ),
            (
                "right on fifth try",
                Some(with(SEC, 4, true)),
                Some(n),
                true,
                CodeCheck::Verified,
            ),
            (
                "five attempts used",
                Some(with(SEC, 5, true)),
                Some(n),
                true,
                CodeCheck::TooManyAttempts,
            ),
            (
                "one micro before 10 min",
                Some(with(CODE_TTL_MICROS - 1, 0, true)),
                Some(n),
                true,
                CodeCheck::Verified,
            ),
            (
                "at 10 min",
                Some(with(CODE_TTL_MICROS, 0, true)),
                Some(n),
                true,
                CodeCheck::Expired,
            ),
            (
                "expired beats attempts",
                Some(with(CODE_TTL_MICROS, 5, true)),
                Some(n),
                true,
                CodeCheck::Expired,
            ),
        ];
        for (name, r, phone, matches, want) in cases {
            assert_eq!(code_check(r.as_ref(), phone, matches, NOW), want, "{name}");
        }
    }

    #[test]
    fn test_wait_message() {
        let cases = [
            (30 * SEC, "Too many codes. Try again in 1 minute.", 30),
            (61 * SEC, "Too many codes. Try again in 2 minutes.", 61),
            (3600 * SEC, "Too many codes. Try again in 60 minutes.", 3600),
            (0, "Too many codes. Try again in 1 minute.", 1),
            (60 * SEC, "Too many codes. Try again in 1 minute.", 60),
            (60 * SEC + 1, "Too many codes. Try again in 2 minutes.", 61),
        ];
        for (micros, msg, secs) in cases {
            assert_eq!(
                wait_message(micros),
                (msg.to_string(), secs),
                "micros={micros}"
            );
        }
    }
}
