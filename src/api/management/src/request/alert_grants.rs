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

//! Which alerts a role reads short of org-wide, shared by every read that names alerts.

use std::{
    collections::{BTreeSet, HashMap, HashSet},
    future::Future,
    str::FromStr,
};

use config::meta::alerts::alert::ListAlertsParams;
use futures::{StreamExt, stream};
use infra::{db::get_orm_client_ro, errors::Error as InfraError};
use o2_openfga::{authorizer::authz::list_objects, meta::mapping::OFGA_MODELS};
use openobserve_core::{
    alerts::alert, auth::check_permissions, background_access::rbac_enforced, users,
};
use svix_ksuid::Ksuid;

/// Past this many alerts, one list filtered to their ids is cheaper than reading each.
const ALERT_READS_ONE_BY_ONE: usize = 64;
const ALERT_READ_CONCURRENCY: usize = 16;

/// A role's alert grants short of org-wide, as list-objects ids: folders, and single alerts.
#[derive(Debug, Default)]
pub(crate) struct AlertGrants {
    every_folder: bool,
    folders: HashSet<String>,
    alerts: HashSet<String>,
}

impl AlertGrants {
    pub(crate) fn from_objects(org_id: &str, folders: Vec<String>, alerts: Vec<String>) -> Self {
        let ids = |objects: Vec<String>| -> HashSet<String> {
            objects
                .into_iter()
                .filter_map(|o| o.split_once(':').map(|(_, id)| id.to_string()))
                .collect()
        };
        let (folders, alerts) = (ids(folders), ids(alerts));
        let all = format!("_all_{org_id}");
        Self {
            every_folder: folders.contains(&all) || alerts.contains(&all),
            folders,
            alerts,
        }
    }

    /// Nothing short of org-wide, so no alert's folder can make one readable.
    pub(crate) fn is_empty(&self) -> bool {
        !self.every_folder && self.folders.is_empty() && self.alerts.is_empty()
    }

    /// The per-alert check's paths: a folder grant, or a grant on `{id}` or `{folder}/{id}`.
    pub(crate) fn allows(&self, alert_id: &str, folder_id: &str) -> bool {
        self.every_folder
            || self.folders.contains(folder_id)
            || self.alerts.contains(alert_id)
            || self.alerts.contains(&format!("{folder_id}/{alert_id}"))
    }
}

/// The permission and alert reads a subject filter makes; tests count them.
pub(crate) trait AlertAuthority {
    async fn org_wide(&self, resource: &'static str) -> bool;
    async fn grants(&self) -> AlertGrants;
    /// Each existing alert's folder id; a missing alert is absent.
    async fn folders_of(&self, alert_ids: Vec<String>) -> HashMap<String, String>;
    /// Every alert of the org with its folder id, for a probe too large to name its alerts.
    async fn org_folders(&self) -> HashMap<String, String>;
}

pub(crate) struct LiveAuthority<'a> {
    pub(crate) org_id: &'a str,
    pub(crate) user_id: &'a str,
}

impl LiveAuthority<'_> {
    /// A failed listing grants nothing, as a failed per-alert check denies.
    async fn listed(&self, permission: &str, resource: &str, role: &str) -> Vec<String> {
        let object_type = OFGA_MODELS.get(resource).map_or(resource, |m| m.key);
        list_objects(self.user_id, permission, object_type, self.org_id, role)
            .await
            .unwrap_or_else(|e| {
                log::warn!("autoobserve: listing {object_type} grants failed: {e}");
                Vec::new()
            })
    }
}

