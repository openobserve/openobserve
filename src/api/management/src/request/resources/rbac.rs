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

use std::{collections::HashSet, sync::Arc};

use config::meta::resources::{ResourceKind, ResourceRoute, ResourceSummary, SourceReason};
use openobserve_core::resources::ResourceAccess;
use tokio::time::Instant;

use super::permissions::{bounded, enabled, unavailable};

const OBJECT_LIMIT: usize = 1_000;

type Objects = Option<HashSet<String>>;

#[derive(Clone)]
enum Visibility {
    All,
    Objects {
        objects: Objects,
    },
    Folders {
        individual: Objects,
        readable: Objects,
        listable: Objects,
        object_type: &'static str,
        security: bool,
    },
    Synthetic {
        folders: Objects,
    },
    Streams {
        signals: Vec<SignalVisibility>,
    },
    User {
        subject: String,
        all: bool,
    },
}

impl Visibility {
    fn allows(&self, row: &ResourceSummary) -> bool {
        match self {
            Self::All => true,
            Self::Objects { objects } => member(objects, &row.id),
            Self::Folders {
                individual,
                readable,
                listable,
                object_type,
                security,
            } => {
                let Some(folder) = row.folder_id.as_deref() else {
                    return false;
                };
                member(listable, folder)
                    && (member(readable, folder)
                        || member(individual, &row.id)
                        || individual.as_ref().is_some_and(|ids| {
                            !ids.is_empty() && ids.contains(&format!("{folder}/{}", row.id))
                        })
                        || (*object_type == "alert" && member(individual, &row.name)))
                    && (!row.is_siem || *security)
            }
            Self::Synthetic { folders } => row
                .folder_id
                .as_deref()
                .is_some_and(|folder| member(folders, folder)),
            Self::Streams { signals } => {
                let ResourceRoute::Stream {
                    stream_type,
                    stream_name,
                } = &row.route_ref
                else {
                    return false;
                };
                let name = config::utils::str::into_ofga_supported_format(stream_name);
                signals.iter().any(|signal| {
                    signal.signal == stream_type && signal.entry && member(&signal.objects, &name)
                })
            }
            Self::User { subject, all } => *all || row.id == *subject,
        }
    }
}

#[derive(Clone)]
struct SignalVisibility {
    signal: &'static str,
    entry: bool,
    objects: Objects,
}

#[derive(Clone, Copy)]
enum CollectionPolicy {
    Configured,
    Enforced,
}

struct Authority<'a> {
    org: &'a str,
    subject: &'a str,
    role: Option<config::meta::user::UserRole>,
    is_external: bool,
}

impl<'a> Authority<'a> {
    async fn new(org: &'a str, subject: &'a str) -> Result<Self, SourceReason> {
        if !o2_openfga::config::get_config().enabled || db::user::is_root_user(subject) {
            return Ok(Self {
                org,
                subject,
                role: None,
                is_external: false,
            });
        }
        let user = openobserve_core::users::get_user(Some(org), subject)
            .await
            .ok_or(SourceReason::PermissionDenied)?;
        Ok(Self {
            org,
            subject,
            role: Some(user.role),
            is_external: user.is_external,
        })
    }

    async fn shortcut_membership(&self, kinds: &[ResourceKind]) -> bool {
        use config::meta::user::UserRole;
        if !matches!(
            self.role.as_ref(),
            Some(UserRole::Admin | UserRole::Editor | UserRole::Viewer)
        ) || !kinds
            .iter()
            .any(|kind| enabled(*kind) && kind.folder_type().is_some())
        {
            return true;
        }
        // Standard-role enumeration returns wildcards without verifying the org relation itself.
        self.entry("folders", "LIST").await
    }

