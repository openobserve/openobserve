// Copyright 2023 Zinc Labs Inc.
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

use actix_web::http;

use crate::{
    common::{
        infra::config::STREAM_ALERTS,
        meta::{
            alerts::destinations::{Destination, DestinationWithTemplate},
            authz::Authz,
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::db,
};

pub async fn save(
    org_id: &str,
    name: &str,
    mut destination: Destination,
) -> Result<(), anyhow::Error> {
    if db::alerts::templates::get(org_id, &destination.template)
        .await
        .is_err()
    {
        return Err(anyhow::anyhow!(
            "Alert template {} not found",
            destination.template
        ));
    }
    if !name.is_empty() {
        destination.name = name.to_string();
    }
    if destination.name.is_empty() {
        return Err(anyhow::anyhow!("Alert destination name is required"));
    }
    if destination.name.contains('/') {
        return Err(anyhow::anyhow!("Alert destination name cannot contain '/'"));
    }

    match db::alerts::destinations::set(org_id, &destination).await {
        Ok(_) => {
            if name.is_empty() {
                set_ownership(org_id, "destinations", Authz::new(&destination.name)).await;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

pub async fn get(org_id: &str, name: &str) -> Result<Destination, anyhow::Error> {
    db::alerts::destinations::get(org_id, name)
        .await
        .map_err(|_| anyhow::anyhow!("Alert destination not found"))
}

pub async fn get_with_template(
    org_id: &str,
    name: &str,
) -> Result<DestinationWithTemplate, anyhow::Error> {
    let dest = get(org_id, name).await?;
    let template = db::alerts::templates::get(org_id, &dest.template).await?;
    Ok(dest.with_template(template))
}

pub async fn list(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Destination>, anyhow::Error> {
    match db::alerts::destinations::list(org_id).await {
        Ok(destinations) => {
            let mut result = Vec::new();
            for dest in destinations {
                if permitted.is_none()
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("destination:{}", dest.name))
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("destination:{}", org_id))
                {
                    result.push(dest);
                }
            }
            Ok(result)
        }
        Err(e) => Err(e),
    }
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let cacher = STREAM_ALERTS.read().await;
    for (stream_key, alerts) in cacher.iter() {
        for alert in alerts.iter() {
            if stream_key.starts_with(org_id) && alert.destinations.contains(&name.to_string()) {
                return Err((
                    http::StatusCode::FORBIDDEN,
                    anyhow::anyhow!("Alert destination is in use for alert {}", alert.name),
                ));
            }
        }
    }
    drop(cacher);

    if db::alerts::destinations::get(org_id, name).await.is_err() {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert destination not found {}", name),
        ));
    }

    match db::alerts::destinations::delete(org_id, name).await {
        Ok(_) => {
            remove_ownership(org_id, "destinations", Authz::new(name)).await;
            Ok(())
        }
        Err(e) => Err((http::StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}
