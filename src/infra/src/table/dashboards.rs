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

use config::meta::{
    dashboards::{
        v1::Dashboard as DashboardV1, v2::Dashboard as DashboardV2, v3::Dashboard as DashboardV3,
        v4::Dashboard as DashboardV4, v5::Dashboard as DashboardV5, Dashboard,
        ListDashboardsParams,
    },
    folder::{Folder, FolderType},
};
use sea_orm::{
    prelude::Expr, sea_query::Func, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, Set, TryIntoModel,
};
use serde_json::Value as JsonValue;
use svix_ksuid::KsuidLike;

use super::{
    distinct_values::{self, OriginType},
    entity::{dashboards, folders},
    folders::folder_type_into_i16,
};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, GetDashboardError},
};

impl TryFrom<dashboards::Model> for Dashboard {
    type Error = errors::Error;

    fn try_from(mut value: dashboards::Model) -> Result<Self, Self::Error> {
        if let Some(obj) = value.data.as_object_mut() {
            // The domain model JSON deserialization logic for v1-v5 expects
            // some or all these fields to be present in the JSON even though we
            // store them in DB columns. Therefore we add these values back into
            // the JSON object so that deserializing the JSON can succeed.
            obj.insert("dashboardId".to_owned(), value.dashboard_id.into());
            obj.insert("version".to_owned(), value.version.into());
            obj.insert("owner".to_owned(), value.owner.into());
            obj.insert("role".to_owned(), value.role.unwrap_or_default().into());
            obj.insert("title".to_owned(), value.title.into());
            obj.insert(
                "description".to_owned(),
                value.description.unwrap_or_default().into(),
            );
            obj.insert("updatedAt".to_owned(), value.updated_at.into());
        }

        match value.version {
            1 => {
                let inner: DashboardV1 = serde_json::from_value(value.data)?;
                let dash = inner.into();
                Ok(dash)
            }
            2 => {
                let inner: DashboardV2 = serde_json::from_value(value.data)?;
                let dash = inner.into();
                Ok(dash)
            }
            3 => {
                let inner: DashboardV3 = serde_json::from_value(value.data)?;
                let dash = inner.into();
                Ok(dash)
            }
            4 => {
                let inner: DashboardV4 = serde_json::from_value(value.data)?;
                let dash = inner.into();
                Ok(dash)
            }
            5 => {
                let inner: DashboardV5 = serde_json::from_value(value.data)?;
                let dash = inner.into();
                Ok(dash)
            }
            _ => Err(GetDashboardError::UnsupportedVersion(value.version).into()),
        }
    }
}

/// Gets a dashboard by it's folder ID and dashboard ID.
///
/// This method differs from [get_by_id] in that it will only return the
/// dashboard if it is found in the specified folder, whereas [get_by_id] will
/// return the dashboard if it is found in any folder.
pub async fn get_from_folder(
    org_id: &str,
    folder_id: &str,
    dashboard_id: &str,
) -> Result<Option<Dashboard>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = get_model_from_folder(client, org_id, folder_id, dashboard_id)
        .await?
        .and_then(|(_folder, maybe_dash)| maybe_dash);

    if let Some(model) = model {
        let dash = model.try_into()?;
        Ok(Some(dash))
    } else {
        Ok(None)
    }
}

/// Gets a dashboard by it's dashboard ID.
///
/// This method differs from [get] in that it will return the dashboard if it is
/// found in any folder, whereas [get] will only return the dashboard if it is
/// found in the specified folder.
pub async fn get_by_id(
    org_id: &str,
    dashboard_id: &str,
) -> Result<Option<(Folder, Dashboard)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let Some((folder_m, dash_m)) = get_model_by_id(client, org_id, dashboard_id).await? else {
        return Ok(None);
    };
    let folder = folder_m.into();
    let dash = dash_m.try_into()?;
    Ok(Some((folder, dash)))
}

/// Lists dashboards.
pub async fn list(params: ListDashboardsParams) -> Result<Vec<(Folder, Dashboard)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dashboards = list_models(client, params)
        .await?
        .into_iter()
        .map(|(f, d)| {
            let f = Folder::from(f);
            let d = Dashboard::try_from(d)?;
            Ok((f, d))
        })
        .collect::<Result<_, errors::Error>>()?;
    Ok(dashboards)
}

