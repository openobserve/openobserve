//! `SeaORM` Entity for the `rca_cause_corrections` table (one row per incident and author).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_cause_corrections")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub author_email: String,
    /// `incident` | `alert`: the incident's on-call subject, read by later past-cause lookups.
    pub subject_type: String,
    /// An alert id is stored bare (no `:group:<team>`).
    pub subject_id: String,
    /// A `ResolutionCause` wire value, never `still_unknown`.
    pub cause: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub note: Option<String>,
    /// Microseconds.
    pub created_at: i64,
    /// Microseconds; set on every write.
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
