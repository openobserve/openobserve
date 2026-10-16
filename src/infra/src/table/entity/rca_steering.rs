//! `SeaORM` Entity for the `rca_steering` table (one row per responder message to an RCA
//! run).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_steering")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    /// `stg_` + KSUID.
    #[sea_orm(primary_key, auto_increment = false)]
    pub steer_id: String,
    pub run_id: String,
    pub incident_id: String,
    pub author_email: String,
    /// `message` | `answer` | `hypothesis_action` | `guidance`.
    pub kind: String,
    /// `disprove` | `reopen` | `test_first`.
    pub action: Option<String>,
    pub hypothesis_id: Option<String>,
    /// `callID` of the `ask_responders` call this row answers.
    pub question_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub text: String,
    /// `queued` | `delivered` | `read` | `applied` | `declined` | `not_read` | `rejected`.
    pub status: String,
    pub status_reason: Option<String>,
    /// Microseconds.
    pub created_at: i64,
    pub delivered_at: Option<i64>,
    pub read_at: Option<i64>,
    pub acted_at: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub agent_note: Option<String>,
    pub opencode_message_id: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