/// Lists all existing dashboards
pub async fn list_all() -> Result<Vec<(String, Dashboard)>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let dashboards = list_all_models(client)
        .await?
        .into_iter()
        .map(|(org, db)| Ok((org, Dashboard::try_from(db)?)))
        .collect::<Result<_, errors::Error>>()?;
    Ok(dashboards)
}

/// Creates a new dashboard or updates an existing dashboard in the database.
/// Returns the new or updated dashboard.
///
/// `clone` is a boolean that determines whether the dashboard should be cloned.
/// if `clone` is true, the given dashboard will be used as it is when saving to db.
/// `clone` should be always true for super cluster.
pub async fn put(
    org_id: &str,
    folder_id: &str,
    new_folder_id: Option<&str>,
    mut dashboard: Dashboard,
    clone: bool,
) -> Result<Dashboard, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Get the fields that will be inserted into or updated in the database.
    let dashboard_id = dashboard
        .dashboard_id()
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
        .ok_or(errors::PutDashboardError::MissingDashboardId)?
        .to_owned();
    let owner = dashboard
        .owner()
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
        .ok_or(errors::PutDashboardError::MissingOwner)?
        .to_owned();
    let title = dashboard
        .title()
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
        .ok_or(errors::PutDashboardError::MissingTitle)?
        .to_owned();
    let role = dashboard
        .role()
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
        .map(|r| r.to_owned());
    let description = dashboard
        .description()
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
        .map(|d| d.to_owned());
    let version = dashboard.version;
    let created_at_depricated = dashboard.created_at_deprecated();
    if clone {
        dashboard.set_updated_at();
    }
    let updated_at = dashboard.updated_at;
    let data = inner_data_as_json(dashboard)?;

    // Try to get the new folder if the dashboard is being moved to a new folder.
    let maybe_new_folder_model = if let Some(new_folder_id) = new_folder_id {
        let new_folder_model = folders::Entity::find()
            .filter(folders::Column::Org.eq(org_id))
            .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Dashboards)))
            .filter(folders::Column::FolderId.eq(new_folder_id))
            .one(client)
            .await?
            .ok_or(errors::PutDashboardError::FolderDoesNotExist)?;
        Some(new_folder_model)
    } else {
        None
    };

    let dashboard_model =
        match get_model_from_folder(client, org_id, folder_id, &dashboard_id).await? {
            None => {
                // Destination folder does not exist so the dashboard can neither be
                // created nor updated.
                Err(errors::PutDashboardError::FolderDoesNotExist)
            }
            Some((folder_m, Some(dash_m))) => {
                // Destination folder exists and dashboard already exists, so
                // update the dashboard.

                // If the dashboard is being to a new folder, then update the folder ID foreign key.
                // Otherwise keep using the older folder ID foreign key.
                let folder_id = if let Some(new_folder_model) = maybe_new_folder_model {
                    new_folder_model.id
                } else {
                    folder_m.id
                };

                let mut dash_am = dash_m.into_active_model();
                dash_am.folder_id = Set(folder_id);
                dash_am.owner = Set(owner);
                dash_am.role = Set(role);
                dash_am.title = Set(title);
                dash_am.description = Set(description);
                dash_am.data = Set(data);
                dash_am.version = Set(version);
                dash_am.updated_at = Set(updated_at);
                let model: dashboards::Model = dash_am.update(client).await?.try_into_model()?;
                Ok(model)
            }
            Some((folder_m, None)) => {
                // Destination folder exists but dashboard does not exist, so create
                // a new dashboard.
                // TODO: Use timestamp in microseconds like all other resources
                let created_at_unix: i64 = if let Some(created_at_tz) = created_at_depricated {
                    created_at_tz.timestamp()
                } else {
                    chrono::Utc::now().timestamp()
                };

                let dash_am = dashboards::ActiveModel {
                    id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
                    dashboard_id: Set(dashboard_id.to_owned()),
                    folder_id: Set(folder_m.id),
                    owner: Set(owner),
                    role: Set(role),
                    title: Set(title),
                    description: Set(description),
                    data: Set(data),
                    version: Set(version),
                    created_at: Set(created_at_unix),
                    updated_at: Set(updated_at),
                };
                let model: dashboards::Model = dash_am.insert(client).await?.try_into_model()?;
                Ok(model)
            }
        }?;

    let dash = dashboard_model.try_into()?;
    Ok(dash)
}

