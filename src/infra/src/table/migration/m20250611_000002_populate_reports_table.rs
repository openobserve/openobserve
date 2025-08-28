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

//! Populates the `reports` table by transforming unstructured report records from the `meta` table.

use std::str::FromStr;

use itertools::{self, Itertools};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, FromQueryResult, Paginator, PaginatorTrait,
    QueryFilter, SelectModel, Set, Statement, TransactionTrait,
};
use sea_orm_migration::prelude::*;
use svix_ksuid::{Ksuid, KsuidLike};

/// The value of the flag used to indicate the reports folder type in the folders table.
const REPORTS_FOLDER_TYPE: i16 = 2;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let txn = manager.get_connection().begin().await?;

        // Select all orgs that have an report. Create a default report folder for each org. Migrate
        // pages of 100 records at a time to avoid loading too many records into memory.
        let mut org_pages = OrgWithReport::paginate(&txn, 100);
        while let Some(orgs) = org_pages.fetch_and_next().await? {
            let folders = orgs
                .into_iter()
                .map(|o| folders_table::ActiveModel {
                    id: Set(
                        folder_ksuid_from_hash(o.org_name(), REPORTS_FOLDER_TYPE, "default")
                            .to_string(),
                    ),
                    org: Set(o.org_name().to_owned()),
                    folder_id: Set("default".to_owned()),
                    name: Set("default".to_owned()),
                    description: Set(Some("default".to_owned())),
                    r#type: Set(REPORTS_FOLDER_TYPE),
                })
                .collect_vec();
            log::debug!("Inserting folders: {folders:?}");
            folders_table::Entity::insert_many(folders)
                .exec(&txn)
                .await?;
        }

        // Select each report from the meta table joined on its associated default folder. For each
        // report from the meta table insert a corresponding record in the new reports table.
        // Migrate pages of 100 records at a time to avoid loading too many records into
        // memory.
        let mut meta_pages = MetaReportWithFolder::paginate(&txn, 100);
        while let Some(metas) = meta_pages.fetch_and_next().await? {
            log::debug!("Meta table query results: {metas:?}");
            for m in metas {
                // Use the report JSON from the meta table and the associated folder ID to create a
                // new record in the new reports table.
                let folder_id = m.folder_id().map_err(DbErr::Migration)?;
                let meta_report: meta_table_reports::Report =
                    (&m).try_into().map_err(DbErr::Migration)?;
                let report_active_model: reports_table::ActiveModel = (folder_id, &meta_report)
                    .try_into()
                    .map_err(DbErr::Migration)?;
                let report_model = report_active_model.insert(&txn).await?;
                let report_id = Ksuid::from_str(&report_model.id).map_err(|_| {
                    DbErr::Migration(
                        "Generated report ID that cannot be parsed as a KSUID".to_string(),
                    )
                })?;

                // Look up each of the associated dashboards and use each to create a new record in
                // the new report_dashboards table.
                let org_id = &meta_report.org_id;
                for meta_rd in meta_report.dashboards.iter() {
                    let folder_snowflake_id = &meta_rd.folder;
                    let dashboard_snowflake_id = &meta_rd.dashboard;
                    let dashboard_and_folder = dashboards_table::Entity::find()
                        .filter(dashboards_table::Column::DashboardId.eq(dashboard_snowflake_id))
                        .find_also_related(folders_table::Entity)
                        .filter(folders_table::Column::Org.eq(org_id))
                        .filter(folders_table::Column::FolderId.eq(folder_snowflake_id))
                        .one(&txn)
                        .await?
                        .and_then(|(d, maybe_f)| maybe_f.map(|f| (d, f)));

                    // Sometimes the data from the meta table can reference dashboards that have
                    // been deleted. If we can't find the dashboard then we skip adding a
                    // corresponding record to the report_dashboards table.
                    if let Some((dashboard, _)) = dashboard_and_folder {
                        let dashbaord_id = Ksuid::from_str(&dashboard.id).map_err(|_| {
                            DbErr::Migration(
                                "Generated report ID that cannot be parsed as a KSUID".to_string(),
                            )
                        })?;

                        let report_dashboard_am: report_dashboards_table::ActiveModel =
                            (report_id, dashbaord_id, meta_rd)
                                .try_into()
                                .map_err(DbErr::Migration)?;
                        report_dashboard_am.insert(&txn).await?;
                    }
                }
            }
        }

        txn.commit().await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        report_dashboards_table::Entity::delete_many()
            .exec(db)
            .await?;
        reports_table::Entity::delete_many().exec(db).await?;
        folders_table::Entity::delete_many()
            .filter(folders_table::Column::Type.eq(REPORTS_FOLDER_TYPE))
            .exec(db)
            .await?;
        Ok(())
    }
}

