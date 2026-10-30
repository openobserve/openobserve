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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use common::{
    infra::config::{ALERTS, ALERTS_CONTENT_SPECS, ALERTS_TEMPLATES, DESTINATIONS},
    meta::authz::Authz,
};
use config::{
    DEFAULT_ORG,
    meta::{
        alerts::content_spec::ContentSpec,
        destinations::{Module, Template, TemplateKind},
    },
};
use infra::table;
use itertools::Itertools;

use crate::{self as db, authz::remove_ownership};

// db cache watcher prefix
const TEMPLATE_WATCHER_PREFIX: &str = "/templates/";

#[derive(Debug, thiserror::Error)]
pub enum TemplateError {
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),
    #[error("Template name cannot be empty")]
    EmptyName,
    #[error(
        "Template name cannot contain ':', '#', '?', '&', '%', '/', quotes and space characters"
    )]
    InvalidName,
    #[error("Email Template cannot have empty title")]
    EmptyTitle,
    #[error("Template body cannot be empty")]
    EmptyBody,
    #[error("Template with the same name already exists")]
    AlreadyExists,
    #[error("Template is in use for destination {0}")]
    DeleteWithDestination(String),
    #[error("Template is in use for alert {0}")]
    DeleteWithAlert(String),
    #[error("Template not found")]
    NotFound,
    #[error(
        "Template '{0}' is a system prebuilt template and cannot be modified or deleted. \
         Create a copy with a different name to customize it."
    )]
    PrebuiltReadOnly(String),
    #[error(
        "Template name '{0}' is reserved for system prebuilt templates. \
         Pick a different name."
    )]
    ReservedName(String),
    #[error("invalid template kind: {0}")]
    InvalidKind(String),
    #[error("content template body is not a valid content spec: {0}")]
    InvalidContentSpec(String),
}

pub async fn get(org_id: &str, name: &str) -> Result<Template, TemplateError> {
    let map_key = format!("{org_id}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&map_key) {
        return Ok(v.value().clone());
    }
    let default_org_key = format!("{DEFAULT_ORG}/{name}");
    if let Some(v) = ALERTS_TEMPLATES.get(&default_org_key) {
        return Ok(v.value().clone());
    }

    if let Some(template) = table::templates::get(org_id, name).await? {
        return Ok(template);
    }
    table::templates::get(DEFAULT_ORG, name)
        .await?
        .ok_or(TemplateError::NotFound)
}