impl AlertAuthority for LiveAuthority<'_> {
    async fn org_wide(&self, resource: &'static str) -> bool {
        org_wide_allows(self.org_id, self.user_id, resource, "GET").await
    }

    async fn grants(&self) -> AlertGrants {
        let Some(user) = users::get_user(Some(self.org_id), self.user_id).await else {
            return AlertGrants::default();
        };
        let role = user.role.to_string();
        let (folders, alerts) = tokio::join!(
            self.listed("GET", "alert_folders", &role),
            self.listed("GET_INDIVIDUAL_FROM_ROLE", "alerts", &role),
        );
        AlertGrants::from_objects(self.org_id, folders, alerts)
    }

    async fn folders_of(&self, alert_ids: Vec<String>) -> HashMap<String, String> {
        if alert_ids.len() > ALERT_READS_ONE_BY_ONE {
            return org_alert_folders(self.org_id, &alert_ids).await;
        }
        stream::iter(alert_ids)
            .map(|id| async move {
                let ksuid = Ksuid::from_str(&id).ok()?;
                let (folder, _) = alert::get_by_id(get_orm_client_ro().await, self.org_id, ksuid)
                    .await
                    .ok()?;
                Some((id, folder.folder_id))
            })
            .buffer_unordered(ALERT_READ_CONCURRENCY)
            .filter_map(|found| async move { found })
            .collect()
            .await
    }

    async fn org_folders(&self) -> HashMap<String, String> {
        listed_folders(self.org_id, ListAlertsParams::new(self.org_id)).await
    }
}

/// Which rows naming an alert a reader may see, resolved once per request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AlertVisibility {
    /// RBAC is off, or the reader holds alerts GET org-wide: every row, cluster rows included.
    Org,
    /// A grant on every folder: every row that names an alert.
    AnyAlert,
    /// Only the rows naming one of these alerts; empty when no grant covers any.
    Only(BTreeSet<String>),
}

/// The distinct alert ids a read could return, and whether the probe stopped at its cap.
#[derive(Debug, Default)]
pub(crate) struct Probe {
    pub(crate) ids: Vec<String>,
    pub(crate) full: bool,
}

/// The org-wide check first, then the grants, and only then the probe and its alerts' folders.
pub(crate) async fn alert_visibility<A, P, F>(
    auth: &A,
    probe: P,
) -> Result<AlertVisibility, InfraError>
where
    A: AlertAuthority,
    P: FnOnce() -> F,
    F: Future<Output = Result<Probe, InfraError>>,
{
    if auth.org_wide("alerts").await {
        return Ok(AlertVisibility::Org);
    }
    let grants = auth.grants().await;
    if grants.every_folder {
        return Ok(AlertVisibility::AnyAlert);
    }
    if grants.is_empty() {
        return Ok(AlertVisibility::Only(BTreeSet::new()));
    }
    let probe = probe().await?;
    // A full probe may have stopped short of an alert, so the whole org's alerts are judged.
    let folders = if probe.full {
        auth.org_folders().await
    } else {
        auth.folders_of(probe.ids).await
    };
    Ok(AlertVisibility::Only(
        folders
            .into_iter()
            .filter(|(id, folder)| grants.allows(id, folder))
            .map(|(id, _)| id)
            .collect(),
    ))
}

/// With RBAC off every alert read is org-wide, so this one is too.
pub(crate) async fn live_visibility<P, F>(
    org_id: &str,
    user_id: &str,
    probe: P,
) -> Result<AlertVisibility, InfraError>
where
    P: FnOnce() -> F,
    F: Future<Output = Result<Probe, InfraError>>,
{
    if !rbac_enforced().await {
        return Ok(AlertVisibility::Org);
    }
    alert_visibility(&LiveAuthority { org_id, user_id }, probe).await
}

pub(crate) async fn org_wide_allows(
    org_id: &str,
    user_id: &str,
    resource: &str,
    method: &str,
) -> bool {
    check_permissions(
        org_id, org_id, user_id, resource, method, None, true, false, false,
    )
    .await
}

async fn org_alert_folders(org_id: &str, alert_ids: &[String]) -> HashMap<String, String> {
    listed_folders(org_id, folder_params(org_id, alert_ids)).await
}

