use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "oncall_teams")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub timezone: String,
    pub description: Option<String>,
    /// JSON array of alert Destination names — the team's own channel.
    ///
    /// `None` means nobody has ever set one, which falls back to the
    /// escalation policy's `destinations`; `Some("[]")` means the team has
    /// deliberately no channel. The two are not the same answer, which is why
    /// this is nullable rather than defaulted to an empty array.
    pub channel_destinations: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
