//! `SeaORM` Entity for the `alert_eval_intervals` table (S-16, the availability
//! ledger).
//!
//! One row per run of *constant* `(level, frequency_secs)` an alert held while
//! it was actually evaluating. Storage is O(state changes), not O(evaluations).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_eval_intervals")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub org: String,
    pub alert_id: String,
    /// `AlertLevel::to_i32` — the level held across this interval. Duplicated
    /// from `alert_state_transitions` on purpose: joining two tables with
    /// independently-configured retention would let a 90-day SLO lose its level
    /// history while keeping its coverage history, and a wrong SLI is worse
    /// than a frozen one.
    pub level: i32,
    /// The cadence in effect for THIS interval, seconds. Stored rather than
    /// read from the alert's current config so a cadence edit cannot
    /// retroactively rewrite historical coverage through the forward extension.
    pub frequency_secs: i64,
    /// First measured evaluation of the run (an evaluation *instant*, not a
    /// covered span).
    pub from_us: i64,
    /// Most recent measured evaluation of the run.
    pub to_us: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
