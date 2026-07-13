// Copyright 2026 OpenObserve Inc.

use opentelemetry::propagation::Extractor;

pub struct MetadataMap<'a>(pub &'a tonic::metadata::MetadataMap);

impl Extractor for MetadataMap<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|metadata| metadata.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0
            .keys()
            .map(|key| match key {
                tonic::metadata::KeyRef::Ascii(value) => value.as_str(),
                tonic::metadata::KeyRef::Binary(value) => value.as_str(),
            })
            .collect()
    }
}
