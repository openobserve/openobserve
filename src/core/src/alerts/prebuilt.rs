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

//! Seeds three self-monitoring alerts over the `triggers` stream into each org, switched off.

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
    utils::{json, sql::quote_sql_string},
};
use db::system_settings;

/// The names an org was ever seeded, so an alert its users delete is never planted again.
const SEEDED_KEY: &str = "prebuilt_alerts_seeded";
const LOCK_KEY: &str = "/system/alerts/prebuilt_seed";
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

/// One lock across nodes, because two seeding the same org would both create its alerts.
pub async fn seed_prebuilt_alerts() -> Result<(), anyhow::Error> {
    use infra::dist_lock;

    let locker = dist_lock::lock(LOCK_KEY, 0).await?;
    let orgs = crate::organization::list_all_orgs(None)
        .await
        .unwrap_or_default();
    let mut failed = 0;
    for org in &orgs {
        if let Err(e) = seed_org(&org.identifier).await {
            failed += 1;
            log::error!(
                "[PREBUILT_ALERTS] seeding failed for org {}: {e}",
                org.identifier
            );
        }
    }
    dist_lock::unlock(&locker).await?;
    drop(locker);
    log::info!(
        "[PREBUILT_ALERTS] seeding complete: {}/{} orgs without error",
        orgs.len() - failed,
        orgs.len()
    );
    Ok(())
}

/// Only an org that already has the stream: creating it would make an empty org look ingested.
async fn seed_org(org_id: &str) -> Result<(), anyhow::Error> {
    let mut seeded = read_seeded(org_id).await?;
    let pending: Vec<&Prebuilt> = PREBUILT
        .iter()
        .filter(|prebuilt| !seeded.iter().any(|name| name == prebuilt.name))
        .collect();
    if pending.is_empty() || !infra::schema::exists(org_id, StreamType::Logs, TRIGGERS_STREAM).await
    {
        return Ok(());
    }
    let seeded_before = seeded.len();
    for prebuilt in pending {
        match seed_one(org_id, prebuilt).await {
            Ok(()) => seeded.push(prebuilt.name.to_string()),
            Err(e) => log::error!(
                "[PREBUILT_ALERTS] failed to seed '{}' into org {org_id}: {e}",
                prebuilt.name
            ),
        }
    }
    if seeded.len() > seeded_before {
        let value = json::to_value(&seeded)?;
        let setting = SystemSetting::new_org(org_id, SEEDED_KEY, value)
            .with_category(SettingCategory::Alerts)
            .with_description("Prebuilt alerts ever seeded into this org");
        system_settings::set(&setting).await?;
    }
    Ok(())
}

/// An alert the org already has under the name counts as seeded, so deleting it later is final.
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

/// A failed read is returned, not defaulted, or the write would forget names seeded before.
async fn read_seeded(org_id: &str) -> Result<Vec<String>, anyhow::Error> {
    let stored = system_settings::get(&SettingScope::Org, Some(org_id), None, SEEDED_KEY).await?;
    Ok(stored
        .and_then(|setting| json::from_value(setting.setting_value).ok())
        .unwrap_or_default())
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
        utils::record_batch_ext::convert_json_to_record_batch,
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
