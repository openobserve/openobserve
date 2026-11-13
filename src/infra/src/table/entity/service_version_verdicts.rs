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

#[derive(
    Clone, Debug, Default, PartialEq, DeriveEntityModel, serde::Serialize, serde::Deserialize,
)]
#[sea_orm(table_name = "service_version_verdicts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub verdict_key: String,
    pub deploy_key: String,
    pub deploy_kind: String,
    pub rollback_outcome: Option<String>,
    pub scope_key: String,
    pub version_key: String,
    pub org_id: String,
    pub service_name: String,
    pub where_key: String,
    pub version: String,
    pub image: Option<String>,
    pub cluster: String,
    pub verdict: String,
    pub state: String,
    pub reason: Option<String>,
    pub signal: String,
    pub baseline_version: Option<String>,
    pub baseline_image: Option<String>,
    pub baseline_rule: String,
    pub baseline_where_key: Option<String>,
    pub baseline_env: Option<String>,
    pub source_streams: String,
    pub source_streams_overflow: bool,
    pub eval_priority: i32,
    pub baseline_traffic_share: Option<f64>,
    pub eval_start: i64,
    pub window_end: i64,
    pub baseline_start: Option<i64>,
    pub baseline_end: Option<i64>,
    pub checks_done: i32,
    pub consecutive_regressed: i32,
    pub traces_consecutive_regressed: i32,
    pub rum_consecutive_regressed: i32,
    pub n_new: i64,
    pub n_base: i64,
    pub headline_metric: Option<String>,
    pub headline_new: Option<f64>,
    pub headline_base: Option<f64>,
    pub headline_lo: Option<f64>,
    pub headline_hi: Option<f64>,
    pub headline_ci_kind: Option<String>,
    pub second_metric: Option<String>,
    pub second_new: Option<f64>,
    pub second_base: Option<f64>,
    pub new_error_types: i32,
    pub new_error_sample: Option<String>,
    pub recheck_verdict: Option<String>,
    pub rechecked_at: Option<i64>,
    pub algo_version: i32,
    pub first_evaluated_at: i64,
    pub last_evaluated_at: i64,
    pub frozen_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub baseline_rule_initial: String,
    pub baseline_switched_at: Option<i64>,
    pub baseline_switch_reason: Option<String>,
    pub baseline_version_initial: Option<String>,
    pub baseline_image_initial: Option<String>,
    pub reason_code: String,
    pub needs_metric: Option<String>,
    pub needs_have: Option<i64>,
    pub needs_need: Option<i64>,
    pub baseline_cluster: Option<String>,
    pub baseline_fanout_complete: bool,
    pub ns_consecutive_drop: i32,
    pub ns_not_serving_since: Option<i64>,
    pub ns_first_requests_at: Option<i64>,
}

impl Model {
    pub fn identity(&self) -> config::meta::service_identity::VersionImage {
        config::meta::service_identity::VersionImage {
            version: self.version.clone(),
            image: self.image.clone(),
        }
    }

    pub fn baseline_identity(&self) -> Option<config::meta::service_identity::VersionImage> {
        self.baseline_version
            .as_ref()
            .map(|version| config::meta::service_identity::VersionImage {
                version: version.clone(),
                image: self.baseline_image.clone(),
            })
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
