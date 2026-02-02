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

use std::io::{self, Write};

/// Progress bar for migration
pub struct ProgressBar {
    current: u64,
    total: u64,
    width: usize,
    prefix: String,
}

impl ProgressBar {
    pub fn new(total: u64, prefix: &str) -> Self {
        Self {
            current: 0,
            total,
            width: 30,
            prefix: prefix.to_string(),
        }
    }

    pub fn update(&mut self, current: u64) {
        self.current = current;
        self.render();
    }

    pub fn finish(&mut self) {
        self.current = self.total;
        self.render();
        println!();
    }

    fn render(&self) {
        let percent = if self.total > 0 {
            (self.current as f64 / self.total as f64 * 100.0) as u32
        } else {
            100
        };

        let filled = if self.total > 0 {
            (self.current as f64 / self.total as f64 * self.width as f64) as usize
        } else {
            self.width
        };

        let empty = self.width - filled;

        let bar = format!("{}{}", "#".repeat(filled), ".".repeat(empty));

        print!(
            "\r{} {} {:>8}/{:<8} ({:>3}%)",
            self.prefix, bar, self.current, self.total, percent
        );
        io::stdout().flush().unwrap();
    }
}

/// Table statistics for migration report
#[derive(Debug, Clone)]
pub struct TableStats {
    pub name: String,
    pub total: u64,
    pub migrated: u64,
    pub timestamp_col: Option<String>,
    pub duration_ms: u64,
}

/// Print migration plan (dry run)
pub fn print_plan(
    source: &str,
    target: &str,
    mode: &str,
    batch_size: u64,
    tables: &[TableStats],
    excluded: &[String],
) {
    println!();
    println!("Migration Plan ({mode})");
    println!("══════════════════════════════════════════════════════════════");
    println!();
    println!("Source:      {source}");
    println!("Target:      {target}");
    println!(
        "Mode:        {}",
        if mode == "incremental" {
            "Incremental"
        } else {
            "Full migration"
        }
    );
    println!("Batch size:  {batch_size}");
    println!();

    // Print excluded tables
    if !excluded.is_empty() {
        println!("Excluded: {}", excluded.join(", "));
        println!();
    }

    // Print table list
    println!("Tables to migrate ({}):", tables.len());
    println!("┌─────────────────────────────┬──────────┬─────────────────┐");
    println!("│ Table                       │ Records  │ Timestamp Col   │");
    println!("├─────────────────────────────┼──────────┼─────────────────┤");

    let mut total_records = 0u64;
    for stats in tables {
        total_records += stats.total;
        let ts_col = stats.timestamp_col.as_deref().unwrap_or("(none)");
        println!(
            "│ {:<27} │ {:>8} │ {:<15} │",
            truncate_str(&stats.name, 27),
            stats.total,
            truncate_str(ts_col, 15)
        );
    }

    println!("├─────────────────────────────┼──────────┼─────────────────┤");
    println!(
        "│ TOTAL                       │ {:>8} │                 │",
        total_records
    );
    println!("└─────────────────────────────┴──────────┴─────────────────┘");
    println!();
    println!("To execute, remove --dry-run flag.");
}

/// Print migration report
pub fn print_report(
    tables: &[TableStats],
    start_time: i64,
    end_time: i64,
    source: &str,
    target: &str,
    command: &str,
) {
    println!();
    println!("══════════════════════════════════════════════════════════════");
    println!("Migration completed successfully!");
    println!();

    let duration_secs = (end_time - start_time) as f64 / 1_000_000.0;
    let datetime = chrono::DateTime::from_timestamp_micros(end_time)
        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    println!("Completed at: {datetime}");
    println!("Timestamp:    {end_time}");
    println!("Duration:     {:.1}s", duration_secs);

    let mut total_records = 0u64;
    for stats in tables {
        total_records += stats.migrated;
    }

    println!(
        "Total:        {} records ({} tables)",
        total_records,
        tables.len()
    );
    println!();
    println!("For incremental sync, use:");
    println!("  openobserve {command} -f {source} -t {target} --incremental --since {end_time}");
}

/// Print error message
pub fn print_error(table: &str, error: &str) {
    eprintln!();
    eprintln!("══════════════════════════════════════════════════════════════");
    eprintln!("Migration failed!");
    eprintln!();
    eprintln!("Table: {table}");
    eprintln!("Error: {error}");
    eprintln!();
    eprintln!("Please fix the error and retry the migration.");
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

    #[test]
    fn test_progress_bar_new() {
        let pb = ProgressBar::new(100, "Test");
        assert_eq!(pb.current, 0);
        assert_eq!(pb.total, 100);
        assert_eq!(pb.width, 30);
        assert_eq!(pb.prefix, "Test");
    }

    #[test]
    fn test_progress_bar_update() {
        let mut pb = ProgressBar::new(100, "Test");
        pb.update(50);
        assert_eq!(pb.current, 50);
    }

    #[test]
    fn test_progress_bar_finish() {
        let mut pb = ProgressBar::new(100, "Test");
        pb.update(50);
        pb.finish();
        assert_eq!(pb.current, 100);
    }

    #[test]
    fn test_progress_bar_zero_total() {
        let mut pb = ProgressBar::new(0, "Test");
        pb.update(0);
        pb.finish();
        assert_eq!(pb.current, 0);
        assert_eq!(pb.total, 0);
    }

    #[test]
    fn test_table_stats_creation() {
        let stats = TableStats {
            name: "users".to_string(),
            total: 1000,
            migrated: 500,
            timestamp_col: Some("updated_at".to_string()),
            duration_ms: 1234,
        };

        assert_eq!(stats.name, "users");
        assert_eq!(stats.total, 1000);
        assert_eq!(stats.migrated, 500);
        assert_eq!(stats.timestamp_col, Some("updated_at".to_string()));
        assert_eq!(stats.duration_ms, 1234);
    }

    #[test]
    fn test_table_stats_without_timestamp() {
        let stats = TableStats {
            name: "config".to_string(),
            total: 10,
            migrated: 10,
            timestamp_col: None,
            duration_ms: 100,
        };

        assert_eq!(stats.name, "config");
        assert!(stats.timestamp_col.is_none());
    }

    #[test]
    fn test_truncate_str_short() {
        assert_eq!(truncate_str("hello", 10), "hello");
        assert_eq!(truncate_str("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_str_exact() {
        assert_eq!(truncate_str("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_str_long() {
        assert_eq!(truncate_str("hello_world", 8), "hello...");
        assert_eq!(truncate_str("very_long_table_name", 10), "very_lo...");
    }

    #[test]
    fn test_truncate_str_empty() {
        assert_eq!(truncate_str("", 10), "");
    }

    #[test]
    fn test_truncate_str_minimum_length() {
        // When max_len is 3, we can only show "..."
        assert_eq!(truncate_str("hello", 4), "h...");
    }
}
