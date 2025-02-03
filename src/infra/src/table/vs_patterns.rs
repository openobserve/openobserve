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

use config::meta::vs_pattern::Pattern;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, ModelTrait, QueryFilter, QueryOrder, QuerySelect, Set, TryIntoModel,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::vs_patterns::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, FromStrError},
};

impl From<Model> for Pattern {
    fn from(value: Model) -> Self {
        Self {
            pattern_id: value.pattern_id.to_string(),
            name: value.name,
            pattern: value.pattern.unwrap_or_default(),
        }
    }
}

pub async fn get_patterns(org_id: &str, limit: Option<i64>) -> Result<Vec<Pattern>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find().filter(Column::Org.eq(org_id));
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res.into_model::<Model>().all(client).await?;

    Ok(records.into_iter().map(|x| x.into()).collect())
}
