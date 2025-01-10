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

use config::meta::annotations::Annotations;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set};

use super::{entity::annotations::*, get_lock};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors,
};

pub async fn add_many(annotations: Annotations) -> Result<(), errors::Error> {
    if annotations.annotations.is_empty() {
        return Ok(());
    }
    let dashboard_id = annotations.dashboard_id;
    let panels = annotations.panels;

    for annotation in annotations.annotations {
        let record = ActiveModel {
            dashboard_id: Set(annotation.dashboard_id),
            id: todo!(),
            org_id: todo!(),
            start_time: todo!(),
            end_time: todo!(),
            title: todo!(),
            text: todo!(),
            tags: todo!(),
            panels: todo!(),
            created_at: todo!(),
        };
    }

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert_many()
        .exec(client)
        .await?;

    Ok(())
}
