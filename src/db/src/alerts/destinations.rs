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

use common::{infra::config::DESTINATIONS, meta::authz::Authz};
use config::meta::destinations::Destination;
use infra::table;
use itertools::Itertools;

use crate::{self as db, authz::remove_ownership};

// db cache watcher prefix
const DESTINATION_WATCHER_PREFIX: &str = "/destinations/";

#[derive(Debug, thiserror::Error)]
pub enum DestinationError {
    #[error("InfraError# {0}")]
    InfraError(#[from] infra::errors::Error),
    #[error("Destination must contain either template or pipeline id")]
    UnsupportedType,
    #[error("Destination name cannot be empty")]
    EmptyName,
    #[error(
        "Destination name cannot contain ':', '#', '?', '&', '%', '/', quotes and space characters"
    )]
    InvalidName,
    #[error("HTTP destination must have a url")]
    EmptyUrl,
    #[error("Destination URL blocked by SSRF guard: {0}")]
    SsrfBlocked(String),
    #[error("SNS destination must have Topic ARN and Region")]
    InvalidSns,
    #[error("Email destination must have at least one email recipient")]
    EmptyEmail,
    #[error("Email destination recipients must be part of this org: {0}")]
    UserNotPermitted(String),
    #[error("Email destination must have SMTP configured")]
    SMTPUnavailable,
    #[error("Alert destination must have a template")]
    TemplateNotFound,
    #[error("Pipeline destination must have a pipeline id")]
    EmptyPipelineId,
    #[error("Destination with the same name already exists")]
    AlreadyExists,
    #[error("Destination not found")]
    NotFound,
    #[error("Prebuilt template not found for type: {0}")]
    PrebuiltTemplateNotFound(String),
    #[error("Failed to create template: {0}")]
    TemplateCreationFailed(String),
    #[error("Failed to retrieve template: {0}")]
    TemplateRetrievalFailed(String),
    #[error("Email send failed: {0}")]
    EmailSendFailed(String),
    #[error("LLM Evaluation destinations are only supported for pipelines, not alerts")]
    NotSupportedAlertDestinationType,
    #[error("{0}")]
    InUse(String),
    #[error("Slack app needs Enterprise")]
    SlackAppNeedsEnterprise,
    #[error("{0}")]
    SlackApp(SlackAppRefusal),
}

/// A refused Slack app save; `code` lets the form show its own copy (MK-7, MK-20).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct SlackAppRefusal {
    #[serde(skip)]
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
}

impl SlackAppRefusal {
    pub fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            team: None,
            destination: None,
        }
    }
}

impl std::fmt::Display for SlackAppRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

pub async fn get(org_id: &str, name: &str) -> Result<Destination, DestinationError> {
    let map_key = format!("{org_id}/{name}");
    if let Some(val) = DESTINATIONS.get(&map_key) {
        return Ok(val.value().clone());
    }
    table::destinations::get(org_id, name)
        .await?
        .ok_or(DestinationError::NotFound)
}

