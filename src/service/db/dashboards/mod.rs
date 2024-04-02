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

use actix_web::web;
use config::utils::json;
use infra::db as infra_db;

use crate::common::meta::dashboards::{v1, v2, v3, Dashboard, DashboardVersion};

pub mod folders;
pub mod reports;

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
    } else if d_version.version == 2 {
        let dash: v2::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v2: Some(dash),
            version: 2,
            ..Default::default()
        })
    } else {
        let dash: v3::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v3: Some(dash),
            version: 3,
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
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();

        match db
            .put(
                &key,
                json::to_vec(&dash)?.into(),
                infra_db::NO_NEED_WATCH,
                None,
            )
            .await
        {
            Ok(_) => Ok(Dashboard {
                v1: Some(dash),
                version: 1,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else if d_version.version == 2 {
        let mut dash: v2::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        match db
            .put(
                &key,
                json::to_vec(&dash)?.into(),
                infra_db::NO_NEED_WATCH,
                None,
            )
            .await
        {
            Ok(_) => Ok(Dashboard {
                v2: Some(dash),
                version: 2,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else {
        let mut dash: v3::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        match db
            .put(
                &key,
                json::to_vec(&dash)?.into(),
                infra_db::NO_NEED_WATCH,
                None,
            )
            .await
        {
            Ok(_) => Ok(Dashboard {
                v3: Some(dash),
                version: 3,
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
            } else if d_version.version == 2 {
                let dash: v2::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v2: Some(dash),
                    version: 2,
                    ..Default::default()
                })
            } else {
                let dash: v3::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v3: Some(dash),
                    version: 3,
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
    Ok(db
        .delete(&key, false, infra_db::NO_NEED_WATCH, None)
        .await?)
}

#[tracing::instrument]
pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/dashboard/";
    let db = infra_db::get_db().await;
    Ok(db.delete(key, true, infra_db::NO_NEED_WATCH, None).await?)
}
