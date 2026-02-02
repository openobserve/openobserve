// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use actix_web::{HttpResponse, get, web};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DedupSummaryResponse {
    /// Total number of alerts in organization
    pub total_alerts: usize,
    /// Number of alerts with deduplication enabled
    pub alerts_with_dedup: usize,
    /// Total alerts suppressed in time period
    pub suppressions_total: i64,
    /// Total alerts that passed dedup in time period
    pub passed_total: i64,
    /// Suppression rate (0.0 to 1.0)
    pub suppression_rate: f64,
    /// Current pending batches (grouping)
    pub pending_batches: i64,
    /// Timestamp when data was collected
    pub timestamp: i64,
}

/// Get deduplication summary statistics for an organization
#[utoipa::path(
    context_path = "/api",
    tag = "Alerts",
    operation_id = "GetDedupSummary",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", body = DedupSummaryResponse),
    )
)]
#[get("/{org_id}/alerts/dedup/summary")]
pub async fn get_dedup_summary(
    org_id: web::Path<String>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();

    // Get all alerts for the organization
    let alerts_data = match crate::service::db::alerts::alert::list(&org_id, None, None).await {
        Ok(data) => data,
        Err(e) => {
            log::error!("Failed to list alerts for org {org_id}: {e}");
            return Ok(MetaHttpResponse::internal_error(e));
        }
    };

    let total_alerts = alerts_data.len();
    let alerts_with_dedup: usize = alerts_data
        .iter()
        .filter(|alert| alert.deduplication.as_ref().is_some_and(|d| d.enabled))
        .count();

    // Get current pending batches count from in-memory state (enterprise only)
    #[cfg(feature = "enterprise")]
    let pending_batches = crate::service::alerts::grouping::get_pending_batch_count(&org_id);

    #[cfg(not(feature = "enterprise"))]
    let pending_batches = 0;

    // For suppressions/passed counts, we'll use database for now
    // In future, could query Prometheus metrics for time-series data
    #[cfg(feature = "enterprise")]
    let (suppressions_total, passed_total) = get_dedup_counts_from_db(&org_id)
        .await
        .inspect_err(|e| log::warn!("Failed to get dedup counts from database: {e}"))
        .unwrap_or_default();

    #[cfg(not(feature = "enterprise"))]
    let (suppressions_total, passed_total) = (0, 0);
    let suppression_rate = if suppressions_total + passed_total > 0 {
        suppressions_total as f64 / (suppressions_total + passed_total) as f64
    } else {
        0.0
    };

    let response = DedupSummaryResponse {
        total_alerts,
        alerts_with_dedup,
        suppressions_total,
        passed_total,
        suppression_rate,
        pending_batches,
        timestamp: config::utils::time::now_micros(),
    };

    Ok(HttpResponse::Ok().json(response))
}

/// Get dedup counts from database
/// Returns (suppressions, passed) counts based on occurrence_count
#[cfg(feature = "enterprise")]
async fn get_dedup_counts_from_db(org_id: &str) -> Result<(i64, i64), anyhow::Error> {
    use infra::table::entity::alert_dedup_state;
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    let db = infra::db::ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))?;

    // Get all dedup states for this org
    let states = alert_dedup_state::Entity::find()
        .filter(alert_dedup_state::Column::OrgId.eq(org_id))
        .all(db)
        .await?;

    let passed = states.len() as i64;

    let suppressions = states
        .iter()
        .filter(|state| state.occurrence_count > 1)
        .fold(0, |total, state| total + state.occurrence_count - 1);

    Ok((suppressions, passed))
}