/// Identifiers used in queries on the meta table.
#[derive(DeriveIden)]
enum Folders {
    Table,
    Id,
    Org,
    FolderId,
    Type,
}

/// Identifiers used in queries on the folders table.
#[derive(DeriveIden)]
enum Meta {
    Table,
    Module,
    Key1,
    Value,
}

/// A result from querying for unique names of orgs with reports from the meta table.
#[derive(Debug, FromQueryResult)]
pub struct OrgWithReport {
    /// The name of the org.
    key1: String,
}

impl OrgWithReport {
    pub fn org_name(&self) -> &str {
        &self.key1
    }
}

impl OrgWithReport {
    /// Returns the select statment to select unique names of orgs with reports from the meta table.
    fn statement() -> SelectStatement {
        Query::select()
            .column(Meta::Key1)
            .from(Meta::Table)
            .and_where(Expr::col(Meta::Module).eq("reports"))
            .group_by_col(Meta::Key1)
            .order_by(Meta::Key1, Order::Asc)
            .to_owned()
    }

    /// Paginate through the results of querying for unique names of orgs with reports from the meta
    /// table.
    fn paginate<C>(db: &C, page_size: u64) -> Paginator<'_, C, SelectModel<OrgWithReport>>
    where
        C: ConnectionTrait,
    {
        let select_statement = Self::statement();
        let backend = db.get_database_backend();
        let (sql, values) = match backend {
            sea_orm::DatabaseBackend::MySql => select_statement.build(MysqlQueryBuilder),
            sea_orm::DatabaseBackend::Postgres => select_statement.build(PostgresQueryBuilder),
            sea_orm::DatabaseBackend::Sqlite => select_statement.build(SqliteQueryBuilder),
        };
        let statement = Statement::from_sql_and_values(backend, sql, values);
        Self::find_by_statement(statement).paginate(db, page_size)
    }
}

/// A result from querying for reports from the meta table and joining on the folders table.
#[derive(Debug, FromQueryResult)]
pub struct MetaReportWithFolder {
    /// The JSON representation of the report.
    value: String,

    /// The ID of the folder that the report belongs to.
    id: Option<String>,
}

impl MetaReportWithFolder {
    /// Returns the JSON represenation of the report that was stored in the meta table's value
    /// column.
    pub fn report_json(&self) -> &str {
        &self.value
    }

    /// Returns the KSUID of the folder that the report belongs to.
    pub fn folder_id(&self) -> Result<Ksuid, String> {
        if let Some(id) = &self.id {
            Ksuid::from_str(id).map_err(|e| e.to_string())
        } else {
            Err("Could not find folder for the report".to_owned())
        }
    }
}

impl MetaReportWithFolder {
    /// Returns the select statment to select reports from the meta table joined on the folders
    /// table.
    fn statement() -> SelectStatement {
        Query::select()
            .column((Meta::Table, Meta::Value))
            .column((Folders::Table, Folders::Id))
            .from(Meta::Table)
            .left_join(
                Folders::Table,
                Expr::col((Folders::Table, Folders::Org)).equals((Meta::Table, Meta::Key1)),
            )
            .and_where(Expr::col((Meta::Table, Meta::Module)).eq("reports"))
            .and_where(Expr::col((Folders::Table, Folders::Type)).eq(REPORTS_FOLDER_TYPE))
            .and_where(Expr::col((Folders::Table, Folders::FolderId)).eq("default"))
            .to_owned()
    }

    /// Paginate through the results of querying for reports from the meta table and joining on the
    /// folders table.
    fn paginate<C>(db: &C, page_size: u64) -> Paginator<'_, C, SelectModel<MetaReportWithFolder>>
    where
        C: ConnectionTrait,
    {
        let select_statement = Self::statement();
        let backend = db.get_database_backend();
        let (sql, values) = match backend {
            sea_orm::DatabaseBackend::MySql => select_statement.build(MysqlQueryBuilder),
            sea_orm::DatabaseBackend::Postgres => select_statement.build(PostgresQueryBuilder),
            sea_orm::DatabaseBackend::Sqlite => select_statement.build(SqliteQueryBuilder),
        };
        let statement = Statement::from_sql_and_values(backend, sql, values);
        Self::find_by_statement(statement).paginate(db, page_size)
    }
}

// The schemas of tables might change after subsequent migrations. Therefore
// this migration only references ORM models in private submodules that should
// remain unchanged rather than ORM models in the `entity` module that will be
// updated to reflect the latest changes to table schemas.

