// Copyright 2024 OpenObserve Inc.
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
use config::{
    meta::stream::StreamType,
    utils::{hash::Sum64, json},
};
use hashbrown::HashMap;
use infra::table::distinct_values::{self, DistinctFieldRecord, OriginType};

use crate::{
    common::meta::dashboards::{v1, v2, v3, v4, v5, Dashboard, DashboardVersion},
    service::{db, stream::save_stream_settings},
};

pub mod folders;
pub mod reports;

async fn add_distinct_field_entry(
    dashboard_id: &str,
    org: &str,
    stream: &str,
    stype: String,
    field: &str,
) -> Result<(), anyhow::Error> {
    let record = DistinctFieldRecord::new(
        OriginType::Dashboard,
        dashboard_id,
        org,
        stream,
        stype,
        field,
    );
    distinct_values::add(record)
        .await
        .map_err(|e| anyhow::anyhow!(e))
}

async fn remove_distinct_field_entry(
    dashboard_id: &str,
    org: &str,
    stream: &str,
    stype: String,
    field: &str,
) -> Result<(), anyhow::Error> {
    let record = DistinctFieldRecord::new(
        OriginType::Dashboard,
        dashboard_id,
        org,
        stream,
        stype,
        field,
    );
    distinct_values::remove(record)
        .await
        .map_err(|e| anyhow::anyhow!(e))
}

/// This big macro helps in covering all 5 versions of dashboards and update the
/// distinct fields for streams used in query based dashboard variables
/// takes org_name, optional old dashboard version bytes, and new dashboard parsed.
/// This will add entries in the distinct table for newly added fields, remove entries for fields
/// which are not there anymore and also add the variables in stream settings when added.
/// This does not remove a variable from stream settings under any condition.
macro_rules! update_distinct_variables {
    ($org:ident, $old:ident, $new_dashboard:ident) => {
        let mut old_variables = get_query_variables($old);

        if let Some(ref vars) = $new_dashboard.variables {
            // from all variables used in dashboard, find the ones which use queries
            // to get data, and store them as mapping from stream_name-type -> field list
            let mut map: HashMap<(&str, &StreamType), Vec<String>> = HashMap::new();
            for v in vars.list.iter() {
                if let Some(ref qd) = v.query_data {
                    map.entry((&qd.stream, &qd.stream_type))
                        .or_default()
                        .push(qd.field.clone());
                }
            }

            for ((name, typ), fields) in map.into_iter() {
                let mut stream_settings = infra::schema::get_settings($org, &name, *typ)
                    .await
                    .unwrap_or_default();
                // we only store distinct values for logs and traces -
                // if anything else, we can ignore.
                if !matches!(typ, StreamType::Logs | StreamType::Traces) {
                    continue;
                }
                // get entry from previous variables corresponding to this stream
                let old_fields = match old_variables.remove(&(name.to_owned(), *typ)) {
                    Some(v) => v,
                    None => vec![],
                };
                let mut _new_added = false;

                for f in fields.iter() {
                    // we add entry for all the fields, because we need mappings for each individual
                    // origin-stream-field mapping. The duplicates are handled in add function, so
                    // we can call it for each field without issues
                    add_distinct_field_entry(
                        &$new_dashboard.dashboard_id,
                        $org,
                        name,
                        typ.to_string(),
                        &f,
                    )
                    .await?;

                    if !stream_settings.distinct_value_fields.contains(&f) {
                        stream_settings.distinct_value_fields.push(f.to_owned());
                        _new_added = true;
                    }
                }
                // here we check if any of the fields used in previous version are no longer used
                // if so, remove their entry.
                for f in old_fields {
                    if !fields.contains(&f) {
                        remove_distinct_field_entry(
                            &$new_dashboard.dashboard_id,
                            $org,
                            name,
                            typ.to_string(),
                            &f,
                        )
                        .await?;
                    }
                }
                if _new_added {
                    save_stream_settings($org, name, *typ, stream_settings).await?;
                }
            }

            // finally, whatever stream remains in the old variables
            // it has all corresponding fields removed, so remove those as well
            for ((name, typ), fields) in old_variables.into_iter() {
                for f in fields {
                    remove_distinct_field_entry(
                        &$new_dashboard.dashboard_id,
                        $org,
                        &name,
                        typ.to_string(),
                        &f,
                    )
                    .await?;
                }
            }
        } else {
            // I guess all the variables were removed from the dashboard.
            // we can batch remove all entries belonging to this dashboard.
            distinct_values::batch_remove(OriginType::Dashboard, &$new_dashboard.dashboard_id)
                .await?
        }
    };
}

