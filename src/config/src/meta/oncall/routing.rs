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

use super::subject::SubjectType;

/// The dimension every platform has, whatever else it reports.
///
/// Spelled as the semantic group's own id (`default_semantic_groups.json`), so
/// a rule written against it matches what extraction produces. Named here
/// rather than typed as a literal at each call site because the fallback in the
/// incident path and the rules an operator writes have to agree exactly — a
/// route on `service` and a dimension emitted as `service_name` never meet.
pub const SERVICE_DIMENSION: &str = "service";

/// Canonical form of a set of dimensions: sorted by name, rendered `k=v/k=v`.
///
/// The same spelling an [`OwnershipRule`] stores, so an unrouted signal's path
/// and the rule that would have caught it are directly comparable — by eye in
/// the UI, and by string in the storage layer's unique index.
pub fn canonical_path(dimensions: &HashMap<String, String>) -> String {
    let mut pairs: Vec<_> = dimensions.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("/")
}

/// The org's routing configuration. Today: which team catches whatever no
/// ownership rule claimed.
///
/// One row per org, and `default_team_id` is deliberately optional. There is no
/// auto-created fallback team: a fresh org has no default, and whatever does
/// not route goes on the unrouted queue until an operator nominates a team for
/// it. That nomination is what makes the tier safe — the catch-all is a team
/// somebody deliberately chose, not one the product invented and then started
/// waking at 3am for services they may not run.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct RoutingConfig {
    pub org_id: String,
    /// The nominated catch-all, or `None` while nobody has picked one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_team_id: Option<String>,
    pub updated_at: i64,
}

impl RoutingConfig {
    /// A org that has never touched the setting reads the same as one that
    /// cleared it, so the read path never has to distinguish "no row" from
    /// "row with nothing in it".
    pub fn unset(org_id: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            default_team_id: None,
            updated_at: 0,
        }
    }

    pub fn has_default(&self) -> bool {
        self.default_team_id
            .as_deref()
            .is_some_and(|t| !t.trim().is_empty())
    }
}

/// A team's claim over part of the identity space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct OwnershipRule {
    pub id: String,
    pub org_id: String,
    pub team_id: String,
    /// Every pair that must match for this rule to apply. An empty map is a
    /// catch-all and is rejected by [`Self::validate`] — an accidental
    /// catch-all would silently capture every alert in the org.
    ///
    /// A value may end in `*` to claim the subtree below a literal prefix
    /// (`host=db-*`), which is what §7 asks for on deployments whose finest
    /// dimension is a numbered host rather than a namespace.
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
    /// `db-*-1`. A wildcard is a prefix claim, not a pattern language.
    WildcardNotTrailing(String),
    /// A lone `*`, which claims every value the dimension can take.
    WildcardMatchesEverything(String),
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
            Self::WildcardNotTrailing(k) => write!(
                f,
                "dimension `{k}` may only use `*` at the end of its value, as a prefix claim like `db-*`",
            ),
            Self::WildcardMatchesEverything(k) => write!(
                f,
                "dimension `{k}` is a bare `*`, which claims every value it can take; nominate a default team instead",
            ),
        }
    }
}

impl std::error::Error for OwnershipError {}

/// Whether one rule pair matches the value the record carried.
///
/// A trailing `*` is a prefix claim and nothing more: `host=db-*` owns
/// `db-01` and `db-primary`, and no other form of pattern exists. §7's rule is
/// "no regex, no boolean logic", because a routing table people cannot read at
/// a glance is one they stop trusting.
fn pair_matches(want: &str, actual: &str) -> bool {
    match want.strip_suffix('*') {
        Some(prefix) => actual.starts_with(prefix),
        None => want == actual,
    }
}

/// How fine-grained each dimension is, so routing can say a service is a
/// narrower thing than the cluster containing it.
///
/// Without this, two rules that pin one dimension each are separated only by
/// how many characters their values happen to have. `{k8s-cluster: production}`
/// and `{service: payment-gateway}` both match a payment-gateway page in
/// production, both pin one dimension, and the longer string wins — so
/// "payments owns payment-gateway everywhere" holds until somebody renames the
/// cluster to `production-us-east-1-primary`, at which point the cluster team
/// silently starts taking those pages. That is not a tie-break anyone chose.
///
/// The ordering is not invented here. `Distinguish Services By` is already an
/// **ordered** list per identity set — an org that wrote `[k8s-cluster,
/// k8s-namespace]` has said a cluster contains namespaces — so the rank is the
/// position in that list. `service` is finest by definition, being the thing
/// the sets exist to disambiguate.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DimensionDepth {
    ranks: HashMap<String, usize>,
}

impl DimensionDepth {
    /// Ranks read off the org's identity sets, coarsest first within each set.
    ///
    /// Sets are ranked independently rather than concatenated: a record is
    /// either an ECS task or a Kubernetes pod, so `ecs-task` and `k8s-namespace`
    /// are never in contention and giving them a shared scale would only invent
    /// an ordering between two things that never meet.
    /// The ordering routing falls back to when an org has described no topology.
    ///
    /// Without it, an unconfigured org ranks nothing, so two rules pinning one
    /// dimension each tie on every meaningful term and fall through to *literal
    /// character count* — `{k8s-namespace: kafka}` loses to
    /// `{k8s-cluster: prod-use1}` because `prod-use1` is the longer word, while
    /// `{k8s-namespace: monitoring}` wins because it is longer than the cluster
    /// name. Measured on a realistic estate, that mis-routes about one page in
    /// twenty, and which namespaces it hits depends on nothing an operator can
    /// see.
    ///
    /// One axis per platform, coarse → fine. They rank independently, so a
    /// Kubernetes pod and an ECS task never compete on a shared scale.
    ///
    /// `host` and `environment` are deliberately absent. Ranking `host` finer
    /// than `k8s-namespace` would make a node claim beat a namespace claim on
    /// every Kubernetes signal, which is not a precedence anybody has asked for;
    /// ranking it coarser leaves bare-metal estates exactly where they are. So
    /// they stay unranked, and an org that claims ownership by host says so in
    /// its own identity sets.
    pub fn shipped_default() -> Self {
        const AXES: [&[&str]; 5] = [
            &["k8s-cluster", "k8s-namespace", "k8s-deployment"],
            &[
                "region",
                "availability-zone",
                "aws-ecs-cluster",
                "aws-ecs-task",
            ],
            &["region", "faas-name"],
            &["region", "azure-resource-group", "azure-cloud-role"],
            &["region", "gcp-cloud-run", "gcp-instance"],
        ];
        let owned: Vec<Vec<String>> = AXES
            .iter()
            .map(|axis| axis.iter().map(|a| (*a).to_string()).collect())
            .collect();
        Self::from_sets(owned.iter().map(|axis| axis.as_slice()))
    }