    async fn entry(&self, object_type: &str, relation: &str) -> bool {
        let Some(role) = &self.role else { return true };
        let key = o2_openfga::meta::mapping::OFGA_MODELS
            .get(object_type)
            .map_or(object_type, |model| model.key);
        openobserve_core::authz::check_permissions(
            self.subject,
            openobserve_core::auth::AuthExtractor {
                auth: String::new(),
                method: relation.to_owned(),
                o2_type: format!("{key}:{}", self.org),
                org_id: self.org.to_owned(),
                bypass_check: false,
                parent_id: String::new(),
                use_all_org: true,
                use_self_context: false,
                use_self_parent: false,
                feature: None,
            },
            role.clone(),
            self.is_external,
        )
        .await
    }

    async fn listed(
        &self,
        relation: &str,
        object_type: &str,
        policy: CollectionPolicy,
    ) -> Result<Objects, SourceReason> {
        if matches!(policy, CollectionPolicy::Configured)
            && !o2_openfga::config::get_config().list_only_permitted
        {
            return Ok(None);
        }
        let Some(role) = &self.role else {
            return Ok(None);
        };
        let values = o2_openfga::authorizer::authz::list_objects(
            self.subject,
            relation,
            object_type,
            self.org,
            &role.to_string(),
        )
        .await
        .map_err(|_| SourceReason::PermissionUnavailable)?;
        Ok(granted(values, object_type, self.org))
    }
}

struct Resolved {
    visibility: Visibility,
    partial: bool,
}

impl Resolved {
    fn complete(visibility: Visibility) -> Self {
        Self {
            visibility,
            partial: false,
        }
    }
}

pub(super) async fn resolve(
    org: &str,
    subject: &str,
    kinds: &[ResourceKind],
    deadline: Instant,
) -> Vec<ResourceAccess> {
    let shared = async {
        let authority = Authority::new(org, subject).await?;
        let shortcut_verified = authority.shortcut_membership(kinds).await;
        Ok::<_, SourceReason>((authority, shortcut_verified))
    };
    let (authority, shortcut_verified) = match tokio::time::timeout_at(deadline, shared).await {
        Ok(Ok(shared)) => shared,
        Ok(Err(reason)) => return all_unavailable(kinds, reason),
        Err(_) => return all_unavailable(kinds, SourceReason::PermissionUnavailable),
    };
    let authority = &authority;
    futures::future::join_all(kinds.iter().map(|&kind| {
        bounded(kind, deadline, async move {
            if !enabled(kind) {
                return unavailable(kind, SourceReason::Disabled);
            }
            if kind.folder_type().is_some() && !shortcut_verified {
                return unavailable(kind, SourceReason::PermissionDenied);
            }
            match resolve_kind(authority, kind).await {
                Ok(resolved) => ResourceAccess {
                    kind,
                    predicate: Arc::new(move |row| {
                        resolved.visibility.allows(row) && row_feature_enabled(row)
                    }),
                    partial: resolved.partial,
                    unavailable_reason: None,
                },
                Err(reason) => unavailable(kind, reason),
            }
        })
    }))
    .await
}

pub(super) fn licensed(kind: ResourceKind) -> bool {
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::license::check_features;
    match kind {
        ResourceKind::Dashboard => check_features(&[Feature::Dashboards]),
        ResourceKind::Alert => check_features(&[Feature::Alerts]),
        ResourceKind::Function | ResourceKind::Pipeline => check_features(&[Feature::Pipelines]),
        ResourceKind::Synthetic => check_features(&[Feature::Synthetics]),
        ResourceKind::Stream => ["logs", "metrics", "traces"]
            .into_iter()
            .any(signal_enabled),
        ResourceKind::User | ResourceKind::ServiceAccount => true,
    }
}

fn row_feature_enabled(row: &ResourceSummary) -> bool {
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::license::check_features;
    if row.is_siem && !check_features(&[Feature::Security]) {
        return false;
    }
    match &row.route_ref {
        ResourceRoute::Stream { stream_type, .. } => signal_enabled(stream_type),
        ResourceRoute::Alert {
            alert_type: config::meta::resources::ResourceAlertType::AnomalyDetection,
            ..
        } => check_features(&[Feature::AnomalyDetection]),
        _ => true,
    }
}

fn all_unavailable(kinds: &[ResourceKind], reason: SourceReason) -> Vec<ResourceAccess> {
    kinds
        .iter()
        .map(|&kind| unavailable(kind, reason))
        .collect()
}

