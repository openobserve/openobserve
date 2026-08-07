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

use std::sync::Arc;

use common::infra::config::{ALERTS, ALERTS_CONTENT_SPECS, ALERTS_TEMPLATES, DESTINATIONS};
use config::{
    DEFAULT_ORG,
    meta::{
        alerts::content_spec::ContentSpec,
        destinations::{Module, Template, TemplateKind},
    },
};
use infra::table;
use itertools::Itertools;

use crate as db;

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
    infra::coordinator::destinations::emit_put_event(&event_key).await?;
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
            "[Template] error triggering super cluster event to add template to cache: {e}"
        );
    }

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), TemplateError> {
    // Check if template is used by any destination
    for dest in DESTINATIONS.iter() {
        let d = dest.value();
        if (dest.key().starts_with(org_id) || dest.key().starts_with(DEFAULT_ORG))
            && matches!(&d.module, Module::Alert { template: Some(t), .. } if t.eq(name))
        {
            return Err(TemplateError::DeleteWithDestination(dest.name.to_string()));
        }
    }

    // Check if template is used by any alert directly
    let alerts_cache = ALERTS.read().await;
    for (key, (_folder, alert)) in alerts_cache.iter() {
        if (key.starts_with(org_id) || key.starts_with(DEFAULT_ORG))
            && alert.template.as_ref().is_some_and(|t| t.eq(name))
        {
            return Err(TemplateError::DeleteWithAlert(alert.name.to_string()));
        }
    }
    drop(alerts_cache);

    let event_key = match table::templates::get(org_id, name).await? {
        None => return Err(TemplateError::NotFound),
        Some(temp) => format!("{TEMPLATE_WATCHER_PREFIX}{}/{}", temp.org_id, temp.name),
    };

    table::templates::delete(org_id, name).await?;

    // trigger watch event to update in-memory cache
    // in-cluster
    infra::coordinator::destinations::emit_delete_event(&event_key).await?;
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
            "[Template] error triggering super cluster event to remove template from cache: {e}"
        );
    }

    Ok(())
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
                        log::error!("Template not found in db");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting from db: {e}");
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