/// Deletes a dashboard with the given `folder_id` and `dashboard_id` surrogate
/// keys.
pub async fn delete_from_folder(
    org_id: &str,
    folder_id: &str,
    dashboard_id: &str,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let model = get_model_from_folder(client, org_id, folder_id, dashboard_id)
        .await?
        .and_then(|(_folder, maybe_dash)| maybe_dash);

    if let Some(model) = model {
        let _ = model.delete(client).await?;
    }

    Ok(())
}

/// Deletes all dashboards.
pub async fn delete_all() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let dashboards = list_all().await?;
    let ids: Vec<_> = dashboards
        .iter()
        .map(|(_, d)| d.dashboard_id().unwrap())
        .collect();
    // remove all distinct values
    for id in ids {
        distinct_values::batch_remove(OriginType::Dashboard, id).await?;
    }

    dashboards::Entity::delete_many().exec(client).await?;
    Ok(())
}

/// Tries to get a dashboard ORM entity and its parent folder ORM entity.
async fn get_model_from_folder(
    db: &DatabaseConnection,
    org_id: &str,
    folder_id: &str,
    dashboard_id: &str,
) -> Result<Option<(folders::Model, Option<dashboards::Model>)>, sea_orm::DbErr> {
    let select_folders = folders::Entity::find()
        .filter(folders::Column::Org.eq(org_id))
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Dashboards)))
        .filter(folders::Column::FolderId.eq(folder_id));

    let Some(folder) = select_folders.one(db).await? else {
        return Ok(None);
    };

    let maybe_dashboard = folder
        .find_related(dashboards::Entity)
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .one(db)
        .await?;

    Ok(Some((folder, maybe_dashboard)))
}

/// Tries to get a dashboard ORM entity and its parent folder ORM entity by the
/// dashboard ID.
async fn get_model_by_id(
    db: &DatabaseConnection,
    org_id: &str,
    dashboard_id: &str,
) -> Result<Option<(folders::Model, dashboards::Model)>, sea_orm::DbErr> {
    let f_and_d = dashboards::Entity::find()
        .filter(dashboards::Column::DashboardId.eq(dashboard_id))
        .find_also_related(folders::Entity)
        .filter(folders::Column::Org.eq(org_id))
        .one(db)
        .await?
        .and_then(|(d, maybe_f)| maybe_f.map(|f| (f, d)));
    Ok(f_and_d)
}

/// Lists dashboard ORM models using the given parameters. Returns each
/// dashboard and its parent folder.
async fn list_models(
    db: &DatabaseConnection,
    params: ListDashboardsParams,
) -> Result<Vec<(folders::Model, dashboards::Model)>, sea_orm::DbErr> {
    let query = dashboards::Entity::find()
        .find_also_related(folders::Entity)
        .filter(folders::Column::Org.eq(params.org_id))
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Dashboards)));

    // Apply the optional folder_id filter.
    let query = if let Some(folder_id) = &params.folder_id {
        query.filter(folders::Column::FolderId.eq(folder_id))
    } else {
        query
    };

    // Apply the optional title substring filter.
    let title_pat = params
        .title_pat
        .and_then(|p| if p.is_empty() { None } else { Some(p) });
    let query = if let Some(title_pat) = title_pat {
        let pattern = format!("%{}%", title_pat.to_lowercase());
        query.filter(Expr::expr(Func::lower(Expr::col(dashboards::Column::Title))).like(pattern))
    } else {
        query
    };

    // Apply ordering.
    let query = query
        .order_by_asc(dashboards::Column::Title)
        .order_by_asc(folders::Column::Name);

    // Execute the query, either getting all results or a specific page of results.
    let results = if let Some((page_size, page_idx)) = params.page_size_and_idx {
        query.paginate(db, page_size).fetch_page(page_idx).await?
    } else {
        query.all(db).await?
    };

    // Flatten the results so that each dashboard is returned alongside its
    // parent folder.
    let folders_and_dashboards = results
        .into_iter()
        .filter_map(|(d, maybe_f)| maybe_f.map(|f| (f, d)))
        .collect();
    Ok(folders_and_dashboards)
}

