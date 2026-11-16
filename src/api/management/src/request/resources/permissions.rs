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

#[cfg(any(feature = "enterprise", test))]
use std::collections::HashSet;
use std::sync::Arc;

#[cfg(any(feature = "enterprise", test))]
use config::meta::resources::ResourceRoute;
use config::meta::resources::{ResourceKind, ResourceSummary, SourceReason};
use openobserve_core::resources::ResourceAccess;

#[cfg(any(feature = "enterprise", test))]
const OBJECT_LIMIT: usize = 1_000;

#[cfg(any(feature = "enterprise", test))]
type Objects = Option<HashSet<String>>;

#[derive(Clone)]
enum Visibility {
    All,
    #[cfg(any(feature = "enterprise", test))]
    Objects {
        object_type: &'static str,
        objects: Objects,
    },
    #[cfg(any(feature = "enterprise", test))]
    Folders {
        individual: Objects,
        readable: Objects,
        listable: Objects,
        folder_type: &'static str,
        object_type: &'static str,
        security: bool,
    },
    #[cfg(any(feature = "enterprise", test))]
    Synthetic {
        folders: Objects,
    },
    #[cfg(any(feature = "enterprise", test))]
    Streams {
        signals: Vec<SignalVisibility>,
    },
    #[cfg(any(feature = "enterprise", test))]
    User {
        subject: String,
        all: bool,
    },
}

impl Visibility {
    fn allows(&self, _row: &ResourceSummary, _org: &str) -> bool {
        #[cfg(any(feature = "enterprise", test))]
        let (row, org) = (_row, _org);
        match self {
            Self::All => true,
            #[cfg(any(feature = "enterprise", test))]
            Self::Objects {
                object_type,
                objects,
            } => member(objects, object_type, &row.id, org),
            #[cfg(any(feature = "enterprise", test))]
            Self::Folders {
                individual,
                readable,
                listable,
                folder_type,
                object_type,
                security,
            } => {
                let Some(folder) = row.folder_id.as_deref() else {
                    return false;
                };
                member(listable, folder_type, folder, org)
                    && (member(readable, folder_type, folder, org)
                        || member(individual, object_type, &row.id, org)
                        || member(
                            individual,
                            object_type,
                            &format!("{folder}/{}", row.id),
                            org,
                        )
                        || (*object_type == "alert"
                            && member(individual, object_type, &row.name, org)))
                    && (!row.is_siem || *security)
            }
            #[cfg(any(feature = "enterprise", test))]
            Self::Synthetic { folders } => row
                .folder_id
                .as_deref()
                .is_some_and(|folder| member(folders, "synthetic_folder", folder, org)),
            #[cfg(any(feature = "enterprise", test))]
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
                    signal.signal == stream_type
                        && signal.entry
                        && member(&signal.objects, signal.signal, &name, org)
                })
            }
            #[cfg(any(feature = "enterprise", test))]
            Self::User { subject, all } => *all || row.id == *subject,
        }
    }
}

#[cfg(any(feature = "enterprise", test))]
#[derive(Clone)]
struct SignalVisibility {
    signal: &'static str,
    entry: bool,
    objects: Objects,
}

#[cfg(feature = "enterprise")]
#[derive(Clone, Copy)]
enum CollectionPolicy {
    Configured,
    Enforced,
}

#[cfg(feature = "enterprise")]
struct Authority<'a> {
    org: &'a str,
    subject: &'a str,
    role: Option<config::meta::user::UserRole>,
    is_external: bool,
}

