//! `SeaORM` Entity for synthetics_monitors table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics_monitors")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub folder_id: i64,
    pub tz_offset: i32,
    pub name: String,
    pub monitor_type: String,
    pub target: String,
    pub description: String,
    pub tags: Json,
    pub config: Json,
    /// Serialized `MonitorFrequency` — replaces interval_secs / frequency_type / cron_expr.
    pub frequency: Json,
    pub locations: Json,
    pub enabled: bool,
    pub destinations: Json,
    /// Extra monitor settings (retries, cooldown, auth, variables, rum toggles).
    pub settings: Json,
    /// Pre-computed next fire time (microseconds). 0 = fire on next scheduler tick.
    pub next_run_at: i64,
    /// When the scheduler last fanned out this monitor (microseconds).
    pub last_triggered_at: i64,
    /// Denormalised status from the most recent completed check.
    pub last_check_status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_construction() {
        let m = Model {
            id: "mon-1".to_string(),
            org_id: "org1".to_string(),
            folder_id: 1,
            tz_offset: 0,
            name: "Login Flow".to_string(),
            monitor_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            description: "Monitors the login flow".to_string(),
            tags: serde_json::json!(["prod", "checkout"]),
            config: serde_json::json!({"browser_devices": [{"browser": "chromium", "device": "laptop_large"}], "steps": []}),
            frequency: serde_json::json!({"type": "minutes", "interval": 5, "cron": ""}),
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({"retries": 1, "cooldown_secs": 0}),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: "unknown".to_string(),
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        };
        assert_eq!(m.id, "mon-1");
        assert_eq!(m.monitor_type, "browser");
        assert!(m.enabled);
        assert_eq!(m.next_run_at, 0);
    }
}
