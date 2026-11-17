//! `SeaORM` Entity for synthetics_checks table.

use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, Default, PartialEq, DeriveEntityModel)]
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
    /// Serialized `SyntheticFrequency` — replaces interval_secs / frequency_type / cron_expr.
    pub frequency: Json,
    pub locations: Json,
    pub enabled: bool,
    pub destinations: Json,
    /// Extra check settings (retries, cooldown, rum toggles). No secrets here.
    pub settings: Json,
    /// JSON blob: { "auth": {...}, "cookies": [...], "variables": [...] }
    /// All secret values encrypted per-field with AESenc:<base64> using the org DEK.
    pub secrets: String,
    /// Pre-computed next fire time (microseconds). 0 = fire on next scheduler tick.
    pub next_run_at: i64,
    /// When the scheduler last fanned out this check (microseconds).
    pub last_triggered_at: i64,
    /// Denormalised status from the most recent completed check.
    /// 0=Unknown, 1=Up, 2=Warning, 3=Down, 4=Error (no verdict: dispatch/lease failure)
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
    /// Template override by name for this check's messages; NULL uses the destination's.
    pub template: Option<String>,
    /// Consecutive status page Down verdicts, capped at 10.
    pub status_down_runs: i32,
    /// Consecutive status page Up verdicts, capped at 10.
    pub status_up_runs: i32,
    /// `scheduled_ts` of the last run applied to the streaks, in microseconds.
    pub status_run_ts: i64,
    /// `RunClass` DB integer of the newest finalized run. 0 = no run yet.
    pub last_run_class: i32,
    /// `scheduled_ts` of the first run in the current `last_run_class`, in microseconds.
    pub last_run_class_at: i64,
    /// `scheduled_ts` of the newest finalized run that tested the site, in microseconds. 0 = none.
    pub last_tested_at: i64,
    /// Finish time, in microseconds, of the run that started the current Up streak. It never
    /// goes down. A false alarm hold ends when it changes. 0 = no recovery yet.
    pub status_recovered_at: i64,
    /// [`crate::table::synthetics_checks::streak_sig`] of the streak columns, written with them by
    /// every writer of this build. A row whose streaks do not match it was written by an older
    /// build, which does not move the recovery stamp, so no false alarm hold may trust it.
    pub status_streak_sig: i64,
    /// When the current run of Not measured results started, in microseconds. 0 = no gap.
    pub gap_since: i64,
    /// Not measured runs in a row in the current gap.
    pub gap_runs: i32,
    /// When the "Monitoring gap" notice of the current gap was sent. 0 = not sent.
    pub gap_notified_at: i64,
    pub gap_resumed_at: i64,
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
            description: "Checks the login flow".to_string(),
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
            template: None,
            status_down_runs: 0,
            status_up_runs: 0,
            status_run_ts: 0,
            last_run_class: 0,
            last_run_class_at: 0,
            last_tested_at: 0,
            status_recovered_at: 0,
            status_streak_sig: 0,
            gap_since: 0,
            gap_runs: 0,
            gap_notified_at: 0,
            gap_resumed_at: 0,
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