pub async fn set(template: Template) -> Result<Template, TemplateError> {
    let saved = table::templates::put(template).await?;

    // trigger watch event to update in-memory cache
    let event_key = format!("{TEMPLATE_WATCHER_PREFIX}{}/{}", saved.org_id, saved.name);
    // in-cluster
    infra::coordinator::emit_put(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::templates_put(
            &event_key,
            saved.clone(),
        )
        .await
    {
        log::error!(
            "[Template] error triggering super cluster event to add template to cache: org_id: {}, error: {e}",
            saved.org_id
        );
    }

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), TemplateError> {
    check_not_in_use(org_id, name).await?;

    if !table::templates::delete(org_id, name).await? {
        return Err(TemplateError::NotFound);
    }
    let event_key = format!("{TEMPLATE_WATCHER_PREFIX}{org_id}/{name}");

    // trigger watch event to update in-memory cache
    // in-cluster
    infra::coordinator::emit_delete(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::templates_delete(
            &event_key, org_id, name,
        )
        .await
    {
        log::error!(
            "[Template] error triggering super cluster event to remove template from cache: org_id: {org_id}, error: {e}"
        );
    }

    Ok(())
}

pub async fn delete_by_org(org_id: &str) -> Result<(), TemplateError> {
    let owned = table::templates::list_ids_by_org(org_id).await?;
    let names: Vec<String> = owned.iter().map(|(_, name)| name.clone()).collect();
    let owners = &tuple_owners(org_id, &names).await?;
    let local = |name: String| async move {
        apply_template_cache_event(&format!("{org_id}/{name}"), None);
    };
    let broadcast = |name: String| async move {
        let event_key = format!("{TEMPLATE_WATCHER_PREFIX}{org_id}/{name}");
        infra::coordinator::emit_delete(&event_key).await?;
        Ok::<(), TemplateError>(())
    };
    // Org deletion is refused while super-cluster replication is enabled.
    db::teardown::evict_then_delete(
        owned,
        |(_, name): (String, String)| local(name),
        |(_, name): (String, String)| broadcast(name),
        |(id, name): (String, String)| async move {
            for owner in owners.get(&name).into_iter().flatten() {
                remove_ownership(owner, "templates", Authz::new(&name)).await;
            }
            table::templates::delete_by_id(org_id, &id).await?;
            Ok(())
        },
    )
    .await?;
    let missed = table::templates::delete_by_org_returning(org_id).await?;
    let names: Vec<String> = missed.iter().map(|(_, name)| name.clone()).collect();
    let owners = tuple_owners(org_id, &names).await?;
    for (_, name) in missed {
        for owner in owners.get(&name).into_iter().flatten() {
            remove_ownership(owner, "templates", Authz::new(&name)).await;
        }
        db::teardown::evict(local(name.clone()), broadcast(name)).await?;
    }
    Ok(())
}

/// For each name, the owners of its `template:{name}` tuples; none when no tuples are kept.
pub async fn tuple_owners(
    org_id: &str,
    names: &[String],
) -> Result<HashMap<String, Vec<String>>, TemplateError> {
    if !db::authz::tracks_ownership() {
        return Ok(HashMap::new());
    }
    owners_by_name(org_id, names).await
}

pub async fn list(org_id: &str) -> Result<Vec<Template>, TemplateError> {
    let cache = ALERTS_TEMPLATES.clone();
    if !cache.is_empty() {
        return Ok(cache
            .into_iter()
            .filter_map(|(k, template)| {
                let is_org_template = k.starts_with(&format!("{org_id}/"));
                let is_default_template = k.starts_with(&format!("{DEFAULT_ORG}/"));
                (is_org_template || is_default_template).then_some(template)
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    Ok(table::templates::list(org_id).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(TEMPLATE_WATCHER_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert templates");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_templates: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let (org_id, name) =
                    match super::destinations::parse_event_key(TEMPLATE_WATCHER_PREFIX, &ev.key) {
                        Ok(parsed) => parsed,
                        Err(e) => {
                            log::error!("{e}");
                            continue;
                        }
                    };
                let item_value: Template = match table::templates::get(org_id, name).await {
                    Ok(Some(val)) => val,
                    Ok(None) => {
                        log::error!("Template not found in db, org_id: {org_id}");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting from db: org_id: {org_id}, error: {e}");
                        continue;
                    }
                };
                let cache_key = format!("{org_id}/{name}");
                apply_template_cache_event(&cache_key, Some(&item_value));
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(TEMPLATE_WATCHER_PREFIX).unwrap();
                apply_template_cache_event(item_key, None);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

/// Apply one template cache event to both `ALERTS_TEMPLATES` and
/// `ALERTS_CONTENT_SPECS`, keeping them coherent. Extracted from `watch()` so
/// the content-cache invalidation rules are unit-testable without a
/// coordinator loop.
///
/// - `Some(template)` is a Put: the template is written into `ALERTS_TEMPLATES`, and
///   `ALERTS_CONTENT_SPECS` is updated to match:
///   - content-kind that parses -> insert the parsed `Arc<ContentSpec>`
///   - content-kind that fails to parse (only possible for rows written by pre-upgrade nodes) ->
///     log and remove any stale cached spec, never panic
///   - not content-kind -> remove any stale cached spec, so a template converted content -> custom
///     stops serving its old parsed spec
/// - `None` is a Delete: `cache_key` is removed from both caches.
pub(crate) fn apply_template_cache_event(cache_key: &str, template: Option<&Template>) {
    match template {
        Some(item_value) => {
            if item_value.kind == TemplateKind::Content {
                match ContentSpec::parse(&item_value.body) {
                    Ok(spec) => {
                        ALERTS_CONTENT_SPECS.insert(cache_key.to_string(), Arc::new(spec));
                    }
                    Err(e) => {
                        // Only possible for rows written by pre-upgrade
                        // nodes. Do not leave a stale spec behind.
                        log::error!(
                            "[Template] content template {cache_key} failed to parse, \
                             removing any stale cached spec: {e}"
                        );
                        ALERTS_CONTENT_SPECS.remove(cache_key);
                    }
                }
            } else {
                // Template converted from content -> custom (or was
                // never content); make sure no stale spec lingers.
                ALERTS_CONTENT_SPECS.remove(cache_key);
            }
            ALERTS_TEMPLATES.insert(cache_key.to_string(), item_value.clone());
        }
        None => {
            ALERTS_TEMPLATES.remove(cache_key);
            ALERTS_CONTENT_SPECS.remove(cache_key);
        }
    }
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let all_temps = table::templates::list_all().await?;
    for (org, temp) in all_temps {
        let cache_key = format!("{}/{}", org, temp.name);
        if temp.kind == TemplateKind::Content {
            match ContentSpec::parse(&temp.body) {
                Ok(spec) => {
                    ALERTS_CONTENT_SPECS.insert(cache_key.clone(), Arc::new(spec));
                }
                Err(e) => {
                    log::error!(
                        "[Template] content template {cache_key} failed to parse during cache \
                         seeding, removing any stale cached spec: {e}"
                    );
                    // Match `apply_template_cache_event`'s parse-failure rule: a body we
                    // cannot parse must never leave an older spec serving stale content.
                    // Seeding normally starts from empty maps, but a re-seed must not be
                    // the one path that diverges from the watch handler.
                    ALERTS_CONTENT_SPECS.remove(&cache_key);
                }
            }
        }
        ALERTS_TEMPLATES.insert(cache_key, temp);
    }
    log::info!("{} Templates Cached", ALERTS_TEMPLATES.len());
    Ok(())
}

/// Returns the parsed `ContentSpec` for a content-kind template, sharing one
/// parse across callers via the `ALERTS_CONTENT_SPECS` cache. Cache-first,
/// parse-on-miss; a parse error is returned without inserting anything.
pub fn get_parsed_content(template: &Template) -> Result<Arc<ContentSpec>, serde_json::Error> {
    let key = format!("{}/{}", template.org_id, template.name);
    if let Some(spec) = ALERTS_CONTENT_SPECS.get(&key) {
        return Ok(spec.clone());
    }
    let spec = Arc::new(ContentSpec::parse(&template.body)?);
    ALERTS_CONTENT_SPECS.insert(key, spec.clone());
    Ok(spec)
}

async fn check_not_in_use(org_id: &str, name: &str) -> Result<(), TemplateError> {
    for dest in DESTINATIONS.iter() {
        if references_from(org_id, dest.key())
            && matches!(&dest.module, Module::Alert { template: Some(t), .. } if t == name)
        {
            return Err(TemplateError::DeleteWithDestination(dest.name.clone()));
        }
    }
    let alerts_cache = ALERTS.read().await;
    for (key, (_folder, alert)) in alerts_cache.iter() {
        if references_from(org_id, key) && alert.template.as_deref() == Some(name) {
            return Err(TemplateError::DeleteWithAlert(alert.name.clone()));
        }
    }
    Ok(())
}

// A `default` template is shared by every org, so its references are checked across all orgs.
fn references_from(org_id: &str, cache_key: &str) -> bool {
    org_id == DEFAULT_ORG
        || cache_key
            .strip_prefix(org_id)
            .is_some_and(|rest| rest.starts_with('/'))
}

/// For each name, the owners of its `template:{name}` tuples: the org, and the name if unshared.
async fn owners_by_name(
    org_id: &str,
    names: &[String],
) -> Result<HashMap<String, Vec<String>>, TemplateError> {
    let shared = names_shared_with_live_orgs(org_id, names).await?;
    Ok(names
        .iter()
        .map(|name| {
            let owners = ownership_owners(org_id, name, shared.contains(name));
            (name.clone(), owners.into_iter().map(String::from).collect())
        })
        .collect())
}

/// The names another org that is not deleting also holds; an org without a row counts as live.
async fn names_shared_with_live_orgs(
    org_id: &str,
    names: &[String],
) -> Result<HashSet<String>, TemplateError> {
    Ok(table::templates::names_held_by_live_orgs(org_id, names)
        .await?
        .into_iter()
        .collect())
}

/// The owners of the template's tuples: the org, and the name, which older releases wrote as org.
fn ownership_owners<'a>(org_id: &'a str, name: &'a str, name_shared: bool) -> Vec<&'a str> {
    let mut owners = vec![org_id];
    // Every org holding a same-named template shares that one legacy tuple.
    if !name_shared && name != org_id {
        owners.push(name);
    }
    owners
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::alert::Alert,
        destinations::{Destination, Module},
        folder::Folder,
    };

    use super::*;

    fn seed_destination(org_id: &str, name: &str, template: &str) {
        DESTINATIONS.insert(
            format!("{org_id}/{name}"),
            Destination {
                org_id: org_id.to_string(),
                name: name.to_string(),
                module: Module::Alert {
                    template: Some(template.to_string()),
                    destination_type: Default::default(),
                },
                ..Default::default()
            },
        );
    }

    #[test]
    fn test_references_from_matches_the_org_prefix_exactly() {
        assert!(references_from("acme", "acme/dest"));
        assert!(!references_from("acme", "acme2/dest"));
        assert!(!references_from("acme2", "acme/dest"));
        assert!(references_from(DEFAULT_ORG, "acme/dest"));
    }

    #[tokio::test]
    async fn test_check_not_in_use_ignores_a_prefix_sibling_org() {
        seed_destination("tpl_scope_acme2", "d", "tpl_scope_prefix_tpl");
        assert!(
            check_not_in_use("tpl_scope_acme", "tpl_scope_prefix_tpl")
                .await
                .is_ok()
        );
        assert!(matches!(
            check_not_in_use("tpl_scope_acme2", "tpl_scope_prefix_tpl").await,
            Err(TemplateError::DeleteWithDestination(d)) if d == "d"
        ));
    }

    #[tokio::test]
    async fn test_check_not_in_use_sees_every_org_for_a_default_template() {
        seed_destination("tpl_scope_other", "d", "tpl_scope_shared_dest");
        assert!(matches!(
            check_not_in_use(DEFAULT_ORG, "tpl_scope_shared_dest").await,
            Err(TemplateError::DeleteWithDestination(d)) if d == "d"
        ));

        let mut alert = Alert::default();
        alert.name = "a".to_string();
        alert.template = Some("tpl_scope_shared_alert".to_string());
        ALERTS
            .write()
            .await
            .insert("tpl_scope_other/a1".to_string(), (Folder::default(), alert));
        assert!(matches!(
            check_not_in_use(DEFAULT_ORG, "tpl_scope_shared_alert").await,
            Err(TemplateError::DeleteWithAlert(a)) if a == "a"
        ));
        assert!(
            check_not_in_use("tpl_scope_unrelated", "tpl_scope_shared_alert")
                .await
                .is_ok()
        );
    }

    #[test]
    fn test_template_error_display_empty_name() {
        let e = TemplateError::EmptyName;
        assert_eq!(e.to_string(), "Template name cannot be empty");
    }

    #[test]
    fn test_template_error_display_empty_body() {
        let e = TemplateError::EmptyBody;
        assert_eq!(e.to_string(), "Template body cannot be empty");
    }

    #[test]
    fn test_template_error_display_not_found() {
        let e = TemplateError::NotFound;
        assert_eq!(e.to_string(), "Template not found");
    }

    #[test]
    fn test_template_error_display_already_exists() {
        let e = TemplateError::AlreadyExists;
        assert_eq!(e.to_string(), "Template with the same name already exists");
    }

    #[test]
    fn test_template_error_display_delete_with_destination() {
        let e = TemplateError::DeleteWithDestination("my-dest".to_string());
        assert!(e.to_string().contains("my-dest"));
    }

    #[test]
    fn test_template_error_display_delete_with_alert() {
        let e = TemplateError::DeleteWithAlert("my-alert".to_string());
        assert!(e.to_string().contains("my-alert"));
    }

    fn content_template(org_id: &str, name: &str, body: &str) -> Template {
        Template {
            org_id: org_id.to_string(),
            name: name.to_string(),
            body: body.to_string(),
            kind: config::meta::destinations::TemplateKind::Content,
            ..Default::default()
        }
    }

    #[test]
    fn test_get_parsed_content_caches_same_arc() {
        let template = content_template(
            "test_org_cache_hit",
            "content-tpl",
            r#"{"title":"CPU high"}"#,
        );
        let first = get_parsed_content(&template).expect("first parse should succeed");
        let second = get_parsed_content(&template).expect("second call should hit cache");
        assert!(
            Arc::ptr_eq(&first, &second),
            "expected cached call to return the same Arc"
        );
    }

    #[test]
    fn test_get_parsed_content_parse_error_does_not_insert() {
        let template = content_template("test_org_parse_err", "bad-content-tpl", "not valid json");
        let key = format!("{}/{}", template.org_id, template.name);

        let result = get_parsed_content(&template);
        assert!(result.is_err());
        assert!(
            ALERTS_CONTENT_SPECS.get(&key).is_none(),
            "a parse error must not insert into the cache"
        );
    }

    fn custom_template(org_id: &str, name: &str, body: &str) -> Template {
        Template {
            org_id: org_id.to_string(),
            name: name.to_string(),
            body: body.to_string(),
            kind: config::meta::destinations::TemplateKind::Custom,
            ..Default::default()
        }
    }

    /// Asserts the one-directional invariant that keeps the two caches from
    /// diverging: whenever `ALERTS_CONTENT_SPECS` holds a spec for `key`,
    /// `ALERTS_TEMPLATES` must show that key as content-kind. (The converse
    /// does not hold: a content-kind template whose body fails to parse is
    /// legitimately left in `ALERTS_TEMPLATES` with no entry in
    /// `ALERTS_CONTENT_SPECS` — see the "never panic on parse failure" case.)
    fn assert_caches_agree(key: &str) {
        if ALERTS_CONTENT_SPECS.get(key).is_some() {
            let templates_has_content = ALERTS_TEMPLATES
                .get(key)
                .is_some_and(|t| t.kind == config::meta::destinations::TemplateKind::Content);
            assert!(
                templates_has_content,
                "ALERTS_CONTENT_SPECS has an entry for {key} but ALERTS_TEMPLATES does not show \
                 it as content-kind — the caches have diverged"
            );
        }
    }

    #[test]
    fn test_apply_put_content_inserts_and_replaces_spec() {
        let org_id = "test_org_apply_put_content";
        let name = "content-tpl";
        let key = format!("{org_id}/{name}");

        let first = content_template(org_id, name, r#"{"title":"first"}"#);
        apply_template_cache_event(&key, Some(&first));
        let first_spec = ALERTS_CONTENT_SPECS
            .get(&key)
            .expect("Put of content-kind template must insert a spec")
            .clone();
        assert_eq!(
            ALERTS_TEMPLATES.get(&key).unwrap().body,
            r#"{"title":"first"}"#
        );
        assert_caches_agree(&key);

        // A second Put with a changed body must replace the cached spec.
        let second = content_template(org_id, name, r#"{"title":"second"}"#);
        apply_template_cache_event(&key, Some(&second));
        let second_spec = ALERTS_CONTENT_SPECS
            .get(&key)
            .expect("Put must keep a spec cached")
            .clone();
        assert_eq!(
            ALERTS_TEMPLATES.get(&key).unwrap().body,
            r#"{"title":"second"}"#
        );
        assert!(
            !Arc::ptr_eq(&first_spec, &second_spec),
            "changed body must produce a freshly parsed (and re-inserted) spec"
        );
        assert_caches_agree(&key);
    }

    #[test]
    fn test_apply_put_content_to_custom_evicts_stale_entry() {
        let org_id = "test_org_evict";
        let name = "convert-tpl";
        let key = format!("{org_id}/{name}");

        // Prime both caches via the real Put path, as if the template had
        // originally been content-kind.
        let original = content_template(org_id, name, r#"{"title":"old"}"#);
        apply_template_cache_event(&key, Some(&original));
        assert!(ALERTS_CONTENT_SPECS.get(&key).is_some());
        assert_caches_agree(&key);

        // The template is now converted to custom-kind; the extracted
        // function (== watch()'s Put branch) must evict the stale spec.
        let updated = custom_template(org_id, name, "custom template body");
        apply_template_cache_event(&key, Some(&updated));

        assert!(
            ALERTS_CONTENT_SPECS.get(&key).is_none(),
            "content->custom conversion must evict the stale parsed spec"
        );
        assert_eq!(ALERTS_TEMPLATES.get(&key).unwrap().kind, updated.kind);
        assert_caches_agree(&key);
    }

    #[test]
    fn test_apply_put_content_parse_failure_removes_stale_entry_without_panicking() {
        let org_id = "test_org_apply_parse_fail";
        let name = "bad-content-tpl";
        let key = format!("{org_id}/{name}");

        // Prime a stale spec via a valid Put first.
        let original = content_template(org_id, name, r#"{"title":"old"}"#);
        apply_template_cache_event(&key, Some(&original));
        assert!(ALERTS_CONTENT_SPECS.get(&key).is_some());

        // Simulate a row written by a pre-upgrade node: content-kind but a
        // body that fails to parse. Must not panic, and must remove the
        // stale entry rather than leaving it behind.
        let broken = content_template(org_id, name, "not valid json");
        apply_template_cache_event(&key, Some(&broken));

        assert!(
            ALERTS_CONTENT_SPECS.get(&key).is_none(),
            "a parse failure on Put must remove any stale cached spec"
        );
        // ALERTS_TEMPLATES still reflects the latest (unparseable) row, since
        // that mirrors the DB state, but no stale spec may accompany it.
        assert_eq!(ALERTS_TEMPLATES.get(&key).unwrap().body, "not valid json");
        assert_caches_agree(&key);
    }

    #[test]
    fn test_apply_delete_removes_from_both_caches() {
        let org_id = "test_org_apply_delete";
        let name = "content-tpl";
        let key = format!("{org_id}/{name}");

        let template = content_template(org_id, name, r#"{"title":"to delete"}"#);
        apply_template_cache_event(&key, Some(&template));
        assert!(ALERTS_TEMPLATES.get(&key).is_some());
        assert!(ALERTS_CONTENT_SPECS.get(&key).is_some());

        apply_template_cache_event(&key, None);

        assert!(
            ALERTS_TEMPLATES.get(&key).is_none(),
            "Delete must remove the template entry"
        );
        assert!(
            ALERTS_CONTENT_SPECS.get(&key).is_none(),
            "Delete must remove the content-spec entry"
        );
        assert_caches_agree(&key);
    }

    #[test]
    fn test_teardown_removes_the_org_tuple_and_the_legacy_name_tuple() {
        assert_eq!(ownership_owners("acme", "tpl", false), ["acme", "tpl"]);
        assert_eq!(ownership_owners("acme", "tpl", true), ["acme"]);
        assert_eq!(ownership_owners("acme", "acme", false), ["acme"]);
    }

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    async fn put_template(org_id: &str, name: &str) {
        table::templates::put(Template {
            id: None,
            org_id: org_id.to_string(),
            name: name.to_string(),
            is_default: false,
            template_type: config::meta::destinations::TemplateType::Http,
            body: r#"{"text":"{alert_name}"}"#.to_string(),
            kind: TemplateKind::Custom,
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_tuple_owners_reads_nothing_when_ownership_is_untracked() {
        if db::authz::tracks_ownership() {
            return;
        }
        let names = ["t_tpl_untracked".to_string()];
        let owners = tuple_owners("t_tpl_untracked_org", &names).await.unwrap();
        assert!(owners.is_empty(), "{owners:?}");
    }

    #[tokio::test]
    async fn test_a_name_another_live_org_holds_keeps_the_legacy_tuple() {
        use table::organizations;
        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let gone = format!("t_tpl_gone_{suffix}");
        let other = format!("t_tpl_other_{suffix}");
        let solo = format!("t_tpl_solo_{suffix}");
        let shared = format!("t_tpl_{suffix}");
        // The shared name sits in the second IN-list batch.
        let mut names: Vec<String> = (0..500).map(|i| format!("t_tpl_absent_{i}")).collect();
        names.extend([solo.clone(), shared.clone()]);
        let owners_of = |owners: HashMap<String, Vec<String>>, name: &str| owners[name].clone();
        put_template(&gone, &solo).await;
        put_template(&gone, &shared).await;
        let alone = owners_by_name(&gone, &names).await.unwrap();
        put_template(&other, &shared).await;
        let unknown_org = owners_by_name(&gone, &names).await.unwrap();
        organizations::add(
            &other,
            &other,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        let mut by_status = vec![];
        for status in ["active", "pending_deletion", "deleting", "deleted"] {
            organizations::set_status(&other, status).await.unwrap();
            let owners = owners_by_name(&gone, &names).await.unwrap();
            by_status.push((status, owners_of(owners, &shared).len()));
        }
        table::templates::delete_by_org(&gone).await.unwrap();
        table::templates::delete_by_org(&other).await.unwrap();
        organizations::remove(&other).await.unwrap();

        assert_eq!(
            owners_of(alone.clone(), &shared),
            [gone.as_str(), shared.as_str()]
        );
        assert_eq!(owners_of(alone, &solo), [gone.as_str(), solo.as_str()]);
        assert_eq!(
            owners_of(unknown_org.clone(), &shared),
            [gone.as_str()],
            "no row: live"
        );
        assert_eq!(
            owners_of(unknown_org, &solo),
            [gone.as_str(), solo.as_str()]
        );
        assert_eq!(
            by_status,
            [
                ("active", 1),
                ("pending_deletion", 1),
                ("deleting", 2),
                ("deleted", 2),
            ]
        );
    }

    #[tokio::test]
    async fn test_a_name_many_live_orgs_hold_comes_back_once() {
        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let name = format!("t_tpl_many_{suffix}");
        let orgs: Vec<String> = (0..3).map(|i| format!("t_tpl_many_{i}_{suffix}")).collect();
        for org in &orgs {
            put_template(org, &name).await;
        }
        let held = table::templates::names_held_by_live_orgs(&orgs[0], std::slice::from_ref(&name))
            .await
            .unwrap();
        for org in &orgs {
            table::templates::delete_by_org(org).await.unwrap();
        }

        assert_eq!(held, [name]);
    }
}
