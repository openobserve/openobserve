//! `SeaORM` Entity for alert_incidents table

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "alert_incidents")]
pub struct Model {
    /// KSUID (27 chars)
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,

    /// open, acknowledged, resolved
    pub status: String,
    /// P1, P2, P3, P4
    pub severity: String,

    pub group_values: Json,
    pub key_type: String,
    /// JSON: {service, upstream_services, downstream_services, ...}
    pub topology_context: Option<Json>,

    /// Timestamps in microseconds
    pub first_alert_at: i64,
    pub last_alert_at: i64,
    pub resolved_at: Option<i64>,

    pub alert_count: i32,

    pub title: Option<String>,
    pub assigned_to: Option<String>,

    /// Opaque external system references stored by Workflow action steps.
    /// Example: PD incident key, Slack thread timestamp, Jira ticket URL.
    /// JSON merge-patched via PATCH /incidents/{id}/metadata.
    pub external_refs: Option<Json>,
    /// Last system that changed incident status (e.g. "o2", "pagerduty").
    /// Used by sync loop prevention (WP-7) to avoid infinite status echoes.
    pub last_status_source: Option<String>,

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
