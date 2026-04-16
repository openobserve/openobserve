//! `SeaORM` Entity for alert_incident_services join table.
//!
//! Links incidents to service_streams rows with an explicit role.
//! No FK constraints on either column — see migration comments for rationale.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_incident_services")]
pub struct Model {
    /// FK-less ref → alert_incidents.id (KSUID)
    #[sea_orm(primary_key, auto_increment = false)]
    pub incident_id: String,
    /// FK-less ref → service_streams.id (KSUID)
    #[sea_orm(primary_key, auto_increment = false)]
    pub service_stream_id: String,
    /// "responsible" | "impacted"
    pub role: String,
    /// "system" | "user"
    pub added_by: String,
    /// Timestamp in microseconds
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