/// Filtered to the ids in SQL, so the read follows the page, never the org's alert count.
fn folder_params(org_id: &str, alert_ids: &[String]) -> ListAlertsParams {
    ListAlertsParams::new(org_id).with_tag_alert_ids(alert_ids.to_vec())
}

async fn listed_folders(org_id: &str, params: ListAlertsParams) -> HashMap<String, String> {
    match alert::list_with_folders_db(params).await {
        Ok(listed) => listed
            .into_iter()
            .filter_map(|(folder, a)| Some((a.id?.to_string(), folder.folder_id)))
            .collect(),
        Err(e) => {
            log::warn!("autoobserve: listing {org_id}'s alerts failed: {e}");
            HashMap::new()
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{
        future::{Ready, ready},
        sync::atomic::{AtomicUsize, Ordering},
    };

    use super::*;

    /// Answers like a folder-scoped role and counts every call a subject filter makes.
    #[derive(Default)]
    pub(crate) struct CountingAuthority {
        pub(crate) org_wide: HashMap<&'static str, bool>,
        pub(crate) folders: HashMap<String, String>,
        pub(crate) grants: Vec<String>,
        pub(crate) org_wide_calls: AtomicUsize,
        pub(crate) grant_calls: AtomicUsize,
        pub(crate) folder_reads: AtomicUsize,
        pub(crate) alerts_read: AtomicUsize,
        pub(crate) org_folder_reads: AtomicUsize,
    }

    impl AlertAuthority for CountingAuthority {
        async fn org_wide(&self, resource: &'static str) -> bool {
            self.org_wide_calls.fetch_add(1, Ordering::SeqCst);
            self.org_wide.get(resource).copied().unwrap_or(false)
        }

        async fn grants(&self) -> AlertGrants {
            self.grant_calls.fetch_add(1, Ordering::SeqCst);
            let (folders, alerts): (Vec<String>, Vec<String>) = self
                .grants
                .iter()
                .cloned()
                .partition(|g| g.starts_with("afolder:"));
            AlertGrants::from_objects("o", folders, alerts)
        }

        async fn folders_of(&self, alert_ids: Vec<String>) -> HashMap<String, String> {
            self.folder_reads.fetch_add(1, Ordering::SeqCst);
            self.alerts_read
                .fetch_add(alert_ids.len(), Ordering::SeqCst);
            alert_ids
                .into_iter()
                .filter_map(|id| self.folders.get(&id).map(|f| (id, f.clone())))
                .collect()
        }

        async fn org_folders(&self) -> HashMap<String, String> {
            self.org_folder_reads.fetch_add(1, Ordering::SeqCst);
            self.folders.clone()
        }
    }

    fn folders(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, folder)| (id.to_string(), folder.to_string()))
            .collect()
    }

    fn only(ids: &[&str]) -> AlertVisibility {
        AlertVisibility::Only(ids.iter().map(|id| id.to_string()).collect())
    }

    fn probed(ids: &[&str]) -> impl FnOnce() -> Ready<Result<Probe, InfraError>> {
        let ids = ids.iter().map(|id| id.to_string()).collect();
        move || ready(Ok(Probe { ids, full: false }))
    }

    fn never_probed() -> impl FnOnce() -> Ready<Result<Probe, InfraError>> {
        || panic!("this reader needs no probe")
    }

    #[test]
    fn a_large_folder_lookup_lists_only_the_asked_alerts() {
        let ids: Vec<String> = (0..65).map(|n| format!("a{n}")).collect();
        let params = folder_params("o", &ids);
        assert_eq!(params.tag_alert_ids, Some(ids));
        assert_eq!(
            (params.org_id.as_str(), params.page_size_and_idx),
            ("o", None)
        );
    }

    #[test]
    fn a_folder_lookup_reads_every_folder_not_only_the_readers_listable_ones() {
        // Visibility filters after this lookup, so a reader-scoped list would lose alerts.
        let params = folder_params("o", &["a1".to_string()]);
        assert_eq!(params.listable_folder_ids, None);
    }

    #[test]
    fn grants_match_the_per_alert_checks_paths() {
        let grants = AlertGrants::from_objects(
            "o",
            vec!["afolder:ops".into()],
            vec!["alert:a1".into(), "alert:pay/a2".into()],
        );
        assert!(grants.allows("a0", "ops"), "folder grant");
        assert!(grants.allows("a1", "pay"), "alert grant");
        assert!(grants.allows("a2", "pay"), "alert-in-folder grant");
        assert!(!grants.allows("a2", "ops2"), "a2's grant names its folder");
        assert!(!grants.allows("a3", "pay"));
        let every = AlertGrants::from_objects("o", vec!["afolder:_all_o".into()], vec![]);
        assert!(every.allows("a9", "any"));
        let other_org = AlertGrants::from_objects("o", vec!["afolder:_all_p".into()], vec![]);
        assert!(!other_org.allows("a9", "any"));
    }

    #[tokio::test]
    async fn an_org_wide_reader_resolves_to_org_and_lists_no_grants() {
        let auth = CountingAuthority {
            org_wide: HashMap::from([("alerts", true)]),
            ..Default::default()
        };
        let visibility = alert_visibility(&auth, never_probed()).await.unwrap();
        assert_eq!(visibility, AlertVisibility::Org);
        assert_eq!(auth.org_wide_calls.load(Ordering::SeqCst), 1);
        assert_eq!(auth.grant_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn an_every_folder_grant_sees_every_alert_row_and_probes_nothing() {
        let auth = CountingAuthority {
            grants: vec!["afolder:_all_o".into()],
            ..Default::default()
        };
        let visibility = alert_visibility(&auth, never_probed()).await.unwrap();
        assert_eq!(visibility, AlertVisibility::AnyAlert);
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 0);
        assert_eq!(auth.org_folder_reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_folder_scoped_reader_sees_only_its_folders_and_granted_alerts() {
        let auth = CountingAuthority {
            folders: folders(&[("a0", "ops"), ("a1", "pay"), ("a2", "pay")]),
            grants: vec!["afolder:ops".into(), "alert:pay/a2".into()],
            ..Default::default()
        };
        let visibility = alert_visibility(&auth, probed(&["a0", "a1", "a2", "a9"]))
            .await
            .unwrap();
        assert_eq!(visibility, only(&["a0", "a2"]), "a9 is deleted: no folder");
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 1);
        assert_eq!(auth.alerts_read.load(Ordering::SeqCst), 4);
        assert_eq!(auth.org_folder_reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn no_grant_probes_nothing_and_sees_no_alert() {
        let auth = CountingAuthority {
            folders: folders(&[("a0", "ops")]),
            ..Default::default()
        };
        let visibility = alert_visibility(&auth, never_probed()).await.unwrap();
        assert_eq!(visibility, only(&[]));
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_full_probe_resolves_from_the_whole_org() {
        let auth = CountingAuthority {
            folders: folders(&[("a10001", "ops"), ("a3", "pay")]),
            grants: vec!["afolder:ops".into()],
            ..Default::default()
        };
        let ids: Vec<String> = (0..10_000).map(|n| format!("a{n}")).collect();
        let probe = move || ready(Ok(Probe { ids, full: true }));
        let visibility = alert_visibility(&auth, probe).await.unwrap();
        assert_eq!(visibility, only(&["a10001"]));
        assert_eq!(auth.org_folder_reads.load(Ordering::SeqCst), 1);
        assert_eq!(auth.folder_reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_failed_probe_is_an_error_never_org_wide() {
        let auth = CountingAuthority {
            grants: vec!["afolder:ops".into()],
            ..Default::default()
        };
        let probe = || ready(Err(InfraError::Message("search failed".into())));
        assert!(alert_visibility(&auth, probe).await.is_err());
    }
}