    pub fn from_sets<'a>(sets: impl IntoIterator<Item = &'a [String]>) -> Self {
        let mut ranks: HashMap<String, usize> = HashMap::new();
        for distinguish_by in sets {
            for (position, alias) in distinguish_by.iter().enumerate() {
                if alias == SERVICE_DIMENSION {
                    continue;
                }
                // Coarsest wins on collision: an alias appearing early in one
                // set and late in another is at best ambiguous, and treating it
                // as the broader claim keeps a rule from outranking one that
                // genuinely is narrower.
                ranks
                    .entry(alias.clone())
                    .and_modify(|r| *r = (*r).min(position))
                    .or_insert(position);
            }
        }
        Self { ranks }
    }

    /// Where this dimension sits, higher being finer.
    ///
    /// `service` is always finest. A dimension no set mentions is coarsest —
    /// it is not part of the topology anybody described, so it cannot be
    /// allowed to outrank one that is.
    pub fn rank_of(&self, alias: &str) -> usize {
        if alias == SERVICE_DIMENSION {
            return usize::MAX;
        }
        self.ranks.get(alias).map_or(0, |r| r + 1)
    }

    pub fn is_empty(&self) -> bool {
        self.ranks.is_empty()
    }
}

impl OwnershipRule {
    /// How many dimensions this rule pins — its depth in the path, and the
    /// first term of the specificity ordering.
    pub fn specificity(&self) -> usize {
        self.dimensions.len()
    }

    /// The finest level this rule reaches, and the second term of the ordering.
    ///
    /// Compared before exactness so that depth beats pattern shape: a rule
    /// naming a service is a narrower claim than one naming a cluster whether
    /// or not either uses a wildcard. Within one depth, exactness still decides.
    pub fn finest_depth(&self, depths: &DimensionDepth) -> usize {
        self.dimensions
            .keys()
            .map(|k| depths.rank_of(k))
            .max()
            .unwrap_or(0)
    }

    /// How many of those dimensions are pinned to a literal value.
    ///
    /// The third term of the ordering, so that at equal depth an exact match
    /// always beats a wildcard one: `host=db-01` is a statement about one host,
    /// `host=db-*` a statement about a family, and the narrower claim is the
    /// one whose author meant it.
    pub fn exact_dimensions(&self) -> usize {
        self.dimensions
            .values()
            .filter(|v| !v.ends_with('*'))
            .count()
    }

    /// Total literal characters pinned, wildcards' `*` excluded. The fourth
    /// term: between `host=db-prod-*` and `host=db-*` the longer prefix is the
    /// more specific claim.
    ///
    /// Only ever compares two rules already tied on count, depth and exactness
    /// — i.e. two wildcards over the same dimension — which is the one place
    /// where string length is a real signal rather than an accident.
    pub fn literal_chars(&self) -> usize {
        self.dimensions
            .values()
            .map(|v| v.trim_end_matches('*').chars().count())
            .sum()
    }

    /// Whether every pair in this rule is present in `dims` and matches.
    ///
    /// Matching is subset-of, not equality: a record carries far more
    /// dimensions than any rule names, and requiring an exact match would mean
    /// a rule stops working the moment a new dimension is extracted.
    pub fn matches(&self, dims: &HashMap<String, String>) -> bool {
        self.dimensions
            .iter()
            .all(|(k, v)| dims.get(k).is_some_and(|actual| pair_matches(v, actual)))
    }

    /// Canonical form for display and for the stable tie-break: dimensions
    /// sorted by name, rendered `k=v/k=v`.
    pub fn path(&self) -> String {
        canonical_path(&self.dimensions)
    }

    pub fn validate(&self) -> Result<(), OwnershipError> {
        if self.dimensions.is_empty() {
            return Err(OwnershipError::NoDimensions);
        }
        for (k, v) in &self.dimensions {
            if k.trim().is_empty() {
                return Err(OwnershipError::EmptyDimensionName);
            }
            let v = v.trim();
            if v.is_empty() {
                return Err(OwnershipError::EmptyDimensionValue(k.clone()));
            }
            if v == "*" {
                return Err(OwnershipError::WildcardMatchesEverything(k.clone()));
            }
            // Only the final character may be a `*`. Anything else is somebody
            // reaching for a pattern language this deliberately is not.
            if v.trim_end_matches('*').contains('*') {
                return Err(OwnershipError::WildcardNotTrailing(k.clone()));
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
    /// The alert names its team directly, in its own `oncall_team` field.
    Explicit { team_id: String },
    /// A longest-prefix ownership match.
    Ownership {
        team_id: String,
        rule_id: String,
        path: String,
    },
    /// Nothing above matched, and an operator nominated this team as the
    /// org's catch-all.
    Default { team_id: String },
    /// Nothing matched and no default team is nominated. Deliberately a value,
    /// not a `None`: an unroutable signal has to be visible, never a silent
    /// drop.
    Unrouted,
}

impl RoutingDecision {
    pub fn team_id(&self) -> Option<&str> {
        match self {
            Self::Explicit { team_id }
            | Self::Ownership { team_id, .. }
            | Self::Default { team_id } => Some(team_id),
            Self::Unrouted => None,
        }
    }

    pub fn is_routed(&self) -> bool {
        self.team_id().is_some()
    }

    /// Whether the signal only got a team because one was nominated as the
    /// catch-all — the fact §4 says is the one thing worth surfacing.
    pub fn landed_on_default(&self) -> bool {
        matches!(self, Self::Default { .. })
    }

    /// One line for the timeline. Every case names the team and the mechanism
    /// in the same shape, so "why did this page me" reads as a sentence rather
    /// than as a rule id somebody then has to look up.
    pub fn reason(&self) -> String {
        match self {
            Self::Explicit { team_id } => format!("routed to {team_id} by the alert's own setting"),
            Self::Ownership { team_id, path, .. } => {
                format!("routed to {team_id} by ownership rule {path}")
            }
            Self::Default { team_id } => {
                format!("no ownership rule matched, so it went to the default team {team_id}")
            }
            Self::Unrouted => "no ownership rule matches this signal and no default team is set, \
                               so no team was paged"
                .to_string(),
        }
    }
}

/// Everything the decision is made from. A struct rather than five positional
/// arguments because the *order* of these is the design, and a caller that
/// swapped two `Option<&str>`s would compile.
#[derive(Debug, Clone, Copy, Default)]
pub struct RoutingInputs<'a> {
    /// Level 1 — `alerts.oncall_team`, the field on the object itself.
    pub explicit_team_id: Option<&'a str>,
    /// Level 2 — the org's ownership rules.
    pub rules: &'a [OwnershipRule],
    /// The identity dimensions the signal carried.
    pub dimensions: Option<&'a HashMap<String, String>>,
    /// Level 3 — the nominated catch-all, if the org has one.
    pub default_team_id: Option<&'a str>,
    /// How deep each dimension sits, for separating rules of equal specificity.
    /// Defaulting it is safe: `service` outranks everything with or without it.
    pub depths: Option<&'a DimensionDepth>,
}

/// The decision, plus anything routing had to pass over on the way to it.
///
/// `notes` exists because "the alert named a team that does not exist" is not
/// a decision and not an error — it is a fact the person reading the timeline
/// needs, and the only place it can be stated is beside the decision it did not
/// win.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Routed {
    pub decision: RoutingDecision,
    pub notes: Vec<String>,
}

impl Routed {
    fn plain(decision: RoutingDecision) -> Self {
        Self {
            decision,
            notes: Vec::new(),
        }
    }