/// Representation of the folders table at the time this migration executes.
mod folders_table {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "folders")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        pub description: Option<String>,
        pub r#type: i16,
    }

    // There are relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {
        #[sea_orm(has_many = "super::dashboards_table::Entity")]
        Dashboards,
    }

    impl Related<super::dashboards_table::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::Dashboards.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the reports table at the time this migration executes.
mod reports_table {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "reports")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub org: String,
        pub folder_id: String,
        pub name: String,
        pub title: String,
        pub description: Option<String>,
        pub enabled: bool,
        pub frequency: Json,
        pub destinations: Json,
        pub message: Option<String>,
        pub timezone: String,
        pub tz_offset: i32,
        pub owner: Option<String>,
        pub last_edited_by: Option<String>,
        pub created_at: i64,
        pub updated_at: Option<i64>,
        pub start_at: i64,
    }

    // There are relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the report_dashboards table at the time this migration executes.
mod report_dashboards_table {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "report_dashboards")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub report_id: String,
        #[sea_orm(primary_key, auto_increment = false)]
        pub dashboard_id: String,
        pub tab_names: Json,
        pub variables: Json,
        pub timerange: Json,
    }

    // There are relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// Representation of the dashboards table at the time this migration executes.
mod dashboards_table {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
    #[sea_orm(table_name = "dashboards")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: String,
        pub dashboard_id: String,
        pub folder_id: String,
        pub owner: String,
        pub role: Option<String>,
        pub title: String,
        pub description: Option<String>,
        pub data: Json,
        pub version: i32,
        pub created_at: i64,
    }

    // There are other relations but they are not important to this migration.
    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {
        #[sea_orm(
            belongs_to = "super::folders_table::Entity",
            from = "Column::FolderId",
            to = "super::folders_table::Column::Id",
            on_update = "NoAction",
            on_delete = "NoAction"
        )]
        Folders,
    }

    impl Related<super::folders_table::Entity> for Entity {
        fn to() -> RelationDef {
            Relation::Folders.def()
        }
    }

    impl ActiveModelBehavior for ActiveModel {}
}

/// Defines the string and JSON serialization schemas used to store various child structures in the
/// new reports table at the time this migration executes.
mod reports_table_ser {
    use serde::Serialize;

    #[derive(Serialize)]
    pub struct ReportDestinations(pub Vec<ReportDestination>);

    #[derive(Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ReportDestination {
        Email(String),
    }
}

/// Defines the string and JSON serialization schemas used to store various child structures in the
/// new report_dashboards table at the time this migration executes.
mod report_dashboards_table_ser {
    use serde::Serialize;

    #[derive(Serialize)]
    pub struct TabNames(pub Vec<String>);

    #[derive(Serialize)]
    pub struct ReportDashboardVariables(pub Vec<ReportDashboardVariable>);

    #[derive(Serialize)]
    #[serde(rename_all = "snake_case")]
    pub struct ReportDashboardVariable {
        pub key: String,
        pub value: String,
        pub id: Option<String>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ReportTimerange {
        Relative { period: String },
        Absolute { from: i64, to: i64 },
    }
}

/// Defines the JSON schema used to store reports and their child structures in the meta table at
/// the time this migration executes.
mod meta_table_reports {

    use chrono::{DateTime, FixedOffset, Utc};
    use serde::{Deserialize, Serialize};

    pub fn default_align_time() -> bool {
        true
    }

    #[derive(Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct Report {
        #[serde(default)]
        pub name: String,
        #[serde(default)]
        pub title: String,
        pub org_id: String,
        /// Frequency of report generation. E.g. - Weekly.
        #[serde(default)]
        pub frequency: ReportFrequency,
        /// Start time of report generation in UNIX microseconds.
        #[serde(default)]
        pub start: i64,
        pub dashboards: Vec<ReportDashboard>,
        pub destinations: Vec<ReportDestination>,
        #[serde(default)]
        pub description: String,
        /// Message to include in the email
        #[serde(default)]
        pub message: String,
        #[serde(default)]
        pub enabled: bool,
        // The report JSON in the meta table stores the media_type field but it is not used in this
        // migration. Since it can only by PDF all records are assumed to be PDF and the reports
        // table does not contain a media_type column. If additional media types are added in the
        // future a media_type column can be added then.
        #[allow(unused)]
        #[serde(default)]
        pub media_type: ReportMediaType,
        #[serde(default)]
        pub timezone: String,
        /// Fixed timezone offset in minutes
        #[serde(default)]
        #[serde(rename = "timezoneOffset")]
        pub tz_offset: i32,
        #[serde(default = "datetime_now")]
        pub created_at: DateTime<FixedOffset>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub updated_at: Option<DateTime<FixedOffset>>,
        pub owner: String,
        pub last_edited_by: String,
    }

