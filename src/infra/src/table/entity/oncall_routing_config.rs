use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_routing_config")]
pub struct Model {
    /// One configuration per org, so the org is the key.
    #[sea_orm(primary_key, auto_increment = false)]
    pub org_id: String,
    /// The team an operator nominated as the catch-all. Nullable, and nothing
    /// ever fills it in on the org's behalf: a fresh org has no default, and
    /// what does not route goes on the unrouted queue until somebody picks one.
    pub default_team_id: Option<String>,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
