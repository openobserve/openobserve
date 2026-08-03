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

//! Alert priority — Feature 2 (PT-1, PT-2).
//!
//! A **third** axis, distinct from the two Feature 1 established:
//!
//! * `RunOutcome`  — did the evaluation fire?
//! * `AlertLevel`  — how bad is it *right now*? (evaluated state)
//! * `AlertPriority` — how much do humans care about this alert? (**mutable** static configuration
//!   — "static" contrasts it with *evaluated* state, it does NOT mean write-once: priority is
//!   editable on any update, like name or description. PT-1.)
//!
//! Priority is **display + propagation only**: it filters/sorts the alert
//! list and is exposed to notification templates so receivers can route on
//! it. It must never influence evaluation, silence, delivery, or incident
//! severity — that is a separate, explicitly opted-into extension.
//!
//! Deliberately NOT `IncidentSeverity` (P1–P4): different scale, different
//! concept, different lifecycle.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How much humans care about this alert. P1 is the most urgent.
///
/// Serialized as an **integer** (1–5), which is both the storage
/// representation and the API shape; `Display` renders the familiar `"P3"`
/// form for UI and template substitution.
// `Ord` is deliberately NOT derived. Declaration order would make `P1 < P5`
// true, so a bare `a.priority > b.priority` at a call site reads exactly
// backwards ("greater" = less urgent). Sorting happens in SQL (PT-3), so
// nothing here needs it; compare via `is_more_urgent_than` or `to_i32`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(try_from = "u8", into = "u8")]
// NOTE: the wire form is an integer (see the serde attribute above). utoipa
// only accepts `value_type` at the FIELD level, so the `Alert.priority` field
// carries `#[schema(value_type = u8)]` — without it the generated OpenAPI
// would advertise a string enum and lie about the payload.
pub enum AlertPriority {
    P1,
    P2,
    P3,
    P4,
    P5,
}

/// Why a priority value was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PriorityError {
    /// Not one of the five defined priorities.
    OutOfRange(String),
}

impl AlertPriority {
    /// Durable storage id for the `alerts.priority` column.
    ///
    /// These are persisted — **never reorder or reuse**. P1 = 1 so that a
    /// plain `ORDER BY priority ASC` surfaces the most urgent alerts first.
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::P1 => 1,
            Self::P2 => 2,
            Self::P3 => 3,
            Self::P4 => 4,
            Self::P5 => 5,
        }
    }

    /// Inverse of [`Self::to_i32`]; `None` for any value outside 1..=5.
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::P1),
            2 => Some(Self::P2),
            3 => Some(Self::P3),
            4 => Some(Self::P4),
            5 => Some(Self::P5),
            _ => None,
        }
    }

    /// `"P1"`..`"P5"` — the form shown in the UI and substituted into
    /// notification templates.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::P1 => "P1",
            Self::P2 => "P2",
            Self::P3 => "P3",
            Self::P4 => "P4",
            Self::P5 => "P5",
        }
    }

    /// True when `self` is more urgent than `other` (P1 is most urgent).
    ///
    /// Named rather than relying on `Ord`, because the natural integer
    /// ordering is *inverted* with respect to urgency and a bare `<` at a
    /// call site would read exactly backwards.
    pub fn is_more_urgent_than(&self, other: Self) -> bool {
        // Smaller storage id = more urgent (P1 = 1). This is the one place
        // that inversion is allowed to be written out.
        self.to_i32() < other.to_i32()
    }
}

impl std::fmt::Display for AlertPriority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for PriorityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OutOfRange(v) => {
                write!(f, "invalid alert priority `{v}`: expected P1 through P5")
            }
        }
    }
}

impl std::error::Error for PriorityError {}

impl std::str::FromStr for AlertPriority {
    type Err = PriorityError;

    /// Accepts `"P1"`/`"p1"` and the bare `"1"`, so query parameters and
    /// template inputs both parse without the caller guessing which form.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let token = s.trim();
        // Accept an optional `P`/`p` prefix, then require exactly one digit
        // in range. `strip_prefix` on a char slice keeps "PP1" and "P" from
        // sneaking through, since what remains must still match exactly.
        let digits = token.strip_prefix(['P', 'p']).unwrap_or(token);
        match digits {
            "1" => Ok(Self::P1),
            "2" => Ok(Self::P2),
            "3" => Ok(Self::P3),
            "4" => Ok(Self::P4),
            "5" => Ok(Self::P5),
            // Report the TRIMMED token: the user sees what was parsed, not
            // their incidental whitespace.
            _ => Err(PriorityError::OutOfRange(token.to_string())),
        }
    }
}

