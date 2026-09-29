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

use std::{collections::HashSet, sync::Arc};

use config::meta::{inverted_index::IndexOptimizeMode, stream::FileKey};

use super::{TantivyMultiResult, tantivy_search};
use crate::{index::IndexCondition, types::QueryParams};

pub struct PreparedAggregate {
    pub files: Vec<FileKey>,
    pub result: Option<TantivyMultiResult>,
    pub fallback_files: Vec<FileKey>,
    pub took: usize,
}

pub async fn prepare_aggregate(
    query: Arc<QueryParams>,
    files: Vec<FileKey>,
    condition: Option<IndexCondition>,
    mode: IndexOptimizeMode,
) -> PreparedAggregate {
    let start = std::time::Instant::now();
    let mut fallback_files = files.clone();
    match tantivy_search(query.clone(), &mut fallback_files, condition, Some(mode)).await {
        Ok((took, _, result)) => {
            let fallback_keys: HashSet<_> = fallback_files
                .iter()
                .map(|file| file.key.as_str())
                .collect();
            let files: Vec<_> = files
                .into_iter()
                .filter(|file| !fallback_keys.contains(file.key.as_str()))
                .collect();
            let result = (!files.is_empty()).then_some(result);
            log::info!(
                "[trace_id {}] search->tantivy: aggregate index answered {} files, {} files fall back to parquet, took: {took} ms",
                query.trace_id,
                files.len(),
                fallback_files.len(),
            );
            PreparedAggregate {
                files,
                result,
                fallback_files,
                took,
            }
        }
        Err(error) => {
            log::warn!(
                "[trace_id {}] search->tantivy: aggregate index search failed, scanning original files: {error}",
                query.trace_id
            );
            PreparedAggregate {
                files: vec![],
                result: None,
                fallback_files: files,
                took: start.elapsed().as_millis() as usize,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use config::{
        TIMESTAMP_COL_NAME,
        meta::stream::{FileMeta, StreamType},
        utils::inverted_index::to_tantivy_name,
    };
    use datafusion::common::TableReference;
    use object_store::{ObjectStoreExt, memory::InMemory};
    use tantivy::{
        doc,
        schema::{FAST, INDEXED, STRING},
    };
    use tantivy_utils::puffin_directory::writer::PuffinDirWriter;

    use super::*;
    use crate::index::Condition;

    async fn fixture() -> (Arc<QueryParams>, Vec<FileKey>) {
        let org = format!("aggregate_fallback_{}", rand::random::<u64>());
        let account = format!("{org}:default");
        let store = InMemory::new();
        let mut files = Vec::new();
        for (name, services) in [
            ("old", None),
            ("new", Some(vec!["svc-a", "svc-b", "svc-a"])),
            ("zero", Some(vec!["svc-z", "svc-z"])),
        ] {
            let mut schema = tantivy::schema::Schema::builder();
            let ts = schema.add_i64_field(TIMESTAMP_COL_NAME, FAST | INDEXED);
            let pod = schema.add_text_field("k8s_pod", STRING | FAST);
            let service = services
                .as_ref()
                .map(|_| schema.add_text_field("service_name", STRING | FAST));
            let dir = PuffinDirWriter::new();
            let mut writer = tantivy::IndexBuilder::new()
                .schema(schema.build())
                .single_segment_index_writer(dir.clone(), 50_000_000)
                .unwrap();
            let rows = services.as_ref().map_or(2, Vec::len);
            for i in 0..rows {
                let mut document = doc!(ts => 1000i64 + i as i64 * 1000, pod => "pod");
                if let Some(field) = service {
                    document.add_text(field, services.as_ref().unwrap()[i]);
                }
                writer.add_document(document).unwrap();
            }
            writer.finalize().unwrap();
            let bytes = bytes::Bytes::from(dir.to_puffin_bytes().unwrap());
            let key = format!("files/{org}/logs/app_logs/2026/09/24/00/{name}.parquet");
            let index_size = bytes.len() as i64;
            store
                .put(&to_tantivy_name(&key).unwrap().into(), bytes.into())
                .await
                .unwrap();
            files.push(FileKey {
                key,
                account: account.clone(),
                meta: FileMeta {
                    min_ts: 1000,
                    max_ts: rows as i64 * 1000,
                    records: rows as i64,
                    index_size,
                    ..Default::default()
                },
                ..Default::default()
            });
        }
        infra::storage::add_account(&org, Box::new(store)).await;
        let query = Arc::new(QueryParams {
            trace_id: org.clone(),
            org_id: org,
            stream: TableReference::from("app_logs"),
            stream_type: StreamType::Logs,
            stream_name: "app_logs".into(),
            time_range: (0, 10_000),
            work_group: None,
            use_inverted_index: true,
        });
        (query, files)
    }

    fn condition() -> IndexCondition {
        let mut condition = IndexCondition::new();
        condition.add_condition(Condition::Equal("service_name".into(), "svc-a".into()));
        condition
    }

    #[tokio::test]
    async fn aggregate_fallback_missing_field_and_exact_zero() {
        let (query, files) = fixture().await;
        let prepared = prepare_aggregate(
            query.clone(),
            files.clone(),
            Some(condition()),
            IndexOptimizeMode::SimpleCount,
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert_eq!(prepared.fallback_files[0].key, files[0].key);
        assert_eq!(prepared.files.len(), 2);
        assert!(matches!(
            prepared.result,
            Some(TantivyMultiResult::Count(2))
        ));
        let zero = prepare_aggregate(
            query.clone(),
            vec![files[2].clone()],
            Some(condition()),
            IndexOptimizeMode::SimpleCount,
        )
        .await;
        assert!(zero.fallback_files.is_empty());
        assert!(matches!(zero.result, Some(TantivyMultiResult::Count(0))));
        let old = prepare_aggregate(
            query,
            vec![files[0].clone()],
            Some(condition()),
            IndexOptimizeMode::SimpleCount,
        )
        .await;
        assert!(old.result.is_none());
        assert_eq!(old.fallback_files.len(), 1);
    }

    #[tokio::test]
    async fn aggregate_fallback_skipped_and_and_missing_or() {
        let (query, files) = fixture().await;
        let mut and = condition();
        and.add_condition(Condition::Equal("k8s_pod".into(), "pod".into()));
        let prepared = prepare_aggregate(
            query.clone(),
            files.clone(),
            Some(and),
            IndexOptimizeMode::SimpleCount,
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(matches!(
            prepared.result,
            Some(TantivyMultiResult::Count(2))
        ));
        let mut or = IndexCondition::new();
        or.add_condition(Condition::Or(vec![
            Condition::Equal("service_name".into(), "svc-a".into()),
            Condition::Equal("k8s_pod".into(), "pod".into()),
        ]));
        let prepared =
            prepare_aggregate(query, files, Some(or), IndexOptimizeMode::SimpleCount).await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(matches!(
            prepared.result,
            Some(TantivyMultiResult::Count(5))
        ));
    }

    #[tokio::test]
    async fn aggregate_fallback_histograms_keep_all_buckets() {
        let (query, files) = fixture().await;
        let prepared = prepare_aggregate(
            query.clone(),
            files.clone(),
            Some(condition()),
            IndexOptimizeMode::SimpleHistogram(0, 1000, 5, 0),
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(
            matches!(prepared.result, Some(TantivyMultiResult::Histogram(ref counts)) if counts.iter().sum::<u64>() == 2 && counts.iter().filter(|n| **n > 0).count() == 2)
        );
        let prepared = prepare_aggregate(
            query,
            files,
            Some(condition()),
            IndexOptimizeMode::SimpleMultiHistogram(0, 5000, 1000, 0, "k8s_pod".into()),
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(
            matches!(prepared.result, Some(TantivyMultiResult::MultiHistogram(ref buckets)) if buckets.iter().map(|(_, _, n)| n).sum::<u64>() == 2)
        );
    }

    #[tokio::test]
    async fn aggregate_fallback_topn_and_distinct_merge_partially() {
        let (query, files) = fixture().await;
        let prepared = prepare_aggregate(
            query.clone(),
            files.clone(),
            Some(condition()),
            IndexOptimizeMode::SimpleTopN(vec!["k8s_pod".into()], 1, false),
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert_eq!(prepared.fallback_files[0].key, files[0].key);
        assert_eq!(prepared.files.len(), 2);
        assert!(
            matches!(prepared.result, Some(TantivyMultiResult::TopN(ref top)) if top.iter().map(|(_, n)| n).sum::<u64>() == 2)
        );

        let mut filter = IndexCondition::new();
        filter.add_condition(Condition::StrMatch(
            "service_name".into(),
            "svc-a".into(),
            true,
        ));
        let prepared = prepare_aggregate(
            query,
            files.clone(),
            Some(filter),
            IndexOptimizeMode::SimpleDistinct("service_name".into(), 1, true),
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert_eq!(prepared.fallback_files[0].key, files[0].key);
        assert_eq!(prepared.files.len(), 2);
        assert!(
            matches!(prepared.result, Some(TantivyMultiResult::Distinct(ref values)) if values.len() == 1 && values.contains("svc-a"))
        );
    }

    #[tokio::test]
    async fn aggregate_fallback_unavailable_index_and_missing_group_field() {
        let (query, mut files) = fixture().await;
        files[0].key = files[0].key.replace("old.parquet", "missing.parquet");
        let prepared = prepare_aggregate(
            query.clone(),
            files.clone(),
            Some(condition()),
            IndexOptimizeMode::SimpleCount,
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(matches!(
            prepared.result,
            Some(TantivyMultiResult::Count(2))
        ));
        let (query2, files2) = fixture().await;
        let mut pod_condition = IndexCondition::new();
        pod_condition.add_condition(Condition::Equal("k8s_pod".into(), "pod".into()));
        let prepared = prepare_aggregate(
            query2,
            files2,
            Some(pod_condition),
            IndexOptimizeMode::SimpleMultiHistogram(0, 5000, 1000, 0, "service_name".into()),
        )
        .await;
        assert_eq!(prepared.fallback_files.len(), 1);
        assert!(
            matches!(prepared.result, Some(TantivyMultiResult::MultiHistogram(ref buckets)) if buckets.iter().map(|(_, _, n)| n).sum::<u64>() == 5)
        );
    }
}
