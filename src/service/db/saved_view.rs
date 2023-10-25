// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::common::{
    infra::{db as infra_db, errors::Error},
    meta::saved_view::{
        RequestCreateView, RequestUpdateView, View, ViewWithoutData, Views, ViewsWithoutData,
    },
    utils::json,
};

pub const SAVED_VIEWS_KEY_PREFIX: &str = "/organization/savedviews";

pub async fn set_view(org_id: &str, view: &RequestCreateView) -> Result<View, Error> {
    let db = &infra_db::get_db().await;
    let view_id = uuid::Uuid::new_v4().to_string();
    let view = View {
        org_id: org_id.into(),
        view_id: view_id.clone(),
        data: view.data.clone(),
        view_name: view.view_name.clone(),
    };
    let key = format!("{}/{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id, view_id);
    db.put(
        &key,
        json::to_vec(&view).unwrap().into(),
        infra_db::NO_NEED_WATCH,
    )
    .await?;
    Ok(view)
}

/// Update the given view
pub async fn update_view(
    org_id: &str,
    view_id: &str,
    view: &RequestUpdateView,
) -> Result<View, Error> {
    let db = &infra_db::get_db().await;

    let key = format!("{}/{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id, view_id);
    let updated_view = match get_view(org_id, view_id).await {
        Ok(original_view) => View {
            data: view.data.clone(),
            view_name: view.view_name.clone(),
            ..original_view
        },
        Err(e) => return Err(e),
    };
    db.put(
        &key,
        json::to_vec(&updated_view).unwrap().into(),
        infra_db::NO_NEED_WATCH,
    )
    .await?;
    Ok(updated_view)
}

/// Get the saved view id associated with an org_id
pub async fn get_view(org_id: &str, view_id: &str) -> Result<View, Error> {
    let db = &infra_db::get_db().await;
    let key = format!("{}/{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id, view_id);
    let ret = db.get(&key).await?;
    let view = json::from_slice(&ret).unwrap();
    Ok(view)
}

/// Return all the saved views associated with a provided org_id
pub async fn get_views(org_id: &str) -> Result<Views, Error> {
    let db = &infra_db::get_db().await;
    let key = format!("{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id);
    let ret = db.list_values(&key).await?;
    let views: Vec<View> = ret
        .iter()
        .map(|view| json::from_slice(view).unwrap())
        .collect();

    Ok(Views { views })
}

/// Return all the saved views but query limited data only, associated with a provided org_id
/// This will not contain the payload.
pub async fn get_views_list_only(org_id: &str) -> Result<ViewsWithoutData, Error> {
    let db = &infra_db::get_db().await;
    let key = format!("{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id);
    let ret = db.list_values(&key).await?;
    let mut views: Vec<ViewWithoutData> = ret
        .iter()
        .map(|view| json::from_slice(view).unwrap())
        .collect();
    views.sort_by_key(|v| v.view_name.clone());

    Ok(ViewsWithoutData { views })
}

/// Delete a saved view id associated with an org-id
// pub async fn delete_view(org_id: &str, view_id: &str) -> Result<View, Error> {
pub async fn delete_view(org_id: &str, view_id: &str) -> Result<(), Error> {
    let db = &infra_db::get_db().await;
    let key = format!("{}/{}/{}", SAVED_VIEWS_KEY_PREFIX, org_id, view_id);
    db.delete(&key, false, infra_db::NO_NEED_WATCH).await?;
    Ok(())
}
