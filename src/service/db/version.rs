// Copyright 2023 Zinc Labs Inc.
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

use infra::db as infra_db;

use crate::common::infra::config;

pub async fn get() -> Result<String, anyhow::Error> {
    let db = infra_db::get_db().await;
    let ret = db.get("/meta/kv/version").await?;
    let version = std::str::from_utf8(&ret).unwrap();
    Ok(version.to_string())
}

pub async fn set() -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    db.put(
        "/meta/kv/version",
        bytes::Bytes::from(config::VERSION),
        infra_db::NO_NEED_WATCH,
        None,
    )
    .await?;
    Ok(())
}
