//! `SeaORM` Entity for alert_incidents table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_incidents")]
pub struct Model {
    /// KSUID (27 chars)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    /// blake3 hash of stable dimensions (64 chars)
    pub correlation_key: String,

    /// open, acknowledged, resolved
    pub status: String,
    /// P1, P2, P3, P4
    pub severity: String,

    /// JSON: {service, namespace, cluster, environment}
    pub stable_dimensions: Json,
    /// JSON: {service, upstream_services, downstream_services, ...}
    pub topology_context: Option<Json>,

    /// Timestamps in microseconds
    pub first_alert_at: i64,
    pub last_alert_at: i64,
    pub resolved_at: Option<i64>,

    pub alert_count: i32,

    pub title: Option<String>,
    pub assigned_to: Option<String>,

    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::alert_incident_alerts::Entity")]
    Alerts,
}

impl Related<super::alert_incident_alerts::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Alerts.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