/// Lists all existing dashboard ORM models
async fn list_all_models(
    db: &DatabaseConnection,
) -> Result<Vec<(String, dashboards::Model)>, sea_orm::DbErr> {
    let query = folders::Entity::find()
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Dashboards)));

    // Apply ordering. Confusingly, it is necessary to apply the ordering BEFORE
    // adding a join to the query builder. If we don't do this then Sea ORM will
    // always sort on the join key (folder.id) before any other sorting
    // conditions.
    let query = query.order_by(dashboards::Column::Title, sea_orm::Order::Asc);

    // Left join on dashboards table.
    let query = query.find_with_related(dashboards::Entity);

    let dashboards = query
        .all(db)
        .await?
        .into_iter()
        .flat_map(|(folder, ds)| ds.into_iter().map(move |d| (folder.org.clone(), d)))
        .collect();
    Ok(dashboards)
}

/// Converts the [Dashboard] into the JSON represention of the inner data that
/// will be stored in the data column of the database.
///
/// The returned JSON object should exclude any field that will be stored in
/// database columns. The schema of the JSON object will vary depending on the
/// dashboard version.
fn inner_data_as_json(dashboard: Dashboard) -> Result<JsonValue, errors::Error> {
    let mut data: JsonValue = match dashboard {
        Dashboard {
            version: 1,
            v1: Some(inner),
            ..
        } => serde_json::to_value(inner).map_err(errors::Error::SerdeJsonError),
        Dashboard {
            version: 2,
            v2: Some(inner),
            ..
        } => serde_json::to_value(inner).map_err(errors::Error::SerdeJsonError),
        Dashboard {
            version: 3,
            v3: Some(inner),
            ..
        } => serde_json::to_value(inner).map_err(errors::Error::SerdeJsonError),
        Dashboard {
            version: 4,
            v4: Some(inner),
            ..
        } => serde_json::to_value(inner).map_err(errors::Error::SerdeJsonError),
        Dashboard {
            version: 5,
            v5: Some(inner),
            ..
        } => serde_json::to_value(inner).map_err(errors::Error::SerdeJsonError),
        Dashboard { version: v, .. } => Err(errors::PutDashboardError::MissingInnerData(v).into()),
    }?;

    // Remove fields that will be saved in DB columns from the JSON blob so that
    // we are not storing the same value in two different places and risking
    // desynchronization.
    if let Some(obj) = data.as_object_mut() {
        obj.remove("dashboard_id");
        obj.remove("version");
        obj.remove("owner");
        obj.remove("role");
        obj.remove("title");
        obj.remove("description");
    }

    Ok(data)
}

#[cfg(test)]
mod tests {
    use sea_orm::{entity::prelude::*, DatabaseBackend, MockDatabase, Transaction};

    use super::*;

