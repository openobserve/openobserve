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

use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema};
use common::infra::wal;
use config::{
    datafusion::request::FlightSearchRequest,
    get_config,
    meta::stream::{FileMeta, StreamType},
};
use datafusion::{common::TableReference, physical_plan::ExecutionPlan, prelude::SessionContext};
use hashbrown::HashSet;

use super::search;
use crate::{datafusion::distributed_plan::codec::get_physical_extension_codec, grpc::QueryParams};

struct LocalInventoryFixture {
    query: QueryParams,
    schema: Arc<Schema>,
    files: Vec<String>,
    sources: Vec<String>,
    expected_timestamps: Vec<i64>,
}

impl LocalInventoryFixture {
    async fn new() -> Self {
        let cfg = get_config();
        assert!(cfg.common.local_mode && config::is_local_disk_storage());
        assert!(!cfg.compact.file_list_dump_enabled);
        for dir in [
            &cfg.common.data_db_dir,
            &cfg.common.data_wal_dir,
            &cfg.common.data_stream_dir,
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        infra::db::create_table().await.unwrap();
        infra::file_list::create_table().await.unwrap();
        infra::file_list::create_table_index().await.unwrap();
        let org_id = format!(
            "wal_inventory_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let stream_name = "visibility".to_string();
        let schema = Arc::new(Schema::new(vec![Field::new(
            "_timestamp",
            DataType::Int64,
            false,
        )]));
        infra::db::get_db()
            .await
            .put(
                &infra::schema::mk_key(&org_id, StreamType::Logs, &stream_name),
                serde_json::to_vec(schema.as_ref()).unwrap().into(),
                false,
                None,
            )
            .await
            .unwrap();
        Self {
            query: QueryParams {
                trace_id: org_id.clone(),
                org_id,
                stream: TableReference::bare(stream_name.clone()),
                stream_type: StreamType::Logs,
                stream_name,
                time_range: (1_791_932_400_000_000, 1_791_932_401_000_000),
                work_group: None,
                use_inverted_index: false,
            },
            schema,
            files: Vec::new(),
            sources: Vec::new(),
            expected_timestamps: Vec::new(),
        }
    }

    async fn write_source(&mut self) -> WalSource {
        use datafusion::arrow::{array::Int64Array, record_batch::RecordBatch};
        use parquet::arrow::ArrowWriter;

        let min_ts = self.query.time_range.0 + 100 + self.sources.len() as i64 * 100;
        let timestamps = vec![min_ts, min_ts + 1];
        let batch = RecordBatch::try_new(
            self.schema.clone(),
            vec![Arc::new(Int64Array::from(timestamps.clone()))],
        )
        .unwrap();
        let mut buf = Vec::new();
        let mut writer = ArrowWriter::try_new(&mut buf, self.schema.clone(), None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
        let file = format!(
            "files/{}/logs/{}/2026/10/13/23/default/{}.parquet",
            self.query.org_id,
            self.query.stream_name,
            self.files.len()
        );
        let source = format!(
            "files/{}/logs/{}/0/2026/10/13/23/default/{min_ts}.{}.0.parquet",
            self.query.org_id,
            self.query.stream_name,
            min_ts + 1
        );
        let source_path = std::path::Path::new(&get_config().common.data_wal_dir).join(&source);
        std::fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        std::fs::write(&source_path, &buf).unwrap();
        let meta = FileMeta {
            min_ts,
            max_ts: min_ts + 1,
            records: 2,
            original_size: 16,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };
        ingester::WAL_PARQUET_METADATA
            .write()
            .await
            .insert(source.clone(), meta.clone());
        let (_, before, _) = super::super::wal::search_parquet(
            self.query_params(),
            self.schema.clone(),
            &[],
            crate::datafusion::sort_order::FileSortOrder::None,
            None,
            None,
            vec![],
            HashSet::new(),
        )
        .await
        .unwrap();
        wal::release_request(&self.query.trace_id);
        crate::datafusion::storage::file_list::clear(&self.query.trace_id);
        assert_eq!(
            before.records, 2,
            "The WAL source must be readable before publication"
        );
        self.sources.push(source.clone());
        WalSource {
            key: source,
            stored_key: file,
            data: buf,
            meta,
            timestamps,
        }
    }

    async fn publish_source(&mut self, source: &WalSource) {
        infra::storage::put("", &source.stored_key, source.data.clone().into())
            .await
            .unwrap();
        db::file_list::set("", &source.stored_key, Some(source.meta.clone()), false)
            .await
            .unwrap();
        self.files.push(source.stored_key.clone());
        self.expected_timestamps.extend(&source.timestamps);
    }

    async fn retire_source(&self, source: &WalSource) {
        std::fs::remove_file(
            std::path::Path::new(&get_config().common.data_wal_dir).join(&source.key),
        )
        .unwrap();
        ingester::WAL_PARQUET_METADATA
            .write()
            .await
            .remove(&source.key);
    }

    async fn publish_and_retire_source(&mut self) {
        let source = self.write_source().await;
        self.publish_source(&source).await;
        self.retire_source(&source).await;
    }

    fn query_params(&self) -> Arc<QueryParams> {
        Arc::new(QueryParams {
            trace_id: self.query.trace_id.clone(),
            org_id: self.query.org_id.clone(),
            stream: self.query.stream.clone(),
            stream_type: self.query.stream_type,
            stream_name: self.query.stream_name.clone(),
            time_range: self.query.time_range,
            work_group: None,
            use_inverted_index: false,
        })
    }

    fn request(&self, leader_ids: Vec<i64>) -> FlightSearchRequest {
        use datafusion_proto::bytes::physical_plan_to_bytes_with_extension_codec;
        use proto::cluster_rpc::{IndexInfo, QueryIdentifier, SearchInfo, SuperClusterInfo};

        let plan: Arc<dyn ExecutionPlan> = Arc::new(
            crate::datafusion::distributed_plan::empty_exec::NewEmptyExec::new(
                &self.query.stream.to_quoted_string(),
                self.schema.clone(),
                None,
                &[],
                None,
                crate::datafusion::sort_order::FileSortOrder::None,
                self.schema.clone(),
            ),
        );
        FlightSearchRequest {
            query_identifier: QueryIdentifier {
                org_id: self.query.org_id.clone(),
                stream_type: "logs".to_string(),
                ..Default::default()
            },
            search_info: SearchInfo {
                plan: physical_plan_to_bytes_with_extension_codec(
                    plan,
                    &get_physical_extension_codec(),
                )
                .unwrap()
                .to_vec(),
                file_id_list: leader_ids,
                start_time: self.query.time_range.0,
                end_time: self.query.time_range.1,
                ..Default::default()
            },
            index_info: IndexInfo::default(),
            super_cluster_info: SuperClusterInfo::default(),
        }
    }

    async fn cleanup(&self) {
        for key in &self.sources {
            let path = std::path::Path::new(&get_config().common.data_wal_dir).join(key);
            if path.exists() {
                std::fs::remove_file(path).unwrap();
            }
            ingester::WAL_PARQUET_METADATA.write().await.remove(key);
            infra::file_list::pending_delete::unregister(key).await;
        }
        wal::release_request(&self.query.trace_id);
        crate::datafusion::storage::file_list::clear(&self.query.trace_id);
        for file in &self.files {
            infra::file_list::remove(file).await.unwrap();
        }
        infra::storage::del(self.files.iter().map(|file| ("", file.as_str())).collect())
            .await
            .unwrap();
    }
}

struct WalSource {
    key: String,
    stored_key: String,
    data: Vec<u8>,
    meta: FileMeta,
    timestamps: Vec<i64>,
}

async fn collect_timestamps(ctx: SessionContext, plan: Arc<dyn ExecutionPlan>) -> Vec<i64> {
    use datafusion::arrow::array::Int64Array;

    let batches = datafusion::physical_plan::collect(plan, ctx.task_ctx())
        .await
        .unwrap();
    let mut timestamps = batches
        .iter()
        .flat_map(|batch| {
            batch
                .column(0)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap()
                .values()
                .to_vec()
        })
        .collect::<Vec<_>>();
    timestamps.sort_unstable();
    timestamps
}

async fn assert_refreshes_empty_and_stale_leader_ids() {
    let mut fixture = LocalInventoryFixture::new().await;
    let mut leader_ids = Vec::new();
    for expected_files in 1..=2 {
        fixture.publish_and_retire_source().await;
        let req = fixture.request(leader_ids);
        let result = search(&fixture.query.trace_id, &req).await;
        let (ctx, plan, stats) = result.unwrap();
        let timestamps = collect_timestamps(ctx, plan).await;
        wal::release_request(&fixture.query.trace_id);
        leader_ids = crate::file_list::query_ids(
            &fixture.query.trace_id,
            &fixture.query.org_id,
            fixture.query.stream_type,
            &fixture.query.stream_name,
            fixture.query.time_range,
        )
        .await
        .unwrap()
        .into_iter()
        .map(|file| file.id)
        .collect();
        assert_eq!(timestamps, fixture.expected_timestamps);
        assert_eq!(stats.files, expected_files);
    }
    fixture.cleanup().await;
}

async fn assert_waits_for_publication_and_releases_before_execution() {
    use tokio::time::{Duration, timeout};

    let mut fixture = LocalInventoryFixture::new().await;
    fixture.publish_and_retire_source().await;
    let (ctx, plan, _) = search(&fixture.query.trace_id, &fixture.request(Vec::new()))
        .await
        .unwrap();
    assert_eq!(
        collect_timestamps(ctx, plan).await,
        fixture.expected_timestamps
    );
    let lock = wal::stream_inventory_lock(
        &fixture.query.org_id,
        StreamType::Logs,
        &fixture.query.stream_name,
    )
    .await;
    let publication = lock.clone().write_owned().await;
    let req = fixture.request(Vec::new());
    let trace_id = fixture.query.trace_id.clone();
    let mut query = tokio::spawn(async move { search(&trace_id, &req).await });
    assert!(
        timeout(Duration::from_millis(500), &mut query)
            .await
            .is_err(),
        "The search must wait for an in-progress publication"
    );
    drop(publication);
    let (ctx, plan, _) = timeout(Duration::from_secs(5), query)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let publication = timeout(Duration::from_secs(1), lock.write_owned())
        .await
        .expect("Physical execution must not keep the inventory lock");
    assert_eq!(
        collect_timestamps(ctx, plan).await,
        fixture.expected_timestamps
    );
    drop(publication);
    fixture.cleanup().await;
}

async fn assert_pins_wal_and_excludes_published_sources() {
    use tokio::time::{Duration, timeout};

    let mut fixture = LocalInventoryFixture::new().await;
    infra::file_list::LOCAL_CACHE.create_table().await.unwrap();
    let source = fixture.write_source().await;
    let (ctx, plan, _) = search(&fixture.query.trace_id, &fixture.request(Vec::new()))
        .await
        .unwrap();
    assert!(wal::lock_files_exists(&source.key));
    let publication = timeout(
        Duration::from_secs(1),
        wal::stream_inventory_lock(
            &fixture.query.org_id,
            StreamType::Logs,
            &fixture.query.stream_name,
        )
        .await
        .write_owned(),
    )
    .await
    .unwrap();
    fixture.publish_source(&source).await;
    db::file_list::local::add_pending_delete(&fixture.query.org_id, "", &source.key)
        .await
        .unwrap();
    assert_eq!(collect_timestamps(ctx, plan).await, source.timestamps);
    wal::release_request(&fixture.query.trace_id);
    crate::datafusion::storage::file_list::clear(&fixture.query.trace_id);
    drop(publication);
    let (ctx, plan, _) = search(&fixture.query.trace_id, &fixture.request(Vec::new()))
        .await
        .unwrap();
    assert_eq!(collect_timestamps(ctx, plan).await, source.timestamps);
    db::file_list::local::remove_pending_delete(&source.key)
        .await
        .unwrap();
    fixture.cleanup().await;
}

#[tokio::test]
async fn test_local_inventory_snapshot_and_publication() {
    // The production PostgreSQL pools stay bound to their first Tokio runtime.
    assert_refreshes_empty_and_stale_leader_ids().await;
    assert_waits_for_publication_and_releases_before_execution().await;
    assert_pins_wal_and_excludes_published_sources().await;
}
