//! `SeaORM` Entity for alert_occurrences table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_occurrences")]
pub struct Model {
    /// KSUID (27 chars)
    #[sea_orm(primary_key, auto_increment = false)]
    pub occurrence_id: String,
    pub org_id: String,
    pub alert_id: String,
    pub alert_name: Option<String>,
    pub alert_updated_at: Option<i64>,
    pub config_hash: String,
    /// Timestamps in microseconds
    pub window_start: i64,
    pub window_end: i64,
    pub trigger_timestamp: i64,
    pub query_type: String,
    pub condition_operator: String,
    pub threshold_value: Option<i64>,
    pub matched_count: i64,
    pub result_preview: Json,
    pub result_truncated: bool,
    pub query_took: Option<i64>,
    pub trace_id: Option<String>,
    pub created_at: i64,
    pub schema_version: i16,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
