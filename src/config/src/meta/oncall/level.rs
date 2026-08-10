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

//! Escalation levels — the rungs of a team's ladder.
//!
//! The model stores **levels, not job titles**. Nowhere do we record that
//! someone is a manager, a director or a VP. Who sits at L2 this quarter is a
//! scheduling decision, so reorgs and promotions never require a schema
//! change, a routing update or a policy rewrite.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A rung in the escalation ladder.
///
/// `L0` is the AI SRE agent and is not a rotation slot — no human is ever
/// assigned to it. It is part of this enum so that a ladder step and a
/// timeline event can name it without a second vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EscalationLevel {
    L0,
    Primary,
    Secondary,
    L1,
    L2,
    L3,
    L4,
}

/// Why a level string was rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LevelError {
    Unknown(String),
}

impl EscalationLevel {
    /// Durable storage id. **Never reorder or reuse** — these are persisted in
    /// `oncall_team_members.level` and in timeline events.
    ///
    /// L0 is 0 and the human rungs ascend from 1, so `ORDER BY level ASC`
    /// walks the ladder in the order it actually fires.
    pub fn to_i32(&self) -> i32 {
        match self {
            Self::L0 => 0,
            Self::Primary => 1,
            Self::Secondary => 2,
            Self::L1 => 3,
            Self::L2 => 4,
            Self::L3 => 5,
            Self::L4 => 6,
        }
    }

    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            0 => Some(Self::L0),
            1 => Some(Self::Primary),
            2 => Some(Self::Secondary),
            3 => Some(Self::L1),
            4 => Some(Self::L2),
            5 => Some(Self::L3),
            6 => Some(Self::L4),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::L0 => "l0",
            Self::Primary => "primary",
            Self::Secondary => "secondary",
            Self::L1 => "l1",
            Self::L2 => "l2",
            Self::L3 => "l3",
            Self::L4 => "l4",
        }
    }

    /// Human-facing label for the UI and notification templates.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::L0 => "AI SRE",
            Self::Primary => "Primary",
            Self::Secondary => "Secondary",
            Self::L1 => "L1",
            Self::L2 => "L2",
            Self::L3 => "L3",
            Self::L4 => "L4",
        }
    }

    /// Every level a human can be scheduled into, in ladder order.
    ///
    /// Excludes [`Self::L0`]: assigning a person to the agent's rung is not a
    /// thing the product allows, and every membership validation path checks
    /// against this list rather than against the full enum.
    pub const HUMAN_LEVELS: [Self; 6] = [
        Self::Primary,
        Self::Secondary,
        Self::L1,
        Self::L2,
        Self::L3,
        Self::L4,
    ];

    pub fn is_human_slot(&self) -> bool {
        !matches!(self, Self::L0)
    }

    /// The next rung up, or `None` at the top of the ladder.
    ///
    /// Skips L0 entirely — escalation never moves *to* the agent.
    pub fn next(&self) -> Option<Self> {
        match self {
            Self::L0 => Some(Self::Primary),
            Self::Primary => Some(Self::Secondary),
            Self::Secondary => Some(Self::L1),
            Self::L1 => Some(Self::L2),
            Self::L2 => Some(Self::L3),
            Self::L3 => Some(Self::L4),
            Self::L4 => None,
        }
    }
}

impl std::fmt::Display for EscalationLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::fmt::Display for LevelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unknown(v) => write!(
                f,
                "invalid escalation level `{v}`: expected one of l0, primary, secondary, l1..l4"
            ),
        }
    }
}

impl std::error::Error for LevelError {}

