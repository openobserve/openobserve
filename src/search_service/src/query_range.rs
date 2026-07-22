// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use config::{
    get_config,
    meta::{
        stream::StreamType,
        user::{User, UserRole},
    },
    utils::query_range::get_default_max_query_range,
};

/// Get the maximum query range considering service-account restrictions,
/// stream settings, and the global default.
pub async fn get_settings_max_query_range(
    stream_max_query_range: i64,
    org_id: &str,
    user_id: Option<&str>,
) -> i64 {
    let effective_max_query_range = get_default_max_query_range(stream_max_query_range);
    let Some(user_id) = user_id else {
        return effective_max_query_range;
    };

    match db::user::get(Some(org_id), user_id).await.ok().flatten() {
        Some(user) => get_max_query_range_by_user_role(stream_max_query_range, &user),
        None => effective_max_query_range,
    }
}

/// Apply service-account-specific restrictions to a stream's maximum query range.
pub fn get_max_query_range_by_user_role(stream_max_query_range: i64, user: &User) -> i64 {
    let cfg = get_config();
    let effective_max_query_range = get_default_max_query_range(stream_max_query_range);
    if user.role == UserRole::ServiceAccount {
        let max_query_range_sa = cfg.limit.max_query_range_for_sa;
        return if max_query_range_sa > 0 && effective_max_query_range > 0 {
            std::cmp::min(effective_max_query_range, max_query_range_sa)
        } else if max_query_range_sa > 0 {
            max_query_range_sa
        } else {
            effective_max_query_range
        };
    }

    log::debug!(
        "get_max_query_range_if_sa stream_max_query_range: {effective_max_query_range}, user_role: {:?}",
        user.role
    );
    effective_max_query_range
}

/// Get the maximum query range for a list of streams in hours.
pub async fn get_max_query_range(
    stream_names: &[String],
    org_id: &str,
    user_id: &str,
    stream_type: StreamType,
) -> i64 {
    let user = db::user::get(Some(org_id), user_id).await.ok().flatten();

    futures::future::join_all(
        stream_names
            .iter()
            .map(|stream_name| infra::schema::get_settings(org_id, stream_name, stream_type)),
    )
    .await
    .into_iter()
    .filter_map(|settings| {
        settings.map(|settings| match &user {
            Some(user) => get_max_query_range_by_user_role(settings.max_query_range, user),
            None => get_default_max_query_range(settings.max_query_range),
        })
    })
    .max()
    .unwrap_or(0)
}