#[cfg(feature = "enterprise")]
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
            .any(|kind| enabled(*kind) && folder_source(*kind))
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
        Ok(Some(values.into_iter().collect()))
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
) -> Vec<ResourceAccess> {
    #[cfg(feature = "enterprise")]
    let authority = match Authority::new(org, subject).await {
        Ok(authority) => authority,
        Err(reason) => {
            return kinds
                .iter()
                .map(|&kind| unavailable(kind, reason))
                .collect();
        }
    };
    #[cfg(feature = "enterprise")]
    let shortcut_verified = authority.shortcut_membership(kinds).await;
    #[cfg(feature = "enterprise")]
    let authority = &authority;
    futures::future::join_all(kinds.iter().map(|&kind| async move {
        if !enabled(kind) {
            return unavailable(kind, SourceReason::Disabled);
        }
        #[cfg(feature = "enterprise")]
        if folder_shortcut_denied(kind, shortcut_verified) {
            return unavailable(kind, SourceReason::PermissionDenied);
        }
        #[cfg(feature = "enterprise")]
        let resolved = resolve_kind(authority, kind).await;
        #[cfg(not(feature = "enterprise"))]
        let resolved = resolve_kind(org, subject, kind).await;
        match resolved {
            Ok(resolved) => {
                let org = org.to_owned();
                ResourceAccess {
                    kind,
                    predicate: Arc::new(move |row| {
                        resolved.visibility.allows(row, &org) && row_feature_enabled(row)
                    }),
                    partial: resolved.partial,
                    unavailable_reason: None,
                }
            }
            Err(reason) => unavailable(kind, reason),
        }
    }))
    .await
}

pub(super) fn enabled(kind: ResourceKind) -> bool {
    let cfg = config::get_config();
    match kind {
        ResourceKind::ServiceAccount if !cfg.auth.service_account_enabled => false,
        ResourceKind::Synthetic if !cfg.synthetics.enabled => false,
        _ => feature_enabled(kind),
    }
}

#[cfg(feature = "enterprise")]
fn feature_enabled(kind: ResourceKind) -> bool {
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::license::check_features;
    match kind {
        ResourceKind::Dashboard => check_features(&[Feature::Dashboards]),
        ResourceKind::Alert => check_features(&[Feature::Alerts]),
        ResourceKind::Function | ResourceKind::Pipeline => check_features(&[Feature::Pipelines]),
        ResourceKind::Synthetic => check_features(&[Feature::Synthetics]),
        ResourceKind::Stream | ResourceKind::SavedView => {
            [Feature::Logs, Feature::Metrics, Feature::Traces]
                .iter()
                .any(|f| check_features(std::slice::from_ref(f)))
        }
        _ => true,
    }
}

#[cfg(not(feature = "enterprise"))]
fn feature_enabled(_kind: ResourceKind) -> bool {
    true
}

#[cfg(feature = "enterprise")]
fn row_feature_enabled(row: &ResourceSummary) -> bool {
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::license::check_features;
    if row.is_siem && !check_features(&[Feature::Security]) {
        return false;
    }
    let feature = match &row.route_ref {
        ResourceRoute::Stream { stream_type, .. } => match stream_type.as_str() {
            "logs" => Some(Feature::Logs),
            "metrics" => Some(Feature::Metrics),
            "traces" => Some(Feature::Traces),
            _ => return false,
        },
        ResourceRoute::SavedView { view_type, .. } => match view_type.as_str() {
            "logs" => Some(Feature::Logs),
            "metrics_explorer" | "metrics" => Some(Feature::Metrics),
            "traces" => Some(Feature::Traces),
            _ => return false,
        },
        ResourceRoute::Alert {
            alert_type: config::meta::resources::ResourceAlertType::AnomalyDetection,
            ..
        } => Some(Feature::AnomalyDetection),
        _ => None,
    };
    feature.is_none_or(|feature| check_features(&[feature]))
}

#[cfg(not(feature = "enterprise"))]
fn row_feature_enabled(_row: &ResourceSummary) -> bool {
    true
}

fn unavailable(kind: ResourceKind, reason: SourceReason) -> ResourceAccess {
    ResourceAccess {
        kind,
        predicate: Arc::new(|_| false),
        partial: false,
        unavailable_reason: Some(reason),
    }
}

