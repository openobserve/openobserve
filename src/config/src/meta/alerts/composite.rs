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

//! Composite alert data model.
//!
//! A composite alert is a single self-scheduled alert that owns an ordered set
//! of named terms. Each term is a self-contained `(query + own threshold)` that
//! evaluates to a tri-state (`TRUE` / `FALSE` / `ERROR`) in one shared tick over
//! one shared window; a boolean expression over the term names decides firing.
//!
//! See `designs/alerts/composite-alerts/UNIFIED-HARDENED-DESIGN.md`.
//!
//! NOTE: These types are the persisted/serialized shape and live in core so that
//! serde/persistence is uniform across builds. The evaluation, Kleene logic,
//! Pratt parser and scheduler branch are enterprise-gated (see the
//! `enterprise` crate). The columns/spec exist in all builds; the composite
//! feature is only wired up in the enterprise edition.

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

use super::{Operator, QueryCondition};
use crate::meta::stream::StreamType;

/// Maximum number of terms a single composite may own. Enforced at save-time
/// validation (not at eval). Bounds per-tick query fan-out (§4.1/§7).
pub const MAX_TERMS: usize = 10;

/// The composite specification carried by an [`super::alert::Alert`]. When
/// present, the alert is a composite alert.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompositeSpec {
    /// Ordered set of named terms. Must be `2..=MAX_TERMS` (validated at save).
    pub terms: Vec<CompositeTerm>,
    /// Boolean expression over term names, e.g. `"(a && b) || c"`. Parsed and
    /// validated at save-time; evaluated with three-valued (Kleene) logic.
    pub expression: String,
    /// Where composite / per-term notifications are routed.
    pub notify: CompositeNotify,
    /// Policy applied when the expression evaluates to `ERROR` (§2.2).
    #[serde(default)]
    pub on_error: OnErrorPolicy,
}

/// A single term of a composite alert. A term is exactly a standalone alert's
/// condition pair: a query plus its own threshold, evaluating to a tri-state.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompositeTerm {
    /// Term identifier, `[a-z0-9_]`, unique within the composite. Referenced by
    /// the expression and by namespaced template variables (`{name.value}`).
    pub name: String,

    /// The stream type this term queries. A composite's terms may hit different
    /// streams, so each term carries its own.
    #[serde(default)]
    pub stream_type: StreamType,

    /// Required for Custom terms (else `evaluate_scheduled` no-ops → silent
    /// FALSE); SQL/PromQL terms derive the stream from the query.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,

    /// The term's query. Custom | SQL | PromQL — any mode. The pass/fail lives
    /// where a single alert's does:
    ///  - Custom/count term: `conditions` + the `operator`/`threshold` below.
    ///  - Aggregate term: `aggregation` (the threshold is inside the SQL HAVING,
    ///    NOT in `operator`/`threshold`).
    pub query_condition: QueryCondition,

    /// Count-path threshold operator (mirrors a single alert's
    /// `TriggerCondition.operator`). Ignored for aggregate terms.
    #[serde(default)]
    pub operator: Operator,

    /// Count-path threshold. Compared to the row count. Ignored for aggregate
    /// terms (their threshold is inside the HAVING).
    #[serde(default)]
    pub threshold: i64,

    /// How this term's definition is sourced. Phase 1 ships only `Inline`; the
    /// enum is the forward-compat hinge to composable entities (§10.5).
    #[serde(default)]
    pub source: TermSource,

    /// Optional per-term `{name.rows[..]}` rendering template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_template: Option<String>,
}

/// How a term's definition is sourced. Phase 1 ships only [`TermSource::Inline`];
/// `RefCopy` and `RefLive` are the incremental path to composable entities
/// (§10.5 / §10.6). Designed in from day one to avoid a Phase-2 rewrite.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TermSource {
    /// Phase 1. Query + threshold live inline on the [`CompositeTerm`].
    #[default]
    Inline,
    /// Phase 2. Materialized by COPYING an existing alert's query+threshold at
    /// save time. Drifts if the source is retuned; no runtime dependency.
    RefCopy {
        #[schema(value_type = String)]
        alert_id: Ksuid,
    },
    /// Phase 2/3. A LIVE reference to a real alert with an explicit eval mode.
    RefLive {
        #[schema(value_type = String)]
        alert_id: Ksuid,
        #[serde(default)]
        mode: RefLiveMode,
    },
}

