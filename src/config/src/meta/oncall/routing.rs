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

//! Ownership — which team owns a failing thing.
//!
//! Teams claim **identity-dimension paths** rather than service names, using
//! the same `{alias_id: value}` vocabulary the service-identity config already
//! produces (`k8s-cluster`, `k8s-namespace`, …). A team that owns everything in
//! a cluster writes one rule; a team that owns one namespace inside it writes a
//! longer one, and the longer one wins.
//!
//! That is the whole point: services appear and disappear constantly, but the
//! namespace they live in does not. Nobody maintains a per-service routing
//! table.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A team's claim over part of the identity space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OwnershipRule {
    pub id: String,
    pub org_id: String,
    pub team_id: String,
    /// Every pair that must match for this rule to apply. An empty map is a
    /// catch-all and is rejected by [`Self::validate`] — an accidental
    /// catch-all would silently capture every alert in the org.
    pub dimensions: HashMap<String, String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    /// A rule with no dimensions matches everything.
    NoDimensions,
    EmptyDimensionName,
    EmptyDimensionValue(String),
}

impl std::fmt::Display for OwnershipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoDimensions => f.write_str(
                "an ownership rule must name at least one dimension; an empty rule would own every alert in the org",
            ),
            Self::EmptyDimensionName => f.write_str("dimension name cannot be empty"),
            Self::EmptyDimensionValue(k) => {
                write!(f, "dimension `{k}` has an empty value")
            }
        }
    }
}

impl std::error::Error for OwnershipError {}

impl OwnershipRule {
    /// How many dimensions this rule pins. The specificity score.
    pub fn specificity(&self) -> usize {
        self.dimensions.len()
    }

    /// Whether every pair in this rule is present in `dims` with the same
    /// value.
    ///
    /// Matching is subset-of, not equality: a record carries far more
    /// dimensions than any rule names, and requiring an exact match would mean
    /// a rule stops working the moment a new dimension is extracted.
    pub fn matches(&self, dims: &HashMap<String, String>) -> bool {
        self.dimensions
            .iter()
            .all(|(k, v)| dims.get(k).is_some_and(|actual| actual == v))
    }

    /// Canonical form for display and for the stable tie-break: dimensions
    /// sorted by name, rendered `k=v/k=v`.
    pub fn path(&self) -> String {
        let mut pairs: Vec<_> = self.dimensions.iter().collect();
        pairs.sort_by(|a, b| a.0.cmp(b.0));
        pairs
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("/")
    }

    pub fn validate(&self) -> Result<(), OwnershipError> {
        if self.dimensions.is_empty() {
            return Err(OwnershipError::NoDimensions);
        }
        for (k, v) in &self.dimensions {
            if k.trim().is_empty() {
                return Err(OwnershipError::EmptyDimensionName);
            }
            if v.trim().is_empty() {
                return Err(OwnershipError::EmptyDimensionValue(k.clone()));
            }
        }
        Ok(())
    }
}

/// Why a subject routed the way it did — recorded on the timeline so
/// "why was I paged" is answerable without re-deriving the decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum RoutingDecision {
    /// The alert names its team directly.
    Explicit { team_id: String },
    /// A longest-prefix ownership match.
    Ownership {
        team_id: String,
        rule_id: String,
        path: String,
    },
    /// The org's fallback team.
    OrgDefault { team_id: String },
    /// Nothing matched. Deliberately a value, not a `None`: an unroutable
    /// signal has to be visible, never a silent drop.
    Unrouted,
}

impl RoutingDecision {
    pub fn team_id(&self) -> Option<&str> {
        match self {
            Self::Explicit { team_id }
            | Self::Ownership { team_id, .. }
            | Self::OrgDefault { team_id } => Some(team_id),
            Self::Unrouted => None,
        }
    }

    pub fn is_routed(&self) -> bool {
        self.team_id().is_some()
    }

    /// One line for the timeline.
    pub fn reason(&self) -> String {
        match self {
            Self::Explicit { team_id } => format!("routed to {team_id} by the alert's own setting"),
            Self::Ownership { team_id, path, .. } => {
                format!("routed to {team_id} by ownership rule {path}")
            }
            Self::OrgDefault { team_id } => {
                format!("routed to the org default team {team_id}; no ownership rule matched")
            }
            Self::Unrouted => {
                "no team owns this signal and the org has no default team".to_string()
            }
        }
    }
}

/// The winning rule for `dims`, or `None`.
///
/// **Longest prefix wins**: among every rule whose dimensions are all present,
/// the one pinning the most dimensions is the most specific claim. A team
/// owning `cluster=prod` is overridden inside `cluster=prod/namespace=payments`
/// by the team that claimed the namespace — which is what lets a platform team
/// own a cluster without owning every service in it.
///
/// Ties are broken by canonical path, then by rule id, so the answer is stable
/// across nodes and across restarts. A tie means two teams have claimed
/// equally-specific, both-matching paths — a configuration mistake the UI
/// should surface, but one that must still resolve deterministically rather
/// than depending on row order.
pub fn resolve_owner<'a>(
    rules: &'a [OwnershipRule],
    dims: &HashMap<String, String>,
) -> Option<&'a OwnershipRule> {
    rules
        .iter()
        .filter(|rule| rule.validate().is_ok() && rule.matches(dims))
        .max_by(|a, b| {
            a.specificity()
                .cmp(&b.specificity())
                .then_with(|| b.path().cmp(&a.path()))
                .then_with(|| b.id.cmp(&a.id))
        })
}

