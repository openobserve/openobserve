//! `SeaORM` Entity for the status_pages table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize)]
#[sea_orm(table_name = "status_pages")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub name: String,
    /// Public identifier: 22-char base62 from the OS CSPRNG, globally unique.
    pub slug: String,
    pub description: Option<String>,
    /// 0 draft, 1 public, 2 password.
    pub visibility: i32,
    /// Argon2id PHC string. Write-only at the API layer; never serialized out.
    pub password_hash: Option<String>,
    pub noindex: bool,
    pub show_uptime_percent: bool,
    pub show_timeline_bars: bool,
    pub show_response_time: bool,
    pub confirm_failures: i32,
    pub confirm_recovery: i32,
    pub confirm_after_secs: Option<i32>,
    pub brand_name: Option<String>,
    pub accent_color: Option<String>,
    pub display_tz: Option<String>,
    /// Set at first publish; uptime denominators never reach past it.
    pub tracking_since: Option<i64>,
    pub owner: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
