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

//! Subjects — the thing that paged a human.
//!
//! The response record is keyed by `(subject_type, subject_id)`, not by
//! incident id. Incidents are only created when `alerts.creates_incident` is
//! set; an alert, synthetic or anomaly that never creates one still pages
//! somebody, and that person still needs a timeline, notes and a cause. An
//! incident is therefore a *renderer* of a record rather than its owner.
//!
//! `subject_id` identifies one **firing**, not one rule. The same alert rule
//! firing twice produces two records, so a cause recorded on the first is
//! visible as history on the second.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What kind of thing paged a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubjectType {
    Alert,
    Incident,
    Synthetic,
    Anomaly,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubjectError {
    UnknownType(String),
    EmptyId,
    /// The firing suffix was present but not a positive integer.
    BadFiringSuffix(String),
}

impl SubjectType {
    /// Durable storage id. **Never reorder or reuse** — persisted in
    /// `oncall_responses.subject_type`.
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::Alert => 1,
            Self::Incident => 2,
            Self::Synthetic => 3,
            Self::Anomaly => 4,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Alert),
            2 => Some(Self::Incident),
            3 => Some(Self::Synthetic),
            4 => Some(Self::Anomaly),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Alert => "alert",
            Self::Incident => "incident",
            Self::Synthetic => "synthetic",
            Self::Anomaly => "anomaly",
        }
    }
}

impl std::fmt::Display for SubjectType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for SubjectType {
    type Err = SubjectError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let token = s.trim();
        match token.to_ascii_lowercase().as_str() {
            "alert" => Ok(Self::Alert),
            "incident" => Ok(Self::Incident),
            "synthetic" => Ok(Self::Synthetic),
            "anomaly" => Ok(Self::Anomaly),
            _ => Err(SubjectError::UnknownType(token.to_string())),
        }
    }
}

/// Points at one firing of one thing.
///
/// `source_id` is the rule/check that produced it; `firing` counts firings of
/// that source. Together they form the `subject_id` stored on the record.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct SubjectRef {
    pub subject_type: SubjectType,
    /// The rule, check or incident this firing came from.
    pub source_id: String,
    /// 1-based firing counter. The first firing of a source is `#1`.
    pub firing: u32,
}

impl SubjectRef {
    pub fn new(subject_type: SubjectType, source_id: impl Into<String>, firing: u32) -> Self {
        Self {
            subject_type,
            source_id: source_id.into(),
            firing,
        }
    }

    /// The stored `subject_id`, e.g. `al_ckt#3`.
    ///
    /// The suffix is what makes the record per-firing rather than per-rule,
    /// which is what lets cause history accumulate across firings.
    pub fn subject_id(&self) -> String {
        format!("{}#{}", self.source_id, self.firing)
    }

    /// Storage key for the record: `(subject_type, subject_id)`.
    pub fn storage_key(&self) -> (i32, String) {
        (self.subject_type.to_i32(), self.subject_id())
    }

    /// Parse a stored `subject_id` back into its parts.
    ///
    /// Splits on the LAST `#` so a source id containing one is not corrupted.
    pub fn parse(subject_type: SubjectType, subject_id: &str) -> Result<Self, SubjectError> {
        let (source, suffix) = subject_id
            .rsplit_once('#')
            .ok_or_else(|| SubjectError::BadFiringSuffix(subject_id.to_string()))?;
        if source.is_empty() {
            return Err(SubjectError::EmptyId);
        }
        let firing: u32 = suffix
            .parse()
            .map_err(|_| SubjectError::BadFiringSuffix(subject_id.to_string()))?;
        if firing == 0 {
            return Err(SubjectError::BadFiringSuffix(subject_id.to_string()));
        }
        Ok(Self::new(subject_type, source, firing))
    }

    /// The reference for the next firing of the same source.
    pub fn next_firing(&self) -> Self {
        Self {
            subject_type: self.subject_type,
            source_id: self.source_id.clone(),
            firing: self.firing + 1,
        }
    }
}

impl std::fmt::Display for SubjectRef {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.subject_type, self.subject_id())
    }
}

impl std::fmt::Display for SubjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownType(v) => write!(
                f,
                "invalid subject type `{v}`: expected alert, incident, synthetic or anomaly"
            ),
            Self::EmptyId => f.write_str("subject id must name a source"),
            Self::BadFiringSuffix(v) => {
                write!(f, "subject id `{v}` must end in `#<n>` with n >= 1")
            }
        }
    }
}