/// Keeps the ids granted on `object_type`; an org-wide `_all_` grant becomes no restriction.
fn granted(values: Vec<String>, object_type: &str, org: &str) -> Objects {
    let wildcard = format!("_all_{org}");
    let mut ids = HashSet::with_capacity(values.len());
    for value in values {
        let Some(id) = value
            .strip_prefix(object_type)
            .and_then(|rest| rest.strip_prefix(':'))
        else {
            continue;
        };
        if id == wildcard {
            return None;
        }
        ids.insert(id.to_owned());
    }
    Some(ids)
}

fn member(objects: &Objects, id: &str) -> bool {
    objects.as_ref().is_none_or(|objects| objects.contains(id))
}

fn capped(objects: &Objects) -> bool {
    objects
        .as_ref()
        .is_some_and(|objects| objects.len() >= OBJECT_LIMIT)
}

async fn resolve_kind(
    authority: &Authority<'_>,
    kind: ResourceKind,
) -> Result<Resolved, SourceReason> {
    if authority.role.is_none() {
        return Ok(Resolved::complete(Visibility::All));
    }
    match kind {
        ResourceKind::Dashboard => folders(authority, "dashboard", "dfolder").await,
        ResourceKind::Alert => folders(authority, "alert", "afolder").await,
        ResourceKind::Synthetic => {
            let folders = authority
                .listed("LIST", "synthetic_folder", CollectionPolicy::Enforced)
                .await?;
            Ok(Resolved {
                partial: capped(&folders),
                visibility: Visibility::Synthetic { folders },
            })
        }
        ResourceKind::Stream => signals(authority).await,
        ResourceKind::User => {
            let (entry, all) = tokio::join!(
                authority.entry("users", "LIST"),
                authority.entry("users", "GET")
            );
            if !entry {
                return Err(SourceReason::PermissionDenied);
            }
            Ok(Resolved::complete(Visibility::User {
                subject: authority.subject.to_owned(),
                all,
            }))
        }
        ResourceKind::Function => object_visibility(authority, "function").await,
        ResourceKind::Pipeline => object_visibility(authority, "pipeline").await,
        ResourceKind::ServiceAccount => object_visibility(authority, "service_accounts").await,
    }
}

async fn require_entry(authority: &Authority<'_>, object_type: &str) -> Result<(), SourceReason> {
    if authority.entry(object_type, "LIST").await {
        Ok(())
    } else {
        Err(SourceReason::PermissionDenied)
    }
}

async fn object_visibility(
    authority: &Authority<'_>,
    object_type: &'static str,
) -> Result<Resolved, SourceReason> {
    require_entry(authority, object_type).await?;
    let objects = authority
        .listed("GET", object_type, CollectionPolicy::Configured)
        .await?;
    Ok(Resolved {
        partial: capped(&objects),
        visibility: Visibility::Objects { objects },
    })
}

async fn folders(
    authority: &Authority<'_>,
    object_type: &'static str,
    folder_type: &'static str,
) -> Result<Resolved, SourceReason> {
    let security = async { object_type != "alert" || authority.entry("security", "GET").await };
    let (individual, readable, listable, security) = tokio::try_join!(
        authority.listed(
            "GET_INDIVIDUAL_FROM_ROLE",
            object_type,
            CollectionPolicy::Configured
        ),
        authority.listed("GET", folder_type, CollectionPolicy::Configured),
        authority.listed("LIST", folder_type, CollectionPolicy::Enforced),
        async { Ok::<_, SourceReason>(security.await) }
    )?;
    let partial = capped(&individual) || capped(&readable) || capped(&listable);
    Ok(Resolved {
        partial,
        visibility: Visibility::Folders {
            individual,
            readable,
            listable,
            object_type,
            security,
        },
    })
}

