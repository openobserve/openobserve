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

/// A single term of a composite alert. A term is one of two shapes, and the
/// composite never mutates or pauses anything it points at:
///
///  - a **reference** to an existing alert (`alert_id` set): each tick the
///    composite re-runs that alert's current query over its own shared window
///    (ReRun, §10.6.2). The referenced alert keeps running on its own schedule
///    and is completely unaffected by the composite. It must live in the
///    composite's folder (RBAC v1).
///  - an **inline** query (`query` set): a query defined directly on the
///    composite with no separate alert row. It exists only as part of this
///    composite.
///
/// Exactly one of `alert_id` / `query` is set (validated at save-time).
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompositeTerm {
    /// Term label, `[A-Za-z0-9_]`, unique within the composite. Referenced by
    /// the expression and by namespaced template variables (`{A.value}`).
    pub name: String,

    /// Reference to an existing alert this term evaluates (ReRun). Mutually
    /// exclusive with `query`. The referenced alert is never modified or paused.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub alert_id: Option<Ksuid>,

    /// Inline query defined directly on the composite (no separate alert row).
    /// Set when `alert_id` is `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<CompositeTermQuery>,

    /// Optional per-term `{name.rows[..]}` rendering template.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_template: Option<String>,
}

impl CompositeTerm {
    /// True if this term references an existing alert (ReRun) rather than an
    /// inline query.
    pub fn is_reference(&self) -> bool {
        self.alert_id.is_some()
    }
}

/// An inline query owned by a composite term: everything needed to run the term
/// over the composite's shared window, without a separate alert row.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompositeTermQuery {
    pub stream_type: crate::meta::stream::StreamType,
    pub stream_name: String,
    pub query_condition: super::QueryCondition,
    /// Threshold comparison operator for this term.
    pub operator: super::Operator,
    /// Threshold value compared against the term's query result.
    pub threshold: i64,
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
    fn test_term_reference_roundtrip() {
        let id: Ksuid = Ksuid::new(None, None);
        let term = CompositeTerm {
            name: "A".to_string(),
            alert_id: Some(id),
            query: None,
            row_template: None,
        };
        let s = serde_json::to_string(&term).unwrap();
        let back: CompositeTerm = serde_json::from_str(&s).unwrap();
        assert_eq!(term, back);
        assert_eq!(back.alert_id, Some(id));
        assert!(back.is_reference());
    }

    #[test]
    fn test_inline_term_roundtrip() {
        // An inline term deserializes without an alert_id.
        let json = r#"{
            "name": "A",
            "query": {
                "stream_type": "logs",
                "stream_name": "default",
                "query_condition": { "type": "custom" },
                "operator": ">=",
                "threshold": 1
            }
        }"#;
        let term: CompositeTerm = serde_json::from_str(json).unwrap();
        assert!(!term.is_reference());
        assert_eq!(term.query.as_ref().unwrap().threshold, 1);
    }

    #[test]
    fn test_term_lookup() {
        let spec = CompositeSpec {
            terms: vec![CompositeTerm {
                name: "A".to_string(),
                alert_id: Some(Ksuid::new(None, None)),
                query: None,
                row_template: None,
            }],
            expression: "A".to_string(),
            notify: CompositeNotify::default(),
            on_error: OnErrorPolicy::Suppress,
        };
        assert!(spec.term("A").is_some());
        assert!(spec.term("B").is_none());
    }
}
