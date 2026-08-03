//! `SeaORM` Entity for the `alert_state_transitions` table (Part IV of `alerts.md`).

use sea_orm::entity::prelude::*;

// No `Eq`: `value` is an f64. sea-orm only requires `PartialEq`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
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
    /// Observed value at transition time; source for per-group history (M-8).
    /// `None` on a disappearance transition — no observation was made.
    pub value: Option<f64>,
    /// Rendered labels, duplicated from the state row so history stays
    /// readable after that row is reaped (M-7).
    pub group_labels: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