#[cfg(any(feature = "enterprise", test))]
fn member(objects: &Objects, object_type: &str, id: &str, org: &str) -> bool {
    objects.as_ref().is_none_or(|objects| {
        objects.contains(&format!("{object_type}:{id}"))
            || objects.contains(&format!("{object_type}:_all_{org}"))
    })
}

#[cfg(any(feature = "enterprise", test))]
fn capped(objects: &Objects) -> bool {
    objects
        .as_ref()
        .is_some_and(|objects| objects.len() >= OBJECT_LIMIT)
}

#[cfg(not(feature = "enterprise"))]
async fn resolve_kind(
    _org: &str,
    _subject: &str,
    _kind: ResourceKind,
) -> Result<Resolved, SourceReason> {
    Ok(Resolved::complete(Visibility::All))
}

#[cfg(any(feature = "enterprise", test))]
fn folder_source(kind: ResourceKind) -> bool {
    matches!(
        kind,
        ResourceKind::Dashboard | ResourceKind::Alert | ResourceKind::Synthetic
    )
}

#[cfg(any(feature = "enterprise", test))]
fn folder_shortcut_denied(kind: ResourceKind, verified: bool) -> bool {
    folder_source(kind) && !verified
}

#[cfg(feature = "enterprise")]
async fn resolve_kind(
    authority: &Authority<'_>,
    kind: ResourceKind,
) -> Result<Resolved, SourceReason> {
    if authority.role.is_none() {
        return Ok(Resolved::complete(Visibility::All));
    }
    match kind {
        ResourceKind::Dashboard => folders(authority, "dashboard", "dfolder").await,
        ResourceKind::Alert => {
            let (mut result, security) = tokio::join!(
                folders(authority, "alert", "afolder"),
                authority.entry("security", "GET")
            );
            if let Ok(Resolved {
                visibility: Visibility::Folders { security: flag, .. },
                ..
            }) = &mut result
            {
                *flag = security;
            }
            result
        }
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
        ResourceKind::SavedView => require_entry(authority, "savedviews")
            .await
            .map(|()| Resolved::complete(Visibility::All)),
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
        ResourceKind::Function => object_visibility(authority, "function", "function").await,
        ResourceKind::Pipeline => object_visibility(authority, "pipeline", "pipeline").await,
        ResourceKind::ServiceAccount => {
            object_visibility(authority, "service_accounts", "service_accounts").await
        }
    }
}

#[cfg(feature = "enterprise")]
async fn require_entry(authority: &Authority<'_>, object_type: &str) -> Result<(), SourceReason> {
    if authority.entry(object_type, "LIST").await {
        Ok(())
    } else {
        Err(SourceReason::PermissionDenied)
    }
}

#[cfg(feature = "enterprise")]
async fn object_visibility(
    authority: &Authority<'_>,
    gate: &str,
    object_type: &'static str,
) -> Result<Resolved, SourceReason> {
    require_entry(authority, gate).await?;
    let objects = authority
        .listed("GET", object_type, CollectionPolicy::Configured)
        .await?;
    Ok(Resolved {
        partial: capped(&objects),
        visibility: Visibility::Objects {
            object_type,
            objects,
        },
    })
}

#[cfg(feature = "enterprise")]
async fn folders(
    authority: &Authority<'_>,
    object_type: &'static str,
    folder_type: &'static str,
) -> Result<Resolved, SourceReason> {
    let (individual, readable, listable) = tokio::try_join!(
        authority.listed(
            "GET_INDIVIDUAL_FROM_ROLE",
            object_type,
            CollectionPolicy::Configured
        ),
        authority.listed("GET", folder_type, CollectionPolicy::Configured),
        authority.listed("LIST", folder_type, CollectionPolicy::Enforced)
    )?;
    let partial = capped(&individual) || capped(&readable) || capped(&listable);
    Ok(Resolved {
        partial,
        visibility: Visibility::Folders {
            individual,
            readable,
            listable,
            folder_type,
            object_type,
            security: true,
        },
    })
}

#[cfg(feature = "enterprise")]
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