    pub fn team_id(&self) -> Option<&str> {
        self.decision.team_id()
    }

    pub fn is_routed(&self) -> bool {
        self.decision.is_routed()
    }

    pub fn landed_on_default(&self) -> bool {
        self.decision.landed_on_default()
    }

    /// The whole story in one timeline line: what was ignored, then what won.
    pub fn reason(&self) -> String {
        if self.notes.is_empty() {
            return self.decision.reason();
        }
        format!("{}; {}", self.notes.join("; "), self.decision.reason())
    }
}

/// A signal that fired and that no ownership rule claimed.
///
/// The design's Phase 2 fallback chain ends in an "unrouted queue (visible,
/// alertable — an unroutable page must never be a silent drop)". A
/// `log::warn!` is not that: nobody reads warnings from a node they are not
/// tailing, and it cannot be listed, counted or worked through. This is the
/// durable form of the same idea.
///
/// It survives the arrival of a default team, and gains a job. §4 is explicit
/// that the only thing worth surfacing is *"namespaces that paged you and
/// landed on the default team"* — which is this queue with
/// [`Self::defaulted_team_id`] set. The two outcomes live in one table because
/// they are one question, "what has no owner", answered before and after
/// somebody nominated a catch-all; splitting them would mean the "Assign next"
/// screen had to read two lists and reconcile them.
///
/// One row per **dimension path**, not per firing. An alert that nobody owns
/// and that fires every minute is one line in the operator's queue saying it
/// happened four hundred times, not four hundred lines — the actionable fact
/// is the missing rule, and there is exactly one of those.
///
/// It deliberately does NOT open a response record. A record with no team has
/// no ladder to walk and nobody to show it to; this is the queue you work
/// through in the morning to make sure it never happens again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct UnroutedSignal {
    pub id: String,
    pub org_id: String,
    /// Canonical `k=v/k=v` of the dimensions that matched nothing. Empty when
    /// the signal carried no identity dimensions at all — which is itself the
    /// answer to "why did this not route".
    pub path: String,
    /// The dimensions themselves, so the UI can offer "make a rule out of
    /// this" without re-parsing the path.
    pub dimensions: HashMap<String, String>,
    /// How many times a signal on this path has gone unrouted.
    pub occurrences: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    /// The most recent thing that fired here, for the "which alert was this?"
    /// column. Optional because routing is decided before the subject is
    /// known, and the answer is a sample rather than a key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_subject_type: Option<SubjectType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_priority: Option<i32>,
    /// The default team this path landed on, when the org has one nominated.
    ///
    /// `None` means nobody was paged at all. The distinction is the whole
    /// difference between "we have a gap and it is costing us pages" and "we
    /// have a gap and the default team is absorbing it", and an operator
    /// working the queue prioritises the two completely differently.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaulted_team_id: Option<String>,
    /// When somebody said "handled". Dismissed entries stay for the record;
    /// deleting them would lose the evidence that the gap existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<i64>,
}

impl UnroutedSignal {
    /// Still asking to be dealt with.
    pub fn is_open(&self) -> bool {
        self.dismissed_at.is_none()
    }

    /// Whether this gap paged the default team rather than nobody.
    pub fn landed_on_default(&self) -> bool {
        self.defaulted_team_id
            .as_deref()
            .is_some_and(|t| !t.trim().is_empty())
    }

    /// Whether a rule now exists that would have caught this.
    ///
    /// The queue is worked through by adding rules, so an entry that a new
    /// rule covers should stop being shown as outstanding without anybody
    /// having to tick it off. The dimensions are the ones the signal really
    /// carried, so this asks exactly the question routing would ask.
    pub fn is_covered_by(&self, rules: &[OwnershipRule]) -> bool {
        resolve_owner(rules, &self.dimensions).is_some()
    }

    /// One line for the operator: what fired, what nobody claimed, and whether
    /// it woke the default team or nobody at all.
    pub fn describe(&self) -> String {
        let what = match (&self.last_subject_type, &self.last_title) {
            (Some(kind), Some(title)) => format!("{kind} `{title}`"),
            (Some(kind), None) => kind.to_string(),
            _ => "a signal".to_string(),
        };
        let where_ = if self.path.is_empty() {
            format!("{what} carried no identity dimensions, so no ownership rule could match it")
        } else {
            format!("{what} at {} is owned by no team", self.path)
        };
        match self.defaulted_team_id.as_deref() {
            Some(team) if !team.trim().is_empty() => {
                format!("{where_}, so it paged the default team {team}")
            }
            _ => where_,
        }
    }
}

/// The entries still worth an operator's attention: not dismissed, and not
/// already covered by a rule somebody has since added.
pub fn outstanding<'a>(
    signals: &'a [UnroutedSignal],
    rules: &[OwnershipRule],
) -> Vec<&'a UnroutedSignal> {
    signals
        .iter()
        .filter(|s| s.is_open() && !s.is_covered_by(rules))
        .collect()
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
    resolve_owner_ranked(rules, dims, &DimensionDepth::default())
}

/// [`resolve_owner`], told how deep each dimension sits.
///
/// The ranking only ever separates rules that were already tied, so an org that
/// has configured no identity sets still routes exactly as before — except that
/// `service` outranks everything, which is true by definition and needs no
/// configuration to be true.
pub fn resolve_owner_ranked<'a>(
    rules: &'a [OwnershipRule],
    dims: &HashMap<String, String>,
    depths: &DimensionDepth,
) -> Option<&'a OwnershipRule> {
    rules
        .iter()
        .filter(|rule| rule.validate().is_ok() && rule.matches(dims))
        .max_by(|a, b| {
            a.specificity()
                .cmp(&b.specificity())
                // Then how fine the claim is. `{service: payment-gateway}` beats
                // `{k8s-cluster: production}` because a service is a narrower
                // thing than a cluster — not because its name is longer, which
                // is what decided it before this term existed.
                .then_with(|| a.finest_depth(depths).cmp(&b.finest_depth(depths)))
                // Then exactness: §7's "exact beats wildcard at the same depth".
                // A wildcard can therefore never outrank a more specific exact
                // rule, only a shallower one.
                .then_with(|| a.exact_dimensions().cmp(&b.exact_dimensions()))
                .then_with(|| a.literal_chars().cmp(&b.literal_chars()))
                .then_with(|| b.path().cmp(&a.path()))
                .then_with(|| b.id.cmp(&a.id))
        })
}

