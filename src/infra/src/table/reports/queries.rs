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

use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use config::meta::{
    dashboards::reports::{
        ListReportsParams, Report as MetaReport, ReportDashboard as MetaReportDashboard,
        ReportDashboardVariable as MetaReportDashboardVariable,
        ReportDestination as MetaReportDestination, ReportFrequency as MetaReportFrequency,
        ReportTimerange as MetaReportTimeRange,
    },
    folder::{Folder as MetaFolder, FolderType},
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, QueryOrder,
    QuerySelect, RelationTrait, SelectModel, Selector,
};
use serde_json::{Value as Json, json};

use super::{
    super::{
        entity::{dashboards, folders, report_dashboards, reports},
        folders::folder_type_into_i16,
    },
    intermediate,
};

/// The results of querying for an individual `reports` record, it's related report `folders`
/// record, and its related `report_dashboards`, `dashboards`, and dashboard `folders` records.
#[derive(Debug)]
pub struct SelectReportAndJoinRelationsResult {
    pub report: reports::Model,
    pub report_folder: folders::Model,
    pub joined_dashboards: Vec<JoinReportDashboardFolderResults>,
}

impl SelectReportAndJoinRelationsResult {
    pub async fn get<C: ConnectionTrait>(
        conn: &C,
        org_id: &str,
        folder_snowflake_id: &str,
        report_name: &str,
    ) -> Result<Option<Self>, super::Error> {
        let Some((folder_model, Some(report_model))) =
            get_report_from_folder(conn, org_id, folder_snowflake_id, report_name).await?
        else {
            return Ok(None);
        };
        let joined_dashboard_models =
            JoinReportDashboardFolderResults::get(conn, &report_model.id).await?;
        Ok(Some(Self {
            report: report_model,
            report_folder: folder_model,
            joined_dashboards: joined_dashboard_models,
        }))
    }

    /// Tries to get a report SeaORM entity and its parent folder SeaORM entity.
    pub async fn get_by_id<C: ConnectionTrait>(
        conn: &C,
        report_id: &str,
    ) -> Result<Option<Self>, super::Error> {
        let Some((report_model, Some(folder_model))) =
            get_report_and_folder_from_id(conn, report_id).await?
        else {
            return Ok(None);
        };
        let joined_dashboard_models =
            JoinReportDashboardFolderResults::get(conn, &report_model.id).await?;
        Ok(Some(Self {
            report: report_model,
            report_folder: folder_model,
            joined_dashboards: joined_dashboard_models,
        }))
    }
}

/// Tries to get a report SeaORM entity and its parent folder SeaORM entity.
pub async fn get_report_from_folder<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    folder_snowflake_id: &str,
    report_name: &str,
) -> Result<Option<(folders::Model, Option<reports::Model>)>, sea_orm::DbErr> {
    let results = folders::Entity::find()
        .find_also_related(reports::Entity)
        .filter(folders::Column::Org.eq(org_id))
        .filter(folders::Column::Type.eq::<i16>(folder_type_into_i16(FolderType::Reports)))
        .filter(folders::Column::FolderId.eq(folder_snowflake_id))
        .filter(reports::Column::Name.eq(report_name))
        .one(conn)
        .await?;
    Ok(results)
}

/// Tries to get a report SeaORM entity and its parent folder SeaORM entity.
pub async fn get_report_and_folder_from_id<C: ConnectionTrait>(
    conn: &C,
    report_id: &str,
) -> Result<Option<(reports::Model, Option<folders::Model>)>, sea_orm::DbErr> {
    let result = reports::Entity::find()
        .find_also_related(folders::Entity)
        .filter(reports::Column::Id.eq(report_id))
        .one(conn)
        .await?;
    Ok(result)
}

/// Tries to get a report SeaORM entity by its ID.
pub async fn _get_report_from_id<C: ConnectionTrait>(
    conn: &C,
    report_id: &str,
) -> Result<Option<reports::Model>, sea_orm::DbErr> {
    let result = reports::Entity::find()
        .filter(reports::Column::Id.eq(report_id))
        .one(conn)
        .await?;
    Ok(result)
}

