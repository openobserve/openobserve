use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_unrouted_signals")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// Canonical `k=v/k=v` of the dimensions that matched no rule. The queue
    /// is keyed on it, so a signal that keeps firing into the same gap is one
    /// row with a count rather than a row per firing.
    pub path: String,
    pub dimensions: String,
    pub occurrences: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    /// A sample of what fired here, for the operator's "which alert was this?"
    /// column. Nullable because routing decides before the subject is known.
    pub last_subject_type: Option<i32>,
    pub last_source_id: Option<String>,
    pub last_title: Option<String>,
    pub last_priority: Option<i32>,
    /// Set when somebody says "handled". Dismissing is not deleting — the
    /// evidence that the gap existed is worth keeping.
    pub dismissed_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
