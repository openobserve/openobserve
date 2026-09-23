//! `SeaORM` Entity for the public_dashboards table.
//!
//! A public (unauthenticated) share of a dashboard. `slug` is the globally
//! unique, unguessable public identifier that resolves the tenant without an
//! org in the URL; the rebuilder materializes results into
//! `public_dashboard_snapshots` under the `published_by` identity.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "public_dashboards")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub dashboard_id: String,
    pub slug: String,
    // 0 draft, 1 public.
    pub visibility: i32,
    pub time_range_editable: bool,
    pub default_range_secs: Option<i64>,
    pub allowed_presets_secs: Option<String>,
    pub frozen_variables: Option<String>,
    pub rebuild_secs: i32,
    pub last_rebuilt_at: Option<i64>,
    // 0 pending, 1 ok, 2 error.
    pub rebuild_state: i32,
    pub unauthorized_streams: Option<String>,
    pub dashboard_version: i32,
    pub published_by: String,
    pub last_authorized_streams: Option<String>,
    pub enabled: bool,
    pub expires_at: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_accessed_at: Option<i64>,
    pub access_count: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