macro_rules! _get_variables {
    ($map:ident, $dash:ident) => {
        if let Some(vars) = $dash.variables {
            for v in vars.list.iter() {
                if let Some(ref qd) = v.query_data {
                    $map.entry((qd.stream.clone(), qd.stream_type))
                        .or_default()
                        .push(qd.field.clone());
                }
            }
        }
    };
}

fn get_query_variables(
    dashboard: Option<web::Bytes>,
) -> HashMap<(String, StreamType), Vec<String>> {
    let mut map: HashMap<(String, StreamType), Vec<String>> = HashMap::new();
    let dashboard = if let Some(d) = dashboard {
        d
    } else {
        return map;
    };
    let d_version: DashboardVersion = json::from_slice(&dashboard).unwrap();
    if d_version.version == 1 {
        let dash: v1::Dashboard = json::from_slice(&dashboard).unwrap();
        _get_variables!(map, dash);
    } else if d_version.version == 2 {
        let dash: v2::Dashboard = json::from_slice(&dashboard).unwrap();
        _get_variables!(map, dash);
    } else if d_version.version == 3 {
        let dash: v3::Dashboard = json::from_slice(&dashboard).unwrap();
        _get_variables!(map, dash);
    } else if d_version.version == 4 {
        let dash: v4::Dashboard = json::from_slice(&dashboard).unwrap();
        _get_variables!(map, dash);
    } else {
        let dash: v5::Dashboard = json::from_slice(&dashboard).unwrap();
        _get_variables!(map, dash);
    }
    map
}

