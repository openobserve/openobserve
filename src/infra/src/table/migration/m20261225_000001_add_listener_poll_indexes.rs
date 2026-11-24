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

//! `(org, change time)` indexes for the reads that poll these tables for an org's recent changes,
//! and the on-call event change time the listener reads ledgers incrementally by.

use sea_orm_migration::prelude::*;

/// Unix microseconds of each event row's last insert or rewrite.
const EVENTS: &str = "oncall_response_events";
const EVENTS_CHANGED: &str = "updated_at";
/// The listener reads every org's changed events as one range on the change time.
const EVENTS_CHANGED_IDX: &str = "oncall_response_events_updated_idx";
/// `(table, org column, change-time column, index)`: change-time polls that lacked an index.
const INDEXES: [(&str, &str, &str, &str); 9] = [
    (
        "alert_incidents",
        "org_id",
        "updated_at",
        "alert_incidents_org_updated_idx",
    ),
    (
        "rca_runs",
        "org_id",
        "updated_at",
        "rca_runs_org_updated_idx",
    ),
    (
        "oncall_responses",
        "org_id",
        "updated_at",
        "oncall_responses_org_updated_idx",
    ),
    ("alerts", "org", "updated_at", "alerts_org_updated_idx"),
    (
        "service_version_verdicts",
        "org_id",
        "updated_at",
        "service_version_verdicts_org_updated_idx",
    ),
    (
        "fleet_configs",
        "org_id",
        "updated_at",
        "fleet_configs_org_updated_idx",
    ),
    (
        "service_version_deploys",
        "org_id",
        "updated_at",
        "service_version_deploys_org_updated_idx",
    ),
    (
        "fleet_config_versions",
        "org_id",
        "created_at",
        "fleet_config_versions_org_created_idx",
    ),
    (
        "llm_prompt_versions",
        "org_id",
        "created_at",
        "llm_prompt_versions_org_created_idx",
    ),
];
/// The compare's still-open half reads only unresolved incidents, which this partial index holds.
const OPEN_INCIDENTS: &str = "alert_incidents_org_open_idx";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column(EVENTS, EVENTS_CHANGED).await? {
            // Existing rows read the upgrade time, so the first incremental read compares them all.
            let upgraded = ColumnDef::new(Alias::new(EVENTS_CHANGED))
                .big_integer()
                .not_null()
                .default(config::utils::time::now_micros())
                .to_owned();
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(EVENTS))
                        .add_column(upgraded)
                        .to_owned(),
                )
                .await?;
        }
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(EVENTS_CHANGED_IDX)
                    .table(Alias::new(EVENTS))
                    .col(Alias::new(EVENTS_CHANGED))
                    .to_owned(),
            )
            .await?;
        for (table, org, at, name) in INDEXES {
            manager
                .create_index(
                    Index::create()
                        .if_not_exists()
                        .name(name)
                        .table(Alias::new(table))
                        .col(Alias::new(org))
                        .col(Alias::new(at))
                        .to_owned(),
                )
                .await?;
        }
        manager
            .get_connection()
            .execute_unprepared(&format!(
                "CREATE INDEX IF NOT EXISTS {OPEN_INCIDENTS} ON alert_incidents (org_id) \
                 WHERE status <> 'resolved'"
            ))
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, _, _, name) in INDEXES {
            manager
                .drop_index(
                    Index::drop()
                        .if_exists()
                        .name(name)
                        .table(Alias::new(table))
                        .to_owned(),
                )
                .await?;
        }
        manager
            .get_connection()
            .execute_unprepared(&format!("DROP INDEX IF EXISTS {OPEN_INCIDENTS}"))
            .await?;
        manager
            .drop_index(
                Index::drop()
                    .if_exists()
                    .name(EVENTS_CHANGED_IDX)
                    .table(Alias::new(EVENTS))
                    .to_owned(),
            )
            .await?;
        if manager.has_column(EVENTS, EVENTS_CHANGED).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Alias::new(EVENTS))
                        .drop_column(Alias::new(EVENTS_CHANGED))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::get_orm_client_ddl, table::testing};

    async fn present(manager: &SchemaManager<'_>) -> Vec<bool> {
        let mut found = Vec::new();
        for (table, _, _, name) in INDEXES {
            found.push(manager.has_index(table, name).await.unwrap());
        }
        found.push(
            manager
                .has_index("alert_incidents", OPEN_INCIDENTS)
                .await
                .unwrap(),
        );
        found.push(manager.has_index(EVENTS, EVENTS_CHANGED_IDX).await.unwrap());
        found.push(manager.has_column(EVENTS, EVENTS_CHANGED).await.unwrap());
        found
    }

    #[tokio::test]
    async fn every_poll_index_and_the_event_change_time_exist_after_up_and_are_gone_after_down() {
        if !testing::meta_store().await {
            return;
        }
        let manager = SchemaManager::new(get_orm_client_ddl().await);
        assert_eq!(present(&manager).await, [true; 12], "after migrate");
        Migration.down(&manager).await.unwrap();
        assert_eq!(present(&manager).await, [false; 12], "after down");
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(present(&manager).await, [true; 12], "after up, twice");
    }
}