    impl Default for Report {
        fn default() -> Self {
            Self {
                name: "".to_string(),
                title: "".to_string(),
                org_id: "".to_string(),
                frequency: ReportFrequency::default(),
                start: Utc::now().timestamp_micros(), // Now
                destinations: vec![],
                dashboards: vec![],
                description: "".to_string(),
                message: "".to_string(),
                enabled: false,
                media_type: ReportMediaType::default(),
                timezone: "".to_string(),
                tz_offset: 0, // UTC
                created_at: datetime_now(),
                updated_at: None,
                owner: "".to_string(),
                last_edited_by: "".to_string(),
            }
        }
    }

    impl Default for ReportFrequency {
        fn default() -> Self {
            Self {
                interval: 1,
                cron: "".to_string(),
                frequency_type: Default::default(),
                align_time: true,
            }
        }
    }

    #[derive(Default, Deserialize, Serialize, PartialEq, Clone, Debug)]
    pub enum ReportFrequencyType {
        #[serde(rename = "once")]
        Once,
        #[serde(rename = "hours")]
        Hours,
        #[serde(rename = "days")]
        Days,
        #[serde(rename = "weeks")]
        #[default]
        Weeks,
        #[serde(rename = "months")]
        Months,
        #[serde(rename = "cron")]
        Cron,
    }

    #[derive(Deserialize, Clone)]
    pub enum ReportDestination {
        #[serde(rename = "email")]
        Email(String), // Supports email only
    }

    #[derive(Default, Deserialize, Clone)]
    pub enum ReportMediaType {
        #[default]
        #[serde(rename = "pdf")]
        Pdf, // Supports Pdf only
    }

    #[derive(Deserialize, Clone)]
    pub struct ReportDashboard {
        pub dashboard: String,
        pub folder: String,
        pub tabs: Vec<String>,
        #[serde(default)]
        pub variables: Vec<ReportDashboardVariable>,
        /// The timerange of dashboard data.
        #[serde(default)]
        pub timerange: ReportTimerange,
    }

    #[derive(Default, Deserialize, Clone)]
    pub struct ReportDashboardVariable {
        pub key: String,
        pub value: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub id: Option<String>,
    }

    #[derive(Deserialize, Clone)]
    pub struct ReportTimerange {
        #[serde(rename = "type")]
        pub range_type: ReportTimerangeType,
        pub period: String, // 15m, 4M etc. For relative.
        pub from: i64,      // For absolute, in microseconds
        pub to: i64,        // For absolute, in microseconds
    }

    impl Default for ReportTimerange {
        fn default() -> Self {
            Self {
                range_type: ReportTimerangeType::default(),
                period: "1w".to_string(),
                from: 0,
                to: 0,
            }
        }
    }

    #[derive(Default, Deserialize, Clone)]
    pub enum ReportTimerangeType {
        #[default]
        #[serde(rename = "relative")]
        Relative,
        #[serde(rename = "absolute")]
        Absolute,
    }

    #[derive(Deserialize, Serialize, Clone)]
    pub struct ReportFrequency {
        /// Frequency interval in the `frequency_type` unit
        #[serde(default)]
        pub interval: i64,
        /// Cron expression
        #[serde(default)]
        pub cron: String,
        #[serde(rename = "type")]
        #[serde(default)]
        pub frequency_type: ReportFrequencyType,
        #[serde(default = "default_align_time")]
        pub align_time: bool,
    }

    pub fn datetime_now() -> DateTime<FixedOffset> {
        Utc::now().with_timezone(&FixedOffset::east_opt(0).unwrap()) // This can't fail.
    }
}

// Implementations of conversion traits for converting from the JSON representation of data
// structures in the old meta table to the JSON representation of data structures in the new tables.
// Some data structures are identical from the old meta table to the new tables but others differ so
// we explicitly specify the conversion logic for each here.

impl TryFrom<&MetaReportWithFolder> for meta_table_reports::Report {
    type Error = String;

    fn try_from(m: &MetaReportWithFolder) -> Result<Self, Self::Error> {
        let report: meta_table_reports::Report = serde_json::from_str(m.report_json())
            .map_err(|_| "Report in meta table could not be deserialized")?;
        Ok(report)
    }
}

impl TryFrom<(Ksuid, &meta_table_reports::Report)> for reports_table::ActiveModel {
    type Error = String;

