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

#![allow(dead_code)]

use std::{collections::BTreeMap, future::Future, str::FromStr};

use anyhow::{Result, anyhow, bail};
use config::meta::stream::{FileKey, PartitionTimeLevel, StreamType};
use infra::table::alert_snapshots as snapshot_table;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;

pub(crate) const ALERT_SNAPSHOT_SCHEMA_VERSION: i16 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct AlertSnapshotOccurrence {
    pub(crate) org_id: String,
    pub(crate) alert_id: Ksuid,
    pub(crate) window_start: i64,
    pub(crate) window_end: i64,
}

impl AlertSnapshotOccurrence {
    pub(crate) fn new(
        org_id: impl Into<String>,
        alert_id: Ksuid,
        window_start: i64,
        window_end: i64,
    ) -> Self {
        Self {
            org_id: org_id.into(),
            alert_id,
            window_start,
            window_end,
        }
    }

    pub(crate) fn key(&self) -> String {
        [
            stable_component("org", &self.org_id),
            stable_component("alert", &self.alert_id.to_string()),
            stable_component("window_start", &self.window_start.to_string()),
            stable_component("window_end", &self.window_end.to_string()),
        ]
        .join("|")
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct AlertSnapshotManifest {
    pub(crate) org_id: String,
    pub(crate) alert_id: Ksuid,
    pub(crate) alert_name: Option<String>,
    pub(crate) trigger_timestamp: i64,
    pub(crate) window_start: i64,
    pub(crate) window_end: i64,
    pub(crate) created_at: i64,
    pub(crate) schema_version: i16,
    pub(crate) streams: Vec<AlertSnapshotStream>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct PersistedAlertSnapshotManifest {
    pub(crate) snapshot_id: Ksuid,
    pub(crate) manifest: AlertSnapshotManifest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlertSnapshotManifestView {
    pub snapshot_id: Ksuid,
    pub org_id: String,
    pub alert_id: Ksuid,
    pub alert_name: Option<String>,
    pub trigger_timestamp: i64,
    pub window_start: i64,
    pub window_end: i64,
    pub created_at: i64,
    pub schema_version: i16,
    pub streams: Vec<AlertSnapshotStreamView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlertSnapshotStreamView {
    pub stream_type: StreamType,
    pub stream_name: String,
    pub files: Vec<AlertSnapshotFileRefView>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlertSnapshotFileRefView {
    pub file_id: Option<i64>,
    pub file_key: String,
    pub min_ts: i64,
    pub max_ts: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct AlertSnapshotStream {
    pub(crate) stream_type: StreamType,
    pub(crate) stream_name: String,
    pub(crate) files: Vec<AlertSnapshotFileRef>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub(crate) struct AlertSnapshotFileRef {
    pub(crate) file_id: Option<i64>,
    pub(crate) file_key: String,
    pub(crate) min_ts: i64,
    pub(crate) max_ts: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct ScheduledSnapshotInput {
    pub(crate) org_id: String,
    pub(crate) alert_id: Ksuid,
    pub(crate) alert_name: Option<String>,
    pub(crate) stream_type: StreamType,
    pub(crate) stream_name: String,
    pub(crate) trigger_timestamp: i64,
    pub(crate) window_start: i64,
    pub(crate) window_end: i64,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileListQueryRequest {
    trace_id: String,
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
}

pub(crate) async fn build_scheduled_snapshot_manifest_from_file_list(
    trace_id: &str,
    input: ScheduledSnapshotInput,
) -> Result<AlertSnapshotManifest> {
    build_scheduled_snapshot_manifest_from_file_list_with_query(
        trace_id,
        input,
        |request| async move {
            crate::service::file_list::query(
                &request.trace_id,
                &request.org_id,
                request.stream_type,
                &request.stream_name,
                request.time_level,
                request.time_min,
                request.time_max,
            )
            .await
            .map_err(|e| anyhow!("{e}"))
        },
    )
    .await
}

pub(crate) async fn create_snapshot_manifest(
    manifest: AlertSnapshotManifest,
) -> Result<PersistedAlertSnapshotManifest> {
    let record = snapshot_table::create_snapshot_manifest(to_persistence_manifest(manifest))
        .await
        .map_err(|e| anyhow!("alert snapshot manifest persistence failed: {e}"))?;
    from_persistence_record(record)
}

pub(crate) async fn get_snapshot_manifest(
    org_id: &str,
    snapshot_id: Ksuid,
) -> Result<Option<PersistedAlertSnapshotManifest>> {
    let record = snapshot_table::get_snapshot_manifest(org_id, &snapshot_id.to_string())
        .await
        .map_err(|e| anyhow!("alert snapshot manifest lookup failed: {e}"))?;
    record.map(from_persistence_record).transpose()
}

pub async fn get_snapshot_manifest_view(
    org_id: &str,
    snapshot_id: Ksuid,
) -> Result<Option<AlertSnapshotManifestView>> {
    Ok(get_snapshot_manifest(org_id, snapshot_id)
        .await?
        .map(AlertSnapshotManifestView::from))
}

pub(crate) async fn find_snapshot_by_occurrence(
    org_id: &str,
    alert_id: Ksuid,
    window_start: i64,
    window_end: i64,
) -> Result<Option<PersistedAlertSnapshotManifest>> {
    validate_window(window_start, window_end)?;
    let record = snapshot_table::find_snapshot_by_occurrence(
        org_id,
        &alert_id.to_string(),
        window_start,
        window_end,
    )
    .await
    .map_err(|e| anyhow!("alert snapshot occurrence lookup failed: {e}"))?;
    record.map(from_persistence_record).transpose()
}

pub(crate) fn build_scheduled_snapshot_manifest(
    input: ScheduledSnapshotInput,
    files: Vec<FileKey>,
) -> Result<AlertSnapshotManifest> {
    validate_window(input.window_start, input.window_end)?;
    validate_manifest_input(&input)?;
    let occurrence = AlertSnapshotOccurrence::new(
        input.org_id.clone(),
        input.alert_id,
        input.window_start,
        input.window_end,
    );
    let file_refs = select_file_refs_for_window(files, input.window_start, input.window_end)?;
    let mut streams = vec![AlertSnapshotStream {
        stream_type: input.stream_type,
        stream_name: input.stream_name.clone(),
        files: file_refs,
    }];
    sort_streams(&mut streams);

    Ok(AlertSnapshotManifest {
        org_id: input.org_id,
        alert_id: occurrence.alert_id,
        alert_name: input.alert_name,
        trigger_timestamp: input.trigger_timestamp,
        window_start: occurrence.window_start,
        window_end: occurrence.window_end,
        created_at: input.created_at,
        schema_version: ALERT_SNAPSHOT_SCHEMA_VERSION,
        streams,
    })
}

pub(crate) fn select_file_refs_for_window(
    files: Vec<FileKey>,
    window_start: i64,
    window_end: i64,
) -> Result<Vec<AlertSnapshotFileRef>> {
    validate_window(window_start, window_end)?;
    let mut refs = files
        .into_iter()
        .filter(|file| !file.deleted)
        .filter(|file| {
            file_overlaps_window(file.meta.min_ts, file.meta.max_ts, window_start, window_end)
        })
        .map(AlertSnapshotFileRef::from)
        .collect::<Vec<_>>();

    refs.sort_by(|a, b| a.canonical_tuple().cmp(&b.canonical_tuple()));
    refs.dedup_by(|a, b| a.file_key == b.file_key);
    Ok(refs)
}

pub(crate) fn file_overlaps_window(
    file_min_timestamp: i64,
    file_max_timestamp: i64,
    window_start: i64,
    window_end: i64,
) -> bool {
    file_min_timestamp <= window_end && file_max_timestamp >= window_start
}

pub(crate) fn sort_streams(streams: &mut [AlertSnapshotStream]) {
    streams.sort_by(|a, b| {
        a.stream_type
            .to_string()
            .cmp(&b.stream_type.to_string())
            .then(a.stream_name.cmp(&b.stream_name))
    });
}

impl AlertSnapshotFileRef {
    fn canonical_tuple(&self) -> (&str, bool, i64, i64, i64) {
        (
            self.file_key.as_str(),
            self.file_id.is_none(),
            self.file_id.unwrap_or_default(),
            self.min_ts,
            self.max_ts,
        )
    }
}

impl From<FileKey> for AlertSnapshotFileRef {
    fn from(file: FileKey) -> Self {
        Self {
            file_id: (file.id > 0).then_some(file.id),
            file_key: file.key,
            min_ts: file.meta.min_ts,
            max_ts: file.meta.max_ts,
        }
    }
}

impl From<PersistedAlertSnapshotManifest> for AlertSnapshotManifestView {
    fn from(persisted: PersistedAlertSnapshotManifest) -> Self {
        let manifest = persisted.manifest;
        Self {
            snapshot_id: persisted.snapshot_id,
            org_id: manifest.org_id,
            alert_id: manifest.alert_id,
            alert_name: manifest.alert_name,
            trigger_timestamp: manifest.trigger_timestamp,
            window_start: manifest.window_start,
            window_end: manifest.window_end,
            created_at: manifest.created_at,
            schema_version: manifest.schema_version,
            streams: manifest
                .streams
                .into_iter()
                .map(AlertSnapshotStreamView::from)
                .collect(),
        }
    }
}

impl From<AlertSnapshotStream> for AlertSnapshotStreamView {
    fn from(stream: AlertSnapshotStream) -> Self {
        Self {
            stream_type: stream.stream_type,
            stream_name: stream.stream_name,
            files: stream
                .files
                .into_iter()
                .map(AlertSnapshotFileRefView::from)
                .collect(),
        }
    }
}

impl From<AlertSnapshotFileRef> for AlertSnapshotFileRefView {
    fn from(file: AlertSnapshotFileRef) -> Self {
        Self {
            file_id: file.file_id,
            file_key: file.file_key,
            min_ts: file.min_ts,
            max_ts: file.max_ts,
        }
    }
}

fn to_persistence_manifest(
    manifest: AlertSnapshotManifest,
) -> snapshot_table::NewAlertSnapshotManifest {
    let files = manifest
        .streams
        .iter()
        .flat_map(|stream| {
            stream
                .files
                .iter()
                .map(|file| snapshot_table::NewAlertSnapshotFile {
                    stream_type: stream.stream_type.to_string(),
                    stream_name: stream.stream_name.clone(),
                    file_id: file.file_id,
                    file_key: file.file_key.clone(),
                    min_ts: file.min_ts,
                    max_ts: file.max_ts,
                })
        })
        .collect();

    snapshot_table::NewAlertSnapshotManifest {
        org_id: manifest.org_id,
        alert_id: manifest.alert_id.to_string(),
        alert_name: manifest.alert_name,
        trigger_timestamp: manifest.trigger_timestamp,
        window_start: manifest.window_start,
        window_end: manifest.window_end,
        created_at: manifest.created_at,
        schema_version: manifest.schema_version,
        files,
    }
}

fn from_persistence_record(
    record: snapshot_table::AlertSnapshotManifestRecord,
) -> Result<PersistedAlertSnapshotManifest> {
    let snapshot_id = Ksuid::from_str(&record.snapshot.snapshot_id)
        .map_err(|e| anyhow!("invalid alert snapshot_id in database: {e}"))?;
    let alert_id = Ksuid::from_str(&record.snapshot.alert_id)
        .map_err(|e| anyhow!("invalid alert_id in alert snapshot database row: {e}"))?;
    let mut streams = BTreeMap::<(String, String), Vec<AlertSnapshotFileRef>>::new();
    for file in record.files {
        streams
            .entry((file.stream_type, file.stream_name))
            .or_default()
            .push(AlertSnapshotFileRef {
                file_id: file.file_id,
                file_key: file.file_key,
                min_ts: file.min_ts,
                max_ts: file.max_ts,
            });
    }

    let streams = streams
        .into_iter()
        .map(|((stream_type, stream_name), files)| {
            Ok(AlertSnapshotStream {
                stream_type: parse_persisted_stream_type(&stream_type)?,
                stream_name,
                files,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(PersistedAlertSnapshotManifest {
        snapshot_id,
        manifest: AlertSnapshotManifest {
            org_id: record.snapshot.org_id,
            alert_id,
            alert_name: record.snapshot.alert_name,
            trigger_timestamp: record.snapshot.trigger_timestamp,
            window_start: record.snapshot.window_start,
            window_end: record.snapshot.window_end,
            created_at: record.snapshot.created_at,
            schema_version: record.snapshot.schema_version,
            streams,
        },
    })
}

fn parse_persisted_stream_type(value: &str) -> Result<StreamType> {
    let stream_type = StreamType::from(value);
    if stream_type.to_string() != value {
        bail!("invalid stream_type in alert snapshot database row: {value}");
    }
    Ok(stream_type)
}

fn validate_window(window_start: i64, window_end: i64) -> Result<()> {
    if window_start > window_end {
        bail!("invalid alert snapshot window: window_start must be <= window_end");
    }
    Ok(())
}

async fn build_scheduled_snapshot_manifest_from_file_list_with_query<F, Fut>(
    trace_id: &str,
    input: ScheduledSnapshotInput,
    query: F,
) -> Result<AlertSnapshotManifest>
where
    F: FnOnce(FileListQueryRequest) -> Fut,
    Fut: Future<Output = Result<Vec<FileKey>>>,
{
    validate_file_list_query_window(input.window_start, input.window_end)?;
    validate_manifest_input(&input)?;

    let request = FileListQueryRequest {
        trace_id: trace_id.to_string(),
        org_id: input.org_id.clone(),
        stream_type: input.stream_type,
        stream_name: input.stream_name.clone(),
        time_level: PartitionTimeLevel::default(),
        time_min: input.window_start,
        time_max: input.window_end,
    };

    let mut files = query(request.clone()).await.map_err(|e| {
        anyhow!(
            "alert snapshot file-list metadata lookup failed for org_id={} stream_type={} stream_name={} window_start={} window_end={}: {e}",
            request.org_id,
            request.stream_type,
            request.stream_name,
            request.time_min,
            request.time_max,
        )
    })?;
    files.retain(|file| {
        file_key_matches_source_stream(
            &file.key,
            &input.org_id,
            input.stream_type,
            &input.stream_name,
        )
    });

    build_scheduled_snapshot_manifest(input, files)
}

fn validate_file_list_query_window(window_start: i64, window_end: i64) -> Result<()> {
    validate_window(window_start, window_end)?;
    if window_start == 0 || window_end == 0 {
        bail!(
            "invalid alert snapshot file-list window: window_start and window_end must be non-zero"
        );
    }
    Ok(())
}

fn validate_manifest_input(input: &ScheduledSnapshotInput) -> Result<()> {
    if input.org_id.is_empty() {
        bail!("invalid alert snapshot input: org_id is required");
    }
    if input.stream_name.is_empty() {
        bail!("invalid alert snapshot input: stream_name is required");
    }
    Ok(())
}

fn file_key_matches_source_stream(
    file_key: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> bool {
    let mut parts = file_key.split('/');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some("files"), Some(org), Some(typ), Some(name))
            if org == org_id && typ == stream_type.to_string() && name == stream_name
    )
}

fn stable_component(label: &str, value: &str) -> String {
    format!("{label}:{}:{value}", value.len())
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileMeta, StreamType};
    use infra::table::entity::{alert_snapshot_files, alert_snapshots};
    use svix_ksuid::{Ksuid, KsuidLike};

    use super::*;

    fn file(id: i64, key: &str, min_ts: i64, max_ts: i64, deleted: bool) -> FileKey {
        FileKey {
            id,
            account: String::new(),
            key: key.to_string(),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: 10,
                original_size: 100,
                compressed_size: 50,
                index_size: 0,
                bloom_ver: 0,
                flattened: false,
            },
            deleted,
            selection: None,
            row_group_size: None,
        }
    }

    fn occurrence(
        org_id: &str,
        alert_id: Ksuid,
        window_start: i64,
        window_end: i64,
    ) -> AlertSnapshotOccurrence {
        AlertSnapshotOccurrence::new(org_id, alert_id, window_start, window_end)
    }

    fn snapshot_input(window_start: i64, window_end: i64) -> ScheduledSnapshotInput {
        ScheduledSnapshotInput {
            org_id: "org1".to_string(),
            alert_id: Ksuid::new(None, None),
            alert_name: Some("cpu_high".to_string()),
            stream_type: StreamType::Logs,
            stream_name: "app".to_string(),
            trigger_timestamp: window_end,
            window_start,
            window_end,
            created_at: window_end,
        }
    }

    #[tokio::test]
    async fn adapter_passes_expected_scope_and_window_to_file_list_lookup() {
        let input = snapshot_input(10, 20);
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            input,
            |request| async move {
                assert_eq!(request.trace_id, "trace-1");
                assert_eq!(request.org_id, "org1");
                assert_eq!(request.stream_type, StreamType::Logs);
                assert_eq!(request.stream_name, "app");
                assert_eq!(request.time_level, PartitionTimeLevel::default());
                assert_eq!(request.time_min, 10);
                assert_eq!(request.time_max, 20);
                Ok(Vec::new())
            },
        )
        .await
        .unwrap();

        assert_eq!(manifest.org_id, "org1");
        assert_eq!(manifest.streams[0].stream_name, "app");
    }

    #[tokio::test]
    async fn adapter_converts_matching_file_key_records() {
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async {
                Ok(vec![file(
                    7,
                    "files/org1/logs/app/2024/01/01/a.parquet",
                    10,
                    20,
                    false,
                )])
            },
        )
        .await
        .unwrap();

        assert_eq!(manifest.streams[0].files.len(), 1);
        assert_eq!(manifest.streams[0].files[0].file_id, Some(7));
        assert_eq!(
            manifest.streams[0].files[0].file_key,
            "files/org1/logs/app/2024/01/01/a.parquet"
        );
        assert_eq!(manifest.streams[0].files[0].min_ts, 10);
        assert_eq!(manifest.streams[0].files[0].max_ts, 20);
    }

    #[tokio::test]
    async fn adapter_excludes_deleted_file_records() {
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async {
                Ok(vec![file(
                    7,
                    "files/org1/logs/app/2024/01/01/a.parquet",
                    10,
                    20,
                    true,
                )])
            },
        )
        .await
        .unwrap();

        assert!(manifest.streams[0].files.is_empty());
    }

    #[tokio::test]
    async fn adapter_empty_file_list_result_produces_empty_manifest() {
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async { Ok(Vec::new()) },
        )
        .await
        .unwrap();

        assert!(manifest.streams[0].files.is_empty());
    }

    #[tokio::test]
    async fn adapter_metadata_query_failure_is_returned_with_context() {
        let err = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async { Err(anyhow!("database unavailable")) },
        )
        .await
        .unwrap_err();
        let message = err.to_string();

        assert!(message.contains("file-list metadata lookup failed"));
        assert!(message.contains("org_id=org1"));
        assert!(message.contains("stream_type=logs"));
        assert!(message.contains("stream_name=app"));
        assert!(message.contains("window_start=10"));
        assert!(message.contains("window_end=20"));
        assert!(message.contains("database unavailable"));
    }

    #[tokio::test]
    async fn adapter_rejects_invalid_start_greater_than_end_before_lookup() {
        let mut lookup_called = false;
        let err = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(20, 10),
            |_| {
                lookup_called = true;
                async { Ok(Vec::new()) }
            },
        )
        .await
        .unwrap_err();

        assert!(!lookup_called);
        assert!(
            err.to_string()
                .contains("window_start must be <= window_end")
        );
    }

    #[tokio::test]
    async fn adapter_rejects_zero_range_before_lookup() {
        let mut lookup_called = false;
        let err = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(0, 10),
            |_| {
                lookup_called = true;
                async { Ok(Vec::new()) }
            },
        )
        .await
        .unwrap_err();

        assert!(!lookup_called);
        assert!(err.to_string().contains("must be non-zero"));
    }

    #[tokio::test]
    async fn adapter_deterministic_when_metadata_input_order_changes() {
        let files = vec![
            file(3, "files/org1/logs/app/2024/01/01/c.parquet", 10, 20, false),
            file(2, "files/org1/logs/app/2024/01/01/a.parquet", 10, 20, false),
            file(1, "files/org1/logs/app/2024/01/01/b.parquet", 10, 20, false),
        ];
        let mut shuffled = files.clone();
        shuffled.reverse();

        let a = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async move { Ok(files) },
        )
        .await
        .unwrap();
        let b = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async move { Ok(shuffled) },
        )
        .await
        .unwrap();

        assert_eq!(a.streams[0].files, b.streams[0].files);
    }

    #[tokio::test]
    async fn adapter_duplicate_metadata_canonicalization_remains_stable() {
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(1, 30),
            |_| async {
                Ok(vec![
                    file(2, "files/org1/logs/app/2024/01/01/a.parquet", 10, 20, false),
                    file(1, "files/org1/logs/app/2024/01/01/a.parquet", 5, 25, false),
                    file(1, "files/org1/logs/app/2024/01/01/a.parquet", 10, 20, false),
                ])
            },
        )
        .await
        .unwrap();

        assert_eq!(manifest.streams[0].files.len(), 1);
        assert_eq!(manifest.streams[0].files[0].file_id, Some(1));
        assert_eq!(manifest.streams[0].files[0].min_ts, 5);
        assert_eq!(manifest.streams[0].files[0].max_ts, 25);
    }

    #[tokio::test]
    async fn adapter_excludes_cross_organization_file_keys() {
        let manifest = build_scheduled_snapshot_manifest_from_file_list_with_query(
            "trace-1",
            snapshot_input(10, 20),
            |_| async {
                Ok(vec![
                    file(
                        1,
                        "files/org2/logs/app/2024/01/01/cross.parquet",
                        10,
                        20,
                        false,
                    ),
                    file(
                        2,
                        "files/org1/logs/app/2024/01/01/local.parquet",
                        10,
                        20,
                        false,
                    ),
                ])
            },
        )
        .await
        .unwrap();

        assert_eq!(manifest.streams[0].files.len(), 1);
        assert_eq!(
            manifest.streams[0].files[0].file_key,
            "files/org1/logs/app/2024/01/01/local.parquet"
        );
    }

    #[test]
    fn file_fully_inside_alert_window_overlaps() {
        assert!(file_overlaps_window(20, 30, 10, 40));
    }

    #[test]
    fn alert_window_fully_inside_file_range_overlaps() {
        assert!(file_overlaps_window(10, 40, 20, 30));
    }

    #[test]
    fn overlap_at_window_beginning_is_included() {
        assert!(file_overlaps_window(1, 10, 10, 20));
    }

    #[test]
    fn overlap_at_window_end_is_included() {
        assert!(file_overlaps_window(20, 30, 10, 20));
    }

    #[test]
    fn file_completely_before_window_is_excluded() {
        assert!(!file_overlaps_window(1, 9, 10, 20));
    }

    #[test]
    fn file_completely_after_window_is_excluded() {
        assert!(!file_overlaps_window(21, 30, 10, 20));
    }

    #[test]
    fn exact_timestamp_boundary_is_included() {
        assert!(file_overlaps_window(10, 10, 10, 10));
    }

    #[test]
    fn window_start_greater_than_window_end_is_rejected() {
        assert!(select_file_refs_for_window(Vec::new(), 20, 10).is_err());
        assert!(build_scheduled_snapshot_manifest(snapshot_input(20, 10), Vec::new()).is_err());
    }

    #[test]
    fn empty_organization_id_is_rejected_by_manifest_builder() {
        let mut input = snapshot_input(10, 20);
        input.org_id.clear();

        assert!(build_scheduled_snapshot_manifest(input, Vec::new()).is_err());
    }

    #[test]
    fn empty_stream_name_is_rejected_by_manifest_builder() {
        let mut input = snapshot_input(10, 20);
        input.stream_name.clear();

        assert!(build_scheduled_snapshot_manifest(input, Vec::new()).is_err());
    }

    #[test]
    fn window_start_equal_to_window_end_is_allowed() {
        let refs = select_file_refs_for_window(
            vec![file(1, "files/org/logs/a/1.parquet", 10, 10, false)],
            10,
            10,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
        assert!(build_scheduled_snapshot_manifest(snapshot_input(10, 10), Vec::new()).is_ok());
    }

    #[test]
    fn negative_timestamps_are_allowed_when_window_is_ordered() {
        let refs = select_file_refs_for_window(
            vec![file(1, "files/org/logs/a/1.parquet", -20, -10, false)],
            -15,
            -15,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn zero_timestamps_are_allowed_when_window_is_ordered() {
        let refs = select_file_refs_for_window(
            vec![file(1, "files/org/logs/a/1.parquet", 0, 0, false)],
            0,
            0,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
    }

    #[test]
    fn deleted_file_is_excluded() {
        let refs = select_file_refs_for_window(
            vec![file(1, "files/org/logs/a/1.parquet", 10, 20, true)],
            10,
            20,
        )
        .unwrap();
        assert!(refs.is_empty());
    }

    #[test]
    fn empty_file_collection_returns_empty_refs() {
        let refs = select_file_refs_for_window(Vec::new(), 10, 20).unwrap();
        assert!(refs.is_empty());
    }

    #[test]
    fn file_ordering_is_deterministic_by_key_then_id() {
        let refs = select_file_refs_for_window(
            vec![
                file(3, "files/org/logs/s/2024/01/01/c.parquet", 10, 20, false),
                file(2, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
                file(1, "files/org/logs/s/2024/01/01/b.parquet", 10, 20, false),
            ],
            10,
            20,
        )
        .unwrap();

        assert_eq!(
            refs.iter().map(|f| f.file_key.as_str()).collect::<Vec<_>>(),
            vec![
                "files/org/logs/s/2024/01/01/a.parquet",
                "files/org/logs/s/2024/01/01/b.parquet",
                "files/org/logs/s/2024/01/01/c.parquet",
            ]
        );
    }

    #[test]
    fn exact_duplicate_file_records_are_canonicalized() {
        let refs = select_file_refs_for_window(
            vec![
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
            ],
            10,
            20,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file_id, Some(1));
        assert_eq!(refs[0].min_ts, 10);
        assert_eq!(refs[0].max_ts, 20);
    }

    #[test]
    fn same_file_key_with_different_file_ids_uses_lowest_positive_id() {
        let refs = select_file_refs_for_window(
            vec![
                file(2, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
            ],
            10,
            20,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file_id, Some(1));
    }

    #[test]
    fn same_file_key_and_id_with_differing_timestamps_uses_lowest_time_tuple() {
        let refs = select_file_refs_for_window(
            vec![
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 5, 25, false),
            ],
            1,
            30,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].min_ts, 5);
        assert_eq!(refs[0].max_ts, 25);
    }

    #[test]
    fn shuffled_duplicate_input_produces_same_canonical_output() {
        let files = vec![
            file(2, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
            file(1, "files/org/logs/s/2024/01/01/a.parquet", 5, 25, false),
            file(1, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
        ];
        let mut shuffled = files.clone();
        shuffled.reverse();

        assert_eq!(
            select_file_refs_for_window(files, 1, 30).unwrap(),
            select_file_refs_for_window(shuffled, 1, 30).unwrap()
        );
    }

    #[test]
    fn deleted_duplicate_records_are_excluded_before_canonicalization() {
        let refs = select_file_refs_for_window(
            vec![
                file(1, "files/org/logs/s/2024/01/01/a.parquet", 5, 25, true),
                file(2, "files/org/logs/s/2024/01/01/a.parquet", 10, 20, false),
            ],
            1,
            30,
        )
        .unwrap();

        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].file_id, Some(2));
        assert_eq!(refs[0].min_ts, 10);
        assert_eq!(refs[0].max_ts, 20);
    }

    #[test]
    fn stream_ordering_is_deterministic_by_type_then_name() {
        let mut streams = vec![
            AlertSnapshotStream {
                stream_type: StreamType::Metrics,
                stream_name: "z".to_string(),
                files: vec![],
            },
            AlertSnapshotStream {
                stream_type: StreamType::Logs,
                stream_name: "b".to_string(),
                files: vec![],
            },
            AlertSnapshotStream {
                stream_type: StreamType::Logs,
                stream_name: "a".to_string(),
                files: vec![],
            },
        ];

        sort_streams(&mut streams);

        assert_eq!(
            streams
                .iter()
                .map(|s| (s.stream_type, s.stream_name.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (StreamType::Logs, "a"),
                (StreamType::Logs, "b"),
                (StreamType::Metrics, "z"),
            ]
        );
    }

    #[test]
    fn occurrence_identity_is_stable() {
        let alert_id = Ksuid::new(None, None);
        let a = occurrence("org1", alert_id, 10, 20);
        let b = occurrence("org1", alert_id, 10, 20);

        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn different_alert_windows_create_different_identities() {
        let alert_id = Ksuid::new(None, None);
        let a = occurrence("org1", alert_id, 10, 20);
        let b = occurrence("org1", alert_id, 10, 21);

        assert_ne!(a.key(), b.key());
    }

    #[test]
    fn different_organizations_cannot_produce_same_occurrence_identity() {
        let alert_id = Ksuid::new(None, None);
        let a = occurrence("org1", alert_id, 10, 20);
        let b = occurrence("org2", alert_id, 10, 20);

        assert_ne!(a.key(), b.key());
    }

    #[test]
    fn different_alert_ids_cannot_produce_same_occurrence_identity() {
        let a = occurrence("org1", Ksuid::new(None, None), 10, 20);
        let b = occurrence("org1", Ksuid::new(None, None), 10, 20);

        assert_ne!(a.key(), b.key());
    }

    #[test]
    fn scheduled_manifest_uses_one_source_stream_for_mvp() {
        let alert_id = Ksuid::new(None, None);
        let manifest = build_scheduled_snapshot_manifest(
            ScheduledSnapshotInput {
                org_id: "org1".to_string(),
                alert_id,
                alert_name: Some("cpu_high".to_string()),
                stream_type: StreamType::Logs,
                stream_name: "app".to_string(),
                trigger_timestamp: 30,
                window_start: 10,
                window_end: 20,
                created_at: 31,
            },
            vec![file(
                1,
                "files/org1/logs/app/2024/01/01/a.parquet",
                10,
                20,
                false,
            )],
        )
        .unwrap();

        assert_eq!(manifest.schema_version, ALERT_SNAPSHOT_SCHEMA_VERSION);
        assert_eq!(manifest.org_id, "org1");
        assert_eq!(manifest.alert_id, alert_id);
        assert_eq!(manifest.streams.len(), 1);
        assert_eq!(manifest.streams[0].stream_type, StreamType::Logs);
        assert_eq!(manifest.streams[0].stream_name, "app");
        assert_eq!(manifest.streams[0].files.len(), 1);
    }

    #[test]
    fn persisted_record_reconstructs_multiple_streams_deterministically() {
        let snapshot_id = Ksuid::new(None, None);
        let alert_id = Ksuid::new(None, None);
        let persisted = from_persistence_record(snapshot_table::AlertSnapshotManifestRecord {
            snapshot: alert_snapshots::Model {
                snapshot_id: snapshot_id.to_string(),
                org_id: "org1".to_string(),
                alert_id: alert_id.to_string(),
                alert_name: Some("cpu_high".to_string()),
                trigger_timestamp: 30,
                window_start: 10,
                window_end: 20,
                created_at: 31,
                schema_version: ALERT_SNAPSHOT_SCHEMA_VERSION,
            },
            files: vec![
                alert_snapshot_files::Model {
                    snapshot_id: snapshot_id.to_string(),
                    file_key: "files/org1/metrics/cpu/a.parquet".to_string(),
                    stream_type: "metrics".to_string(),
                    stream_name: "cpu".to_string(),
                    file_id: Some(2),
                    min_ts: 10,
                    max_ts: 20,
                },
                alert_snapshot_files::Model {
                    snapshot_id: snapshot_id.to_string(),
                    file_key: "files/org1/logs/app/a.parquet".to_string(),
                    stream_type: "logs".to_string(),
                    stream_name: "app".to_string(),
                    file_id: Some(1),
                    min_ts: 10,
                    max_ts: 20,
                },
            ],
        })
        .unwrap();

        assert_eq!(persisted.snapshot_id, snapshot_id);
        assert_eq!(persisted.manifest.alert_id, alert_id);
        assert_eq!(
            persisted
                .manifest
                .streams
                .iter()
                .map(|stream| (stream.stream_type, stream.stream_name.as_str()))
                .collect::<Vec<_>>(),
            vec![(StreamType::Logs, "app"), (StreamType::Metrics, "cpu")]
        );
        assert_eq!(
            persisted.manifest.streams[0].files[0].file_key,
            "files/org1/logs/app/a.parquet"
        );
        assert_eq!(
            persisted.manifest.streams[1].files[0].file_key,
            "files/org1/metrics/cpu/a.parquet"
        );
    }
}
