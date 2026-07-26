//! `SeaORM` Entity for the `alert_state_transitions` table (Part IV of `alerts.md`).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_state_transitions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub alert_id: String,
    pub group_key: String,
    /// `RunOutcome::to_i32`. `None` on an alert's first ever evaluation.
    pub from_outcome: Option<i32>,
    pub to_outcome: i32,
    /// `AlertLevel::to_i32` before/after. `None` when the alert has no level axis.
    pub from_level: Option<i32>,
    pub to_level: Option<i32>,
    pub at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