/// A result of querying for the related `report_dashboards`, `dashboards`, and dashboard `folder`
/// records for a single `reports` record.
///
/// At the time of writing SeaORM does not have a way to chain calls to `find_also_related` to
/// generate a query that joins more than two tables. Since we need to join `report_dashboards` onto
/// `dashboards` and then onto `folders` we need to use a custom query.
#[derive(Debug, FromQueryResult)]
pub struct JoinReportDashboardFolderResults {
    /// KSUID primary key of the report.
    pub report_id: String,

    /// The `tab_names` JSON field from the `report_dashboards` table.
    pub report_dashboard_tab_names: Json,

    /// The `variables` JSON field from the `report_dashboards` table.
    pub report_dashboard_variables: Json,

    /// The `timerange` JSON field from the `report_dashboards` table.
    pub report_dashboard_timerange: Json,

    /// KSUID primary key of the dashboard.
    pub dashboard_id: String,

    /// Snowflake ID of the dashboard.
    pub dashboard_snowflake_id: String,

    /// KSUID primary key of the dashboard's parent folder.
    pub dashboard_folder_id: String,

    /// Snowflake ID of the dashboard's parent folder.
    pub dashboard_folder_snowflake_id: String,
}

impl JoinReportDashboardFolderResults {
    /// Executes the query to get the related `report_dashboards`, `dashboards`, and dashboard
    /// `folders` records for the given report.
    pub async fn get<C: ConnectionTrait>(
        conn: &C,
        report_id: &str,
    ) -> Result<Vec<Self>, sea_orm::DbErr> {
        let rslts = Self::select(report_id).all(conn).await?;
        Ok(rslts)
    }

    /// Returns the query to get the related `report_dashboards`, `dashboards`, and dashboard
    /// `folders` records for the given report.
    fn select(report_id: &str) -> Selector<SelectModel<Self>> {
        report_dashboards::Entity::find()
            .column_as(report_dashboards::Column::ReportId, "report_id")
            .column_as(
                report_dashboards::Column::TabNames,
                "report_dashboard_tab_names",
            )
            .column_as(
                report_dashboards::Column::Variables,
                "report_dashboard_variables",
            )
            .column_as(
                report_dashboards::Column::Timerange,
                "report_dashboard_timerange",
            )
            .column_as(dashboards::Column::Id, "dashboard_id")
            .column_as(dashboards::Column::DashboardId, "dashboard_snowflake_id")
            .column_as(folders::Column::Id, "dashboard_folder_id")
            .column_as(folders::Column::FolderId, "dashboard_folder_snowflake_id")
            .join(
                sea_orm::JoinType::InnerJoin,
                report_dashboards::Relation::Dashboards.def(),
            )
            .join(
                sea_orm::JoinType::InnerJoin,
                dashboards::Relation::Folders.def(),
            )
            .filter(report_dashboards::Column::ReportId.eq(report_id.to_owned()))
            .into_model::<Self>()
    }
}

impl TryFrom<SelectReportAndJoinRelationsResult> for (MetaFolder, MetaReport) {
    type Error = super::Error;

    fn try_from(value: SelectReportAndJoinRelationsResult) -> Result<Self, Self::Error> {
        let report_model = value.report;
        let report_folder_model = value.report_folder;
        let joined_dashboard_models = value.joined_dashboards;

        let frequency_intermediate: intermediate::ReportFrequency =
            serde_json::from_value(report_model.frequency)?;
        let frequency: MetaReportFrequency = frequency_intermediate.into();

        let dashboards: Result<Vec<MetaReportDashboard>, _> = joined_dashboard_models
            .into_iter()
            .map(MetaReportDashboard::try_from)
            .collect();
        let dashboards = dashboards?;

        let destinations_intermediate: intermediate::ReportDestinations =
            serde_json::from_value(report_model.destinations)?;
        let destinations: Vec<MetaReportDestination> = destinations_intermediate.into();

        // Transform the Unix timestamps into datetimes that will always use the UTC timezone.
        let created_at_utc: DateTime<FixedOffset> = Utc
            .timestamp_micros(report_model.created_at)
            .unwrap() // The timezone always produces a result.
            .into();
        let updated_at_utc: Option<DateTime<FixedOffset>> = report_model
            .updated_at
            .and_then(|micros| Utc.timestamp_micros(micros).single())
            .map(|dt| dt.into());

        let org_id = report_folder_model.org.clone();
        let report_folder: MetaFolder = report_folder_model.into();
        let report = MetaReport {
            name: report_model.name,
            title: report_model.title,
            org_id,
            frequency,
            start: report_model.start_at,
            dashboards,
            destinations,
            description: report_model.description.unwrap_or_default(),
            message: report_model.message.unwrap_or_default(),
            enabled: report_model.enabled,
            media_type: config::meta::dashboards::reports::ReportMediaType::Pdf,
            timezone: report_model.timezone,
            tz_offset: report_model.tz_offset,
            created_at: created_at_utc,
            updated_at: updated_at_utc,
            owner: report_model.owner.unwrap_or_default(),
            last_edited_by: report_model.last_edited_by.unwrap_or_default(),
        };

        Ok((report_folder, report))
    }
}

