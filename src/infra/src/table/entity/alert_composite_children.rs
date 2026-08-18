//! SeaORM entity for the derived composite-child reference index.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_composite_children")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub composite_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub child_alert_id: String,
    pub child_kind: i16,
    pub display_order: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::alert_composites::Entity",
        from = "Column::CompositeId",
        to = "super::alert_composites::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Composite,
}

impl Related<super::alert_composites::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Composite.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
