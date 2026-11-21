use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_skipped_pages")]
pub struct Model {
    /// SHA-256 of the org, subject, firing, response and covering run.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// Tenant owning the skipped page.
    pub org_id: String,
    /// `incident` or `alert`.
    pub subject_type: String,
    /// Subject whose automatic page was covered by another run.
    pub subject_id: String,
    /// Linked incident, when the firing has one.
    pub incident_id: Option<String>,
    /// On-call response that requested the analysis, when present.
    pub response_id: Option<String>,
    /// `in_flight` or `cooling_down`.
    pub reason: String,
    /// Run that covered the skipped page.
    pub covering_run_id: String,
    /// Stable subject-local number, absent for runs predating numbering.
    pub covering_run_number: Option<i32>,
    /// Earliest retry time in microseconds, for cooldown skips.
    pub retry_after_us: Option<i64>,
    /// Cooldown duration in microseconds at refusal.
    pub cooldown_us: Option<i64>,
    /// Refusal time in microseconds.
    pub at_us: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