impl TryFrom<JoinReportDashboardFolderResults> for MetaReportDashboard {
    type Error = super::Error;

    fn try_from(value: JoinReportDashboardFolderResults) -> Result<Self, Self::Error> {
        let tab_names_intermediate: intermediate::TabNames =
            serde_json::from_value(value.report_dashboard_tab_names)?;
        let tab_names: Vec<String> = tab_names_intermediate.into();

        let variables_intermediate: intermediate::ReportDashboardVariables =
            serde_json::from_value(value.report_dashboard_variables)?;
        let variables: Vec<MetaReportDashboardVariable> = variables_intermediate.into();

        let timerange_intermediate: intermediate::ReportTimerange =
            serde_json::from_value(value.report_dashboard_timerange)?;
        let timerange: MetaReportTimeRange = timerange_intermediate.into();

        Ok(Self {
            dashboard: value.dashboard_snowflake_id,
            folder: value.dashboard_folder_snowflake_id,
            tabs: tab_names,
            variables,
            timerange,
        })
    }
}

/// A result of querying for the reports joined on `folders` by the report's folder ID, joined on
/// `report_dashboards`, and joined on `dashboards`.
///
/// At the time of writing SeaORM does not have a way to chain calls to `find_also_related` to
/// generate a query that joins more than two tables. Since we need to join `reports` onto
/// `folders`, `report_dashboards`, and `dashboards` need to use a custom query.
#[derive(Debug, FromQueryResult)]
pub struct ListReportsQueryResult {
    /// KSUID primary key of the report.
    pub report_id: String,
    pub report_name: String,
    pub report_owner: Option<String>,
    pub report_description: Option<String>,
    pub report_created_at: i64,
    pub report_frequency: Json,
    /// KSUID primary key of the dashboard.
    pub report_dashboard_id: String,
    pub report_dashboard_tab_names: Json,
    /// The `timerange` JSON field from the `report_dashboards` table.
    pub report_dashboard_timerange: Json,
    /// Snowflake ID of the dashboard.
    pub dashboard_snowflake_id: String,
    pub org_id: String,
    pub folder_id: String,
    pub folder_name: String,
    pub report_enabled: bool,
}

impl ListReportsQueryResult {
    /// Executes the query to select the reports that satisfy the given parameters.
    pub async fn get<C: ConnectionTrait>(
        conn: &C,
        params: &ListReportsParams,
    ) -> Result<Vec<Self>, sea_orm::DbErr> {
        let rslts = Self::select(params).all(conn).await?;
        log::info!("rslts: {rslts:?}");
        Ok(rslts)
    }

