//! `SeaORM` Entity for the `eval_job_state_transitions` table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "eval_job_state_transitions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub job_id: String,
    pub org_id: String,
    /// `EvalJobHealth::to_i32`. `None` on a job's first measurement.
    pub from_health: Option<i32>,
    pub to_health: i32,
    pub at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