impl TryFrom<u8> for AlertPriority {
    type Error = PriorityError;

    fn try_from(v: u8) -> Result<Self, Self::Error> {
        Self::from_i32(v as i32).ok_or_else(|| PriorityError::OutOfRange(v.to_string()))
    }
}

impl From<AlertPriority> for u8 {
    fn from(p: AlertPriority) -> u8 {
        p.to_i32() as u8
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    const ALL: [AlertPriority; 5] = [
        AlertPriority::P1,
        AlertPriority::P2,
        AlertPriority::P3,
        AlertPriority::P4,
        AlertPriority::P5,
    ];

    /// PT-2: storage ids are durable. This test exists to FAIL loudly if
    /// anyone renumbers the enum — every persisted row would silently change
    /// meaning.
    #[test]
    fn test_storage_ids_are_pinned_and_never_reordered() {
        assert_eq!(AlertPriority::P1.to_i32(), 1);
        assert_eq!(AlertPriority::P2.to_i32(), 2);
        assert_eq!(AlertPriority::P3.to_i32(), 3);
        assert_eq!(AlertPriority::P4.to_i32(), 4);
        assert_eq!(AlertPriority::P5.to_i32(), 5);
    }

    #[test]
    fn test_storage_id_round_trips() {
        for p in ALL {
            assert_eq!(AlertPriority::from_i32(p.to_i32()), Some(p));
        }
    }

    /// Unset priority is represented by a NULL column / `None`, never by a
    /// sentinel id — so 0 and 6 must not decode.
    #[test]
    fn test_out_of_range_ids_do_not_decode() {
        for v in [-1, 0, 6, 99] {
            assert_eq!(AlertPriority::from_i32(v), None, "id {v} must not decode");
        }
    }

    /// P1 = 1 is deliberate: `ORDER BY priority ASC` must put the most urgent
    /// alerts at the top of the list without a CASE expression (PT-3).
    #[test]
    fn test_ascending_storage_id_means_descending_urgency() {
        let mut ids: Vec<i32> = ALL.iter().map(|p| p.to_i32()).collect();
        ids.sort();
        let sorted: Vec<AlertPriority> = ids
            .into_iter()
            .map(|i| AlertPriority::from_i32(i).unwrap())
            .collect();
        assert_eq!(sorted[0], AlertPriority::P1, "most urgent must sort first");
        assert_eq!(sorted[4], AlertPriority::P5, "least urgent must sort last");
    }

    #[test]
    fn test_urgency_comparison_is_not_the_integer_order() {
        assert!(AlertPriority::P1.is_more_urgent_than(AlertPriority::P3));
        assert!(!AlertPriority::P3.is_more_urgent_than(AlertPriority::P1));
        // Equal priorities are not "more urgent" than each other.
        assert!(!AlertPriority::P2.is_more_urgent_than(AlertPriority::P2));
        // Guard against a naive `self < other` implementation: P1 has the
        // SMALLEST id but the HIGHEST urgency.
        assert!(AlertPriority::P1.to_i32() < AlertPriority::P5.to_i32());
        assert!(AlertPriority::P1.is_more_urgent_than(AlertPriority::P5));
    }

    /// PT-4: the `"P3"` form is what reaches templates and the UI.
    #[test]
    fn test_display_uses_the_p_form() {
        assert_eq!(AlertPriority::P1.as_str(), "P1");
        assert_eq!(AlertPriority::P5.to_string(), "P5");
        for p in ALL {
            assert_eq!(p.to_string(), p.as_str());
        }
    }

    #[test]
    fn test_parses_both_p_form_and_bare_integer() {
        assert_eq!(AlertPriority::from_str("P1").unwrap(), AlertPriority::P1);
        assert_eq!(AlertPriority::from_str("p2").unwrap(), AlertPriority::P2);
        assert_eq!(AlertPriority::from_str("3").unwrap(), AlertPriority::P3);
        assert_eq!(AlertPriority::from_str(" P4 ").unwrap(), AlertPriority::P4);
    }

    #[test]
    fn test_parse_rejects_junk_and_names_the_offender() {
        for bad in ["", "P0", "P6", "0", "6", "banana", "P", "-1", "PP1", "1.0"] {
            let err = AlertPriority::from_str(bad).unwrap_err();
            // Match the BACKTICK-QUOTED form. A bare `contains(bad)` is
            // satisfiable by the message's own "expected P1 through P5" text
            // for inputs like "P", which made this assertion vacuous.
            assert!(
                err.to_string().contains(&format!("`{bad}`")),
                "error for `{bad}` must name the offending value, got: {err}"
            );
        }
    }

    /// Defect #4: the reported value is the TRIMMED token, so the user sees
    /// what was actually parsed rather than their incidental whitespace.
    #[test]
    fn test_parse_error_reports_the_trimmed_token() {
        let err = AlertPriority::from_str("  P9  ").unwrap_err();
        assert_eq!(err, PriorityError::OutOfRange("P9".to_string()));
    }

    /// Pins the equivalence that makes SQL `ORDER BY priority ASC` correct.
    ///
    /// NOTE: this does NOT — and cannot — enforce that `Ord` stays underived.
    /// Stable Rust has no negative trait bound, so re-adding the derive would
    /// fail nothing here. The prohibition lives as a comment on the type;
    /// this test only guards the id/urgency relationship it rests on.
    #[test]
    fn test_smaller_storage_id_means_more_urgent() {
        // If `Ord` were derived, this would be the tempting (and wrong) way to
        // ask "is a more urgent than b" — it must be written explicitly.
        assert!(AlertPriority::P1.is_more_urgent_than(AlertPriority::P2));
        assert_eq!(
            AlertPriority::P1.to_i32() < AlertPriority::P2.to_i32(),
            AlertPriority::P1.is_more_urgent_than(AlertPriority::P2),
            "smaller id == more urgent; this equivalence is what makes SQL ORDER BY ASC correct"
        );
    }

    /// Serde is the INTEGER form: it matches the storage column, so the API
    /// and the DB cannot drift apart.
    ///
    /// Every value is exercised because serde goes through `TryFrom<u8>` /
    /// `From<AlertPriority> for u8` — implementations SEPARATE from
    /// `to_i32`/`from_i32`. Testing one value would leave a wrong mapping for
    /// P1, P4 or P5 undetected.
    #[test]
    fn test_serializes_as_an_integer_for_every_value() {
        for (p, n) in ALL.iter().zip(1u8..=5) {
            let json = serde_json::to_string(p).unwrap();
            assert_eq!(json, n.to_string(), "{p:?} must serialize as {n}");

            let back: AlertPriority = serde_json::from_str(&n.to_string()).unwrap();
            assert_eq!(back, *p, "{n} must deserialize to {p:?}");
        }
    }

    /// The serde path and the storage path must agree — they are different
    /// code, and a divergence would silently corrupt rows on write.
    #[test]
    fn test_serde_and_storage_conversions_agree() {
        for p in ALL {
            let via_serde: u8 = p.into();
            assert_eq!(
                i32::from(via_serde),
                p.to_i32(),
                "serde and storage ids disagree for {p:?}"
            );
        }
    }

    #[test]
    fn test_serde_rejects_out_of_range() {
        assert!(serde_json::from_str::<AlertPriority>("0").is_err());
        assert!(serde_json::from_str::<AlertPriority>("6").is_err());
    }

    /// Pins the serde PATTERN that `Alert.priority` must adopt: `None`
    /// round-trips as *absent*, never as `0` or `null`.
    ///
    /// SCOPE WARNING: this uses a stand-in struct, so it proves nothing about
    /// the real `Alert` — it passes today precisely BECAUSE `Alert` has no
    /// `priority` field yet. The production contract (field present, correct
    /// default, survives an update round-trip) belongs to the storage/CRUD
    /// layer and is tracked separately. Do not read this as covering it.
    #[test]
    fn test_option_pattern_omits_unset_priority() {
        #[derive(Serialize, Deserialize, PartialEq, Debug)]
        struct Holder {
            #[serde(default, skip_serializing_if = "Option::is_none")]
            priority: Option<AlertPriority>,
        }
        let none = Holder { priority: None };
        assert_eq!(serde_json::to_string(&none).unwrap(), "{}");
        let parsed: Holder = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed, none);
        let some = Holder {
            priority: Some(AlertPriority::P2),
        };
        assert_eq!(serde_json::to_string(&some).unwrap(), r#"{"priority":2}"#);
    }
}