impl std::error::Error for SubjectError {}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    const ALL: [SubjectType; 4] = [
        SubjectType::Alert,
        SubjectType::Incident,
        SubjectType::Synthetic,
        SubjectType::Anomaly,
    ];

    /// Fails loudly on a renumber — every persisted record would change
    /// meaning.
    #[test]
    fn test_storage_ids_are_pinned() {
        assert_eq!(SubjectType::Alert.to_i32(), 1);
        assert_eq!(SubjectType::Incident.to_i32(), 2);
        assert_eq!(SubjectType::Synthetic.to_i32(), 3);
        assert_eq!(SubjectType::Anomaly.to_i32(), 4);
    }

    #[test]
    fn test_storage_id_round_trips_and_rejects_junk() {
        for t in ALL {
            assert_eq!(SubjectType::from_i32(t.to_i32()), Some(t));
        }
        for v in [-1, 0, 5, 99] {
            assert_eq!(SubjectType::from_i32(v), None);
        }
    }

    #[test]
    fn test_parses_case_insensitively() {
        assert_eq!(SubjectType::from_str("Alert").unwrap(), SubjectType::Alert);
        assert_eq!(
            SubjectType::from_str("  synthetic ").unwrap(),
            SubjectType::Synthetic
        );
        assert!(SubjectType::from_str("report").is_err());
    }

    #[test]
    fn test_serializes_as_snake_case() {
        for t in ALL {
            let json = serde_json::to_string(&t).unwrap();
            assert_eq!(json, format!(r#""{}""#, t.as_str()));
            assert_eq!(serde_json::from_str::<SubjectType>(&json).unwrap(), t);
        }
    }

    /// The suffix is the whole point: two firings of one rule are two
    /// records, so the first one's cause is history for the second.
    #[test]
    fn test_subject_id_is_per_firing_not_per_rule() {
        let first = SubjectRef::new(SubjectType::Alert, "al_ckt", 1);
        let second = first.next_firing();
        assert_eq!(first.subject_id(), "al_ckt#1");
        assert_eq!(second.subject_id(), "al_ckt#2");
        assert_ne!(first.storage_key(), second.storage_key());
        assert_eq!(first.source_id, second.source_id);
    }

    #[test]
    fn test_storage_key_pairs_type_id_with_subject_id() {
        let s = SubjectRef::new(SubjectType::Synthetic, "syn_login", 7);
        assert_eq!(s.storage_key(), (3, "syn_login#7".to_string()));
    }

    #[test]
    fn test_parse_round_trips() {
        for t in ALL {
            let s = SubjectRef::new(t, "src_1", 42);
            let back = SubjectRef::parse(t, &s.subject_id()).unwrap();
            assert_eq!(back, s);
        }
    }

    /// A source id containing `#` must survive the round trip — splitting on
    /// the first `#` would truncate it and collide two different sources.
    #[test]
    fn test_parse_splits_on_the_last_hash() {
        let s = SubjectRef::parse(SubjectType::Alert, "team#a/rule#3").unwrap();
        assert_eq!(s.source_id, "team#a/rule");
        assert_eq!(s.firing, 3);
        assert_eq!(s.subject_id(), "team#a/rule#3");
    }

    #[test]
    fn test_parse_rejects_malformed_ids() {
        for bad in [
            "al_ckt",
            "al_ckt#",
            "al_ckt#0",
            "al_ckt#x",
            "al_ckt#-1",
            "#1",
        ] {
            assert!(
                SubjectRef::parse(SubjectType::Alert, bad).is_err(),
                "`{bad}` must not parse"
            );
        }
    }

    /// Firings are 1-based; a `#0` record would be indistinguishable from an
    /// uninitialised counter.
    #[test]
    fn test_firing_numbering_starts_at_one() {
        assert!(SubjectRef::parse(SubjectType::Alert, "al#0").is_err());
        assert!(SubjectRef::parse(SubjectType::Alert, "al#1").is_ok());
    }

    #[test]
    fn test_display_names_type_and_firing() {
        let s = SubjectRef::new(SubjectType::Alert, "al_ckt", 2);
        assert_eq!(s.to_string(), "alert/al_ckt#2");
    }

    #[test]
    fn test_subject_ref_round_trips_through_json() {
        let s = SubjectRef::new(SubjectType::Anomaly, "an_lat", 5);
        let back: SubjectRef = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
    }

    /// The key a record is stored under, and the key its dedup guard looks up,
    /// have to be the same string.
    ///
    /// They were not. A firing that fanned out to several teams stores one
    /// record per team under `<alert>:group:<team>`, while the guard asked
    /// about the bare `<alert>`. Lookups are a `"{source_id}#"` prefix match,
    /// and `alert#` does not prefix `alert:group:team#` — so the guard saw
    /// nothing, every evaluation answered "page", and each one opened a fresh
    /// record with the next firing number. For ever.
    ///
    /// Pinning the prefix relationship here because it is the whole mechanism:
    /// any producer that scopes a source id has to run its guard on the scoped
    /// id, not the bare one.
    #[test]
    fn test_a_scoped_source_id_is_not_found_under_the_bare_one() {
        let bare = "3Ig9JbtfNHuzykvEjIDl6ayIeGo";
        let scoped = format!("{bare}:group:3Ig8bQcoF42GgNdm7IcAcoO5HMZ");

        let stored = SubjectRef::new(SubjectType::Alert, &scoped, 1).subject_id();
        assert_eq!(stored, format!("{scoped}#1"));

        // What a lookup does: prefix-match on `"{source_id}#"`.
        assert!(
            !stored.starts_with(&format!("{bare}#")),
            "the bare id must not find the scoped record — this is the bug",
        );
        assert!(
            stored.starts_with(&format!("{scoped}#")),
            "the scoped id must find its own record",
        );

        // And the bare id keeps finding its own, so a single-team firing is
        // unaffected by the fix.
        let single = SubjectRef::new(SubjectType::Alert, bare, 1).subject_id();
        assert!(single.starts_with(&format!("{bare}#")));
    }
}
