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

//! A deleted alert's dismissals go with it; org deletion already drops every kv row of the org.

use std::collections::BTreeSet;

use async_trait::async_trait;
use infra::table::entity::alerts;
use o2_enterprise::enterprise::alert_calibration_service::dismissals::{self, DismissalStore};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

/// Ids per existence query, under SQLite's default bound-parameter limit.
const IDS_PER_QUERY: usize = 500;

/// Dismissal writes through `db::kv`: writes and alert-delete cleanups replicate, sweeps do not.
pub struct DismissalKv;

#[async_trait]
impl DismissalStore for DismissalKv {
    async fn compare_and_set(
        &self,
        org: &str,
        key: &str,
        expected: Option<&[u8]>,
        value: Vec<u8>,
    ) -> anyhow::Result<bool> {
        crate::kv::compare_and_set(org, key, expected, bytes::Bytes::from(value)).await
    }

    async fn delete(&self, org: &str, key: &str) -> anyhow::Result<()> {
        crate::kv::delete(org, key).await
    }

    async fn delete_in_region(
        &self,
        org: &str,
        key: &str,
        expected: &[u8],
    ) -> anyhow::Result<bool> {
        crate::kv::compare_and_delete_in_region(org, key, expected).await
    }

    async fn existing_alerts(
        &self,
        org: &str,
        alert_ids: Vec<String>,
    ) -> anyhow::Result<BTreeSet<String>> {
        let mut found = BTreeSet::new();
        for ids in alert_ids.chunks(IDS_PER_QUERY) {
            let rows: Vec<String> = alerts::Entity::find()
                .filter(alerts::Column::Org.eq(org))
                .filter(alerts::Column::Id.is_in(ids.to_vec()))
                .select_only()
                .column(alerts::Column::Id)
                .into_tuple()
                .all(infra::db::get_orm_client_rw().await)
                .await?;
            found.extend(rows);
        }
        Ok(found)
    }
}

/// Under the alert's dismissal lock, so a dismiss or reopen cannot land after the cleanup.
pub async fn delete_for_alert(org_id: &str, alert_id: &str) -> anyhow::Result<usize> {
    Ok(dismissals::forget_alert(&DismissalKv, org_id, alert_id).await?)
}

/// Retries what a failed alert-delete cleanup left: the dismissals of alerts that are gone.
pub async fn sweep(org_id: &str) -> anyhow::Result<usize> {
    let now = config::utils::time::now_micros();
    Ok(dismissals::sweep(&DismissalKv, org_id, now).await?)
}

#[cfg(test)]
mod tests {
    use config::meta::{
        alerts::alert::Alert,
        autoobserve::dismissal_key,
        folder::{Folder, FolderType},
    };
    use infra::db::get_orm_client_rw;

    use super::*;

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    /// `Alert` has private fields, so it is built through `Deserialize`.
    async fn seeded_alert(org_id: &str, name: &str) -> svix_ksuid::Ksuid {
        let folder = Folder {
            folder_id: "default".to_string(),
            name: "default".to_string(),
            ..Default::default()
        };
        infra::table::folders::get_or_create(org_id, folder, FolderType::Alerts)
            .await
            .unwrap();
        let alert: Alert = serde_json::from_value(serde_json::json!({"name": name})).unwrap();
        let created = infra::table::alerts::create(
            get_orm_client_rw().await,
            org_id,
            "default",
            alert,
            false,
        )
        .await
        .unwrap();
        created.id.unwrap()
    }

    async fn keys(org_id: &str) -> Vec<String> {
        let mut keys = infra::table::kv_store::list(org_id, "").await.unwrap();
        keys.sort();
        keys
    }

    #[tokio::test]
    async fn deleting_an_alert_removes_only_its_dismissals() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_dismissals_{}", config::utils::time::now_micros());
        let a1 = seeded_alert(&org_id, "ops_cpu").await.to_string();
        let a2 = seeded_alert(&org_id, "pay_nodest").await.to_string();
        let near = format!("{a1}0");
        let wildcard = format!("x{}", &dismissal_key(&a1, "f3")[1..]);
        let kept = [
            dismissal_key(&a2, "f1"),
            dismissal_key(&near, "f1"),
            wildcard,
        ];
        for key in [dismissal_key(&a1, "f1"), dismissal_key(&a1, "f2")]
            .iter()
            .chain(&kept)
        {
            infra::table::kv_store::set(&org_id, key, b"{}")
                .await
                .unwrap();
        }
        let ksuid = a1.parse().unwrap();
        crate::alerts::alert::delete_by_id(get_orm_client_rw().await, &org_id, ksuid)
            .await
            .unwrap();
        let mut expected = kept.to_vec();
        expected.sort();
        assert_eq!(keys(&org_id).await, expected);
        assert_eq!(delete_for_alert(&org_id, &a2).await.unwrap(), 1);
        assert_eq!(delete_for_alert(&org_id, &a2).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn a_sweep_removes_what_a_failed_cleanup_left() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_dismissal_sweep_{}", config::utils::time::now_micros());
        let live = seeded_alert(&org_id, "ops_cpu").await.to_string();
        let deleted = seeded_alert(&org_id, "pay_nodest").await;
        infra::table::alerts::delete_by_id(get_orm_client_rw().await, &org_id, deleted)
            .await
            .unwrap();
        let row = |alert: &str| {
            serde_json::json!({
                "version": 1, "id": "f1", "rule_id": "noise", "pattern": null,
                "scope_kind": "alert", "scope_key": alert, "state": "active", "revision": 1,
                "reason": "expected", "note": null, "actor": "u-ops", "dismissed_at": 1,
                "duration_days": null, "expires_at": null, "reopened_at": null,
                "reopened_by": null, "updated_at": 1
            })
            .to_string()
        };
        for alert in [&live, &deleted.to_string()] {
            infra::table::kv_store::set(
                &org_id,
                &dismissal_key(alert, "f1"),
                row(alert).as_bytes(),
            )
            .await
            .unwrap();
        }
        let found = DismissalKv
            .existing_alerts(&org_id, vec![live.clone(), deleted.to_string()])
            .await
            .unwrap();
        assert_eq!(found, BTreeSet::from([live.clone()]));
        assert_eq!(sweep(&org_id).await.unwrap(), 1);
        assert_eq!(keys(&org_id).await, [dismissal_key(&live, "f1")]);
    }
}
