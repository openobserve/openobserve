// Copyright 2025 OpenObserve Inc.
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

use std::collections::{HashMap, HashSet};

use chrono::Utc;

use super::{
    MigrationConfig,
    adapter::{DbAdapter, ForeignKeyInfo, create_adapter},
    progress::{ProgressBar, TableStats, print_error, print_plan, print_report},
};

/// file_list related tables (handled by migrate-file-list)
const FILE_LIST_TABLES: &[&str] = &[
    "file_list",
    "file_list_deleted",
    "file_list_history",
    "file_list_dump_stats",
    "file_list_jobs",
];

/// System internal tables (excluded from migration)
const SYSTEM_TABLES: &[&str] = &["sqlite_sequence"];

/// Run meta migration (all tables except file_list related)
pub async fn run_meta(config: MigrationConfig) -> Result<(), anyhow::Error> {
    config.validate()?;
    run_migration(config, MigrationMode::Meta).await
}

/// Run file_list migration
pub async fn run_file_list(config: MigrationConfig) -> Result<(), anyhow::Error> {
    config.validate()?;
    run_migration(config, MigrationMode::FileList).await
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum MigrationMode {
    Meta,
    FileList,
}

impl MigrationMode {
    fn name(&self) -> &'static str {
        match self {
            MigrationMode::Meta => "migrate-meta",
            MigrationMode::FileList => "migrate-file-list",
        }
    }
}

async fn run_migration(config: MigrationConfig, mode: MigrationMode) -> Result<(), anyhow::Error> {
    println!();
    println!("Starting migration ({})...", mode.name());
    println!("══════════════════════════════════════════════════════════════");
    println!();

    // 1. Connect to databases
    print!("Connecting to source ({})... ", config.from);
    let source = create_adapter(&config.from).await?;
    println!("✓");

    print!("Connecting to target ({})... ", config.to);
    let target = create_adapter(&config.to).await?;
    println!("✓");
    println!();

    // 2. Discover tables
    print!("Discovering tables... ");
    let all_tables = source.list_tables().await?;
    let filtered_tables = filter_tables(&all_tables, mode, &config);
    let excluded = get_excluded_tables(&all_tables, mode);

    // Get foreign keys from target to sort tables by dependencies
    let fks = target.get_foreign_keys().await?;
    let tables = sort_tables_by_dependencies(filtered_tables, &fks);
    println!("{} tables to migrate", tables.len());
    println!();

    if tables.is_empty() {
        println!("No tables to migrate.");
        return Ok(());
    }

    // 3. Validate tables
    print!("Validating table schemas... ");
    for table in &tables {
        validate_table(source.as_ref(), target.as_ref(), table).await?;
    }
    println!("✓");
    println!();

    // 4. Collect table stats
    let mut table_stats = Vec::new();
    for table in &tables {
        let columns = source.get_columns(table).await?;
        let timestamp_col = detect_timestamp_column(&columns);
        let count = source
            .count(
                table,
                timestamp_col.as_deref(),
                if config.incremental {
                    config.since
                } else {
                    None
                },
            )
            .await?;

        table_stats.push(TableStats {
            name: table.clone(),
            total: count,
            migrated: 0,
            timestamp_col,
            duration_ms: 0,
        });
    }

    // 5. Dry run check
    if config.dry_run {
        let mode_str = if config.incremental {
            "incremental"
        } else {
            "full"
        };
        print_plan(
            &config.from,
            &config.to,
            mode_str,
            config.batch_size,
            &table_stats,
            &excluded,
        );
        return Ok(());
    }

    // 6. Prepare target database
    if config.truncate_target {
        println!("Truncating target tables...");
        for table in &tables {
            print!("  {} ... ", table);
            target.truncate_table(table).await?;
            println!("✓");
        }
    }
    println!();

    // 7. Execute migration
    let start_time = Utc::now().timestamp_micros();

    for (idx, table) in tables.iter().enumerate() {
        let stats = &mut table_stats[idx];
        let table_start = std::time::Instant::now();

        let result = migrate_table(source.as_ref(), target.as_ref(), table, stats, &config).await;

        if let Err(e) = result {
            print_error(table, &e.to_string());
            return Err(e);
        }

        stats.duration_ms = table_start.elapsed().as_millis() as u64;
    }

    // 8. Print report
    let end_time = Utc::now().timestamp_micros();
    print_report(
        &table_stats,
        start_time,
        end_time,
        &config.from,
        &config.to,
        mode.name(),
    );

    // Close connections
    source.close().await?;
    target.close().await?;

    Ok(())
}

