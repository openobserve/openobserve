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

use openobserve::migration;

#[tokio::test]
async fn only_an_empty_db_counts_as_a_fresh_install_for_the_ext_auth_salt() {
    let data_dir = tempfile::tempdir().unwrap();
    unsafe {
        std::env::set_var("ZO_DATA_DIR", format!("{}/", data_dir.path().display()));
        std::env::set_var("ZO_META_STORE", "sqlite");
        std::env::set_var("ZO_LOCAL_MODE", "true");
        std::env::set_var("ZO_EXT_AUTH_SALT", "openobserve");
    }

    for attempt in 1..=2 {
        let err = migration::init_db().await.unwrap_err().to_string();
        assert!(err.contains("ZO_EXT_AUTH_SALT"), "attempt {attempt}: {err}");
    }

    // an install older than the schema-version key: meta rows, no version
    infra::db::create_table().await.unwrap();
    infra::db::get_db()
        .await
        .put("/instance/", "7f3a9c".into(), false, None)
        .await
        .unwrap();
    assert_eq!(infra::get_db_schema_version().await.unwrap(), 0);

    migration::init_db().await.unwrap();
    assert_eq!(
        infra::get_db_schema_version().await.unwrap(),
        config::DB_SCHEMA_VERSION
    );
}
