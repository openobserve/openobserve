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

//! Process memory split and thread counts, read from procfs (Linux only).
//!
//! `process_resident_memory_bytes` cannot tell heap from mapped files; the
//! container limit only sees the sum. RssAnon/RssFile split the two, and the
//! per-name thread count shows which runtime or blocking pool is holding threads
//! (each OS thread carries an allocator heap and a stack).

use std::{collections::HashMap, time::Duration};

use config::metrics::{PROCESS_MEMORY_BYTES, PROCESS_THREADS};

const INTERVAL: Duration = Duration::from_secs(15);

pub fn start() {
    if !cfg!(target_os = "linux") {
        return;
    }
    tokio::spawn(async {
        let mut interval = tokio::time::interval(INTERVAL);
        let mut seen: Vec<String> = Vec::new();
        loop {
            interval.tick().await;
            if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
                for (kind, bytes) in parse_status(&status) {
                    PROCESS_MEMORY_BYTES.with_label_values(&[kind]).set(bytes);
                }
            }
            let groups = thread_groups();
            for g in seen.iter().filter(|g| !groups.contains_key(*g)) {
                PROCESS_THREADS.with_label_values(&[g.as_str()]).set(0);
            }
            for (g, n) in &groups {
                PROCESS_THREADS.with_label_values(&[g.as_str()]).set(*n);
            }
            seen = groups.into_keys().collect();
        }
    });
}

fn parse_status(status: &str) -> Vec<(&'static str, i64)> {
    const KEYS: [(&str, &str); 4] = [
        ("RssAnon:", "anon"),
        ("RssFile:", "file"),
        ("RssShmem:", "shmem"),
        ("VmSwap:", "swap"),
    ];
    status
        .lines()
        .filter_map(|line| {
            let (_, kind) = KEYS.iter().find(|(k, _)| line.starts_with(k))?;
            let kb: i64 = line.split_whitespace().nth(1)?.parse().ok()?;
            Some((*kind, kb * 1024))
        })
        .collect()
}

/// Thread names with the trailing index removed: `job_runtime` (16-byte comm
/// limit applies, so `datafusion_runtime` reads as `datafusion_runt`).
fn thread_groups() -> HashMap<String, i64> {
    let mut groups = HashMap::new();
    let Ok(tasks) = std::fs::read_dir("/proc/self/task") else {
        return groups;
    };
    for task in tasks.flatten() {
        let Ok(comm) = std::fs::read_to_string(task.path().join("comm")) else {
            continue;
        };
        let name = comm
            .trim_end()
            .trim_end_matches(|c: char| c.is_ascii_digit() || c == '-' || c == '_' || c == '#');
        *groups.entry(name.to_string()).or_insert(0) += 1;
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status() {
        let s = "Name:\topenobserve\nRssAnon:\t   70000 kB\nRssFile:\t   60000 kB\nRssShmem:\t       0 kB\nVmSwap:\t       4 kB\n";
        let got = parse_status(s);
        assert_eq!(
            got,
            vec![
                ("anon", 70000 * 1024),
                ("file", 60000 * 1024),
                ("shmem", 0),
                ("swap", 4096)
            ]
        );
    }
}