    fn try_from(
        (folder_id, report_json): (Ksuid, &meta_table_reports::Report),
    ) -> Result<Self, Self::Error> {
        let id = report_ksuid_from_hash(report_json, folder_id).to_string();
        let folder_id = folder_id.to_string();

        let frequency_json =
            serde_json::to_value(&report_json.frequency).map_err(|e| e.to_string())?;

        let destinations: reports_table_ser::ReportDestinations =
            report_json.destinations.as_slice().into();
        let destionations_json = serde_json::to_value(&destinations).map_err(|e| e.to_string())?;

        Ok(reports_table::ActiveModel {
            id: Set(id),
            org: Set(report_json.org_id.clone()),
            folder_id: Set(folder_id),
            name: Set(report_json.name.clone()),
            title: Set(report_json.title.clone()),
            description: Set(Some(report_json.description.clone()).filter(|s| !s.is_empty())),
            enabled: Set(report_json.enabled),
            frequency: Set(frequency_json),
            destinations: Set(destionations_json),
            message: Set(Some(report_json.message.clone()).filter(|s| !s.is_empty())),
            timezone: Set(report_json.timezone.clone()),
            tz_offset: Set(report_json.tz_offset),
            owner: Set(Some(report_json.owner.clone()).filter(|s| !s.is_empty())),
            last_edited_by: Set(Some(report_json.last_edited_by.clone()).filter(|s| !s.is_empty())),
            created_at: Set(report_json.created_at.timestamp_micros()),
            updated_at: Set(report_json.updated_at.map(|t| t.timestamp_micros())),
            start_at: Set(report_json.start),
        })
    }
}

impl From<&[meta_table_reports::ReportDestination]> for reports_table_ser::ReportDestinations {
    fn from(value: &[meta_table_reports::ReportDestination]) -> Self {
        Self(value.iter().map(|d| d.into()).collect())
    }
}

impl From<&meta_table_reports::ReportDestination> for reports_table_ser::ReportDestination {
    fn from(value: &meta_table_reports::ReportDestination) -> Self {
        match value {
            meta_table_reports::ReportDestination::Email(email) => Self::Email(email.clone()),
        }
    }
}

impl TryFrom<(Ksuid, Ksuid, &meta_table_reports::ReportDashboard)>
    for report_dashboards_table::ActiveModel
{
    type Error = String;

    fn try_from(
        (report_id, dashboard_id, report_dashboard): (
            Ksuid,
            Ksuid,
            &meta_table_reports::ReportDashboard,
        ),
    ) -> Result<Self, Self::Error> {
        let report_id = report_id.to_string();
        let dashboard_id = dashboard_id.to_string();

        let tab_names = report_dashboards_table_ser::TabNames(report_dashboard.tabs.clone());
        let tab_names_json = serde_json::to_value(&tab_names).map_err(|e| e.to_string())?;

        let variables: report_dashboards_table_ser::ReportDashboardVariables =
            report_dashboard.variables.as_slice().into();
        let variables_json = serde_json::to_value(&variables).map_err(|e| e.to_string())?;

        let timerange: report_dashboards_table_ser::ReportTimerange =
            (&report_dashboard.timerange).into();
        let timerange_json = serde_json::to_value(&timerange).map_err(|e| e.to_string())?;

        Ok(report_dashboards_table::ActiveModel {
            report_id: Set(report_id),
            dashboard_id: Set(dashboard_id),
            tab_names: Set(tab_names_json),
            variables: Set(variables_json),
            timerange: Set(timerange_json),
        })
    }
}

impl From<&[meta_table_reports::ReportDashboardVariable]>
    for report_dashboards_table_ser::ReportDashboardVariables
{
    fn from(value: &[meta_table_reports::ReportDashboardVariable]) -> Self {
        Self(value.iter().map(|v| v.into()).collect())
    }
}

impl From<&meta_table_reports::ReportDashboardVariable>
    for report_dashboards_table_ser::ReportDashboardVariable
{
    fn from(value: &meta_table_reports::ReportDashboardVariable) -> Self {
        Self {
            key: value.key.clone(),
            value: value.value.clone(),
            id: value.id.clone(),
        }
    }
}

impl From<&meta_table_reports::ReportTimerange> for report_dashboards_table_ser::ReportTimerange {
    fn from(value: &meta_table_reports::ReportTimerange) -> Self {
        match value.range_type {
            meta_table_reports::ReportTimerangeType::Relative => {
                report_dashboards_table_ser::ReportTimerange::Relative {
                    period: value.period.clone(),
                }
            }
            meta_table_reports::ReportTimerangeType::Absolute => {
                report_dashboards_table_ser::ReportTimerange::Absolute {
                    from: value.from,
                    to: value.to,
                }
            }
        }
    }
}

