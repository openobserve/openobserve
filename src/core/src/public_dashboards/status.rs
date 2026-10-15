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

//! The publisher's status call. A link's result files live on the querier its slug hashes to, so
//! the node that took the authenticated request asks that querier over the internal gRPC channel,
//! which only accepts the cluster's internal token.

use std::collections::BTreeMap;

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::{Node, Role, RoleGroup, get_internal_grpc_token},
        public_dashboards::LinkStatusReport,
    },
};
use infra::{
    cluster,
    db::get_orm_client_rw,
    table::{entity::public_dashboards::Model as PublicDashboard, public_dashboards as pd_table},
};
use proto::cluster_rpc::{PublicDashboardStatusRequest, query_cache_client::QueryCacheClient};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue};

/// The org list asks for at most this many links per batch call.
pub const MAX_BATCH: usize = 50;

/// One link's report from this querier's own files.
pub async fn local_report(link: &PublicDashboard, with_sources: bool) -> LinkStatusReport {
    LinkStatusReport {
        link_id: link.id.clone(),
        ranges: super::materialize::range_status(link, with_sources).await,
        access_count: link.access_count,
        last_accessed_at: link.last_accessed_at,
    }
}

/// The internal call's side: reports for the org's live links among `ids`, from this querier.
pub async fn local_reports(
    org: &str,
    ids: &[String],
    with_sources: bool,
) -> Result<Vec<LinkStatusReport>, anyhow::Error> {
    let mut out = Vec::with_capacity(ids.len());
    for link in live_links(org, ids).await? {
        out.push(local_report(&link, with_sources).await);
    }
    Ok(out)
}

/// The org's live links among `ids`, read from the primary, in the order asked.
pub async fn live_links(org: &str, ids: &[String]) -> Result<Vec<PublicDashboard>, anyhow::Error> {
    let db = get_orm_client_rw().await;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(link) = pd_table::get(db, id)
            .await?
            .filter(|l| l.org_id == org && l.deleted_at.is_none())
        {
            out.push(link);
        }
    }
    Ok(out)
}

/// Reports from each link's owning querier, in the order of `links`; best effort, so a link
/// whose owner cannot be reached is left out.
pub async fn reports(links: &[PublicDashboard], with_sources: bool) -> Vec<LinkStatusReport> {
    let mut owners = Vec::with_capacity(links.len());
    for link in links {
        owners.push(owner_of(&link.slug).await);
    }
    let mut by_id: BTreeMap<String, LinkStatusReport> = BTreeMap::new();
    for (owner, group) in by_owner(links, &owners) {
        match owner {
            None => {
                for link in group {
                    by_id.insert(link.id.clone(), local_report(link, with_sources).await);
                }
            }
            Some(name) => {
                let Some(org) = group.first().map(|l| l.org_id.clone()) else {
                    continue;
                };
                let ids: Vec<String> = group.iter().map(|l| l.id.clone()).collect();
                match remote_reports(&name, &org, ids, with_sources).await {
                    Ok(list) => by_id.extend(list.into_iter().map(|r| (r.link_id.clone(), r))),
                    Err(e) => log::warn!(
                        "[public_dashboards] status from querier {name} for {} links failed: {e}",
                        group.len()
                    ),
                }
            }
        }
    }
    links.iter().filter_map(|l| by_id.remove(&l.id)).collect()
}

/// The querier owning a slug on the Interactive ring, as the router routes the public reads;
/// `None` when it is this node, or when no ring exists, as on a single node.
async fn owner_of(slug: &str) -> Option<String> {
    let name =
        cluster::get_node_from_consistent_hash(slug, &Role::Querier, Some(RoleGroup::Interactive))
            .await?;
    (name != LOCAL_NODE.name).then_some(name)
}

