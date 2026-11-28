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

use std::collections::{HashMap, hash_map::Entry};

use async_trait::async_trait;
use config::meta::secret_store::ConsumerType;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect};

use crate::{
    errors::Error,
    table::{
        secret_refs,
        synthetics_refs::{self, ParentRef},
    },
};

pub const FRONTIER_CHUNK: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ConsumerRef {
    pub consumer_type: String,
    pub consumer_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsagePath {
    pub ids: Vec<String>,
    pub names: Vec<String>,
}

pub struct Usage {
    pub direct: Vec<ConsumerRef>,
    pub embedded: Vec<UsagePath>,
}

impl Usage {
    pub fn is_empty(&self) -> bool {
        self.direct.is_empty() && self.embedded.is_empty()
    }
}

#[async_trait]
pub trait ParentSource {
    async fn parents_for_many(
        &self,
        org_id: &str,
        child_ids: &[String],
    ) -> Result<HashMap<String, Vec<ParentRef>>, Error>;
}

pub struct DbParents<'a, C>(pub &'a C);

#[async_trait]
impl<C: ConnectionTrait> ParentSource for DbParents<'_, C> {
    async fn parents_for_many(
        &self,
        org_id: &str,
        child_ids: &[String],
    ) -> Result<HashMap<String, Vec<ParentRef>>, Error> {
        Ok(synthetics_refs::list_parents_for_many(self.0, org_id, child_ids).await?)
    }
}

struct ParentHop {
    name: String,
    child_id: String,
}

pub async fn effective_usage<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
) -> Result<Usage, Error> {
    let mut direct: Vec<_> = secret_refs::list_for_secret_in(conn, org_id, secret_id)
        .await?
        .into_iter()
        .map(|row| ConsumerRef {
            consumer_type: row.consumer_type,
            consumer_id: row.consumer_id,
        })
        .collect();
    // The query orders by consumer type and ID, so references from different fields are adjacent.
    direct.dedup();
    let seeds: Vec<_> = direct
        .iter()
        .filter(|consumer| consumer.consumer_type == ConsumerType::SyntheticsCheck.as_str())
        .map(|consumer| consumer.consumer_id.clone())
        .collect();
    let embedded = embedding_paths(&DbParents(conn), org_id, &seeds).await?;
    Ok(Usage { direct, embedded })
}

pub async fn embedding_paths<P: ParentSource + Sync>(
    src: &P,
    org_id: &str,
    seeds: &[String],
) -> Result<Vec<UsagePath>, Error> {
    let mut visited = HashMap::new();
    let mut frontier = Vec::new();
    for seed in seeds {
        if visited.insert(seed.clone(), None).is_none() {
            frontier.push(seed.clone());
        }
    }
    let mut paths = Vec::new();
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for chunk in frontier.chunks(FRONTIER_CHUNK) {
            let mut parents = src.parents_for_many(org_id, chunk).await?;
            for child in chunk {
                for parent in parents.remove(child).into_iter().flatten() {
                    if let Entry::Vacant(entry) = visited.entry(parent.id) {
                        next.push(entry.key().clone());
                        entry.insert(Some(ParentHop {
                            name: parent.name,
                            child_id: child.clone(),
                        }));
                    }
                }
            }
        }
        paths.extend(next.iter().map(|parent| path_to_consumer(parent, &visited)));
        frontier = next;
    }
    Ok(paths)
}

pub async fn is_used<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
) -> Result<bool, Error> {
    Ok(secret_refs::Entity::find()
        .select_only()
        .column(secret_refs::Column::SecretId)
        .filter(secret_refs::Column::OrgId.eq(org_id))
        .filter(secret_refs::Column::SecretId.eq(secret_id))
        .limit(1)
        .into_tuple::<String>()
        .one(conn)
        .await?
        .is_some())
}

