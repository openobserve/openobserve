// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Built-in self-monitoring alerts over each org's `triggers` stream, seeded switched off.

use common::utils::sql::escape_like;
use config::{
    meta::{
        alerts::{
            Operator, QueryCondition, QueryType, TriggerCondition, alert::Alert, default_align_time,
        },
        folder::DEFAULT_FOLDER,
        self_reporting::usage::TRIGGERS_STREAM,
        stream::StreamType,
        system_settings::{SettingCategory, SettingScope, SystemSetting},
    },
    utils::sql::quote_sql_string,
};
use db::system_settings;
use infra::dist_lock;

/// Bumped when a built-in is added, so the next upgrade sweeps every org once more.
const SHIPPED_REVISION: u32 = 1;
const REVISION_KEY: &str = "prebuilt_alerts_revision";
const SWEEP_LOCK_KEY: &str = "/system/alerts/prebuilt_sweep";
const ORG_LOCK_PREFIX: &str = "/system/alerts/prebuilt_org/";
const PREBUILT: [Prebuilt; 3] = [
    Prebuilt {
        name: "o2_alert_evaluation_failures",
        description: "An alert's own query failed or timed out, so the alert is scheduled but checks nothing.",
        columns: "error",
        filter: "module = 'alert' AND status = 'error'",
        threshold: 1,
    },
    Prebuilt {
        name: "o2_alert_notification_failures",
        description: "An alert fired but its notification could not be delivered.",
        columns: "error",
        filter: "module = 'alert' AND status = 'notify_failed'",
        threshold: 1,
    },
    Prebuilt {
        name: "o2_scheduler_job_backlog",
        description: "Scheduled jobs are running more than five minutes late, so alerts and reports evaluate stale windows.",
        columns: "module, delay_in_secs",
        filter: "delay_in_secs > 300",
        threshold: 5,
    },
];

struct Prebuilt {
    /// Also the seed record's key, so a shipped name never changes.
    name: &'static str,
    description: &'static str,
    columns: &'static str,
    filter: &'static str,
    threshold: i64,
}

impl Prebuilt {
    /// Scoped to its org, since `_meta` and other reporting orgs hold every org's rows.
    fn sql(&self, org_id: &str) -> String {
        // Its own rows are left out, so a failure of this alert cannot keep it firing.
        format!(
            "SELECT _timestamp, org, \"key\", {} FROM \"{TRIGGERS_STREAM}\" WHERE org = {} AND {} \
             AND \"key\" NOT LIKE '{}/%'",
            self.columns,
            quote_sql_string(org_id),
            self.filter,
            escape_like(self.name)
        )
    }

    /// The default is switched off and unwired, so an upgrade never starts paging anyone.
    fn definition(&self, org_id: &str) -> Alert {
        let mut alert = Alert::default();
        alert.name = self.name.to_string();
        alert.description = self.description.to_string();
        alert.stream_type = StreamType::Logs;
        alert.stream_name = TRIGGERS_STREAM.to_string();
        alert.query_condition = QueryCondition {
            query_type: QueryType::SQL,
            sql: Some(self.sql(org_id)),
            ..Default::default()
        };
        alert.trigger_condition = TriggerCondition {
            period: 15,
            operator: Operator::GreaterThanEquals,
            threshold: self.threshold,
            frequency: 300,
            silence: 60,
            align_time: default_align_time(),
            ..Default::default()
        };
        alert
    }
}

/// Whether `alert` is a built-in, which can be switched off or edited but not deleted or renamed.
pub fn is_builtin(alert: &Alert) -> bool {
    alert.stream_type == StreamType::Logs
        && alert.stream_name == TRIGGERS_STREAM
        && PREBUILT.iter().any(|prebuilt| prebuilt.name == alert.name)
}

