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

//! Save-time and delete-time composition rules; all DB reads happen in the thin async wrappers.

use std::collections::{BTreeSet, HashMap, HashSet};

use config::meta::{
    synthetics::{BrowserConfig, Synthetic, SyntheticType, validate_expanded_steps},
    synthetics_composition::{
        ChildJourney, ExpansionError, added_references, expand_steps, placeholders_in, subtest_refs,
    },
};
use infra::table::{
    synthetics_checks,
    synthetics_refs::{self, ParentRef},
};
use sea_orm::ConnectionTrait;

#[derive(Debug, thiserror::Error)]
pub enum CompositionError {
    #[error("composition writes are disabled (ZO_SYNTHETICS_SUBTESTS_ENABLED=false)")]
    WritesDisabled,
    #[error("validation: {0}")]
    Invalid(String),
    #[error("this check is referenced by other checks")]
    ReferencedBy(Vec<ParentRef>),
    #[error("a check referenced by other checks cannot contain a subtest")]
    ReferencedCannotHoldSubtest(Vec<ParentRef>),
    #[error("composition lock unavailable: {0}")]
    Lock(String),
}

/// The write gate (§5.9): refuses a new reference while the flag is off.
pub(crate) fn ensure_composition_writes_allowed() -> Result<(), CompositionError> {
    if config::get_config().synthetics.subtests_enabled {
        Ok(())
    } else {
        Err(CompositionError::WritesDisabled)
    }
}

pub(crate) async fn validate_for_save<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    own_id: Option<&str>,
    body: &Synthetic,
) -> Result<(), CompositionError> {
    let refs = synthetics_refs::refs_of(body);
    // Gated here, not in `check_rules`, so the rules stay testable with the flag off.
    if !refs.is_empty() {
        let stored = match own_id {
            Some(id) => synthetics_refs::refs_for_parents(conn, org_id, &[id.to_owned()])
                .await
                .map_err(|e| CompositionError::Invalid(e.to_string()))?
                .remove(id)
                .unwrap_or_default(),
            None => Vec::new(),
        };
        if !added_references(&stored, &refs).is_empty() {
            ensure_composition_writes_allowed()?;
        }
    }
    let parents = match own_id {
        Some(id) if !refs.is_empty() => synthetics_refs::list_parents(conn, org_id, id)
            .await
            .map_err(|e| CompositionError::Invalid(e.to_string()))?,
        _ => Vec::new(),
    };
    let mut children = HashMap::new();
    for child_id in refs.iter().collect::<HashSet<_>>() {
        if let Some(child) = synthetics_checks::get(conn, org_id, child_id)
            .await
            .map_err(|e| CompositionError::Invalid(e.to_string()))?
            && child.check_type == SyntheticType::Browser
        {
            let cfg: BrowserConfig = serde_json::from_value(child.config).map_err(|e| {
                CompositionError::Invalid(format!("subtest '{child_id}': unreadable journey: {e}"))
            })?;
            children.insert(
                child.id.clone(),
                ChildJourney {
                    id: child.id,
                    name: child.name,
                    steps: cfg.steps,
                },
            );
        }
    }
    // The blocker list leaves the service as public slugs, like every other folder id.
    match check_rules(own_id, body, &children, &parents) {
        Err(CompositionError::ReferencedCannotHoldSubtest(p)) => Err(
            CompositionError::ReferencedCannotHoldSubtest(to_public_refs(p).await),
        ),
        other => other,
    }
}

/// Refuses when any check outside `deleting` still references one inside it (§5.3 bulk pre-pass).
pub(crate) async fn ensure_not_referenced<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    deleting: &[String],
) -> Result<(), CompositionError> {
    let parents = synthetics_refs::list_parents_for_many(conn, org_id, deleting)
        .await
        .map_err(|e| CompositionError::Invalid(e.to_string()))?;
    let blockers = blockers_outside(&parents, deleting);
    if blockers.is_empty() {
        Ok(())
    } else {
        Err(CompositionError::ReferencedBy(
            to_public_refs(blockers).await,
        ))
    }
}

/// Refs store the folder PK for the FK, but every API surface speaks the public folder slug.
pub async fn to_public_refs(mut parents: Vec<ParentRef>) -> Vec<ParentRef> {
    let mut slugs: HashMap<String, String> = HashMap::new();
    for parent in &mut parents {
        let slug = match slugs.get(&parent.folder_id) {
            Some(slug) => slug.clone(),
            None => {
                let slug = infra::table::folders::get_name_by_pk(&parent.folder_id)
                    .await
                    .unwrap_or(None)
                    .unwrap_or_else(|| parent.folder_id.clone());
                slugs.insert(parent.folder_id.clone(), slug.clone());
                slug
            }
        };
        parent.folder_id = slug;
    }
    parents
}