/// Generates a KSUID from a hash of the folder's `org`, `type`, and `folder_id`.
///
/// To generate a KSUID this function generates the 160-bit SHA-1 hash of the folder's `org` and
/// `folder_id` and interprets that 160-bit hash as a 160-bit KSUID. Therefore two KSUIDs generated
/// in this manner will always be equal if the folders have the same `org` and `folder_id`.
///
/// It is important to note that KSUIDs generated in this manner will have timestamp bits which are
/// effectively random, meaning that the timestamp in any KSUID generated with this function will be
/// random.
fn folder_ksuid_from_hash(
    org: &str,
    folder_type: i16,
    folder_snowflake_id: &str,
) -> svix_ksuid::Ksuid {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(org);
    hasher.update(folder_type.to_string());
    hasher.update(folder_snowflake_id);
    let hash = hasher.finalize();
    svix_ksuid::Ksuid::from_bytes(hash.into())
}

/// Generates a KSUID from a hash of the report's `org_id`, `folder_id`, and `name`.
///
/// To generate a KSUID this function generates the 160-bit SHA-1 hash of the report's associated
/// organization ID and `name` and interprets that 160-bit hash as a 160-bit KSUID. Therefore two
/// KSUIDs generated in this manner will always be equal if the reports have the same associated
/// organization ID and `name`
///
/// It is important to note that KSUIDs generated in this manner will have
/// timestamp bits which are effectively random, meaning that the timestamp
/// in any KSUID generated with this function will be random.
fn report_ksuid_from_hash(
    report: &meta_table_reports::Report,
    folder_id: Ksuid,
) -> svix_ksuid::Ksuid {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(report.org_id.clone());
    hasher.update(folder_id.to_string());
    hasher.update(report.name.clone());
    let hash = hasher.finalize();
    svix_ksuid::Ksuid::from_bytes(hash.into())
}

#[cfg(test)]
mod tests {
    use collapse::*;

    use super::*;

    #[test]
    fn org_with_report_postgres() {
        let stmnt = OrgWithReport::statement();
        assert_eq!(
            &stmnt.to_string(PostgresQueryBuilder),
            r#"SELECT "key1" FROM "meta" WHERE "module" = 'reports' GROUP BY "key1" ORDER BY "key1" ASC"#
        );
    }

    #[test]
    fn org_with_report_mysql() {
        let stmnt = OrgWithReport::statement();
        assert_eq!(
            &stmnt.to_string(MysqlQueryBuilder),
            r#"SELECT `key1` FROM `meta` WHERE `module` = 'reports' GROUP BY `key1` ORDER BY `key1` ASC"#
        );
    }

    #[test]
    fn org_with_report_sqlite() {
        let stmnt = OrgWithReport::statement();
        assert_eq!(
            &stmnt.to_string(SqliteQueryBuilder),
            r#"SELECT "key1" FROM "meta" WHERE "module" = 'reports' GROUP BY "key1" ORDER BY "key1" ASC"#
        );
    }

    #[test]
    fn meta_with_folder_postgres() {
        let stmnt = MetaReportWithFolder::statement();
        collapsed_eq!(
            &stmnt.to_string(PostgresQueryBuilder),
            r#"
                SELECT 
                "meta"."value", 
                "folders"."id" 
                FROM "meta" 
                LEFT JOIN "folders" 
                ON "folders"."org" = "meta"."key1" 
                WHERE "meta"."module" = 'reports' 
                AND "folders"."type" = 2 
                AND "folders"."folder_id" = 'default'
            "#
        );
    }

    #[test]
    fn meta_with_folder_mysql() {
        let stmnt = MetaReportWithFolder::statement();
        collapsed_eq!(
            &stmnt.to_string(MysqlQueryBuilder),
            r#"
                SELECT 
                `meta`.`value`, 
                `folders`.`id` 
                FROM `meta` 
                LEFT JOIN `folders` 
                ON `folders`.`org` = `meta`.`key1` 
                WHERE `meta`.`module` = 'reports' 
                AND `folders`.`type` = 2 
                AND `folders`.`folder_id` = 'default'
            "#
        );
    }

    #[test]
    fn meta_with_folder_sqlite() {
        let stmnt = MetaReportWithFolder::statement();
        collapsed_eq!(
            &stmnt.to_string(SqliteQueryBuilder),
            r#"
                SELECT
                "meta"."value", 
                "folders"."id" 
                FROM "meta" 
                LEFT JOIN "folders" 
                ON "folders"."org" = "meta"."key1" 
                WHERE "meta"."module" = 'reports' 
                AND "folders"."type" = 2 
                AND "folders"."folder_id" = 'default'
            "#
        );
    }

