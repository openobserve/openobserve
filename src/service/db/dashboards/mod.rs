// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::web;

use crate::common::{
    infra::db as infra_db,
    meta::dashboards::{v1, v2, Dashboard, DashboardVersion},
    utils::json,
};

pub mod folders;

#[tracing::instrument]
pub(crate) async fn get(
    org_id: &str,
    dashboard_id: &str,
    folder: &str,
) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{folder}/{dashboard_id}");
    let db = infra_db::get_db().await;
    let bytes = db.get(&key).await?;
    let d_version: DashboardVersion = json::from_slice(&bytes)?;
    if d_version.version == 1 {
        let dash: v1::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v1: Some(dash),
            version: 1,
            ..Default::default()
        })
    } else {
        let dash: v2::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v2: Some(dash),
            version: 2,
            ..Default::default()
        })
    }
}

#[tracing::instrument(skip(body))]
pub(crate) async fn put(
    org_id: &str,
    dashboard_id: &str,
    folder: &str,
    body: web::Bytes,
) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{folder}/{}", dashboard_id);
    let db = infra_db::get_db().await;
    let d_version: DashboardVersion = json::from_slice(&body)?;
    if d_version.version == 1 {
        let mut dash: v1::Dashboard = json::from_slice(&body)?;
        if dash.title.trim().is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();

        match db
            .put(&key, json::to_vec(&dash)?.into(), infra_db::NO_NEED_WATCH)
            .await
        {
            Ok(_) => Ok(Dashboard {
                v1: Some(dash),
                version: 1,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else {
        let mut dash: v2::Dashboard = json::from_slice(&body)?;
        if dash.title.trim().is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        match db
            .put(&key, json::to_vec(&dash)?.into(), infra_db::NO_NEED_WATCH)
            .await
        {
            Ok(_) => Ok(Dashboard {
                v2: Some(dash),
                version: 2,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    }
}

#[tracing::instrument]
pub(crate) async fn list(org_id: &str, folder: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db_key = format!("/dashboard/{org_id}/{folder}/");
    let db = infra_db::get_db().await;
    db.list(&db_key)
        .await?
        .into_values()
        .map(|val| {
            let d_version: DashboardVersion = json::from_slice(&val).unwrap();
            if d_version.version == 1 {
                let dash: v1::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v1: Some(dash),
                    version: 1,
                    ..Default::default()
                })
            } else {
                let dash: v2::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v2: Some(dash),
                    version: 2,
                    ..Default::default()
                })
            }
        })
        .collect()
}

#[tracing::instrument]
pub(crate) async fn delete(
    org_id: &str,
    dashboard_id: &str,
    folder: &str,
) -> Result<(), anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{folder}/{dashboard_id}");
    let db = infra_db::get_db().await;
    Ok(db.delete(&key, false, infra_db::NO_NEED_WATCH).await?)
}

#[tracing::instrument]
pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/dashboard/";
    let db = infra_db::get_db().await;
    Ok(db.delete(key, true, infra_db::NO_NEED_WATCH).await?)
}