async fn signals(authority: &Authority<'_>) -> Result<Resolved, SourceReason> {
    let values =
        futures::future::join_all(["logs", "metrics", "traces"].map(|signal| async move {
            let entry = signal_enabled(signal) && authority.entry(signal, "LIST").await;
            let objects = if entry {
                authority
                    .listed("GET", signal, CollectionPolicy::Enforced)
                    .await?
            } else {
                Some(HashSet::new())
            };
            Ok::<_, SourceReason>(SignalVisibility {
                signal,
                entry,
                objects,
            })
        }))
        .await
        .into_iter()
        .collect::<Result<Vec<_>, _>>()?;
    if !values.iter().any(|value| value.entry) {
        return Err(SourceReason::PermissionDenied);
    }
    let partial = values.iter().any(|value| capped(&value.objects));
    Ok(Resolved {
        partial,
        visibility: Visibility::Streams { signals: values },
    })
}

fn signal_enabled(signal: &str) -> bool {
    use config::meta::feature::Feature;
    let feature = match signal {
        "logs" => Feature::Logs,
        "metrics" => Feature::Metrics,
        "traces" => Feature::Traces,
        _ => return false,
    };
    o2_enterprise::enterprise::license::check_features(&[feature])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn objects(values: &[&str]) -> Objects {
        Some(values.iter().map(|s| (*s).to_owned()).collect())
    }
    fn row(kind: ResourceKind) -> ResourceSummary {
        ResourceSummary {
            kind,
            id: "item".into(),
            name: "Payment".into(),
            folder_id: Some("folder".into()),
            folder_name: Some("Production".into()),
            route_ref: ResourceRoute::Dashboard {
                dashboard_id: "item".into(),
                folder_id: "folder".into(),
            },
            enabled: None,
            email: None,
            is_siem: false,
        }
    }

    #[test]
    fn folder_read_and_individual_grant_both_require_listable_folder() {
        let mut permission = Visibility::Folders {
            individual: objects(&["item"]),
            readable: objects(&["folder"]),
            listable: objects(&[]),
            object_type: "dashboard",
            security: true,
        };
        let dashboard = row(ResourceKind::Dashboard);
        assert!(!permission.allows(&dashboard));
        if let Visibility::Folders {
            listable, readable, ..
        } = &mut permission
        {
            *listable = objects(&["folder"]);
            *readable = objects(&[]);
        }
        assert!(permission.allows(&dashboard));
    }

    #[test]
    fn siem_requires_security_in_addition_to_folder_visibility() {
        let permission = Visibility::Folders {
            individual: None,
            readable: None,
            listable: None,
            object_type: "alert",
            security: false,
        };
        let mut alert = row(ResourceKind::Alert);
        assert!(permission.allows(&alert));
        alert.is_siem = true;
        assert!(!permission.allows(&alert));
    }

    #[test]
    fn stream_grants_do_not_cross_signal_boundaries() {
        let permission = Visibility::Streams {
            signals: vec![SignalVisibility {
                signal: "logs",
                entry: true,
                objects: objects(&["payment"]),
            }],
        };
        let mut stream = row(ResourceKind::Stream);
        stream.route_ref = ResourceRoute::Stream {
            stream_type: "traces".into(),
            stream_name: "payment".into(),
        };
        assert!(!permission.allows(&stream));
        stream.route_ref = ResourceRoute::Stream {
            stream_type: "logs".into(),
            stream_name: "payment".into(),
        };
        assert!(permission.allows(&stream));
    }

    #[test]
    fn wildcard_bypass_empty_and_cap_semantics_are_distinct() {
        let values = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect();
        assert!(member(&None, "item"));
        assert!(!member(&objects(&[]), "item"));
        assert!(member(
            &granted(values(&["function:_all_org"]), "function", "org"),
            "item"
        ));
        let other_type = granted(
            values(&["pipeline:_all_org", "pipeline:item"]),
            "function",
            "org",
        );
        assert!(!member(&other_type, "item"));
        assert!(member(
            &granted(values(&["function:item"]), "function", "org"),
            "item"
        ));
        let capped_objects = Some((0..OBJECT_LIMIT).map(|i| i.to_string()).collect());
        assert!(capped(&capped_objects));
    }
}
