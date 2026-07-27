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
    /// Last evaluation that actually included this group (M-7). Separate from
    /// `last_outcome_at`: a resolution advances the outcome clock but not this
    /// one, and the gap is what marks a row resolved. `None` = pre-migration.
    pub last_seen: Option<i64>,
    /// Rendered labels for UI and templates (M-4). `None` on the rollup row.
    pub group_labels: Option<String>,
    /// Rollup row only: true pre-cap group count, for the M-6 overflow warning.
    pub groups_observed: Option<i32>,
    /// Rollup row only: pre-cap count of firing (warning-or-worse) groups, for
    /// the "N of M groups firing" chip (§5.4).
    pub groups_firing: Option<i32>,
    /// Whether `groups_observed` is a `≥` lower bound (the bounded fetch page
    /// came back full). `None` = written before this column existed.
    pub groups_observed_is_lower_bound: Option<bool>,
    /// Whether `groups_firing` is a `≥` lower bound. Tracked separately because
    /// the two diverge: a full page that reached healthy groups has seen every
    /// firing group, so that count stays exact.
    pub groups_firing_is_lower_bound: Option<bool>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
