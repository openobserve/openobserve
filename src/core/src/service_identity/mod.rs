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

pub mod aliases;
pub mod signals;

#[cfg(feature = "enterprise")]
pub mod access;
#[cfg(feature = "enterprise")]
pub mod api;
#[cfg(feature = "enterprise")]
pub mod display_feed;

/// Tests share the global meta DB, so table creation must run once.
#[cfg(all(test, feature = "enterprise", feature = "test-utils"))]
pub(crate) async fn global_tables_for_tests() {
    static TABLES: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();

    TABLES
        .get_or_init(|| async {
            std::fs::create_dir_all(&config::get_config().common.data_db_dir).expect("db dir");
            let conn = infra::db::get_orm_client_rw().await;
            infra::table::service_versions::create_tables_for_tests(conn)
                .await
                .unwrap();
        })
        .await;
}