    /// Returns the query that selects the reports that satisfy the given parameters.
    fn select(params: &ListReportsParams) -> Selector<SelectModel<Self>> {
        let mut query = reports::Entity::find()
            .column_as(reports::Column::Id, "report_id")
            .column_as(reports::Column::Name, "report_name")
            .column_as(reports::Column::Owner, "report_owner")
            .column_as(reports::Column::Description, "report_description")
            .column_as(reports::Column::CreatedAt, "report_created_at")
            .column_as(reports::Column::Frequency, "report_frequency")
            .column_as(folders::Column::FolderId, "folder_id")
            .column_as(folders::Column::Name, "folder_name")
            .column_as(reports::Column::Enabled, "report_enabled")
            .column_as(
                report_dashboards::Column::DashboardId,
                "report_dashboard_id",
            )
            .column_as(
                report_dashboards::Column::TabNames,
                "report_dashboard_tab_names",
            )
            .column_as(
                report_dashboards::Column::Variables,
                "report_dashboard_variables",
            )
            .column_as(
                report_dashboards::Column::Timerange,
                "report_dashboard_timerange",
            )
            .column_as(dashboards::Column::DashboardId, "dashboard_snowflake_id")
            .column_as(folders::Column::Org, "org_id")
            .join(
                sea_orm::JoinType::InnerJoin,
                reports::Relation::Folders.def(),
            )
            .join(
                sea_orm::JoinType::InnerJoin,
                reports::Relation::ReportDashboards.def(),
            )
            .join(
                sea_orm::JoinType::InnerJoin,
                report_dashboards::Relation::Dashboards.def(),
            );

        // Add filters.
        query = query.filter(folders::Column::Org.eq(&params.org_id));
        if let Some(folder_snowflake_id) = &params.folder_snowflake_id {
            query = query.filter(folders::Column::FolderId.eq(folder_snowflake_id.to_owned()));
        }
        if let Some(dashboard_snowflake_id) = &params.dashboard_snowflake_id {
            query =
                query.filter(dashboards::Column::DashboardId.eq(dashboard_snowflake_id.to_owned()));
        }
        if let Some(true) = &params.has_destinations {
            query = query.filter(reports::Column::Destinations.ne(json!([])));
        }
        if let Some(false) = &params.has_destinations {
            query = query.filter(reports::Column::Destinations.eq(json!([])));
        }

        // Order and paginate results.
        query = query
            .order_by_asc(reports::Column::Name)
            .order_by_asc(folders::Column::Name);
        if let Some((page_size, page_idx)) = params.page_size_and_idx {
            query = query.offset(page_size * page_idx).limit(page_size);
        }

        query.into_model::<Self>()
    }
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn join_report_dashboards_folder_results() {
        const REPORT_ID: &str = "TEST_REPORT_ID";
        let postgres_statement = JoinReportDashboardFolderResults::select(REPORT_ID)
            .into_statement(sea_orm::DatabaseBackend::Postgres)
            .to_string();
        collapsed_eq!(
            &postgres_statement,
            r#"
                SELECT 
                "report_dashboards"."report_id",
                "report_dashboards"."dashboard_id",
                "report_dashboards"."tab_names",
                "report_dashboards"."variables",
                "report_dashboards"."timerange",
                "report_dashboards"."report_id" AS "report_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."id" AS "dashboard_id",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."id" AS "dashboard_folder_id",
                "folders"."folder_id" AS "dashboard_folder_snowflake_id" 
                FROM "report_dashboards" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                INNER JOIN "folders" ON "dashboards"."folder_id" = "folders"."id" 
                WHERE "report_dashboards"."report_id" = 'TEST_REPORT_ID'
            "#
        );

        let mysql_statement = JoinReportDashboardFolderResults::select(REPORT_ID)
            .into_statement(sea_orm::DatabaseBackend::MySql)
            .to_string();
        collapsed_eq!(
            &mysql_statement,
            r#"
                SELECT 
                `report_dashboards`.`report_id`,
                `report_dashboards`.`dashboard_id`,
                `report_dashboards`.`tab_names`,
                `report_dashboards`.`variables`,
                `report_dashboards`.`timerange`,
                `report_dashboards`.`report_id` AS `report_id`,
                `report_dashboards`.`tab_names` AS `report_dashboard_tab_names`,
                `report_dashboards`.`variables` AS `report_dashboard_variables`,
                `report_dashboards`.`timerange` AS `report_dashboard_timerange`,
                `dashboards`.`id` AS `dashboard_id`,
                `dashboards`.`dashboard_id` AS `dashboard_snowflake_id`,
                `folders`.`id` AS `dashboard_folder_id`,
                `folders`.`folder_id` AS `dashboard_folder_snowflake_id` 
                FROM `report_dashboards` 
                INNER JOIN `dashboards` ON `report_dashboards`.`dashboard_id` = `dashboards`.`id` 
                INNER JOIN `folders` ON `dashboards`.`folder_id` = `folders`.`id` 
                WHERE `report_dashboards`.`report_id` = 'TEST_REPORT_ID'
            "#
        );

        let sqlite_statement = JoinReportDashboardFolderResults::select(REPORT_ID)
            .into_statement(sea_orm::DatabaseBackend::Sqlite)
            .to_string();
        collapsed_eq!(
            &sqlite_statement,
            r#"
                SELECT 
                "report_dashboards"."report_id",
                "report_dashboards"."dashboard_id",
                "report_dashboards"."tab_names",
                "report_dashboards"."variables",
                "report_dashboards"."timerange",
                "report_dashboards"."report_id" AS "report_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."id" AS "dashboard_id",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."id" AS "dashboard_folder_id",
                "folders"."folder_id" AS "dashboard_folder_snowflake_id" 
                FROM "report_dashboards" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                INNER JOIN "folders" ON "dashboards"."folder_id" = "folders"."id" 
                WHERE "report_dashboards"."report_id" = 'TEST_REPORT_ID'
            "#
        );
    }

