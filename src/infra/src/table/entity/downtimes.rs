//! `SeaORM` Entity for the `downtimes` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "downtimes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    /// Primary key of the downtime folder, not its public id.
    pub folder_id: String,
    pub name: String,
    pub reason: Option<String>,
    pub condition: Option<Json>,
    pub targets: Json,
    pub show_banner: bool,
    pub repeat: i16,
    pub starts_at: i64,
    pub ends_at: Option<i64>,
    pub timezone: String,
    pub start_time_local: Option<String>,
    pub duration_secs: i64,
    pub weekdays: Option<Json>,
    pub cancelled_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_by: String,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
