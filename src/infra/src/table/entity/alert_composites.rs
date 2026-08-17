//! SeaORM entity for composite alert definitions.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_composites")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org: String,
    pub folder_id: String,
    pub name: String,
    pub description: Option<String>,
    pub expression: String,
    pub warning_counts_as_firing: bool,
    pub stale_child_policy: i16,
    pub destinations: Json,
    pub template: Option<String>,
    pub context_attributes: Option<Json>,
    pub enabled: bool,
    pub silence_seconds: i64,
    pub creates_incident: bool,
    pub workflows: Json,
    pub priority: Option<i32>,
    pub tags: Option<Json>,
    pub owner: Option<String>,
    pub last_edited_by: Option<String>,
    pub updated_at: Option<i64>,
    pub evaluation_generation: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::alert_composite_children::Entity")]
    Children,
}

impl Related<super::alert_composite_children::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Children.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
