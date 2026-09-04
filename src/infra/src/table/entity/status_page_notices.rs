//! `SeaORM` Entity for the status_page_notices table.
//!
//! Org-scoped by design: one outage is one notice on every page showing an
//! affected component (pages derive via the notice→component join). These rows
//! are the uptime ledger — soft-delete only, mutations audit-logged.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_notices")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// 0 incident, 1 maintenance, 2 info.
    pub kind: i32,
    /// 0 none, 1 degraded, 2 partial_outage, 3 major_outage. Only ≥2 accrues
    /// downtime.
    pub impact: i32,
    /// 0 auto, 1 manual.
    pub source: i32,
    pub title: String,
    pub body: String,
    /// 0 scheduled, 1 active, 2 resolved.
    pub state: i32,
    /// Backdated to the first failing run of the confirming streak.
    pub starts_at: i64,
    pub resolved_at: Option<i64>,
    /// JSON `[{from,to}]` downtime intervals; merge-window re-opens append a
    /// segment so the healthy gap between flaps is never counted.
    pub segments: String,
    /// False-positive mark: excluded from the math, tombstone stays public.
    pub excluded_from_uptime: bool,
    pub deleted_at: Option<i64>,
    /// The check whose confirmed failure opened this auto-incident. One open
    /// auto-incident per check, enforced by the engine.
    pub auto_check_id: Option<String>,
    pub auto_recovery_streak: i32,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
