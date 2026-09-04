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

use std::{
    io::{Result, Write},
    path::{Path, PathBuf},
};

use cargo_metadata::MetadataCommand;

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=proto");

    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());

    // Stage the .proto files shipped by the `datafusion-proto` and
    // `datafusion-proto-common` crates under a
    // synthetic include root that mirrors the upstream source-tree layout, so
    // that `datafusion.proto`'s `import
    // "datafusion/proto-common/proto/datafusion_common.proto"` resolves.
    let df_include = out.join("datafusion_proto_include");
    stage_datafusion_proto_files(&df_include);

    let df_include_str = df_include.to_str().expect("OUT_DIR must be utf-8");

    tonic_prost_build::configure()
        .type_attribute("FileList", "#[derive(serde::Serialize)]")
        .type_attribute("FileKey", "#[derive(serde::Serialize)]")
        .type_attribute("FileMeta", "#[derive(serde::Serialize)]")
        .type_attribute("Job", "#[derive(serde::Serialize)]")
        .type_attribute("Partition", "#[derive(Eq)]")
        .type_attribute(
            "SamplingConfig",
            "#[derive(serde::Serialize, serde::Deserialize)]",
        )
        .type_attribute("SearchResponse", "#[derive(serde::Serialize)]")
        .type_attribute("SearchAggRequest", "#[derive(serde::Serialize)]")
        .type_attribute("SearchAggResponse", "#[derive(serde::Serialize)]")
        .type_attribute("Series", "#[derive(serde::Serialize)]")
        .type_attribute("Label", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute("Sample", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute("Exemplar", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute(
            "Exemplars",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute("MetricsQueryStmt", "#[derive(serde::Serialize)]")
        .type_attribute("MetricsQueryRequest", "#[derive(serde::Serialize)]")
        .type_attribute("MetricsQueryResponse", "#[derive(serde::Serialize)]")
        .type_attribute("ScanStats", "#[derive(serde::Serialize)]")
        .type_attribute(
            "PhysicalPlanNode.plan",
            "#[allow(clippy::large_enum_variant)]",
        )
        .extern_path(".datafusion_common", "::datafusion_proto::protobuf")
        .extern_path(".datafusion", "::datafusion_proto::protobuf")
        .compile_protos(
            &[
                "proto/cluster/common.proto",
                "proto/cluster/event.proto",
                "proto/cluster/metrics.proto",
                "proto/cluster/search.proto",
                "proto/cluster/ingest.proto",
                "proto/cluster/querycache.proto",
                "proto/cluster/plan.proto",
                "proto/cluster/node.proto",
                "proto/cluster/cluster_info.proto",
                "proto/cluster/stream.proto",
            ],
            &["proto", df_include_str],
        )
        .unwrap();

    let path = "src/generated/cluster.rs";
    let generated_source_path = out.join("cluster.rs");
    println!("generated_source_path: {generated_source_path:?}");
    let code = std::fs::read_to_string(generated_source_path).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .create(true)
        .open(path)
        .unwrap();
    file.write_all(code.as_str().as_ref()).unwrap();

    tonic_prost_build::configure()
        .type_attribute(
            "MetricMetadata",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute(
            "MetricType",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute("Sample", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute("Exemplar", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute(
            "Histogram",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute(
            "BucketSpan",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute(
            "TimeSeries",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute("Label", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute("Labels", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute(
            "LabelMatcher",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute(
            "ReadHints",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute("Chunk", "#[derive(serde::Deserialize,serde::Serialize)]")
        .type_attribute(
            "ChunkedSeries",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute(
            "zero_count",
            "#[derive(serde::Deserialize,serde::Serialize)]",
        )
        .type_attribute("count", "#[derive(serde::Deserialize,serde::Serialize)]")
        .compile_protos(
            &[
                "proto/prometheus/remote.proto",
                "proto/prometheus/types.proto",
            ],
            &["proto"],
        )
        .unwrap();

    let path = "src/generated/prometheus.rs";
    let generated_source_path = out.join("prometheus.rs");
    let code = std::fs::read_to_string(generated_source_path).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .create(true)
        .open(path)
        .unwrap();
    file.write_all(code.as_str().as_ref()).unwrap();

    Ok(())
}

/// Locate the `.proto` files distributed with `datafusion-proto` and
/// `datafusion-proto-common` and stage them in
/// `dest` mirroring the upstream source-tree layout.
fn stage_datafusion_proto_files(dest: &Path) {
    let metadata = MetadataCommand::new()
        .exec()
        .expect("failed to run `cargo metadata` to locate datafusion proto crates");

    let common_proto = find_proto_file(
        &metadata,
        "datafusion-proto-common",
        "datafusion_common.proto",
    );
    let df_proto = find_proto_file(&metadata, "datafusion-proto", "datafusion.proto");

    stage(
        &common_proto,
        &dest.join("datafusion/proto-common/proto/datafusion_common.proto"),
    );
    stage(
        &df_proto,
        &dest.join("datafusion/proto/proto/datafusion.proto"),
    );
}

fn find_proto_file(metadata: &cargo_metadata::Metadata, pkg: &str, file_name: &str) -> PathBuf {
    let pkg_meta = metadata
        .packages
        .iter()
        .find(|p| p.name.as_str() == pkg)
        .unwrap_or_else(|| panic!("dependency `{pkg}` not found in cargo metadata"));
    let manifest_dir = pkg_meta
        .manifest_path
        .parent()
        .unwrap_or_else(|| panic!("manifest path for `{pkg}` has no parent"));
    let proto_path = manifest_dir.join("proto").join(file_name);
    if !proto_path.exists() {
        panic!(
            "expected `{}` to ship `{}`; not found at {}",
            pkg, file_name, proto_path
        );
    }
    println!("cargo:rerun-if-changed={proto_path}");
    proto_path.into()
}

fn stage(src: &Path, dest: &Path) {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .unwrap_or_else(|e| panic!("failed to create {}: {e}", parent.display()));
    }
    std::fs::copy(src, dest).unwrap_or_else(|e| {
        panic!(
            "failed to stage {} -> {}: {e}",
            src.display(),
            dest.display()
        )
    });
}