pub async fn set(destination: Destination) -> Result<Destination, DestinationError> {
    let saved = table::destinations::put(destination).await?;

    // trigger watch event to update in-memory cache
    let event_key = format!(
        "{DESTINATION_WATCHER_PREFIX}{}/{}",
        saved.org_id, saved.name
    );
    infra::coordinator::emit_put(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::destinations_put(
            &event_key,
            saved.clone(),
        )
        .await
    {
        log::error!(
            "[Destination] error triggering super cluster event to add destination to cache: org_id: {}, error: {e}",
            saved.org_id
        );
    }

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    // By row, not decode, so a row only a newer release can read is still deletable here.
    if !table::destinations::exists_row(org_id, name).await? {
        return Err(DestinationError::NotFound);
    }
    table::destinations::delete(org_id, name).await?;

    // trigger watch event to update in-memory cache
    let event_key = format!("{DESTINATION_WATCHER_PREFIX}{org_id}/{name}");
    // in-cluster
    infra::coordinator::emit_delete(&event_key).await?;
    // super cluster
    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::destinations_delete(
            &event_key, org_id, name,
        )
        .await
    {
        log::error!(
            "[Destination] error triggering super cluster event to remove destination from cache: org_id: {org_id}, error: {e}"
        );
    }

    Ok(())
}

/// Org teardown: eviction and ownership go before each row, so a failure leaves the row to retry.
pub async fn delete_by_org(org_id: &str) -> Result<(), DestinationError> {
    let names = table::destinations::list_names_by_org(org_id).await?;
    let local = |name: String| async move {
        DESTINATIONS.remove(&format!("{org_id}/{name}"));
    };
    let broadcast = |name: String| async move {
        let event_key = format!("{DESTINATION_WATCHER_PREFIX}{org_id}/{name}");
        infra::coordinator::emit_delete(&event_key).await?;
        #[cfg(feature = "enterprise")]
        if o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
            && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::destinations_delete(
                &event_key, org_id, &name,
            )
            .await
        {
            log::error!(
                "[Destination] error triggering super cluster event to remove destination from cache: org_id: {org_id}, error: {e}"
            );
        }
        Ok::<(), DestinationError>(())
    };
    db::teardown::evict_then_delete(names, &local, &broadcast, |name: String| async move {
        remove_ownership(org_id, "destinations", Authz::new(&name)).await;
        table::destinations::delete(org_id, &name).await?;
        Ok(())
    })
    .await?;
    // The org-wide delete names any row the listing missed, so it still loses its copies.
    for name in table::destinations::delete_by_org(org_id).await? {
        remove_ownership(org_id, "destinations", Authz::new(&name)).await;
        db::teardown::evict(local(name.clone()), broadcast(name)).await?;
    }
    Ok(())
}

pub async fn list(
    org_id: &str,
    module: Option<&str>,
) -> Result<Vec<Destination>, DestinationError> {
    let cache = DESTINATIONS.clone();
    if !cache.is_empty() {
        let org_filter = format!("{org_id}/");
        return Ok(cache
            .iter()
            .filter_map(|dest| {
                let k = dest.key();
                if k.starts_with(&org_filter) {
                    let dest = dest.value().clone();
                    if let Some(module) = module {
                        let module = module.to_lowercase();
                        (dest.module.to_string() == module).then_some(dest)
                    } else {
                        Some(dest)
                    }
                } else {
                    None
                }
            })
            .sorted_by(|a, b| a.name.cmp(&b.name))
            .collect());
    }

    Ok(table::destinations::list(org_id, module).await?)
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator
        .watch(DESTINATION_WATCHER_PREFIX)
        .await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching alert destinations");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_alert_destinations: event channel closed");
                break;
            }
        };
        match ev {
            db::Event::Put(ev) => {
                let (org_id, name) = match parse_event_key(DESTINATION_WATCHER_PREFIX, &ev.key) {
                    Ok(parsed) => parsed,
                    Err(e) => {
                        log::error!("{e}");
                        continue;
                    }
                };
                match table::destinations::get(org_id, name).await {
                    Ok(read) => cache_put(org_id, name, read),
                    Err(e) => {
                        log::error!("Error getting from db: org_id: {org_id}, error: {e}");
                    }
                }
            }
            db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(DESTINATION_WATCHER_PREFIX).unwrap();
                DESTINATIONS.remove(item_key);
            }
            db::Event::Empty => {}
        }
    }
    Ok(())
}

/// Caches the row a Put event names; a row this node cannot read drops the stale copy, so a save
/// here reaches the database's newer-row guard.
fn cache_put(org_id: &str, name: &str, read: Option<Destination>) {
    match read {
        Some(dest) => {
            DESTINATIONS.insert(format!("{org_id}/{name}"), dest);
        }
        None => {
            log::error!("Destination {org_id}/{name} not readable here; dropping the cached copy");
            DESTINATIONS.remove(&format!("{org_id}/{name}"));
        }
    }
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let all_dest = table::destinations::list_all().await?;
    for dest in all_dest {
        let item_key = format!("{}/{}", dest.org_id, dest.name);
        DESTINATIONS.insert(item_key, dest);
    }
    log::info!("{} destinations Cached", DESTINATIONS.len());
    Ok(())
}