fn path_to_consumer<'a>(
    mut id: &'a str,
    visited: &'a HashMap<String, Option<ParentHop>>,
) -> UsagePath {
    let mut ids = Vec::new();
    let mut names = Vec::new();
    while let Some(Some(hop)) = visited.get(id) {
        ids.push(id.to_owned());
        names.push(hop.name.clone());
        id = &hop.child_id;
    }
    ids.push(id.to_owned());
    names.push(String::new());
    UsagePath { ids, names }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use config::meta::folder::FolderType;
    use sea_orm::{ActiveModelTrait, Set, TransactionTrait};

    use super::*;
    use crate::{
        db::get_orm_client_rw,
        table::{
            entity::{folders, synthetics_checks},
            folders::folder_type_into_i16,
            synthetics_checks::tests::make_model,
            testing::{meta_store, unique},
        },
    };

    #[derive(Default)]
    struct Graph {
        parents: HashMap<String, Vec<ParentRef>>,
        calls: AtomicUsize,
    }

    impl Graph {
        fn link(&mut self, parent: &str, child: &str) {
            self.parents
                .entry(child.into())
                .or_default()
                .push(ParentRef {
                    id: parent.into(),
                    name: format!("check {parent}"),
                    folder_id: String::new(),
                });
        }
    }

    #[async_trait]
    impl ParentSource for Graph {
        async fn parents_for_many(
            &self,
            org_id: &str,
            child_ids: &[String],
        ) -> Result<HashMap<String, Vec<ParentRef>>, Error> {
            assert_eq!(org_id, "org");
            assert!(!child_ids.is_empty() && child_ids.len() <= 200);
            assert!(self.calls.fetch_add(1, Ordering::Relaxed) < 60);
            Ok(child_ids
                .iter()
                .filter_map(|id| {
                    self.parents
                        .get(id)
                        .map(|parents| (id.clone(), parents.clone()))
                })
                .collect())
        }
    }

    #[tokio::test]
    async fn cycles_self_links_and_repeated_seeds_visit_each_parent_once() {
        let mut graph = Graph::default();
        for (parent, child) in [("A", "A"), ("B", "A"), ("A", "B"), ("B", "B")] {
            graph.link(parent, child);
        }
        let paths = embedding_paths(&graph, "org", &["A".into(), "A".into()])
            .await
            .unwrap();
        assert_eq!(
            paths,
            [UsagePath {
                ids: vec!["B".into(), "A".into()],
                names: vec!["check B".into(), String::new()],
            }]
        );
        assert_eq!(graph.calls.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn wide_frontiers_are_batched_and_paths_start_at_the_outermost_parent() {
        let mut graph = Graph::default();
        for index in 0..10_000 {
            graph.link(&format!("C{index}"), "X");
        }
        graph.link("P", "C0");
        graph.link("P", "C1");
        let paths = embedding_paths(&graph, "org", &["X".into()]).await.unwrap();
        assert_eq!(paths.len(), 10_001);
        assert_eq!(
            paths
                .iter()
                .map(|p| &p.ids[0])
                .collect::<std::collections::HashSet<_>>()
                .len(),
            10_001
        );
        let outer = paths.iter().find(|p| p.ids[0] == "P").unwrap();
        assert_eq!(outer.ids, ["P", "C0", "X"]);
        assert_eq!(outer.names, ["check P", "check C0", ""]);
        assert_eq!(graph.calls.load(Ordering::Relaxed), 52);
    }

    #[tokio::test]
    async fn usage_deduplicates_fields_and_scopes_the_delete_guard() {
        if !meta_store().await {
            return;
        }
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let org = unique("usage");
        let secret = config::ider::ksuid();
        let folder = config::ider::ksuid();
        folders::ActiveModel {
            id: Set(folder.clone()),
            org: Set(org.clone()),
            folder_id: Set(folder.clone()),
            name: Set("Checks".into()),
            r#type: Set(folder_type_into_i16(FolderType::Synthetics)),
            ..Default::default()
        }
        .insert(&txn)
        .await
        .unwrap();

        let parent = config::ider::ksuid();
        let child = config::ider::ksuid();
        let check = synthetics_checks::Model {
            id: parent.clone(),
            org_id: org.clone(),
            folder_id: folder,
            name: "Parent".into(),
            ..make_model()
        };
        let row: synthetics_checks::ActiveModel = check.into();
        row.reset_all().insert(&txn).await.unwrap();
        synthetics_refs::replace_for_parent(&txn, &org, &parent, std::slice::from_ref(&child))
            .await
            .unwrap();
        for field in ["first", "second"] {
            secret_refs::ActiveModel {
                id: Set(config::ider::ksuid()),
                org_id: Set(org.clone()),
                consumer_type: Set(ConsumerType::SyntheticsCheck.as_str().into()),
                consumer_id: Set(child.clone()),
                field: Set(field.into()),
                secret_id: Set(secret.clone()),
                token_name: Set("TOKEN".into()),
                created_at: Set(1),
            }
            .insert(&txn)
            .await
            .unwrap();
        }

        let usage = effective_usage(&txn, &org, &secret).await.unwrap();
        assert!(!usage.is_empty());
        assert_eq!(
            usage.direct,
            [ConsumerRef {
                consumer_type: ConsumerType::SyntheticsCheck.as_str().into(),
                consumer_id: child.clone(),
            }]
        );
        assert_eq!(
            usage.embedded,
            [UsagePath {
                ids: vec![parent, child],
                names: vec!["Parent".into(), String::new()],
            }]
        );
        assert!(is_used(&txn, &org, &secret).await.unwrap());
        assert!(!is_used(&txn, &org, &config::ider::ksuid()).await.unwrap());
        assert!(!is_used(&txn, "another_org", &secret).await.unwrap());
        assert!(
            effective_usage(&txn, "another_org", &secret)
                .await
                .unwrap()
                .is_empty()
        );
        txn.rollback().await.unwrap();
    }
}