    #[tokio::test]
    async fn list_models_psql() -> Result<(), DbErr> {
        let db = MockDatabase::new(DatabaseBackend::Postgres)
            .append_query_results([Vec::<dashboards::Model>::new()])
            .into_connection();
        let params = ListDashboardsParams {
            org_id: "orgId".to_owned(),
            folder_id: Some("folderId".to_owned()),
            title_pat: Some("tItLePat".to_owned()),
            page_size_and_idx: Some((100, 2)),
        };
        list_models(&db, params).await?;
        assert_eq!(
            db.into_transaction_log(),
            vec![Transaction::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"SELECT "dashboards"."id" AS "A_id", "dashboards"."dashboard_id" AS "A_dashboard_id", "dashboards"."folder_id" AS "A_folder_id", "dashboards"."owner" AS "A_owner", "dashboards"."role" AS "A_role", "dashboards"."title" AS "A_title", "dashboards"."description" AS "A_description", "dashboards"."data" AS "A_data", "dashboards"."version" AS "A_version", "dashboards"."created_at" AS "A_created_at", "dashboards"."updated_at" AS "A_updated_at", "folders"."id" AS "B_id", "folders"."org" AS "B_org", "folders"."folder_id" AS "B_folder_id", "folders"."name" AS "B_name", "folders"."description" AS "B_description", "folders"."type" AS "B_type" FROM "dashboards" LEFT JOIN "folders" ON "dashboards"."folder_id" = "folders"."id" WHERE "folders"."org" = $1 AND "folders"."type" = $2 AND "folders"."folder_id" = $3 AND LOWER("title") LIKE $4 ORDER BY "dashboards"."title" ASC, "folders"."name" ASC LIMIT $5 OFFSET $6"#,
                [
                    "orgId".into(),
                    0i16.into(),
                    "folderId".into(),
                    "%titlepat%".into(),
                    100u64.into(),
                    200u64.into()
                ]
            )]
        );
        Ok(())
    }

    #[tokio::test]
    async fn list_models_mysql() -> Result<(), DbErr> {
        let db = MockDatabase::new(DatabaseBackend::MySql)
            .append_query_results([Vec::<dashboards::Model>::new()])
            .into_connection();
        let params = ListDashboardsParams {
            org_id: "orgId".to_owned(),
            folder_id: Some("folderId".to_owned()),
            title_pat: Some("tItLePat".to_owned()),
            page_size_and_idx: Some((100, 2)),
        };
        list_models(&db, params).await?;
        assert_eq!(
            db.into_transaction_log(),
            vec![Transaction::from_sql_and_values(
                DatabaseBackend::MySql,
                r#"SELECT `dashboards`.`id` AS `A_id`, `dashboards`.`dashboard_id` AS `A_dashboard_id`, `dashboards`.`folder_id` AS `A_folder_id`, `dashboards`.`owner` AS `A_owner`, `dashboards`.`role` AS `A_role`, `dashboards`.`title` AS `A_title`, `dashboards`.`description` AS `A_description`, `dashboards`.`data` AS `A_data`, `dashboards`.`version` AS `A_version`, `dashboards`.`created_at` AS `A_created_at`, `dashboards`.`updated_at` AS `A_updated_at`, `folders`.`id` AS `B_id`, `folders`.`org` AS `B_org`, `folders`.`folder_id` AS `B_folder_id`, `folders`.`name` AS `B_name`, `folders`.`description` AS `B_description`, `folders`.`type` AS `B_type` FROM `dashboards` LEFT JOIN `folders` ON `dashboards`.`folder_id` = `folders`.`id` WHERE `folders`.`org` = ? AND `folders`.`type` = ? AND `folders`.`folder_id` = ? AND LOWER(`title`) LIKE ? ORDER BY `dashboards`.`title` ASC, `folders`.`name` ASC LIMIT ? OFFSET ?"#,
                [
                    "orgId".into(),
                    0i16.into(),
                    "folderId".into(),
                    "%titlepat%".into(),
                    100u64.into(),
                    200u64.into()
                ]
            )]
        );
        Ok(())
    }

    #[tokio::test]
    async fn list_models_sqlite() -> Result<(), DbErr> {
        let db = MockDatabase::new(DatabaseBackend::Sqlite)
            .append_query_results([Vec::<dashboards::Model>::new()])
            .into_connection();
        let params = ListDashboardsParams {
            org_id: "orgId".to_owned(),
            folder_id: Some("folderId".to_owned()),
            title_pat: Some("tItLePat".to_owned()),
            page_size_and_idx: Some((100, 2)),
        };
        list_models(&db, params).await?;
        assert_eq!(
            db.into_transaction_log(),
            vec![Transaction::from_sql_and_values(
                DatabaseBackend::Sqlite,
                r#"SELECT "dashboards"."id" AS "A_id", "dashboards"."dashboard_id" AS "A_dashboard_id", "dashboards"."folder_id" AS "A_folder_id", "dashboards"."owner" AS "A_owner", "dashboards"."role" AS "A_role", "dashboards"."title" AS "A_title", "dashboards"."description" AS "A_description", "dashboards"."data" AS "A_data", "dashboards"."version" AS "A_version", "dashboards"."created_at" AS "A_created_at", "dashboards"."updated_at" AS "A_updated_at", "folders"."id" AS "B_id", "folders"."org" AS "B_org", "folders"."folder_id" AS "B_folder_id", "folders"."name" AS "B_name", "folders"."description" AS "B_description", "folders"."type" AS "B_type" FROM "dashboards" LEFT JOIN "folders" ON "dashboards"."folder_id" = "folders"."id" WHERE "folders"."org" = ? AND "folders"."type" = ? AND "folders"."folder_id" = ? AND LOWER("title") LIKE ? ORDER BY "dashboards"."title" ASC, "folders"."name" ASC LIMIT ? OFFSET ?"#,
                [
                    "orgId".into(),
                    0i16.into(),
                    "folderId".into(),
                    "%titlepat%".into(),
                    100u64.into(),
                    200u64.into()
                ]
            )]
        );
        Ok(())
    }
}
