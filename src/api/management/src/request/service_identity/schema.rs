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

//! Response shapes of the service identity routes, for OpenAPI; times are Unix microseconds.

use config::meta::service_identity::Override;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;

/// `GET /service_identity/envs`.
#[derive(Serialize, ToSchema)]
pub struct EnvList {
    /// Environment options with their service, scope and source counts.
    #[schema(value_type = Vec<Object>)]
    pub envs: Vec<Value>,
    /// The caller may edit overrides.
    pub can_edit: bool,
    /// Per-service counts in the `where` scope; present only with `where`.
    #[schema(value_type = Option<Object>)]
    pub scope_counts: Option<Value>,
    #[schema(value_type = Option<Object>)]
    pub scope_versions: Option<Value>,
}

/// `GET /service_identity/unresolved`.
#[derive(Serialize, ToSchema)]
pub struct UnresolvedServices {
    pub no_version: Vec<UnversionedScope>,
    pub placeholder_names: Vec<PlaceholderName>,
}

/// A scope that reports no version.
#[derive(Serialize, ToSchema)]
pub struct UnversionedScope {
    pub service: String,
    pub where_key: String,
    pub env: Option<String>,
    pub signals: Vec<String>,
}

/// A service without a real name: empty, `default` or the SDK's `unknown_service`.
#[derive(Serialize, ToSchema)]
pub struct PlaceholderName {
    pub service: String,
    pub last_seen: i64,
}

/// `GET /service_identity/overrides`.
#[derive(Serialize, ToSchema)]
pub struct OverrideList {
    pub overrides: Vec<ListedOverride>,
    /// Matching overrides before `limit` and `offset`.
    pub total: usize,
}

#[derive(Serialize, ToSchema)]
pub struct ListedOverride {
    #[serde(flatten)]
    pub rule: Override,
    pub affected: Affected,
}

/// Services and versions an override relabels.
#[derive(Serialize, ToSchema)]
pub struct Affected {
    pub services: usize,
    pub versions: u64,
}

/// `PUT /service_identity/overrides`.
#[derive(Serialize, ToSchema)]
pub struct OverrideSaved {
    /// The saved override; null when the value equals the inferred env, which removes it.
    #[serde(rename = "override")]
    pub saved: Option<Override>,
    pub previous: Option<Override>,
    pub removed: bool,
    pub affected: Affected,
}

/// `DELETE /service_identity/overrides/{rule_key}`.
#[derive(Serialize, ToSchema)]
pub struct OverrideRemoved {
    pub removed: Override,
}

/// `GET /service_identity/aliases`.
#[derive(Serialize, ToSchema)]
pub struct AliasList {
    pub aliases: Vec<ServiceAlias>,
    /// Matching aliases before `limit` and `offset`.
    pub total: usize,
}

/// A service name alias; a conflicted alias reads as `proposed`.
#[derive(Serialize, ToSchema)]
pub struct ServiceAlias {
    pub alias_key: String,
    pub org_id: String,
    pub kind: String,
    pub scope: String,
    pub alias: String,
    pub canonical: String,
    /// `proposed`, `active` or `rejected`.
    pub status: String,
    pub origin: String,
    /// Why the alias was proposed.
    #[schema(value_type = Option<Object>)]
    pub evidence: Option<Value>,
    /// `high`, `medium` or `low`.
    pub confidence: String,
    pub accepted_by: Option<String>,
    pub accepted_at: Option<i64>,
    pub batch_id: Option<String>,
    pub prev_status: Option<String>,
    pub first_seen: Option<i64>,
    pub last_seen: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub writer_cluster: String,
}

/// `POST /service_identity/aliases/_bulk`.
#[derive(Serialize, ToSchema)]
pub struct AliasBulkResult {
    pub changed: usize,
    /// Pass it to `_undo` to restore the rows.
    pub batch_id: String,
    pub skipped_collisions: usize,
    /// Display-name collisions that kept rows from being accepted.
    #[schema(value_type = Vec<Object>)]
    pub collisions: Vec<Value>,
    pub env_separation: bool,
    /// The filter matched more rows than one request changes.
    pub truncated: bool,
}

/// `POST /service_identity/aliases/_undo`.
#[derive(Serialize, ToSchema)]
pub struct AliasesRestored {
    pub restored: usize,
}
