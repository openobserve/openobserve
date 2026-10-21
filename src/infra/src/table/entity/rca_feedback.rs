//! `SeaORM` Entity for the `rca_feedback` table (one row per RCA run and author).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_feedback")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub run_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub author_email: String,
    pub incident_id: Option<String>,
    /// `incident` | `alert`, copied from the run.
    pub subject_type: String,
    /// Copied from the run; an alert id is stored bare (no `:group:<team>`).
    pub subject_id: String,
    /// `yes` | `no`.
    pub verdict: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub note: Option<String>,
    /// JSON array of `FeedbackReason` wire values; `no` only.
    pub reasons: Option<Json>,
    /// Microseconds.
    pub created_at: i64,
    /// Microseconds; set on every write.
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