/// Once per shipped revision, every org that already has a `triggers` stream.
pub async fn seed_prebuilt_alerts() -> Result<(), anyhow::Error> {
    if applied_revision().await? >= SHIPPED_REVISION {
        return Ok(());
    }
    let locker = dist_lock::lock(SWEEP_LOCK_KEY, 0).await?;
    let result = sweep().await;
    dist_lock::unlock(&locker).await?;
    drop(locker);
    result
}

/// For an org whose `triggers` stream was just created, so it is seeded without a restart.
pub fn seed_org_in_background(org_id: &str) {
    let org_id = org_id.to_string();
    tokio::task::spawn(async move {
        if let Err(e) = seed_org(&org_id).await {
            log::error!("[PREBUILT_ALERTS] seeding failed for org {org_id}: {e}");
        }
    });
}

async fn sweep() -> Result<(), anyhow::Error> {
    // Another node may have finished the sweep while this one waited for the lock.
    if applied_revision().await? >= SHIPPED_REVISION {
        return Ok(());
    }
    let orgs = crate::organization::list_all_orgs(None).await?;
    let mut failed = 0;
    for org in &orgs {
        // In-memory only: `schema::exists` queries the database for every org without the stream.
        let stream = infra::schema::get_stream_schema_from_cache(
            &org.identifier,
            TRIGGERS_STREAM,
            StreamType::Logs,
        )
        .await;
        if stream.is_none() {
            continue;
        }
        if let Err(e) = seed_org(&org.identifier).await {
            failed += 1;
            log::error!(
                "[PREBUILT_ALERTS] seeding failed for org {}: {e}",
                org.identifier
            );
        }
    }
    log::info!(
        "[PREBUILT_ALERTS] sweep complete: {failed} of {} orgs failed",
        orgs.len()
    );
    // A failed org has no other way to be seeded, so the revision waits for a clean sweep.
    if failed == 0 {
        let setting = SystemSetting::new_system(REVISION_KEY, SHIPPED_REVISION.into())
            .with_category(SettingCategory::Alerts)
            .with_description("Revision of the built-in alerts every org has been seeded with");
        system_settings::set(&setting).await?;
    }
    Ok(())
}

/// Per org, because the sweep and a stream creation on another node can seed the same org at once.
async fn seed_org(org_id: &str) -> Result<(), anyhow::Error> {
    let locker = dist_lock::lock(&format!("{ORG_LOCK_PREFIX}{org_id}"), 0).await?;
    let mut result = Ok(());
    for prebuilt in &PREBUILT {
        if let Err(e) = seed_one(org_id, prebuilt).await {
            result = Err(e);
        }
    }
    dist_lock::unlock(&locker).await?;
    result
}

async fn seed_one(org_id: &str, prebuilt: &Prebuilt) -> Result<(), anyhow::Error> {
    let existing =
        db::alerts::alert::get_by_name(org_id, StreamType::Logs, TRIGGERS_STREAM, prebuilt.name)
            .await?;
    if existing.is_none() {
        let conn = infra::db::get_orm_client_rw().await;
        let alert = prebuilt.definition(org_id);
        crate::alerts::alert::create(conn, org_id, DEFAULT_FOLDER, alert, false).await?;
    }
    Ok(())
}

