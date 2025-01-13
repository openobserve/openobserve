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

// use chrono::Utc;
// use config::{ider, meta::annotations::AnnotationObj};
// use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set};

// use super::{entity::annotations::*, get_lock};
// use crate::{
//     db::{connect_to_orm, ORM_CLIENT},
//     errors,
// };

// pub async fn add_many(org_id: &str, annotations: AnnotationObj) -> Result<(), errors::Error> {
//     if annotations.annotations.is_empty() {
//         return Ok(());
//     }
//     let dashboard_id = annotations.dashboard_id;
//     let panels = annotations.panels;

//     let mut records: Vec<ActiveModel> = Vec::new();
//     for annotation in annotations.annotations {
//         let record = ActiveModel {
//             dashboard_id: Set(dashboard_id.clone()),
//             id: Set(ider::uuid()),
//             org_id: Set(org_id.to_string()),
//             start_time: Set(annotation.start_time),
//             end_time: Set(annotation.end_time),
//             title: Set(annotation.title),
//             text: Set(annotation.text),
//             tags: Set(annotation.tags),
//             panels: Set(panels.clone()),
//             created_at: Set(Utc::now().timestamp_micros()),
//         };
//         records.push(record);
//     }

//     // make sure only one client is writing to the database(only for sqlite)
//     let _lock = get_lock().await;

//     let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
//     Entity::insert_many(records)
//         .exec(client)
//         .await?;

//     Ok(())
// }

// pub async fn get(org_id: &str, dashboard_id: &str) -> Result<Vec<Model>, errors::Error> {
//     // make sure only one client is writing to the database(only for sqlite)
//     let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

//     let annotations = Entity::find()
//         .filter(
//             Column::OrgId
//                 .eq(org_id)
//                 .and(Column::DashboardId.eq(dashboard_id)),
//         )
//         .all(client)
//         .await?;

//     Ok(annotations)
// }