fn filter_tables(
    all_tables: &[String],
    mode: MigrationMode,
    config: &MigrationConfig,
) -> Vec<String> {
    let mut tables: Vec<String> = all_tables
        .iter()
        .filter(|t| {
            // Filter by mode
            let is_file_list = FILE_LIST_TABLES.contains(&t.as_str());
            let is_system = SYSTEM_TABLES.contains(&t.as_str());

            if is_system {
                return false;
            }

            match mode {
                MigrationMode::Meta => !is_file_list,
                MigrationMode::FileList => is_file_list,
            }
        })
        .cloned()
        .collect();

    // Apply --tables filter
    if let Some(ref include) = config.tables {
        tables.retain(|t| include.contains(t));
    }

    // Apply --exclude filter
    if let Some(ref exclude) = config.exclude {
        tables.retain(|t| !exclude.contains(t));
    }

    tables.sort();
    tables
}

/// Sort tables by foreign key dependencies using topological sort.
/// Parent tables (referenced by FK) come before child tables (with FK).
fn sort_tables_by_dependencies(tables: Vec<String>, fks: &[ForeignKeyInfo]) -> Vec<String> {
    let table_set: HashSet<&String> = tables.iter().collect();

    // Build adjacency list: table -> tables that depend on it
    // If A references B, then B must come before A
    let mut dependencies: HashMap<&String, Vec<&String>> = HashMap::new();
    let mut in_degree: HashMap<&String, usize> = HashMap::new();

    // Initialize all tables with in_degree 0
    for table in &tables {
        in_degree.insert(table, 0);
    }

    // Build the graph
    for fk in fks {
        // Only consider FKs where both tables are in our migration set
        if table_set.contains(&fk.table) && table_set.contains(&fk.referenced_table) {
            // fk.table depends on fk.referenced_table
            // So referenced_table -> table (referenced comes first)
            dependencies
                .entry(&fk.referenced_table)
                .or_default()
                .push(&fk.table);
            *in_degree.entry(&fk.table).or_insert(0) += 1;
        }
    }

    // Kahn's algorithm for topological sort
    let mut result = Vec::with_capacity(tables.len());
    let mut queue: Vec<&String> = in_degree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(table, _)| *table)
        .collect();

    // Sort queue for deterministic order (reverse for pop to get ascending)
    queue.sort_by(|a, b| b.cmp(a));

    while let Some(table) = queue.pop() {
        result.push(table.clone());

        if let Some(dependents) = dependencies.get(table) {
            for dependent in dependents {
                if let Some(degree) = in_degree.get_mut(dependent) {
                    *degree -= 1;
                    if *degree == 0 {
                        // Insert in sorted order for deterministic results (reverse order)
                        let pos = queue.partition_point(|x| x > dependent);
                        queue.insert(pos, dependent);
                    }
                }
            }
        }
    }

    // If there are cycles, some tables won't be in result
    // Add them at the end (this shouldn't happen with proper FK design)
    for table in &tables {
        if !result.contains(table) {
            log::warn!("Table {} may have circular FK dependencies", table);
            result.push(table.clone());
        }
    }

    result
}

fn get_excluded_tables(all_tables: &[String], mode: MigrationMode) -> Vec<String> {
    all_tables
        .iter()
        .filter(|t| {
            let is_file_list = FILE_LIST_TABLES.contains(&t.as_str());
            let is_system = SYSTEM_TABLES.contains(&t.as_str());

            if is_system {
                return true;
            }

            match mode {
                MigrationMode::Meta => is_file_list,
                MigrationMode::FileList => !is_file_list,
            }
        })
        .cloned()
        .collect()
}

