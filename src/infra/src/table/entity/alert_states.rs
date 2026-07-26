//! `SeaORM` Entity for the `alert_states` table (Part IV of `alerts.md`).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_states")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub alert_id: String,
    /// `""` is the per-alert rollup row; non-empty identifies one grouped series.
    #[sea_orm(primary_key, auto_increment = false)]
    pub group_key: String,
    /// `RunOutcome::to_i32`. `None` = never evaluated.
    pub last_outcome: Option<i32>,
    pub last_outcome_at: Option<i64>,
    /// When `last_outcome` last changed.
    pub since: Option<i64>,
    /// `AlertLevel::to_i32`. `None` = never classified.
    pub level: Option<i32>,
    /// When `level` last changed.
    pub level_since: Option<i64>,
    /// When `level` was last computed from a successful evaluation (freshness).
    pub level_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
