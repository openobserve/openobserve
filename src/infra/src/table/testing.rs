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

//! The meta store the org-deletion teardown tests share, the one CI sets through `ZO_META_STORE`.

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