    #[test]
    fn list_reports_with_no_optional_params() {
        const ORG_ID: &str = "TEST_ORG_ID";
        let params = ListReportsParams::new(ORG_ID);

        let postgres_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::Postgres)
            .to_string();
        collapsed_eq!(
            &postgres_statement,
            r#"
                SELECT 
                "reports"."id",
                "reports"."org",
                "reports"."folder_id",
                "reports"."name",
                "reports"."title",
                "reports"."description",
                "reports"."enabled",
                "reports"."frequency",
                "reports"."destinations",
                "reports"."message",
                "reports"."timezone",
                "reports"."tz_offset",
                "reports"."owner",
                "reports"."last_edited_by",
                "reports"."created_at",
                "reports"."updated_at",
                "reports"."start_at",
                "reports"."id" AS "report_id",
                "reports"."name" AS "report_name",
                "reports"."owner" AS "report_owner",
                "reports"."description" AS "report_description",
                "reports"."created_at" AS "report_created_at",
                "reports"."frequency" AS "report_frequency",
                "folders"."folder_id" AS "folder_id",
                "folders"."name" AS "folder_name",
                "reports"."enabled" AS "report_enabled",
                "report_dashboards"."dashboard_id" AS "report_dashboard_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."org" AS "org_id" FROM "reports" 
                INNER JOIN "folders" ON "reports"."folder_id" = "folders"."id" 
                INNER JOIN "report_dashboards" ON "reports"."id" = "report_dashboards"."report_id" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                WHERE "folders"."org" = 'TEST_ORG_ID' 
                ORDER BY 
                "reports"."name" ASC,
                "folders"."name" ASC 
            "#
        );

