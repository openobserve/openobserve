// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::LazyLock as Lazy;

use config::{RwHashMap, meta::stream::StreamType};

static CACHE: Lazy<RwHashMap<String, i64>> = Lazy::new(Default::default);

pub fn key(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> String {
    match date_range {
        None => format!("{org_id}/{stream_type}/{stream_name}/all"),
        Some((start, end)) => format!("{org_id}/{stream_type}/{stream_name}/{start},{end}"),
    }
}

pub fn get(key: &str) -> Option<i64> {
    CACHE.get(key).map(|value| *value)
}

pub fn insert(key: String, value: i64) {
    CACHE.insert(key, value);
}

pub fn remove(key: &str) {
    CACHE.remove(key);
}

pub fn contains(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> bool {
    CACHE.contains_key(&key(org_id, stream_type, stream_name, date_range))
}