async fn applied_revision() -> Result<u32, anyhow::Error> {
    let stored = system_settings::get(&SettingScope::System, None, None, REVISION_KEY).await?;
    Ok(stored
        .and_then(|setting| setting.setting_value.as_u64())
        .and_then(|revision| u32::try_from(revision).ok())
        .unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Array, StringArray};
    use config::{
        meta::self_reporting::usage::{
            RunOutcome::{self, Error, Firing, NotifyFailed},
            TriggerData,
            TriggerDataType::{self, Alert as AlertJob, Report},
        },
        utils::{json, record_batch_ext::convert_json_to_record_batch},
    };
    use search::datafusion::exec::DataFusionContextBuilder;

    use super::*;
    use crate::{
        alerts::alert::{AlertError, validate_save},
        self_reporting::triggers_schema::expected_schema,
    };

    fn row(
        org: &str,
        module: TriggerDataType,
        key: &str,
        status: RunOutcome,
        delay: i64,
    ) -> TriggerData {
        TriggerData {
            org: org.to_string(),
            module,
            key: key.to_string(),
            status,
            delay_in_secs: Some(delay),
            ..TriggerData::init_for_reflection()
        }
    }

    /// Runs on the stream's own schema, so a misspelt column fails here and not in production.
    async fn matching_keys(sql: &str, rows: &[TriggerData]) -> Vec<String> {
        let schema = Arc::new(expected_schema().unwrap());
        let data: Vec<_> = rows
            .iter()
            .map(|r| Arc::new(json::to_value(r).unwrap()))
            .collect();
        let ctx = DataFusionContextBuilder::new().build(0).await.unwrap();
        ctx.register_batch(
            TRIGGERS_STREAM,
            convert_json_to_record_batch(&schema, &data).unwrap(),
        )
        .unwrap();
        let mut keys = vec![];
        for batch in ctx.sql(sql).await.unwrap().collect().await.unwrap() {
            let column = batch.column_by_name("key").unwrap();
            let column = column.as_any().downcast_ref::<StringArray>().unwrap();
            keys.extend((0..column.len()).map(|i| column.value(i).to_string()));
        }
        keys.sort();
        keys
    }

    #[tokio::test]
    async fn each_query_matches_only_its_own_failures_in_its_own_org() {
        let rows = [
            row("acme", AlertJob, "cpu/1", Error, 0),
            row("acme", AlertJob, "cpu/2", NotifyFailed, 0),
            row(
                "acme",
                AlertJob,
                "o2_alert_notification_failures/3",
                NotifyFailed,
                0,
            ),
            row("acme", AlertJob, "mem/4", Firing, 301),
            row("acme", Report, "weekly/5", Error, 300),
            row("other", AlertJob, "cpu/6", Error, 900),
            row("other", AlertJob, "cpu/7", NotifyFailed, 900),
        ];
        for (prebuilt, keys) in PREBUILT.iter().zip([["cpu/1"], ["cpu/2"], ["mem/4"]]) {
            let sql = prebuilt.sql("acme");
            assert_eq!(matching_keys(&sql, &rows).await, keys, "{}", prebuilt.name);
        }
    }

    #[test]
    fn a_built_in_is_known_by_its_name_on_the_triggers_stream() {
        let mut alert = PREBUILT[0].definition("acme");
        assert!(is_builtin(&alert));
        alert.stream_name = "default".to_string();
        assert!(!is_builtin(&alert));
        let mut renamed = PREBUILT[0].definition("acme");
        renamed.name = "cpu_high".to_string();
        assert!(!is_builtin(&renamed));
    }

    #[tokio::test]
    async fn an_org_id_cannot_widen_its_query() {
        let rows = [row("acme", AlertJob, "cpu/1", Error, 0)];
        let sql = PREBUILT[0].sql("x' OR '1'='1");
        assert!(matching_keys(&sql, &rows).await.is_empty());
    }

    #[tokio::test]
    async fn a_seeded_alert_is_switched_off_and_passes_every_check_before_the_schema_lookup() {
        for prebuilt in &PREBUILT {
            let alert = prebuilt.definition("acme");
            assert!(
                !alert.enabled && alert.destinations.is_empty(),
                "{}",
                prebuilt.name
            );
            let err = validate_save("acme", Some(DEFAULT_FOLDER), &alert, true, false)
                .await
                .unwrap_err();
            // Without a database the schema lookup is the first check that can fail.
            assert!(
                matches!(
                    err,
                    AlertError::StreamNotFound { .. } | AlertError::InfraError(_)
                ),
                "{}: {err:?}",
                prebuilt.name
            );
        }
    }
}