        let mysql_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::MySql)
            .to_string();
        collapsed_eq!(
            &mysql_statement,
            r#"
                SELECT 
                `reports`.`id`,
                `reports`.`org`,
                `reports`.`folder_id`,
                `reports`.`name`,
                `reports`.`title`,
                `reports`.`description`,
                `reports`.`enabled`,
                `reports`.`frequency`,
                `reports`.`destinations`,
                `reports`.`message`,
                `reports`.`timezone`,
                `reports`.`tz_offset`,
                `reports`.`owner`,
                `reports`.`last_edited_by`,
                `reports`.`created_at`,
                `reports`.`updated_at`,
                `reports`.`start_at`,
                `reports`.`id` AS `report_id`,
                `reports`.`name` AS `report_name`,
                `reports`.`owner` AS `report_owner`,
                `reports`.`description` AS `report_description`,
                `reports`.`created_at` AS `report_created_at`,
                `reports`.`frequency` AS `report_frequency`,
                `folders`.`folder_id` AS `folder_id`,
                `folders`.`name` AS `folder_name`,
                `reports`.`enabled` AS `report_enabled`,
                `report_dashboards`.`dashboard_id` AS `report_dashboard_id`,
                `report_dashboards`.`tab_names` AS `report_dashboard_tab_names`,
                `report_dashboards`.`variables` AS `report_dashboard_variables`,
                `report_dashboards`.`timerange` AS `report_dashboard_timerange`,
                `dashboards`.`dashboard_id` AS `dashboard_snowflake_id`,
                `folders`.`org` AS `org_id`
                FROM `reports` 
                INNER JOIN `folders` ON `reports`.`folder_id` = `folders`.`id` 
                INNER JOIN `report_dashboards` ON `reports`.`id` = `report_dashboards`.`report_id` 
                INNER JOIN `dashboards` ON `report_dashboards`.`dashboard_id` = `dashboards`.`id` 
                WHERE `folders`.`org` = 'TEST_ORG_ID' 
                ORDER BY 
                `reports`.`name` ASC,
                `folders`.`name` ASC 
            "#
        );

        let sqlite_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::Sqlite)
            .to_string();
        collapsed_eq!(
            &sqlite_statement,
            r#"
                SELECT 
                "reports"."id",
                "reports"."org",
                "reports"."folder_id",
                "reports"."name",
                "reports"."title",
                "reports"."description",
                "reports"."enabled",
                "reports"."frequency",
                "reports"."destinations",
                "reports"."message",
                "reports"."timezone",
                "reports"."tz_offset",
                "reports"."owner",
                "reports"."last_edited_by",
                "reports"."created_at",
                "reports"."updated_at",
                "reports"."start_at",
                "reports"."id" AS "report_id",
                "reports"."name" AS "report_name",
                "reports"."owner" AS "report_owner",
                "reports"."description" AS "report_description",
                "reports"."created_at" AS "report_created_at",
                "reports"."frequency" AS "report_frequency",
                "folders"."folder_id" AS "folder_id",
                "folders"."name" AS "folder_name",
                "reports"."enabled" AS "report_enabled",
                "report_dashboards"."dashboard_id" AS "report_dashboard_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."org" AS "org_id" FROM "reports" 
                INNER JOIN "folders" ON "reports"."folder_id" = "folders"."id" 
                INNER JOIN "report_dashboards" ON "reports"."id" = "report_dashboards"."report_id" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                WHERE "folders"."org" = 'TEST_ORG_ID' 
                ORDER BY 
                "reports"."name" ASC,
                "folders"."name" ASC 
            "#
        );
    }

    #[test]
    fn list_reports_with_all_optional_params() {
        const ORG_ID: &str = "TEST_ORG_ID";
        const REPORT_FOLDER_SNOWFLAKE_ID: &str = "TEST_FOLDER_SNOWFLAKE_ID";
        const DASHBOARD_SNOWFLAKE_ID: &str = "TEST_DASHBOARD_SNOWFLAKE_ID";
        const PAGE_SIZE: u64 = 10;
        const PAGE_IDX: u64 = 3;
        let params = ListReportsParams::new(ORG_ID)
            .in_folder(REPORT_FOLDER_SNOWFLAKE_ID)
            .for_dashboard(DASHBOARD_SNOWFLAKE_ID)
            .has_destinations(true)
            .paginate(PAGE_SIZE, PAGE_IDX);

        let postgres_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::Postgres)
            .to_string();
        collapsed_eq!(
            &postgres_statement,
            r#"
                SELECT 
                "reports"."id",
                "reports"."org",
                "reports"."folder_id",
                "reports"."name",
                "reports"."title",
                "reports"."description",
                "reports"."enabled",
                "reports"."frequency",
                "reports"."destinations",
                "reports"."message",
                "reports"."timezone",
                "reports"."tz_offset",
                "reports"."owner",
                "reports"."last_edited_by",
                "reports"."created_at",
                "reports"."updated_at",
                "reports"."start_at",
                "reports"."id" AS "report_id",
                "reports"."name" AS "report_name",
                "reports"."owner" AS "report_owner",
                "reports"."description" AS "report_description",
                "reports"."created_at" AS "report_created_at",
                "reports"."frequency" AS "report_frequency",
                "folders"."folder_id" AS "folder_id",
                "folders"."name" AS "folder_name",
                "reports"."enabled" AS "report_enabled",
                "report_dashboards"."dashboard_id" AS "report_dashboard_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."org" AS "org_id"
                FROM "reports" 
                INNER JOIN "folders" ON "reports"."folder_id" = "folders"."id" 
                INNER JOIN "report_dashboards" ON "reports"."id" = "report_dashboards"."report_id" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                WHERE "folders"."org" = 'TEST_ORG_ID' 
                AND "folders"."folder_id" = 'TEST_FOLDER_SNOWFLAKE_ID' 
                AND "dashboards"."dashboard_id" = 'TEST_DASHBOARD_SNOWFLAKE_ID' 
                AND "reports"."destinations" <> '[]' 
                ORDER BY 
                "reports"."name" ASC,
                "folders"."name" ASC 
                LIMIT 10 
                OFFSET 30
            "#
        );

        let mysql_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::MySql)
            .to_string();
        collapsed_eq!(
            &mysql_statement,
            r#"
                SELECT 
                `reports`.`id`,
                `reports`.`org`,
                `reports`.`folder_id`,
                `reports`.`name`,
                `reports`.`title`,
                `reports`.`description`,
                `reports`.`enabled`,
                `reports`.`frequency`,
                `reports`.`destinations`,
                `reports`.`message`,
                `reports`.`timezone`,
                `reports`.`tz_offset`,
                `reports`.`owner`,
                `reports`.`last_edited_by`,
                `reports`.`created_at`,
                `reports`.`updated_at`,
                `reports`.`start_at`,
                `reports`.`id` AS `report_id`,
                `reports`.`name` AS `report_name`,
                `reports`.`owner` AS `report_owner`,
                `reports`.`description` AS `report_description`,
                `reports`.`created_at` AS `report_created_at`,
                `reports`.`frequency` AS `report_frequency`,
                `folders`.`folder_id` AS `folder_id`,
                `folders`.`name` AS `folder_name`,
                `reports`.`enabled` AS `report_enabled`,
                `report_dashboards`.`dashboard_id` AS `report_dashboard_id`,
                `report_dashboards`.`tab_names` AS `report_dashboard_tab_names`,
                `report_dashboards`.`variables` AS `report_dashboard_variables`,
                `report_dashboards`.`timerange` AS `report_dashboard_timerange`,
                `dashboards`.`dashboard_id` AS `dashboard_snowflake_id`,
                `folders`.`org` AS `org_id`
                FROM `reports` 
                INNER JOIN `folders` ON `reports`.`folder_id` = `folders`.`id` 
                INNER JOIN `report_dashboards` ON `reports`.`id` = `report_dashboards`.`report_id` 
                INNER JOIN `dashboards` ON `report_dashboards`.`dashboard_id` = `dashboards`.`id` 
                WHERE `folders`.`org` = 'TEST_ORG_ID' 
                AND `folders`.`folder_id` = 'TEST_FOLDER_SNOWFLAKE_ID' 
                AND `dashboards`.`dashboard_id` = 'TEST_DASHBOARD_SNOWFLAKE_ID' 
                AND `reports`.`destinations` <> '[]' 
                ORDER BY 
                `reports`.`name` ASC,
                `folders`.`name` ASC 
                LIMIT 10 OFFSET 30
            "#
        );

        let sqlite_statement = ListReportsQueryResult::select(&params)
            .into_statement(sea_orm::DatabaseBackend::Sqlite)
            .to_string();
        collapsed_eq!(
            &sqlite_statement,
            r#"
                SELECT 
                "reports"."id",
                "reports"."org",
                "reports"."folder_id",
                "reports"."name",
                "reports"."title",
                "reports"."description",
                "reports"."enabled",
                "reports"."frequency",
                "reports"."destinations",
                "reports"."message",
                "reports"."timezone",
                "reports"."tz_offset",
                "reports"."owner",
                "reports"."last_edited_by",
                "reports"."created_at",
                "reports"."updated_at",
                "reports"."start_at",
                "reports"."id" AS "report_id",
                "reports"."name" AS "report_name",
                "reports"."owner" AS "report_owner",
                "reports"."description" AS "report_description",
                "reports"."created_at" AS "report_created_at",
                "reports"."frequency" AS "report_frequency",
                "folders"."folder_id" AS "folder_id",
                "folders"."name" AS "folder_name",
                "reports"."enabled" AS "report_enabled",
                "report_dashboards"."dashboard_id" AS "report_dashboard_id",
                "report_dashboards"."tab_names" AS "report_dashboard_tab_names",
                "report_dashboards"."variables" AS "report_dashboard_variables",
                "report_dashboards"."timerange" AS "report_dashboard_timerange",
                "dashboards"."dashboard_id" AS "dashboard_snowflake_id",
                "folders"."org" AS "org_id" FROM "reports" 
                INNER JOIN "folders" ON "reports"."folder_id" = "folders"."id" 
                INNER JOIN "report_dashboards" ON "reports"."id" = "report_dashboards"."report_id" 
                INNER JOIN "dashboards" ON "report_dashboards"."dashboard_id" = "dashboards"."id" 
                WHERE "folders"."org" = 'TEST_ORG_ID' 
                AND "folders"."folder_id" = 'TEST_FOLDER_SNOWFLAKE_ID' 
                AND "dashboards"."dashboard_id" = 'TEST_DASHBOARD_SNOWFLAKE_ID' 
                AND "reports"."destinations" <> '[]' 
                ORDER BY 
                "reports"."name" ASC,
                "folders"."name" ASC 
                LIMIT 10 
                OFFSET 30
            "#
        );
    }
}