/// Evaluation mode for a [`TermSource::RefLive`] term (§10.6).
#[derive(Clone, Copy, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum RefLiveMode {
    /// Re-run the source's current query over the shared window. Safe default
    /// (Phase 2): inline cost/correctness, recovers G1.
    #[default]
    ReRun,
    /// Read the source alert's last computed scheduler result; issues 0 queries.
    /// Powerful (Phase 3): recovers G1+G3+G4 but re-imports staleness hardening.
    ReadLast,
}

/// Notification routing for a composite alert.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
pub struct CompositeNotify {
    /// Destinations notified when the expression evaluates to `TRUE`.
    #[serde(default)]
    pub on_composite: Vec<String>,
    /// Per-term destinations: `term name -> destinations`. A term absent here
    /// (or empty) is aggregate-only. Fires only when that term is `TRUE`.
    #[serde(default)]
    pub on_term: HashMap<String, Vec<String>>,
}

/// Policy applied when a composite's expression evaluates to `ERROR` (§2.2).
/// The ERROR is always recorded in trigger history regardless of policy; this
/// only controls whether a notification is emitted.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, ToSchema, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum OnErrorPolicy {
    /// Default. Do not fire the composite, but record the ERROR in trigger
    /// history so it is never silent.
    #[default]
    Suppress,
    /// Treat ERROR like a fire to the composite destinations (health signal) so
    /// the operator learns the composite could not evaluate.
    Notify,
}

impl CompositeSpec {
    /// Returns the term with the given name, if any.
    pub fn term(&self, name: &str) -> Option<&CompositeTerm> {
        self.terms.iter().find(|t| t.name == name)
    }
}

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike;

    use super::*;

    #[test]
    fn test_defaults() {
        assert_eq!(TermSource::default(), TermSource::Inline);
        assert_eq!(RefLiveMode::default(), RefLiveMode::ReRun);
        assert_eq!(OnErrorPolicy::default(), OnErrorPolicy::Suppress);
    }

    #[test]
    fn test_on_error_defaults_when_absent() {
        // A spec without `on_error` deserializes to Suppress.
        let json = r#"{
            "terms": [],
            "expression": "a",
            "notify": { "on_composite": ["slack"] }
        }"#;
        let spec: CompositeSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.on_error, OnErrorPolicy::Suppress);
        assert!(spec.notify.on_term.is_empty());
    }

    #[test]
    fn test_term_source_roundtrip() {
        // Inline serializes as a bare string.
        let inline = serde_json::to_value(TermSource::Inline).unwrap();
        assert_eq!(inline, serde_json::json!("inline"));

        // Data-carrying variants round-trip.
        let id: Ksuid = Ksuid::new(None, None);
        let live = TermSource::RefLive {
            alert_id: id,
            mode: RefLiveMode::ReadLast,
        };
        let s = serde_json::to_string(&live).unwrap();
        let back: TermSource = serde_json::from_str(&s).unwrap();
        assert_eq!(live, back);
    }

    #[test]
    fn test_ref_live_mode_defaults_when_absent() {
        // A ref_live without an explicit mode defaults to ReRun.
        let id: Ksuid = Ksuid::new(None, None);
        let json = format!(r#"{{"ref_live":{{"alert_id":"{id}"}}}}"#);
        let parsed: TermSource = serde_json::from_str(&json).unwrap();
        match parsed {
            TermSource::RefLive { mode, .. } => assert_eq!(mode, RefLiveMode::ReRun),
            _ => panic!("expected ref_live"),
        }
    }

    #[test]
    fn test_term_lookup() {
        let spec = CompositeSpec {
            terms: vec![CompositeTerm {
                name: "a".to_string(),
                stream_type: StreamType::Logs,
                stream_name: Some("default".to_string()),
                query_condition: QueryCondition::default(),
                operator: Operator::GreaterThanEquals,
                threshold: 100,
                source: TermSource::Inline,
                row_template: None,
            }],
            expression: "a".to_string(),
            notify: CompositeNotify::default(),
            on_error: OnErrorPolicy::Suppress,
        };
        assert!(spec.term("a").is_some());
        assert!(spec.term("b").is_none());
    }
}