    #[test]
    fn test_folder_ksuid_deterministic_generation() {
        // Test that identical folder inputs always produce the same KSUID
        let org1 = "test_org";
        let folder_type = REPORTS_FOLDER_TYPE;
        let folder_id = "default";

        let ksuid1 = folder_ksuid_from_hash(org1, folder_type, folder_id);
        let ksuid2 = folder_ksuid_from_hash(org1, folder_type, folder_id);
        assert_eq!(ksuid1, ksuid2);

        // Different inputs should produce different KSUIDs
        let ksuid3 = folder_ksuid_from_hash("different_org", folder_type, folder_id);
        assert_ne!(ksuid1, ksuid3);

        let ksuid4 = folder_ksuid_from_hash(org1, folder_type, "different_folder");
        assert_ne!(ksuid1, ksuid4);

        let ksuid5 = folder_ksuid_from_hash(org1, 999, folder_id);
        assert_ne!(ksuid1, ksuid5);
    }

    #[test]
    fn test_report_ksuid_deterministic_generation() {
        // Test that identical report inputs always produce the same KSUID
        let report1 = meta_table_reports::Report {
            name: "test_report".to_string(),
            org_id: "test_org".to_string(),
            ..Default::default()
        };

        let report2 = meta_table_reports::Report {
            name: "test_report".to_string(),
            org_id: "test_org".to_string(),
            // Different fields but same identity fields
            title: "Different Title".to_string(),
            description: "Different description".to_string(),
            enabled: !report1.enabled,
            ..Default::default()
        };

        let folder_id = folder_ksuid_from_hash("test_org", REPORTS_FOLDER_TYPE, "default");

        // Same identity fields should produce same KSUID
        let ksuid1 = report_ksuid_from_hash(&report1, folder_id);
        let ksuid2 = report_ksuid_from_hash(&report2, folder_id);
        assert_eq!(ksuid1, ksuid2);

        // Different identity fields should produce different KSUID
        let mut report3 = report1.clone();
        report3.name = "different_report".to_string();
        let ksuid3 = report_ksuid_from_hash(&report3, folder_id);
        assert_ne!(ksuid1, ksuid3);
    }

    #[test]
    fn test_meta_report_with_folder_error_handling() {
        // Test successful KSUID parsing
        let valid_meta = MetaReportWithFolder {
            value: "{}".to_string(),
            id: Some("2TCDwPCXlNNEHdJ5oIhupZXZ3nJ".to_string()), // Valid KSUID
        };
        assert!(valid_meta.folder_id().is_ok());

        // Test error on missing folder ID
        let missing_folder = MetaReportWithFolder {
            value: "{}".to_string(),
            id: None,
        };
        assert!(missing_folder.folder_id().is_err());
        assert_eq!(
            missing_folder.folder_id().unwrap_err(),
            "Could not find folder for the report"
        );

        // Test error on invalid KSUID format
        let invalid_ksuid = MetaReportWithFolder {
            value: "{}".to_string(),
            id: Some("invalid_ksuid".to_string()),
        };
        assert!(invalid_ksuid.folder_id().is_err());
    }

    #[test]
    fn test_report_destination_conversion() {
        // Test single email destination
        let meta_destinations = vec![meta_table_reports::ReportDestination::Email(
            "test@example.com".to_string(),
        )];
        let reports_destinations: reports_table_ser::ReportDestinations =
            meta_destinations.as_slice().into();

        // Verify conversion works (specific implementation is internal)
        let json_result = serde_json::to_value(&reports_destinations);
        assert!(json_result.is_ok());

        // Test multiple destinations
        let multi_destinations = vec![
            meta_table_reports::ReportDestination::Email("admin@example.com".to_string()),
            meta_table_reports::ReportDestination::Email("user@example.com".to_string()),
        ];
        let multi_reports_destinations: reports_table_ser::ReportDestinations =
            multi_destinations.as_slice().into();

        let multi_json_result = serde_json::to_value(&multi_reports_destinations);
        assert!(multi_json_result.is_ok());
    }

