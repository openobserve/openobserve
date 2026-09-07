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

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::meta::{
    alerts::{QueryCondition, TriggerCondition, alert::Alert},
    stream::StreamType,
};

pub const PREBUILT_ALERTS_REVISION_KEY: &str = "prebuilt_alerts_revision";

/// Embedded, not read from disk: a runtime path is cwd-dependent and lets a
/// malformed edit reach production, which a compile-time include plus the
/// parse test in this module makes impossible.
const SHIPPED: &str = include_str!("../../../config/prebuilt-alerts.json");
/// Substituted with the seeding org; `_meta` holds every org's rows, so an
/// unscoped copy there would report on tenants the alert does not belong to.
const ORG_PLACEHOLDER: &str = "{org_id}";

static PREBUILT_ALERTS: LazyLock<PrebuiltAlertsConfig> = LazyLock::new(|| {
    serde_json::from_str(SHIPPED).expect("shipped prebuilt-alerts.json is pinned valid by tests")
});

#[derive(Debug, Deserialize, Serialize)]
pub struct PrebuiltAlertsConfig {
    /// Monotonic revision of the shipped set as a whole, for diagnostics; the
    /// seed decision is made per alert, from `PrebuiltAlert::revision`.
    #[serde(default)]
    pub revision: u32,
    pub alerts: Vec<PrebuiltAlert>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PrebuiltAlert {
    pub id: String,
    /// Revision this definition was introduced in, recorded per org when seeded.
    /// Diagnostic only: seeding is once-ever per id, so bumping this reseeds nothing.
    pub revision: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub query_condition: QueryCondition,
    pub trigger_condition: TriggerCondition,
    #[serde(default)]
    pub destinations: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
}

pub fn prebuilt_alerts() -> &'static PrebuiltAlertsConfig {
    &PREBUILT_ALERTS
}

pub fn get_prebuilt_alerts_revision() -> u32 {
    prebuilt_alerts().revision
}

pub fn get_prebuilt_alert(id: &str) -> Option<&'static PrebuiltAlert> {
    prebuilt_alerts().alerts.iter().find(|a| a.id == id)
}

/// `None` for an org id outside the legal alphabet, which is refused rather than
/// escaped because it reaches SQL by substitution (`notifications/chart/mod.rs`).
pub fn prebuilt_alert_definitions_for_org(org_id: &str) -> Option<Vec<Alert>> {
    if org_id.is_empty()
        || !org_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let definitions = prebuilt_alerts()
        .alerts
        .iter()
        .map(|shipped| {
            let mut alert = Alert::default();
            alert.name = shipped.name.clone();
            alert.description = shipped.description.clone();
            alert.stream_type = shipped.stream_type;
            alert.stream_name = shipped.stream_name.clone();
            alert.query_condition = shipped.query_condition.clone();
            alert.query_condition.sql = shipped
                .query_condition
                .sql
                .as_ref()
                .map(|sql| sql.replace(ORG_PLACEHOLDER, org_id));
            alert.trigger_condition = shipped.trigger_condition.clone();
            // Seeded unwired and switched off: an upgrade must never start paging on its own.
            alert.destinations = vec![];
            alert.enabled = false;
            alert
        })
        .collect();
    Some(definitions)
}