pub(super) fn parse_event_key<'a>(
    prefix: &'static str,
    event_key: &'a str,
) -> Result<(&'a str, &'a str), anyhow::Error> {
    let item_key = event_key
        .strip_prefix(prefix)
        .ok_or_else(|| anyhow::anyhow!("event key missing prefix"))?;
    let mut keys = item_key.split('/');
    let org_id = keys
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing org_id in event key"))?;
    let name = keys
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing name in event key"))?;

    if keys.next().is_some() {
        return Err(anyhow::anyhow!(
            "Error: event key not formatted correctly. Should be org_id/name, but got {}",
            item_key
        ));
    }

    Ok((org_id, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: &str = "/destinations/";

    #[test]
    fn test_parse_event_key_valid() {
        let key = "/destinations/myorg/my-dest";
        let (org, name) = parse_event_key(PREFIX, key).unwrap();
        assert_eq!(org, "myorg");
        assert_eq!(name, "my-dest");
    }

    #[test]
    fn test_parse_event_key_missing_prefix() {
        let key = "myorg/my-dest";
        let result = parse_event_key(PREFIX, key);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("missing prefix"));
    }

    #[test]
    fn test_parse_event_key_too_many_parts() {
        let key = "/destinations/myorg/my-dest/extra";
        let result = parse_event_key(PREFIX, key);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_event_key_missing_name() {
        let key = "/destinations/myorg/";
        let result = parse_event_key(PREFIX, key);
        assert!(result.is_ok());
        let (org, name) = result.unwrap();
        assert_eq!(org, "myorg");
        assert_eq!(name, "");
    }

    #[test]
    fn a_put_this_node_cannot_read_drops_the_stale_cached_copy() {
        let org = format!("stale_{}", config::ider::uuid());
        let key = format!("{org}/d");
        DESTINATIONS.insert(
            key.clone(),
            Destination {
                org_id: org.clone(),
                name: "d".to_string(),
                ..Default::default()
            },
        );
        cache_put(&org, "d", None);
        assert!(!DESTINATIONS.contains_key(&key));
    }

    #[test]
    fn test_destination_error_display_empty_name() {
        let e = DestinationError::EmptyName;
        assert_eq!(e.to_string(), "Destination name cannot be empty");
    }

    #[test]
    fn test_destination_error_display_not_found() {
        let e = DestinationError::NotFound;
        assert_eq!(e.to_string(), "Destination not found");
    }

    #[test]
    fn test_destination_error_display_already_exists() {
        let e = DestinationError::AlreadyExists;
        assert_eq!(
            e.to_string(),
            "Destination with the same name already exists"
        );
    }

    #[tokio::test]
    async fn delete_removes_undecodable_row() {
        use config::meta::destinations::{DestinationType, Endpoint, Module};
        use sea_orm::ConnectionTrait;

        std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        let org = format!("r128_{}", config::ider::uuid());
        set(Destination {
            org_id: org.clone(),
            name: "slack-dest".to_string(),
            module: Module::Alert {
                template: None,
                destination_type: DestinationType::Http(Endpoint {
                    url: "https://example.com".to_string(),
                    ..Default::default()
                }),
            },
            ..Default::default()
        })
        .await
        .unwrap();
        infra::db::get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                r#"UPDATE destinations SET type='{{"type":"from_a_newer_release"}}' WHERE org='{org}' AND name='slack-dest'"#
            ))
            .await
            .unwrap();

        delete(&org, "slack-dest").await.unwrap();
        assert!(
            !table::destinations::exists_row(&org, "slack-dest")
                .await
                .unwrap()
        );
        assert!(matches!(
            delete(&org, "slack-dest").await,
            Err(DestinationError::NotFound)
        ));
    }

    #[test]
    fn test_destination_error_display_in_use() {
        let e = DestinationError::InUse("'x' is used by 1 alert".to_string());
        assert_eq!(e.to_string(), "'x' is used by 1 alert");
    }
}
