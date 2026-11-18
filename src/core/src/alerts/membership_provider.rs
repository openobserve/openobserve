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

//! The server's side of the incident membership check: agent credentials, AI quota, service graph,
//! semantic groups.

use config::meta::correlation::FieldAlias;
use o2_enterprise::enterprise::alerts::incident_membership::{
    MembershipProvider, evidence::GraphEdge,
};

use crate::traces::service_graph::v4::read::{
    count, edge_pairs_from, instant, q_edge_failures, q_edge_pairs, scalar_sum,
};

const GRAPH_RANGE_SECS: i64 = 86_400;

/// Registered once at startup with `incident_membership::set_provider`.
pub struct ServerProvider;

#[async_trait::async_trait]
impl MembershipProvider for ServerProvider {
    async fn agent_auth(&self, org_id: &str) -> anyhow::Result<String> {
        let (email, token) = crate::organization::get_sre_agent_credentials(org_id).await?;
        Ok(crate::auth::build_basic_auth_header(&email, &token))
    }

    #[cfg(feature = "cloud")]
    async fn ai_quota(&self, org_id: &str) -> Result<(), String> {
        let usage = crate::trial_quota::AiUsageContext {
            user_email: super::incidents::SYSTEM_USER_EMAIL.to_string(),
            ..Default::default()
        };
        let feature = crate::trial_quota::TrialQuotaFeature::IncidentReAnalysis;
        crate::trial_quota::authorize_ai_usage(org_id, feature, &usage)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(not(feature = "cloud"))]
    async fn ai_quota(&self, _org_id: &str) -> Result<(), String> {
        Ok(())
    }

    async fn graph_edges(&self, org_id: &str, at: i64) -> anyhow::Result<Vec<GraphEdge>> {
        let rows = instant(org_id, &q_edge_pairs(GRAPH_RANGE_SECS), at).await?;
        Ok(edge_pairs_from(&rows)
            .into_iter()
            .map(|[env, stream, client, server]| GraphEdge {
                env,
                stream,
                client,
                server,
            })
            .collect())
    }

    async fn edge_failures(
        &self,
        org_id: &str,
        edge: &GraphEdge,
        since: i64,
        until: i64,
    ) -> anyhow::Result<f64> {
        let range_secs = ((until - since) / 1_000_000).max(60);
        let scope = [
            edge.env.as_str(),
            edge.stream.as_str(),
            edge.client.as_str(),
            edge.server.as_str(),
        ];
        let query = q_edge_failures(scope, range_secs).map_err(anyhow::Error::msg)?;
        let rows = instant(org_id, &query, until).await?;
        Ok(count(scalar_sum(&rows)))
    }

    async fn semantic_groups(&self, org_id: &str) -> Vec<FieldAlias> {
        crate::db::system_settings::get_semantic_field_groups(org_id).await
    }
}