/// The full routing decision, in the order the design specifies.
///
/// Explicit beats discovered: a team that has deliberately set the alert's
/// owner is stating something the dimensions cannot express, and must not be
/// overruled by a rule someone else added later.
pub fn route(
    explicit_team_id: Option<&str>,
    rules: &[OwnershipRule],
    dims: &HashMap<String, String>,
    org_default_team_id: Option<&str>,
) -> RoutingDecision {
    if let Some(team_id) = explicit_team_id.filter(|t| !t.trim().is_empty()) {
        return RoutingDecision::Explicit {
            team_id: team_id.to_string(),
        };
    }
    if let Some(rule) = resolve_owner(rules, dims) {
        return RoutingDecision::Ownership {
            team_id: rule.team_id.clone(),
            rule_id: rule.id.clone(),
            path: rule.path(),
        };
    }
    match org_default_team_id.filter(|t| !t.trim().is_empty()) {
        Some(team_id) => RoutingDecision::OrgDefault {
            team_id: team_id.to_string(),
        },
        None => RoutingDecision::Unrouted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dims(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn rule(id: &str, team: &str, pairs: &[(&str, &str)]) -> OwnershipRule {
        OwnershipRule {
            id: id.to_string(),
            org_id: "default".to_string(),
            team_id: team.to_string(),
            dimensions: dims(pairs),
            created_at: 0,
            updated_at: 0,
        }
    }

    /// The case the whole design turns on: a platform team owns the cluster,
    /// a product team owns one namespace inside it, and the namespace wins.
    #[test]
    fn test_longest_prefix_wins() {
        let rules = vec![
            rule("r_cluster", "platform", &[("k8s-cluster", "prod")]),
            rule(
                "r_ns",
                "payments",
                &[("k8s-cluster", "prod"), ("k8s-namespace", "payments")],
            ),
        ];
        let record = dims(&[
            ("k8s-cluster", "prod"),
            ("k8s-namespace", "payments"),
            ("service", "payment-gateway"),
        ]);
        assert_eq!(resolve_owner(&rules, &record).unwrap().team_id, "payments");
    }

    /// A service in the same cluster but a different namespace falls back to
    /// the cluster owner — the platform team owns everything nobody claimed.
    #[test]
    fn test_unclaimed_namespace_falls_back_to_the_cluster_owner() {
        let rules = vec![
            rule("r_cluster", "platform", &[("k8s-cluster", "prod")]),
            rule(
                "r_ns",
                "payments",
                &[("k8s-cluster", "prod"), ("k8s-namespace", "payments")],
            ),
        ];
        let record = dims(&[("k8s-cluster", "prod"), ("k8s-namespace", "search")]);
        assert_eq!(resolve_owner(&rules, &record).unwrap().team_id, "platform");
    }

    /// A record carries far more dimensions than any rule names. Requiring an
    /// exact match would break every rule the moment a new dimension appears.
    #[test]
    fn test_matching_is_subset_not_equality() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let record = dims(&[
            ("k8s-cluster", "prod"),
            ("k8s-namespace", "anything"),
            ("k8s-deployment", "web"),
            ("region", "us-east-1"),
        ]);
        assert!(resolve_owner(&rules, &record).is_some());
    }

    #[test]
    fn test_a_rule_needing_a_missing_dimension_does_not_match() {
        let rules = vec![rule(
            "r",
            "payments",
            &[("k8s-cluster", "prod"), ("k8s-namespace", "payments")],
        )];
        // Namespace absent entirely.
        assert!(resolve_owner(&rules, &dims(&[("k8s-cluster", "prod")])).is_none());
        // Namespace present with a different value.
        assert!(
            resolve_owner(
                &rules,
                &dims(&[("k8s-cluster", "prod"), ("k8s-namespace", "search")])
            )
            .is_none()
        );
    }

    #[test]
    fn test_value_matching_is_case_sensitive() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        assert!(resolve_owner(&rules, &dims(&[("k8s-cluster", "PROD")])).is_none());
    }

    #[test]
    fn test_no_rules_means_no_owner() {
        assert!(resolve_owner(&[], &dims(&[("k8s-cluster", "prod")])).is_none());
    }

    /// Two equally-specific matching rules is a configuration mistake, but it
    /// must still resolve the same way on every node and after every restart.
    #[test]
    fn test_ties_resolve_deterministically_regardless_of_order() {
        let a = rule("r_a", "team-a", &[("k8s-namespace", "shared")]);
        let b = rule("r_b", "team-b", &[("k8s-namespace", "shared")]);
        let record = dims(&[("k8s-namespace", "shared")]);

        let forward = resolve_owner(&[a.clone(), b.clone()], &record)
            .unwrap()
            .team_id
            .clone();
        let reverse = resolve_owner(&[b, a], &record).unwrap().team_id.clone();
        assert_eq!(forward, reverse, "row order must not decide the owner");
    }

    /// An empty rule would own every alert in the org. It is refused, and the
    /// resolver skips it even if one somehow reached storage.
    #[test]
    fn test_an_empty_rule_is_refused_and_never_matches() {
        let empty = rule("r_empty", "everyone", &[]);
        assert_eq!(empty.validate(), Err(OwnershipError::NoDimensions));
        assert!(resolve_owner(&[empty], &dims(&[("k8s-cluster", "prod")])).is_none());
    }

    #[test]
    fn test_validate_rejects_blank_names_and_values() {
        let mut r = rule("r", "t", &[("k8s-cluster", "prod")]);
        r.dimensions.insert("  ".to_string(), "x".to_string());
        assert_eq!(r.validate(), Err(OwnershipError::EmptyDimensionName));

        let mut r = rule("r", "t", &[("k8s-cluster", "  ")]);
        assert_eq!(
            r.validate(),
            Err(OwnershipError::EmptyDimensionValue("k8s-cluster".into()))
        );
    }

    /// The canonical path is what the UI shows and what breaks ties, so it
    /// cannot depend on HashMap iteration order.
    #[test]
    fn test_path_is_stable_and_sorted() {
        let r = rule(
            "r",
            "t",
            &[
                ("k8s-namespace", "payments"),
                ("k8s-cluster", "prod"),
                ("region", "us-east-1"),
            ],
        );
        for _ in 0..20 {
            assert_eq!(
                r.path(),
                "k8s-cluster=prod/k8s-namespace=payments/region=us-east-1"
            );
        }
    }

    /// A team that deliberately set the alert's owner is stating something the
    /// dimensions cannot express, and must not be overruled by a rule somebody
    /// else adds later.
    #[test]
    fn test_explicit_beats_a_matching_ownership_rule() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let decision = route(
            Some("chosen-team"),
            &rules,
            &dims(&[("k8s-cluster", "prod")]),
            Some("org-default"),
        );
        assert_eq!(
            decision,
            RoutingDecision::Explicit {
                team_id: "chosen-team".into()
            }
        );
    }

    /// A blank explicit value is an unset field, not a team named "".
    #[test]
    fn test_a_blank_explicit_team_is_ignored() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        for blank in [Some(""), Some("   "), None] {
            let decision = route(blank, &rules, &dims(&[("k8s-cluster", "prod")]), None);
            assert_eq!(decision.team_id(), Some("platform"), "blank={blank:?}");
        }
    }

    #[test]
    fn test_full_fallback_chain() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let matching = dims(&[("k8s-cluster", "prod")]);
        let unmatched = dims(&[("k8s-cluster", "staging")]);

        assert!(matches!(
            route(None, &rules, &matching, Some("org-default")),
            RoutingDecision::Ownership { .. }
        ));
        assert_eq!(
            route(None, &rules, &unmatched, Some("org-default")),
            RoutingDecision::OrgDefault {
                team_id: "org-default".into()
            }
        );
        assert_eq!(
            route(None, &rules, &unmatched, None),
            RoutingDecision::Unrouted
        );
    }

    /// An unroutable signal must be a visible outcome, not a silent drop.
    #[test]
    fn test_unrouted_is_a_value_with_a_reason() {
        let decision = route(None, &[], &dims(&[]), None);
        assert!(!decision.is_routed());
        assert_eq!(decision.team_id(), None);
        assert!(decision.reason().contains("no team owns"));
    }

    /// The reason is written to the timeline, so "why was I paged" is
    /// answerable without re-deriving the decision.
    #[test]
    fn test_every_decision_explains_itself() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let ownership = route(None, &rules, &dims(&[("k8s-cluster", "prod")]), None);
        assert!(ownership.reason().contains("k8s-cluster=prod"));
        assert!(ownership.reason().contains("platform"));

        assert!(
            route(Some("t"), &[], &dims(&[]), None)
                .reason()
                .contains("alert's own setting")
        );
        assert!(
            route(None, &[], &dims(&[]), Some("d"))
                .reason()
                .contains("no ownership rule matched")
        );
    }

    #[test]
    fn test_decision_round_trips_through_json() {
        let decisions = [
            RoutingDecision::Explicit {
                team_id: "t".into(),
            },
            RoutingDecision::Ownership {
                team_id: "t".into(),
                rule_id: "r".into(),
                path: "k8s-cluster=prod".into(),
            },
            RoutingDecision::OrgDefault {
                team_id: "t".into(),
            },
            RoutingDecision::Unrouted,
        ];
        for decision in decisions {
            let json = serde_json::to_string(&decision).unwrap();
            assert_eq!(
                serde_json::from_str::<RoutingDecision>(&json).unwrap(),
                decision
            );
        }
    }
}
