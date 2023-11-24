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

use crate::common::infra::config::STREAM_ALERTS;
use crate::common::meta::alerts::{AlertDestination, AlertDestinationResponse};
use crate::service::db;

#[tracing::instrument(skip(destination))]
pub async fn save_destination(
    org_id: &str,
    name: &str,
    destination: AlertDestination,
) -> Result<(), anyhow::Error> {
    if db::alerts::templates::get(org_id, &destination.template)
        .await
        .is_err()
    {
        return Err(anyhow::anyhow!(
            "Alert template {} not found",
            destination.template
        ));
    }
    db::alerts::destinations::set(org_id, name, destination).await
}

#[tracing::instrument]
pub async fn list_destinations(
    org_id: &str,
) -> Result<Vec<AlertDestinationResponse>, anyhow::Error> {
    db::alerts::destinations::list(org_id).await
}

#[tracing::instrument]
pub async fn delete_destination(
    org_id: &str,
    name: &str,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    for alert_list in STREAM_ALERTS.iter() {
        for alert in alert_list.value().list.clone() {
            if alert_list.key().starts_with(org_id)
                && alert.destinations.contains(&name.to_string())
            {
                return Err((
                    http::StatusCode::FORBIDDEN,
                    anyhow::anyhow!("Alert destination is in use for alert {}", alert.name),
                ));
            }
        }
    }

    if db::alerts::destinations::get(org_id, name).await.is_err() {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert destination not found {}", name),
        ));
    }

    db::alerts::destinations::delete(org_id, name)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[tracing::instrument]
pub async fn get_destination(
    org_id: &str,
    name: &str,
) -> Result<AlertDestinationResponse, anyhow::Error> {
    db::alerts::destinations::get(org_id, name)
        .await
        .map_err(|_| anyhow::anyhow!("Alert destination not found"))
}
