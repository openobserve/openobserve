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

/// Migration configuration
#[derive(Debug, Clone)]
pub struct MigrationConfig {
    /// Source database type: sqlite, mysql, postgresql
    pub from: String,
    /// Target database type: sqlite, mysql, postgresql
    pub to: String,
    /// Batch size for each migration batch
    pub batch_size: u64,
    /// Only migrate specified tables (comma-separated)
    pub tables: Option<Vec<String>>,
    /// Exclude specified tables (comma-separated)
    pub exclude: Option<Vec<String>>,
    /// Truncate target tables before migration
    pub truncate_target: bool,
    /// Incremental mode
    pub incremental: bool,
    /// Incremental start time (microseconds timestamp)
    pub since: Option<i64>,
    /// Dry run mode - only print plan, don't execute
    pub dry_run: bool,
}

impl Default for MigrationConfig {
    fn default() -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            batch_size: 1000,
            tables: None,
            exclude: None,
            truncate_target: false,
            incremental: false,
            since: None,
            dry_run: false,
        }
    }
}

impl MigrationConfig {
    pub fn new(from: &str, to: &str) -> Self {
        Self {
            from: from.to_lowercase(),
            to: to.to_lowercase(),
            ..Default::default()
        }
    }

    pub fn with_batch_size(mut self, batch_size: u64) -> Self {
        self.batch_size = batch_size;
        self
    }

    pub fn with_tables(mut self, tables: Option<String>) -> Self {
        self.tables = tables.map(|t| t.split(',').map(|s| s.trim().to_string()).collect());
        self
    }

    pub fn with_exclude(mut self, exclude: Option<String>) -> Self {
        self.exclude = exclude.map(|t| t.split(',').map(|s| s.trim().to_string()).collect());
        self
    }

    pub fn with_truncate_target(mut self, truncate: bool) -> Self {
        self.truncate_target = truncate;
        self
    }

    pub fn with_incremental(mut self, incremental: bool, since: Option<i64>) -> Self {
        self.incremental = incremental;
        self.since = since;
        self
    }

    pub fn with_dry_run(mut self, dry_run: bool) -> Self {
        self.dry_run = dry_run;
        self
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<(), anyhow::Error> {
        let valid_dbs = ["sqlite", "mysql", "postgresql", "postgres"];

        if !valid_dbs.contains(&self.from.as_str()) {
            return Err(anyhow::anyhow!(
                "Invalid source database type: {}. Valid options: sqlite, mysql, postgresql",
                self.from
            ));
        }

        if !valid_dbs.contains(&self.to.as_str()) {
            return Err(anyhow::anyhow!(
                "Invalid target database type: {}. Valid options: sqlite, mysql, postgresql",
                self.to
            ));
        }

        if self.from == self.to {
            return Err(anyhow::anyhow!(
                "Source and target database types must be different"
            ));
        }

        if self.incremental && self.since.is_none() {
            return Err(anyhow::anyhow!(
                "Incremental mode requires --since parameter"
            ));
        }

        if self.batch_size == 0 {
            return Err(anyhow::anyhow!("Batch size must be greater than 0"));
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_config_default() {
        let config = MigrationConfig::default();
        assert!(config.from.is_empty());
        assert!(config.to.is_empty());
        assert_eq!(config.batch_size, 1000);
        assert!(config.tables.is_none());
        assert!(config.exclude.is_none());
        assert!(!config.truncate_target);
        assert!(!config.incremental);
        assert!(config.since.is_none());
        assert!(!config.dry_run);
    }

    #[test]
    fn test_migration_config_new() {
        let config = MigrationConfig::new("SQLite", "MySQL");
        assert_eq!(config.from, "sqlite");
        assert_eq!(config.to, "mysql");
        assert_eq!(config.batch_size, 1000);
    }

    #[test]
    fn test_migration_config_builder_pattern() {
        let config = MigrationConfig::new("sqlite", "postgresql")
            .with_batch_size(500)
            .with_tables(Some("users,orders".to_string()))
            .with_exclude(Some("logs".to_string()))
            .with_truncate_target(true)
            .with_incremental(true, Some(1234567890))
            .with_dry_run(true);

        assert_eq!(config.from, "sqlite");
        assert_eq!(config.to, "postgresql");
        assert_eq!(config.batch_size, 500);
        assert_eq!(
            config.tables,
            Some(vec!["users".to_string(), "orders".to_string()])
        );
        assert_eq!(config.exclude, Some(vec!["logs".to_string()]));
        assert!(config.truncate_target);
        assert!(config.incremental);
        assert_eq!(config.since, Some(1234567890));
        assert!(config.dry_run);
    }

    #[test]
    fn test_with_tables_trims_whitespace() {
        let config = MigrationConfig::new("sqlite", "mysql")
            .with_tables(Some(" users , orders , products ".to_string()));

        assert_eq!(
            config.tables,
            Some(vec![
                "users".to_string(),
                "orders".to_string(),
                "products".to_string()
            ])
        );
    }

    #[test]
    fn test_with_exclude_trims_whitespace() {
        let config =
            MigrationConfig::new("sqlite", "mysql").with_exclude(Some(" logs , temp ".to_string()));

        assert_eq!(
            config.exclude,
            Some(vec!["logs".to_string(), "temp".to_string()])
        );
    }

    #[test]
    fn test_with_tables_none() {
        let config = MigrationConfig::new("sqlite", "mysql").with_tables(None);
        assert!(config.tables.is_none());
    }

    #[test]
    fn test_validate_valid_config() {
        let config = MigrationConfig::new("sqlite", "mysql");
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_all_valid_db_types() {
        // Test all valid source types
        for from in &["sqlite", "mysql", "postgresql", "postgres"] {
            for to in &["sqlite", "mysql", "postgresql", "postgres"] {
                if from != to {
                    let config = MigrationConfig::new(from, to);
                    assert!(
                        config.validate().is_ok(),
                        "Expected valid for from={}, to={}",
                        from,
                        to
                    );
                }
            }
        }
    }

    #[test]
    fn test_validate_invalid_source_db() {
        let config = MigrationConfig::new("invalid", "mysql");
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Invalid source database type")
        );
    }

    #[test]
    fn test_validate_invalid_target_db() {
        let config = MigrationConfig::new("sqlite", "invalid");
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Invalid target database type")
        );
    }

    #[test]
    fn test_validate_same_source_and_target() {
        let config = MigrationConfig::new("sqlite", "sqlite");
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Source and target database types must be different")
        );
    }

    #[test]
    fn test_validate_incremental_without_since() {
        let config = MigrationConfig::new("sqlite", "mysql").with_incremental(true, None);
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Incremental mode requires --since parameter")
        );
    }

    #[test]
    fn test_validate_incremental_with_since() {
        let config =
            MigrationConfig::new("sqlite", "mysql").with_incremental(true, Some(1234567890));
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_validate_zero_batch_size() {
        let config = MigrationConfig::new("sqlite", "mysql").with_batch_size(0);
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Batch size must be greater than 0")
        );
    }

    #[test]
    fn test_validate_non_zero_batch_size() {
        let config = MigrationConfig::new("sqlite", "mysql").with_batch_size(1);
        assert!(config.validate().is_ok());
    }
}
