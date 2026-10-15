//! `SeaORM` Entity for the `rca_runs` table (one row per incident analysis run).

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_runs")]
pub struct Model {
    /// KSUID (27 chars), so ids sort by time.
    #[sea_orm(primary_key, auto_increment = false)]
    pub run_id: String,
    pub org_id: String,
    /// `incident` | `alert`.
    pub subject_type: String,
    pub subject_id: String,
    /// Equal to `subject_id` for an incident; the linked incident (or NULL) for an alert.
    pub incident_id: Option<String>,
    pub trigger: String,
    /// `fresh` | `build_on_previous`.
    pub mode: String,
    /// User email, or `system`.
    pub started_by: String,
    pub guidance: Option<String>,
    /// `running` | `waiting_input` | `completed` | `failed` | `cancelled`.
    pub state: String,
    /// Microseconds.
    pub started_at: i64,
    pub updated_at: i64,
    pub ended_at: Option<i64>,
    pub cancelled_by: Option<String>,
    pub outcome: Option<String>,
    pub confidence: Option<String>,
    pub report: Option<String>,
    pub result: Option<Json>,
    /// `{code, reason, details, trigger_type}`.
    pub error: Option<Json>,
    pub session_id: Option<String>,
    /// `{steps, tool_calls, duration_ms, tokens, credits, steered}`.
    pub stats: Option<Json>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