/// Every name a check resolves on its own: its declared variables plus its journey secret slots.
pub fn defined_names(check: &Synthetic) -> HashSet<String> {
    let mut names: HashSet<String> = check.variables.iter().map(|v| v.name.clone()).collect();
    if let Some(secrets) = check.config.get("secrets").and_then(|s| s.as_array()) {
        names.extend(
            secrets
                .iter()
                .filter_map(|s| s.get("name").and_then(|n| n.as_str()).map(str::to_owned)),
        );
    }
    names
}

/// The names `defined` does not cover, in sorted order.
pub fn undefined_among(names: &BTreeSet<String>, defined: &HashSet<String>) -> Vec<String> {
    names
        .iter()
        .filter(|n| !defined.contains(n.as_str()))
        .cloned()
        .collect()
}

fn check_rules(
    own_id: Option<&str>,
    body: &Synthetic,
    children: &HashMap<String, ChildJourney>,
    parents: &[ParentRef],
) -> Result<(), CompositionError> {
    if body.check_type != SyntheticType::Browser {
        return Ok(());
    }
    let cfg: BrowserConfig = serde_json::from_value(body.config.clone())
        .map_err(|e| CompositionError::Invalid(format!("config: {e}")))?;
    let refs = subtest_refs(&cfg.steps);
    if refs.is_empty() {
        return Ok(());
    }
    if own_id.is_some_and(|id| refs.iter().any(|r| r == id)) {
        return Err(CompositionError::Invalid(
            "config.steps: a check cannot reference itself as a subtest".into(),
        ));
    }
    if !parents.is_empty() {
        return Err(CompositionError::ReferencedCannotHoldSubtest(
            parents.to_vec(),
        ));
    }
    if let Some(missing) = refs.iter().find(|r| !children.contains_key(*r)) {
        return Err(CompositionError::Invalid(format!(
            "config.steps: subtest '{missing}' is not a browser check in this organization"
        )));
    }
    let expanded = expand_steps(&cfg.steps, children).map_err(|e| match e {
        ExpansionError::ChildHoldsReference { child, .. } => CompositionError::Invalid(format!(
            "config.steps: '{child}' contains a subtest of its own; nesting is limited to one level"
        )),
        other => CompositionError::Invalid(format!("config.steps: {other}")),
    })?;
    let max_steps = config::get_config().synthetics.browser_max_steps;
    if expanded.len() > max_steps {
        let from_children: usize = refs
            .iter()
            .filter_map(|r| children.get(r))
            .map(|c| c.steps.len())
            .sum();
        return Err(CompositionError::Invalid(format!(
            "config.steps: this test executes {} steps — {} of its own plus {} from {} subtest{}. The limit is {max_steps}.",
            expanded.len(),
            cfg.steps.len() - refs.len(),
            from_children,
            refs.len(),
            if refs.len() == 1 { "" } else { "s" }
        )));
    }
    validate_expanded_steps(&expanded).map_err(|e| {
        CompositionError::Invalid(format!(
            "expanded journey: {e} (re-save the referenced check to migrate its steps)"
        ))
    })?;
    // A child's secrets do not travel with it, so legacy ciphertext would reach the probe.
    for child_id in &refs {
        let child = &children[child_id];
        if serde_json::to_string(&child.steps).is_ok_and(|s| s.contains("AESenc:")) {
            return Err(CompositionError::Invalid(format!(
                "config.steps: '{child_id}' stores encrypted values inside its steps and cannot be used as a subtest; re-save it first"
            )));
        }
    }
    // Secret names count as defined: resolve injects their decrypted values into env_inject.
    let defined = defined_names(body);
    for child_id in &refs {
        let child = &children[child_id];
        if let Some(var) = undefined_among(&placeholders_in(&child.steps), &defined).first() {
            return Err(CompositionError::Invalid(format!(
                "variables: '{child_id}' uses {{{{{var}}}}}, which this test does not define"
            )));
        }
    }
    Ok(())
}

