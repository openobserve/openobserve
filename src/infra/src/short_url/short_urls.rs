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

use sea_orm::{entity::prelude::*, FromQueryResult};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "short_urls")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub short_id: String,
    #[sea_orm(column_type = "Text")]
    pub original_url: String,
    pub created_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[allow(dead_code)]
#[derive(FromQueryResult, Debug)]
pub struct ShortUrlRecord {
    #[allow(dead_code)]
    pub short_id: String,
    pub original_url: String,
}

impl ShortUrlRecord {
    pub fn new(short_id: &str, original_url: &str) -> Self {
        Self {
            short_id: short_id.to_string(),
            original_url: original_url.to_string(),
        }
    }
}

#[allow(dead_code)]
#[derive(FromQueryResult, Debug)]
pub struct ShortId {
    #[allow(dead_code)]
    pub short_id: String,
}
