//! `SeaORM` Entity for the status_page_component_checks join table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_page_component_checks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub component_id: String,
    /// Dangling after check deletion is fine: the rebuilder reads it as
    /// no-data (tolerant read); a janitor prunes, synthetics core never
    /// writes here.
    pub synthetics_id: String,
    pub org_id: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
