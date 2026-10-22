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
    #[sea_orm(column_type = "Text", nullable)]
    pub result: Option<String>,
    /// `{code, reason, details, trigger_type}`.
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    pub session_id: Option<String>,
    /// `{steps, tool_calls, duration_ms, tokens, credits, steered}`.
    #[sea_orm(column_type = "Text", nullable)]
    pub stats: Option<String>,
    pub stage: Option<String>,
    pub stage_index: Option<i16>,
    /// `{past_causes: [{id, summary}], skills: [name], toolsets: [name]}`.
    #[sea_orm(column_type = "Text", nullable)]
    pub context_used: Option<String>,
    pub continuations: i16,
    /// Serialized `Vec<SubjectRef>` of an alert run's pending on-call records.
    #[sea_orm(column_type = "Text", nullable)]
    pub oncall_subjects: Option<String>,
    /// Answer deadline of a `waiting_input` run, µs; NULL in every other state.
    pub input_deadline_at: Option<i64>,
    /// `callID` of the open `ask_responders` question while `waiting_input`.
    pub pending_question_id: Option<String>,
    /// Questions the run asked (at most 2 pause the run).
    #[sea_orm(default_value = 0)]
    pub questions_asked: i32,
    /// When the sweeper closed the answer deadline, µs; steering is refused after it.
    pub deadline_closed_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
