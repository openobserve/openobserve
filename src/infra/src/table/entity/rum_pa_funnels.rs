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

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Serde form is the super-cluster replication payload.
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "rum_pa_funnels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub org_id: String,
    pub app: String,
    pub name: String,
    /// `name.trim().to_lowercase()`; unique per `(org_id, app)`.
    pub name_key: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    pub definition: Json,
    /// A snapshot compiled by the web at save time; the server never runs it.
    #[sea_orm(column_type = "Text")]
    pub sql: String,
    /// The distinct named-event ids the definition's steps reference.
    pub event_ids: Json,
    pub version: i32,
    pub created_by: String,
    pub updated_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Hash of the app's exclusion rules `sql` was compiled with; `None` counts as changed.
    #[serde(default)]
    pub rules_hash: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> serde_json::Value {
        serde_json::json!({
            "id": "f1",
            "org_id": "acme",
            "app": "web",
            "name": "Signup",
            "name_key": "signup",
            "description": null,
            "definition": {},
            "sql": "SELECT 1",
            "event_ids": [],
            "version": 1,
            "created_by": "a@x.io",
            "updated_by": "a@x.io",
            "created_at": 10,
            "updated_at": 10
        })
    }

    #[test]
    fn p1_r6_a_payload_without_rules_hash_reads_as_none() {
        let row: Model = serde_json::from_value(payload()).unwrap();
        let back = serde_json::to_value(&row).unwrap();
        assert_eq!(back.get("rules_hash"), Some(&serde_json::Value::Null));
    }

    #[test]
    fn p1_r6_a_payload_with_rules_hash_keeps_it() {
        let mut sent = payload();
        sent["rules_hash"] = "0123456789abcdef".into();
        let row: Model = serde_json::from_value(sent).unwrap();
        let back = serde_json::to_value(&row).unwrap();
        assert_eq!(back["rules_hash"], "0123456789abcdef");
    }
}