async fn validate_table(
    source: &dyn DbAdapter,
    target: &dyn DbAdapter,
    table: &str,
) -> Result<(), anyhow::Error> {
    // Check target table exists
    let target_tables = target.list_tables().await?;
    if !target_tables.contains(&table.to_string()) {
        return Err(anyhow::anyhow!(
            "Table '{}' does not exist in target database.\n\
            Please initialize the target database first by running:\n\
            \n\
            ZO_META_STORE={} ./openobserve init-db\n",
            table,
            target.name()
        ));
    }

    // Check column compatibility
    let source_cols = source.get_columns(table).await?;
    let target_cols = target.get_columns(table).await?;

    let source_col_names: std::collections::HashSet<_> =
        source_cols.iter().map(|c| &c.name).collect();
    let target_col_names: std::collections::HashSet<_> =
        target_cols.iter().map(|c| &c.name).collect();

    // Check all source columns exist in target
    for col in &source_col_names {
        if !target_col_names.contains(col) {
            return Err(anyhow::anyhow!(
                "Column '{}' in table '{}' does not exist in target database",
                col,
                table
            ));
        }
    }

    Ok(())
}

fn detect_timestamp_column(columns: &[super::adapter::ColumnInfo]) -> Option<String> {
    // Priority: updated_at > created_at
    for col in columns {
        if col.name == "updated_at" {
            return Some("updated_at".to_string());
        }
    }
    for col in columns {
        if col.name == "created_at" {
            return Some("created_at".to_string());
        }
    }
    None
}

