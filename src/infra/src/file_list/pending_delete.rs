// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::LazyLock as Lazy;

use hashbrown::HashSet;
use tokio::sync::RwLock;

static PENDING_DELETE_FILES: Lazy<RwLock<HashSet<String>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));
static REMOVING_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

pub async fn exist(file: &str) -> bool {
    PENDING_DELETE_FILES.read().await.contains(file)
}

pub async fn register(file: &str) {
    PENDING_DELETE_FILES.write().await.insert(file.to_string());
}

pub async fn unregister(file: &str) {
    PENDING_DELETE_FILES.write().await.remove(file);
}

pub async fn list() -> Vec<String> {
    PENDING_DELETE_FILES.read().await.iter().cloned().collect()
}

pub async fn filter(mut files: Vec<String>) -> Vec<String> {
    let pending = PENDING_DELETE_FILES.read().await;
    let removing = REMOVING_FILES.read().await;
    files.retain(|file| !pending.contains(file) && !removing.contains(file));
    files
}

pub async fn add_removing(file: &str) {
    REMOVING_FILES.write().await.insert(file.to_string());
}

pub async fn remove_removing(file: &str) {
    REMOVING_FILES.write().await.remove(file);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn filters_registered_and_removing_files() {
        register("pending.parquet").await;
        add_removing("removing.parquet").await;
        let files = filter(vec![
            "pending.parquet".to_string(),
            "removing.parquet".to_string(),
            "kept.parquet".to_string(),
        ])
        .await;
        assert_eq!(files, vec!["kept.parquet"]);
        unregister("pending.parquet").await;
        remove_removing("removing.parquet").await;
    }
}
