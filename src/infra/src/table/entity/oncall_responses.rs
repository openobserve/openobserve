use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_responses")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub subject_type: i32,
    pub subject_id: String,
    pub team_id: String,
    pub title: Option<String>,
    pub cause: Option<String>,
    pub cause_note: Option<String>,
    pub snoozed_until: Option<i64>,
    pub ladder_anchor: Option<i64>,
    pub ladder_run: Option<i32>,
    pub responder_role: i32,
    pub origin_response_id: Option<String>,
    pub priority: i32,
    pub state: i32,
    pub opened_at: i64,
    pub acked_by: Option<String>,
    pub acked_at: Option<i64>,
    pub closed_at: Option<i64>,
    pub incident_id: Option<String>,
    /// The runbook the alert named when this record opened. Copied, not
    /// joined: a page has to keep saying what it said when it fired.
    pub runbook_url: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
