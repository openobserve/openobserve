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

pub mod ai_prompts;
pub mod alerts;
pub mod dashboards;
pub mod downtimes;
pub mod events;
pub mod fleet;
pub mod ingest_rejection;
pub mod oncall;
pub mod org_status;
pub mod pipelines;
pub mod prompts;
pub mod resources;
pub mod service_identity;
pub mod service_streams;
pub mod synthetics;

pub async fn get_coordinator() -> &'static Box<dyn crate::db::Db> {
    super::db::get_coordinator().await
}

/// Announces a change on `key` to every watcher; the value is empty because watchers reload.
pub async fn emit_put(key: &str) -> Result<(), crate::errors::Error> {
    notification_result(
        get_coordinator()
            .await
            .put(key, bytes::Bytes::new(), true, None)
            .await,
    )
}

/// Announces a removal on `key` to every watcher.
pub async fn emit_delete(key: &str) -> Result<(), crate::errors::Error> {
    notification_result(get_coordinator().await.delete(key, false, true, None).await)
}

pub(crate) fn notification_result<T>(
    result: Result<T, crate::errors::Error>,
) -> Result<T, crate::errors::Error> {
    if result.is_err() {
        resources::mark_hint_lost();
    }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn legacy_notification_failure_fences_existing_catalog_generations() {
        let before = super::resources::continuity_snapshot().1;
        let result = super::notification_result::<()>(Err(crate::errors::Error::Message(
            "delivery failed".into(),
        )));
        assert!(result.is_err());
        assert_ne!(before, super::resources::continuity_snapshot().1);
    }
}
