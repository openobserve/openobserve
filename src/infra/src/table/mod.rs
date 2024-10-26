// Copyright 2024 OpenObserve Inc.
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

use config::get_config;

use crate::db::{sqlite::CLIENT_RW, SQLITE_STORE};

pub mod short_urls;

pub async fn init() -> Result<(), anyhow::Error> {
    short_urls::init().await?;
    Ok(())
}

/// Acquires a lock on the SQLite client if SQLite is configured as the meta store.
///
/// # Returns
/// - `Some(MutexGuard)` if SQLite is configured
/// - `None` if a different store is configured
pub async fn get_lock() -> Option<tokio::sync::MutexGuard<'static, sqlx::Pool<sqlx::Sqlite>>> {
    if get_config()
        .common
        .meta_store
        .eq_ignore_ascii_case(SQLITE_STORE)
    {
        Some(CLIENT_RW.lock().await)
    } else {
        None
    }
}
