//! `SeaORM` Entity for synthetics_monitors table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "synthetics")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub folder_id: String,
    pub tz_offset: i32,
    pub name: String,
    pub synthetics_type: String,
    pub target: String,
    pub description: String,
    pub tags: Json,
    pub config: Json,
    /// Serialized `MonitorFrequency` — replaces interval_secs / frequency_type / cron_expr.
    pub frequency: Json,
    pub locations: Json,
    pub enabled: bool,
    pub destinations: Json,
    /// Extra monitor settings (retries, cooldown, rum toggles). No secrets here.
    pub settings: Json,
    /// JSON blob: { "auth": {...}, "cookies": [...], "variables": [...] }
    /// All secret values encrypted per-field with AESenc:<base64> using the org DEK.
    pub secrets: String,
    /// Pre-computed next fire time (microseconds). 0 = fire on next scheduler tick.
    pub next_run_at: i64,
    /// When the scheduler last fanned out this monitor (microseconds).
    pub last_triggered_at: i64,
    /// Denormalised status from the most recent completed check.
    /// 0=Unknown, 1=Up, 2=Warning, 3=Down
    pub last_check_status: i32,
    /// Runs that have failed back to back; reset to 0 by a pass. Compared
    /// against `settings.alert_if_fails` to decide whether to notify.
    pub consecutive_failures: i32,
    /// When a notification was last sent, in microseconds. 0 = never.
    /// Compared against `settings.cooldown_mins`.
    pub last_alert_at: i64,
    /// Whether the check is currently in the alerting state. Without it,
    /// "recovered" cannot be told from "was never alerting" — and once a
    /// cooldown exists, silence stops meaning recovery.
    pub alerting: bool,
    /// When a degradation was last reported, in microseconds. 0 = not currently
    /// degraded. Separate from `last_alert_at` because a degradation persists —
    /// a certificate is `warning` on every run for weeks — so it needs
    /// transition-based suppression rather than a time window.
    pub degraded_notified_at: i64,
    pub owner: Option<String>,
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
            folder_id: "folder-1".to_string(),
            tz_offset: 0,
            name: "Login Flow".to_string(),
            synthetics_type: "browser".to_string(),
            target: "https://app.example.com".to_string(),
            description: "Monitors the login flow".to_string(),
            tags: serde_json::json!(["prod", "checkout"]),
            config: serde_json::json!({"browser_devices": [{"browser": "chromium", "device": "desktop"}], "steps": []}),
            frequency: serde_json::json!({"type": "minutes", "interval": 5, "cron": ""}),
            locations: serde_json::json!(["aws-us-east-1"]),
            enabled: true,
            destinations: serde_json::json!([]),
            settings: serde_json::json!({"retries": 1, "cooldown_mins": 0}),
            secrets: "{}".to_string(),
            next_run_at: 0,
            last_triggered_at: 0,
            last_check_status: 0,
            consecutive_failures: 0,
            last_alert_at: 0,
            alerting: false,
            degraded_notified_at: 0,
            owner: None,
            created_at: 1750000000000000,
            updated_at: 1750000000000000,
        };
        assert_eq!(m.id, "mon-1");
        assert_eq!(m.synthetics_type, "browser");
        assert!(m.enabled);
        assert_eq!(m.next_run_at, 0);
    }
}
