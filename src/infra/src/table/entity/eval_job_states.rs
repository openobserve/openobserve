//! `SeaORM` Entity for the `eval_job_states` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "eval_job_states")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub job_id: String,
    pub org_id: String,
    /// `EvalJobHealth::to_i32`.
    pub health: i32,
    /// When `health` last changed, in microseconds.
    pub since: i64,
    /// When the last health pass measured the job, in microseconds.
    pub evaluated_at: i64,
    pub recent_runs: i64,
    pub recent_errors: i64,
    pub scores_24h: i64,
    pub last_success_at: Option<i64>,
    pub last_error_kind: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub last_error_message: Option<String>,
    pub last_error_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