async fn migrate_table(
    source: &dyn DbAdapter,
    target: &dyn DbAdapter,
    table: &str,
    stats: &mut TableStats,
    config: &MigrationConfig,
) -> Result<(), anyhow::Error> {
    let columns = source.get_columns(table).await?;
    let column_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let primary_keys = source.get_primary_keys(table).await?;

    let timestamp_col = stats.timestamp_col.as_deref();
    let since = if config.incremental {
        config.since
    } else {
        None
    };

    let total = stats.total;
    // Create progress bar
    let mut progress = ProgressBar::new(total, &format!("{:<25}", truncate_str(table, 25)));

    let mut offset = 0u64;
    let mut migrated = 0u64;

    loop {
        let rows = source
            .select_batch(
                table,
                &column_names,
                offset,
                config.batch_size,
                timestamp_col,
                since,
            )
            .await?;

        if rows.is_empty() {
            break;
        }

        let batch_count = rows.len() as u64;
        target
            .upsert_batch(table, &column_names, &primary_keys, &rows)
            .await?;

        migrated += batch_count;
        offset += config.batch_size;

        progress.update(migrated);

        if batch_count < config.batch_size {
            break;
        }
    }

    progress.finish();
    stats.migrated = migrated;

    Ok(())
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_tables() -> Vec<String> {
        vec![
            "users".to_string(),
            "orders".to_string(),
            "file_list".to_string(),
            "file_list_deleted".to_string(),
            "file_list_history".to_string(),
            "file_list_dump_stats".to_string(),
            "file_list_jobs".to_string(),
            "sqlite_sequence".to_string(),
            "config".to_string(),
        ]
    }

    #[test]
    fn test_migration_mode_name() {
        assert_eq!(MigrationMode::Meta.name(), "migrate-meta");
        assert_eq!(MigrationMode::FileList.name(), "migrate-file-list");
    }

    #[test]
    fn test_filter_tables_meta_mode() {
        let all_tables = create_test_tables();
        let config = MigrationConfig::new("sqlite", "mysql");

        let result = filter_tables(&all_tables, MigrationMode::Meta, &config);

        // Should include non-file-list, non-system tables
        assert!(result.contains(&"users".to_string()));
        assert!(result.contains(&"orders".to_string()));
        assert!(result.contains(&"config".to_string()));

        // Should exclude file_list tables
        assert!(!result.contains(&"file_list".to_string()));
        assert!(!result.contains(&"file_list_deleted".to_string()));
        assert!(!result.contains(&"file_list_history".to_string()));
        assert!(!result.contains(&"file_list_dump_stats".to_string()));
        assert!(!result.contains(&"file_list_jobs".to_string()));

        // Should exclude system tables
        assert!(!result.contains(&"sqlite_sequence".to_string()));
    }

    #[test]
    fn test_filter_tables_file_list_mode() {
        let all_tables = create_test_tables();
        let config = MigrationConfig::new("sqlite", "mysql");

        let result = filter_tables(&all_tables, MigrationMode::FileList, &config);

        // Should include file_list tables
        assert!(result.contains(&"file_list".to_string()));
        assert!(result.contains(&"file_list_deleted".to_string()));
        assert!(result.contains(&"file_list_history".to_string()));
        assert!(result.contains(&"file_list_dump_stats".to_string()));
        assert!(result.contains(&"file_list_jobs".to_string()));

        // Should exclude non-file-list tables
        assert!(!result.contains(&"users".to_string()));
        assert!(!result.contains(&"orders".to_string()));
        assert!(!result.contains(&"config".to_string()));

        // Should exclude system tables
        assert!(!result.contains(&"sqlite_sequence".to_string()));
    }

    #[test]
    fn test_filter_tables_with_include_filter() {
        let all_tables = create_test_tables();
        let config =
            MigrationConfig::new("sqlite", "mysql").with_tables(Some("users,config".to_string()));

        let result = filter_tables(&all_tables, MigrationMode::Meta, &config);

        assert!(result.contains(&"users".to_string()));
        assert!(result.contains(&"config".to_string()));
        assert!(!result.contains(&"orders".to_string()));
    }

    #[test]
    fn test_filter_tables_with_exclude_filter() {
        let all_tables = create_test_tables();
        let config =
            MigrationConfig::new("sqlite", "mysql").with_exclude(Some("users".to_string()));

        let result = filter_tables(&all_tables, MigrationMode::Meta, &config);

        assert!(!result.contains(&"users".to_string()));
        assert!(result.contains(&"orders".to_string()));
        assert!(result.contains(&"config".to_string()));
    }

    #[test]
    fn test_filter_tables_sorted() {
        let all_tables = vec!["zebra".to_string(), "alpha".to_string(), "beta".to_string()];
        let config = MigrationConfig::new("sqlite", "mysql");

        let result = filter_tables(&all_tables, MigrationMode::Meta, &config);

        assert_eq!(result, vec!["alpha", "beta", "zebra"]);
    }

    #[test]
    fn test_get_excluded_tables_meta_mode() {
        let all_tables = create_test_tables();

        let result = get_excluded_tables(&all_tables, MigrationMode::Meta);

        // In Meta mode, file_list tables and system tables are excluded
        assert!(result.contains(&"file_list".to_string()));
        assert!(result.contains(&"file_list_deleted".to_string()));
        assert!(result.contains(&"sqlite_sequence".to_string()));

        // Regular tables should not be in excluded list
        assert!(!result.contains(&"users".to_string()));
        assert!(!result.contains(&"orders".to_string()));
    }

    #[test]
    fn test_get_excluded_tables_file_list_mode() {
        let all_tables = create_test_tables();

        let result = get_excluded_tables(&all_tables, MigrationMode::FileList);

        // In FileList mode, non-file-list tables and system tables are excluded
        assert!(result.contains(&"users".to_string()));
        assert!(result.contains(&"orders".to_string()));
        assert!(result.contains(&"config".to_string()));
        assert!(result.contains(&"sqlite_sequence".to_string()));

        // file_list tables should not be in excluded list
        assert!(!result.contains(&"file_list".to_string()));
        assert!(!result.contains(&"file_list_deleted".to_string()));
    }

    #[test]
    fn test_detect_timestamp_column_with_updated_at() {
        use super::super::adapter::ColumnInfo;

        let columns = vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
                is_nullable: false,
            },
            ColumnInfo {
                name: "created_at".to_string(),
                data_type: "TIMESTAMP".to_string(),
                is_nullable: false,
            },
            ColumnInfo {
                name: "updated_at".to_string(),
                data_type: "TIMESTAMP".to_string(),
                is_nullable: false,
            },
        ];

        let result = detect_timestamp_column(&columns);
        assert_eq!(result, Some("updated_at".to_string()));
    }

    #[test]
    fn test_detect_timestamp_column_with_only_created_at() {
        use super::super::adapter::ColumnInfo;

        let columns = vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
                is_nullable: false,
            },
            ColumnInfo {
                name: "created_at".to_string(),
                data_type: "TIMESTAMP".to_string(),
                is_nullable: false,
            },
        ];

        let result = detect_timestamp_column(&columns);
        assert_eq!(result, Some("created_at".to_string()));
    }

    #[test]
    fn test_detect_timestamp_column_without_timestamp() {
        use super::super::adapter::ColumnInfo;

        let columns = vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
                is_nullable: false,
            },
            ColumnInfo {
                name: "name".to_string(),
                data_type: "TEXT".to_string(),
                is_nullable: true,
            },
        ];

        let result = detect_timestamp_column(&columns);
        assert!(result.is_none());
    }

    #[test]
    fn test_truncate_str_short() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_str_exact() {
        assert_eq!(truncate_str("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_str_long() {
        assert_eq!(truncate_str("hello_world", 8), "hello...");
    }

    #[test]
    fn test_file_list_tables_constant() {
        assert!(FILE_LIST_TABLES.contains(&"file_list"));
        assert!(FILE_LIST_TABLES.contains(&"file_list_deleted"));
        assert!(FILE_LIST_TABLES.contains(&"file_list_history"));
        assert!(FILE_LIST_TABLES.contains(&"file_list_dump_stats"));
        assert!(FILE_LIST_TABLES.contains(&"file_list_jobs"));
        assert_eq!(FILE_LIST_TABLES.len(), 5);
    }

    #[test]
    fn test_system_tables_constant() {
        assert!(SYSTEM_TABLES.contains(&"sqlite_sequence"));
        assert_eq!(SYSTEM_TABLES.len(), 1);
    }

    #[test]
    fn test_sort_tables_no_fks() {
        let tables = vec!["c".to_string(), "a".to_string(), "b".to_string()];
        let fks: Vec<ForeignKeyInfo> = vec![];

        let result = sort_tables_by_dependencies(tables, &fks);

        // With no FKs, should be sorted alphabetically
        assert_eq!(result, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_sort_tables_with_fks() {
        // orders references users (users must come first)
        // order_items references orders (orders must come first)
        let tables = vec![
            "order_items".to_string(),
            "orders".to_string(),
            "users".to_string(),
        ];
        let fks = vec![
            ForeignKeyInfo {
                table: "orders".to_string(),
                referenced_table: "users".to_string(),
            },
            ForeignKeyInfo {
                table: "order_items".to_string(),
                referenced_table: "orders".to_string(),
            },
        ];

        let result = sort_tables_by_dependencies(tables, &fks);

        // users -> orders -> order_items
        let users_pos = result.iter().position(|x| x == "users").unwrap();
        let orders_pos = result.iter().position(|x| x == "orders").unwrap();
        let items_pos = result.iter().position(|x| x == "order_items").unwrap();

        assert!(users_pos < orders_pos);
        assert!(orders_pos < items_pos);
    }

    #[test]
    fn test_sort_tables_with_multiple_refs() {
        // child references both parent1 and parent2
        let tables = vec![
            "child".to_string(),
            "parent1".to_string(),
            "parent2".to_string(),
        ];
        let fks = vec![
            ForeignKeyInfo {
                table: "child".to_string(),
                referenced_table: "parent1".to_string(),
            },
            ForeignKeyInfo {
                table: "child".to_string(),
                referenced_table: "parent2".to_string(),
            },
        ];

        let result = sort_tables_by_dependencies(tables, &fks);

        // Both parent1 and parent2 should come before child
        let child_pos = result.iter().position(|x| x == "child").unwrap();
        let parent1_pos = result.iter().position(|x| x == "parent1").unwrap();
        let parent2_pos = result.iter().position(|x| x == "parent2").unwrap();

        assert!(parent1_pos < child_pos);
        assert!(parent2_pos < child_pos);
    }

    #[test]
    fn test_sort_tables_ignores_external_fks() {
        // orders references users, but users is not in our table list
        let tables = vec!["orders".to_string()];
        let fks = vec![ForeignKeyInfo {
            table: "orders".to_string(),
            referenced_table: "users".to_string(),
        }];

        let result = sort_tables_by_dependencies(tables, &fks);

        // Should still work, just orders in the list
        assert_eq!(result, vec!["orders"]);
    }
}