fn blockers_outside(
    parents: &HashMap<String, Vec<ParentRef>>,
    deleting: &[String],
) -> Vec<ParentRef> {
    let batch: HashSet<&str> = deleting.iter().map(String::as_str).collect();
    let mut out: Vec<ParentRef> = parents
        .values()
        .flatten()
        .filter(|p| !batch.contains(p.id.as_str()))
        .cloned()
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use std::collections::HashMap;

    use config::meta::{
        synthetics::{Synthetic, SyntheticType, SyntheticVariable},
        synthetics_composition::ChildJourney,
    };
    use serde_json::json;

    use super::*;

    fn browser(id: &str, steps: serde_json::Value) -> Synthetic {
        Synthetic {
            id: id.into(),
            check_type: SyntheticType::Browser,
            config: json!({ "steps": steps, "browser_devices": [ { "browser": "chromium", "device": "desktop" } ] }),
            ..Synthetic::default()
        }
    }

    fn login(steps: usize) -> ChildJourney {
        let mut v = vec![json!({ "id": "c0", "action": "navigate", "url": "https://x/login" })];
        for i in 1..steps {
            v.push(
                json!({ "id": format!("c{i}"), "action": "click", "name": "n",
                           "locator": { "candidates": [ { "kind": "css", "value": "#a" } ] } }),
            );
        }
        ChildJourney {
            id: "login".into(),
            name: "Login".into(),
            steps: v,
        }
    }

    fn parent_with(refs: &[&str], own_extra: usize) -> Synthetic {
        let mut steps = vec![json!({ "id": "s0", "action": "navigate", "url": "https://x" })];
        for (i, r) in refs.iter().enumerate() {
            steps.push(
                json!({ "id": format!("r{i}"), "action": "subtest", "subtest": { "id": r } }),
            );
        }
        for i in 0..own_extra {
            steps.push(
                json!({ "id": format!("o{i}"), "action": "click", "name": "n",
                               "locator": { "candidates": [ { "kind": "css", "value": "#a" } ] } }),
            );
        }
        browser("p", json!(steps))
    }

    #[test]
    fn a_parent_may_not_reference_itself() {
        let body = parent_with(&["p"], 0);
        let err = check_rules(Some("p"), &body, &HashMap::new(), &[]).unwrap_err();
        assert!(matches!(err, CompositionError::Invalid(m) if m.contains("itself")));
    }

    #[test]
    fn the_cap_applies_to_the_expanded_journey() {
        let children = HashMap::from([("login".to_string(), login(30))]);
        let ok = parent_with(&["login"], 18);
        check_rules(Some("p"), &ok, &children, &[]).unwrap();
        let over = parent_with(&["login"], 21);
        let err = check_rules(Some("p"), &over, &children, &[]).unwrap_err();
        assert!(
            matches!(err, CompositionError::Invalid(m) if m.contains("52 steps") && m.contains("30 from 1 subtest"))
        );
    }

    #[test]
    fn a_child_placeholder_must_be_defined_by_the_parent() {
        let mut child = login(2);
        child.steps[1]["value"] = json!("{{PASSWORD}}");
        let children = HashMap::from([("login".to_string(), child)]);
        let mut body = parent_with(&["login"], 0);
        let err = check_rules(Some("p"), &body, &children, &[]).unwrap_err();
        assert!(
            matches!(err, CompositionError::Invalid(m) if m.contains("PASSWORD") && m.contains("'login'") && !m.contains("Login"))
        );
        body.variables = vec![SyntheticVariable {
            name: "PASSWORD".into(),
            ..Default::default()
        }];
        check_rules(Some("p"), &body, &children, &[]).unwrap();
    }

    // Resolve injects decrypted secret values into env_inject, so a secret name defines the token.
    #[test]
    fn a_parent_secret_defines_a_child_placeholder() {
        let mut child = login(2);
        child.steps[1]["value"] = json!("{{PASSWORD}}");
        let children = HashMap::from([("login".to_string(), child)]);
        let mut body = parent_with(&["login"], 0);
        body.config["secrets"] = json!([{ "name": "PASSWORD", "value": "AESenc:x" }]);
        check_rules(Some("p"), &body, &children, &[]).unwrap();
    }

    #[test]
    fn a_referenced_check_may_not_gain_a_subtest() {
        let children = HashMap::from([("login".to_string(), login(3))]);
        let body = parent_with(&["login"], 0);
        let parents = vec![ParentRef {
            id: "q".into(),
            name: "checkout".into(),
            folder_id: "f".into(),
        }];
        let err = check_rules(Some("p"), &body, &children, &parents).unwrap_err();
        assert!(matches!(err, CompositionError::ReferencedCannotHoldSubtest(p) if p.len() == 1));
    }

    #[test]
    fn a_referenced_check_without_subtests_saves_freely() {
        let body = browser(
            "p",
            json!([{ "id": "s0", "action": "navigate", "url": "https://x" }]),
        );
        let parents = vec![ParentRef {
            id: "q".into(),
            name: "checkout".into(),
            folder_id: "f".into(),
        }];
        check_rules(Some("p"), &body, &HashMap::new(), &parents).unwrap();
    }

    #[test]
    fn a_child_that_is_not_a_browser_check_is_rejected() {
        let mut body = parent_with(&["http-1"], 0);
        body.variables.clear();
        let err = check_rules(Some("p"), &body, &HashMap::new(), &[]).unwrap_err();
        assert!(matches!(err, CompositionError::Invalid(m) if m.contains("http-1")));
    }

    /// The mechanism that keeps a save racing a delete from committing a dangling reference.
    #[tokio::test]
    async fn the_composition_lock_serialises_critical_sections_per_org() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        let inside = Arc::new(AtomicUsize::new(0));
        let overlaps = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let (inside, overlaps) = (inside.clone(), overlaps.clone());
            tasks.push(tokio::spawn(async move {
                let guard = crate::service::composition_lock::lock("org-lock-test")
                    .await
                    .unwrap();
                if inside.fetch_add(1, Ordering::SeqCst) != 0 {
                    overlaps.fetch_add(1, Ordering::SeqCst);
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                inside.fetch_sub(1, Ordering::SeqCst);
                guard.release().await.unwrap();
            }));
        }
        for t in tasks {
            t.await.unwrap();
        }
        assert_eq!(
            overlaps.load(Ordering::SeqCst),
            0,
            "two writers were inside the org's critical section at once"
        );
    }

    #[test]
    fn blockers_inside_the_delete_batch_do_not_block() {
        let parents = HashMap::from([(
            "child".to_string(),
            vec![
                ParentRef {
                    id: "p1".into(),
                    name: "a".into(),
                    folder_id: "f".into(),
                },
                ParentRef {
                    id: "p2".into(),
                    name: "b".into(),
                    folder_id: "f".into(),
                },
            ],
        )]);
        assert!(blockers_outside(&parents, &["child".into(), "p1".into(), "p2".into()]).is_empty());
        let left = blockers_outside(&parents, &["child".into(), "p1".into()]);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, "p2");
    }

    /// Flag tests hold this, so no other config swap can revert the flag mid-test.
    pub(crate) async fn subtests_flag(enabled: bool) -> tokio::sync::MutexGuard<'static, ()> {
        let guard = crate::CONFIG_SWAP_LOCK.lock().await;
        let mut cfg = config::config::init();
        cfg.synthetics.subtests_enabled = enabled;
        config::CONFIG.store(std::sync::Arc::new(cfg));
        guard
    }

    /// `synthetics_checks::create` relies on migration column defaults that entities omit.
    pub(crate) async fn db_with_synthetics_defaults() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectOptions, ConnectionTrait, Database, Schema};
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        db.execute_unprepared("PRAGMA foreign_keys = ON")
            .await
            .unwrap();
        db.execute_unprepared(
            "CREATE TABLE synthetics (
                id TEXT NOT NULL PRIMARY KEY,
                org_id TEXT NOT NULL,
                folder_id TEXT NOT NULL,
                tz_offset INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL,
                synthetics_type TEXT NOT NULL,
                target TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL,
                config TEXT NOT NULL,
                frequency TEXT NOT NULL,
                locations TEXT NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT 1,
                destinations TEXT NOT NULL,
                settings TEXT NOT NULL,
                secrets TEXT NOT NULL DEFAULT '{}',
                next_run_at BIGINT NOT NULL DEFAULT 0,
                last_triggered_at BIGINT NOT NULL DEFAULT 0,
                last_check_status INTEGER NOT NULL DEFAULT 0,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                last_alert_at BIGINT NOT NULL DEFAULT 0,
                alerting BOOLEAN NOT NULL DEFAULT 0,
                degraded_notified_at BIGINT NOT NULL DEFAULT 0,
                owner TEXT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(
            &schema.create_table_from_entity(infra::table::entity::synthetics_refs::Entity),
        ))
        .await
        .unwrap();
        db
    }

    fn referencing(id: &str, org_id: &str, child: &str) -> Synthetic {
        Synthetic {
            id: id.into(),
            org_id: org_id.into(),
            name: id.into(),
            check_type: SyntheticType::Browser,
            config: json!({ "steps": [ { "id": "r0", "action": "subtest", "subtest": { "id": child } } ] }),
            ..Synthetic::default()
        }
    }

    #[tokio::test]
    async fn ensure_not_referenced_reports_full_blockers_and_respects_org_scope() {
        let db = db_with_synthetics_defaults().await;

        // Two blockers in org1, plus one in org2 that must never count toward org1's pre-pass.
        let a =
            synthetics_checks::create(&db, "org1", referencing("blocker-a", "org1", "child"), true)
                .await;
        assert!(a.is_ok(), "setup: blocker-a must be created: {a:?}");
        let b =
            synthetics_checks::create(&db, "org1", referencing("blocker-b", "org1", "child"), true)
                .await;
        assert!(b.is_ok(), "setup: blocker-b must be created: {b:?}");
        let cross_org = synthetics_checks::create(
            &db,
            "org2",
            referencing("other-org-parent", "org2", "child"),
            true,
        )
        .await;
        assert!(
            cross_org.is_ok(),
            "setup: other-org-parent must be created: {cross_org:?}"
        );

        // The full blocker list comes back, and the other org's parent is excluded.
        let result = ensure_not_referenced(&db, "org1", &["child".to_string()]).await;
        let mut ids: Vec<String> = match result {
            Err(CompositionError::ReferencedBy(parents)) => {
                parents.into_iter().map(|p| p.id).collect()
            }
            other => panic!("expected ReferencedBy, got {other:?}"),
        };
        ids.sort();
        assert_eq!(ids, ["blocker-a", "blocker-b"]);

        ensure_not_referenced(&db, "org1", &["lonely".to_string()])
            .await
            .unwrap();
    }

    #[test]
    fn self_reference_is_reported_before_the_referenced_rule() {
        let body = parent_with(&["p"], 0);
        let parents = vec![ParentRef {
            id: "q".into(),
            name: "checkout".into(),
            folder_id: "f".into(),
        }];
        let err = check_rules(Some("p"), &body, &HashMap::new(), &parents).unwrap_err();
        assert!(matches!(err, CompositionError::Invalid(m) if m.contains("itself")));
    }

    #[test]
    fn a_nested_child_is_named_by_id_not_by_name() {
        let mut child = login(2);
        child
            .steps
            .push(json!({ "id": "cx", "action": "subtest", "subtest": { "id": "other" } }));
        let children = HashMap::from([("login".to_string(), child)]);
        let err = check_rules(Some("p"), &parent_with(&["login"], 0), &children, &[]).unwrap_err();
        assert!(
            matches!(err, CompositionError::Invalid(m) if m.contains("'login'") && !m.contains("Login"))
        );
    }

    fn child_row(id: &str) -> Synthetic {
        Synthetic {
            id: id.into(),
            org_id: "org1".into(),
            name: id.into(),
            check_type: SyntheticType::Browser,
            config: json!({ "steps": [ { "id": "c0", "action": "navigate", "url": "https://x/login" } ] }),
            ..Synthetic::default()
        }
    }

    #[tokio::test]
    async fn the_disabled_flag_gates_only_an_added_reference() {
        let _flag = subtests_flag(false).await;
        let db = db_with_synthetics_defaults().await;
        for id in ["login", "logout"] {
            synthetics_checks::create(&db, "org1", child_row(id), true)
                .await
                .unwrap();
        }
        let mut parent = parent_with(&["login"], 0);
        parent.org_id = "org1".into();
        parent.name = "before".into();
        synthetics_checks::create(&db, "org1", parent.clone(), true)
            .await
            .unwrap();

        parent.name = "after".into();
        validate_for_save(&db, "org1", Some("p"), &parent)
            .await
            .unwrap();

        let mut repeated = parent_with(&["login", "login"], 0);
        repeated.org_id = "org1".into();
        validate_for_save(&db, "org1", Some("p"), &repeated)
            .await
            .unwrap();

        validate_for_save(&db, "org1", Some("p"), &child_row("p"))
            .await
            .unwrap();

        let mut added = parent_with(&["login", "logout"], 0);
        added.org_id = "org1".into();
        let err = validate_for_save(&db, "org1", Some("p"), &added)
            .await
            .unwrap_err();
        assert!(matches!(err, CompositionError::WritesDisabled), "{err:?}");

        let err = validate_for_save(&db, "org1", None, &parent)
            .await
            .unwrap_err();
        assert!(matches!(err, CompositionError::WritesDisabled), "{err:?}");
    }
}
