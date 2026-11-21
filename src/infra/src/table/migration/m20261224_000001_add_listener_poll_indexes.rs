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

//! `(org, updated_at)` indexes for the reads that poll these tables for an org's recent changes.

use sea_orm_migration::prelude::*;

/// `(table, org column, index)`: tables a change-time poll reads by org that lacked one.
const INDEXES: [(&str, &str, &str); 6] = [
    (
        "alert_incidents",
        "org_id",
        "alert_incidents_org_updated_idx",
    ),
    ("rca_runs", "org_id", "rca_runs_org_updated_idx"),
    (
        "oncall_responses",
        "org_id",
        "oncall_responses_org_updated_idx",
    ),
    ("alerts", "org", "alerts_org_updated_idx"),
    (
        "service_version_verdicts",
        "org_id",
        "service_version_verdicts_org_updated_idx",
    ),
    ("fleet_configs", "org_id", "fleet_configs_org_updated_idx"),
];

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, org, name) in INDEXES {
            manager
                .create_index(
                    Index::create()
                        .if_not_exists()
                        .name(name)
                        .table(Alias::new(table))
                        .col(Alias::new(org))
                        .col(Alias::new("updated_at"))
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for (table, _, name) in INDEXES {
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
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::get_orm_client_ddl, table::testing};

    async fn present(manager: &SchemaManager<'_>) -> Vec<bool> {
        let mut found = Vec::new();
        for (table, _, name) in INDEXES {
            found.push(manager.has_index(table, name).await.unwrap());
        }
        found
    }

    #[tokio::test]
    async fn every_poll_index_exists_after_up_and_is_gone_after_down() {
        if !testing::meta_store().await {
            return;
        }
        let manager = SchemaManager::new(get_orm_client_ddl().await);
        assert_eq!(present(&manager).await, [true; 6], "after migrate");
        Migration.down(&manager).await.unwrap();
        assert_eq!(present(&manager).await, [false; 6], "after down");
        Migration.up(&manager).await.unwrap();
        Migration.up(&manager).await.unwrap();
        assert_eq!(present(&manager).await, [true; 6], "after up, twice");
    }
}
