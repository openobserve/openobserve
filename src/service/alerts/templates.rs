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

use actix_web::http;

use crate::common::infra::config::ALERTS_DESTINATIONS;
use crate::common::meta::alert::DestinationTemplate;
use crate::service::db;

#[tracing::instrument(skip_all)]
pub async fn save_template(
    org_id: &str,
    name: &str,
    mut template: DestinationTemplate,
) -> Result<(), anyhow::Error> {
    if template.body.is_null() {
        return Err(anyhow::anyhow!("Alert template body empty"));
    }
    template.name = Some(name.to_string());
    db::alerts::templates::set(org_id, name, template.clone()).await
}

#[tracing::instrument]
pub async fn list_templates(org_id: &str) -> Result<Vec<DestinationTemplate>, anyhow::Error> {
    db::alerts::templates::list(org_id).await
}

#[tracing::instrument]
pub async fn delete_template(
    org_id: &str,
    name: &str,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    for dest in ALERTS_DESTINATIONS.iter() {
        if dest.key().starts_with(org_id) && dest.value().template.eq(&name) {
            return Err((
                http::StatusCode::FORBIDDEN,
                anyhow::anyhow!(
                    "Alert template is in use for destination {}",
                    &dest.value().clone().name.unwrap()
                ),
            ));
        }
    }

    if db::alerts::templates::get(org_id, name).await.is_err() {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert template not found {}", name),
        ));
    }
    db::alerts::templates::delete(org_id, name)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[tracing::instrument]
pub async fn get_template(org_id: &str, name: &str) -> Result<DestinationTemplate, anyhow::Error> {
    db::alerts::templates::get(org_id, name)
        .await
        .map_err(|_| anyhow::anyhow!("Alert template not found"))
}
