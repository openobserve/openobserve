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

//! Create the service version, identity, alias, deploy and verdict tables with their final columns.

use sea_orm_migration::prelude::*;

const TABLES: [TableSpec; 8] = [
    VERSIONS,
    IDENTITY_RULES,
    WHERE_SUMMARY,
    NAME_ALIASES,
    ALIAS_FENCES,
    DEPLOYS,
    VERDICTS,
    VERDICT_METRICS,
];

const VERSIONS: TableSpec = TableSpec {
    name: "service_versions",
    columns: &[
        ("version_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("service_name", Col::Str(256)),
        ("where_key", Col::Str(512)),
        ("where_kind", Col::Str(8)),
        ("k8s_cluster", Col::StrBlank(256)),
        ("k8s_namespace", Col::StrBlank(256)),
        ("scope_key", Col::Str(64)),
        ("env", Col::Str(256)),
        ("version", Col::StrBlank(128)),
        ("raw_version", Col::StrNull(256)),
        ("version_source", Col::Str(64)),
        ("image", Col::TextNull),
        ("image_ref", Col::TextNull),
        ("env_source", Col::Str(32)),
        ("env_source_value", Col::StrBlank(320)),
        ("first_seen", Col::Micros),
        ("last_seen", Col::Micros),
        ("traces_first_seen", Col::MicrosNull),
        ("traces_last_seen", Col::MicrosNull),
        ("rum_first_seen", Col::MicrosNull),
        ("rum_last_seen", Col::MicrosNull),
        ("deleted_at", Col::MicrosNull),
        ("created_at", Col::Micros),
        ("updated_at", Col::Micros),
    ],
    primary_key: &["version_key"],
    // Scope-keyed because (org, service, where) exceeds the btree key limit in multibyte text.
    indexes: &[
        (
            "idx_service_versions_scope_first",
            &["scope_key", "first_seen"],
        ),
        (
            "idx_service_versions_scope_last_seen",
            &["scope_key", "last_seen"],
        ),
        (
            "idx_service_versions_org_last_seen",
            &["org_id", "last_seen"],
        ),
        ("idx_service_versions_org_env", &["org_id", "env"]),
        (
            "idx_service_versions_org_cluster",
            &["org_id", "k8s_cluster"],
        ),
    ],
};

const IDENTITY_RULES: TableSpec = TableSpec {
    name: "service_identity_rules",
    columns: &[
        ("rule_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("rule_type", Col::Str(32)),
        ("scope", Col::Str(16)),
        ("k8s_cluster", Col::StrBlank(256)),
        ("where_key", Col::StrBlank(512)),
        ("service_name", Col::StrBlank(256)),
        ("value", Col::Str(128)),
        ("inferred_value", Col::StrBlank(256)),
        ("inferred_source", Col::StrBlank(32)),
        ("created_by", Col::Str(256)),
        ("updated_by", Col::Str(256)),
        ("created_at", Col::Micros),
        ("updated_at", Col::Micros),
        ("deleted_at", Col::MicrosNull),
        ("writer_cluster", Col::StrBlank(128)),
    ],
    primary_key: &["rule_key"],
    indexes: &[
        ("idx_service_identity_rules_org_scope", &["org_id", "scope"]),
        (
            "idx_service_identity_rules_org_where",
            &["org_id", "where_key"],
        ),
        (
            "idx_service_identity_rules_org_cluster",
            &["org_id", "k8s_cluster"],
        ),
    ],
};

const WHERE_SUMMARY: TableSpec = TableSpec {
    name: "service_where_summary",
    columns: &[
        ("summary_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("service_name", Col::Str(256)),
        ("where_key", Col::Str(512)),
        ("scope_key", Col::Str(64)),
        ("source_stream", Col::Str(256)),
        ("signal", Col::Str(8)),
        ("k8s_cluster", Col::StrBlank(256)),
        ("k8s_namespace", Col::StrBlank(256)),
        ("env", Col::Str(256)),
        ("env_source", Col::Str(32)),
        ("env_source_value", Col::StrBlank(320)),
        ("envs", Col::TextList),
        ("newest_version", Col::StrBlank(128)),
        ("newest_version_key", Col::Str(64)),
        ("newest_first_seen", Col::Micros),
        ("has_version", Col::Flag),
        ("first_seen", Col::Micros),
        ("last_seen", Col::Micros),
        ("purged_versions", Col::Count),
        ("updated_at", Col::Micros),
    ],
    primary_key: &["summary_key"],
    indexes: &[
        (
            "idx_service_where_summary_org_last_seen",
            &["org_id", "last_seen"],
        ),
        ("idx_service_where_summary_scope", &["scope_key"]),
        (
            "idx_service_where_summary_org_has_version",
            &["org_id", "has_version"],
        ),
    ],
};

const NAME_ALIASES: TableSpec = TableSpec {
    name: "service_name_aliases",
    columns: &[
        ("alias_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("kind", Col::Str(32)),
        ("scope", Col::Str(256)),
        ("alias", Col::Str(256)),
        ("canonical", Col::Str(256)),
        ("status", Col::Str(16)),
        ("origin", Col::Str(16)),
        ("evidence", Col::TextNull),
        ("confidence", Col::Str(8)),
        ("accepted_by", Col::StrNull(256)),
        ("accepted_at", Col::MicrosNull),
        ("batch_id", Col::StrNull(27)),
        ("prev_status", Col::StrNull(16)),
        ("first_seen", Col::MicrosNull),
        ("last_seen", Col::MicrosNull),
        ("created_by", Col::Str(256)),
        ("created_at", Col::Micros),
        ("updated_at", Col::Micros),
        ("deleted_at", Col::MicrosNull),
        ("writer_cluster", Col::Str(128)),
        ("fencing_token", Col::Count),
        ("allow_collisions", Col::Flag),
        ("conflicted", Col::Flag),
    ],
    primary_key: &["alias_key"],
    indexes: &[
        (
            "idx_service_aliases_org_kind_status",
            &["org_id", "kind", "status"],
        ),
        (
            "idx_service_aliases_org_canonical",
            &["org_id", "canonical"],
        ),
    ],
};

const ALIAS_FENCES: TableSpec = TableSpec {
    name: "service_name_alias_fences",
    columns: &[("region", Col::Str(128)), ("fencing_token", Col::Micros)],
    primary_key: &["region"],
    indexes: &[],
};

const DEPLOYS: TableSpec = TableSpec {
    name: "service_version_deploys",
    columns: &[
        ("deploy_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("service_name", Col::Str(256)),
        ("where_key", Col::Str(512)),
        ("scope_key", Col::Str(64)),
        ("cluster", Col::Str(128)),
        ("to_version", Col::Str(128)),
        ("to_image", Col::TextNull),
        ("to_version_key", Col::Str(64)),
        ("from_version", Col::StrNull(128)),
        ("from_image", Col::TextNull),
        ("from_version_key", Col::StrNull(64)),
        ("kind", Col::Str(16)),
        ("entry_source", Col::Str(8)),
        ("at", Col::Micros),
        ("share_at_entry", Col::Double),
        ("serving_versions", Col::Text),
        ("overflow_count", Col::Int),
        ("full_serving", Col::Text),
        ("source_streams_overflow", Col::Flag),
        ("source_streams", Col::Text),
        ("superseded_at", Col::MicrosNull),
        ("verdict_key", Col::StrNull(64)),
        ("created_at", Col::Micros),
        ("updated_at", Col::Micros),
    ],
    primary_key: &["deploy_key"],
    indexes: &[
        (
            "idx_sv_deploys_0",
            &["scope_key", "cluster", "superseded_at"],
        ),
        ("idx_sv_deploys_1", &["scope_key", "at"]),
        ("idx_sv_deploys_2", &["org_id", "at"]),
    ],
};

const VERDICTS: TableSpec = TableSpec {
    name: "service_version_verdicts",
    columns: &[
        ("verdict_key", Col::Str(64)),
        ("deploy_key", Col::Str(64)),
        ("deploy_kind", Col::Str(16)),
        ("rollback_outcome", Col::StrNull(16)),
        ("scope_key", Col::Str(64)),
        ("version_key", Col::Str(64)),
        ("org_id", Col::Str(256)),
        ("service_name", Col::Str(256)),
        ("where_key", Col::Str(512)),
        ("version", Col::Str(128)),
        ("image", Col::TextNull),
        ("cluster", Col::Str(128)),
        ("verdict", Col::Str(16)),
        ("state", Col::Str(16)),
        ("reason", Col::StrNull(32)),
        ("signal", Col::Str(8)),
        ("baseline_version", Col::StrNull(128)),
        ("baseline_image", Col::TextNull),
        ("baseline_rule", Col::Str(24)),
        ("baseline_where_key", Col::StrNull(512)),
        ("baseline_env", Col::StrNull(256)),
        ("source_streams_overflow", Col::Flag),
        ("source_streams", Col::Text),
        ("eval_priority", Col::Int),
        ("baseline_traffic_share", Col::DoubleNull),
        ("eval_start", Col::Micros),
        ("window_end", Col::Micros),
        ("baseline_start", Col::MicrosNull),
        ("baseline_end", Col::MicrosNull),
        ("checks_done", Col::Int),
        ("consecutive_regressed", Col::Int),
        ("traces_consecutive_regressed", Col::IntZero),
        ("rum_consecutive_regressed", Col::IntZero),
        ("n_new", Col::Micros),
        ("n_base", Col::Micros),
        ("headline_metric", Col::StrNull(32)),
        ("headline_new", Col::DoubleNull),
        ("headline_base", Col::DoubleNull),
        ("headline_lo", Col::DoubleNull),
        ("headline_hi", Col::DoubleNull),
        ("headline_ci_kind", Col::StrNull(16)),
        ("second_metric", Col::StrNull(32)),
        ("second_new", Col::DoubleNull),
        ("second_base", Col::DoubleNull),
        ("new_error_types", Col::Int),
        ("new_error_sample", Col::StrNull(256)),
        ("recheck_verdict", Col::StrNull(16)),
        ("rechecked_at", Col::MicrosNull),
        ("algo_version", Col::Int),
        ("first_evaluated_at", Col::Micros),
        ("last_evaluated_at", Col::Micros),
        ("frozen_at", Col::MicrosNull),
        ("created_at", Col::Micros),
        ("updated_at", Col::Micros),
        ("baseline_rule_initial", Col::Str(24)),
        ("baseline_switched_at", Col::MicrosNull),
        ("baseline_switch_reason", Col::StrNull(32)),
        ("baseline_version_initial", Col::StrNull(128)),
        ("baseline_image_initial", Col::TextNull),
        ("reason_code", Col::Str(32)),
        ("needs_metric", Col::StrNull(32)),
        ("needs_have", Col::MicrosNull),
        ("needs_need", Col::MicrosNull),
        ("baseline_cluster", Col::StrNull(128)),
        ("baseline_fanout_complete", Col::Bool),
        ("ns_consecutive_drop", Col::Int),
        ("ns_not_serving_since", Col::MicrosNull),
        ("ns_first_requests_at", Col::MicrosNull),
    ],
    primary_key: &["verdict_key"],
    indexes: &[
        ("idx_sv_verdicts_0", &["scope_key", "version"]),
        ("idx_sv_verdicts_1", &["org_id", "verdict", "state"]),
        (
            "idx_sv_verdicts_2",
            &["org_id", "state", "last_evaluated_at"],
        ),
        ("idx_sv_verdicts_3", &["deploy_key"]),
    ],
};

const VERDICT_METRICS: TableSpec = TableSpec {
    name: "service_version_verdict_metrics",
    columns: &[
        ("verdict_key", Col::Str(64)),
        ("metric", Col::Str(32)),
        ("new_value", Col::DoubleNull),
        ("base_value", Col::DoubleNull),
        ("delta", Col::DoubleNull),
        ("lo", Col::DoubleNull),
        ("hi", Col::DoubleNull),
        ("ci_kind", Col::Str(16)),
        ("badge", Col::Str(16)),
        ("band_new", Col::StrNull(8)),
        ("band_base", Col::StrNull(8)),
        ("n_new", Col::Micros),
        ("n_base", Col::Micros),
        ("updated_at", Col::Micros),
    ],
    primary_key: &["verdict_key", "metric"],
    indexes: &[],
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in &TABLES {
            manager.create_table(table.create_statement()).await?;
            for index in table.index_statements() {
                manager.create_index(index).await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES.iter().rev() {
            manager
                .drop_table(
                    Table::drop()
                        .table(Alias::new(table.name))
                        .if_exists()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

/// One table: its columns in order, its primary key and its secondary indexes.
struct TableSpec {
    name: &'static str,
    columns: &'static [(&'static str, Col)],
    primary_key: &'static [&'static str],
    indexes: &'static [(&'static str, &'static [&'static str])],
}

impl TableSpec {
    fn create_statement(&self) -> TableCreateStatement {
        let mut create = Table::create();
        create.table(Alias::new(self.name)).if_not_exists();
        for (name, col) in self.columns {
            let mut def = col.def(name);
            if self.primary_key == [*name] {
                def.primary_key();
            }
            create.col(def);
        }
        if self.primary_key.len() > 1 {
            let mut key = Index::create();
            for name in self.primary_key {
                key.col(Alias::new(*name));
            }
            create.primary_key(&mut key);
        }
        create.to_owned()
    }

    fn index_statements(&self) -> Vec<IndexCreateStatement> {
        self.indexes
            .iter()
            .map(|(index, columns)| {
                let mut create = Index::create();
                create
                    .if_not_exists()
                    .name(*index)
                    .table(Alias::new(self.name));
                for column in *columns {
                    create.col(Alias::new(*column));
                }
                create.to_owned()
            })
            .collect()
    }
}

/// Column kinds; JSON is `.text()` and times are microsecond `big_integer` (AGENTS.md).
#[derive(Clone, Copy)]
enum Col {
    Str(u32),
    StrBlank(u32),
    StrNull(u32),
    Text,
    TextNull,
    TextList,
    Micros,
    MicrosNull,
    Count,
    Int,
    IntZero,
    Double,
    DoubleNull,
    Bool,
    Flag,
}

impl Col {
    fn def(self, name: &str) -> ColumnDef {
        let mut def = ColumnDef::new(Alias::new(name));
        match self {
            Col::Str(len) => def.string_len(len).not_null(),
            Col::StrBlank(len) => def.string_len(len).not_null().default(""),
            Col::StrNull(len) => def.string_len(len).null(),
            Col::Text => def.text().not_null(),
            Col::TextNull => def.text().null(),
            Col::TextList => def.text().not_null().default("[]"),
            Col::Micros => def.big_integer().not_null(),
            Col::MicrosNull => def.big_integer().null(),
            Col::Count => def.big_integer().not_null().default(0),
            Col::Int => def.integer().not_null(),
            Col::IntZero => def.integer().not_null().default(0),
            Col::Double => def.double().not_null(),
            Col::DoubleNull => def.double().null(),
            Col::Bool => def.boolean().not_null(),
            Col::Flag => def.boolean().not_null().default(false),
        };
        def
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use sea_orm::{Iden, Iterable};
    use sea_orm_migration::MigrationName;

    use super::*;
    use crate::table::entity::{
        service_identity_rules, service_name_aliases, service_version_deploys,
        service_version_verdict_metrics, service_version_verdicts, service_versions,
        service_where_summary,
    };

    fn entity_columns<E: sea_orm::EntityTrait>(entity: E) -> (String, BTreeSet<String>) {
        (
            entity.table_name().to_string(),
            E::Column::iter().map(|c| Iden::to_string(&c)).collect(),
        )
    }

    #[test]
    fn test_migration_name() {
        assert_eq!(
            Migration.name(),
            "m20261220_000001_create_service_identity_tables"
        );
    }

    #[test]
    fn every_table_has_exactly_its_entity_columns() {
        let entities = [
            entity_columns(service_versions::Entity),
            entity_columns(service_identity_rules::Entity),
            entity_columns(service_where_summary::Entity),
            entity_columns(service_name_aliases::Entity),
            entity_columns(service_version_deploys::Entity),
            entity_columns(service_version_verdicts::Entity),
            entity_columns(service_version_verdict_metrics::Entity),
        ];
        for (table, columns) in entities {
            let spec = TABLES.iter().find(|t| t.name == table).unwrap();
            let created: BTreeSet<String> =
                spec.columns.iter().map(|(n, _)| (*n).to_owned()).collect();
            assert_eq!(created, columns, "{table}");
            assert_eq!(
                created.len(),
                spec.columns.len(),
                "{table}: duplicate column"
            );
        }
    }

    #[test]
    fn no_table_uses_a_json_or_timestamp_type() {
        for backend in [
            sea_orm::DatabaseBackend::Sqlite,
            sea_orm::DatabaseBackend::Postgres,
        ] {
            for table in &TABLES {
                let sql = backend.build(&table.create_statement()).to_string();
                let lower = sql.to_ascii_lowercase();
                for banned in ["json", "timestamp", "datetime", " date"] {
                    assert!(!lower.contains(banned), "{backend:?}: {banned} in {sql}");
                }
                assert!(lower.contains("primary key"), "{sql}");
            }
        }
    }

    #[tokio::test]
    async fn up_creates_every_table_and_down_drops_them() {
        for db in super::super::sqlite_and_postgres_for_test("svc_identity_migration").await {
            let manager = SchemaManager::new(&db);
            Migration.up(&manager).await.unwrap();
            Migration.up(&manager).await.unwrap();
            for table in &TABLES {
                assert!(
                    manager.has_table(table.name).await.unwrap(),
                    "{}",
                    table.name
                );
                for (column, _) in table.columns {
                    assert!(
                        manager.has_column(table.name, column).await.unwrap(),
                        "{}.{column}",
                        table.name
                    );
                }
            }
            Migration.down(&manager).await.unwrap();
            for table in &TABLES {
                assert!(
                    !manager.has_table(table.name).await.unwrap(),
                    "{}",
                    table.name
                );
            }
        }
    }
}