/// Links grouped by owner, `None` (this node) first; each group keeps the order of `links`.
fn by_owner<'a>(
    links: &'a [PublicDashboard],
    owners: &[Option<String>],
) -> BTreeMap<Option<String>, Vec<&'a PublicDashboard>> {
    let mut groups: BTreeMap<Option<String>, Vec<&PublicDashboard>> = BTreeMap::new();
    for (link, owner) in links.iter().zip(owners) {
        groups.entry(owner.clone()).or_default().push(link);
    }
    groups
}

async fn remote_reports(
    node_name: &str,
    org: &str,
    link_ids: Vec<String>,
    with_sources: bool,
) -> Result<Vec<LinkStatusReport>, anyhow::Error> {
    let node: Node = cluster::get_cached_node_by_name(node_name)
        .await
        .ok_or_else(|| anyhow::anyhow!("querier {node_name} is not online"))?;
    let token: MetadataValue<_> = get_internal_grpc_token().parse()?;
    let channel = infra::client::grpc::get_cached_channel(&node.grpc_addr).await?;
    let max = get_config().grpc.max_message_size * 1024 * 1024;
    let mut client =
        QueryCacheClient::with_interceptor(channel, move |mut req: tonic::Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        })
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(max)
        .max_encoding_message_size(max);
    let resp = client
        .public_dashboard_status(PublicDashboardStatusRequest {
            org_id: org.to_string(),
            link_ids,
            with_sources,
        })
        .await?
        .into_inner();
    Ok(serde_json::from_str(&resp.reports)?)
}

#[cfg(test)]
mod tests {
    use config::meta::public_dashboards::RangeState;

    use super::*;
    use crate::public_dashboards::replication::tests::link;

    #[test]
    fn gate14_links_are_grouped_by_the_querier_their_slug_hashes_to() {
        let links: Vec<PublicDashboard> = ["a", "b", "c", "d"].into_iter().map(link).collect();
        let owners = vec![
            Some("q2".to_string()),
            None,
            Some("q2".to_string()),
            Some("q1".to_string()),
        ];
        let groups = by_owner(&links, &owners);
        let ids = |owner: Option<&str>| -> Vec<&str> {
            groups[&owner.map(str::to_string)]
                .iter()
                .map(|l| l.id.as_str())
                .collect()
        };
        assert_eq!(groups.keys().next(), Some(&None), "this node answers first");
        assert_eq!(ids(None), ["b"]);
        assert_eq!(ids(Some("q1")), ["d"]);
        assert_eq!(ids(Some("q2")), ["a", "c"]);
    }

    #[tokio::test]
    async fn gate14_without_a_ring_this_node_owns_every_slug() {
        assert_eq!(owner_of("k8Zt2mR7aB3cD4eF5gH6Qx").await, None);
    }

    /// The drawer says "Never viewed" only from `access_count`; a viewed link whose file is gone
    /// reads "Not cached" with its count.
    #[tokio::test]
    async fn gate14_not_cached_and_never_viewed_are_told_apart() {
        let mut never = link("never-viewed-link");
        never.time_ranges = Some(r#"[{"type":"relative","secs":3600}]"#.to_string());
        let mut viewed = never.clone();
        viewed.id = "viewed-evicted-link".to_string();
        viewed.access_count = 340;
        viewed.last_accessed_at = Some(1_760_000_000_000_000);

        let reports = reports(&[never, viewed], false).await;
        assert_eq!(reports.len(), 2);
        for report in &reports {
            assert_eq!(report.ranges.len(), 1);
            assert_eq!(report.ranges[0].key, "r3600");
            assert_eq!(report.ranges[0].state, RangeState::NotCached);
            assert!(report.ranges[0].sources.is_none());
        }
        assert_eq!(
            (reports[0].access_count, reports[0].last_accessed_at),
            (0, None)
        );
        assert_eq!(reports[1].access_count, 340);
        let json = serde_json::to_value(&reports[1]).unwrap();
        assert_eq!(json["link_id"], "viewed-evicted-link");
        assert_eq!(json["ranges"][0]["state"], "not_cached");
    }
}
