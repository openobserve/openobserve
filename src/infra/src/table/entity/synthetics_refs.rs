//! SeaORM entity for the derived subtest reference index.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "synthetics_refs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub parent_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub child_id: String,
    pub org_id: String,
    /// How many `subtest` steps of the parent name this child; §5.5.2 counts each.
    pub occurrences: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::synthetics_checks::Entity",
        from = "Column::ParentId",
        to = "super::synthetics_checks::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Parent,
}

impl Related<super::synthetics_checks::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Parent.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
