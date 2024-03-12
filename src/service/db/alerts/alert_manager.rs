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

pub async fn get_mark(org_id: &str) -> String {
    let db = infra_db::get_db().await;
    let key = format!("/alert_manager/organization/{org_id}");
    let val = match db.get(&key).await {
        Ok(ret) => String::from_utf8_lossy(&ret).to_string(),
        Err(_) => "".to_string(),
    };
    if val.eq("NOP") { "".to_string() } else { val }
}

pub async fn set_mark(org_id: &str, node: Option<&str>) -> Result<(), anyhow::Error> {
    let db = infra_db::get_db().await;
    let key = format!("/alert_manager/organization/{org_id}");
    let val = if let Some(node) = node {
        node.to_string()
    } else {
        "NOP".to_string()
    };
    Ok(db
        .put(
            &key,
            val.into(),
            infra_db::NO_NEED_WATCH,
            chrono::Utc::now().timestamp_micros(),
        )
        .await?)
}
