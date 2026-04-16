//! `SeaORM` Entity for service_routing_config table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "service_routing_config")]
pub struct Model {
    /// KSUID (27 chars)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// FK → service_streams.id (KSUID)
    pub service_stream_id: String,
    /// JSON: Vec<String> — validated against org users at application layer
    pub owner_emails: Json,
    /// Nullable until WP-3 ships; any value accepted and stored
    pub oncall_schedule_id: Option<String>,
    /// Nullable until WP-4 ships; any value accepted and stored
    pub escalation_policy_id: Option<String>,
    /// JSON: Vec<{kind: String, ref: String}> — extensible without migration
    pub notification_targets: Json,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
