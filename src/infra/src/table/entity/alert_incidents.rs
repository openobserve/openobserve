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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let m = Model {
            id: "inc-1".to_string(),
            org_id: "myorg".to_string(),
            status: "open".to_string(),
            severity: "P2".to_string(),
            group_values: serde_json::json!({"service": "api"}),
            key_type: "service".to_string(),
            topology_context: None,
            first_alert_at: 1000,
            last_alert_at: 2000,
            resolved_at: None,
            alert_count: 3,
            title: Some("High Error Rate".to_string()),
            assigned_to: None,
            created_at: 1000,
            updated_at: 2000,
        };
        assert_eq!(m.id, "inc-1");
        assert_eq!(m.status, "open");
        assert_eq!(m.severity, "P2");
        assert_eq!(m.alert_count, 3);
        assert!(m.topology_context.is_none());
        assert!(m.resolved_at.is_none());
    }
}
