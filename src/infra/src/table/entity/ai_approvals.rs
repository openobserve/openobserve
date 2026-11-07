//! `SeaORM` Entity for the `ai_approvals` table (the assistant's approval cards and decisions).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_approvals")]
pub struct Model {
    /// o2-ai's approval id (`apr_…`).
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub session_id: String,
    pub user_email: String,
    pub tool: Option<String>,
    /// `pending` | `approved` | `denied` | `expired`.
    pub status: String,
    pub scope: Option<String>,
    /// The `confirmation_required` frame, including o2-ai's sealed record.
    #[sea_orm(column_type = "Text")]
    pub card: String,
    /// The `confirmation_resolved` frame once decided.
    #[sea_orm(column_type = "Text", nullable)]
    pub resolved: Option<String>,
    pub expires_at: i64,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
