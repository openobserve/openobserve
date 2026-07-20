// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::collections::HashSet;

use config::meta::stream::StreamType;
use infra::schema::STREAM_SCHEMAS_LATEST;

pub async fn list_organizations() -> Vec<String> {
    STREAM_SCHEMAS_LATEST
        .read()
        .await
        .keys()
        .filter_map(|key| key.split_once('/').map(|(org_id, _)| org_id.to_string()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

pub async fn list_streams(org_id: &str, stream_type: StreamType) -> Vec<String> {
    STREAM_SCHEMAS_LATEST
        .read()
        .await
        .keys()
        .filter_map(|key| {
            let mut columns = key.split('/');
            let current_org = columns.next()?;
            let current_type = StreamType::from(columns.next()?);
            let stream_name = columns.next()?;
            (current_org == org_id && current_type == stream_type).then(|| stream_name.to_string())
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}
