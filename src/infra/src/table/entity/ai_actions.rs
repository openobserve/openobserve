//! `SeaORM` Entity for the `ai_actions` table (the assistant's action ledger).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "ai_actions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub approval_id: Option<String>,
    /// `approved` | `standing` | `none`.
    pub approval_kind: String,
    pub approved_by: Option<String>,
    /// The member the assistant acted for.
    pub user_email: String,
    pub tool: String,
    /// `create` | `update` | `delete` | `other`.
    pub op: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub resource_name: Option<String>,
    /// JSON of the object before the change, redacted and capped.
    pub before: Option<String>,
    pub after: Option<String>,
    /// `done` | `failed`.
    pub status: String,
    pub message: Option<String>,
    pub undoable: bool,
    pub undo_reason: Option<String>,
    pub undo_until: Option<i64>,
    pub undone_by: Option<String>,
    pub undone_at: Option<i64>,
    /// On an undo's own row, the row it reverted.
    pub undo_of: Option<String>,
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
