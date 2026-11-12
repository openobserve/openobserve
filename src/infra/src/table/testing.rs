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

//! Shared test fixtures: the meta store CI sets through `ZO_META_STORE`, and an error-log capture.

static ERROR_LOGS: ErrorCapture = ErrorCapture(std::sync::Mutex::new(Vec::new()));

struct ErrorCapture(std::sync::Mutex<Vec<String>>);

impl log::Log for ErrorCapture {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Error
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            self.0.lock().unwrap().push(record.args().to_string());
        }
    }

    fn flush(&self) {}
}

/// Initialised and migrated once per test binary; false (the test skips) without `ZO_META_STORE`.
pub(crate) async fn meta_store() -> bool {
    static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
    if std::env::var("ZO_META_STORE").is_err() {
        eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
        return false;
    }
    ONCE.get_or_init(|| async {
        crate::db_init().await.expect("meta store");
        crate::table::migrate().await.expect("migrations");
    })
    .await;
    true
}

/// An id no other test or earlier run holds, since the meta store outlives a test.
pub(crate) fn unique(prefix: &str) -> String {
    format!("{prefix}_{}", config::utils::time::now_micros())
}

/// Starts recording error-level log lines for this test binary; call before the code under test.
pub(crate) fn capture_error_logs() {
    if log::set_logger(&ERROR_LOGS).is_ok() {
        log::set_max_level(log::LevelFilter::Error);
    }
}

/// Error-level lines recorded since [`capture_error_logs`] that contain `needle`.
pub(crate) fn logged_errors_containing(needle: &str) -> Vec<String> {
    ERROR_LOGS
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|line| line.contains(needle))
        .cloned()
        .collect()
}
