use std::io::Result;

fn main() -> Result<()> {
    tonic_build::configure()
        .type_attribute("FileList", "#[derive(Eq)]")
        .type_attribute("FileList", "#[derive(serde::Serialize)]")
        .type_attribute("FileKey", "#[derive(Eq)]")
        .type_attribute("FileKey", "#[derive(serde::Serialize)]")
        .type_attribute("FileDescriptor", "#[derive(Eq)]")
        .type_attribute("FileDescriptor", "#[derive(serde::Serialize)]")
        .type_attribute("FileMeta", "#[derive(Eq)]")
        .type_attribute("FileMeta", "#[derive(serde::Serialize)]")
        .type_attribute("Job", "#[derive(Eq)]")
        .type_attribute("Job", "#[derive(serde::Serialize)]")
        .type_attribute("Partition", "#[derive(Eq)]")
        .type_attribute("SearchQuery", "#[derive(Eq)]")
        .type_attribute("SearchRequest", "#[derive(Eq)]")
        .type_attribute("SearchResponse", "#[derive(Eq)]")
        .type_attribute("SearchResponse", "#[derive(serde::Serialize)]")
        .type_attribute("SearchAggRequest", "#[derive(Eq)]")
        .type_attribute("SearchAggRequest", "#[derive(serde::Serialize)]")
        .type_attribute("SearchAggResponse", "#[derive(Eq)]")
        .type_attribute("SearchAggResponse", "#[derive(serde::Serialize)]")
        .compile(
            &[
                "proto/cluster/common.proto",
                "proto/cluster/event.proto",
                "proto/cluster/search.proto",
            ],
            &["proto"],
        )
        .unwrap();

    let mut config = prost_build::Config::new();
    config
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
        .type_attribute("count", "#[derive(serde::Deserialize,serde::Serialize)]");
    config.compile_protos(
        &[
            "proto/prometheus/remote.proto",
            "proto/prometheus/types.proto",
        ],
        &["proto"],
    )?;

    Ok(())
}