impl std::str::FromStr for EscalationLevel {
    type Err = LevelError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let token = s.trim();
        match token.to_ascii_lowercase().as_str() {
            "l0" => Ok(Self::L0),
            "primary" => Ok(Self::Primary),
            "secondary" => Ok(Self::Secondary),
            "l1" => Ok(Self::L1),
            "l2" => Ok(Self::L2),
            "l3" => Ok(Self::L3),
            "l4" => Ok(Self::L4),
            _ => Err(LevelError::Unknown(token.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    const ALL: [EscalationLevel; 7] = [
        EscalationLevel::L0,
        EscalationLevel::Primary,
        EscalationLevel::Secondary,
        EscalationLevel::L1,
        EscalationLevel::L2,
        EscalationLevel::L3,
        EscalationLevel::L4,
    ];

    /// Fails loudly if anyone renumbers the enum — every persisted membership
    /// row and timeline event would silently change meaning.
    #[test]
    fn test_storage_ids_are_pinned() {
        assert_eq!(EscalationLevel::L0.to_i32(), 0);
        assert_eq!(EscalationLevel::Primary.to_i32(), 1);
        assert_eq!(EscalationLevel::Secondary.to_i32(), 2);
        assert_eq!(EscalationLevel::L1.to_i32(), 3);
        assert_eq!(EscalationLevel::L2.to_i32(), 4);
        assert_eq!(EscalationLevel::L3.to_i32(), 5);
        assert_eq!(EscalationLevel::L4.to_i32(), 6);
    }

    #[test]
    fn test_storage_id_round_trips() {
        for l in ALL {
            assert_eq!(EscalationLevel::from_i32(l.to_i32()), Some(l));
        }
    }

    #[test]
    fn test_out_of_range_ids_do_not_decode() {
        for v in [-1, 7, 99] {
            assert_eq!(EscalationLevel::from_i32(v), None, "id {v} must not decode");
        }
    }

    /// `ORDER BY level ASC` must walk the ladder in firing order.
    #[test]
    fn test_ascending_id_is_ladder_order() {
        let mut ids: Vec<i32> = ALL.iter().map(|l| l.to_i32()).collect();
        ids.sort();
        let sorted: Vec<EscalationLevel> = ids
            .into_iter()
            .map(|i| EscalationLevel::from_i32(i).unwrap())
            .collect();
        assert_eq!(sorted, ALL.to_vec());
    }

    #[test]
    fn test_next_walks_the_whole_ladder_and_stops() {
        let mut seen = vec![EscalationLevel::Primary];
        let mut cur = EscalationLevel::Primary;
        while let Some(n) = cur.next() {
            seen.push(n);
            cur = n;
        }
        assert_eq!(seen, EscalationLevel::HUMAN_LEVELS.to_vec());
        assert_eq!(EscalationLevel::L4.next(), None, "ladder must terminate");
    }

    /// Escalation must never move *to* the agent: L0 hands off to a human.
    #[test]
    fn test_next_never_returns_the_agent_rung() {
        for l in ALL {
            if let Some(n) = l.next() {
                assert_ne!(n, EscalationLevel::L0, "{l} escalated into the agent rung");
            }
        }
        assert_eq!(EscalationLevel::L0.next(), Some(EscalationLevel::Primary));
    }

    #[test]
    fn test_human_levels_excludes_the_agent() {
        assert!(!EscalationLevel::HUMAN_LEVELS.contains(&EscalationLevel::L0));
        assert!(!EscalationLevel::L0.is_human_slot());
        for l in EscalationLevel::HUMAN_LEVELS {
            assert!(l.is_human_slot(), "{l} must be schedulable");
        }
    }

    #[test]
    fn test_parses_case_insensitively_and_trims() {
        assert_eq!(
            EscalationLevel::from_str("Primary").unwrap(),
            EscalationLevel::Primary
        );
        assert_eq!(
            EscalationLevel::from_str("  L2  ").unwrap(),
            EscalationLevel::L2
        );
        for l in ALL {
            assert_eq!(EscalationLevel::from_str(l.as_str()).unwrap(), l);
        }
    }

    /// Job titles are not levels. If one of these ever parses, the model has
    /// drifted back into storing org structure.
    #[test]
    fn test_parse_rejects_job_titles_and_junk() {
        for bad in ["", "manager", "vp", "director", "ceo", "l5", "l-1", "prim"] {
            let err = EscalationLevel::from_str(bad).unwrap_err();
            assert!(
                err.to_string().contains(&format!("`{bad}`")),
                "error for `{bad}` must name the offending value, got: {err}"
            );
        }
    }

    #[test]
    fn test_serializes_as_snake_case_strings() {
        assert_eq!(
            serde_json::to_string(&EscalationLevel::Secondary).unwrap(),
            r#""secondary""#
        );
        for l in ALL {
            let json = serde_json::to_string(&l).unwrap();
            assert_eq!(json, format!(r#""{}""#, l.as_str()));
            let back: EscalationLevel = serde_json::from_str(&json).unwrap();
            assert_eq!(back, l);
        }
    }

    #[test]
    fn test_display_name_is_distinct_per_level() {
        let names: std::collections::HashSet<_> = ALL.iter().map(|l| l.display_name()).collect();
        assert_eq!(names.len(), ALL.len(), "display names must be unique");
    }
}