/// The full routing decision, in the order §5 specifies.
///
/// ```text
/// 1. the source object's own `oncall_team`
/// 2. longest-prefix ownership
/// 3. the nominated default team
/// ```
///
/// Explicit beats discovered: a team that has deliberately set the alert's
/// owner is stating something the dimensions cannot express, and must not be
/// overruled by a rule someone else added later.
///
/// The default tier is last and optional. It is safe to have precisely because
/// nothing creates it: a fresh org has none, and a signal that reaches this
/// point with none configured stays unrouted and visible rather than being
/// handed to a team who never agreed to hold the pager for it.
pub fn route(inputs: &RoutingInputs<'_>) -> Routed {
    if let Some(team_id) = inputs.explicit_team_id.filter(|t| !t.trim().is_empty()) {
        return Routed::plain(RoutingDecision::Explicit {
            team_id: team_id.to_string(),
        });
    }

    let empty = HashMap::new();
    let dims = inputs.dimensions.unwrap_or(&empty);
    let no_depths = DimensionDepth::default();
    let depths = inputs.depths.unwrap_or(&no_depths);
    if let Some(rule) = resolve_owner_ranked(inputs.rules, dims, depths) {
        return Routed::plain(RoutingDecision::Ownership {
            team_id: rule.team_id.clone(),
            rule_id: rule.id.clone(),
            path: rule.path(),
        });
    }

    let notes = vec![uncovered_note(dims)];
    if let Some(team_id) = inputs.default_team_id.filter(|t| !t.trim().is_empty()) {
        return Routed {
            decision: RoutingDecision::Default {
                team_id: team_id.to_string(),
            },
            notes,
        };
    }

    Routed {
        decision: RoutingDecision::Unrouted,
        notes,
    }
}

