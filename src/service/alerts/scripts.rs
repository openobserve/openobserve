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
        meta::{alerts::scripts::Script, authz::Authz},
        utils::auth::{remove_ownership, set_ownership},
    },
    service::db,
};

pub async fn save(org_id: &str, name: &str, mut script: Script) -> Result<(), anyhow::Error> {
    if script.script.is_empty() {
        return Err(anyhow::anyhow!("Alert script content empty"));
    }
    if !name.is_empty() {
        script.name = name.to_owned();
    }
    if script.name.is_empty() {
        return Err(anyhow::anyhow!("Alert script name is required"));
    }
    if script.name.contains('/') {
        return Err(anyhow::anyhow!("Alert script name cannot contain '/'"));
    }

    match db::alerts::scripts::set(org_id, &mut script).await {
        Ok(_) => {
            if name.is_empty() {
                set_ownership(org_id, "scripts", Authz::new(&script.name)).await;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

pub async fn get(org_id: &str, name: &str) -> Result<Script, anyhow::Error> {
    db::alerts::scripts::get(org_id, name)
        .await
        .map_err(|_| anyhow::anyhow!("Alert script not found"))
}

pub async fn list(org_id: &str) -> Result<Vec<Script>, anyhow::Error> {
    db::alerts::scripts::list(org_id).await
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let cacher = STREAM_ALERTS.read().await;
    for (stream_key, alerts) in cacher.iter() {
        for alert in alerts.iter() {
            if stream_key.starts_with(org_id) && alert.scripts.contains(&name.to_string()) {
                return Err((
                    http::StatusCode::FORBIDDEN,
                    anyhow::anyhow!("Alert script is in use for alert {}", alert.name),
                ));
            }
        }
    }
    drop(cacher);

    if db::alerts::scripts::get(org_id, name).await.is_err() {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert script not found {}", name),
        ));
    }
    match db::alerts::scripts::delete(org_id, name).await {
        Ok(_) => {
            remove_ownership(org_id, "scripts", Authz::new(name)).await;
            Ok(())
        }
        Err(e) => Err((http::StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}