#[tracing::instrument]
pub(crate) async fn get(
    org_id: &str,
    dashboard_id: &str,
    folder: &str,
) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{folder}/{dashboard_id}");
    let bytes = db::get(&key).await?;
    let dash_str = std::str::from_utf8(&bytes)?;
    let hash = config::utils::hash::gxhash::new()
        .sum64(dash_str)
        .to_string();
    let d_version: DashboardVersion = json::from_slice(&bytes)?;
    if d_version.version == 1 {
        let dash: v1::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v1: Some(dash),
            version: 1,
            hash,
            ..Default::default()
        })
    } else if d_version.version == 2 {
        let dash: v2::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v2: Some(dash),
            version: 2,
            hash,
            ..Default::default()
        })
    } else if d_version.version == 3 {
        let dash: v3::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v3: Some(dash),
            version: 3,
            hash,
            ..Default::default()
        })
    } else if d_version.version == 4 {
        let dash: v4::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v4: Some(dash),
            version: 4,
            hash,
            ..Default::default()
        })
    } else {
        let dash: v5::Dashboard = json::from_slice(&bytes)?;
        Ok(Dashboard {
            v5: Some(dash),
            version: 5,
            hash,
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
    hash: Option<&str>,
) -> Result<Dashboard, anyhow::Error> {
    let key = format!("/dashboard/{org_id}/{folder}/{}", dashboard_id);
    let mut old_version = None;
    if let Ok(existing_dash_bytes) = db::get(&key).await {
        let existing_dash_str = std::str::from_utf8(&existing_dash_bytes)?;
        let existing_dash_hash = config::utils::hash::gxhash::new().sum64(existing_dash_str);
        let Some(Ok(hash_val)) = hash.map(|hash_str| hash_str.parse::<u64>()) else {
            return Err(anyhow::anyhow!(
                "Request to update existing dashboard with missing or invalid hash value. BUG"
            ));
        };
        if hash_val != existing_dash_hash {
            return Err(anyhow::anyhow!(
                "Conflict: Failed to save due to concurrent changes. Please refresh the page after backing up your work to avoid losing changes."
            ));
        }
        old_version = Some(existing_dash_bytes);
    };
    let d_version: DashboardVersion = json::from_slice(&body)?;
    if d_version.version == 1 {
        let mut dash: v1::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        let value: bytes::Bytes = json::to_vec(&dash)?.into();
        let dash_str = std::str::from_utf8(&value)?;
        let hash = config::utils::hash::gxhash::new()
            .sum64(dash_str)
            .to_string();

        update_distinct_variables!(org_id, old_version, dash);
        match db::put(&key, value, db::NO_NEED_WATCH, None).await {
            Ok(_) => Ok(Dashboard {
                v1: Some(dash),
                version: 1,
                hash,
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
        let value: bytes::Bytes = json::to_vec(&dash)?.into();
        let dash_str = std::str::from_utf8(&value)?;
        let hash = config::utils::hash::gxhash::new()
            .sum64(dash_str)
            .to_string();

        update_distinct_variables!(org_id, old_version, dash);
        match db::put(&key, value, db::NO_NEED_WATCH, None).await {
            Ok(_) => Ok(Dashboard {
                v2: Some(dash),
                version: 2,
                hash,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else if d_version.version == 3 {
        let mut dash: v3::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        let value: bytes::Bytes = json::to_vec(&dash)?.into();
        let dash_str = std::str::from_utf8(&value)?;
        let hash = config::utils::hash::gxhash::new()
            .sum64(dash_str)
            .to_string();

        update_distinct_variables!(org_id, old_version, dash);
        match db::put(&key, value, db::NO_NEED_WATCH, None).await {
            Ok(_) => Ok(Dashboard {
                v3: Some(dash),
                version: 3,
                hash,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else if d_version.version == 4 {
        let mut dash: v4::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        let value: bytes::Bytes = json::to_vec(&dash)?.into();
        let dash_str = std::str::from_utf8(&value)?;
        let hash = config::utils::hash::gxhash::new()
            .sum64(dash_str)
            .to_string();

        update_distinct_variables!(org_id, old_version, dash);
        match db::put(&key, value, db::NO_NEED_WATCH, None).await {
            Ok(_) => Ok(Dashboard {
                v4: Some(dash),
                version: 4,
                hash,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    } else {
        let mut dash: v5::Dashboard = json::from_slice(&body)?;
        dash.title = dash.title.trim().to_string();
        if dash.title.is_empty() {
            return Err(anyhow::anyhow!("Dashboard should have title"));
        };
        dash.dashboard_id = dashboard_id.to_string();
        let value: bytes::Bytes = json::to_vec(&dash)?.into();
        let dash_str = std::str::from_utf8(&value)?;
        let hash = config::utils::hash::gxhash::new()
            .sum64(dash_str)
            .to_string();

        update_distinct_variables!(org_id, old_version, dash);
        match db::put(&key, value, db::NO_NEED_WATCH, None).await {
            Ok(_) => Ok(Dashboard {
                v5: Some(dash),
                version: 5,
                hash,
                ..Default::default()
            }),
            Err(_) => Err(anyhow::anyhow!("Failed to save Dashboard")),
        }
    }
}

#[tracing::instrument]
pub(crate) async fn list(org_id: &str, folder: &str) -> Result<Vec<Dashboard>, anyhow::Error> {
    let db_key = format!("/dashboard/{org_id}/{folder}/");
    db::list(&db_key)
        .await?
        .into_values()
        .map(|val| {
            let dash_str = std::str::from_utf8(&val)?;
            let hash = config::utils::hash::gxhash::new()
                .sum64(dash_str)
                .to_string();
            let d_version: DashboardVersion = json::from_slice(&val).unwrap();
            if d_version.version == 1 {
                let dash: v1::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v1: Some(dash),
                    version: 1,
                    hash,
                    ..Default::default()
                })
            } else if d_version.version == 2 {
                let dash: v2::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v2: Some(dash),
                    version: 2,
                    hash,
                    ..Default::default()
                })
            } else if d_version.version == 3 {
                let dash: v3::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v3: Some(dash),
                    version: 3,
                    hash,
                    ..Default::default()
                })
            } else if d_version.version == 4 {
                let dash: v4::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v4: Some(dash),
                    version: 4,
                    hash,
                    ..Default::default()
                })
            } else {
                let dash: v5::Dashboard = json::from_slice(&val).unwrap();
                Ok(Dashboard {
                    v5: Some(dash),
                    version: 5,
                    hash,
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
    distinct_values::batch_remove(OriginType::Dashboard, dashboard_id).await?;
    Ok(db::delete(&key, false, db::NO_NEED_WATCH, None).await?)
}

#[tracing::instrument]
pub async fn reset() -> Result<(), anyhow::Error> {
    let key = "/dashboard/";
    let ids: Vec<_> = db::list(&key)
        .await?
        .into_values()
        .map(|val| {
            let d_version: DashboardVersion = json::from_slice(&val).unwrap();
            if d_version.version == 1 {
                let dash: v1::Dashboard = json::from_slice(&val).unwrap();
                dash.dashboard_id
            } else if d_version.version == 2 {
                let dash: v2::Dashboard = json::from_slice(&val).unwrap();
                dash.dashboard_id
            } else if d_version.version == 3 {
                let dash: v3::Dashboard = json::from_slice(&val).unwrap();
                dash.dashboard_id
            } else if d_version.version == 4 {
                let dash: v4::Dashboard = json::from_slice(&val).unwrap();
                dash.dashboard_id
            } else {
                let dash: v5::Dashboard = json::from_slice(&val).unwrap();
                dash.dashboard_id
            }
        })
        .collect();
    for id in ids {
        distinct_values::batch_remove(OriginType::Dashboard, &id).await?;
    }
    Ok(db::delete(key, true, db::NO_NEED_WATCH, None).await?)
}
