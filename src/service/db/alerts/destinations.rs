// Copyright 2025 OpenObserve Inc.
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

use std::{net::IpAddr, sync::Arc};

use config::meta::destinations::Destination;
use infra::table;
use itertools::Itertools;

use crate::{common::infra::config::DESTINATIONS, service::db};

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
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("URL targets restricted address (private IP, localhost, or metadata endpoint): {0}")]
    RestrictedUrl(String),
    #[error("SNS destination must have Topic ARN and Region")]
    InvalidSns,
    #[error("Email destination must have at least one email recipient")]
    EmptyEmail,
    #[error("Email destination recipients must be part of this org")]
    UserNotPermitted,
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
    #[error("Destination is currently used by alert: {0}")]
    UsedByAlert(String),
    #[error("Destination is currently used by pipeline: {0}")]
    UsedByPipeline(String),
    #[cfg(feature = "enterprise")]
    #[error("Invalid action id: {0}")]
    InvalidActionId(anyhow::Error),
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
        &saved.org_id, &saved.name
    );
    infra::coordinator::destinations::emit_put_event(&event_key).await?;
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
            "[Destination] error triggering super cluster event to add destination to cache: {e}"
        );
    }

    Ok(saved)
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), DestinationError> {
    if table::destinations::get(org_id, name).await?.is_none() {
        return Err(DestinationError::NotFound);
    }
    table::destinations::delete(org_id, name).await?;

    // trigger watch event to update in-memory cache
    let event_key = format!("{DESTINATION_WATCHER_PREFIX}{org_id}/{name}");
    // in-cluster
    infra::coordinator::destinations::emit_delete_event(&event_key).await?;
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
            "[Destination] error triggering super cluster event to remove destination from cache: {e}"
        );
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
                let item_value: Destination = match table::destinations::get(org_id, name).await {
                    Ok(Some(dest)) => dest,
                    Ok(None) => {
                        log::error!("Destination not found in db");
                        continue;
                    }
                    Err(e) => {
                        log::error!("Error getting from db: {e}");
                        continue;
                    }
                };
                DESTINATIONS.insert(format!("{org_id}/{name}"), item_value);
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
        .ok_or(anyhow::anyhow!("event key missing prefix"))?;
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

/// Validates URL to prevent SSRF attacks
///
/// NOTE: This validation occurs at save time. For complete SSRF protection,
/// additional validation should be performed at request time to prevent
/// DNS rebinding attacks (where a domain resolves to different IPs over time).
pub fn validate_url(url_str: &str) -> Result<(), DestinationError> {
    // Parse URL
    let url = url::Url::parse(url_str)
        .map_err(|e| DestinationError::InvalidUrl(format!("Failed to parse URL: {}", e)))?;

    // Only allow http and https schemes
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(DestinationError::InvalidUrl(format!(
            "Only http and https schemes are allowed, got: {}",
            scheme
        )));
    }

    // Get host
    let host = url
        .host_str()
        .ok_or_else(|| DestinationError::InvalidUrl("URL must have a host".to_string()))?;

    // Check for localhost
    if host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host.starts_with("127.")
        || host.ends_with(".localhost")
    {
        return Err(DestinationError::RestrictedUrl(format!(
            "localhost not allowed: {}",
            host
        )));
    }

    // Check for metadata endpoints
    if host == "169.254.169.254" || host == "fd00:ec2::254" {
        return Err(DestinationError::RestrictedUrl(
            "Cloud metadata endpoints not allowed".to_string(),
        ));
    }

    // Try to parse as IP address
    if let Ok(ip) = host.parse::<IpAddr>() {
        // Check for restricted IP addresses
        if is_restricted_ip(&ip) {
            return Err(DestinationError::RestrictedUrl(format!(
                "Restricted IP address not allowed: {}",
                ip
            )));
        }
    } else {
        // For domain names, perform basic DNS resolution to check if it resolves to a private IP
        // This helps prevent attackers from using domains that point to internal addresses
        if let Ok(addrs) = std::net::ToSocketAddrs::to_socket_addrs(&format!("{}:80", host)) {
            for addr in addrs {
                let ip = addr.ip();
                if is_restricted_ip(&ip) {
                    return Err(DestinationError::RestrictedUrl(format!(
                        "Domain '{}' resolves to restricted IP address: {}",
                        host, ip
                    )));
                }
            }
        }
    }

    Ok(())
}

/// Checks if an IP address is restricted (private, reserved, or special-purpose)
fn is_restricted_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            let octets = ipv4.octets();
            // 0.0.0.0/8 (this network)
            octets[0] == 0
            // 10.0.0.0/8 (private)
            || octets[0] == 10
            // 127.0.0.0/8 (loopback)
            || octets[0] == 127
            // 169.254.0.0/16 (link-local)
            || (octets[0] == 169 && octets[1] == 254)
            // 172.16.0.0/12 (private)
            || (octets[0] == 172 && (octets[1] >= 16 && octets[1] <= 31))
            // 192.168.0.0/16 (private)
            || (octets[0] == 192 && octets[1] == 168)
            // 224.0.0.0/4 (multicast)
            || (octets[0] >= 224 && octets[0] <= 239)
            // 240.0.0.0/4 (reserved) and 255.255.255.255 (broadcast)
            || octets[0] >= 240
        }
        IpAddr::V6(ipv6) => {
            let segments = ipv6.segments();
            // ::1 (loopback)
            ipv6.is_loopback()
            // :: (unspecified)
            || ipv6.is_unspecified()
            // fe80::/10 (link-local)
            || (segments[0] & 0xffc0) == 0xfe80
            // fc00::/7 (unique local)
            || (segments[0] & 0xfe00) == 0xfc00
            // ff00::/8 (multicast)
            || (segments[0] & 0xff00) == 0xff00
        }
    }
}
