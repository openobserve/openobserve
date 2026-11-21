use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "rca_delivery_obligations")]
pub struct Model {
    /// SHA-256 of the org, run and response.
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// Tenant owning the delivery obligation.
    pub org_id: String,
    /// Run whose terminal result must reach the recipient.
    pub run_id: String,
    /// On-call response awaiting the terminal result.
    pub response_id: String,
    /// Serialized `SubjectRef` retaining the recipient's firing identity.
    #[sea_orm(column_type = "Text")]
    pub subject: String,
    /// Ladder generation that armed this obligation.
    pub ladder_run: i32,
    /// `verdict` or `no_verdict`, absent while armed.
    pub kind: Option<String>,
    /// `armed`, `pending` or `done`.
    pub state: String,
    /// Retry count, excluding the first delivery attempt.
    #[sea_orm(default_value = 0)]
    pub attempts: i32,
    /// Next eligible delivery time in microseconds.
    pub next_attempt_at: i64,
    /// Terminal delivery outcome, absent until done.
    pub outcome: Option<String>,
    /// Creation time in microseconds.
    pub created_at: i64,
    /// Last state or retry change in microseconds.
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