/// What nobody claimed, named — so "why did this land on the catch-all" is a
/// task rather than a mystery.
///
/// Sorted because the note goes on a timeline that people compare across
/// firings, and a `HashMap`'s order would make one identity read as several.
fn uncovered_note(dims: &HashMap<String, String>) -> String {
    if dims.is_empty() {
        return "this signal carried no dimensions, so no ownership rule could match it"
            .to_string();
    }
    let mut named: Vec<String> = dims.iter().map(|(k, v)| format!("{k}={v}")).collect();
    named.sort();
    format!("no ownership rule covers {}", named.join(", "))
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

    /// The custom-SQL case, which is the one routing is worst at.
    ///
    /// An aggregation — `SELECT count(*) … ` with no `GROUP BY`, a join, a
    /// query that selects only the columns it alerts on — produces a result row
    /// with **no identity fields**, so extraction yields nothing and no
    /// ownership rule can match. It should be rare, and when it happens the
    /// page lands on the default team or the unrouted queue for an alert whose
    /// service the incident path has already identified from the registry.
    ///
    /// This pins the contract the fallback depends on: a rule written on the
    /// canonical `service` dimension catches a signal routed by service alone.
    /// If `SERVICE_DIMENSION` and the semantic group's id ever drift apart,
    /// this fails — which is the point of naming it once.
    #[test]
    fn test_a_signal_identified_only_by_service_still_finds_its_owner() {
        let rules = vec![
            rule(
                "r_deep",
                "team_commerce",
                &[
                    ("k8s-cluster", "eks-us-prod"),
                    ("k8s-namespace", "commerce"),
                ],
            ),
            rule(
                "r_service",
                "team_payments",
                &[(SERVICE_DIMENSION, "payments-gateway")],
            ),
        ];

        // What the fallback produces when the row carried nothing: the service
        // the incident correlated to, and only that.
        let only_service = dims(&[(SERVICE_DIMENSION, "payments-gateway")]);
        assert_eq!(
            resolve_owner(&rules, &only_service).map(|r| r.team_id.as_str()),
            Some("team_payments"),
            "a service-only signal must reach the team that owns that service"
        );

        // And the empty case it replaces — the reason the fallback exists.
        assert_eq!(
            resolve_owner(&rules, &dims(&[])),
            None,
            "with no dimensions at all nothing can match, which is where these \
             alerts used to land"
        );

        // A row that does carry identity is unaffected: the fallback only ever
        // fires when extraction produced nothing, so no existing alert moves.
        let rich = dims(&[
            ("k8s-cluster", "eks-us-prod"),
            ("k8s-namespace", "commerce"),
            (SERVICE_DIMENSION, "checkout-api"),
        ]);
        assert_eq!(
            resolve_owner(&rules, &rich).map(|r| r.team_id.as_str()),
            Some("team_commerce"),
            "the more specific path still wins"
        );
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

    mod hierarchy {
        use super::*;

        fn k8s_depths() -> DimensionDepth {
            DimensionDepth::from_sets([
                ["k8s-cluster".to_string(), "k8s-namespace".to_string()].as_slice()
            ])
        }

        /// The scenario the ranking exists for. A platform team owns a whole
        /// cluster; a product team owns one service wherever it runs. Both
        /// rules pin one dimension, so before the depth term the winner was
        /// whichever value had more characters.
        #[test]
        fn test_a_service_rule_beats_a_cluster_rule_at_equal_specificity() {
            let rules = vec![
                rule("r_cluster", "platform", &[("k8s-cluster", "production")]),
                rule("r_svc", "payments", &[("service", "payment-gateway")]),
            ];
            let record = dims(&[
                ("k8s-cluster", "production"),
                ("service", "payment-gateway"),
            ]);
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &k8s_depths())
                    .unwrap()
                    .team_id,
                "payments",
            );
        }

        /// The same estate after somebody renames the cluster. `literal_chars`
        /// alone put the cluster ahead here — the platform team quietly started
        /// taking payment-gateway pages, and nothing in the config had changed
        /// about ownership.
        #[test]
        fn test_renaming_a_cluster_does_not_move_a_service_to_another_team() {
            let rules = vec![
                rule(
                    "r_cluster",
                    "platform",
                    &[("k8s-cluster", "production-us-east-1-primary")],
                ),
                rule("r_svc", "payments", &[("service", "payment-gateway")]),
            ];
            let record = dims(&[
                ("k8s-cluster", "production-us-east-1-primary"),
                ("service", "payment-gateway"),
            ]);
            assert!(
                rule("x", "_", &[("k8s-cluster", "production-us-east-1-primary")]).literal_chars()
                    > rule("y", "_", &[("service", "payment-gateway")]).literal_chars(),
                "the cluster name is the longer string — the pre-ranking tie-break",
            );
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &k8s_depths())
                    .unwrap()
                    .team_id,
                "payments",
            );
        }

        /// Depth ranks within a set too, from the order the org wrote.
        #[test]
        fn test_a_namespace_rule_beats_a_cluster_rule() {
            let rules = vec![
                rule("r_cluster", "platform", &[("k8s-cluster", "production")]),
                rule("r_ns", "search", &[("k8s-namespace", "search")]),
            ];
            let record = dims(&[("k8s-cluster", "production"), ("k8s-namespace", "search")]);
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &k8s_depths())
                    .unwrap()
                    .team_id,
                "search",
            );
        }

        /// Count still comes first. A rule naming cluster AND namespace is a
        /// narrower claim than one naming a service, however deep `service` is.
        #[test]
        fn test_specificity_still_outranks_depth() {
            let rules = vec![
                rule(
                    "r_pair",
                    "platform",
                    &[("k8s-cluster", "production"), ("k8s-namespace", "payments")],
                ),
                rule("r_svc", "payments", &[("service", "payment-gateway")]),
            ];
            let record = dims(&[
                ("k8s-cluster", "production"),
                ("k8s-namespace", "payments"),
                ("service", "payment-gateway"),
            ]);
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &k8s_depths())
                    .unwrap()
                    .team_id,
                "platform",
            );
        }

        /// An org that never described its topology still gets the case that
        /// matters, because `service` is finest by definition rather than by
        /// configuration.
        #[test]
        fn test_service_outranks_without_any_configured_sets() {
            let rules = vec![
                rule("r_cluster", "platform", &[("k8s-cluster", "production")]),
                rule("r_svc", "payments", &[("service", "payment-gateway")]),
            ];
            let record = dims(&[
                ("k8s-cluster", "production"),
                ("service", "payment-gateway"),
            ]);
            assert!(DimensionDepth::default().is_empty());
            assert_eq!(
                resolve_owner(&rules, &record).unwrap().team_id,
                "payments",
                "the unranked entry point has to agree, or the two disagree by default",
            );
        }

        /// Within one depth, exactness decides — the rule the depth term was
        /// inserted ahead of, still intact.
        #[test]
        fn test_exact_still_beats_wildcard_at_the_same_depth() {
            let rules = vec![
                rule("r_exact", "payments", &[("service", "payment-gateway")]),
                rule("r_glob", "platform", &[("service", "payment-*")]),
            ];
            let record = dims(&[("service", "payment-gateway")]);
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &k8s_depths())
                    .unwrap()
                    .team_id,
                "payments",
            );
        }

        /// A dimension no set mentions cannot outrank one that is part of the
        /// topology somebody described.
        #[test]
        fn test_an_undescribed_dimension_ranks_coarsest() {
            let depths = k8s_depths();
            assert_eq!(depths.rank_of("unheard-of"), 0);
            assert!(depths.rank_of("k8s-cluster") > depths.rank_of("unheard-of"));
            assert!(depths.rank_of("k8s-namespace") > depths.rank_of("k8s-cluster"));
            assert!(depths.rank_of("service") > depths.rank_of("k8s-namespace"));
        }

        /// The mis-route the shipped ordering exists to stop.
        ///
        /// "Platform owns the prod-use1 cluster" and "Data owns the kafka
        /// namespace" are both one-dimension claims, so before this they tied on
        /// every meaningful term and fell through to literal character count:
        /// `prod-use1` is nine characters and `kafka` is five, so Platform won.
        /// `monitoring` — ten characters — beat the same cluster and went to the
        /// right team, which is what made the failure so hard to see.
        #[test]
        fn test_the_shipped_ordering_stops_word_length_deciding_who_is_paged() {
            let rules = vec![
                rule("r_cluster", "platform", &[("k8s-cluster", "prod-use1")]),
                rule("r_kafka", "data", &[("k8s-namespace", "kafka")]),
            ];
            let record = dims(&[("k8s-cluster", "prod-use1"), ("k8s-namespace", "kafka")]);

            assert_eq!(
                resolve_owner_ranked(&rules, &record, &DimensionDepth::default())
                    .unwrap()
                    .team_id,
                "platform",
                "unranked, the longer word wins — this is the bug",
            );
            assert_eq!(
                resolve_owner_ranked(&rules, &record, &DimensionDepth::shipped_default())
                    .unwrap()
                    .team_id,
                "data",
                "a namespace is inside a cluster, whatever the names happen to be",
            );
        }

        /// Every platform the shipped groups can identify gets an ordering, not
        /// just Kubernetes — an ECS task, a Lambda and a Cloud Run service each
        /// rank below the region they run in.
        #[test]
        fn test_the_shipped_ordering_covers_every_platform() {
            let d = DimensionDepth::shipped_default();
            for (coarse, fine) in [
                ("k8s-cluster", "k8s-namespace"),
                ("k8s-namespace", "k8s-deployment"),
                ("region", "availability-zone"),
                ("availability-zone", "aws-ecs-cluster"),
                ("aws-ecs-cluster", "aws-ecs-task"),
                ("region", "faas-name"),
                ("region", "azure-resource-group"),
                ("azure-resource-group", "azure-cloud-role"),
                ("region", "gcp-cloud-run"),
            ] {
                assert!(
                    d.rank_of(fine) > d.rank_of(coarse),
                    "{fine} should sit inside {coarse}",
                );
            }
            assert!(
                d.rank_of("service") > d.rank_of("k8s-deployment"),
                "service is finest by definition",
            );
            // Left unranked on purpose: ranking `host` finer than a namespace
            // would make a node claim beat a namespace claim on every k8s
            // signal, which nobody has asked for.
            assert_eq!(d.rank_of("host"), 0);
            assert_eq!(d.rank_of("environment"), 0);
        }

        /// Sets are ranked independently. An ECS task and a Kubernetes
        /// namespace never appear on one record, and giving them a shared scale
        /// would invent an ordering between two things that never meet.
        #[test]
        fn test_sets_are_ranked_independently() {
            let depths = DimensionDepth::from_sets([
                ["ecs-task".to_string()].as_slice(),
                ["k8s-cluster".to_string(), "k8s-namespace".to_string()].as_slice(),
            ]);
            assert_eq!(depths.rank_of("ecs-task"), depths.rank_of("k8s-cluster"));
            assert!(depths.rank_of("k8s-namespace") > depths.rank_of("ecs-task"));
        }
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

        let r = rule("r", "t", &[("k8s-cluster", "  ")]);
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

    /// The one place the whole resolution order is stated as a table.
    ///
    /// Exhaustive over the three independent switches — the object names a team
    /// or does not, ownership matches or does not, a default team is nominated
    /// or is not — because the bug this feature is most likely to grow is a
    /// tier quietly moving past another one, and that is invisible unless every
    /// combination is written down beside the tier that is supposed to win.
    #[test]
    fn test_the_resolution_order_over_every_combination() {
        let rules = vec![rule("r_prod", "platform", &[("k8s-cluster", "prod")])];
        let matching = dims(&[("k8s-cluster", "prod")]);
        let missing = dims(&[("k8s-cluster", "staging")]);

        // (explicit set, ownership matches, default set) → the winning tier,
        // and a fragment of the sentence the timeline has to carry.
        let cases: [(bool, bool, bool, RoutingDecision, &str); 8] = [
            (
                true,
                true,
                true,
                RoutingDecision::Explicit {
                    team_id: "chosen".into(),
                },
                "alert's own setting",
            ),
            (
                true,
                true,
                false,
                RoutingDecision::Explicit {
                    team_id: "chosen".into(),
                },
                "alert's own setting",
            ),
            (
                true,
                false,
                true,
                RoutingDecision::Explicit {
                    team_id: "chosen".into(),
                },
                "alert's own setting",
            ),
            (
                true,
                false,
                false,
                RoutingDecision::Explicit {
                    team_id: "chosen".into(),
                },
                "alert's own setting",
            ),
            (
                false,
                true,
                true,
                RoutingDecision::Ownership {
                    team_id: "platform".into(),
                    rule_id: "r_prod".into(),
                    path: "k8s-cluster=prod".into(),
                },
                "ownership rule k8s-cluster=prod",
            ),
            (
                false,
                true,
                false,
                RoutingDecision::Ownership {
                    team_id: "platform".into(),
                    rule_id: "r_prod".into(),
                    path: "k8s-cluster=prod".into(),
                },
                "ownership rule k8s-cluster=prod",
            ),
            (
                false,
                false,
                true,
                RoutingDecision::Default {
                    team_id: "catch-all".into(),
                },
                "no ownership rule matched, so it went to the default team catch-all",
            ),
            (
                false,
                false,
                false,
                RoutingDecision::Unrouted,
                "no team was paged",
            ),
        ];

        for (explicit, owned, defaulted, want, sentence) in cases {
            let dimensions = if owned { &matching } else { &missing };
            let routed = route(&RoutingInputs {
                explicit_team_id: explicit.then_some("chosen"),
                rules: &rules,
                dimensions: Some(dimensions),
                default_team_id: defaulted.then_some("catch-all"),
                depths: None,
            });
            let label = format!("explicit={explicit} owned={owned} default={defaulted}");
            assert_eq!(routed.decision, want, "{label}");
            assert!(
                routed.reason().contains(sentence),
                "{label}: reason `{}` does not say `{sentence}`",
                routed.reason()
            );
        }
    }

    /// A team that deliberately set the alert's owner is stating something the
    /// dimensions cannot express, and must not be overruled by a rule somebody
    /// else adds later — nor by a default somebody nominated later still.
    #[test]
    fn test_explicit_beats_a_matching_ownership_rule() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let routed = route(&RoutingInputs {
            explicit_team_id: Some("chosen-team"),
            rules: &rules,
            dimensions: Some(&dims(&[("k8s-cluster", "prod")])),
            default_team_id: Some("catch-all"),
            ..Default::default()
        });
        assert_eq!(
            routed.decision,
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
            let routed = route(&RoutingInputs {
                explicit_team_id: blank,
                rules: &rules,
                dimensions: Some(&dims(&[("k8s-cluster", "prod")])),
                ..Default::default()
            });
            assert_eq!(routed.team_id(), Some("platform"), "blank={blank:?}");
        }
    }

    /// A blank default is an unset setting, not a team named "". Otherwise
    /// clearing the field by sending `""` would route every unclaimed page at a
    /// team id that cannot exist.
    #[test]
    fn test_a_blank_default_team_is_unset() {
        for blank in [Some(""), Some("   "), None] {
            let routed = route(&RoutingInputs {
                default_team_id: blank,
                ..Default::default()
            });
            assert_eq!(
                routed.decision,
                RoutingDecision::Unrouted,
                "blank={blank:?}"
            );
        }
    }

    /// The catch-all is last, and it only exists because somebody nominated it.
    /// With none nominated a signal no rule claims stays unrouted and visible —
    /// which is what makes the tier safe to have at all.
    #[test]
    fn test_the_default_team_catches_only_what_nothing_else_claimed() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];

        let owned = route(&RoutingInputs {
            rules: &rules,
            dimensions: Some(&dims(&[("k8s-cluster", "prod")])),
            default_team_id: Some("catch-all"),
            ..Default::default()
        });
        assert_eq!(owned.team_id(), Some("platform"));
        assert!(!owned.landed_on_default());

        let unclaimed = route(&RoutingInputs {
            rules: &rules,
            dimensions: Some(&dims(&[("k8s-cluster", "staging")])),
            default_team_id: Some("catch-all"),
            ..Default::default()
        });
        assert_eq!(unclaimed.team_id(), Some("catch-all"));
        assert!(unclaimed.landed_on_default());

        let no_default = route(&RoutingInputs {
            rules: &rules,
            dimensions: Some(&dims(&[("k8s-cluster", "staging")])),
            ..Default::default()
        });
        assert_eq!(no_default.decision, RoutingDecision::Unrouted);
    }

    /// A signal with no dimensions at all cannot match a rule — an empty rule
    /// is refused — so the default team is the only thing between it and the
    /// queue. §10's "no identity dimensions" row.
    #[test]
    fn test_a_signal_with_no_dimensions_still_reaches_the_default_team() {
        let routed = route(&RoutingInputs {
            default_team_id: Some("catch-all"),
            ..Default::default()
        });
        assert_eq!(routed.team_id(), Some("catch-all"));
    }

    /// An unroutable signal must be a visible outcome, not a silent drop — and
    /// its reason must say that the absence of a default team is part of why.
    #[test]
    fn test_unrouted_is_a_value_with_a_reason() {
        let routed = route(&RoutingInputs::default());
        assert!(!routed.is_routed());
        assert_eq!(routed.team_id(), None);
        assert!(routed.reason().contains("no team was paged"));
        assert!(routed.reason().contains("no default team is set"));
    }

    /// "Nothing owns this" is a task somebody can act on only if the note says
    /// what nothing owns. Landing on the catch-all says it too: otherwise the
    /// gap disappears the moment an org nominates one.
    #[test]
    fn test_an_uncovered_signal_names_what_nothing_covers() {
        let uncovered = dims(&[("k8s-cluster", "prod"), ("service", "zxporter")]);

        let queued = route(&RoutingInputs {
            dimensions: Some(&uncovered),
            ..Default::default()
        });
        assert_eq!(
            queued.notes,
            vec!["no ownership rule covers k8s-cluster=prod, service=zxporter"],
            "sorted, so one identity reads the same on every firing"
        );

        let defaulted = route(&RoutingInputs {
            dimensions: Some(&uncovered),
            default_team_id: Some("catch-all"),
            ..Default::default()
        });
        assert_eq!(defaulted.notes, queued.notes);
        assert!(defaulted.reason().contains("service=zxporter"));

        assert_eq!(
            route(&RoutingInputs::default()).notes,
            vec!["this signal carried no dimensions, so no ownership rule could match it"]
        );

        let owned = route(&RoutingInputs {
            rules: &[rule("r", "platform", &[("k8s-cluster", "prod")])],
            dimensions: Some(&uncovered),
            ..Default::default()
        });
        assert!(
            owned.notes.is_empty(),
            "a rule matched; nothing is uncovered"
        );
    }

    /// The reason is written to the timeline, so "why was I paged" is
    /// answerable without re-deriving the decision. Every tier names its team
    /// and its mechanism in prose — never a rule id on its own.
    #[test]
    fn test_every_decision_explains_itself() {
        let rules = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        let ownership = route(&RoutingInputs {
            rules: &rules,
            dimensions: Some(&dims(&[("k8s-cluster", "prod")])),
            ..Default::default()
        });
        assert!(ownership.reason().contains("k8s-cluster=prod"));
        assert!(ownership.reason().contains("platform"));

        assert!(
            route(&RoutingInputs {
                explicit_team_id: Some("t"),
                ..Default::default()
            })
            .reason()
            .contains("alert's own setting")
        );
        assert!(
            route(&RoutingInputs::default())
                .reason()
                .contains("no ownership rule matches")
        );

        // The default tier's line is the one §5 dictates the shape of: it names
        // the team, not the absent rule.
        let defaulted = route(&RoutingInputs {
            default_team_id: Some("Platform"),
            ..Default::default()
        });
        assert_eq!(
            defaulted.decision.reason(),
            "no ownership rule matched, so it went to the default team Platform"
        );
        assert!(!defaulted.reason().contains("rule_id"));
    }

    // ── Trailing wildcards (§7) ─────────────────────────────────────────────

    /// The case §7 exists for: numbered hosts on a deployment with no
    /// namespaces. One rule owns the family instead of one rule per box.
    #[test]
    fn test_a_trailing_wildcard_owns_the_prefix_subtree() {
        let rules = vec![rule(
            "r_db",
            "dba",
            &[("environment", "prod"), ("host", "db-*")],
        )];
        for host in ["db-01", "db-02", "db-primary", "db-"] {
            assert_eq!(
                resolve_owner(&rules, &dims(&[("environment", "prod"), ("host", host)]))
                    .map(|r| r.team_id.as_str()),
                Some("dba"),
                "host={host}"
            );
        }
        // The prefix is literal: a host that merely contains it does not match.
        assert!(
            resolve_owner(
                &rules,
                &dims(&[("environment", "prod"), ("host", "web-db-01")])
            )
            .is_none()
        );
        // And the other pinned dimension still has to hold.
        assert!(
            resolve_owner(
                &rules,
                &dims(&[("environment", "staging"), ("host", "db-01")])
            )
            .is_none()
        );
    }

    /// §7: "Exact beats wildcard at the same depth." A team that named one host
    /// meant that host, and must not be overruled by the family rule.
    #[test]
    fn test_an_exact_match_outranks_a_wildcard_at_the_same_depth() {
        let rules = vec![
            rule(
                "r_family",
                "dba",
                &[("environment", "prod"), ("host", "db-*")],
            ),
            rule(
                "r_one",
                "payments",
                &[("environment", "prod"), ("host", "db-07")],
            ),
        ];
        assert_eq!(
            resolve_owner(&rules, &dims(&[("environment", "prod"), ("host", "db-07")]))
                .unwrap()
                .team_id,
            "payments"
        );
        assert_eq!(
            resolve_owner(&rules, &dims(&[("environment", "prod"), ("host", "db-08")]))
                .unwrap()
                .team_id,
            "dba"
        );
    }

    /// Depth still dominates: a deeper wildcard rule is a narrower claim than a
    /// shallower exact one, exactly as `production/payments` beats `production`.
    #[test]
    fn test_depth_still_beats_exactness() {
        let rules = vec![
            rule("r_env", "ops", &[("environment", "prod")]),
            rule(
                "r_hosts",
                "dba",
                &[("environment", "prod"), ("host", "db-*")],
            ),
        ];
        assert_eq!(
            resolve_owner(&rules, &dims(&[("environment", "prod"), ("host", "db-01")]))
                .unwrap()
                .team_id,
            "dba"
        );
        assert_eq!(
            resolve_owner(
                &rules,
                &dims(&[("environment", "prod"), ("host", "web-01")])
            )
            .unwrap()
            .team_id,
            "ops"
        );
    }

    /// Between two wildcards the longer literal prefix is the narrower claim.
    #[test]
    fn test_the_longer_wildcard_prefix_wins() {
        let rules = vec![
            rule("r_db", "dba", &[("host", "db-*")]),
            rule("r_db_prod", "payments", &[("host", "db-prod-*")]),
        ];
        assert_eq!(
            resolve_owner(&rules, &dims(&[("host", "db-prod-01")]))
                .unwrap()
                .team_id,
            "payments"
        );
        assert_eq!(
            resolve_owner(&rules, &dims(&[("host", "db-stage-01")]))
                .unwrap()
                .team_id,
            "dba"
        );
    }

    /// A bare `*` is a catch-all wearing a dimension name, and a `*` in the
    /// middle is somebody reaching for a pattern language this is not. Both are
    /// refused at the door, and the resolver skips them if one ever gets past.
    #[test]
    fn test_wildcards_that_are_not_a_trailing_prefix_are_refused() {
        let bare = rule("r", "everyone", &[("k8s-cluster", "*")]);
        assert_eq!(
            bare.validate(),
            Err(OwnershipError::WildcardMatchesEverything(
                "k8s-cluster".into()
            ))
        );
        assert!(resolve_owner(&[bare], &dims(&[("k8s-cluster", "prod")])).is_none());

        let interior = rule("r", "t", &[("host", "db-*-01")]);
        assert_eq!(
            interior.validate(),
            Err(OwnershipError::WildcardNotTrailing("host".into()))
        );
        assert!(resolve_owner(&[interior], &dims(&[("host", "db-x-01")])).is_none());
    }

    /// The queue is worked by writing the rule that was missing, so a wildcard
    /// rule has to retire the entry that asked for it.
    #[test]
    fn test_a_wildcard_rule_covers_the_queue_entries_it_should() {
        let mut entry = unrouted("host=db-04", &[("host", "db-04")]);
        entry.defaulted_team_id = None;
        assert!(entry.is_covered_by(&[rule("r", "dba", &[("host", "db-*")])]));
        assert!(!entry.is_covered_by(&[rule("r", "dba", &[("host", "web-*")])]));
    }

    fn unrouted(path: &str, pairs: &[(&str, &str)]) -> UnroutedSignal {
        UnroutedSignal {
            id: "unr_1".into(),
            org_id: "default".into(),
            path: path.to_string(),
            dimensions: dims(pairs),
            occurrences: 3,
            first_seen_at: 10,
            last_seen_at: 20,
            last_subject_type: Some(crate::meta::oncall::SubjectType::Alert),
            last_source_id: Some("al_ckt".into()),
            last_title: Some("payment_gateway_error_rate".into()),
            last_priority: Some(2),
            defaulted_team_id: None,
            dismissed_at: None,
        }
    }

    /// The queue's whole purpose: an operator can see what fired, on which
    /// dimensions, and how often — which is everything needed to write the
    /// missing rule. A log line answers none of those.
    #[test]
    fn test_an_unrouted_entry_names_what_fired_and_what_matched_nothing() {
        let s = unrouted(
            "k8s-cluster=prod/k8s-namespace=search",
            &[("k8s-cluster", "prod"), ("k8s-namespace", "search")],
        );
        assert!(s.is_open());
        assert!(s.describe().contains("payment_gateway_error_rate"));
        assert!(s.describe().contains("k8s-namespace=search"));
        assert_eq!(s.occurrences, 3);
    }

    /// A signal with no identity dimensions cannot match any rule — an empty
    /// rule is refused — so the queue has to say that rather than showing a
    /// blank path and leaving the operator to guess.
    #[test]
    fn test_a_signal_with_no_dimensions_says_so() {
        let mut s = unrouted("", &[]);
        s.last_title = None;
        assert!(s.describe().contains("no identity dimensions"));
        assert!(!s.is_covered_by(&[rule("r", "platform", &[("k8s-cluster", "prod")])]));
    }

    /// The queue is worked through by adding rules, so an entry a new rule
    /// covers drops off it without anybody ticking it off by hand.
    #[test]
    fn test_an_entry_stops_being_outstanding_once_a_rule_covers_it() {
        let s = unrouted(
            "k8s-cluster=prod/k8s-namespace=search",
            &[("k8s-cluster", "prod"), ("k8s-namespace", "search")],
        );
        let signals = vec![s];

        assert_eq!(outstanding(&signals, &[]).len(), 1);
        let covering = vec![rule("r", "platform", &[("k8s-cluster", "prod")])];
        assert!(signals[0].is_covered_by(&covering));
        assert!(outstanding(&signals, &covering).is_empty());

        let unrelated = vec![rule("r", "platform", &[("k8s-cluster", "staging")])];
        assert_eq!(outstanding(&signals, &unrelated).len(), 1);
    }

    /// Dismissing is not deleting: the entry stops being outstanding, and the
    /// evidence that the gap existed survives.
    #[test]
    fn test_a_dismissed_entry_is_kept_but_not_outstanding() {
        let mut s = unrouted("k8s-cluster=prod", &[("k8s-cluster", "prod")]);
        s.dismissed_at = Some(99);
        assert!(!s.is_open());
        assert!(outstanding(&[s], &[]).is_empty());
    }

    /// The queue's path and a rule's path have to be spelled identically, or
    /// "add a rule for this" produces one that does not obviously match.
    #[test]
    fn test_an_unrouted_path_is_spelled_the_way_a_rule_is() {
        let pairs = [("k8s-namespace", "payments"), ("k8s-cluster", "prod")];
        assert_eq!(
            canonical_path(&dims(&pairs)),
            rule("r", "t", &pairs).path(),
            "the queue and the rules must agree on the canonical spelling"
        );
        assert_eq!(canonical_path(&dims(&[])), "");
    }

    #[test]
    fn test_unrouted_entry_round_trips_through_json() {
        let s = unrouted("k8s-cluster=prod", &[("k8s-cluster", "prod")]);
        let back: UnroutedSignal =
            serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back, s);
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
            RoutingDecision::Default {
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

    /// §4's "Assign next" surface: the queue has to be able to say which gaps
    /// paged the default team, because those are the ones costing somebody
    /// sleep — and which paged nobody, because those are the ones costing
    /// nothing until they cost everything.
    #[test]
    fn test_a_defaulted_entry_is_distinguishable_from_an_unowned_one() {
        let mut nobody = unrouted(
            "k8s-cluster=prod/k8s-namespace=search",
            &[("k8s-cluster", "prod"), ("k8s-namespace", "search")],
        );
        nobody.defaulted_team_id = None;
        assert!(!nobody.landed_on_default());
        assert!(!nobody.describe().contains("default team"));
        assert!(nobody.describe().contains("owned by no team"));

        let mut defaulted = nobody.clone();
        defaulted.defaulted_team_id = Some("platform".into());
        assert!(defaulted.landed_on_default());
        assert!(
            defaulted
                .describe()
                .contains("paged the default team platform")
        );
        // Still a gap, and still outstanding: the default team absorbing it is
        // not the same as somebody having claimed it.
        assert_eq!(outstanding(&[defaulted], &[]).len(), 1);
    }

    /// A queue row written before the column existed reads as "nobody was
    /// paged", which is exactly what it meant.
    #[test]
    fn test_an_entry_without_the_default_field_round_trips_as_unrouted() {
        let legacy = r#"{"id":"u","org_id":"default","path":"","dimensions":{},
            "occurrences":1,"first_seen_at":1,"last_seen_at":1}"#;
        let s: UnroutedSignal = serde_json::from_str(legacy).unwrap();
        assert_eq!(s.defaulted_team_id, None);
        assert!(!s.landed_on_default());
    }

    /// A fresh org has no default. The type has to say so without a row, or
    /// every read path grows a "no row means what, exactly?" branch.
    #[test]
    fn test_an_org_with_no_row_reads_as_having_no_default() {
        let unset = RoutingConfig::unset("default");
        assert_eq!(unset.default_team_id, None);
        assert!(!unset.has_default());

        let blank = RoutingConfig {
            default_team_id: Some("  ".into()),
            ..RoutingConfig::unset("default")
        };
        assert!(!blank.has_default(), "whitespace is not a team id");

        let set = RoutingConfig {
            org_id: "default".into(),
            default_team_id: Some("team_1".into()),
            updated_at: 42,
        };
        assert!(set.has_default());
        let back: RoutingConfig =
            serde_json::from_str(&serde_json::to_string(&set).unwrap()).unwrap();
        assert_eq!(back, set);
    }
}
