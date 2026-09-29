//! `SeaORM` Entity for per-user failed-login and lockout state.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "user_auth_state")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub email: String,
    pub failed_attempts: i32,
    pub lockout_level: i32,
    #[sea_orm(nullable)]
    pub locked_until: Option<i64>,
    #[sea_orm(nullable)]
    pub last_failed_at: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::users::Entity",
        from = "Column::Email",
        to = "super::users::Column::Email",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Users,
}

impl Related<super::users::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Users.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
