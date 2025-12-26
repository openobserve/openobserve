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
