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

#[cfg(feature = "enterprise")]
pub mod ai;
#[cfg(feature = "enterprise")]
pub mod alert_calibration;
pub mod alerts;
#[cfg(feature = "enterprise")]
pub mod annotation_queues;
#[cfg(feature = "enterprise")]
pub mod annotations;
pub mod announcements;
#[cfg(feature = "enterprise")]
pub mod anomaly_detection;
pub mod authz;
#[cfg(feature = "cloud")]
pub mod cloud;
pub mod dashboards;
#[cfg(feature = "enterprise")]
pub mod datasets;
pub mod db_monitoring;
#[cfg(feature = "enterprise")]
pub mod discovery;
#[cfg(feature = "enterprise")]
pub mod domain_management;
pub mod downtimes;
#[cfg(feature = "enterprise")]
pub mod eval_jobs;
#[cfg(feature = "enterprise")]
pub mod experiments;
#[allow(deprecated)]
pub mod folders;
pub mod gen_ai;
pub mod ingest_rejections;
pub mod keys;
pub mod kv;
#[cfg(feature = "enterprise")]
pub mod license;
pub mod metrics_usage;
pub mod model_pricing;
pub mod oncall;
pub mod organization;
#[cfg(feature = "enterprise")]
pub mod password_policy;
#[cfg(feature = "enterprise")]
pub mod playground;
#[cfg(feature = "profiling")]
pub mod profiling;
#[cfg(feature = "enterprise")]
pub mod prompts;
#[cfg(feature = "enterprise")]
pub mod providers;
pub mod public_rate_limit;
pub mod query_history;
#[cfg(feature = "enterprise")]
pub mod remote_tasks;
pub mod rum_analytics;
#[cfg(feature = "enterprise")]
pub mod score_configs;
#[cfg(feature = "enterprise")]
pub mod scorers;
pub mod service_accounts;
pub mod service_streams;
pub mod short_url;
pub mod slos;
pub mod sourcemaps;
pub mod status;
pub mod status_pages;
pub mod stream;
pub mod synthetics;
pub mod users;
#[cfg(feature = "enterprise")]
pub mod workflows;

use openobserve_api_common::request::{BulkDeleteRequest, BulkDeleteResponse};

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
    };

    use serde_json::Value;

    const MCP_FORBIDDEN_OPERATIONS: &[&str] = &[
        "SetPaidOverageStatus",
        "UserSave",
        "UserUpdate",
        "AddUserToOrg",
        "RemoveUserFromOrg",
        "ServiceAccountSave",
        "ServiceAccountUpdate",
        "RemoveServiceAccount",
        "CreateRoles",
        "UpdateRoles",
        "DeleteRole",
        "CreateGroup",
        "UpdateGroup",
        "DeleteGroup",
        "UpdateStreamSettings",
        "AssumeServiceAccount",
        "OrganizationSettingCreate",
        "SetPasswordPolicy",
        "StreamDelete",
    ];

    const MCP_EXTENSION_START: &str = "\"x-o2-mcp\" = json!(";

    fn rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                rust_sources(&path, out);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(path);
            }
        }
    }

    fn utoipa_paths(source: &str) -> Vec<(&str, &str)> {
        source
            .split("#[utoipa::path(")
            .skip(1)
            .filter_map(|rest| {
                let block = &rest[..rest.find("\n)]").unwrap_or(rest.len())];
                let id_start = block.find("operation_id = \"")? + "operation_id = \"".len();
                let id_len = block[id_start..].find('"')?;
                Some((&block[id_start..id_start + id_len], block))
            })
            .collect()
    }

    fn mcp_extension(annotation: &str) -> Option<Value> {
        let start = annotation.find(MCP_EXTENSION_START)? + MCP_EXTENSION_START.len();
        let body = &annotation[start..];
        let mut depth = 0usize;
        let end = body.char_indices().find_map(|(i, c)| {
            match c {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
            (depth == 0 && c == '}').then_some(i + 1)
        })?;
        serde_json::from_str(&body[..end]).ok()
    }

    // reads the sources so enterprise and cloud variants are checked by a default-feature build
    #[test]
    fn mcp_forbidden_operations_opt_out_in_every_cfg_variant() {
        let mut files = Vec::new();
        rust_sources(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut files,
        );
        let mut seen: HashMap<&str, usize> = HashMap::new();
        let mut exposed = Vec::new();
        for file in &files {
            let source = std::fs::read_to_string(file).unwrap();
            for (op, annotation) in utoipa_paths(&source) {
                let Some(op) = MCP_FORBIDDEN_OPERATIONS.iter().find(|f| **f == op) else {
                    continue;
                };
                *seen.entry(op).or_default() += 1;
                let ext = mcp_extension(annotation);
                if ext.as_ref().and_then(|e| e["enabled"].as_bool()) != Some(false) {
                    exposed.push(format!("{}: {op} has x-o2-mcp {ext:?}", file.display()));
                }
            }
        }
        for op in MCP_FORBIDDEN_OPERATIONS {
            assert!(seen.contains_key(op), "no #[utoipa::path] declares {op}");
        }
        assert!(exposed.is_empty(), "{exposed:#?}");
    }
}