    #[test]
    fn test_report_timerange_conversion() {
        // Test relative timerange conversion
        let relative_timerange = meta_table_reports::ReportTimerange {
            range_type: meta_table_reports::ReportTimerangeType::Relative,
            period: "1d".to_string(),
            from: 0,
            to: 0,
        };

        let converted_relative: report_dashboards_table_ser::ReportTimerange =
            (&relative_timerange).into();

        // Test that conversion produces valid JSON
        let relative_json = serde_json::to_value(&converted_relative);
        assert!(relative_json.is_ok());

        // Test absolute timerange conversion
        let absolute_timerange = meta_table_reports::ReportTimerange {
            range_type: meta_table_reports::ReportTimerangeType::Absolute,
            period: "".to_string(),
            from: 1640995200000000, // 2022-01-01 in microseconds
            to: 1641081600000000,   // 2022-01-02 in microseconds
        };

        let converted_absolute: report_dashboards_table_ser::ReportTimerange =
            (&absolute_timerange).into();

        // Test that conversion produces valid JSON
        let absolute_json = serde_json::to_value(&converted_absolute);
        assert!(absolute_json.is_ok());
    }

    #[test]
    fn test_dashboard_variable_conversion() {
        // Test dashboard variables conversion
        let meta_variables = vec![
            meta_table_reports::ReportDashboardVariable {
                key: "environment".to_string(),
                value: "production".to_string(),
                id: Some("var1".to_string()),
            },
            meta_table_reports::ReportDashboardVariable {
                key: "service".to_string(),
                value: "api".to_string(),
                id: None,
            },
        ];

        let converted_variables: report_dashboards_table_ser::ReportDashboardVariables =
            meta_variables.as_slice().into();

        // Test that conversion produces valid JSON
        let variables_json = serde_json::to_value(&converted_variables);
        assert!(variables_json.is_ok());
    }

    #[test]
    fn test_report_frequency_type_defaults() {
        // Test default frequency type is Weeks
        let default_frequency = meta_table_reports::ReportFrequency::default();
        assert_eq!(
            default_frequency.frequency_type,
            meta_table_reports::ReportFrequencyType::Weeks
        );
        assert_eq!(default_frequency.interval, 1);
        assert_eq!(default_frequency.cron, "");
        assert!(default_frequency.align_time);

        // Test frequency type enum default
        let default_type = meta_table_reports::ReportFrequencyType::default();
        assert_eq!(default_type, meta_table_reports::ReportFrequencyType::Weeks);
    }

    #[test]
    fn test_empty_string_filtering() {
        use meta_table_reports::Report;
        let folder_id = folder_ksuid_from_hash("test_org", REPORTS_FOLDER_TYPE, "default");

        // Test empty strings are filtered out in conversion
        let report_with_empty_strings = Report {
            name: "test_report".to_string(),
            org_id: "test_org".to_string(),
            description: "".to_string(), // Empty string should be filtered
            message: "".to_string(),     // Empty string should be filtered
            owner: "".to_string(),       // Empty string should be filtered
            last_edited_by: "".to_string(), // Empty string should be filtered
            ..Default::default()
        };

        let result: Result<reports_table::ActiveModel, String> =
            (folder_id, &report_with_empty_strings).try_into();
        assert!(result.is_ok());

        let active_model = result.unwrap();
        // The implementation should filter out empty strings and set them to None
        // We can't directly inspect the Set values, but the conversion should succeed
        match active_model.description {
            sea_orm::ActiveValue::Set(desc) => assert_eq!(desc, None),
            _ => panic!("Expected Set value for description"),
        }
    }

    #[test]
    fn test_timestamp_conversion() {
        use chrono::{FixedOffset, TimeZone};

        // Test timestamp conversion from DateTime to microseconds
        let fixed_offset = FixedOffset::east_opt(0).unwrap();
        let test_datetime = fixed_offset.from_utc_datetime(&chrono::Utc::now().naive_utc());

        let timestamp_micros = test_datetime.timestamp_micros();
        assert!(timestamp_micros > 0);

        // Test that datetime_now() produces valid timestamps
        let now = meta_table_reports::datetime_now();
        assert!(now.timestamp_micros() > 0);
    }

    #[test]
    fn test_reports_folder_type_constant() {
        // Test that the constant matches the expected folder type for reports

        // Test that it's different from other folder types (alerts = 1)
        assert_ne!(REPORTS_FOLDER_TYPE, 1);

        // Test that it's used correctly in hash generation
        let ksuid1 = folder_ksuid_from_hash("test", REPORTS_FOLDER_TYPE, "default");
        let ksuid2 = folder_ksuid_from_hash("test", 1, "default"); // Different type
        assert_ne!(ksuid1, ksuid2);
    }

    #[test]
    fn test_default_align_time_function() {
        // Test that the default_align_time function returns true
        assert!(meta_table_reports::default_align_time());

        // Test that it's used in ReportFrequency default
        let default_freq = meta_table_reports::ReportFrequency::default();
        assert!(default_freq.align_time);
    }
}