#[cfg(feature = "enterprise")]
fn signal_enabled(signal: &str) -> bool {
    use config::meta::feature::Feature;
    use o2_enterprise::enterprise::license::check_features;
    let feature = match signal {
        "logs" => Feature::Logs,
        "metrics" => Feature::Metrics,
        "traces" => Feature::Traces,
        _ => return false,
    };
    check_features(&[feature])
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
    fn unverified_standard_role_never_uses_folder_source_wildcards() {
        for kind in [
            ResourceKind::Dashboard,
            ResourceKind::Alert,
            ResourceKind::Synthetic,
        ] {
            assert!(folder_shortcut_denied(kind, false));
            assert!(!folder_shortcut_denied(kind, true));
        }
        assert!(!folder_shortcut_denied(ResourceKind::ServiceAccount, false));
    }

    #[test]
    fn folder_read_and_individual_grant_both_require_listable_folder() {
        let mut permission = Visibility::Folders {
            individual: objects(&["dashboard:item"]),
            readable: objects(&["dfolder:folder"]),
            listable: objects(&[]),
            folder_type: "dfolder",
            object_type: "dashboard",
            security: true,
        };
        let dashboard = row(ResourceKind::Dashboard);
        assert!(!permission.allows(&dashboard, "org"));
        if let Visibility::Folders {
            listable, readable, ..
        } = &mut permission
        {
            *listable = objects(&["dfolder:folder"]);
            *readable = objects(&[]);
        }
        assert!(permission.allows(&dashboard, "org"));
    }

    #[test]
    fn siem_requires_security_in_addition_to_folder_visibility() {
        let permission = Visibility::Folders {
            individual: None,
            readable: None,
            listable: None,
            folder_type: "afolder",
            object_type: "alert",
            security: false,
        };
        let mut alert = row(ResourceKind::Alert);
        assert!(permission.allows(&alert, "org"));
        alert.is_siem = true;
        assert!(!permission.allows(&alert, "org"));
    }

    #[test]
    fn stream_grants_do_not_cross_signal_boundaries() {
        let permission = Visibility::Streams {
            signals: vec![SignalVisibility {
                signal: "logs",
                entry: true,
                objects: objects(&["logs:payment"]),
            }],
        };
        let mut stream = row(ResourceKind::Stream);
        stream.route_ref = ResourceRoute::Stream {
            stream_type: "traces".into(),
            stream_name: "payment".into(),
        };
        assert!(!permission.allows(&stream, "org"));
        stream.route_ref = ResourceRoute::Stream {
            stream_type: "logs".into(),
            stream_name: "payment".into(),
        };
        assert!(permission.allows(&stream, "org"));
    }

    #[test]
    fn user_self_only_is_not_generic_empty_collection() {
        let user = row(ResourceKind::User);
        assert!(
            Visibility::User {
                subject: "item".into(),
                all: false
            }
            .allows(&user, "org")
        );
        assert!(
            !Visibility::Objects {
                object_type: "user",
                objects: objects(&[])
            }
            .allows(&user, "org")
        );
    }

    #[test]
    fn wildcard_bypass_empty_and_cap_semantics_are_distinct() {
        assert!(member(&None, "function", "item", "org"));
        assert!(!member(&objects(&[]), "function", "item", "org"));
        assert!(member(
            &objects(&["function:_all_org"]),
            "function",
            "item",
            "org"
        ));
        assert!(!member(
            &objects(&["pipeline:_all_org"]),
            "function",
            "item",
            "org"
        ));
        let capped_objects = Some((0..OBJECT_LIMIT).map(|i| format!("function:{i}")).collect());
        assert!(capped(&capped_objects));
    }

    #[test]
    fn synthetic_list_permission_does_not_require_secret_detail_access() {
        let permission = Visibility::Synthetic {
            folders: objects(&["synthetic_folder:folder"]),
        };
        assert!(permission.allows(&row(ResourceKind::Synthetic), "org"));
    }
}