/// Seed gate for ONE alert: `applied` is the revision this org was seeded that
/// prebuilt id at, or zero if never, and any non-zero value means never again.
/// Recording the revision rather than a flag is for diagnostics, not for gating.
pub fn should_seed_prebuilt_alert(applied: u32, exists: bool) -> bool {
    applied == 0 && !exists
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    const SHIPPED_JSON: &str = include_str!("../../../config/prebuilt-alerts.json");

    fn shipped() -> PrebuiltAlertsConfig {
        serde_json::from_str::<PrebuiltAlertsConfig>(SHIPPED_JSON).unwrap()
    }

    #[test]
    fn shipped_prebuilt_alerts_json_parses() {
        let cfg = shipped();
        assert!(cfg.revision >= 1, "shipped JSON must carry revision >= 1");
        assert!(!cfg.alerts.is_empty(), "shipped JSON must define alerts");
    }

    #[test]
    fn prebuilt_alerts_returns_shipped_set() {
        let raw = shipped();
        let loaded = prebuilt_alerts();
        assert_eq!(loaded.revision, raw.revision);
        assert_eq!(loaded.alerts.len(), raw.alerts.len());
        assert_eq!(get_prebuilt_alerts_revision(), raw.revision);
    }

    #[test]
    fn every_prebuilt_alert_is_disabled() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert!(!a.enabled, "prebuilt alert {} must ship disabled", a.id);
        }
    }

    #[test]
    fn every_prebuilt_alert_has_no_destinations() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert!(
                a.destinations.is_empty(),
                "prebuilt alert {} must ship without destinations",
                a.id
            );
        }
    }

    #[test]
    fn prebuilt_alert_ids_are_unique() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        let ids: HashSet<&str> = cfg.alerts.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids.len(), cfg.alerts.len(), "duplicate prebuilt alert id");
        for a in &cfg.alerts {
            assert!(!a.id.is_empty(), "prebuilt alert id must not be empty");
        }
    }

    /// `prepare_alert` refuses any name OpenFGA cannot represent — spaces
    /// included — so a shipped name that fails this can never be seeded at all.
    #[test]
    fn every_prebuilt_alert_name_is_ofga_representable() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert!(
                !crate::utils::str::is_ofga_unsupported(&a.name),
                "prebuilt alert {} is named {:?}, which prepare_alert rejects",
                a.id,
                a.name
            );
        }
    }

    #[test]
    fn prebuilt_alert_names_are_unique_and_non_empty() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        let names: HashSet<&str> = cfg.alerts.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(
            names.len(),
            cfg.alerts.len(),
            "duplicate prebuilt alert name"
        );
        for a in &cfg.alerts {
            assert!(!a.name.is_empty(), "prebuilt alert {} has empty name", a.id);
        }
    }

    #[test]
    fn get_prebuilt_alert_round_trips_every_id() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            let found = get_prebuilt_alert(&a.id);
            assert!(found.is_some(), "get_prebuilt_alert missed id {}", a.id);
            assert_eq!(found.unwrap().name, a.name);
        }
        assert!(get_prebuilt_alert("no-such-prebuilt-alert").is_none());
    }

    #[test]
    fn prebuilt_alert_definitions_are_seed_safe() {
        let cfg = prebuilt_alerts();
        let defs = prebuilt_alert_definitions_for_org("acme").expect("acme is legal");
        assert!(!cfg.alerts.is_empty());
        assert_eq!(defs.len(), cfg.alerts.len());
        for d in &defs {
            assert!(!d.enabled, "seeded alert {} must be disabled", d.name);
            assert!(
                d.destinations.is_empty(),
                "seeded alert {} must have no destinations",
                d.name
            );
            assert!(
                d.id.is_none(),
                "seeded alert {} must not carry an id",
                d.name
            );
            assert!(
                !d.stream_name.is_empty(),
                "seeded alert {} must name a stream",
                d.name
            );
        }
    }

    #[test]
    fn should_seed_prebuilt_alert_truth_table() {
        assert!(
            should_seed_prebuilt_alert(0, false),
            "an org that has never been seeded this alert gets it"
        );
        assert!(
            !should_seed_prebuilt_alert(0, true),
            "an alert the operator already has under this name is never replaced"
        );
        assert!(
            !should_seed_prebuilt_alert(1, false),
            "an alert deleted after seeding stays deleted, whatever the set revision does"
        );
        assert!(
            !should_seed_prebuilt_alert(2, false),
            "a corrected definition is not re-planted beside the operator's copy"
        );
        assert!(
            !should_seed_prebuilt_alert(1, true),
            "an already-seeded alert is not seeded twice"
        );
    }

    /// A shipped alert with a zero frequency or period is not a bad default, it
    /// is a scheduler hot loop the operator never opted into.
    #[test]
    fn every_prebuilt_alert_has_a_sane_schedule() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert!(
                a.trigger_condition.frequency > 0,
                "prebuilt alert {} must set a positive frequency",
                a.id
            );
            assert!(
                a.trigger_condition.period > 0,
                "prebuilt alert {} must set a positive period",
                a.id
            );
            assert!(
                a.trigger_condition.threshold > 0,
                "prebuilt alert {} must set a positive threshold",
                a.id
            );
            assert!(
                a.trigger_condition.silence > 0,
                "prebuilt alert {} must silence repeats",
                a.id
            );
        }
    }

    /// `usage` needs a per-org opt-in and `errors` is written to `_meta` only, so
    /// `triggers` is the only self-reporting stream worth shipping an alert over.
    /// It is still not guaranteed to exist, which is why seeding must check.
    #[test]
    fn every_prebuilt_alert_targets_the_triggers_stream() {
        use crate::meta::self_reporting::usage::TRIGGERS_STREAM;

        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert_eq!(
                a.stream_name, TRIGGERS_STREAM,
                "prebuilt alert {} names a stream a seeded org may never have",
                a.id
            );
        }
    }

    /// The JSON is the source of truth; a hardcoded list that merely has the
    /// right shape would satisfy every other test in this file.
    #[test]
    fn prebuilt_alerts_returns_the_shipped_contents_not_just_the_shape() {
        let raw = shipped();
        let loaded = prebuilt_alerts();
        let raw_keys: Vec<_> = raw
            .alerts
            .iter()
            .map(|a| {
                (
                    a.id.as_str(),
                    a.revision,
                    a.name.as_str(),
                    a.stream_name.as_str(),
                    a.query_condition.sql.clone(),
                    a.trigger_condition.period,
                    a.trigger_condition.threshold,
                    a.trigger_condition.frequency,
                    a.trigger_condition.silence,
                )
            })
            .collect();
        let loaded_keys: Vec<_> = loaded
            .alerts
            .iter()
            .map(|a| {
                (
                    a.id.as_str(),
                    a.revision,
                    a.name.as_str(),
                    a.stream_name.as_str(),
                    a.query_condition.sql.clone(),
                    a.trigger_condition.period,
                    a.trigger_condition.threshold,
                    a.trigger_condition.frequency,
                    a.trigger_condition.silence,
                )
            })
            .collect();
        assert_eq!(loaded_keys, raw_keys);
    }

    /// Every shipped definition must declare its own revision, or the per-alert
    /// seed gate silently degrades into the set-wide one it replaced.
    #[test]
    fn every_prebuilt_alert_declares_its_own_revision() {
        let cfg = prebuilt_alerts();
        assert!(!cfg.alerts.is_empty());
        for a in &cfg.alerts {
            assert!(
                a.revision >= 1,
                "prebuilt alert {} must declare a revision >= 1",
                a.id
            );
            assert!(
                a.revision <= cfg.revision,
                "prebuilt alert {} claims a revision newer than the set",
                a.id
            );
        }
    }

    #[test]
    fn every_shipped_query_carries_the_org_placeholder() {
        for a in &shipped().alerts {
            let sql = a
                .query_condition
                .sql
                .as_ref()
                .expect("shipped alert must carry sql");
            assert!(
                sql.contains(ORG_PLACEHOLDER),
                "shipped alert {} must carry {ORG_PLACEHOLDER} so seeding can scope it",
                a.name
            );
        }
    }

    #[test]
    fn every_shipped_query_is_scoped_to_its_org() {
        let defs = prebuilt_alert_definitions_for_org("acme").expect("acme is a legal org id");
        assert_eq!(defs.len(), prebuilt_alerts().alerts.len());
        for d in &defs {
            let sql = d
                .query_condition
                .sql
                .as_ref()
                .unwrap_or_else(|| panic!("{} must carry sql", d.name));
            assert!(
                sql.contains("org = \'acme\'"),
                "seeded alert {} must be scoped to its org, got: {sql}",
                d.name
            );
            assert!(
                !sql.contains(ORG_PLACEHOLDER),
                "seeded alert {} left a placeholder unsubstituted",
                d.name
            );
        }
    }

    /// `_meta` receives every org's rows, so an unscoped copy there reports on
    /// tenants the alert does not belong to.
    #[test]
    fn the_meta_org_is_scoped_to_itself_despite_its_underscore() {
        let defs = prebuilt_alert_definitions_for_org(crate::META_ORG_ID).expect("_meta is legal");
        for d in &defs {
            assert!(
                d.query_condition
                    .sql
                    .as_ref()
                    .is_some_and(|s| s.contains("org = \'_meta\'")),
                "seeded alert {} must scope _meta to itself",
                d.name
            );
        }
    }

    #[test]
    fn an_org_id_that_could_escape_the_sql_string_is_refused() {
        for hostile in [
            "acme\' OR \'1\'=\'1",
            "acme\'; DROP TABLE alerts--",
            "a b",
            "",
            "acme\"",
            "acme%",
        ] {
            assert!(
                prebuilt_alert_definitions_for_org(hostile).is_none(),
                "org id {hostile:?} must be refused outright, not escaped"
            );
        }
    }

    #[test]
    fn the_legal_org_id_alphabet_is_accepted_in_full() {
        for ok in ["acme", "_meta", "org-1", "ORG_2", "a1"] {
            assert!(
                prebuilt_alert_definitions_for_org(ok).is_some(),
                "org id {ok:?} is legal and must be accepted"
            );
        }
    }
}
